// CLAUDE-OWNED (M7). The release gate (SPEC §9): every scenario × SIM_RUNS_PER_SCENARIO against the live models.
// Exits 1 on any safety-critical failure, a pass rate below 90%, or a journey changed without a version bump (Q13).
//   npm run gate
//   npm run gate -- --journey journeys/make-payment.ts --runs 1 --only pay_happy_path,unsupported_request
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openDb, type StoredCall, type StoredSimResult } from "./db/db.js";
import { anthropicModel } from "./journey/anthropic.js";
import { checkVersion, journeyHash } from "./journey/hash.js";
import { parseJourney, type Journey } from "./journey/schema.js";
import { anthropicCaller, anthropicJudge } from "./sim/llm.js";
import { costUsd, failuresOf, formatTable, summarize } from "./sim/report.js";
import { pool } from "./sim/pool.js";
import { runSim, type SimResult } from "./sim/runSim.js";
import { Scenario } from "./sim/scenario.js";
import { SCENARIOS } from "./sim/scenarios.js";
import { HUMAN_SCENARIOS } from "./sim/scenarios-human.js";
import { loadKnowledge } from "./tools/searchKnowledge.js";

const { values } = parseArgs({
  options: {
    journey: { type: "string", default: "journeys/make-payment.ts" },
    runs: { type: "string", default: process.env.SIM_RUNS_PER_SCENARIO ?? "3" },
    only: { type: "string" },
    db: { type: "string", default: "data/journey-lab.db" },
  },
});

const models = {
  agent: process.env.AGENT_MODEL ?? "claude-haiku-5-5",
  caller: process.env.CALLER_MODEL ?? "claude-haiku-5-5",
  judge: process.env.JUDGE_MODEL ?? "claude-sonnet-5-5",
};
const runs = Number(values.runs);
const concurrency = Number(process.env.SIM_CONCURRENCY ?? 4);
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("--runs and SIM_CONCURRENCY must be positive integers");
}

// The journey module may export anything; exactly one export must be a valid journey.
async function loadJourney(path: string): Promise<Journey> {
  const mod: Record<string, unknown> = await import(pathToFileURL(resolve(path)).href);
  const found = Object.values(mod).flatMap((v) => {
    const res = parseJourney(v);
    return res.ok ? [res.data] : [];
  });
  const [journey, ...extra] = found;
  if (journey === undefined || extra.length > 0) throw new Error(`${path} must export exactly one valid journey`);
  return journey;
}

const journey = await loadJourney(values.journey);
const hash = journeyHash(journey);
mkdirSync(dirname(values.db), { recursive: true });
const db = openDb(values.db);

// Q13 first: no tokens are spent on a journey whose content changed under a released version.
const version = checkVersion(journey, hash, db.recordedHash(journey.id, journey.version));
if (!version.ok) {
  console.error(`GATE FAILED: ${version.message}. Bump the version in ${values.journey}.`);
  process.exit(1);
}

const only = values.only?.split(",").filter((s) => s !== "");
const scenarios = [...SCENARIOS, ...HUMAN_SCENARIOS]
  .map((s) => Scenario.parse(s))
  .filter((s) => only === undefined || only.includes(s.id));
if (only !== undefined && scenarios.length !== only.length) throw new Error(`unknown scenario in --only: ${only.join(",")}`);

const articles = loadKnowledge("knowledge");
const agent = anthropicModel({ model: models.agent });
const caller = anthropicCaller({ model: models.caller });
const judge = anthropicJudge({ model: models.judge });
const startedAt = new Date().toISOString();

console.log(
  `gate ${journey.id}@${journey.version} (${hash}) · ${scenarios.length} scenarios × ${runs} runs · ` +
    `agent ${models.agent}, caller ${models.caller}, judge ${models.judge} · concurrency ${concurrency}\n`,
);

const jobs = scenarios.flatMap((scenario) => Array.from({ length: runs }, (_, i) => ({ scenario, run: i + 1 })));
const results: SimResult[] = await pool(jobs, concurrency, async ({ scenario, run }) => {
  const r = await runSim({ scenario, run, journey, agent, caller, judge, articles });
  const failures = failuresOf(r);
  console.log(`${r.passed ? "✓" : "✗"} ${scenario.id} #${run}${failures.length > 0 ? `: ${failures.join("; ")}` : ""}`);
  return r;
});

const summary = summarize(results);
console.log(`\n${formatTable(summary)}`);

// Details for every failed run, so the fix starts from evidence (full transcripts are in the database).
for (const r of results.filter((x) => !x.passed)) {
  console.log(`\n--- ${r.scenarioId} #${r.run} (${r.record.callId})`);
  for (const c of r.checks.filter((x) => !x.passed)) console.log(`check ${c.name}: ${c.detail}`);
  for (const j of r.judgments.filter((x) => !x.passed)) console.log(`judge ${j.kind}: ${j.reason}${j.issues.length > 0 ? `\n  ${j.issues.join("\n  ")}` : ""}`);
  if (r.error !== null) console.log(`error: ${r.error}`);
}

const costs = (["agent", "caller", "judge"] as const).map((role) => {
  const total = results.reduce((sum, r) => sum + (costUsd(models[role], r.usage[role]) ?? Number.NaN), 0);
  return { role, total };
});
const totalCost = costs.reduce((sum, c) => sum + c.total, 0);
console.log(`\ncost ${costs.map((c) => `${c.role} $${c.total.toFixed(4)}`).join(" · ")} · total $${totalCost.toFixed(4)} (estimate)`);

const gateRunId = `gate-${Date.now().toString(36)}`;
const endedAt = new Date().toISOString();
db.saveGateRun(
  {
    id: gateRunId,
    startedAt,
    journeyId: journey.id,
    journeyVersion: journey.version,
    journeyHash: hash,
    passed: summary.passed,
    passRate: summary.passRate,
    costUsd: Number.isNaN(totalCost) ? null : totalCost,
  },
  results.map((r): StoredCall & { sim: StoredSimResult } => ({
    record: r.record,
    journeyHash: hash,
    endedAt,
    source: "sim",
    csat: r.csat?.rating ?? null,
    judgments: r.judgments.map((j) => ({ kind: j.kind, passed: j.passed, reason: [j.reason, ...j.issues].join("\n") })),
    sim: { callId: r.record.callId, scenarioId: r.scenarioId, safetyCritical: r.safetyCritical, passed: r.passed, failedChecks: failuresOf(r) },
  })),
);

// A version is "released" only by a full, passing gate; after that its content is frozen (Q13).
if (summary.passed && only === undefined) db.recordVersion(journey.id, journey.version, hash, endedAt);
db.close();
console.log(`saved ${gateRunId} to ${values.db}`);
process.exit(summary.passed ? 0 : 1);
