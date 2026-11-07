# Incident drill: containment dropped on the candidate

A rehearsal of the most common day-to-day incident: a journey change ships at a staged percentage and quietly
makes things worse. The candidate `make-payment@1.1.0` (`journeys/make-payment.candidate.ts`) carries one intended
improvement (shorter replies) and one planted regression: after a declined payment it transfers instead of offering
another linked account. It shipped on a partial gate run (`--only`) that skipped the scenario covering declines.

Numbers below are from the seeded run in this repo (60 calls, candidate at 20%). Yours will differ slightly: the
caller and agent are live models, but the rollout split and the intent mix are fixed, so the shape is stable.

## 0. Setup (once, ~$0.10, cached afterwards)

```bash
npm run seed:incident          # 60 synthetic_prod calls, CANDIDATE_PERCENT=20 → 11 on 1.1.0, 49 on 1.0.0
```

## 1. Notice the alert

Alert 2 in `docs/alerts.md` (transfer rate per version over the last 20 calls) fires for `1.1.0`.
Do not start by reading prompts. Start by sizing it.

## 2. Query: is it real, and where?

```bash
npm run queries                # all five queries in src/analytics/queries.sql
```

| version | calls | transferred | containment |
|---|---|---|---|
| 1.0.0 (stable) | 49 | 5 | 89.8% |
| 1.1.0 (candidate) | 11 | 5 | 54.5% |

`transfer_reasons_by_version` shows `tool_failure` dominating on 1.1.0. `tool_errors` shows `makePayment:
payment_failed`. The tool failed the same way on stable; what differs is what the agent did next.

## 3. Read transcripts

```bash
npm run review
```

The weekly review ranks the group first: **1.1.0 · transfer tool_failure after makePayment: payment_failed · 5
calls (45% of 1.1.0)**, with two example calls. In both, the read-back is confirmed, the payment is declined, and
the very next thing is the transfer notice: no offer of the other linked account. On stable, the same decline is
followed by "Would you like to try the Cedar Credit Union account?" and the call resolves.

## 4. Identify the cause

`git diff` between the two journey versions (or `journeys/make-payment.candidate.ts`): the new line
"A declined payment is a sensitive moment: apologize and transfer the customer to a team member."

Ask why the gate missed it before blaming the line: the candidate was gated with `--only`, which skipped
`pay_declined_then_other_account`. That is a process fix too (step 7).

## 5. Roll back first, fix second

```bash
export CANDIDATE_PERCENT=0     # every new call on stable
```

Rollback is a config change, not a deploy, so it happens before anyone debates the fix.

## 6. Fix, and prove it with the gate

```bash
# The broken version fails the scenario that covers declines:
npm run gate -- --journey journeys/make-payment.candidate.ts --only pay_declined_then_other_account --runs 2
#   FAIL pay_declined_then_other_account 0/2 · outcome; never calls transferToHuman; succeeded payments → exit 1

# Fix: delete the regression line, keep the improvement, bump to 1.1.1 (one version number names one content,
# Q13; production logs already carry 1.1.0 for the broken one). Then the full gate, not --only:
npm run gate -- --journey journeys/make-payment.candidate.ts
#   33/33 PASS → exit 0, 1.1.1 recorded as released
```

## 7. Re-roll and close

```bash
export CANDIDATE_PERCENT=1     # then 5, 20, 50, 100 as the alert stays quiet; raising it only ever moves
                               # calls onto the candidate (monotonic), so a ramp never bounces a caller back
```

Follow-ups worth more than the line fix:
- Release only on a full gate. `--only` is for iterating, never for shipping (the gate only records a release on a
  full run, so make "released" the deploy precondition).
- Add a decline scenario with a single linked account (the transfer is then
  correct, and the agent must not invent another account).
