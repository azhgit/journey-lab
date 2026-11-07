// CLAUDE-OWNED. Runs the judge on known-bad cases (src/sim/negatives.ts) and on their unedited calls (controls).
// Exit 1 if the judge passes a broken case or fails a control. Re-run after any judge change.
//   npm run judge:negatives [-- --dry-run] [--db data/journey-lab.db]
import { parseArgs } from "node:util";
import { openDb } from "../db/db.js";
import type { CallRecord } from "../journey/runner.js";
import { anthropicJudge } from "./llm.js";
import { applyEdit, NEGATIVE_CASES, type NegativeCase } from "./negatives.js";
import { pool } from "./pool.js";
import { costUsd } from "./report.js";
import { Scenario } from "./scenario.js";
import { SCENARIOS } from "./scenarios.js";
import { HUMAN_SCENARIOS } from "./scenarios-human.js";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "data/journey-lab.db" },
    "dry-run": { type: "boolean", default: false }, // apply every edit, call no model
  },
});

const model = process.env.JUDGE_MODEL ?? "claude-sonnet-5-5";
const db = openDb(values.db);
const scenarios = [...SCENARIOS, ...HUMAN_SCENARIOS].map((s) => Scenario.parse(s));

function load(callId: string): CallRecord {
  const r = db.loadCallRecord(callId);
  if (r === null) throw new Error(`${callId}: not stored with its evidence in ${values.db}`);
  return r;
}

type Job = { id: string; kind: NegativeCase["kind"]; breaks: string; expectPass: boolean; record: CallRecord };

// Every edit is applied before any model call, so a drifted case fails fast and costs nothing.
const broken: Job[] = NEGATIVE_CASES.map((c) => ({ id: c.id, kind: c.kind, breaks: c.breaks, expectPass: false, record: applyEdit(load(c.callId), c) }));
const controlKeys = [...new Map(NEGATIVE_CASES.map((c) => [`${c.kind} ${c.callId}`, c])).values()];
const controls: Job[] = controlKeys.map((c) => ({ id: `control ${c.callId}`, kind: c.kind, breaks: "(unedited)", expectPass: true, record: load(c.callId) }));
const jobs = [...broken, ...controls];

if (values["dry-run"]) {
  console.log(`dry run: ${broken.length} edits applied, ${controls.length} controls loaded, no model calls`);
  process.exit(0);
}

const judge = anthropicJudge({ model });
const results = await pool(jobs, 4, async (job) => {
  const scenario = scenarios.find((s) => job.record.callId.startsWith(`${s.id}-`));
  if (scenario === undefined) throw new Error(`${job.record.callId}: no scenario`);
  const input = { scenario, record: job.record };
  const res = job.kind === "hallucination" ? await judge.hallucination(input) : await judge.transferQuality(input);
  return { job, verdict: res.value, cost: costUsd(model, res.usage) ?? 0 };
});

for (const { job, verdict } of results) {
  const ok = verdict.passed === job.expectPass;
  console.log(`${ok ? "ok  " : "MISS"} ${job.kind.padEnd(16)} ${job.id.padEnd(48)} expect ${job.expectPass ? "PASS" : "FAIL"}, judge ${verdict.passed ? "PASS" : "FAIL"} · ${job.breaks}`);
  if (!ok) console.log(`     ${verdict.reason}\n     issues: ${JSON.stringify(verdict.issues)}`);
}

const caught = results.filter((r) => !r.job.expectPass && !r.verdict.passed).length;
const kept = results.filter((r) => r.job.expectPass && r.verdict.passed).length;
const cost = results.reduce((sum, r) => sum + r.cost, 0);
console.log(`\nbroken cases caught ${caught}/${broken.length} · controls passed ${kept}/${controls.length} · judge ${model} · $${cost.toFixed(4)} (estimate)`);
db.close();
process.exit(caught === broken.length && kept === controls.length ? 0 : 1);
