// CLAUDE-OWNED (M10). Read-only queries for the viewer API, over the same SQLite file the gate and the weekly
// review write (src/db/schema.sql). Nothing here writes.
import type Database from "better-sqlite3";
import { StoredHandoff } from "../db/db.js";
import { provenance, spokenIn, type SpokenSource } from "./provenance.js";
import type {
  CallDetail,
  CallPage,
  CallSummary,
  GateResult,
  GateRun,
  GateRunDetail,
  IncidentArm,
  Judgment,
  JudgmentBrief,
  Outcome,
  Release,
  Source,
  Summary,
  ToolCall,
  Turn,
} from "./types.js";

type CallRow = {
  id: string;
  source: Source;
  journey_version: string;
  started_at: string;
  ended_at: string;
  outcome: Outcome | null;
  transfer_reason: string | null;
  turns: number;
  auth_tier_final: number;
  sim_csat: number | null;
  identity_at_start: string | null;
  handoff_json: string | null;
  input_tokens: number;
  output_tokens: number;
  gate_run_id: string | null;
  scenario_id: string | null;
  sim_passed: number | null;
  failed_checks: string | null;
  missing_evidence: number;
};

type GateRunRow = {
  id: string;
  started_at: string;
  journey_version: string;
  journey_hash: string;
  passed: number;
  pass_rate: number;
  cost_usd: number | null;
  runs: number;
  failed_runs: number;
  safety_failures: number;
  failed_scenarios: string | null;
};

