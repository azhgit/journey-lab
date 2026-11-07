// CLAUDE-OWNED (M6). The agent loop. SPEC §8.5 and §18.1 (Q6, Q7, Q8, Q10, Q14).
// The model chooses words and tool calls. Code owns everything else: which tools exist, tiers, verbatim
// lines, the confirmation rule, guardrails, when to transfer, and the handoff fields a human relies on.
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { STEP_UP_TOOLS, type AuthTier, type ToolName } from "../tools/catalog.js";
import type { LoanStatus, Session, ToolFailure } from "../tools/context.js";
import { getLoanDetails } from "../tools/loans.js";
import type { Article } from "../tools/searchKnowledge.js";
import { spokenDate } from "../tools/spoken.js";
import { composeSystemPrompt, identityLine, type ChannelName } from "./prompt.js";
import { effectiveTier, type HandoffReason, type Journey } from "./schema.js";
import { anthropicTools, createToolDefs, isRunnerTool, TransferInput, type PreparedCall } from "./tools.js";

// ---- the model port: anthropic.ts adapts the SDK to this; tests use a scripted fake ----

export type ModelRequest = {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
};
export type ModelReply = {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.StopReason | null;
  usage: Usage;
};
// Input tokens split by price: uncached, written to cache (~1.25x), read from cache (~0.1x).
export type Usage = { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number };
export type Model = (req: ModelRequest) => Promise<ModelReply>;

// ---- what the runner hands back ----

export type Utterance = { kind: "agent"; text: string } | { kind: "verbatim"; lineId: string; text: string };
export type TurnOutput = { utterances: Utterance[]; ended: boolean };

export type HandoffReasonName = z.infer<typeof HandoffReason>;

// Q8. Every field except `summary` is filled by code, so the human agent can trust it.
export type HandoffPayload = {
  callId: string;
  journeyId: string;
  journeyVersion: string;
  reason: HandoffReasonName;
  queue: string;
  authTier: AuthTier;
  verifiedBy: "caller_id" | "step_up" | "none";
  loanId: string | null;
  summary: string;
  summaryBy: "model" | "code" | "model_and_code"; // model_and_code: a model narrative plus code-stated facts
};

export type EndReason = "transfer" | "end_call" | "caller_hangup" | "max_turns";
export type Outcome = "resolved" | "transferred" | "abandoned";

export type ToolLogEntry = {
  name: string;
  input: unknown; // as the model sent it
  result: string; // the JSON the model got back: the evidence the judge checks claims against
  executed: boolean; // false: the runner blocked it (unknown tool, bad input, tier, confirmation)
  ok: boolean;
  errorKind: string | null;
  latencyMs: number;
};
export type TurnLogEntry =
  | { role: "caller"; text: string }
  | { role: "agent"; text: string; latencyMs: number }
  | { role: "verbatim"; lineId: string; text: string };
export type GuardrailEvent = { kind: "never_say" | "amount_from_code_only"; action: "rewrite" | "fallback" };

export type CallRecord = {
  callId: string;
  journeyId: string;
  journeyVersion: string;
  channel: ChannelName;
  startedAt: string;
  identityAtStart: "caller_id" | "none"; // Tier 1 from verified caller ID, or nothing
  endReason: EndReason | null;
  outcome: Outcome | null; // decided by code from how the call ended, never by the model
  handoff: HandoffPayload | null;
  authTierFinal: AuthTier;
  callerTurns: number;
  turns: TurnLogEntry[];
  toolCalls: ToolLogEntry[];
  guardrailEvents: GuardrailEvent[];
  usage: Usage;
};

export type Call = {
  open(): Promise<TurnOutput>; // static on_start lines; no model call
  say(callerText: string): Promise<TurnOutput>;
  hangUp(): void;
  record(): CallRecord;
};

export type CallOptions = {
  journey: Journey;
  channel: ChannelName;
  session: Session;
  model: Model;
  articles: Article[];
  callId?: string;
  maxCallerTurns?: number;
  signal?: AbortSignal; // cancels the model request; rethrown, never turned into a transfer
  clock?: () => number; // for latency only
  log?: (event: CallEvent) => void; // structured events (SPEC §11); src/lib/logger.ts writes them as JSON lines
};

