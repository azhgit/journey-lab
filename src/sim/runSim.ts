// CLAUDE-OWNED (M7). Runs one scenario: real runner + agent model, a simulated caller, the in-process mock backend
// with the scenario's failure flags, then code checks, the judge, and a simulated CSAT. SPEC §9.
import type { CallEvent, Model, Usage } from "../journey/runner.js";
import { createCall, type CallRecord } from "../journey/runner.js";
import type { Journey } from "../journey/schema.js";
import { parseE164 } from "../tools/brand.js";
import type { Article } from "../tools/searchKnowledge.js";
import { createTestBackend } from "../tools/testing.js";
import { codeChecks, type CheckResult } from "./checks.js";
import type { Scenario } from "./scenario.js";

// ---- ports: llm.ts adapts the SDK; tests use scripted fakes ----

export type TranscriptLine = { speaker: "agent" | "caller" | "sms"; text: string };
export type LlmResult<T> = { value: T; usage: Usage };
export type Csat = { reason: string; rating: number };

export const HANGUP = "<hangup>";

export type Caller = {
  next(scenario: Scenario, transcript: TranscriptLine[]): Promise<LlmResult<string>>; // may contain HANGUP
  rate(scenario: Scenario, transcript: TranscriptLine[]): Promise<LlmResult<Csat>>; // in character, after the call
};

export type Verdict = { reason: string; passed: boolean; issues: string[] };
export type JudgeInput = { scenario: Scenario; record: CallRecord };
export type Judge = {
  hallucination(input: JudgeInput): Promise<LlmResult<Verdict>>;
  transferQuality(input: JudgeInput): Promise<LlmResult<Verdict>>; // only for transferred calls
};

export type Judgment = Verdict & { kind: "hallucination" | "transfer_quality" };

export type SimResult = {
  scenarioId: string;
  run: number;
  safetyCritical: boolean;
  record: CallRecord;
  checks: CheckResult[];
  judgments: Judgment[];
  csat: Csat | null;
  passed: boolean;
  usage: { agent: Usage; caller: Usage; judge: Usage };
  error: string | null; // the harness itself failed (caller or judge API); the run counts as failed
};

export const SIM_MAX_CALLER_TURNS = 12;

const zeroUsage = (): Usage => ({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
function addUsage(into: Usage, more: Usage): void {
  for (const key of ["inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens"] as const) into[key] += more[key];
}

export type SimOptions = {
  scenario: Scenario;
  run: number;
  journey: Journey;
  agent: Model;
  caller: Caller;
  judge: Judge | null; // null: no judgments (synthetic production calls are not all judged)
  articles: Article[];
  callId?: string; // fixed id, e.g. for rollout bucketing; default is unique per run
  log?: (event: CallEvent) => void;
};

export async function runSim(opts: SimOptions): Promise<SimResult> {
  const { scenario, journey } = opts;
  const backend = createTestBackend();
  const rawPhone = scenario.session.verifiedPhone;
  const verifiedPhone = rawPhone === null ? null : parseE164(rawPhone);
  if (rawPhone !== null && verifiedPhone === null) throw new Error(`${scenario.id}: not an E.164 phone: ${rawPhone}`);
  const session = backend.session({ verifiedPhone });
  await backend.setFlags(session, scenario.session.scenarioFlags);

  // Allowed amounts per loan, the same rule as GET /payment-options: [amount due, payoff].
  const allowed = new Map(
    [...backend.store.loans.values()].flatMap((l) =>
      l.nextPayment === null ? [] : [[l.id, { minCents: l.nextPayment.amountDueCents, maxCents: l.payoffAmountCents }] as const],
    ),
  );

  const call = createCall({
    journey,
    channel: scenario.channel,
    session,
    model: opts.agent,
    articles: opts.articles,
    callId: opts.callId ?? `${scenario.id}-${opts.run}-${Math.random().toString(36).slice(2, 8)}`,
    maxCallerTurns: SIM_MAX_CALLER_TURNS,
    log: opts.log,
  });

  const transcript: TranscriptLine[] = [];
  const callerUsage = zeroUsage();
  const judgeUsage = zeroUsage();
  const shownCodes = new Set<string>();
  let error: string | null = null;

  const hear = (utterances: Array<{ text: string }>) => {
    const text = utterances.map((u) => u.text).join(" ");
    if (text !== "") transcript.push({ speaker: "agent", text });
  };

  // The mock SMS: the caller sees a code only if the scenario says their phone is at hand.
  const deliverSms = () => {
    for (const rec of backend.store.stepUp.values()) {
      if (shownCodes.has(rec.code)) continue;
      shownCodes.add(rec.code);
      if (scenario.session.callerReceivesSms) transcript.push({ speaker: "sms", text: rec.code });
    }
  };

  let csat: Csat | null = null;
  const judgments: Judgment[] = [];
  try {
    hear((await call.open()).utterances);
    for (;;) {
      const next = await opts.caller.next(scenario, transcript);
      addUsage(callerUsage, next.usage);
      const words = next.value.replace(HANGUP, "").trim();
      const hangsUp = next.value.includes(HANGUP);
      if (words !== "") {
        transcript.push({ speaker: "caller", text: words });
        const out = await call.say(words);
        hear(out.utterances);
        deliverSms();
        if (out.ended) break;
      }
      if (hangsUp || words === "") {
        call.hangUp();
        break;
      }
    }

    const rating = await opts.caller.rate(scenario, transcript);
    addUsage(callerUsage, rating.usage);
    csat = rating.value;

    const input = { scenario, record: call.record() };
    if (opts.judge !== null) {
      const h = await opts.judge.hallucination(input);
      addUsage(judgeUsage, h.usage);
      judgments.push({ kind: "hallucination", ...h.value });
      if (input.record.handoff !== null) {
        const t = await opts.judge.transferQuality(input);
        addUsage(judgeUsage, t.usage);
        judgments.push({ kind: "transfer_quality", ...t.value });
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const record = call.record();
  const checks = codeChecks(scenario, record, {
    payments: backend.store.payments,
    quotes: [...session.quotes.values()],
    allowed,
  });
  const passed = error === null && checks.every((c) => c.passed) && judgments.every((j) => j.passed);

  return {
    scenarioId: scenario.id,
    run: opts.run,
    safetyCritical: scenario.safetyCritical,
    record,
    checks,
    judgments,
    csat,
    passed,
    usage: { agent: record.usage, caller: callerUsage, judge: judgeUsage },
    error,
  };
}
