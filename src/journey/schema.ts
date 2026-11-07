// PAIR (M5): written by Claude at Andrew's request; Claude also wrote the tests and the make-payment journey.
// Tests: src/journey/schema.test.ts. Design: SPEC §18.1 (Q1–Q14).
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { STEP_UP_TOOLS, TOOL_CATALOG, TOOL_NAMES, type AuthTier, type ToolName } from "../tools/catalog.js";

// ---- leaf schemas ----
const NonEmpty = z.string().min(1);
export const Channel = z.enum(["chat", "voice", "email"]);
export const AuthTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const ToolNameSchema = z.enum(TOOL_NAMES);
export const HandoffReason = z.enum([
  "unverified",
  "unsupported_request",
  "delinquent",
  "tool_failure",
  "caller_requested",
  "step_up_failed",
  "knowledge_gap",
  "agent_error", // the model failed (refusal, cut-off reply, API error): fail closed to a human
]);
// Closed list: each condition is implemented in code (Q5), so a typo is a load error, not a silent `false`.
export const VerbatimCondition = z.enum(["loan_past_due"]);

// ---- verbatim lines (Q4, Q5, Q6, Q12) ----
// One string for every channel, or one string per channel. Missing channels are a cross-check (Q12).
const Text = z.union([NonEmpty, z.partialRecord(Channel, NonEmpty)]);
const StaticSource = z.object({ kind: z.literal("static"), text: Text });
const ToolSpokenSource = z.object({ kind: z.literal("tool_spoken") });

const lineBase = { id: NonEmpty, condition: VerbatimCondition.optional() };

// tool_spoken appears in only one member, so "tool_spoken on_start" is a type error and a parse error (Q4).
export const VerbatimLine = z.discriminatedUnion("when", [
  z.object({ ...lineBase, when: z.literal("on_start"), source: StaticSource }),
  z.object({ ...lineBase, when: z.literal("on_transfer"), source: StaticSource }),
  z.object({ ...lineBase, when: z.literal("on_loan_identified"), source: StaticSource }),
  z.object({ ...lineBase, when: z.literal("before_tool"), tool: ToolNameSchema, source: StaticSource }),
  z.object({
    ...lineBase,
    when: z.literal("after_tool"),
    tool: ToolNameSchema,
    source: z.discriminatedUnion("kind", [StaticSource, ToolSpokenSource]),
  }),
]);

// ---- guardrails (Q7, Q10) ----
export const Guardrail = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("never_say"),
    pattern: NonEmpty, // compiled with the "i" flag
    shouldMatch: z.array(z.string()).min(1),
    shouldNotMatch: z.array(z.string()).min(1),
  }),
  z.object({ kind: z.literal("amount_from_code_only") }),
  z.object({ kind: z.literal("require_confirmation"), tool: ToolNameSchema, readBack: ToolNameSchema }),
]);

// ---- journey (Q1, Q2, Q8, Q13) ----
// A bare name uses the catalog floor; an object may only raise it (checked below).
const JourneyTool = z.union([ToolNameSchema, z.object({ name: ToolNameSchema, minTier: AuthTierSchema })]);
const Step = z.object({ id: NonEmpty, description: NonEmpty, tools: z.array(ToolNameSchema).min(1) });
const Handoff = z.object({ defaultQueue: NonEmpty, routes: z.partialRecord(HandoffReason, NonEmpty) });

type JourneyTool = z.infer<typeof JourneyTool>;

const toolName = (t: JourneyTool): ToolName => (typeof t === "string" ? t : t.name);

// The journey's own override, or 0 when it has none. Never below the floor after parsing.
const override = (t: JourneyTool): AuthTier => (typeof t === "string" ? 0 : t.minTier);

const higher = (a: AuthTier, b: AuthTier): AuthTier => (a > b ? a : b);

const JourneyShape = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case, e.g. make-payment"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver, e.g. 1.0.0"),
  goal: NonEmpty,
  instructions: NonEmpty,
  channels: z.array(Channel).min(1),
  steps: z.array(Step),
  tools: z.array(JourneyTool).min(1),
  verbatim: z.array(VerbatimLine),
  guardrails: z.array(Guardrail),
  handoff: Handoff,
});

type Shape = z.infer<typeof JourneyShape>;
type AddIssue = (path: Array<string | number>, message: string) => void;

// Each check reports every problem it finds, so an author sees the whole list in one load.
function checkTools(j: Shape, add: AddIssue): Set<ToolName> {
  const listed = new Set<ToolName>();
  let needsTier2 = false;
  j.tools.forEach((t, i) => {
    const name = toolName(t);
    if (listed.has(name)) add(["tools", i], `${name} is listed twice`);
    listed.add(name);

    const floor = TOOL_CATALOG[name].minTier;
    if (typeof t !== "string" && t.minTier < floor) {
      add(["tools", i, "minTier"], `${name} needs at least Tier ${floor}; a journey may raise a tier, never lower it`);
    }
    if (higher(floor, override(t)) === 2) needsTier2 = true;
  });
  // Q3: a Tier 2 tool with no way to reach Tier 2 would always fail on a live call.
  if (needsTier2 && !STEP_UP_TOOLS.every((s) => listed.has(s))) {
    add(["tools"], `a Tier 2 tool needs ${STEP_UP_TOOLS.join(" and ")} in tools`);
  }
  return listed;
}

