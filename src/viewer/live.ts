// CLAUDE-OWNED (M10). Live calls for the viewer: the real runner, the in-process mock backend with failure flags,
// and the agent model (real by default, injectable for tests). Same wiring as the CLI chat (src/cli/chat.ts), but
// each caller turn records which tool calls ran for it, so the live trace has the exact order a stored call lacks.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/db.js";
import { journeyHash } from "../journey/hash.js";
import { createCall, type Call, type CallRecord, type Model } from "../journey/runner.js";
import { parseJourney, type Journey } from "../journey/schema.js";
import { INITIAL } from "../journey/stepup.js";
import { createApp } from "../mock-api/app.js";
import { customers as CUSTOMERS, loans as LOANS } from "../mock-api/seed.js";
import type { Store } from "../mock-api/store.js";
import { SCENARIO_FLAGS, type ScenarioFlag } from "../mock-api/types.js";
import { parseE164 } from "../tools/brand.js";
import type { Session } from "../tools/context.js";
import type { Article } from "../tools/searchKnowledge.js";
import { provenance, spokenIn } from "./provenance.js";
import type { LiveCall, LiveOptions, LiveStart, LiveStep, ToolCall } from "./types.js";

const API_KEY = "viewer-key";
const IDLE_MS = 30 * 60_000; // a live call nobody touched for this long is dropped

// phone_mismatch is how sims pick an identity; here the caller is chosen directly.
const LIVE_FLAGS = SCENARIO_FLAGS.filter((f) => f !== "phone_mismatch");

export class LiveError extends Error {
  constructor(
    readonly code: "not_found" | "busy" | "ended" | "bad_request" | "model_unavailable",
    message: string,
  ) {
    super(message);
  }
}

export type LiveDeps = {
  journeys: { stable: unknown; candidate: unknown }; // journey data, validated here
  articles: Article[];
  model: Model | null; // null: no API key, live calls are refused (replay still works)
  modelName: string;
  db?: Db; // ended calls are saved with source "manual"
  now?: () => number;
};

type Entry = {
  id: string;
  arm: "stable" | "candidate";
  journey: Journey;
  channel: "chat" | "voice";
  identity: string;
  flags: ScenarioFlag[];
  call: Call;
  store: Store;
  steps: LiveStep[];
  cursor: number; // provenance cursor across turns
  busy: boolean;
  ended: boolean;
  saved: boolean;
  touchedAt: number;
};

function toolView(r: CallRecord): ToolCall[] {
  return r.toolCalls.map((t, seq) => {
    let result: unknown = t.result;
    try {
      result = JSON.parse(t.result);
    } catch {
      // not JSON: keep the raw string, which is what the model saw
    }
    return { seq, name: t.name, executed: t.executed, ok: t.ok, errorKind: t.errorKind, latencyMs: t.latencyMs, input: t.input, result, spoken: spokenIn(result) };
  });
}

