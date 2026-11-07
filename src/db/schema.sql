-- CLAUDE-OWNED (M7). SPEC §10, plus journey_versions (Q13) and gate tables (M7).
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  journey_version TEXT NOT NULL,
  journey_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  outcome TEXT,                -- resolved | transferred | abandoned, decided by code
  transfer_reason TEXT,
  auth_tier_final INTEGER NOT NULL,
  turns INTEGER NOT NULL,      -- caller turns
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  sim_csat INTEGER,            -- 1..5 from the simulated caller; a proxy, never a gate input
  source TEXT NOT NULL CHECK (source IN ('sim', 'manual', 'synthetic_prod')),
  identity_at_start TEXT,      -- caller_id | none; judge evidence
  handoff_json TEXT            -- the HandoffPayload, summary redacted; what the transfer-quality judge judged
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  name TEXT NOT NULL,
  executed INTEGER NOT NULL,   -- 0: blocked by the runner (tier, confirmation, unknown tool, bad input)
  ok INTEGER NOT NULL,
  error_kind TEXT,
  latency_ms INTEGER NOT NULL,
  input_json TEXT,             -- every string redacted except ids (codes, summaries)
  result_json TEXT             -- exactly what the model saw (tools never return phones, codes or full account numbers)
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  idx INTEGER NOT NULL,
  role TEXT NOT NULL,          -- caller | agent | verbatim
  line_id TEXT,                -- verbatim line id
  text_redacted TEXT NOT NULL,
  latency_ms INTEGER
);

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  kind TEXT NOT NULL CHECK (kind IN ('hallucination', 'transfer_quality')),
  passed INTEGER NOT NULL,
  reason TEXT NOT NULL,
  human_label INTEGER          -- set during judge calibration (docs/judge-calibration.md)
);

CREATE TABLE IF NOT EXISTS journey_versions (
  journey_id TEXT NOT NULL,
  version TEXT NOT NULL,
  hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (journey_id, version)
);

CREATE TABLE IF NOT EXISTS gate_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  journey_version TEXT NOT NULL,
  journey_hash TEXT NOT NULL,
  passed INTEGER NOT NULL,
  pass_rate REAL NOT NULL,
  cost_usd REAL
);

CREATE TABLE IF NOT EXISTS sim_results (
  call_id TEXT PRIMARY KEY REFERENCES calls(id),
  gate_run_id TEXT NOT NULL REFERENCES gate_runs(id),
  scenario_id TEXT NOT NULL,
  safety_critical INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed_checks TEXT NOT NULL  -- JSON array of check names
);
