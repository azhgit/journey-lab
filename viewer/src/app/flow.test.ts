import { describe, expect, it } from "vitest";
import type { CallDetail, GateRunDetail, ToolCall, Turn } from "../../../src/viewer/types";
import { blockedFlow, flowPaths, identityFlow, paymentFlow, type BlockedRun } from "./flow";

const SPOKEN = "Your loan is current.";

const tool = (name: string, over: Partial<ToolCall> = {}): ToolCall => ({
  seq: 0,
  name,
  executed: true,
  ok: true,
  errorKind: null,
  latencyMs: 1,
  input: { loanId: "L1001" },
  result: { ok: true },
  spoken: [],
  ...over,
});

const TURNS: Turn[] = [
  { idx: 0, role: "verbatim", lineId: "greeting_disclosure", text: "Thanks for calling.", fromToolSeq: null },
  { idx: 1, role: "caller", text: "I'm on my work phone." },
  { idx: 2, role: "agent", text: "I can send a code.", latencyMs: null, spans: [] },
  { idx: 3, role: "caller", text: "Yes, please." },
  { idx: 4, role: "agent", text: "Please read me the code.", latencyMs: null, spans: [] },
  { idx: 5, role: "caller", text: "The code is [digits]." },
  { idx: 6, role: "agent", text: `Thanks. ${SPOKEN}`, latencyMs: null, spans: [] },
];

const TOOLS = [
  tool("getLoanDetails", { ok: false, errorKind: "not_owner", result: { ok: false, error: { kind: "not_owner" } } }),
  tool("sendStepUpCode", { spoken: ["A code is on the way."] }),
  tool("checkStepUpCode", { input: { code: "[digits]" }, result: { ok: true, data: { passed: true, attemptsLeft: 2 } } }),
  tool("getLoanDetails", { spoken: [SPOKEN] }),
  tool("endCall", { input: {} }),
];

// Only the fields the flow reads: the rest of a stored call does not change the path.
const callWith = (over: Partial<CallDetail> = {}) =>
  ({ identityAtStart: "caller_id", authTierFinal: 2, outcome: "resolved", turns: TURNS, toolCalls: TOOLS, ...over }) as CallDetail;

describe("identityFlow", () => {
  it("raises the tier only at the step where the code passes", () => {
    const steps = identityFlow(callWith());
    expect(steps?.map((s) => s.stamp?.text)).toEqual(["Tier 1", "Tier 1", "Tier 1", "Tier 1", "Tier 1", "Tier 1", "Tier 1", "Tier 2", "Tier 2", "Tier 2"]);
    expect(steps?.[7]?.title).toBe("The code passes: Tier 2");
  });

  it("marks the refusal as the tool's ownership check, after the tier check passed", () => {
    const steps = identityFlow(callWith());
    expect(steps?.[3]?.checks).toEqual(["tier"]);
    expect(steps?.[4]?.checks).toEqual(["ownership"]);
    expect(steps?.[4]?.evidence[0]).toMatchObject({ text: '{"ok":false,"error":{"kind":"not_owner"}}', failed: true });
  });

  it("quotes the stored result, without the wrapper, when the code passes", () => {
    const steps = identityFlow(callWith());
    expect(steps?.[7]?.evidence[1]?.text).toBe('{"passed":true,"attemptsLeft":2}');
  });

  it("keeps the model's offer in language, and draws the tool's sentence as code", () => {
    const steps = identityFlow(callWith());
    const offer = steps?.[5];
    expect(offer?.languageHops).toBe((offer?.route.length ?? 0) - 1);
    expect(steps?.[8]?.languageHops).toBe(0);
  });

  it("reaches the backend on the retried lookup as well as the refused one", () => {
    const steps = identityFlow(callWith());
    expect(steps?.[4]?.route).toContain("backend");
    expect(steps?.[8]?.route).toContain("backend");
  });

  it("sends the tool's sentence through the model before the caller hears it", () => {
    const route = identityFlow(callWith())?.[8]?.route ?? [];
    expect(route.slice(-3)).toEqual(["model", "runner", "caller"]);
  });

  it.each<[string, Partial<CallDetail>]>([
    ["no refusal", { toolCalls: [tool("getLoanDetails"), ...TOOLS.slice(1)] }],
    ["a different tool order", { toolCalls: [...TOOLS].reverse() }],
    ["a call that started unverified", { identityAtStart: "none" }],
    ["a call that never reached Tier 2", { authTierFinal: 1 }],
    ["a tool sentence the caller did not hear", { turns: TURNS.slice(0, 6) }],
    ["a call stored without its tool results", { toolCalls: [] }],
  ])("returns null for %s", (_name, over) => {
    expect(identityFlow(callWith(over))).toBeNull();
  });
});

