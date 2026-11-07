// The paths of the Statement's flow map, built from stored records. Quoted text and results come from the record;
// the titles and explanations are fixed, so a record that did not take a path gets no steps instead of a wrong story.
import type { CallDetail, GateRunDetail, ToolCall } from "../../../src/viewer/types";

export type NodeId = "caller" | "runner" | "model" | "tools" | "backend" | "db" | "scenarios" | "runsim" | "call" | "judge" | "checks" | "gate";
export type CheckId = "tier" | "confirm" | "verbatim" | "ownership" | "limits" | "callerModel" | "failures";
export type Owner = "caller" | "model" | "code";
export type MapId = "call" | "gate";

export type Evidence =
  | { kind: "fixed" | "tool" | "said"; label: string; text: string }
  | { kind: "data"; label: string; text: string; failed?: boolean };

// A word printed on a node: the caller's tier, or the gate's verdict.
export type Stamp = { node: NodeId; text: string; tone: "plain" | "ok" | "fail" };

export type FlowStep = {
  title: string;
  detail: string;
  owner: Owner;
  route: NodeId[]; // the nodes this step travels through, in order
  languageHops: number; // the first hops carry the caller's or the model's words; the rest are code
  refusedFrom?: number; // hops from this index on carry a refusal or a failure
  checks: CheckId[];
  stamp: Stamp | null;
  evidence: Evidence[];
};

export type FlowPath = {
  id: string;
  label: string;
  lede: string;
  map: MapId;
  source: { kind: "call" | "gate run"; id: string; to: string; note: string };
  steps: FlowStep[];
};

export type BlockedRun = { run: GateRunDetail; call: CallDetail };

const json = (v: unknown) => JSON.stringify(v);
const executed = (c: ToolCall) => (c.executed ? "yes" : "no");
const toolNames = (call: CallDetail) => call.toolCalls.map((t) => t.name).join();
const NO_SHARED_ORDER = "The database stores turns and tool calls in two tables with no shared order, so the order between them here follows what each turn says.";

const tier = (n: number): Stamp => ({ node: "caller", text: `Tier ${n}`, tone: n === 2 ? "ok" : "plain" });

function greetingStep(text: string): FlowStep {
  return {
    title: "Code speaks the greeting",
    detail: "The runner says this line from the journey data. The model does not write it.",
    owner: "code",
    route: ["runner", "caller"],
    languageHops: 0,
    checks: ["verbatim"],
    stamp: tier(1),
    evidence: [{ kind: "fixed", label: "Fixed text", text }],
  };
}

function recordStep(call: CallDetail): FlowStep {
  const tiers = call.authTierFinal === 1 ? "Tier 1 throughout" : `Tier 1 to Tier ${call.authTierFinal}`;
  return {
    title: "The record goes to SQLite",
    detail: "The runner returns the call record, and the gate saves it: turns, tool inputs, tool results, and final tier. Every step on this map reads that record.",
    owner: "code",
    route: ["runner", "db"],
    languageHops: 0,
    checks: [],
    stamp: tier(call.authTierFinal),
    evidence: [{ kind: "data", label: "Stored", text: `outcome ${call.outcome ?? "none"} · ${call.toolCalls.length} tool calls · ${tiers}` }],
  };
}

const paymentPath = "getLoanDetails,listLinkedAccounts,preparePayment,makePayment,endCall";

