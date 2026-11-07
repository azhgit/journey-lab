import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallRecord } from "../journey/runner.js";
import { openDb, redact, type StoredCall } from "./db.js";

const record: CallRecord = {
  callId: "call-1",
  journeyId: "make-payment",
  journeyVersion: "1.0.0",
  channel: "voice",
  startedAt: "2026-10-27T15:00:00.000Z",
  identityAtStart: "none",
  endReason: "transfer",
  outcome: "transferred",
  handoff: {
    callId: "call-1",
    journeyId: "make-payment",
    journeyVersion: "1.0.0",
    reason: "step_up_failed",
    queue: "fraud_review",
    authTier: 0,
    verifiedBy: "none",
    loanId: null,
    summary: 'Caller read code 123456, then asked for a person. [System facts: step-up failed]',
    summaryBy: "model_and_code",
  },
  authTierFinal: 0,
  callerTurns: 3,
  turns: [
    { role: "verbatim", lineId: "greeting_disclosure", text: "Thanks for calling." },
    { role: "caller", text: "My code is 1 2 3 4 5 6." },
    { role: "agent", text: "That code didn't match.", latencyMs: 900 },
  ],
  toolCalls: [
    { name: "checkStepUpCode", input: { code: "123456" }, result: '{"ok":true,"data":{"passed":false}}', executed: true, ok: true, errorKind: null, latencyMs: 40 },
    { name: "preparePayment", input: { loanId: "L1001", amountCents: 845_300, linkedAccountId: "A1" }, result: '{"ok":true}', executed: true, ok: true, errorKind: null, latencyMs: 5 },
    { name: "transferToHuman", input: { reason: "step_up_failed", summary: "Caller read 123456 twice." }, result: '{"ok":true}', executed: true, ok: true, errorKind: null, latencyMs: 0 },
  ],
  guardrailEvents: [],
  usage: { inputTokens: 10, cacheWriteTokens: 100, cacheReadTokens: 1000, outputTokens: 50 },
};

const stored: StoredCall = {
  record,
  journeyHash: "abc",
  endedAt: "2026-10-27T15:02:00.000Z",
  source: "sim",
  csat: 2,
  judgments: [{ kind: "transfer_quality", passed: true, reason: "Summary matches." }],
};

describe("redact", () => {
  it.each([
    ["My code is 066477.", "My code is [digits]."],
    ["It's 0 6 6 4 7 7", "It's [digits]"],
    ["Call +14155550101 now", "Call [digits] now"],
    ["Loan L1001, due November 14", "Loan L1001, due November 14"],
  ])("%s", (input, output) => {
    expect(redact(input)).toBe(output);
  });
});

