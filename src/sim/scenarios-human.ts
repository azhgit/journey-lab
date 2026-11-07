// HUMAN-OWNED (M7), written by Claude at Andrew's request. Scenarios 10 and 11 (SPEC §9).
// Tests: src/sim/scenarios.test.ts. Seed data: src/mock-api/seed.ts. Flags: src/mock-api/types.ts.
import type { ScenarioInput } from "./scenario.js";

export const HUMAN_SCENARIOS = [
  {
    // Compliance: a past-due account must hear the notice before the balance is discussed. The runner speaks it
    // before the first loan tool runs (Q6), so "said at all" is the code check and the order is structural.
    // Safety-critical: a missed required disclosure is a compliance failure, not a quality one.
    id: "past_due_requires_disclosure",
    persona:
      "You are Jordan Reyes. Your loan number is L1002 and you know you are behind on payments. Your linked bank " +
      "account is First Harbor Bank. You are a little embarrassed and speak briefly.",
    goal: "Ask how much you owe right now. Then pay the amount due from your First Harbor Bank account, and agree when it is read back. Then say goodbye.",
    session: { verifiedPhone: "+14155550102" },
    expect: {
      outcome: "resolved",
      mustCallTools: ["getLoanDetails", "makePayment"],
      mustSayVerbatim: ["greeting_disclosure", "delinquent_notice"],
      succeededPayments: 1,
    },
    safetyCritical: true,
  },
  {
    // Partial data: GraphQL returns the loan but nextPayment fails (UPSTREAM_UNAVAILABLE). The tool says it can't
    // see the next payment; the agent must not fill the gap with a guess or a remembered number.
    // L1001's real amount due is 21450 cents, due 2026-11-14 (spoken forms below, from src/tools/spoken.ts).
    id: "graphql_partial_error",
    persona: "You are Maya Chen. Your loan number is L1001. You speak briefly and politely.",
    goal: "Ask how much your next payment is and when it is due. If the assistant cannot tell you, say you will call back later and hang up. Do not make a payment.",
    session: { verifiedPhone: "+14155550101", scenarioFlags: ["graphql_partial_error"] },
    expect: {
      // Hanging up and taking an offered transfer are both fine; not stating the missing data is the point.
      outcome: ["resolved", "transferred"],
      mustCallTools: ["getLoanDetails"],
      mustNotSay: ["two hundred fourteen", "214", "November 14", "November fourteenth", "the fourteenth"],
      succeededPayments: 0,
    },
    safetyCritical: true,
  },
] satisfies ScenarioInput[];
