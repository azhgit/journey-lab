import { describe, expect, it } from "vitest";
import type { CallRecord } from "../journey/runner.js";
import { applyEdit, NEGATIVE_CASES } from "./negatives.js";

const record: CallRecord = {
  callId: "c1",
  journeyId: "make-payment",
  journeyVersion: "1.0.2",
  channel: "voice",
  startedAt: "",
  identityAtStart: "caller_id",
  endReason: null,
  outcome: "transferred",
  handoff: {
    callId: "c1",
    journeyId: "make-payment",
    journeyVersion: "1.0.2",
    reason: "caller_requested",
    queue: "customer_care",
    authTier: 1,
    verifiedBy: "caller_id",
    loanId: "L1001",
    summary: "Payment was declined. Caller asked for a person.",
    summaryBy: "model",
  },
  authTierFinal: 1,
  callerTurns: 1,
  turns: [
    { role: "caller", text: "Pay it." },
    { role: "agent", text: "That payment was declined.", latencyMs: 1 },
  ],
  toolCalls: [],
  guardrailEvents: [],
  usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
};

describe("applyEdit", () => {
  it("replaces text in the summary, leaving the original record untouched", () => {
    const out = applyEdit(record, { target: "summary", edit: { replace: "was declined", with: "went through" } });
    expect(out.handoff?.summary).toBe("Payment went through. Caller asked for a person.");
    expect(record.handoff?.summary).toBe("Payment was declined. Caller asked for a person.");
  });

  it("appends to one agent turn", () => {
    const out = applyEdit(record, { target: { turn: 1 }, edit: { append: " Autopay is on." } });
    expect(out.turns[1]).toEqual({ role: "agent", text: "That payment was declined. Autopay is on.", latencyMs: 1 });
    expect(out.turns[0]).toEqual(record.turns[0]);
  });

  // A case whose text drifted must not silently test the unedited call, which would read as "judge missed it".
  it.each([
    ["text not found", { target: "summary" as const, edit: { replace: "nope", with: "x" } }],
    ["not an agent turn", { target: { turn: 0 }, edit: { append: "x" } }],
    ["no such turn", { target: { turn: 9 }, edit: { append: "x" } }],
  ])("throws when the edit cannot apply: %s", (_, change) => {
    expect(() => applyEdit(record, change)).toThrow();
  });

  it("throws on a summary edit for a call without a handoff", () => {
    expect(() => applyEdit({ ...record, handoff: null }, { target: "summary", edit: { append: "x" } })).toThrow();
  });
});

describe("NEGATIVE_CASES", () => {
  it("has unique ids, and summary edits only on transfer-quality cases", () => {
    expect(new Set(NEGATIVE_CASES.map((c) => c.id)).size).toBe(NEGATIVE_CASES.length);
    for (const c of NEGATIVE_CASES) expect(c.target === "summary", c.id).toBe(c.kind === "transfer_quality");
  });
});
