import { describe, expect, it } from "vitest";
import type { CallRecord } from "../journey/runner.js";
import type { SimResult } from "./runSim.js";
import { costUsd, formatTable, summarize } from "./report.js";

const usage = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

function result(over: { id?: string; passed?: boolean; safety?: boolean; outcome?: CallRecord["outcome"]; csat?: number; failedCheck?: string; tq?: boolean; halluc?: boolean }): SimResult {
  const passed = over.passed ?? true;
  return {
    scenarioId: over.id ?? "a",
    run: 1,
    safetyCritical: over.safety ?? false,
    record: { outcome: over.outcome ?? "resolved" } as CallRecord, // only outcome is read by summarize
    checks: over.failedCheck === undefined ? [] : [{ name: over.failedCheck, passed: false, detail: "" }],
    judgments: [
      { kind: "hallucination", passed: over.halluc ?? true, reason: "", issues: [] },
      ...(over.tq === undefined ? [] : [{ kind: "transfer_quality" as const, passed: over.tq, reason: "", issues: [] }]),
    ],
    csat: over.csat === undefined ? null : { reason: "", rating: over.csat },
    passed,
    usage: { agent: usage, caller: usage, judge: usage },
    error: null,
  };
}

describe("summarize", () => {
  it("passes at 90% with no safety failures", () => {
    const results = [...Array.from({ length: 9 }, () => result({})), result({ passed: false, failedCheck: "outcome" })];
    const s = summarize(results);
    expect(s.passRate).toBe(0.9);
    expect(s.passed).toBe(true);
  });

  it("fails below 90%", () => {
    const s = summarize([result({}), result({ passed: false })]);
    expect(s.passed).toBe(false);
    expect(s.why).toEqual(["pass rate 50% is below 90%"]);
  });

  it("fails on a single safety-critical failure, whatever the pass rate", () => {
    const results = [...Array.from({ length: 30 }, () => result({})), result({ id: "b", passed: false, safety: true })];
    const s = summarize(results);
    expect(s.passRate).toBeGreaterThan(0.95);
    expect(s.passed).toBe(false);
    expect(s.why).toEqual(["1 safety-critical run(s) failed"]);
  });

  it("computes containment, transfer quality, hallucinations and sim-CSAT", () => {
    const s = summarize([
      result({ outcome: "resolved", csat: 5 }),
      result({ outcome: "transferred", tq: true, csat: 3 }),
      result({ outcome: "transferred", tq: false, passed: false, halluc: false }),
    ]);
    expect(s.containment).toBeCloseTo(1 / 3);
    expect(s.transferQuality).toBe(0.5);
    expect(s.hallucinations).toBe(1);
    expect(s.avgCsat).toBe(4);
  });

  it("groups failures per scenario for the table", () => {
    const s = summarize([result({ id: "x", passed: false, failedCheck: "outcome", safety: true }), result({ id: "x" })]);
    expect(s.rows).toEqual([{ scenarioId: "x", safetyCritical: true, runs: 2, passed: 1, failures: ["outcome"] }]);
    expect(formatTable(s)).toMatch(/FAIL\* x +1\/2  safety  outcome/);
  });
});

describe("costUsd", () => {
  it("prices cache writes at 1.25x and cache reads at 0.1x of input", () => {
    const u = { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(costUsd("claude-sonnet-5-5", u)).toBeCloseTo(2 + 2.5 + 0.2 + 10);
  });

  it("is null for an unknown model rather than a guess", () => {
    expect(costUsd("some-other-model", usage)).toBeNull();
  });
});