// Omit applied to each union member separately, so `event` still narrows the other fields. A conditional type
// distributes only over a naked type parameter (T here), which is why this needs to be generic.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// One log line per event, always with the call and journey version, so any log tool can group by version.
export type CallEvent = { callId: string; journeyId: string; journeyVersion: string; tier: AuthTier } & (
  | { event: "call_started"; channel: ChannelName }
  | { event: "turn"; latencyMs: number }
  | { event: "tool"; tool: string; executed: boolean; ok: boolean; errorKind: string | null; latencyMs: number }
  | { event: "guardrail"; kind: GuardrailEvent["kind"]; action: GuardrailEvent["action"] }
  | { event: "call_ended"; endReason: EndReason; outcome: Outcome | null; transferReason: string | null }
);

export const MAX_CALLER_TURNS = 20;
export const MAX_MODEL_STEPS_PER_TURN = 8;
export const FALLBACK_LINE = "I'm sorry, I can't help with that here. Is there anything else I can do for you today?";

// Any amount in digits ("$214.50", "214 dollars"): amounts must come from a tool's spoken text.
const DIGIT_AMOUNT = /\$\s?\d|\b\d[\d,.]*\s*(?:dollars?|cents?)\b/i;

// A failure after which the payment may or may not exist. Re-quoting would mint a new idempotency key
// and could charge twice (M3 risk), so the runner transfers instead of letting the model try again.
const MONEY_MOVING: readonly ToolName[] = ["makePayment"];
function isAmbiguous(f: ToolFailure): boolean {
  return f.kind === "timeout" || f.kind === "network" || f.kind === "invalid_response" || (f.kind === "http" && f.status >= 500);
}

type ToolResultBlock = Anthropic.ToolResultBlockParam;

const textOf = (content: Anthropic.ContentBlock[]): string =>
  content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();

// Why the runner refused to run a tool call. Sent to the model as the tool result.
type Blocked =
  | { kind: "unknown_tool" }
  | { kind: "invalid_input"; message: string }
  | { kind: "auth_required"; requiredTier: AuthTier }
  | { kind: "confirmation_required"; message: string };
type Violation = { kind: GuardrailEvent["kind"]; note: string };

