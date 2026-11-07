import { describe, expect, expectTypeOf, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { effectiveTier, type Journey, type JourneyInput, type JourneyIssue, parseJourney } from "./schema.js";

// Each test starts from the real journey and breaks exactly one thing.
const draft = (): JourneyInput => structuredClone(makePayment);

function at<T>(items: T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`fixture has no index ${i}`);
  return item;
}

function issues(input: unknown): JourneyIssue[] {
  const res = parseJourney(input);
  if (res.ok) throw new Error("expected the journey to be rejected");
  return res.error;
}

function parsed(input: unknown): Journey {
  const res = parseJourney(input);
  if (!res.ok) throw new Error(`expected a valid journey, got ${JSON.stringify(res.error)}`);
  return res.data;
}

// Index of the next tool pushed onto the fixture's tool list.
const NEXT_TOOL = makePayment.tools.length;
const NEXT_GUARDRAIL = makePayment.guardrails.length;

// True when some issue's path starts with `prefix` (zod may add detail below the field).
const hasIssueAt = (list: JourneyIssue[], prefix: Array<string | number>): boolean =>
  list.some((issue) => prefix.every((p, i) => issue.path[i] === p));

describe("parseJourney: the make-payment journey", () => {
  it("is valid", () => {
    const j = parsed(makePayment);
    expect(j.id).toBe("make-payment");
    expectTypeOf(parseJourney(makePayment)).toEqualTypeOf<
      { ok: true; data: Journey } | { ok: false; error: JourneyIssue[] }
    >();
  });

  it.each([null, 42, "journey", {}])("never throws on garbage (%j)", (input) => {
    expect(issues(input).length).toBeGreaterThan(0);
  });
});