describe("openDb", () => {
  it("stores a call with its tools, redacted turns and judgments", () => {
    const db = openDb(":memory:");
    db.saveCall(stored);
    expect(db.sql.prepare("SELECT outcome, transfer_reason, input_tokens, sim_csat FROM calls").get()).toEqual({
      outcome: "transferred",
      transfer_reason: "step_up_failed",
      input_tokens: 1110,
      sim_csat: 2,
    });
    expect(db.sql.prepare("SELECT text_redacted FROM turns WHERE role = 'caller'").get()).toEqual({ text_redacted: "My code is [digits]." });
    expect(db.sql.prepare("SELECT count(*) AS n FROM tool_calls").get()).toEqual({ n: 3 });
    expect(db.sql.prepare("SELECT kind, passed FROM judgments").get()).toEqual({ kind: "transfer_quality", passed: 1 });
  });

  it("stores what the judge saw: identity, the handoff, and each tool's input and result", () => {
    const db = openDb(":memory:");
    db.saveCall(stored);
    const call = db.sql.prepare<[], { identity_at_start: string; handoff_json: string }>("SELECT identity_at_start, handoff_json FROM calls").get();
    expect(call?.identity_at_start).toBe("none");
    // The summary can quote the caller, so it is redacted like a turn.
    expect(JSON.parse(call?.handoff_json ?? "null")).toEqual({
      ...record.handoff,
      summary: "Caller read code [digits], then asked for a person. [System facts: step-up failed]",
    });
    const tools = db.sql.prepare<[], { input_json: string; result_json: string }>("SELECT input_json, result_json FROM tool_calls ORDER BY id").all();
    // Free text (a code, a summary quoting the caller) is redacted; amounts are numbers and keep all their digits.
    expect(tools.map((t) => JSON.parse(t.input_json))).toEqual([
      { code: "[digits]" },
      { loanId: "L1001", amountCents: 845_300, linkedAccountId: "A1" },
      { reason: "step_up_failed", summary: "Caller read [digits] twice." },
    ]);
    expect(tools[0]?.result_json).toBe('{"ok":true,"data":{"passed":false}}');
  });

  it("rebuilds what the judge reads from a stored call, redacted as stored", () => {
    const db = openDb(":memory:");
    db.saveCall(stored);
    const back = db.loadCallRecord("call-1");
    expect(back).toMatchObject({
      callId: "call-1",
      journeyVersion: "1.0.0",
      identityAtStart: "none",
      authTierFinal: 0,
      outcome: "transferred",
      handoff: { ...record.handoff, summary: "Caller read code [digits], then asked for a person. [System facts: step-up failed]" },
      turns: [
        { role: "verbatim", lineId: "greeting_disclosure", text: "Thanks for calling." },
        { role: "caller", text: "My code is [digits]." },
        { role: "agent", text: "That code didn't match.", latencyMs: 900 },
      ],
    });
    expect(back?.toolCalls[1]).toEqual(record.toolCalls[1]);
    expect(back?.toolCalls[0]?.input).toEqual({ code: "[digits]" });
  });

  it("returns null for a call stored without evidence, or not stored", () => {
    const db = openDb(":memory:");
    db.saveCall(stored);
    db.sql.prepare("UPDATE calls SET identity_at_start = NULL").run();
    expect(db.loadCallRecord("call-1")).toBeNull();
    expect(db.loadCallRecord("nope")).toBeNull();
  });

  it("adds the new columns to a database created before them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "journey-lab-")), "old.db");
    const old = new Database(path);
    old.exec(`CREATE TABLE calls (id TEXT PRIMARY KEY, journey_id TEXT NOT NULL, journey_version TEXT NOT NULL,
      journey_hash TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, outcome TEXT, transfer_reason TEXT,
      auth_tier_final INTEGER NOT NULL, turns INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      sim_csat INTEGER, source TEXT NOT NULL);
      CREATE TABLE tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL, name TEXT NOT NULL,
      executed INTEGER NOT NULL, ok INTEGER NOT NULL, error_kind TEXT, latency_ms INTEGER NOT NULL);`);
    old.close();

    const db = openDb(path);
    db.saveCall(stored);
    expect(db.sql.prepare("SELECT count(*) AS n FROM tool_calls WHERE input_json IS NOT NULL").get()).toEqual({ n: 3 });
    db.close();
  });

  it("remembers the first hash for a journey version (Q13)", () => {
    const db = openDb(":memory:");
    expect(db.recordedHash("make-payment", "1.0.0")).toBeNull();
    db.recordVersion("make-payment", "1.0.0", "abc", "2026-10-27");
    db.recordVersion("make-payment", "1.0.0", "def", "2026-10-28"); // ignored: the first one wins
    expect(db.recordedHash("make-payment", "1.0.0")).toBe("abc");
  });

  it("stores a gate run and its sim results in one transaction", () => {
    const db = openDb(":memory:");
    const run = { id: "g1", startedAt: "t", journeyId: "make-payment", journeyVersion: "1.0.0", journeyHash: "abc", passed: false, passRate: 0.5, costUsd: 0.12 };
    const sim = { callId: "call-1", scenarioId: "step_up_two_wrong_codes", safetyCritical: true, passed: false, failedChecks: ["outcome"] };
    db.saveGateRun(run, [{ ...stored, sim }]);
    expect(db.sql.prepare("SELECT scenario_id, passed, failed_checks FROM sim_results").get()).toEqual({
      scenario_id: "step_up_two_wrong_codes",
      passed: 0,
      failed_checks: '["outcome"]',
    });

    // A failure part-way leaves nothing behind.
    expect(() => db.saveGateRun({ ...run, id: "g2" }, [{ ...stored, sim }])).toThrow(); // call-1 already exists
    expect(db.sql.prepare("SELECT count(*) AS n FROM gate_runs").get()).toEqual({ n: 1 });
  });
});
