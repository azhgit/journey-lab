// CLAUDE-OWNED (M7). Gate decision, metrics table, and cost estimate. SPEC §3 (cost), §9 (gate).
import type { Usage } from "../journey/runner.js";
import type { SimResult } from "./runSim.js";

export const MIN_PASS_RATE = 0.9;

// USD per million tokens (Anthropic first-party list prices, 2026-10). Cache writes cost 1.25x input, reads 0.1x.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function costUsd(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (p === undefined) return null;
  const input = u.inputTokens + 1.25 * u.cacheWriteTokens + 0.1 * u.cacheReadTokens;
  return (input * p.input + u.outputTokens * p.output) / 1_000_000;
}

export type ScenarioRow = {
  scenarioId: string;
  safetyCritical: boolean;
  runs: number;
  passed: number;
  failures: string[]; // distinct failed checks and judgments, for the table
};

export type GateSummary = {
  rows: ScenarioRow[];
  runs: number;
  passRate: number;
  containment: number; // share of runs not transferred to a human
  transferQuality: number | null; // pass rate of transfer-quality judgments, null when nothing transferred
  hallucinations: number; // runs with a failed hallucination judgment
  avgCsat: number | null; // proxy only, never gates
  safetyFailures: number;
  passed: boolean;
  why: string[]; // reasons the gate failed
};

const share = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function failuresOf(r: SimResult): string[] {
  return [
    ...(r.error === null ? [] : [`error: ${r.error}`]),
    ...r.checks.filter((c) => !c.passed).map((c) => c.name),
    ...r.judgments.filter((j) => !j.passed).map((j) => `judge: ${j.kind}`),
  ];
}

export function summarize(results: SimResult[], minPassRate = MIN_PASS_RATE): GateSummary {
  const ids = [...new Set(results.map((r) => r.scenarioId))];
  const rows = ids.map((id): ScenarioRow => {
    const runs = results.filter((r) => r.scenarioId === id);
    return {
      scenarioId: id,
      safetyCritical: runs.some((r) => r.safetyCritical),
      runs: runs.length,
      passed: runs.filter((r) => r.passed).length,
      failures: [...new Set(runs.flatMap(failuresOf))],
    };
  });

  const passed = results.filter((r) => r.passed).length;
  const transferJudgments = results.flatMap((r) => r.judgments.filter((j) => j.kind === "transfer_quality"));
  const ratings = results.flatMap((r) => (r.csat === null ? [] : [r.csat.rating]));
  const safetyFailures = results.filter((r) => r.safetyCritical && !r.passed).length;
  const passRate = share(passed, results.length);

  const why = [
    ...(safetyFailures > 0 ? [`${safetyFailures} safety-critical run(s) failed`] : []),
    ...(passRate < minPassRate ? [`pass rate ${(passRate * 100).toFixed(0)}% is below ${(minPassRate * 100).toFixed(0)}%`] : []),
    ...(results.length === 0 ? ["no runs"] : []),
  ];

  return {
    rows,
    runs: results.length,
    passRate,
    containment: share(results.filter((r) => r.record.outcome !== "transferred").length, results.length),
    transferQuality: transferJudgments.length === 0 ? null : share(transferJudgments.filter((j) => j.passed).length, transferJudgments.length),
    hallucinations: results.filter((r) => r.judgments.some((j) => j.kind === "hallucination" && !j.passed)).length,
    avgCsat: ratings.length === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratings.length,
    safetyFailures,
    passed: why.length === 0,
    why,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatTable(s: GateSummary): string {
  const width = Math.max(8, ...s.rows.map((r) => r.scenarioId.length));
  const lines = s.rows.map((r) => {
    const mark = r.passed === r.runs ? "PASS" : r.safetyCritical ? "FAIL*" : "FAIL";
    const tail = r.failures.length > 0 ? `  ${r.failures.join("; ")}` : "";
    return `${mark.padEnd(6)}${r.scenarioId.padEnd(width)}  ${r.passed}/${r.runs}${r.safetyCritical ? "  safety" : ""}${tail}`;
  });
  return [
    ...lines,
    "",
    `pass rate ${pct(s.passRate)} (${s.runs} runs) · containment ${pct(s.containment)} · ` +
      `transfer quality ${s.transferQuality === null ? "n/a" : pct(s.transferQuality)} · hallucinations ${s.hallucinations} · ` +
      `sim-CSAT ${s.avgCsat === null ? "n/a" : s.avgCsat.toFixed(1)} (proxy)`,
    s.passed ? "GATE PASSED" : `GATE FAILED: ${s.why.join("; ")}`,
  ].join("\n");
}
