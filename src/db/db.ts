// CLAUDE-OWNED (M7). SQLite persistence for sim runs (and, in M8, synthetic production calls). SPEC §10.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CallRecord, TurnLogEntry } from "../journey/runner.js";
import { AuthTierSchema, HandoffReason } from "../journey/schema.js";

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

// Six or more digits, with optional spaces or dashes between them: codes, phone numbers, account numbers.
export function redact(text: string): string {
  return text.replace(/\+?(?:\d[\s-]?){5,}\d/g, "[digits]");
}

// Every string in a tool input is redacted like a turn (a step-up code, a summary quoting the caller), except
// ids. Amounts are numbers, so they keep all their digits: redact() on the whole JSON would eat 845300.
export function redactToolInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, typeof v === "string" && !k.endsWith("Id") ? redact(v) : v]),
  );
}

// Columns added after the first schema. CREATE TABLE IF NOT EXISTS leaves an older table as it was, so they are
// added here; rows written before them read NULL.
const ADDED_COLUMNS: Array<[table: string, column: string]> = [
  ["calls", "identity_at_start TEXT"],
  ["calls", "handoff_json TEXT"],
  ["tool_calls", "input_json TEXT"],
  ["tool_calls", "result_json TEXT"],
];

function addMissingColumns(db: Database.Database): void {
  for (const [table, column] of ADDED_COLUMNS) {
    const name = column.split(" ")[0];
    const existing = db.prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`).all();
    if (!existing.some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
}

export const StoredHandoff = z.object({
  callId: z.string(),
  journeyId: z.string(),
  journeyVersion: z.string(),
  reason: HandoffReason,
  queue: z.string(),
  authTier: AuthTierSchema,
  verifiedBy: z.enum(["caller_id", "step_up", "none"]),
  loanId: z.string().nullable(),
  summary: z.string(),
  summaryBy: z.enum(["model", "code", "model_and_code"]),
});

type CallRow = {
  journey_id: string;
  journey_version: string;
  started_at: string;
  outcome: "resolved" | "transferred" | "abandoned" | null;
  auth_tier_final: number;
  turns: number;
  identity_at_start: string | null;
  handoff_json: string | null;
};
type ToolRow = { name: string; executed: number; ok: number; error_kind: string | null; latency_ms: number; input_json: string | null; result_json: string | null };
type TurnRow = { role: string; line_id: string | null; text_redacted: string; latency_ms: number | null };

function turnFromRow(t: TurnRow): TurnLogEntry {
  if (t.role === "verbatim") return { role: "verbatim", lineId: t.line_id ?? "", text: t.text_redacted };
  if (t.role === "agent") return { role: "agent", text: t.text_redacted, latencyMs: t.latency_ms ?? 0 };
  return { role: "caller", text: t.text_redacted };
}

export type StoredJudgment = { kind: "hallucination" | "transfer_quality"; passed: boolean; reason: string };

export type StoredCall = {
  record: CallRecord;
  journeyHash: string;
  endedAt: string;
  source: "sim" | "manual" | "synthetic_prod";
  csat: number | null;
  judgments: StoredJudgment[];
};

export type StoredSimResult = { callId: string; scenarioId: string; safetyCritical: boolean; passed: boolean; failedChecks: string[] };

export type GateRunRow = {
  id: string;
  startedAt: string;
  journeyId: string;
  journeyVersion: string;
  journeyHash: string;
  passed: boolean;
  passRate: number;
  costUsd: number | null;
};

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  addMissingColumns(db);

  const insertCall = db.prepare(`INSERT INTO calls
    (id, journey_id, journey_version, journey_hash, started_at, ended_at, outcome, transfer_reason,
     auth_tier_final, turns, input_tokens, output_tokens, sim_csat, source, identity_at_start, handoff_json)
    VALUES (@id, @journeyId, @journeyVersion, @journeyHash, @startedAt, @endedAt, @outcome, @transferReason,
     @authTierFinal, @turns, @inputTokens, @outputTokens, @csat, @source, @identityAtStart, @handoffJson)`);
  const insertTool = db.prepare(`INSERT INTO tool_calls (call_id, name, executed, ok, error_kind, latency_ms, input_json, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertTurn = db.prepare(`INSERT INTO turns (call_id, idx, role, line_id, text_redacted, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertJudgment = db.prepare(`INSERT INTO judgments (call_id, kind, passed, reason) VALUES (?, ?, ?, ?)`);
  const insertGateRun = db.prepare(`INSERT INTO gate_runs
    (id, started_at, journey_id, journey_version, journey_hash, passed, pass_rate, cost_usd)
    VALUES (@id, @startedAt, @journeyId, @journeyVersion, @journeyHash, @passed, @passRate, @costUsd)`);
  const insertSimResult = db.prepare(`INSERT INTO sim_results
    (call_id, gate_run_id, scenario_id, safety_critical, passed, failed_checks) VALUES (?, ?, ?, ?, ?, ?)`);
  const selectHash = db.prepare<[string, string], { hash: string }>(
    `SELECT hash FROM journey_versions WHERE journey_id = ? AND version = ?`,
  );
  const insertVersion = db.prepare(
    `INSERT OR IGNORE INTO journey_versions (journey_id, version, hash, first_seen) VALUES (?, ?, ?, ?)`,
  );

  const selectCall = db.prepare<[string], CallRow>(
    `SELECT journey_id, journey_version, started_at, outcome, auth_tier_final, turns, identity_at_start, handoff_json
     FROM calls WHERE id = ?`,
  );
  const selectTools = db.prepare<[string], ToolRow>(
    "SELECT name, executed, ok, error_kind, latency_ms, input_json, result_json FROM tool_calls WHERE call_id = ? ORDER BY id",
  );
  const selectTurns = db.prepare<[string], TurnRow>(
    "SELECT role, line_id, text_redacted, latency_ms FROM turns WHERE call_id = ? ORDER BY idx",
  );

  function saveCall(c: StoredCall): void {
    const r = c.record;
    // All input tokens, whatever their price; cost is computed separately from the split usage.
    const inputTokens = r.usage.inputTokens + r.usage.cacheWriteTokens + r.usage.cacheReadTokens;
    insertCall.run({
      id: r.callId,
      journeyId: r.journeyId,
      journeyVersion: r.journeyVersion,
      journeyHash: c.journeyHash,
      startedAt: r.startedAt,
      endedAt: c.endedAt,
      outcome: r.outcome,
      transferReason: r.handoff?.reason ?? null,
      authTierFinal: r.authTierFinal,
      turns: r.callerTurns,
      inputTokens,
      outputTokens: r.usage.outputTokens,
      csat: c.csat,
      source: c.source,
      identityAtStart: r.identityAtStart,
      handoffJson: r.handoff === null ? null : JSON.stringify({ ...r.handoff, summary: redact(r.handoff.summary) }),
    });
    for (const t of r.toolCalls) {
      const input = JSON.stringify(redactToolInput(t.input));
      insertTool.run(r.callId, t.name, t.executed ? 1 : 0, t.ok ? 1 : 0, t.errorKind, t.latencyMs, input, t.result);
    }
    r.turns.forEach((t, i) =>
      insertTurn.run(r.callId, i, t.role, t.role === "verbatim" ? t.lineId : null, redact(t.text), t.role === "agent" ? t.latencyMs : null),
    );
    for (const j of c.judgments) insertJudgment.run(r.callId, j.kind, j.passed ? 1 : 0, j.reason);
  }

  return {
    // The hash first stored for this journey version (Q13), or null if the version is new.
    recordedHash(journeyId: string, version: string): string | null {
      return selectHash.get(journeyId, version)?.hash ?? null;
    },

    recordVersion(journeyId: string, version: string, hash: string, now: string): void {
      insertVersion.run(journeyId, version, hash, now);
    },

    saveCall: (c: StoredCall) => db.transaction(() => saveCall(c))(),

    // One transaction: a gate run is stored completely or not at all.
    saveGateRun: db.transaction((run: GateRunRow, calls: Array<StoredCall & { sim: StoredSimResult }>) => {
      insertGateRun.run({ ...run, passed: run.passed ? 1 : 0 });
      for (const c of calls) {
        saveCall(c);
        insertSimResult.run(c.sim.callId, run.id, c.sim.scenarioId, c.sim.safetyCritical ? 1 : 0, c.sim.passed ? 1 : 0, JSON.stringify(c.sim.failedChecks));
      }
    }),

    // What the judge reads, rebuilt from storage (redacted as stored), so a judgment can be run again after a judge
    // change. Null when the call is missing or was stored before its evidence was. Fields the judge never reads
    // (channel, end reason, guardrail events, usage) are defaults.
    loadCallRecord(callId: string): CallRecord | null {
      const c = selectCall.get(callId);
      if (c === undefined || (c.identity_at_start !== "caller_id" && c.identity_at_start !== "none")) return null;
      const tools = selectTools.all(callId);
      if (tools.some((t) => t.input_json === null || t.result_json === null)) return null;
      return {
        callId,
        journeyId: c.journey_id,
        journeyVersion: c.journey_version,
        channel: "voice",
        startedAt: c.started_at,
        identityAtStart: c.identity_at_start,
        endReason: null,
        outcome: c.outcome,
        handoff: c.handoff_json === null ? null : StoredHandoff.parse(JSON.parse(c.handoff_json)),
        authTierFinal: AuthTierSchema.parse(c.auth_tier_final),
        callerTurns: c.turns,
        turns: selectTurns.all(callId).map(turnFromRow),
        toolCalls: tools.map((t) => ({
          name: t.name,
          input: JSON.parse(t.input_json ?? "null"),
          result: t.result_json ?? "",
          executed: t.executed === 1,
          ok: t.ok === 1,
          errorKind: t.error_kind,
          latencyMs: t.latency_ms,
        })),
        guardrailEvents: [],
        usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      };
    },

    sql: db, // for analytics queries (M8)
    close: () => db.close(),
  };
}
