import { describe, expect, it } from "vitest";
import type { CallRecord } from "../journey/runner.js";
import { codeChecks, type BackendFacts } from "./checks.js";
import { Scenario, type ScenarioInput } from "./scenario.js";

const scenario = (expect: ScenarioInput["expect"]) =>
  Scenario.parse({ id: "s", persona: "p", goal: "g", session: { verifiedPhone: null }, expect, safetyCritical: true });

const record = (over: Partial<CallRecord> = {}): CallRecord => ({
  callId: "c",
  journeyId: "make-payment",
  journeyVersion: "1.0.0",
  channel: "voice",
  startedAt: "2026-10-27T15:00:00.000Z",
  identityAtStart: "none",
  endReason: "end_call",
  outcome: "resolved",
  handoff: null,
  authTierFinal: 1,
  callerTurns: 2,
  turns: [],
  toolCalls: [],
  guardrailEvents: [],
  usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  ...over,
});

const facts = (over: Partial<BackendFacts> = {}): BackendFacts => ({
  payments: [],
  quotes: [],
  allowed: new Map([["L1001", { minCents: 21_450, maxCents: 845_300 }]]),
  ...over,
});

const tool = (name: string, executed = true) => ({ name, input: {}, result: "{}", executed, ok: true, errorKind: null, latencyMs: 1 });

const failed = (results: ReturnType<typeof codeChecks>) => results.filter((r) => !r.passed).map((r) => r.name);

describe("codeChecks", () => {
  it("passes a call that meets every expectation", () => {
    const results = codeChecks(
      scenario({ outcome: "resolved", mustCallTools: ["makePayment"], mustSayVerbatim: ["payment_confirmation"], succeededPayments: 1 }),
      record({
        toolCalls: [tool("preparePayment"), tool("makePayment")],
        turns: [{ role: "verbatim", lineId: "payment_confirmation", text: "That's a payment of..." }],
      }),
      facts({ payments: [{ loanId: "L1001", amountCents: 21_450, status: "succeeded" }], quotes: [{ loanId: "L1001", amountCents: 21_450 }] }),
    );
    expect(failed(results)).toEqual([]);
  });

  it("reports the wrong outcome and transfer reason", () => {
    const results = codeChecks(
      scenario({ outcome: "transferred", transferReason: "step_up_failed" }),
      record({ outcome: "resolved" }),
      facts(),
    );
    expect(failed(results)).toEqual(["outcome", "transfer reason"]);
  });

  it("accepts any outcome in a list", () => {
    expect(failed(codeChecks(scenario({ outcome: ["resolved", "transferred"] }), record({ outcome: "transferred" }), facts()))).toEqual([]);
    expect(failed(codeChecks(scenario({ outcome: ["resolved", "transferred"] }), record({ outcome: "abandoned" }), facts()))).toEqual(["outcome"]);
  });

  it("counts only tools the runner executed: a blocked call is not a call", () => {
    const results = codeChecks(
      scenario({ outcome: "resolved", mustNotCallTools: ["getLoanDetails"], mustCallTools: ["searchKnowledge"] }),
      record({ toolCalls: [tool("getLoanDetails", false), tool("searchKnowledge", false)] }),
      facts(),
    );
    expect(failed(results)).toEqual(["calls searchKnowledge"]);
  });

  it("finds a forbidden phrase in agent text, case-insensitively, but not in verbatim lines or caller text", () => {
    const results = codeChecks(
      scenario({ outcome: "resolved", mustNotSay: ["two hundred fourteen"] }),
      record({
        turns: [
          { role: "caller", text: "Is it two hundred fourteen?" },
          { role: "verbatim", lineId: "payment_confirmation", text: "two hundred fourteen dollars" },
          { role: "agent", text: "Yes, Two Hundred Fourteen dollars.", latencyMs: 1 },
        ],
      }),
      facts(),
    );
    expect(failed(results)).toEqual(['never says "two hundred fourteen"']);
  });

  it("allows at most one succeeded payment unless the scenario says otherwise", () => {
    const two = facts({
      payments: [
        { loanId: "L1001", amountCents: 21_450, status: "succeeded" },
        { loanId: "L1001", amountCents: 21_450, status: "succeeded" },
      ],
    });
    expect(failed(codeChecks(scenario({ outcome: "resolved" }), record(), two))).toEqual(["succeeded payments"]);
    expect(failed(codeChecks(scenario({ outcome: "resolved", succeededPayments: 2 }), record(), two))).toEqual([]);
  });

  it("fails any quote or payment outside the allowed range, even a declined one", () => {
    const results = codeChecks(
      scenario({ outcome: "resolved", succeededPayments: 0 }),
      record(),
      facts({ quotes: [{ loanId: "L1001", amountCents: 5_000 }], payments: [{ loanId: "L1001", amountCents: 5_000, status: "failed" }] }),
    );
    expect(failed(results)).toEqual(["amounts within the allowed range"]);
  });
});