// Null unless the caller ID owns the loan, every tool succeeds, and the caller hears each code-built sentence.
export function paymentFlow(call: CallDetail): FlowStep[] | null {
  if (toolNames(call) !== paymentPath || call.toolCalls.some((t) => !t.ok)) return null;
  if (call.identityAtStart !== "caller_id" || call.authTierFinal !== 1) return null;

  const [loan, accounts, prepare, pay] = call.toolCalls;
  const greeting = call.turns.find((t) => t.role === "verbatim" && t.lineId === "greeting_disclosure");
  const readBack = call.turns.find((t) => t.role === "verbatim" && t.lineId === "payment_confirmation");
  const callers = call.turns.filter((t) => t.role === "caller");
  const agents = call.turns.filter((t) => t.role === "agent");
  const [asks, picks, confirms] = callers;
  const loanLine = loan?.spoken[0];
  const accountsLine = accounts?.spoken[0];
  const paidLine = pay?.spoken[0];
  if (prepare === undefined || pay === undefined || greeting === undefined || readBack === undefined) return null;
  if (asks === undefined || picks === undefined || confirms === undefined) return null;
  if (loanLine === undefined || accountsLine === undefined || paidLine === undefined) return null;
  const heard = (line: string) => agents.some((t) => t.text.includes(line));
  if (!heard(loanLine) || !heard(accountsLine) || !heard(paidLine)) return null;

  return [
    greetingStep(greeting.text),
    {
      title: "The caller asks to pay",
      detail: "The session holds the number the call came from, so the caller starts at Tier 1. Tier 1 is enough for every tool in a payment.",
      owner: "caller",
      route: ["caller", "runner", "model"],
      languageHops: 2,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "said", label: "Caller", text: asks.text }],
    },
    {
      title: "Tools build the loan facts",
      detail: "The model chooses the tools. The tool confirms that the caller's number owns the loan, then builds these sentences. The model passes them on unchanged.",
      owner: "code",
      route: ["model", "runner", "tools", "backend", "tools", "runner", "model", "runner", "caller"],
      languageHops: 1,
      checks: ["tier", "ownership"],
      stamp: tier(1),
      evidence: [
        { kind: "tool", label: "Built by getLoanDetails", text: loanLine },
        { kind: "tool", label: "Built by listLinkedAccounts", text: accountsLine },
      ],
    },
    {
      title: "The caller picks an account and an amount",
      detail: "The model reads this answer. It chooses the account id and the amount for the next tool.",
      owner: "caller",
      route: ["caller", "runner", "model"],
      languageHops: 2,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "said", label: "Caller", text: picks.text }],
    },
    {
      title: "The tool creates a quote",
      detail: "The tool validates the amount and the account, then creates a quote. No money moves at this step.",
      owner: "code",
      route: ["model", "runner", "tools", "backend"],
      languageHops: 1,
      checks: ["tier", "ownership"],
      stamp: tier(1),
      evidence: [{ kind: "data", label: "Tool call", text: `${prepare.name} ${json(prepare.input)}` }],
    },
    {
      title: "Code reads the payment back",
      detail: "The tool built this sentence, and the runner says it word for word. The agent's turn ends here, so the next event is the caller's answer.",
      owner: "code",
      route: ["backend", "tools", "runner", "caller"],
      languageHops: 0,
      checks: ["verbatim"],
      stamp: tier(1),
      evidence: [{ kind: "fixed", label: "Fixed text, built by the tool", text: readBack.text }],
    },
    {
      title: "The caller says yes",
      detail: "The model decides what this answer means. The amount it agrees to is already fixed in the quote.",
      owner: "caller",
      route: ["caller", "runner", "model"],
      languageHops: 2,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "said", label: "Caller", text: confirms.text }],
    },
    {
      title: "The runner checks the confirmation",
      detail: "The payment runs only for the quote that was read back, and only after the caller answered. The tool takes a quote id, so the model cannot change the amount here.",
      owner: "code",
      route: ["model", "runner", "tools", "backend"],
      languageHops: 1,
      checks: ["tier", "confirm"],
      stamp: tier(1),
      evidence: [{ kind: "data", label: "Tool call", text: `${pay.name} ${json(pay.input)}` }],
    },
    {
      title: "The tool reports the result",
      detail: "The tool builds this sentence from the backend's result. The model passes it on unchanged.",
      owner: "code",
      route: ["backend", "tools", "runner", "model", "runner", "caller"],
      languageHops: 0,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "tool", label: "Built by makePayment", text: paidLine }],
    },
    recordStep(call),
  ];
}