export function createCall(opts: CallOptions): Call {
  const { journey, channel, session, model } = opts;
  const clock = opts.clock ?? (() => performance.now());
  const maxCallerTurns = opts.maxCallerTurns ?? MAX_CALLER_TURNS;
  const defs = createToolDefs(opts.articles);
  const listed = new Set<string>(journey.tools.map((t) => (typeof t === "string" ? t : t.name)));
  const today = spokenDate(new Date(session.now()).toISOString());
  const system = composeSystemPrompt(journey, channel, today, identityLine(session.verifiedPhone !== null));
  const tools = anthropicTools(journey, defs);
  const neverSay = journey.guardrails.flatMap((g) => (g.kind === "never_say" ? [new RegExp(g.pattern, "i")] : []));
  const amountsFromCode = journey.guardrails.some((g) => g.kind === "amount_from_code_only");
  const confirmations = journey.guardrails.flatMap((g) => (g.kind === "require_confirmation" ? [g] : []));
  const hasLoanLines = journey.verbatim.some((v) => v.when === "on_loan_identified");

  const messages: Anthropic.MessageParam[] = [];
  let pendingResults: ToolResultBlock[] = []; // sent with the next caller turn (after a read-back)
  const spokenLines = new Set<string>();
  const identifiedLoans = new Set<string>();
  let loanStatus: LoanStatus | null = null;
  let currentLoanId: string | null = null;
  let lastReadBack: { tool: string; quoteId: string; atCallerTurn: number } | null = null;

  const record: CallRecord = {
    callId: opts.callId ?? session.id,
    journeyId: journey.id,
    journeyVersion: journey.version,
    channel,
    startedAt: new Date(session.now()).toISOString(),
    identityAtStart: session.verifiedPhone !== null ? "caller_id" : "none",
    endReason: null,
    outcome: null,
    handoff: null,
    authTierFinal: 0,
    callerTurns: 0,
    turns: [],
    toolCalls: [],
    guardrailEvents: [],
    usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  };

  // ---- identity ----

  function tierFor(loanId: string | null): AuthTier {
    const stepUp = session.stepUpVerifiedLoanId;
    if (stepUp !== null && (loanId === null || loanId === stepUp)) return 2;
    return session.verifiedPhone !== null ? 1 : 0;
  }

  // makePayment carries a quote id, not a loan id; the quote knows its loan.
  function loanOf(call: PreparedCall): string | null {
    if (call.loanId !== null) return call.loanId;
    return [...session.quotes.values()].find((q) => q.id === call.quoteId)?.loanId ?? null;
  }

  // ---- verbatim lines (Q4–Q6, Q12) ----

  type Line = Journey["verbatim"][number];

  function conditionHolds(line: Line): boolean {
    if (line.condition === undefined) return true;
    switch (line.condition) {
      case "loan_past_due":
        return loanStatus === "past_due";
      default: {
        const unreachable: never = line.condition;
        return unreachable;
      }
    }
  }

  function staticText(text: string | Partial<Record<ChannelName, string>>): string {
    if (typeof text === "string") return text;
    const forChannel = text[channel];
    if (forChannel === undefined) throw new Error(`unreachable: parseJourney checks channel coverage (${channel})`);
    return forChannel;
  }

  function speak(out: Utterance[], lineId: string, text: string): void {
    out.push({ kind: "verbatim", lineId, text });
    record.turns.push({ role: "verbatim", lineId, text });
    spokenLines.add(lineId);
  }

  // Static lines are said once per call; a tool_spoken line is said every time (each quote is new).
  function speakStatic(out: Utterance[], lines: Line[]): void {
    for (const line of lines) {
      if (line.source.kind !== "static" || spokenLines.has(line.id) || !conditionHolds(line)) continue;
      speak(out, line.id, staticText(line.source.text));
    }
  }

  const linesWhen = (when: Line["when"], tool?: string): Line[] =>
    journey.verbatim.filter((v) => v.when === when && (tool === undefined || ("tool" in v && v.tool === tool)));

  // ---- ending ----

  type EventBody = DistributiveOmit<CallEvent, "callId" | "journeyId" | "journeyVersion" | "tier">;

  function emit(body: EventBody): void {
    const base = { callId: record.callId, journeyId: journey.id, journeyVersion: journey.version, tier: tierFor(currentLoanId) };
    opts.log?.({ ...base, ...body } as CallEvent); // safe: base supplies exactly the omitted fields
  }

  // Logged once, when the call has fully ended (after a code-written handoff summary is finished).
  let endLogged = false;
  function logEndOnce(): void {
    if (record.endReason === null || endLogged) return;
    endLogged = true;
    emit({ event: "call_ended", endReason: record.endReason, outcome: record.outcome, transferReason: record.handoff?.reason ?? null });
  }

  function end(reason: EndReason): void {
    record.endReason = reason;
    record.outcome = reason === "transfer" ? "transferred" : reason === "max_turns" ? "abandoned" : "resolved";
    record.authTierFinal = tierFor(currentLoanId);
  }

  // ---- handoff summary when code transfers on its own ----
  // Code states the facts it owns; the model, which heard the call, adds what the caller wanted. Each part is
  // labelled, so the human knows which is generated. If the model is the thing that failed, or fails again,
  // the summary is code only, with the caller's words quoted rather than paraphrased.

  function codeFacts(headline: string): string {
    const tools = record.toolCalls.map(
      (t) => `${t.name} ${t.executed ? (t.ok ? "completed" : `failed (${t.errorKind})`) : `blocked (${t.errorKind})`}`,
    );
    const tier = tierFor(currentLoanId);
    return [
      headline,
      `Tools: ${tools.length > 0 ? tools.join(", ") : "none"}.`,
      tier === 0 ? "Caller is not verified; no account details were shared." : `Caller is verified at Tier ${tier}.`,
    ].join(" ");
  }

  function codeSummary(headline: string): string {
    const said = record.turns.flatMap((t) => (t.role === "caller" ? [`"${t.text.slice(0, 160)}"`] : []));
    return `${codeFacts(headline)} Caller said: ${said.join(" / ")}.`;
  }

  async function summaryForHuman(headline: string): Promise<Pick<HandoffPayload, "summary" | "summaryBy">> {
    if (record.handoff?.reason === "agent_error") return { summary: codeSummary(headline), summaryBy: "code" };
    const request =
      `The system is transferring this call to a human agent because: ${headline} ` +
      "Write the summary the human agent reads before answering: what the customer wanted, what was done or tried, " +
      "and what failed. Plain text, at most three sentences. State only what the customer said or a tool returned. Do not call tools.";
    try {
      const reply = await model({
        system,
        tools,
        signal: opts.signal,
        messages: [
          ...messages,
          // Every tool_use needs its tool_result before anything else is said.
          { role: "user", content: [...pendingResults, { type: "text", text: "(The call is being transferred.)" }] },
          { role: "system", content: request },
        ],
      });
      for (const key of ["inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens"] as const) {
        record.usage[key] += reply.usage[key];
      }
      const narrative = textOf(reply.content);
      if (reply.stopReason !== "end_turn" || narrative === "") throw new Error("no usable summary");
      return { summary: `${narrative} [System facts: ${codeFacts(headline)}]`, summaryBy: "model_and_code" };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      return { summary: codeSummary(headline), summaryBy: "code" };
    }
  }

  // Set when code transfers; the summary is written when the turn ends, after the tool that caused the transfer
  // is logged. The payload leaves for the contact center only then.
  let codeHeadline: string | null = null;

  function transfer(out: Utterance[], reason: HandoffReasonName, summary: string, summaryBy: "model" | "code"): void {
    if (summaryBy === "code") codeHeadline = summary;
    record.handoff = {
      callId: record.callId,
      journeyId: journey.id,
      journeyVersion: journey.version,
      reason,
      queue: journey.handoff.routes[reason] ?? journey.handoff.defaultQueue,
      authTier: tierFor(currentLoanId),
      verifiedBy: session.stepUpVerifiedLoanId !== null ? "step_up" : session.verifiedPhone !== null ? "caller_id" : "none",
      loanId: currentLoanId,
      summary,
      summaryBy,
    };
    speakStatic(out, linesWhen("on_transfer"));
    end("transfer");
  }

  // ---- guardrails (Q10) ----

  function checkText(text: string): Violation | null {
    const hit = neverSay.find((re) => re.test(text));
    if (hit !== undefined) {
      return { kind: "never_say", note: `it matched the blocked pattern ${String(hit)}. Say only what a tool result or article supports.` };
    }
    if (amountsFromCode && DIGIT_AMOUNT.test(text)) {
      return { kind: "amount_from_code_only", note: "it stated an amount in digits. Say amounts only as written in a tool's spoken text." };
    }
    return null;
  }

  // ---- tools ----

  // What happened to one tool call. runTool() turns it into the tool_result and the log entry, so every
  // path is logged the same way.
  type ToolOutcome =
    | { ok: true; body: object; executed: true; endTurn: boolean }
    | { ok: false; error: { kind: string }; executed: boolean; endTurn: boolean };

  const blocked = (error: Blocked): ToolOutcome => ({ ok: false, error, executed: false, endTurn: false });
  const failed = (error: { kind: string }, endTurn = false): ToolOutcome => ({ ok: false, error, executed: true, endTurn });
  const succeeded = (body: object, endTurn = false): ToolOutcome => ({ ok: true, body, executed: true, endTurn });

  async function runTool(out: Utterance[], use: Anthropic.ToolUseBlock): Promise<{ block: ToolResultBlock; endTurn: boolean }> {
    const started = clock();
    const outcome = await decideTool(out, use);
    const body = outcome.ok ? { ok: true, ...outcome.body } : { ok: false, error: outcome.error };
    const block: ToolResultBlock = { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(body), is_error: !outcome.ok };
    const entry: ToolLogEntry = {
      name: use.name,
      input: use.input,
      result: JSON.stringify(body),
      executed: outcome.executed,
      ok: outcome.ok,
      errorKind: outcome.ok ? null : outcome.error.kind,
      latencyMs: Math.round(clock() - started),
    };
    record.toolCalls.push(entry);
    const { name: tool, executed, ok, errorKind, latencyMs } = entry;
    emit({ event: "tool", tool, executed, ok, errorKind, latencyMs });
    return { block, endTurn: outcome.endTurn };
  }

  // Q6: before the first tool that touches a loan, look its status up in code and say matching lines.
  // Returns false when the lookup failed for a reason other than identity: the call fails closed.
  async function identifyLoan(out: Utterance[], loanId: string): Promise<boolean> {
    const res = await getLoanDetails(session, { loanId });
    if (!res.ok) {
      // Not this caller's loan: say nothing, and let the tool itself fail the same way.
      return res.error.kind === "unverified" || res.error.kind === "not_owner" || res.error.kind === "not_found";
    }
    identifiedLoans.add(loanId);
    loanStatus = res.data.data.status;
    speakStatic(out, linesWhen("on_loan_identified"));
    return true;
  }

  async function decideTool(out: Utterance[], use: Anthropic.ToolUseBlock): Promise<ToolOutcome> {
    if (use.name === "transferToHuman") {
      const input = TransferInput.safeParse(use.input);
      if (!input.success) return blocked({ kind: "invalid_input", message: input.error.message });
      transfer(out, input.data.reason, input.data.summary, "model");
      return succeeded({}, true);
    }
    if (use.name === "endCall") {
      end("end_call");
      return succeeded({}, true);
    }

    // Only the journey's tools exist for this call, whatever the model asks for.
    if (isRunnerTool(use.name) || !listed.has(use.name)) return blocked({ kind: "unknown_tool" });
    const name = use.name as ToolName; // safe: `listed` holds only ToolName values from the parsed journey
    const prepared = defs[name].prepare(use.input);
    if (!prepared.ok) return blocked({ kind: "invalid_input", message: prepared.error });
    const call = prepared.data;
    const loanId = loanOf(call);

    // SPEC §5: a tool above the session's tier is never run, whatever the model believes.
    const requiredTier = effectiveTier(journey, name);
    if (tierFor(loanId) < requiredTier) return blocked({ kind: "auth_required", requiredTier });

    // Q7: confirm only the quote whose read-back was spoken last, and only after the caller replied to it.
    // (Ending the turn at the read-back already forces the reply; the turn check keeps the rule true
    // even if that flow changes.)
    for (const g of confirmations.filter((c) => c.tool === name)) {
      const confirmed =
        lastReadBack !== null &&
        lastReadBack.tool === g.readBack &&
        lastReadBack.quoteId === call.quoteId &&
        record.callerTurns > lastReadBack.atCallerTurn;
      if (!confirmed) {
        return blocked({
          kind: "confirmation_required",
          message: `Call ${g.readBack} first; the system reads it back and the customer must answer before ${name}.`,
        });
      }
    }

    if (hasLoanLines && loanId !== null && !identifiedLoans.has(loanId) && !STEP_UP_TOOLS.some((t) => t === name)) {
      if (!(await identifyLoan(out, loanId))) {
        transfer(out, "tool_failure", "Could not check the loan's status before continuing, so required notices could not be given.", "code");
        return { ok: false, error: { kind: "loan_lookup_failed" }, executed: false, endTurn: true };
      }
    }

    speakStatic(out, linesWhen("before_tool", name));
    const res = await call.run(session);

    if (!res.ok) {
      if (res.error.kind === "step_up_transfer") {
        // An SMS outage is our failure, not a suspicious caller: it must not land in a fraud queue.
        const reason = res.error.reason === "sms_unavailable" ? "tool_failure" : "step_up_failed";
        transfer(out, reason, `Identity check by text code did not complete (${res.error.reason}).`, "code");
        return failed(res.error, true);
      }
      if (MONEY_MOVING.includes(name) && isAmbiguous(res.error)) {
        transfer(out, "tool_failure", `Payment status unknown after a ${res.error.kind} error on quote ${call.quoteId ?? "?"}. Check for a posted payment before taking another.`, "code");
        return failed(res.error, true);
      }
      return failed(res.error);
    }

    if (loanId !== null) currentLoanId = loanId;
    const { data, spoken } = res.data;
    speakStatic(out, linesWhen("after_tool", name));
    const readBack = linesWhen("after_tool", name).find((v) => v.source.kind === "tool_spoken" && conditionHolds(v));
    if (readBack === undefined) return succeeded(spoken === "" ? { data } : { spoken, data });

    // Code speaks the read-back word for word. If it is a confirmation question, the agent's turn ends
    // here: the next thing that happens is the caller's answer.
    speak(out, readBack.id, spoken);
    const awaitsAnswer = confirmations.some((g) => g.readBack === name);
    const quoteId = typeof data === "object" && data !== null && "quoteId" in data && typeof data.quoteId === "string" ? data.quoteId : null;
    if (awaitsAnswer && quoteId !== null) lastReadBack = { tool: name, quoteId, atCallerTurn: record.callerTurns };
    const note = awaitsAnswer
      ? "The system has already read this to the customer and asked them to confirm. Wait for their answer; do not repeat it."
      : "The system has already said this to the customer; do not repeat it.";
    return succeeded({ data, spokenToCustomer: spoken, note }, awaitsAnswer);
  }

  // ---- the loop for one caller turn ----

  async function agentTurn(out: Utterance[]): Promise<void> {
    const started = clock();
    let rewriteUsed = false;

    for (let step = 0; step < MAX_MODEL_STEPS_PER_TURN; step += 1) {
      let reply: ModelReply;
      try {
        reply = await model({ system, tools, messages, signal: opts.signal });
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        transfer(out, "agent_error", "The assistant had a technical problem and could not continue.", "code");
        return;
      }
      for (const key of ["inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens"] as const) {
        record.usage[key] += reply.usage[key];
      }

      switch (reply.stopReason) {
        case "end_turn":
        case "tool_use":
          break;
        case "max_tokens": // a cut-off reply or tool input cannot be trusted
        case "refusal":
        case "pause_turn": // only server tools pause; this agent has none
        case "stop_sequence":
        case "model_context_window_exceeded":
        case null:
          transfer(out, "agent_error", `The assistant stopped unexpectedly (${reply.stopReason ?? "no reason"}).`, "code");
          return;
        default: {
          const unreachable: never = reply.stopReason;
          return unreachable;
        }
      }

      const text = textOf(reply.content);
      const violation = checkText(text);
      if (violation !== null) {
        // The blocked reply is never sent and never added to history (history stays append-only).
        if (!rewriteUsed) {
          rewriteUsed = true;
          record.guardrailEvents.push({ kind: violation.kind, action: "rewrite" });
          emit({ event: "guardrail", kind: violation.kind, action: "rewrite" });
          messages.push({ role: "system", content: `Your last reply was not sent to the customer because ${violation.note} Write it again.` });
          continue;
        }
        record.guardrailEvents.push({ kind: violation.kind, action: "fallback" });
        emit({ event: "guardrail", kind: violation.kind, action: "fallback" });
        messages.push({ role: "assistant", content: FALLBACK_LINE });
        out.push({ kind: "agent", text: FALLBACK_LINE });
        record.turns.push({ role: "agent", text: FALLBACK_LINE, latencyMs: Math.round(clock() - started) });
        return;
      }

      messages.push({ role: "assistant", content: reply.content });
      if (text !== "") {
        out.push({ kind: "agent", text });
        record.turns.push({ role: "agent", text, latencyMs: Math.round(clock() - started) });
      }

      const uses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) return;

      // Every tool_use gets a tool_result, even ones skipped because an earlier one ended the turn.
      const results: ToolResultBlock[] = [];
      let endTurn = false;
      for (const use of uses) {
        if (endTurn) {
          const body = { ok: false, error: { kind: "not_run", message: "An earlier call in this turn ended it." } };
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(body), is_error: true });
          continue;
        }
        const r = await runTool(out, use);
        results.push(r.block);
        endTurn = r.endTurn;
      }
      if (record.endReason !== null || endTurn) {
        pendingResults = results;
        return;
      }
      messages.push({ role: "user", content: results });
    }
    transfer(out, "agent_error", "The assistant did not finish its reply.", "code");
  }

  return {
    async open() {
      const out: Utterance[] = [];
      emit({ event: "call_started", channel });
      speakStatic(out, linesWhen("on_start"));
      return { utterances: out, ended: false };
    },

    async say(callerText) {
      if (record.endReason !== null) throw new Error("the call has ended");
      const out: Utterance[] = [];
      record.callerTurns += 1;
      record.turns.push({ role: "caller", text: callerText });
      if (record.callerTurns > maxCallerTurns) {
        end("max_turns");
        logEndOnce();
        return { utterances: out, ended: true };
      }
      const started = clock();
      // Tool results must come first in the user message, before the caller's words.
      messages.push({ role: "user", content: [...pendingResults, { type: "text", text: callerText }] });
      pendingResults = [];
      await agentTurn(out);
      if (record.handoff !== null && codeHeadline !== null) {
        record.handoff = { ...record.handoff, ...(await summaryForHuman(codeHeadline)) };
        codeHeadline = null;
      }
      emit({ event: "turn", latencyMs: Math.round(clock() - started) });
      logEndOnce();
      return { utterances: out, ended: record.endReason !== null };
    },

    hangUp() {
      if (record.endReason === null) end("caller_hangup");
      logEndOnce();
    },

    record: () => structuredClone(record),
  };
}
