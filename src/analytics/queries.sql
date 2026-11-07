-- HUMAN-OWNED (M8), written by Claude at Andrew's request. SPEC §10. Run them all: npm run queries
-- Each query starts with "-- name: <id>" and takes :source ('sim', 'manual' or 'synthetic_prod').
-- weeklyReview.ts runs these same queries by name, so the numbers in the review and here always match.

-- name: containment_by_version
-- Containment = share of calls not transferred to a human. The headline metric for a version.
SELECT journey_id,
       journey_version,
       COUNT(*)                                        AS calls,
       SUM(outcome = 'transferred')                    AS transferred,
       ROUND(100.0 * AVG(outcome <> 'transferred'), 1) AS containment_pct
FROM calls
WHERE source = :source
GROUP BY journey_id, journey_version
ORDER BY journey_id, journey_version;

-- name: transfer_reasons_by_version
-- Why calls left the agent, most common first within each version.
SELECT journey_version,
       transfer_reason,
       COUNT(*) AS calls,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY journey_version), 1) AS pct_of_transfers
FROM calls
WHERE source = :source AND outcome = 'transferred'
GROUP BY journey_version, transfer_reason
ORDER BY journey_version, calls DESC;

-- name: tool_errors
-- Error rate per tool and error kind. Blocked calls (tier, confirmation, unknown tool) count as their own kind.
SELECT t.name AS tool,
       CASE WHEN t.ok = 1 THEN 'ok' WHEN t.executed = 0 THEN 'blocked:' || t.error_kind ELSE t.error_kind END AS result,
       COUNT(*) AS calls,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY t.name), 1) AS pct_of_tool
FROM tool_calls t
JOIN calls c ON c.id = t.call_id
WHERE c.source = :source
GROUP BY tool, result
ORDER BY tool, calls DESC;

-- name: turns_per_resolved_call
-- Caller turns per resolved call: average and p95 (nearest rank). A rising p95 means callers work harder.
WITH ranked AS (
  SELECT journey_version,
         turns,
         ROW_NUMBER() OVER (PARTITION BY journey_version ORDER BY turns) AS rn,
         COUNT(*)     OVER (PARTITION BY journey_version)                AS n
  FROM calls
  WHERE source = :source AND outcome = 'resolved'
)
SELECT journey_version,
       COUNT(*)                                      AS resolved_calls,
       ROUND(AVG(turns), 1)                          AS avg_turns,
       MIN(CASE WHEN rn * 100 >= 95 * n THEN turns END) AS p95_turns
FROM ranked
GROUP BY journey_version
ORDER BY journey_version;

-- name: transfer_quality_by_version
-- Pass rate of the transfer-quality judge. Only judged calls appear (all sims; production only if sampled).
SELECT c.journey_version,
       COUNT(*)                     AS judged,
       ROUND(100.0 * AVG(j.passed), 1) AS pass_pct
FROM judgments j
JOIN calls c ON c.id = j.call_id
WHERE c.source = :source AND j.kind = 'transfer_quality'
GROUP BY c.journey_version
ORDER BY c.journey_version;
