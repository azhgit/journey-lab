// CLAUDE-OWNED (M6). The runtime tool registry: input schema + run function per catalog name, plus the
// runner-level tools (transferToHuman, endCall). Tiers stay in catalog.ts; gating happens in runner.ts.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { updateAutopay } from "../tools/autopay.js";
import { TOOL_CATALOG, type ToolName } from "../tools/catalog.js";
import type { AutopayChange, QuoteId, Session, ToolResult } from "../tools/context.js";
import { checkStepUpCode, sendStepUpCode } from "../tools/identity.js";
import { getLoanDetails, listLinkedAccounts } from "../tools/loans.js";
import { makePayment, preparePayment } from "../tools/payments.js";
import { searchKnowledge, type Article } from "../tools/searchKnowledge.js";
import { HandoffReason, type Journey } from "./schema.js";

// A validated call, ready to run. The typed input is captured in the closure, so the runner can hold
// calls to different tools in one list without knowing each input type.
export type PreparedCall = {
  loanId: string | null; // the loan this call touches, for tier gating and the on_loan_identified lookup
  quoteId: string | null; // the quote this call reads back or confirms (Q7)
  run: (session: Session) => Promise<ToolResult<unknown>>;
};

export type ToolDef = {
  schema: z.ZodType;
  prepare: (raw: unknown) => Result<PreparedCall, string>;
};

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) return null;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : null;
}

function define<I>(schema: z.ZodType<I>, run: (session: Session, input: I) => Promise<ToolResult<unknown>>): ToolDef {
  return {
    schema,
    prepare(raw) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return err(z.prettifyError(parsed.error));
      const input = parsed.data;
      return ok({
        loanId: stringField(input, "loanId"),
        quoteId: stringField(input, "quoteId"),
        run: (session) => run(session, input),
      });
    },
  };
}

const LoanId = z.string().min(1).describe("The loan id, for example L1001.");

// Flat on the wire (a top-level union is awkward for tool schemas), narrowed to AutopayChange here.
const AutopayInput = z
  .object({
    loanId: LoanId,
    enabled: z.boolean(),
    linkedAccountId: z.string().min(1).optional().describe("Required when turning autopay on."),
  })
  .refine((i) => !i.enabled || i.linkedAccountId !== undefined, {
    message: "linkedAccountId is required when enabled is true",
    path: ["linkedAccountId"],
  })
  .transform((i): AutopayChange =>
    i.enabled && i.linkedAccountId !== undefined
      ? { loanId: i.loanId, enabled: true, linkedAccountId: i.linkedAccountId }
      : { loanId: i.loanId, enabled: false },
  );

export function createToolDefs(articles: Article[]): Record<ToolName, ToolDef> {
  return {
    getLoanDetails: define(z.object({ loanId: LoanId }), getLoanDetails),
    listLinkedAccounts: define(z.object({ loanId: LoanId }), listLinkedAccounts),
    preparePayment: define(
      z.object({
        loanId: LoanId,
        amountCents: z.number().int().describe("Amount in integer cents: 21450 means $214.50."),
        linkedAccountId: z.string().min(1).describe("A linked account id from listLinkedAccounts."),
      }),
      preparePayment,
    ),
    makePayment: define(
      // The cast only brands the string: makePayment rejects any id that is not a quote in this session.
      z.object({ quoteId: z.string().min(1).transform((s) => s as QuoteId).describe("The quoteId from preparePayment.") }),
      makePayment,
    ),
    sendStepUpCode: define(z.object({ loanId: LoanId }), sendStepUpCode),
    checkStepUpCode: define(z.object({ code: z.string().min(1).describe("The code exactly as the caller said it.") }), checkStepUpCode),
    updateAutopay: define(AutopayInput, updateAutopay),
    searchKnowledge: define(z.object({ query: z.string().min(1) }), async (_session, { query }) =>
      ok({ data: searchKnowledge(articles, query), spoken: "" }),
    ),
  };
}

// ---- runner-level tools: handled by the runner itself, always offered ----

// agent_error is code-only: the runner uses it when the model itself fails.
export const TransferInput = z.object({
  reason: HandoffReason.exclude(["agent_error"]).describe(
    "The underlying reason. If you offered the transfer because of a rule (for example unsupported_request or " +
      "knowledge_gap), use that reason even when the customer then agrees. Use caller_requested only when the " +
      "customer asked for a person without being offered one.",
  ),
  summary: z
    .string()
    .min(1)
    .max(600)
    .describe(
      "For the human agent. Only what happened in this conversation: what the customer wanted, what was done or " +
        "tried, and what failed. State only what the customer said or a tool returned.",
    ),
});
export const EndCallInput = z.object({});

export const RUNNER_TOOLS = {
  transferToHuman: {
    schema: TransferInput,
    description: "Transfer the caller to a human agent. Use when you cannot help, the caller asks, or a rule says to.",
  },
  endCall: {
    schema: EndCallInput,
    description: "End the conversation after the caller says goodbye or confirms they need nothing else.",
  },
} as const;

export type RunnerToolName = keyof typeof RUNNER_TOOLS;

export function isRunnerTool(name: string): name is RunnerToolName {
  return Object.hasOwn(RUNNER_TOOLS, name);
}

function toAnthropicTool(name: string, description: string, schema: z.ZodType): Anthropic.Tool {
  // `io: "input"`: describe what the model sends (before transforms), not what run() receives.
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input" });
  return { name, description, input_schema: { ...json, type: "object" } };
}

// Journey tools in listed order, then the runner tools. Stable order keeps the prompt cacheable.
export function anthropicTools(journey: Journey, defs: Record<ToolName, ToolDef>): Anthropic.Tool[] {
  const listed = journey.tools.map((t) => (typeof t === "string" ? t : t.name));
  return [
    ...listed.map((name) => toAnthropicTool(name, TOOL_CATALOG[name].description, defs[name].schema)),
    ...Object.entries(RUNNER_TOOLS).map(([name, t]) => toAnthropicTool(name, t.description, t.schema)),
  ];
}