const LOAN = "Your loan is current.";
const ACCOUNTS = "The accounts on file are First Harbor.";
const PAID = "Your payment went through.";

const PAYMENT_TURNS: Turn[] = [
  { idx: 0, role: "verbatim", lineId: "greeting_disclosure", text: "Thanks for calling.", fromToolSeq: null },
  { idx: 1, role: "caller", text: "I'd like to pay." },
  { idx: 2, role: "agent", text: `${LOAN} ${ACCOUNTS}`, latencyMs: null, spans: [] },
  { idx: 3, role: "caller", text: "First Harbor, please." },
  { idx: 4, role: "verbatim", lineId: "payment_confirmation", text: "Shall I go ahead?", fromToolSeq: 2 },
  { idx: 5, role: "caller", text: "Yes." },
  { idx: 6, role: "agent", text: PAID, latencyMs: null, spans: [] },
];

const PAYMENT_TOOLS = [
  tool("getLoanDetails", { spoken: [LOAN] }),
  tool("listLinkedAccounts", { spoken: [ACCOUNTS] }),
  tool("preparePayment", { input: { loanId: "L1001", amountCents: 21450 } }),
  tool("makePayment", { input: { quoteId: "q1" }, spoken: [PAID] }),
  tool("endCall", { input: {} }),
];

const payment = (over: Partial<CallDetail> = {}) =>
  ({ identityAtStart: "caller_id", authTierFinal: 1, outcome: "resolved", turns: PAYMENT_TURNS, toolCalls: PAYMENT_TOOLS, ...over }) as CallDetail;

describe("paymentFlow", () => {
  it("stays at Tier 1, and speaks the read-back as fixed text before the payment runs", () => {
    const steps = paymentFlow(payment());
    expect(new Set(steps?.map((s) => s.stamp?.text))).toEqual(new Set(["Tier 1"]));
    const readBack = steps?.findIndex((s) => s.evidence.some((e) => e.kind === "fixed" && e.text === "Shall I go ahead?")) ?? -1;
    const pay = steps?.findIndex((s) => s.evidence.some((e) => e.text.startsWith("makePayment"))) ?? -1;
    expect(readBack).toBeGreaterThan(0);
    expect(pay).toBeGreaterThan(readBack);
    expect(steps?.[pay]?.checks).toContain("confirm");
  });

  it.each<[string, Partial<CallDetail>]>([
    ["a failed tool", { toolCalls: [tool("getLoanDetails", { ok: false, spoken: [LOAN] }), ...PAYMENT_TOOLS.slice(1)] }],
    ["a step-up call", { authTierFinal: 2 }],
    ["no read-back", { turns: PAYMENT_TURNS.filter((t) => t.idx !== 4) }],
    ["a paraphrased result", { turns: PAYMENT_TURNS.slice(0, 6) }],
  ])("returns null for %s", (_name, over) => {
    expect(paymentFlow(payment(over))).toBeNull();
  });
});

const PROMISE = "I can set up a fifty dollar payment for you.";

