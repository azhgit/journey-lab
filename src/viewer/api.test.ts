import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { makePaymentCandidate } from "../../journeys/make-payment.candidate.js";
import { openDb } from "../db/db.js";
import { reply, scripted, text, use } from "../journey/fakeModel.js";
import type { Model } from "../journey/runner.js";
import { createViewerApi } from "./api.js";
import { createViewerData } from "./data.js";
import { createLive } from "./live.js";
import type { LiveCall, LiveOptions } from "./types.js";

function setup(model: Model | null) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "viewer-api-")), "t.db"));
  const live = createLive({ journeys: { stable: makePayment, candidate: makePaymentCandidate }, articles: [], model, modelName: "fake", db });
  const app = createViewerApi({ data: createViewerData(db.sql), live });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { db, app, post };
}

const maya = { phone: "+14155550101", channel: "chat", flags: [], arm: "stable" };

describe("read-only routes", () => {
  it("serves an empty database without failing", async () => {
    const { app } = setup(null);
    expect((await app.request("/api/summary")).status).toBe(200);
    expect(await (await app.request("/api/gate-runs")).json()).toEqual([]);
    expect(await (await app.request("/api/calls")).json()).toEqual({ total: 0, items: [] });
    expect((await app.request("/api/calls/nope")).status).toBe(404);
  });

  it("rejects a bad filter with the field that is wrong", async () => {
    const { app } = setup(null);
    const res = await app.request("/api/calls?outcome=maybe");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("outcome");
  });
});

describe("live calls", () => {
  it("lists customers, flags, and both journey versions", async () => {
    const { app } = setup(null);
    const o = (await (await app.request("/api/live/options")).json()) as LiveOptions;
    expect(o.customers.map((c) => c.name)).toContain("Maya Chen");
    expect(o.flags).toContain("payment_declined_once");
    expect(o.flags).not.toContain("phone_mismatch");
    expect(o.arms.map((a) => a.arm)).toEqual(["stable", "candidate"]);
    expect(o.modelAvailable).toBe(false);
  });

  it("refuses to start without a model", async () => {
    const { post } = setup(null);
    const res = await post("/api/live/calls", maya);
    expect(res.status).toBe(503);
  });

  it("runs a call: greeting, a tool call grouped with its turn, provenance, then saves it on hang-up", async () => {
    const { post, db } = setup(
      scripted([
        reply(use("getLoanDetails", { loanId: "L1001" })),
        reply(text("Thanks. Your loan is current. Your next payment of two hundred fourteen dollars and fifty cents is due Saturday, November 14.")),
      ]),
    );
    const started = (await (await post("/api/live/calls", maya)).json()) as LiveCall;
    expect(started.steps[0]?.utterances[0]).toMatchObject({ kind: "verbatim", lineId: "greeting_disclosure" });
    expect(started.identity).toBe("Verified caller ID: Maya Chen (Tier 1)");

    const res = await post(`/api/live/calls/${started.id}/say`, { text: "What do I owe on L1001?" });
    expect(res.status).toBe(200);
    const after = (await res.json()) as LiveCall;
    const turn = after.steps[1];
    expect(turn?.caller).toBe("What do I owe on L1001?");
    expect(turn?.toolSeqs).toEqual([0]);
    expect(after.toolCalls[0]?.name).toBe("getLoanDetails");
    const agent = turn?.utterances.find((u) => u.kind === "agent");
    expect(agent?.kind === "agent" && agent.spans.some((s) => s.from.kind === "tool")).toBe(true);

    const ended = (await (await post(`/api/live/calls/${started.id}/hangup`, {})).json()) as LiveCall;
    expect(ended.ended).toBe(true);
    expect(ended.saved).toBe(true);
    expect(db.sql.prepare("SELECT source FROM calls WHERE id = ?").get(started.id)).toEqual({ source: "manual" });
    expect((await post(`/api/live/calls/${started.id}/say`, { text: "hello" })).status).toBe(409);
  });

  it("rejects an unknown flag and an unknown call", async () => {
    const { post } = setup(scripted([]));
    expect((await post("/api/live/calls", { ...maya, flags: ["meteor_strike"] })).status).toBe(400);
    expect((await post("/api/live/calls/live-nope/say", { text: "hi" })).status).toBe(404);
  });
});
