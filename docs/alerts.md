# Alerts

Described, not wired. Call logs are JSON lines (`logs/calls.jsonl`: `callId`, `journeyId`,
`journeyVersion`, `event`, `tool`, `latencyMs`, `ok`, `errorKind`, `tier`), so any log tool could evaluate these.
The SQL below runs on this repo's SQLite store and shows the exact rule.

Every alert's first action is the same, because it is cheap and reversible: **set `CANDIDATE_PERCENT=0`** if the
signal is on the candidate. 0 sends every call to stable; the split is by a hash of the call id, so a call never
changes version partway through.

## 1. No calls recorded for 24 hours

- **Why**: silence looks like health. A broken deploy, a routing change, or a dead log pipeline all show as "no
  errors".
- **Rule**: no `call_started` event in 24 hours during business hours (`knowledge/business-hours.md`).
  ```sql
  SELECT MAX(started_at) AS last_call FROM calls WHERE source <> 'sim';
  -- alert when last_call < now - 24h
  ```
- **Severity**: page.
- **Action**: check that calls reach the runner at all (contact-center routing, then the runner's process, then the
  log pipeline). If it started with a candidate ramp, `CANDIDATE_PERCENT=0`.

## 2. Transfer rate jump on a version (last 20 calls)

- **Why**: containment is the headline metric, and a regression shows up here first (`docs/incident-drill.md`).
- **Rule**: on any version, the transfer rate over its last 20 calls is more than 15 points above stable's rate
  over the last 7 days, and at least 5 of those 20 transferred (so 1 of 2 does not fire it).
  ```sql
  WITH recent AS (
    SELECT journey_version, outcome,
           ROW_NUMBER() OVER (PARTITION BY journey_version ORDER BY started_at DESC) AS rn
    FROM calls WHERE source <> 'sim'
  )
  SELECT journey_version,
         COUNT(*) AS last_calls,
         SUM(outcome = 'transferred') AS transferred,
         ROUND(100.0 * AVG(outcome = 'transferred'), 1) AS transfer_pct
  FROM recent WHERE rn <= 20
  GROUP BY journey_version;
  -- compare each row to stable's 7-day transfer_pct
  ```
- **Severity**: notify the journey owner; page if it is on 100% of traffic.
- **Action**: `CANDIDATE_PERCENT=0`, then `npm run review` and follow the drill.

## 3. Any hallucination or verbatim mismatch

- **Why**: a single invented promise or a missing required disclosure is a compliance event, not a quality dip.
  Counts don't matter; one is enough.
- **Rule**: any failed `hallucination` judgment on a sampled production call, or any call that did not say a
  required verbatim line:
  ```sql
  -- every call must open with the disclosure
  SELECT c.id, c.journey_version FROM calls c
  WHERE c.source <> 'sim'
    AND NOT EXISTS (SELECT 1 FROM turns t WHERE t.call_id = c.id AND t.line_id = 'greeting_disclosure');

  -- judged production calls that failed
  SELECT c.id, c.journey_version, j.reason FROM judgments j JOIN calls c ON c.id = j.call_id
  WHERE c.source <> 'sim' AND j.kind = 'hallucination' AND j.passed = 0;
  ```
  Also watch `event: "guardrail"` with `action: "fallback"` in the logs: the agent hit a `never_say` rule twice in a
  row. The customer heard the safe line, but the model is pushing against a rule.
- **Severity**: page on one.
- **Action**: `CANDIDATE_PERCENT=0` if the version is a candidate. Pull the transcript, decide whether it is a
  prompt fix, a new `never_say` guardrail (with should/should-not examples), or a code check. Add a scenario that
  reproduces it before fixing, so the gate proves the fix.

## Not built here

Sampling production calls for the judge (alert 3 needs it), a real scheduler, and a pager. The past-due notice
can't be checked from the store yet because loan status is not recorded per call; recording `loanStatus` on the
`on_loan_identified` event would make "past-due call without `delinquent_notice`" a one-line query.
