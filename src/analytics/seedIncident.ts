// CLAUDE-OWNED (M8). Synthetic "production" traffic for the incident drill (SPEC §10.1, docs/incident-drill.md).
// Runs the real runner and agent model against simulated callers with a realistic mix of intents and failure
// flags, split between stable and candidate by src/rollout.ts. Stored as source = 'synthetic_prod'.
// Spends tokens (~$0.10 for 60 calls), so results are cached in SQLite: rerun with --force to regenerate.
//   npm run seed:incident
//   npm run seed:incident -- --n 60 --percent 20 --force
import { parseArgs } from "node:util";
import { makePayment } from "../../journeys/make-payment.js";
import { makePaymentCandidate } from "../../journeys/make-payment.candidate.js";
import { openDb } from "../db/db.js";
import { anthropicModel } from "../journey/anthropic.js";
import { journeyHash } from "../journey/hash.js";
import { parseJourney, type Journey, type JourneyInput } from "../journey/schema.js";
import { fileCallLog } from "../lib/logger.js";
import { armFor, candidatePercentFromEnv } from "../rollout.js";
import { anthropicCaller } from "../sim/llm.js";
import { pool } from "../sim/pool.js";
import { runSim } from "../sim/runSim.js";
import { Scenario } from "../sim/scenario.js";
import { SCENARIOS } from "../sim/scenarios.js";
import { HUMAN_SCENARIOS } from "../sim/scenarios-human.js";
import { loadKnowledge } from "../tools/searchKnowledge.js";

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "60" },
    percent: { type: "string" },
    force: { type: "boolean", default: false },
    db: { type: "string", default: "data/journey-lab.db" },
  },
});

// What callers actually want, weighted. Declines are common enough that the planted regression shows up.
const MIX: Array<[scenarioId: string, weight: number]> = [
  ["pay_happy_path", 30],
  ["pay_declined_then_other_account", 25],
  ["past_due_requires_disclosure", 10],
  ["policy_question_not_in_kb", 10],
  ["phone_mismatch_step_up_pass", 10],
  ["pay_insufficient_funds_transfer", 5],
  ["tool_timeout_then_recover", 5],
  ["unsupported_request", 5],
];

function parsed(input: JourneyInput): Journey {
  const res = parseJourney(input);
  if (!res.ok) throw new Error(`invalid journey: ${JSON.stringify(res.error)}`);
  return res.data;
}

// Deterministic: call i gets the same intent and (by its fixed id) the same rollout arm every time, so two seeds
// differ only by model behavior. 29 is coprime with 100, so it walks every slot before repeating; it was picked
// (over 13, 17, 23, 31, 37, 41) because at 60 calls and 20% it sends 4 of the 11 candidate calls into a decline,
// enough for the planted regression to show.
function intentFor(i: number): string {
  const total = MIX.reduce((sum, [, w]) => sum + w, 0);
  let point = (i * 29) % total;
  for (const [id, weight] of MIX) {
    if (point < weight) return id;
    point -= weight;
  }
  throw new Error("unreachable: point < total");
}

const n = Number(values.n);
// --percent, else CANDIDATE_PERCENT, else 20 for the drill. 0 is a real value (rollback), never "unset".
const percent = values.percent !== undefined ? Number(values.percent) : process.env.CANDIDATE_PERCENT !== undefined ? candidatePercentFromEnv() : 20;
const db = openDb(values.db);

const cached = db.sql.prepare<[], { n: number }>("SELECT count(*) AS n FROM calls WHERE source = 'synthetic_prod'").get();
if ((cached?.n ?? 0) > 0 && !values.force) {
  console.log(`${cached?.n} synthetic_prod calls already in ${values.db}; using them. Pass --force to regenerate.`);
  process.exit(0);
}
if (values.force) {
  // Children first: they reference calls.
  db.sql.exec(`
    DELETE FROM tool_calls WHERE call_id IN (SELECT id FROM calls WHERE source = 'synthetic_prod');
    DELETE FROM turns WHERE call_id IN (SELECT id FROM calls WHERE source = 'synthetic_prod');
    DELETE FROM judgments WHERE call_id IN (SELECT id FROM calls WHERE source = 'synthetic_prod');
    DELETE FROM calls WHERE source = 'synthetic_prod';`);
}

const versions = { stable: parsed(makePayment), candidate: parsed(makePaymentCandidate) };
const hashes = { stable: journeyHash(versions.stable), candidate: journeyHash(versions.candidate) };
const scenarios = new Map([...SCENARIOS, ...HUMAN_SCENARIOS].map((s) => [s.id, Scenario.parse(s)]));
const agent = anthropicModel({ model: process.env.AGENT_MODEL ?? "claude-haiku-5-5" });
const caller = anthropicCaller({ model: process.env.CALLER_MODEL ?? "claude-haiku-5-5" });
const articles = loadKnowledge("knowledge");
const log = fileCallLog("logs/calls.jsonl");

console.log(`seeding ${n} calls · candidate ${versions.candidate.version} at ${percent}% · stable ${versions.stable.version}`);

let done = 0;
await pool(
  Array.from({ length: n }, (_, i) => i),
  Number(process.env.SIM_CONCURRENCY ?? 4),
  async (i) => {
    const callId = `prod-${i}`; // fixed, so the rollout split is the same on every seed
    const arm = armFor(callId, percent);
    const scenario = scenarios.get(intentFor(i));
    if (scenario === undefined) throw new Error(`unknown scenario in MIX: ${intentFor(i)}`);
    const r = await runSim({ scenario, run: 1, journey: versions[arm], agent, caller, judge: null, articles, callId, log });
    db.saveCall({
      record: r.record,
      journeyHash: hashes[arm],
      endedAt: new Date().toISOString(),
      source: "synthetic_prod",
      csat: r.csat?.rating ?? null,
      judgments: [],
    });
    done += 1;
    console.log(`${String(done).padStart(3)}/${n} ${arm.padEnd(9)} ${scenario.id.padEnd(34)} ${r.record.outcome}${r.error === null ? "" : ` (harness error: ${r.error})`}`);
  },
);
db.close();
console.log(`\nsaved to ${values.db}. Next: npm run review`);
