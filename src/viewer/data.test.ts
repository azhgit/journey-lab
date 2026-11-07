import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db, type StoredCall } from "../db/db.js";
import type { CallRecord } from "../journey/runner.js";
import { createViewerData, type ViewerData } from "./data.js";

const SPOKEN = "Your loan is current. Your next payment of two hundred fourteen dollars and fifty cents is due Saturday, November 14.";
const READ_BACK = "That's a payment of two hundred fourteen dollars and fifty cents from First Harbor Bank ending in four eight two one. Shall I go ahead?";

function record(callId: string, version: string, outcome: CallRecord["outcome"]): CallRecord {
  return {
    callId,
    journeyId: "make-payment",
    journeyVersion: version,
    channel: "voice",
    startedAt: `2026-10-28T0${callId.length % 10}:00:00.000Z`,
    identityAtStart: "caller_id",
    endReason: outcome === "transferred" ? "transfer" : "end_call",
    outcome,
    handoff:
      outcome === "transferred"
        ? { callId, journeyId: "make-payment", journeyVersion: version, reason: "tool_failure", queue: "customer_care", authTier: 1, verifiedBy: "caller_id", loanId: "L1001", summary: "Declined twice.", summaryBy: "model" }
        : null,
    authTierFinal: 1,
    callerTurns: 2,
    turns: [
      { role: "verbatim", lineId: "greeting_disclosure", text: "Thanks for calling Northwind Lending." },
      { role: "caller", text: "I want to pay." },
      { role: "agent", text: `Sure. ${SPOKEN} Which account?`, latencyMs: 800 },
      { role: "verbatim", lineId: "payment_confirmation", text: READ_BACK },
    ],
    toolCalls: [
      { name: "getLoanDetails", input: { loanId: "L1001" }, result: JSON.stringify({ ok: true, spoken: SPOKEN }), executed: true, ok: true, errorKind: null, latencyMs: 30 },
      { name: "preparePayment", input: { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" }, result: JSON.stringify({ ok: true, spokenToCustomer: READ_BACK }), executed: true, ok: true, errorKind: null, latencyMs: 20 },
    ],
    guardrailEvents: [],
    usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
  };
}

const stored = (r: CallRecord, passed: boolean): StoredCall & { sim: { callId: string; scenarioId: string; safetyCritical: boolean; passed: boolean; failedChecks: string[] } } => ({
  record: r,
  journeyHash: "h1",
  endedAt: r.startedAt,
  source: "sim",
  csat: 4,
  judgments: [{ kind: "hallucination", passed, reason: passed ? "Supported." : "Invented a fee." }],
  sim: { callId: r.callId, scenarioId: "pay_happy_path", safetyCritical: true, passed, failedChecks: passed ? [] : ["hallucination"] },
});

let db: Db;
let data: ViewerData;

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "viewer-")), "t.db"));
  db.saveGateRun(
    { id: "gate-a", startedAt: "2026-10-28T01:00:00.000Z", journeyId: "make-payment", journeyVersion: "1.0.0", journeyHash: "h1", passed: false, passRate: 0.5, costUsd: 0.1 },
    [stored(record("a1", "1.0.0", "resolved"), true), stored(record("a22", "1.0.0", "transferred"), false)],
  );
  db.saveGateRun(
    { id: "gate-b", startedAt: "2026-10-28T02:00:00.000Z", journeyId: "make-payment", journeyVersion: "1.0.0", journeyHash: "h1", passed: true, passRate: 1, costUsd: 0.1 },
    [stored(record("b333", "1.0.0", "resolved"), true)],
  );
  db.recordVersion("make-payment", "1.0.0", "h1", "2026-10-28T02:05:00.000Z");
  data = createViewerData(db.sql);
});

describe("gate runs", () => {
  it("counts runs and failures, and marks the first passing run as the release", () => {
    expect(data.gateRuns().map((g) => [g.id, g.runs, g.failedRuns, g.safetyFailures, g.releases, g.failedScenarios])).toEqual([
      ["gate-a", 2, 1, 1, false, ["pay_happy_path"]],
      ["gate-b", 1, 0, 0, true, []],
    ]);
  });

  it("returns each result with its failed checks and latest judgments", () => {
    const run = data.gateRun("gate-a");
    expect(run?.results.find((r) => r.callId === "a22")).toMatchObject({
      passed: false,
      failedChecks: ["hallucination"],
      outcome: "transferred",
      transferReason: "tool_failure",
      judgments: [{ kind: "hallucination", passed: false }],
    });
    expect(data.gateRun("nope")).toBeNull();
  });
});

describe("incident", () => {
  it("splits synthetic production calls by version, with containment and reasons", () => {
    const prod = (id: string, version: string, outcome: CallRecord["outcome"]) =>
      db.saveCall({ record: record(id, version, outcome), journeyHash: "h", endedAt: "", source: "synthetic_prod", csat: null, judgments: [] });
    prod("p1", "1.0.0", "resolved");
    prod("p2", "1.1.0", "transferred");
    prod("p3", "1.1.0", "resolved");
    expect(data.incident()).toEqual([
      { version: "1.0.0", calls: 1, transferred: 0, containment: 1, reasons: [], transferredCallIds: [] },
      { version: "1.1.0", calls: 2, transferred: 1, containment: 0.5, reasons: [{ reason: "tool_failure", calls: 1 }], transferredCallIds: ["p2"] },
    ]);
  });
});

describe("summary", () => {
  it("names the current release and the run that released it", () => {
    const s = data.summary();
    expect(s.current).toEqual({ version: "1.0.0", gateRunId: "gate-b", passed: 1, runs: 1 });
    expect(s.calls).toEqual({ total: 3, bySource: { sim: 3, manual: 0, synthetic_prod: 0 }, withEvidence: 3 });
    expect(s.gateRuns).toEqual({ total: 2, passed: 1 });
  });
});

describe("calls", () => {
  it("filters by outcome and searches ids and scenarios", () => {
    expect(data.calls({ outcome: "transferred" }).items.map((c) => c.id)).toEqual(["a22"]);
    expect(data.calls({ q: "happy" }).total).toBe(3);
    expect(data.calls({ gateRunId: "gate-b" }).items.map((c) => c.id)).toEqual(["b333"]);
  });

  it("rebuilds a trace: provenance spans, the read-back linked to its tool, the handoff", () => {
    const c = data.call("a22");
    const agent = c?.turns.find((t) => t.role === "agent");
    expect(agent?.role === "agent" && agent.spans.map((s) => s.from.kind)).toEqual(["model", "tool", "model"]);
    const readBack = c?.turns.find((t) => t.role === "verbatim" && t.lineId === "payment_confirmation");
    expect(readBack?.role === "verbatim" && readBack.fromToolSeq).toBe(1);
    expect(c?.handoff?.queue).toBe("customer_care");
    expect(c?.toolCalls[0]?.spoken).toEqual([SPOKEN]);
    expect(c?.hasEvidence).toBe(true);
  });

  it("says a call stored before the evidence columns has no evidence, and its provenance is unknown", () => {
    db.sql.prepare("UPDATE tool_calls SET input_json = NULL, result_json = NULL WHERE call_id = 'a1'").run();
    const c = data.call("a1");
    expect(c?.hasEvidence).toBe(false);
    const agent = c?.turns.find((t) => t.role === "agent");
    expect(agent?.role === "agent" && agent.spans.map((s) => s.from.kind)).toEqual(["unknown"]);
    expect(data.call("missing")).toBeNull();
  });
});
