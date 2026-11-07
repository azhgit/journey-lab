// CLAUDE-OWNED (M8). The weekly review: a ranked fix list, SPEC §10.
//   1. Safety and compliance failures first, whatever their count.
//   2. Then transferred calls grouped by (version, reason, the tool failure just before), biggest group first,
//      each with two example call ids and a transcript excerpt, so the investigation starts from evidence.
//   npm run review                      (synthetic_prod)
//   npm run review -- --source sim
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openDb, type Db } from "../db/db.js";
import { formatRows, loadQueries, runQuery } from "./queries.js";

export type FailureGroup = {
  journeyVersion: string;
  reason: string;
  trigger: string; // the last failed tool before the transfer, e.g. "makePayment: payment_failed"
  calls: string[];
  shareOfVersion: number; // calls in this group / all calls on that version
};

export type SafetyItem = { callId: string; journeyVersion: string; what: string };

type TransferRow = { id: string; journey_version: string; transfer_reason: string | null };
type FailedToolRow = { name: string; error_kind: string | null };

export function failureGroups(db: Db, source: string): FailureGroup[] {
  const totals = new Map(
    db.sql
      .prepare<{ source: string }, { v: string; n: number }>("SELECT journey_version AS v, COUNT(*) AS n FROM calls WHERE source = :source GROUP BY v")
      .all({ source })
      .map((r) => [r.v, r.n]),
  );
  const transferred = db.sql
    .prepare<{ source: string }, TransferRow>(
      "SELECT id, journey_version, transfer_reason FROM calls WHERE source = :source AND outcome = 'transferred' ORDER BY id",
    )
    .all({ source });
  const lastFailure = db.sql.prepare<[string], FailedToolRow>(
    `SELECT name, error_kind FROM tool_calls
     WHERE call_id = ? AND ok = 0 AND name NOT IN ('transferToHuman', 'endCall')
     ORDER BY id DESC LIMIT 1`,
  );

  const groups = new Map<string, FailureGroup>();
  for (const call of transferred) {
    const failed = lastFailure.get(call.id);
    const trigger = failed === undefined ? "no tool failure" : `${failed.name}: ${failed.error_kind ?? "?"}`;
    const reason = call.transfer_reason ?? "unknown";
    const key = `${call.journey_version}|${reason}|${trigger}`;
    const group = groups.get(key) ?? { journeyVersion: call.journey_version, reason, trigger, calls: [], shareOfVersion: 0 };
    group.calls.push(call.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, shareOfVersion: g.calls.length / (totals.get(g.journeyVersion) ?? g.calls.length) }))
    .sort((a, b) => b.calls.length - a.calls.length || b.shareOfVersion - a.shareOfVersion);
}

export function safetyItems(db: Db, source: string): SafetyItem[] {
  const judged = db.sql
    .prepare<{ source: string }, { call_id: string; v: string; kind: string; reason: string }>(
      `SELECT j.call_id, c.journey_version AS v, j.kind, j.reason FROM judgments j JOIN calls c ON c.id = j.call_id
       WHERE c.source = :source AND j.passed = 0 AND j.kind = 'hallucination'`,
    )
    .all({ source })
    .map((r) => ({ callId: r.call_id, journeyVersion: r.v, what: `hallucination: ${r.reason.split("\n")[0]?.slice(0, 160) ?? ""}` }));
  const sims = db.sql
    .prepare<{ source: string }, { call_id: string; v: string; scenario_id: string; failed_checks: string }>(
      `SELECT s.call_id, c.journey_version AS v, s.scenario_id, s.failed_checks FROM sim_results s JOIN calls c ON c.id = s.call_id
       WHERE c.source = :source AND s.safety_critical = 1 AND s.passed = 0`,
    )
    .all({ source })
    .map((r) => ({ callId: r.call_id, journeyVersion: r.v, what: `safety scenario ${r.scenario_id} failed: ${r.failed_checks}` }));
  return [...judged, ...sims];
}

function excerpt(db: Db, callId: string, lines = 4): string {
  const turns = db.sql
    .prepare<[string], { role: string; text_redacted: string }>("SELECT role, text_redacted FROM turns WHERE call_id = ? ORDER BY idx")
    .all(callId);
  return turns
    .slice(-lines)
    .map((t) => `      ${t.role.padEnd(8)} ${t.text_redacted.replaceAll("\n", " ").slice(0, 140)}`)
    .join("\n");
}

export function weeklyReview(db: Db, source: string): string {
  const out: string[] = [`# Weekly review (source = ${source})`];
  const queries = loadQueries();
  out.push("", "## Containment by version", formatRows(runQuery(db, queries, "containment_by_version", source)));

  let rank = 0;
  out.push("", "## Fix list (ranked)");
  const safety = safetyItems(db, source);
  for (const s of safety) {
    rank += 1;
    out.push(`${rank}. [SAFETY] ${s.journeyVersion} · ${s.what}`, `   example: ${s.callId}`, excerpt(db, s.callId));
  }
  if (safety.length === 0) out.push("(no safety or compliance failures among judged calls)");

  for (const g of failureGroups(db, source)) {
    rank += 1;
    out.push(
      `${rank}. ${g.journeyVersion} · transfer ${g.reason} after ${g.trigger} · ${g.calls.length} calls (${Math.round(g.shareOfVersion * 100)}% of ${g.journeyVersion})`,
      ...g.calls.slice(0, 2).flatMap((id) => [`   example: ${id}`, excerpt(db, id)]),
    );
  }
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: { source: { type: "string", default: "synthetic_prod" }, db: { type: "string", default: "data/journey-lab.db" } },
  });
  const db = openDb(values.db);
  console.log(weeklyReview(db, values.source));
  db.close();
}
