import { describe, expect, it } from "vitest";
import { openDb, type StoredCall } from "../db/db.js";
import type { CallRecord, ToolLogEntry } from "../journey/runner.js";
import { loadQueries, runQuery } from "./queries.js";
import { failureGroups, weeklyReview } from "./weeklyReview.js";

let seq = 0;
const tool = (name: string, ok = true, errorKind: string | null = null): ToolLogEntry => ({
  name,
  input: {},
  result: "{}",
  executed: true,
  ok,
  errorKind,
  latencyMs: 10,
});

function call(version: string, opts: { transferred?: string; tools?: ToolLogEntry[]; turns?: number; hallucination?: boolean } = {}): StoredCall {
  seq += 1;
  const id = `c${seq}`;
  const record: CallRecord = {
    callId: id,
    journeyId: "make-payment",
    journeyVersion: version,
    channel: "voice",
    startedAt: "2026-10-27T15:00:00.000Z",
    identityAtStart: "caller_id",
    endReason: opts.transferred === undefined ? "end_call" : "transfer",
    outcome: opts.transferred === undefined ? "resolved" : "transferred",
    handoff:
      opts.transferred === undefined
        ? null
        : {
            callId: id,
            journeyId: "make-payment",
            journeyVersion: version,
            reason: opts.transferred === "tool_failure" ? "tool_failure" : "caller_requested",
            queue: "customer_care",
            authTier: 1,
            verifiedBy: "caller_id",
            loanId: "L1001",
            summary: "s",
            summaryBy: "model",
          },
    authTierFinal: 1,
    callerTurns: opts.turns ?? 3,
    turns: [
      { role: "caller", text: "I want to pay." },
      { role: "agent", text: "Sure.", latencyMs: 500 },
    ],
    toolCalls: opts.tools ?? [],
    guardrailEvents: [],
    usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
  };
  return {
    record,
    journeyHash: "h",
    endedAt: "2026-10-27T15:05:00.000Z",
    source: "synthetic_prod",
    csat: 4,
    judgments: opts.hallucination === false ? [{ kind: "hallucination", passed: false, reason: "Invented a fee waiver." }] : [],
  };
}

function seeded() {
  seq = 0;
  const db = openDb(":memory:");
  const declinedThenTransfer = [tool("preparePayment"), tool("makePayment", false, "payment_failed"), tool("transferToHuman")];
  // stable: 8 calls, 1 transfer on request
  for (let i = 0; i < 7; i += 1) db.saveCall(call("1.0.0", { turns: 2 + i }));
  db.saveCall(call("1.0.0", { transferred: "caller_requested" }));
  // candidate: 4 calls, 3 transfers right after a declined payment (the planted regression)
  db.saveCall(call("1.1.0"));
  for (let i = 0; i < 3; i += 1) db.saveCall(call("1.1.0", { transferred: "tool_failure", tools: declinedThenTransfer }));
  return db;
}

describe("queries.sql", () => {
  const queries = loadQueries();

  it("has the five SPEC §10 queries", () => {
    expect([...queries.keys()]).toEqual([
      "containment_by_version",
      "transfer_reasons_by_version",
      "tool_errors",
      "turns_per_resolved_call",
      "transfer_quality_by_version",
    ]);
  });

  it("computes containment per version", () => {
    expect(runQuery(seeded(), queries, "containment_by_version", "synthetic_prod")).toEqual([
      { journey_id: "make-payment", journey_version: "1.0.0", calls: 8, transferred: 1, containment_pct: 87.5 },
      { journey_id: "make-payment", journey_version: "1.1.0", calls: 4, transferred: 3, containment_pct: 25 },
    ]);
  });

  it("ranks transfer reasons within a version", () => {
    expect(runQuery(seeded(), queries, "transfer_reasons_by_version", "synthetic_prod")).toEqual([
      { journey_version: "1.0.0", transfer_reason: "caller_requested", calls: 1, pct_of_transfers: 100 },
      { journey_version: "1.1.0", transfer_reason: "tool_failure", calls: 3, pct_of_transfers: 100 },
    ]);
  });

  it("gives error rates per tool and kind", () => {
    const rows = runQuery(seeded(), queries, "tool_errors", "synthetic_prod");
    expect(rows).toContainEqual({ tool: "makePayment", result: "payment_failed", calls: 3, pct_of_tool: 100 });
  });

  it("computes average and nearest-rank p95 turns for resolved calls", () => {
    // stable resolved turns: 2..8 (7 calls) → avg 5, p95 = 8; candidate: one resolved call with 3 turns
    expect(runQuery(seeded(), queries, "turns_per_resolved_call", "synthetic_prod")).toEqual([
      { journey_version: "1.0.0", resolved_calls: 7, avg_turns: 5, p95_turns: 8 },
      { journey_version: "1.1.0", resolved_calls: 1, avg_turns: 3, p95_turns: 3 },
    ]);
  });

  it("only counts the requested source", () => {
    expect(runQuery(seeded(), queries, "containment_by_version", "sim")).toEqual([]);
  });
});

describe("weekly review", () => {
  it("puts the candidate's decline-then-transfer group first", () => {
    const [top] = failureGroups(seeded(), "synthetic_prod");
    expect(top).toMatchObject({ journeyVersion: "1.1.0", reason: "tool_failure", trigger: "makePayment: payment_failed", shareOfVersion: 0.75 });
    expect(top?.calls).toHaveLength(3);
  });

  it("ranks a safety failure above every failure group, whatever its size", () => {
    const db = seeded();
    db.saveCall(call("1.0.0", { hallucination: false }));
    const text = weeklyReview(db, "synthetic_prod");
    const fixList = text.slice(text.indexOf("## Fix list"));
    expect(fixList).toMatch(/1\. \[SAFETY\] 1\.0\.0 · hallucination: Invented a fee waiver\./);
    expect(fixList).toMatch(/2\. 1\.1\.0 · transfer tool_failure after makePayment: payment_failed · 3 calls \(75% of 1\.1\.0\)/);
  });
});