function checkSteps(j: Shape, listed: Set<ToolName>, add: AddIssue): void {
  const ids = new Set<string>();
  j.steps.forEach((s, i) => {
    if (ids.has(s.id)) add(["steps", i, "id"], `step id ${s.id} is used twice`);
    ids.add(s.id);
    s.tools.forEach((t, k) => {
      if (!listed.has(t)) add(["steps", i, "tools", k], `${t} is not in the journey's tools`);
    });
  });
}

function checkVerbatim(j: Shape, listed: Set<ToolName>, add: AddIssue): void {
  const ids = new Set<string>();
  j.verbatim.forEach((v, i) => {
    if (ids.has(v.id)) add(["verbatim", i, "id"], `verbatim id ${v.id} is used twice`);
    ids.add(v.id);

    if ((v.when === "before_tool" || v.when === "after_tool") && !listed.has(v.tool)) {
      add(["verbatim", i, "tool"], `${v.tool} is not in the journey's tools`);
    }
    // Q12: a per-channel text must cover every channel the journey runs on.
    if (v.source.kind === "static" && typeof v.source.text !== "string") {
      const text = v.source.text;
      const missing = j.channels.filter((c) => text[c] === undefined);
      if (missing.length > 0) add(["verbatim", i, "source", "text"], `no text for ${missing.join(", ")}`);
    }
  });
}

function checkGuardrails(j: Shape, listed: Set<ToolName>, add: AddIssue): void {
  let needsConfirmation = false;
  j.guardrails.forEach((g, i) => {
    switch (g.kind) {
      case "never_say": {
        let re: RegExp;
        try {
          re = new RegExp(g.pattern, "i");
        } catch {
          add(["guardrails", i, "pattern"], "pattern is not a valid regular expression");
          return;
        }
        // Q10: the examples prove the pattern blocks what it should and nothing else.
        g.shouldMatch.forEach((s, k) => {
          if (!re.test(s)) add(["guardrails", i, "shouldMatch", k], `pattern does not match "${s}"`);
        });
        g.shouldNotMatch.forEach((s, k) => {
          if (re.test(s)) add(["guardrails", i, "shouldNotMatch", k], `pattern matches "${s}"`);
        });
        return;
      }
      case "require_confirmation": {
        needsConfirmation = true;
        if (!listed.has(g.tool)) add(["guardrails", i, "tool"], `${g.tool} is not in the journey's tools`);
        if (!listed.has(g.readBack)) add(["guardrails", i, "readBack"], `${g.readBack} is not in the journey's tools`);
        // Q7: the read-back the customer confirms must be the tool's own code-built text.
        const hasReadBack = j.verbatim.some(
          (v) => v.when === "after_tool" && v.tool === g.readBack && v.source.kind === "tool_spoken",
        );
        if (!hasReadBack) add(["guardrails", i], `needs an after_tool ${g.readBack} verbatim line with source tool_spoken`);
        return;
      }
      case "amount_from_code_only":
        return;
      default: {
        const unreachable: never = g;
        return unreachable;
      }
    }
  });
  // Q11: email has no live turn to confirm in.
  if (needsConfirmation && j.channels.includes("email")) {
    add(["channels"], "email cannot carry a journey with require_confirmation");
  }
}

// superRefine runs only when the whole shape is valid, so the checks can trust every field.
export const Journey = JourneyShape.superRefine((j, ctx) => {
  const add: AddIssue = (path, message) => ctx.addIssue({ code: "custom", path, message });
  const listed = checkTools(j, add);
  if (new Set(j.channels).size !== j.channels.length) add(["channels"], "a channel is listed twice");
  checkSteps(j, listed, add);
  checkVerbatim(j, listed, add);
  checkGuardrails(j, listed, add);
});

export type Journey = z.infer<typeof Journey>; // what the runner gets after parsing
export type JourneyInput = z.input<typeof Journey>; // what a journey file is written as (`satisfies JourneyInput`)

export type JourneyIssue = { path: Array<string | number>; message: string };

export function parseJourney(input: unknown): Result<Journey, JourneyIssue[]> {
  const res = Journey.safeParse(input);
  if (res.success) return ok(res.data);
  return err(
    res.error.issues.map((issue) => ({
      // zod allows symbol keys in a path; journeys are plain JSON-like data, so none occur.
      path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
      message: issue.message,
    })),
  );
}

export function effectiveTier(journey: Journey, tool: ToolName): AuthTier {
  const entry = journey.tools.find((t) => toolName(t) === tool);
  const floor = TOOL_CATALOG[tool].minTier;
  return entry === undefined ? floor : higher(floor, override(entry));
}
