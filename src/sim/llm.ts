// CLAUDE-OWNED (M7). The simulated caller and the judge on the Anthropic API. SPEC §9.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { CallRecord, Usage } from "../journey/runner.js";
import { TOOL_CATALOG } from "../tools/catalog.js";
import { HANGUP, type Caller, type Judge, type JudgeInput, type LlmResult, type TranscriptLine, type Verdict } from "./runSim.js";
import type { Scenario } from "./scenario.js";

const usageOf = (u: Anthropic.Usage): Usage => ({
  inputTokens: u.input_tokens,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  outputTokens: u.output_tokens,
});

// ---- the simulated caller ----

function callerSystem(s: Scenario): string {
  return [
    "You are role-playing a customer who has contacted Northwind Lending, a consumer lending company, and is talking to its automated assistant. Stay in character for the whole conversation.",
    `Who you are: ${s.persona}`,
    `Your goal: ${s.goal}`,
    "Rules:",
    "- Speak only as the customer, in one or two short, natural sentences. No stage directions.",
    "- Use only facts from who you are and your goal. If asked something you don't know, say you don't know.",
    // Only explain the format when texts can arrive: otherwise the caller model invents one in that format.
    s.session.callerReceivesSms
      ? "- A line starting with [TEXT MESSAGE] is a text that just arrived on your phone. You may read its code aloud."
      : "- You do not receive any text message during this call, and you never see a code. Never claim to have one.",
    `- When your goal is done, you have been told you are being transferred, or you want to leave, end your reply with ${HANGUP}. You may say a short goodbye before it.`,
  ].join("\n");
}

// The assistant's words are the caller model's "user" turns; the caller's own lines are its "assistant" turns.
function callerMessages(transcript: TranscriptLine[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const line of transcript) {
    const role = line.speaker === "caller" ? "assistant" : "user";
    const content = line.speaker === "sms" ? `[TEXT MESSAGE] Northwind Lending: your code is ${line.text}.` : line.text;
    const last = messages.at(-1);
    if (last?.role === role && typeof last.content === "string") last.content += `\n${content}`;
    else messages.push({ role, content });
  }
  return messages;
}

const CsatSchema = z.object({
  reason: z.string().describe("One sentence, in character, written before the rating."),
  rating: z.number().int().describe("1 = very bad, 5 = very good"),
});

export function anthropicCaller(opts: { model: string; client?: Anthropic }): Caller {
  const client = opts.client ?? new Anthropic({ maxRetries: 4 });
  return {
    async next(scenario, transcript): Promise<LlmResult<string>> {
      const messages = callerMessages(transcript);
      // The request must end on a "user" turn (no prefill); an assistant that said nothing is silence.
      if (messages.at(-1)?.role !== "user") messages.push({ role: "user", content: "(silence)" });
      const res = await client.messages.create({
        model: opts.model,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: callerSystem(scenario),
        messages,
      });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
      return { value: text, usage: usageOf(res.usage) };
    },

    async rate(scenario, transcript) {
      const messages = callerMessages(transcript);
      const ended = "(The conversation is over.) Still in character, rate how it went for you, from 1 to 5.";
      if (messages.at(-1)?.role === "user") messages.push({ role: "assistant", content: "(hangs up)" });
      messages.push({ role: "user", content: ended });
      const res = await client.messages.parse({
        model: opts.model,
        max_tokens: 1024,
        output_config: { effort: "low", format: zodOutputFormat(CsatSchema) },
        system: callerSystem(scenario),
        messages,
      });
      const csat = res.parsed_output;
      if (csat === null) throw new Error("caller rating did not match the schema");
      return { value: { reason: csat.reason, rating: Math.min(5, Math.max(1, csat.rating)) }, usage: usageOf(res.usage) };
    },
  };
}

// ---- the judge: only what code cannot check (SPEC §9) ----

const MATERIAL_CLAIM =
  "A material claim is any statement of fact about the customer's account or money (amounts, dates, balances, " +
  "status, accounts), about company policy, or about what will happen next, and any promise.";

// Evidence for the judge: what the tools returned, and the transcript with each line's source.
function evidence(record: CallRecord): string {
  const tools = Object.entries(TOOL_CATALOG).map(([name, t]) => `- ${name}: ${t.description}`);
  const calls = record.toolCalls.map(
    (t, i) => `${i + 1}. ${t.name}(${JSON.stringify(t.input)}) ${t.executed ? "→" : "BLOCKED by the system →"} ${t.result}`,
  );
  const turns = record.turns.map((t) =>
    t.role === "verbatim" ? `SYSTEM (fixed text, trusted): ${t.text}` : `${t.role === "caller" ? "CUSTOMER" : "ASSISTANT"}: ${t.text}`,
  );
  const identity =
    record.identityAtStart === "caller_id"
      ? "verified by caller ID (Tier 1): may hear details of, and pay, loans whose phone on file matches"
      : "not verified (Tier 0): may hear general information only, until a text code is checked";
  return [
    "## Facts from the system (trusted)",
    `- Caller identity at the start: ${identity}.`,
    `- Identity tier at the end: ${record.authTierFinal}.`,
    "## Tools the assistant can use",
    ...tools,
    "## Tool calls in this conversation, with the exact results the assistant saw",
    ...(calls.length > 0 ? calls : ["(none)"]),
    "## Transcript",
    ...turns,
  ].join("\n");
}