export function createLive(deps: LiveDeps) {
  const now = deps.now ?? Date.now;
  const calls = new Map<string, Entry>();

  const journeys = {
    stable: parseJourney(deps.journeys.stable),
    candidate: parseJourney(deps.journeys.candidate),
  };
  function journeyFor(arm: "stable" | "candidate"): Journey {
    const j = journeys[arm];
    if (!j.ok) throw new Error(`${arm} journey is invalid: ${JSON.stringify(j.error)}`);
    return j.data;
  }

  function sweep(): void {
    for (const [id, e] of calls) if (now() - e.touchedAt > IDLE_MS) calls.delete(id);
  }

  function entry(id: string): Entry {
    const e = calls.get(id);
    if (e === undefined) throw new LiveError("not_found", `no live call ${id}`);
    e.touchedAt = now();
    return e;
  }

  function view(e: Entry): LiveCall {
    const r = e.call.record();
    return {
      id: e.id,
      version: e.journey.version,
      arm: e.arm,
      channel: e.channel,
      identity: e.identity,
      flags: e.flags,
      ended: e.ended,
      outcome: r.outcome,
      endReason: r.endReason,
      steps: e.steps,
      toolCalls: toolView(r),
      guardrailEvents: r.guardrailEvents,
      handoff: r.handoff,
      textMessages: [...e.store.stepUp].map(([loanId, rec]) => `Northwind Lending: your code for ${loanId} is ${rec.code}.`),
      usage: r.usage,
      saved: e.saved,
    };
  }

  function step(e: Entry, caller: string | null, before: number, utterances: Awaited<ReturnType<Call["say"]>>["utterances"]): void {
    const tools = toolView(e.call.record());
    const sources = tools.filter((t) => t.spoken.length > 0).map(({ seq, name, spoken }) => ({ seq, name, spoken }));
    e.steps.push({
      caller,
      toolSeqs: tools.slice(before).map((t) => t.seq),
      utterances: utterances.map((u) => {
        if (u.kind === "verbatim") return u;
        const p = provenance(u.text, sources, e.cursor);
        e.cursor = p.cursor;
        return { kind: "agent", text: u.text, spans: p.spans };
      }),
    });
  }

  function finish(e: Entry): void {
    e.ended = true;
    if (deps.db === undefined || e.saved) return;
    const record = e.call.record();
    deps.db.saveCall({ record, journeyHash: journeyHash(e.journey), endedAt: new Date(now()).toISOString(), source: "manual", csat: null, judgments: [] });
    e.saved = true;
  }

  return {
    options(): LiveOptions {
      return {
        customers: CUSTOMERS.map((c) => ({
          name: c.name,
          phone: c.phone,
          loans: LOANS.filter((l) => l.customerId === c.id).map((l) => ({ id: l.id, status: l.status })),
        })),
        flags: [...LIVE_FLAGS],
        channels: ["chat", "voice"],
        arms: (["stable", "candidate"] as const).map((arm) => ({ arm, version: journeyFor(arm).version })),
        model: deps.modelName,
        modelAvailable: deps.model !== null,
      };
    },

    async start(body: LiveStart): Promise<LiveCall> {
      sweep();
      if (deps.model === null) throw new LiveError("model_unavailable", "ANTHROPIC_API_KEY is not set; use replay instead");
      const flags = body.flags.map((f): ScenarioFlag => {
        const known = LIVE_FLAGS.find((k) => k === f);
        if (known === undefined) throw new LiveError("bad_request", `unknown flag: ${f}`);
        return known;
      });
      const phone = body.phone === null ? null : parseE164(body.phone);
      if (body.phone !== null && phone === null) throw new LiveError("bad_request", `not an E.164 phone: ${body.phone}`);
      const customer = CUSTOMERS.find((c) => c.phone === body.phone);

      const id = `live-${randomUUID().slice(0, 8)}`;
      const journey = journeyFor(body.arm);
      const { app, store } = createApp({ apiKey: API_KEY, testRoutes: true, hangMs: 8_000 });
      const session: Session = {
        id,
        verifiedPhone: phone,
        stepUpVerifiedLoanId: null,
        stepUp: INITIAL,
        quotes: new Map(),
        now,
        api: { baseUrl: "http://mock.local", apiKey: API_KEY, timeoutMs: 3_000, fetchImpl: (input, init) => Promise.resolve(app.fetch(new Request(input, init))) },
      };
      await app.request(`/__test/scenarios/${id}`, {
        method: "PUT",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      const call = createCall({ journey, channel: body.channel, session, model: deps.model, articles: deps.articles, callId: id });
      const e: Entry = {
        id,
        arm: body.arm,
        journey,
        channel: body.channel,
        identity: customer === undefined ? "No caller ID (Tier 0)" : `Verified caller ID: ${customer.name} (Tier 1)`,
        flags,
        call,
        store,
        steps: [],
        cursor: 0,
        busy: false,
        ended: false,
        saved: false,
        touchedAt: now(),
      };
      calls.set(id, e);
      step(e, null, 0, (await call.open()).utterances);
      return view(e);
    },

    async say(id: string, text: string): Promise<LiveCall> {
      const e = entry(id);
      if (e.ended) throw new LiveError("ended", "this call has ended");
      if (e.busy) throw new LiveError("busy", "the agent is still answering the last message");
      if (text.trim() === "") throw new LiveError("bad_request", "say something first");
      e.busy = true;
      try {
        const before = e.call.record().toolCalls.length;
        const out = await e.call.say(text.trim());
        step(e, text.trim(), before, out.utterances);
        if (out.ended) finish(e);
      } finally {
        e.busy = false;
      }
      return view(e);
    },

    hangUp(id: string): LiveCall {
      const e = entry(id);
      if (!e.ended) {
        e.call.hangUp();
        finish(e);
      }
      return view(e);
    },

    get: (id: string): LiveCall => view(entry(id)),
  };
}

export type Live = ReturnType<typeof createLive>;