describe("parseJourney: shape", () => {
  it.each<[string, (j: JourneyInput) => void, Array<string | number>]>([
    ["id must be kebab-case", (j) => { j.id = "Make Payment"; }, ["id"]],
    ["version must be semver", (j) => { j.version = "1.0"; }, ["version"]],
    ["at least one channel", (j) => { j.channels = []; }, ["channels"]],
    ["at least one tool", (j) => { j.tools = []; }, ["tools"]],
    ["unknown tool name", (j) => { j.tools.push("deleteLoan" as never); }, ["tools", NEXT_TOOL]],
    ["a step needs at least one tool", (j) => { at(j.steps, 0).tools = []; }, ["steps", 0, "tools"]],
    ["unknown verbatim condition", (j) => { j.verbatim[1] = { id: "x", when: "on_loan_identified", condition: "vip" as never, source: { kind: "static", text: "Hi." } }; }, ["verbatim", 1]],
    ["handoff needs a default queue (Q8)", (j) => { j.handoff = { routes: {} } as never; }, ["handoff", "defaultQueue"]],
    ["unknown handoff reason", (j) => { j.handoff.routes = { vip: "x" } as never; }, ["handoff", "routes"]],
    ["never_say needs examples (Q10)", (j) => { j.guardrails.push({ kind: "never_say", pattern: "x", shouldMatch: [], shouldNotMatch: ["y"] }); }, ["guardrails", NEXT_GUARDRAIL, "shouldMatch"]],
  ])("%s", (_name, mutate, path) => {
    const j = draft();
    mutate(j);
    expect(hasIssueAt(issues(j), path)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["tool_spoken on_start", { id: "x", when: "on_start", source: { kind: "tool_spoken" } }],
    ["tool_spoken before_tool", { id: "x", when: "before_tool", tool: "preparePayment", source: { kind: "tool_spoken" } }],
    ["after_tool without a tool", { id: "x", when: "after_tool", source: { kind: "tool_spoken" } }],
  ])("verbatim shape rejected at runtime: %s (Q4)", (_name, line) => {
    const j = draft();
    j.verbatim.push(line as never);
    expect(hasIssueAt(issues(j), ["verbatim", 4])).toBe(true);
  });

  it("tool_spoken is only legal after a tool (compile-time check, Q4)", () => {
    type Line = JourneyInput["verbatim"][number];
    // @ts-expect-error tool_spoken needs when: "after_tool"
    const bad: Line = { id: "x", when: "on_start", source: { kind: "tool_spoken" } };
    const good: Line = { id: "y", when: "after_tool", tool: "preparePayment", source: { kind: "tool_spoken" } };
    void bad;
    void good;
  });
});

describe("parseJourney: cross-checks", () => {
  it.each<[string, (j: JourneyInput) => void, Array<string | number>]>([
    ["duplicate tool", (j) => { j.tools.push("getLoanDetails"); }, ["tools", NEXT_TOOL]],
    ["override below the catalog floor (Q1)", (j) => { j.tools[0] = { name: "getLoanDetails", minTier: 0 }; }, ["tools", 0, "minTier"]],
    [
      "Tier 2 needed but no step-up tools (Q3)",
      (j) => {
        j.tools = [{ name: "getLoanDetails", minTier: 2 }, "listLinkedAccounts", "preparePayment", "makePayment"];
        j.steps = j.steps.filter((s) => s.id !== "verify_identity");
      },
      ["tools"],
    ],
    [
      "a catalog Tier 2 tool also needs step-up tools (Q3)",
      (j) => {
        j.tools = ["getLoanDetails", "listLinkedAccounts", "preparePayment", "makePayment", "updateAutopay"];
        j.steps = j.steps.filter((s) => s.id !== "verify_identity");
      },
      ["tools"],
    ],
    ["duplicate channel", (j) => { j.channels = ["chat", "voice", "chat"]; }, ["channels"]],
    ["duplicate step id", (j) => { at(j.steps, 1).id = "verify_identity"; }, ["steps", 1, "id"]],
    ["step uses a tool the journey does not list", (j) => { at(j.steps, 1).tools = ["updateAutopay"]; }, ["steps", 1, "tools", 0]],
    ["duplicate verbatim id", (j) => { at(j.verbatim, 1).id = "greeting_disclosure"; }, ["verbatim", 1, "id"]],
    [
      "verbatim tied to a tool the journey does not list",
      (j) => { j.verbatim.push({ id: "z", when: "before_tool", tool: "updateAutopay", source: { kind: "static", text: "Hi." } }); },
      ["verbatim", 4, "tool"],
    ],
    [
      "per-channel text misses a journey channel (Q12)",
      (j) => { j.verbatim[0] = { id: "greeting_disclosure", when: "on_start", source: { kind: "static", text: { voice: "Hi." } } }; },
      ["verbatim", 0, "source", "text"],
    ],
    [
      "never_say pattern is not a valid regex",
      (j) => { j.guardrails.push({ kind: "never_say", pattern: "(", shouldMatch: ["("], shouldNotMatch: ["x"] }); },
      ["guardrails", NEXT_GUARDRAIL, "pattern"],
    ],
    [
      "never_say example that should match does not (Q10)",
      (j) => { j.guardrails[2] = { kind: "never_say", pattern: "\\bguarantee\\b", shouldMatch: ["hello"], shouldNotMatch: ["x"] }; },
      ["guardrails", 2, "shouldMatch", 0],
    ],
    [
      "never_say example that should not match does (Q10)",
      (j) => { j.guardrails[2] = { kind: "never_say", pattern: "\\bguarantee\\b", shouldMatch: ["we guarantee"], shouldNotMatch: ["I can't guarantee that"] }; },
      ["guardrails", 2, "shouldNotMatch", 0],
    ],
    [
      "require_confirmation on a tool the journey does not list",
      (j) => { j.guardrails[1] = { kind: "require_confirmation", tool: "updateAutopay", readBack: "preparePayment" }; },
      ["guardrails", 1, "tool"],
    ],
    [
      "require_confirmation read-back from a tool the journey does not list",
      (j) => { j.guardrails[1] = { kind: "require_confirmation", tool: "makePayment", readBack: "updateAutopay" }; },
      ["guardrails", 1, "readBack"],
    ],
    [
      "require_confirmation without a tool_spoken read-back line (Q7)",
      (j) => { j.verbatim = j.verbatim.filter((v) => v.id !== "payment_confirmation"); },
      ["guardrails", 1],
    ],
    ["require_confirmation on email (Q11)", (j) => { j.channels = ["chat", "voice", "email"]; }, ["channels"]],
  ])("%s", (_name, mutate, path) => {
    const j = draft();
    mutate(j);
    expect(issues(j).map((i) => i.path)).toContainEqual(path);
  });

  it("raising a tier is allowed when step-up tools are present (Q1)", () => {
    const j = draft();
    j.tools[0] = { name: "getLoanDetails", minTier: 2 };
    expect(parseJourney(j).ok).toBe(true);
  });

  it("a plain string text covers every channel (Q12)", () => {
    const j = draft();
    j.verbatim[0] = { id: "greeting_disclosure", when: "on_start", source: { kind: "static", text: "Hello." } };
    expect(parseJourney(j).ok).toBe(true);
  });

  it("never_say matches case-insensitively", () => {
    const j = draft();
    j.guardrails[2] = { kind: "never_say", pattern: "\\bguarantee\\b", shouldMatch: ["WE GUARANTEE IT"], shouldNotMatch: ["fine"] };
    expect(parseJourney(j).ok).toBe(true);
  });

  it("email is fine for a journey without require_confirmation (Q11)", () => {
    const j = draft();
    j.channels = ["email"];
    j.tools = ["getLoanDetails", "sendStepUpCode", "checkStepUpCode"];
    j.steps = [{ id: "review_loan", description: "Look up the loan.", tools: ["getLoanDetails"] }];
    j.verbatim = [{ id: "greeting_disclosure", when: "on_start", source: { kind: "static", text: "Hello." } }];
    j.guardrails = [{ kind: "amount_from_code_only" }];
    expect(parseJourney(j).ok).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    const j = draft();
    j.tools.push("getLoanDetails");
    at(j.steps, 1).id = "verify_identity";
    const paths = issues(j).map((i) => i.path);
    expect(paths).toContainEqual(["tools", NEXT_TOOL]);
    expect(paths).toContainEqual(["steps", 1, "id"]);
  });
});

describe("effectiveTier (Q1)", () => {
  it("is the catalog floor when the journey does not override", () => {
    expect(effectiveTier(parsed(makePayment), "makePayment")).toBe(1);
    expect(effectiveTier(parsed(makePayment), "sendStepUpCode")).toBe(0);
  });

  it("is the override when the journey raises it", () => {
    const j = draft();
    j.tools[0] = { name: "getLoanDetails", minTier: 2 };
    expect(effectiveTier(parsed(j), "getLoanDetails")).toBe(2);
  });

  it("is the catalog floor for a tool the journey does not list", () => {
    expect(effectiveTier(parsed(makePayment), "updateAutopay")).toBe(2);
  });
});