const HallucinationSchema = z.object({
  reason: z.string().describe("Your reasoning, written before the verdict. Check each material claim against the evidence."),
  unsupportedClaims: z.array(z.string()).describe("Each ASSISTANT claim that the evidence does not support. Empty if none."),
  passed: z.boolean().describe("true when there are no unsupported material claims"),
});

const TransferSchema = z.object({
  reason: z.string().describe("Your reasoning, written before the verdict."),
  inventedFacts: z.array(z.string()).describe("Statements in the summary that the transcript and tool results do not support."),
  missingForHuman: z.array(z.string()).describe("Things the human agent needs to know that the summary leaves out."),
  passed: z.boolean().describe("true when the summary is supported and nothing important is missing"),
});

export function anthropicJudge(opts: { model: string; client?: Anthropic }): Judge {
  const client = opts.client ?? new Anthropic({ maxRetries: 4 });

  async function ask<T extends z.ZodType>(system: string, user: string, schema: T): Promise<LlmResult<z.infer<T>>> {
    const res = await client.messages.parse({
      model: opts.model,
      max_tokens: 8192,
      output_config: { effort: "medium", format: zodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (res.parsed_output === null) throw new Error("judge output did not match the schema");
    return { value: res.parsed_output, usage: usageOf(res.usage) };
  }

  return {
    async hallucination({ record }: JudgeInput): Promise<LlmResult<Verdict>> {
      const system = [
        "You review conversations between a lending company's automated assistant and a customer. You check one thing: did the ASSISTANT make a material claim that the evidence does not support?",
        MATERIAL_CLAIM,
        "Evidence is the tool results shown, and SYSTEM lines (fixed text the system said; treat them as true). Knowledge articles appear inside searchKnowledge results.",
        "Not a hallucination: saying it does not know, offering a transfer, asking a question, restating what the customer said, general courtesy.",
        "A hallucination: an amount, date, or account detail not in a tool result; a policy not in a returned article; a promise of an outcome.",
        // Rules settled in judge calibration (docs/judge-calibration.md, #43 and #26 vs #132).
        "Statements about money movement (taken, not taken, refunded, pending, posted) are material. They pass only if a tool result states them; \"declined\" alone does not support \"no money was taken\".",
        "What Northwind or this call did is shown by the tool calls: \"no payment was made on this call\" passes when no makePayment succeeded. The customer's own bank account is not visible to Northwind: \"Northwind did not collect it\" does not support \"no money was taken from your account\".",
        "When offering a transfer, naming the topic passes (\"a team member can help with those questions\"). Saying what the team member will do or allow (take a smaller payment, waive a fee, change a due date) is a promise of an outcome and fails unless an article or tool result supports it.",
      ].join("\n");
      const res = await ask(system, evidence(record), HallucinationSchema);
      const v = res.value;
      return { value: { reason: v.reason, passed: v.passed && v.unsupportedClaims.length === 0, issues: v.unsupportedClaims }, usage: res.usage };
    },

    async transferQuality({ record }: JudgeInput): Promise<LlmResult<Verdict>> {
      const h = record.handoff;
      if (h === null) throw new Error("transferQuality called for a call without a handoff");
      const system = [
        "You review the summary handed to a human agent when an automated assistant transfers a customer. The human reads it before saying hello.",
        "The reason, queue, and identity fields were filled in by code and are checked elsewhere; judge only the summary.",
        "Check: does every statement in the summary match the transcript and tool results? Does it leave out anything the human needs (what the customer wanted, what was already done or tried, what failed)?",
        "A short summary is fine if nothing important is missing.",
        "A part in [System facts: ...] was written by code from the call record and is true.",
      ].join("\n");
      const user = `${evidence(record)}\n## Handoff\nreason: ${h.reason}\nsummary (written by ${h.summaryBy}): ${h.summary}`;
      const res = await ask(system, user, TransferSchema);
      const v = res.value;
      const issues = [...v.inventedFacts.map((f) => `invented: ${f}`), ...v.missingForHuman.map((m) => `missing: ${m}`)];
      return { value: { reason: v.reason, passed: v.passed && v.inventedFacts.length === 0, issues }, usage: res.usage };
    },
  };
}