const parse = (json: string | null): unknown => (json === null ? null : JSON.parse(json));
const checks = (json: string | null): string[] => {
  const v = parse(json);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

const CALL_COLUMNS = `c.id, c.source, c.journey_version, c.started_at, c.ended_at, c.outcome, c.transfer_reason, c.turns,
  c.auth_tier_final, c.sim_csat, c.identity_at_start, c.handoff_json, c.input_tokens, c.output_tokens,
  s.gate_run_id, s.scenario_id, s.passed AS sim_passed, s.failed_checks,
  (SELECT COUNT(*) FROM tool_calls t WHERE t.call_id = c.id AND (t.input_json IS NULL OR t.result_json IS NULL)) AS missing_evidence`;

export type CallFilter = {
  source?: Source;
  version?: string;
  outcome?: Outcome;
  gateRunId?: string;
  q?: string; // matches the call id or the scenario id
  limit?: number;
  offset?: number;
};

export function createViewerData(db: Database.Database) {
  const judgmentsOf = db.prepare<[string], { kind: JudgmentBrief["kind"]; passed: number; reason: string; human_label: number | null }>(
    "SELECT kind, passed, reason, human_label FROM judgments WHERE call_id = ? ORDER BY id",
  );

  // A call judged more than once (a re-run after a judge change) shows its latest verdict per kind.
  function latestJudgments(callId: string): Judgment[] {
    const byKind = new Map<string, Judgment>();
    for (const j of judgmentsOf.all(callId)) {
      byKind.set(j.kind, { kind: j.kind, passed: j.passed === 1, reason: j.reason, humanLabel: j.human_label === null ? null : j.human_label === 1 });
    }
    return [...byKind.values()];
  }

  function summaryOf(r: CallRow): CallSummary {
    return {
      id: r.id,
      source: r.source,
      version: r.journey_version,
      startedAt: r.started_at,
      outcome: r.outcome,
      transferReason: r.transfer_reason,
      callerTurns: r.turns,
      authTierFinal: r.auth_tier_final,
      csat: r.sim_csat,
      gateRunId: r.gate_run_id,
      scenarioId: r.scenario_id,
      simPassed: r.sim_passed === null ? null : r.sim_passed === 1,
      judgments: latestJudgments(r.id).map(({ kind, passed }) => ({ kind, passed })),
      hasEvidence: r.identity_at_start !== null && r.missing_evidence === 0,
    };
  }

  const gateRunsQuery = `SELECT g.id, g.started_at, g.journey_version, g.journey_hash, g.passed, g.pass_rate, g.cost_usd,
      COUNT(s.call_id) AS runs,
      COALESCE(SUM(CASE WHEN s.passed = 0 THEN 1 ELSE 0 END), 0) AS failed_runs,
      COALESCE(SUM(CASE WHEN s.passed = 0 AND s.safety_critical = 1 THEN 1 ELSE 0 END), 0) AS safety_failures,
      (SELECT GROUP_CONCAT(DISTINCT f.scenario_id) FROM sim_results f WHERE f.gate_run_id = g.id AND f.passed = 0) AS failed_scenarios
    FROM gate_runs g LEFT JOIN sim_results s ON s.gate_run_id = g.id`;

  function releases(): Release[] {
    const rows = db
      .prepare<[], { version: string; hash: string; first_seen: string; released_by: string | null }>(
        `SELECT v.version, v.hash, v.first_seen,
           (SELECT g.id FROM gate_runs g WHERE g.journey_version = v.version AND g.journey_hash = v.hash AND g.passed = 1
            ORDER BY g.started_at LIMIT 1) AS released_by
         FROM journey_versions v ORDER BY v.first_seen`,
      )
      .all();
    return rows.map((r) => ({ version: r.version, hash: r.hash, firstSeen: r.first_seen, releasedBy: r.released_by }));
  }

  function gateRuns(): GateRun[] {
    const releasing = new Set(releases().flatMap((r) => (r.releasedBy === null ? [] : [r.releasedBy])));
    return db
      .prepare<[], GateRunRow>(`${gateRunsQuery} GROUP BY g.id ORDER BY g.started_at`)
      .all()
      .map((g) => ({
        id: g.id,
        startedAt: g.started_at,
        version: g.journey_version,
        hash: g.journey_hash,
        passed: g.passed === 1,
        passRate: g.pass_rate,
        costUsd: g.cost_usd,
        runs: g.runs,
        failedRuns: g.failed_runs,
        safetyFailures: g.safety_failures,
        releases: releasing.has(g.id),
        failedScenarios: g.failed_scenarios === null ? [] : g.failed_scenarios.split(",").sort(),
      }));
  }

  return {
    summary(): Summary {
      const count = (sql: string) => db.prepare<[], { n: number }>(sql).get()?.n ?? 0;
      const bySource: Record<Source, number> = { sim: 0, manual: 0, synthetic_prod: 0 };
      for (const r of db.prepare<[], { source: Source; n: number }>("SELECT source, COUNT(*) AS n FROM calls GROUP BY source").all()) {
        bySource[r.source] = r.n;
      }
      const period = db.prepare<[], { from: string | null; to: string | null }>("SELECT MIN(started_at) AS \"from\", MAX(ended_at) AS \"to\" FROM calls").get();
      const runs = gateRuns();
      const rel = releases();
      const latest = rel.filter((r) => r.releasedBy !== null).at(-1);
      const latestRun = latest === undefined ? undefined : runs.filter((g) => g.version === latest.version && g.passed).at(-1);
      return {
        journeyId: db.prepare<[], { j: string }>("SELECT journey_id AS j FROM calls LIMIT 1").get()?.j ?? "make-payment",
        period: { from: period?.from ?? "", to: period?.to ?? "" },
        calls: {
          total: count("SELECT COUNT(*) AS n FROM calls"),
          bySource,
          withEvidence: count(
            `SELECT COUNT(*) AS n FROM calls c WHERE c.identity_at_start IS NOT NULL AND NOT EXISTS
               (SELECT 1 FROM tool_calls t WHERE t.call_id = c.id AND (t.input_json IS NULL OR t.result_json IS NULL))`,
          ),
        },
        toolCalls: count("SELECT COUNT(*) AS n FROM tool_calls"),
        judgments: count("SELECT COUNT(*) AS n FROM judgments"),
        gateRuns: { total: runs.length, passed: runs.filter((g) => g.passed).length },
        releases: rel,
        versions: db.prepare<[], { v: string }>("SELECT DISTINCT journey_version AS v FROM calls ORDER BY v").all().map((r) => r.v),
        current:
          latest === undefined || latestRun === undefined
            ? null
            : { version: latest.version, gateRunId: latestRun.id, passed: latestRun.runs - latestRun.failedRuns, runs: latestRun.runs },
      };
    },

    gateRuns,

    incident(): IncidentArm[] {
      const arms = db
        .prepare<[], { version: string; calls: number; transferred: number }>(
          `SELECT journey_version AS version, COUNT(*) AS calls, SUM(outcome = 'transferred') AS transferred
           FROM calls WHERE source = 'synthetic_prod' GROUP BY journey_version ORDER BY journey_version`,
        )
        .all();
      const reasons = db.prepare<[string], { reason: string; calls: number }>(
        `SELECT transfer_reason AS reason, COUNT(*) AS calls FROM calls
         WHERE source = 'synthetic_prod' AND outcome = 'transferred' AND journey_version = ? GROUP BY transfer_reason ORDER BY calls DESC`,
      );
      const ids = db.prepare<[string], { id: string }>(
        "SELECT id FROM calls WHERE source = 'synthetic_prod' AND outcome = 'transferred' AND journey_version = ? ORDER BY id",
      );
      return arms.map((a) => ({
        ...a,
        containment: a.calls === 0 ? 0 : (a.calls - a.transferred) / a.calls,
        reasons: reasons.all(a.version),
        transferredCallIds: ids.all(a.version).map((r) => r.id),
      }));
    },

    gateRun(id: string): GateRunDetail | null {
      const run = gateRuns().find((g) => g.id === id);
      if (run === undefined) return null;
      const rows = db
        .prepare<[string], { call_id: string; scenario_id: string; safety_critical: number; passed: number; failed_checks: string; outcome: Outcome | null; transfer_reason: string | null }>(
          `SELECT s.call_id, s.scenario_id, s.safety_critical, s.passed, s.failed_checks, c.outcome, c.transfer_reason
           FROM sim_results s JOIN calls c ON c.id = s.call_id WHERE s.gate_run_id = ? ORDER BY s.scenario_id, s.call_id`,
        )
        .all(id);
      const results: GateResult[] = rows.map((r) => ({
        callId: r.call_id,
        scenarioId: r.scenario_id,
        safetyCritical: r.safety_critical === 1,
        passed: r.passed === 1,
        failedChecks: checks(r.failed_checks),
        outcome: r.outcome,
        transferReason: r.transfer_reason,
        judgments: latestJudgments(r.call_id).map(({ kind, passed }) => ({ kind, passed })),
      }));
      return { ...run, results };
    },

    calls(f: CallFilter = {}): CallPage {
      const where: string[] = [];
      const params: Record<string, string | number> = {};
      const add = (sql: string, name: string, value: string) => {
        where.push(sql);
        params[name] = value;
      };
      if (f.source !== undefined) add("c.source = @source", "source", f.source);
      if (f.version !== undefined) add("c.journey_version = @version", "version", f.version);
      if (f.outcome !== undefined) add("c.outcome = @outcome", "outcome", f.outcome);
      if (f.gateRunId !== undefined) add("s.gate_run_id = @gateRunId", "gateRunId", f.gateRunId);
      if (f.q !== undefined && f.q !== "") add("(c.id LIKE @q OR s.scenario_id LIKE @q)", "q", `%${f.q}%`);
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const from = "FROM calls c LEFT JOIN sim_results s ON s.call_id = c.id LEFT JOIN gate_runs g ON g.id = s.gate_run_id";
      const total = db.prepare<Record<string, string | number>, { n: number }>(`SELECT COUNT(*) AS n ${from} ${clause}`).get(params)?.n ?? 0;
      const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
      const offset = Math.max(f.offset ?? 0, 0);
      // Sims run on a fixed clock, so a sim call's own started_at says nothing; its gate run's does.
      const items = db
        .prepare<Record<string, string | number>, CallRow>(
          `SELECT ${CALL_COLUMNS} ${from} ${clause} ORDER BY COALESCE(g.started_at, c.started_at) DESC, c.id LIMIT ${limit} OFFSET ${offset}`,
        )
        .all(params)
        .map(summaryOf);
      return { total, items };
    },

    call(id: string): CallDetail | null {
      const row = db
        .prepare<[string], CallRow>(`SELECT ${CALL_COLUMNS} FROM calls c LEFT JOIN sim_results s ON s.call_id = c.id WHERE c.id = ?`)
        .get(id);
      if (row === undefined) return null;

      const toolCalls: ToolCall[] = db
        .prepare<[string], { name: string; executed: number; ok: number; error_kind: string | null; latency_ms: number; input_json: string | null; result_json: string | null }>(
          "SELECT name, executed, ok, error_kind, latency_ms, input_json, result_json FROM tool_calls WHERE call_id = ? ORDER BY id",
        )
        .all(id)
        .map((t, seq) => {
          const result = parse(t.result_json);
          return {
            seq,
            name: t.name,
            executed: t.executed === 1,
            ok: t.ok === 1,
            errorKind: t.error_kind,
            latencyMs: t.latency_ms,
            input: parse(t.input_json),
            result,
            spoken: spokenIn(result),
          };
        });
      const sources: SpokenSource[] = toolCalls.filter((t) => t.spoken.length > 0).map(({ seq, name, spoken }) => ({ seq, name, spoken }));

      const resultsStored = toolCalls.every((t) => t.result !== null);
      let cursor = 0;
      const turns: Turn[] = db
        .prepare<[string], { idx: number; role: string; line_id: string | null; text_redacted: string; latency_ms: number | null }>(
          "SELECT idx, role, line_id, text_redacted, latency_ms FROM turns WHERE call_id = ? ORDER BY idx",
        )
        .all(id)
        .map((t): Turn => {
          if (t.role === "agent") {
            if (!resultsStored) {
              return { idx: t.idx, role: "agent", text: t.text_redacted, latencyMs: t.latency_ms, spans: [{ text: t.text_redacted, from: { kind: "unknown" } }] };
            }
            const p = provenance(t.text_redacted, sources, cursor);
            cursor = p.cursor;
            return { idx: t.idx, role: "agent", text: t.text_redacted, latencyMs: t.latency_ms, spans: p.spans };
          }
          if (t.role === "verbatim") {
            // A read-back is a tool's spoken text said by the runner: link it to the tool it came from.
            const src = sources.find((s) => s.seq >= cursor && s.spoken.includes(t.text_redacted)) ?? sources.find((s) => s.spoken.includes(t.text_redacted));
            if (src !== undefined) cursor = Math.max(cursor, src.seq);
            return { idx: t.idx, role: "verbatim", lineId: t.line_id ?? "", text: t.text_redacted, fromToolSeq: src?.seq ?? null };
          }
          return { idx: t.idx, role: "caller", text: t.text_redacted };
        });

      const handoff = row.handoff_json === null ? null : StoredHandoff.parse(JSON.parse(row.handoff_json));
      return {
        ...summaryOf(row),
        endedAt: row.ended_at,
        identityAtStart: row.identity_at_start,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        handoff,
        turns,
        toolCalls,
        judgmentsFull: latestJudgments(id),
        failedChecks: checks(row.failed_checks),
      };
    },
  };
}

export type ViewerData = ReturnType<typeof createViewerData>;