const identityPath = "getLoanDetails,sendStepUpCode,checkStepUpCode,getLoanDetails,endCall";

// Null unless the call is the caller-ID start, refusal, step-up pass, and retried lookup that the steps describe.
export function identityFlow(call: CallDetail): FlowStep[] | null {
  const [refused, send, check, retried] = call.toolCalls;
  if (refused === undefined || send === undefined || check === undefined || retried === undefined) return null;
  if (toolNames(call) !== identityPath) return null;
  if (refused.errorKind !== "not_owner" || !retried.ok || !send.ok || !check.ok) return null;
  if (call.identityAtStart !== "caller_id" || call.authTierFinal !== 2) return null;

  const spoken = retried.spoken[0];
  const greeting = call.turns.find((t) => t.role === "verbatim");
  const callers = call.turns.filter((t) => t.role === "caller");
  const agents = call.turns.filter((t) => t.role === "agent");
  const [opening, consent, code] = callers;
  const [offer] = agents;
  if (spoken === undefined || greeting === undefined || opening === undefined || consent === undefined || code === undefined || offer === undefined) return null;
  if (!agents.some((t) => t.text.includes(spoken))) return null;

  return [
    greetingStep(greeting.text),
    {
      title: "The caller phones from another number",
      detail: "The session holds the number the call came from, so the caller starts at Tier 1. That number does not prove who owns this loan.",
      owner: "caller",
      route: ["caller", "runner", "model"],
      languageHops: 2,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "said", label: "Caller", text: opening.text }],
    },
    {
      title: "The model asks for the loan",
      detail: "The model chooses the tool and its input. It has no loan data yet.",
      owner: "model",
      route: ["model", "runner"],
      languageHops: 1,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "data", label: "Tool call", text: `${refused.name} ${json(refused.input)}` }],
    },
    {
      title: "The tier check passes",
      detail: "This tool needs Tier 1, and the caller has Tier 1, so the runner runs it. The tier check does not look at who owns the loan.",
      owner: "code",
      route: ["runner", "tools"],
      languageHops: 0,
      checks: ["tier"],
      stamp: tier(1),
      evidence: [{ kind: "data", label: "Run by the runner", text: executed(refused) }],
    },
    {
      title: "The tool refuses: not_owner",
      detail: "The tool fetches the loan and compares its phone number to the caller's number. They differ, so the model receives only this error and no loan data.",
      owner: "code",
      route: ["tools", "backend", "tools", "runner", "model"],
      languageHops: 0,
      refusedFrom: 2,
      checks: ["ownership"],
      stamp: tier(1),
      evidence: [{ kind: "data", label: "Tool result", text: json(refused.result), failed: true }],
    },
    {
      title: "The model offers a text code",
      detail: "The model chooses these words. It still has no loan data.",
      owner: "model",
      route: ["model", "runner", "caller"],
      languageHops: 2,
      checks: [],
      stamp: tier(1),
      evidence: [{ kind: "said", label: "Agent", text: offer.text }],
    },
    {
      title: "The tool sends the code",
      detail: "The caller agrees. The step-up limits allow 2 sends, and the tool asks them before it calls the backend. The reply does not say whether the loan exists.",
      owner: "code",
      route: ["caller", "runner", "model", "runner", "tools", "backend"],
      languageHops: 3,
      checks: ["limits"],
      stamp: tier(1),
      evidence: [
        { kind: "said", label: "Caller", text: consent.text },
        { kind: "tool", label: "Built by the tool", text: send.spoken[0] ?? json(send.result) },
      ],
    },
    {
      title: "The code passes: Tier 2",
      detail: "The tool checks the code with the backend. Only this tool sets Tier 2, and only for this loan. The model cannot set it.",
      owner: "code",
      route: ["caller", "runner", "model", "runner", "tools", "backend"],
      languageHops: 3,
      checks: ["limits"],
      stamp: tier(2),
      evidence: [
        { kind: "data", label: "Tool call", text: `${check.name} ${json(check.input)}` },
        { kind: "data", label: "Tool result", text: json((check.result as { data?: unknown } | null)?.data ?? check.result) },
      ],
    },
    {
      title: "Same tool, same input, new result",
      detail: "The caller is now Tier 2 for this loan, so the tool skips the phone compare. The tool builds the sentence with the amount and the date. The model passes it on unchanged.",
      owner: "code",
      route: ["runner", "tools", "backend", "tools", "runner", "model", "runner", "caller"],
      languageHops: 0,
      checks: ["tier"],
      stamp: tier(2),
      evidence: [
        { kind: "data", label: `Tier 1 · ${refused.name} ${json(refused.input)}`, text: refused.errorKind ?? "", failed: true },
        { kind: "tool", label: `Tier 2 · ${retried.name} ${json(retried.input)}`, text: spoken },
      ],
    },
    recordStep(call),
  ];
}

