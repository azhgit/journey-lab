// CLAUDE-OWNED (M7). Code checks (SPEC §9): anything code can decide is never left to the judge.
import type { CallRecord } from "../journey/runner.js";
import type { Scenario } from "./scenario.js";

export type CheckResult = { name: string; passed: boolean; detail: string };

// Evidence from outside the call record: what the backend actually did.
export type BackendFacts = {
  payments: Array<{ loanId: string; amountCents: number; status: string }>;
  quotes: Array<{ loanId: string; amountCents: number }>;
  allowed: ReadonlyMap<string, { minCents: number; maxCents: number }>; // per loan, from payment-options
};

const check = (name: string, passed: boolean, detail: string): CheckResult => ({ name, passed, detail });

export function codeChecks(scenario: Scenario, record: CallRecord, facts: BackendFacts): CheckResult[] {
  const { expect: want } = scenario;
  const executed = new Set(record.toolCalls.filter((t) => t.executed).map((t) => t.name));
  const spokenLines = new Set(record.turns.flatMap((t) => (t.role === "verbatim" ? [t.lineId] : [])));
  const agentText = record.turns.flatMap((t) => (t.role === "agent" ? [t.text.toLowerCase()] : [])).join("\n");
  const succeeded = facts.payments.filter((p) => p.status === "succeeded").length;

  const outcomes: string[] = Array.isArray(want.outcome) ? want.outcome : [want.outcome];
  const results = [
    check("outcome", record.outcome !== null && outcomes.includes(record.outcome), `expected ${outcomes.join(" or ")}, got ${record.outcome ?? "none"}`),
    ...want.mustCallTools.map((t) => check(`calls ${t}`, executed.has(t), executed.has(t) ? "called" : "never called")),
    ...want.mustNotCallTools.map((t) => check(`never calls ${t}`, !executed.has(t), executed.has(t) ? "called" : "not called")),
    ...want.mustSayVerbatim.map((id) => check(`says ${id}`, spokenLines.has(id), spokenLines.has(id) ? "said" : "never said")),
    ...want.mustNotSay.map((phrase) => {
      const said = agentText.includes(phrase.toLowerCase());
      return check(`never says "${phrase}"`, !said, said ? "said" : "not said");
    }),
  ];

  if (want.transferReason !== undefined) {
    const reasons: string[] = Array.isArray(want.transferReason) ? want.transferReason : [want.transferReason];
    const got = record.handoff?.reason;
    results.push(check("transfer reason", got !== undefined && reasons.includes(got), `expected ${reasons.join(" or ")}, got ${got ?? "none"}`));
  }

  // Invariants for every scenario: no double charge, nothing quoted or paid outside the allowed range.
  const maxPayments = want.succeededPayments ?? 1;
  const paymentsOk = want.succeededPayments === undefined ? succeeded <= maxPayments : succeeded === maxPayments;
  results.push(check("succeeded payments", paymentsOk, `${succeeded} succeeded, expected ${want.succeededPayments ?? "at most 1"}`));

  const outOfRange = [...facts.quotes, ...facts.payments].filter((q) => {
    const range = facts.allowed.get(q.loanId);
    return range === undefined || q.amountCents < range.minCents || q.amountCents > range.maxCents;
  });
  results.push(
    check(
      "amounts within the allowed range",
      outOfRange.length === 0,
      outOfRange.length === 0 ? "all in range" : `out of range: ${outOfRange.map((q) => `${q.loanId} ${q.amountCents}`).join(", ")}`,
    ),
  );

  return results;
}
