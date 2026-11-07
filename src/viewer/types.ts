// CLAUDE-OWNED (M10). Response shapes of the viewer API (src/viewer/api.ts), shared with the React app in viewer/.
// Type-only: the browser bundle imports nothing at run time from src/.

export type Source = "sim" | "manual" | "synthetic_prod";
export type Outcome = "resolved" | "transferred" | "abandoned";
export type JudgeKind = "hallucination" | "transfer_quality";

export type JudgmentBrief = { kind: JudgeKind; passed: boolean };
export type Judgment = JudgmentBrief & { reason: string; humanLabel: boolean | null };

export type Release = {
  version: string;
  hash: string;
  firstSeen: string;
  releasedBy: string | null; // the first passing gate run for this version and hash
};

export type Summary = {
  journeyId: string;
  period: { from: string; to: string };
  calls: { total: number; bySource: Record<Source, number>; withEvidence: number };
  toolCalls: number;
  judgments: number;
  gateRuns: { total: number; passed: number };
  releases: Release[];
  versions: string[]; // every journey version with a call on record
  current: { version: string; gateRunId: string; passed: number; runs: number } | null;
};

export type GateRun = {
  id: string;
  startedAt: string;
  version: string;
  hash: string;
  passed: boolean;
  passRate: number;
  costUsd: number | null;
  runs: number;
  failedRuns: number;
  safetyFailures: number;
  releases: boolean; // this run released its version
  failedScenarios: string[]; // distinct scenario ids with at least one failed run
};

export type GateResult = {
  callId: string;
  scenarioId: string;
  safetyCritical: boolean;
  passed: boolean;
  failedChecks: string[];
  outcome: Outcome | null;
  transferReason: string | null;
  judgments: JudgmentBrief[];
};

export type GateRunDetail = GateRun & { results: GateResult[] };

export type CallSummary = {
  id: string;
  source: Source;
  version: string;
  startedAt: string;
  outcome: Outcome | null;
  transferReason: string | null;
  callerTurns: number;
  authTierFinal: number;
  csat: number | null;
  gateRunId: string | null;
  scenarioId: string | null;
  simPassed: boolean | null;
  judgments: JudgmentBrief[];
  hasEvidence: boolean; // stored with tool inputs, results, and the handoff (commit 63d45a9 and later)
};

export type CallPage = { total: number; items: CallSummary[] };

// Where a stretch of agent text came from. Matched by text: stored turns and tool calls carry no shared order.
// "unknown": the call was stored before tool results were, so there is nothing to match against.
export type Span = { text: string; from: { kind: "model" } | { kind: "unknown" } | { kind: "tool"; seq: number; name: string } };

export type Turn =
  | { idx: number; role: "caller"; text: string }
  | { idx: number; role: "agent"; text: string; latencyMs: number | null; spans: Span[] }
  | { idx: number; role: "verbatim"; lineId: string; text: string; fromToolSeq: number | null };

export type ToolCall = {
  seq: number;
  name: string;
  executed: boolean;
  ok: boolean;
  errorKind: string | null;
  latencyMs: number;
  input: unknown; // null on calls stored before the evidence columns
  result: unknown;
  spoken: string[]; // every code-built sentence in the result the model was told to say
};

export type Handoff = {
  reason: string;
  queue: string;
  authTier: number;
  verifiedBy: string;
  loanId: string | null;
  summary: string;
  summaryBy: string;
};

export type CallDetail = CallSummary & {
  endedAt: string;
  identityAtStart: string | null;
  inputTokens: number;
  outputTokens: number;
  handoff: Handoff | null;
  turns: Turn[];
  toolCalls: ToolCall[];
  judgmentsFull: Judgment[];
  failedChecks: string[];
};

// ---- live calls ----

export type LiveCustomer = { name: string; phone: string; loans: { id: string; status: string }[] };

export type LiveOptions = {
  customers: LiveCustomer[];
  flags: string[];
  channels: string[];
  arms: { arm: "stable" | "candidate"; version: string }[];
  model: string;
  modelAvailable: boolean; // ANTHROPIC_API_KEY is set
};

export type LiveStart = {
  phone: string | null;
  channel: "chat" | "voice";
  flags: string[];
  arm: "stable" | "candidate";
};

// One caller turn and what the runner did for it, in order: exact for live calls.
export type LiveStep = {
  caller: string | null; // null for the opening
  toolSeqs: number[];
  utterances: ({ kind: "agent"; text: string; spans: Span[] } | { kind: "verbatim"; lineId: string; text: string })[];
};

export type LiveCall = {
  id: string;
  version: string;
  arm: "stable" | "candidate";
  channel: string;
  identity: string;
  flags: string[];
  ended: boolean;
  outcome: Outcome | null;
  endReason: string | null;
  steps: LiveStep[];
  toolCalls: ToolCall[];
  guardrailEvents: { kind: string; action: string }[];
  handoff: Handoff | null;
  textMessages: string[]; // the fake SMS: codes the backend would have texted
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  saved: boolean;
};

// The incident drill (docs/incident-drill.md): synthetic production calls split by journey version.
export type IncidentArm = {
  version: string;
  calls: number;
  transferred: number;
  containment: number; // share not transferred
  reasons: { reason: string; calls: number }[];
  transferredCallIds: string[];
};

export type ApiError = { error: { code: string; message: string } };