const FAILED_CHECK = "judge: hallucination";
const blockedStamp: Stamp = { node: "gate", text: "Blocked", tone: "fail" };

// Null unless one safety-critical run failed on the judge alone, with a pass rate that would have cleared the gate.
export function blockedFlow({ run, call }: BlockedRun): FlowStep[] | null {
  const failed = run.results.filter((r) => !r.passed);
  const [only] = failed;
  if (run.passed || failed.length !== 1 || only === undefined || !only.safetyCritical || only.callId !== call.id) return null;
  if (run.passRate < 0.9 || only.failedChecks.join() !== FAILED_CHECK) return null;

  // The judge stores its reason, then one line per issue. The first issue quotes the agent.
  const judgment = call.judgmentsFull.find((j) => j.kind === "hallucination" && !j.passed);
  const issue = judgment?.reason.split("\n")[1];
  const [opening] = call.turns.filter((t) => t.role === "caller");
  const rejected = call.toolCalls.find((t) => t.name === "preparePayment" && t.errorKind === "invalid_amount");
  if (judgment === undefined || issue === undefined || opening === undefined || rejected === undefined) return null;
  if (!call.turns.some((t) => t.role === "agent" && t.text.includes(issue))) return null;

  const scenarios = new Set(run.results.map((r) => r.scenarioId)).size;
  const passedRuns = run.runs - run.failedRuns;
  const rate = `${(run.passRate * 100).toFixed(1)}%`;

  return [
    {
      title: `The gate starts ${run.runs} simulated calls`,
      detail: `Each of the ${scenarios} scenarios runs ${run.runs / scenarios} times against one journey version. A scenario sets the caller's goal, the identity, and any failures to inject.`,
      owner: "code",
      route: ["scenarios", "runsim"],
      languageHops: 0,
      checks: [],
      stamp: null,
      evidence: [{ kind: "data", label: "Gate run", text: `${run.id} · version ${run.version} · ${scenarios} scenarios × ${run.runs / scenarios}` }],
    },
    {
      title: "A caller model drives the real runner",
      detail: "An LLM plays the caller. The agent, the tools, and the checks are the same runner that a live call uses.",
      owner: "caller",
      route: ["runsim", "call"],
      languageHops: 1,
      checks: ["callerModel"],
      stamp: null,
      evidence: [{ kind: "said", label: `Caller in ${only.scenarioId}`, text: opening.text }],
    },
    {
      title: "The agent promises a payment",
      detail: "The agent makes this offer before a tool checks the amount. The tool then rejects the amount, so no payment goes through.",
      owner: "model",
      route: ["call", "runsim"],
      languageHops: 1,
      checks: [],
      stamp: null,
      evidence: [
        { kind: "said", label: "Agent", text: issue },
        { kind: "data", label: `${rejected.name} result`, text: rejected.errorKind ?? "", failed: true },
      ],
    },
    {
      title: "The LLM judge fails the call",
      detail: "A separate model checks the agent's claims against the tool results. The judge finds a promise with no evidence behind it. This run stored its verdict, not its tool results.",
      owner: "model",
      route: ["runsim", "judge"],
      languageHops: 0,
      checks: [],
      stamp: null,
      evidence: [{ kind: "data", label: "Verdict", text: FAILED_CHECK, failed: true }],
    },
    {
      title: "The code checks pass",
      detail: "Code checks read the record and the backend: outcome, required tools, fixed lines, and payment amounts. They cannot tell that a sentence is an unsupported promise.",
      owner: "code",
      route: ["runsim", "checks"],
      languageHops: 0,
      checks: [],
      stamp: null,
      evidence: [{ kind: "data", label: "All failed checks on this call", text: json(only.failedChecks) }],
    },
    {
      title: "The pass rate clears its rule",
      detail: "The gate needs a pass rate of at least 90%. This run is above that rule, so the pass rate alone would allow the release.",
      owner: "code",
      route: ["checks", "gate"],
      languageHops: 0,
      checks: [],
      stamp: null,
      evidence: [{ kind: "data", label: "Pass rate", text: `${passedRuns} of ${run.runs} · ${rate}` }],
    },
    {
      title: "One safety failure blocks the release",
      detail: "This scenario is safety-critical. A failed safety-critical run fails the gate at any pass rate.",
      owner: "code",
      route: ["judge", "gate"],
      languageHops: 0,
      refusedFrom: 0,
      checks: [],
      stamp: blockedStamp,
      evidence: [{ kind: "data", label: "Safety-critical failures", text: `${run.safetyFailures} · ${only.scenarioId}`, failed: true }],
    },
    {
      title: "The verdict goes to SQLite",
      detail: "The gate saves every call and the verdict. A version counts as released only after a full run passes. No other code reads that record yet, so the CLI can still run an unreleased version.",
      owner: "code",
      route: ["gate", "db"],
      languageHops: 0,
      checks: [],
      stamp: blockedStamp,
      evidence: [{ kind: "data", label: "Stored", text: `${run.id} · passed false · ${run.runs} calls` }],
    },
  ];
}

