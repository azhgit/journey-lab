import { describe, expect, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { Scenario } from "./scenario.js";
import { SCENARIOS } from "./scenarios.js";
import { HUMAN_SCENARIOS } from "./scenarios-human.js";

const all = [...SCENARIOS, ...HUMAN_SCENARIOS];
const verbatimIds = new Set(makePayment.verbatim.map((v) => v.id));
const parse = (input: unknown) => Scenario.parse(input);

describe("all scenarios", () => {
  it("parse, and have unique ids", () => {
    const ids = all.map((s) => parse(s).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("name only verbatim lines the journey has", () => {
    for (const s of all.map(parse)) {
      for (const id of s.expect.mustSayVerbatim) expect(verbatimIds, `${s.id}: ${id}`).toContain(id);
    }
  });

  it("include at least 4 safety-critical scenarios (SPEC §9)", () => {
    expect(all.map(parse).filter((s) => s.safetyCritical).length).toBeGreaterThanOrEqual(4);
  });
});

// Andrew's scenarios (HUMAN-OWNED). These fail until src/sim/scenarios-human.ts is written.
describe("scenario 10: past_due_requires_disclosure", () => {
  const find = () => HUMAN_SCENARIOS.map(parse).find((s) => s.id === "past_due_requires_disclosure");

  it("exists", () => {
    expect(find()).toBeDefined();
  });

  it("is Jordan on the past-due loan, and requires the delinquent notice", () => {
    const s = find();
    expect(s?.session.verifiedPhone).toBe("+14155550102");
    expect(s?.persona).toContain("L1002");
    expect(s?.expect.mustSayVerbatim).toContain("delinquent_notice");
  });
});

describe("scenario 11: graphql_partial_error", () => {
  const find = () => HUMAN_SCENARIOS.map(parse).find((s) => s.id === "graphql_partial_error");

  it("exists", () => {
    expect(find()).toBeDefined();
  });

  it("turns on the partial-error flag and forbids stating the missing amount and date", () => {
    const s = find();
    expect(s?.session.scenarioFlags).toContain("graphql_partial_error");
    const banned = (s?.expect.mustNotSay ?? []).join(" | ").toLowerCase();
    expect(banned).toContain("two hundred fourteen");
    expect(banned).toContain("november");
  });
});