const result = (i: number, over: Partial<GateRunDetail["results"][number]> = {}): GateRunDetail["results"][number] => ({
  callId: `c${i}`,
  scenarioId: `s${i % 9}`,
  safetyCritical: false,
  passed: true,
  failedChecks: [],
  outcome: "resolved",
  transferReason: null,
  judgments: [],
  ...over,
});

const FAILED = result(0, { safetyCritical: true, passed: false, failedChecks: ["judge: hallucination"] });

const run = (over: Partial<GateRunDetail> = {}) =>
  ({
    id: "gate-x",
    version: "1.0.0",
    passed: false,
    passRate: 26 / 27,
    runs: 27,
    failedRuns: 1,
    safetyFailures: 1,
    results: [FAILED, ...Array.from({ length: 26 }, (_, i) => result(i + 1))],
    ...over,
  }) as GateRunDetail;

const blockedCall = (over: Partial<CallDetail> = {}) =>
  ({
    id: "c0",
    turns: [
      { idx: 1, role: "caller", text: "I can only pay fifty dollars." },
      { idx: 2, role: "agent", text: `Your loan is current. ${PROMISE} Which account?`, latencyMs: null, spans: [] },
    ],
    toolCalls: [tool("preparePayment", { ok: false, errorKind: "invalid_amount" })],
    judgmentsFull: [{ kind: "hallucination", passed: false, reason: `A promise with no evidence.\n${PROMISE}\nA second issue.`, humanLabel: null }],
    ...over,
  }) as CallDetail;

const blocked = (runOver: Partial<GateRunDetail> = {}, callOver: Partial<CallDetail> = {}): BlockedRun => ({ run: run(runOver), call: blockedCall(callOver) });

describe("blockedFlow", () => {
  it("quotes the promise the judge flagged, and blocks only after the pass rate clears its rule", () => {
    const steps = blockedFlow(blocked());
    expect(steps?.[2]?.evidence[0]?.text).toBe(PROMISE);
    expect(steps?.[0]?.evidence[0]?.text).toContain("9 scenarios × 3");
    const rate = steps?.findIndex((s) => s.title === "The pass rate clears its rule") ?? -1;
    expect(steps?.[rate]?.stamp).toBeNull();
    expect(steps?.[rate]?.evidence[0]?.text).toBe("26 of 27 · 96.3%");
    expect(steps?.[rate + 1]?.stamp?.text).toBe("Blocked");
  });

  it("draws the judge before the code checks, as runSim runs them", () => {
    const routes = blockedFlow(blocked())?.map((s) => s.route.at(-1)) ?? [];
    expect(routes.indexOf("judge")).toBeLessThan(routes.indexOf("checks"));
  });

  it.each<[string, BlockedRun]>([
    ["a run that passed", blocked({ passed: true })],
    ["a pass rate below the rule", blocked({ passRate: 0.8 })],
    ["a failure in a code check", blocked({ results: [{ ...FAILED, failedChecks: ["outcome"] }] })],
    ["a failure that is not safety-critical", blocked({ results: [{ ...FAILED, safetyCritical: false }] })],
    ["two failed runs", blocked({ results: [FAILED, { ...FAILED, callId: "c1" }] })],
    ["a flagged sentence the agent did not say", blocked({}, { turns: [{ idx: 1, role: "caller", text: "Hi." }] })],
    ["no rejected amount", blocked({}, { toolCalls: [] })],
  ])("returns null for %s", (_name, value) => {
    expect(blockedFlow(value)).toBeNull();
  });
});

describe("flowPaths", () => {
  it("offers only the paths whose records match", () => {
    expect(flowPaths(payment(), callWith(), blocked()).map((p) => p.id)).toEqual(["payment", "identity", "blocked"]);
    expect(flowPaths(null, callWith(), null).map((p) => p.id)).toEqual(["identity"]);
    expect(flowPaths(callWith(), payment(), null)).toEqual([]);
  });
});