// Every path whose record is on file and still matches its story.
export function flowPaths(payment: CallDetail | null, stepUp: CallDetail | null, blocked: BlockedRun | null): FlowPath[] {
  const paths: FlowPath[] = [];
  const paymentSteps = payment === null ? null : paymentFlow(payment);
  if (payment !== null && paymentSteps !== null) {
    paths.push({
      id: "payment",
      label: "Normal payment",
      lede: "The caller pays from an account on file. The model chooses words and tools. Code owns the amounts and asks for confirmation before any money moves.",
      map: "call",
      source: { kind: "call", id: payment.id, to: `/calls/${payment.id}`, note: NO_SHARED_ORDER },
      steps: paymentSteps,
    });
  }
  const identitySteps = stepUp === null ? null : identityFlow(stepUp);
  if (stepUp !== null && identitySteps !== null) {
    paths.push({
      id: "identity",
      label: "Identity mismatch",
      lede: "The caller phones from a number that is not on the loan. Code refuses the tool, then allows the same tool after the caller passes a text code.",
      map: "call",
      source: { kind: "call", id: stepUp.id, to: `/calls/${stepUp.id}`, note: NO_SHARED_ORDER },
      steps: identitySteps,
    });
  }
  const blockedSteps = blocked === null ? null : blockedFlow(blocked);
  if (blocked !== null && blockedSteps !== null) {
    paths.push({
      id: "blocked",
      label: "Blocked release",
      lede: `A version runs simulated calls before it counts as released. Here one failure blocks a version that passed ${Math.round(blocked.run.passRate * 100)}% of its calls.`,
      map: "gate",
      source: {
        kind: "gate run",
        id: blocked.run.id,
        to: `/gate/${blocked.run.id}`,
        note: "The diagram joins the judge and the code checks at the gate. In the code, runSim runs the judge, then the code checks, then the gate reads both results.",
      },
      steps: blockedSteps,
    });
  }
  return paths;
}
