# journey-lab

A small TypeScript project that models how a team might build, test, ship, and monitor customer-service journeys
for an LLM agent in a regulated lending context: a payment journey with tiered identity, required disclosures,
structural confirmation, guardrails, and clean handoffs to humans; simulations that gate releases like unit tests;
staged rollout; and the analytics to find out why calls fail.

**Modeled on public descriptions of agent platforms. Not built on Sierra. Fictional company and data.**
The company is "Northwind Lending"; every customer, loan, and account is invented. No real telephony, SMS, or money.

## Architecture

```
            caller (CLI, or a simulated caller in sims)
                 │ text
                 ▼
┌──────────────────────────── runner (src/journey/runner.ts) ─────────────────────────────┐
│ prompt composed by code (shared rules + journey + steps + channel)  ── model port ──▶ Claude │
│ every tool call: listed? → input schema → tier → confirmation → loan-status lookup → run   │
│ verbatim lines spoken by code · never_say rewrite/fallback · handoff fields filled by code │
└──────────────┬───────────────────────────────────────────────────────┬──────────────────┘
               │ tools (src/tools/): Result<T, ToolFailure> + spoken text│ events (JSON lines)
               ▼                                                         ▼
      mock backend (src/mock-api/):                              logs/calls.jsonl
      REST + GraphQL, failure injection                          SQLite (src/db/) ← sims, synthetic prod
                                                                        │
                       gate (src/gate.ts) · weekly review (src/analytics/) · rollout (src/rollout.ts)
```

The rule throughout: **code owns facts, the model owns language.** Amounts, dates, identity, limits, what is said
verbatim, when a call is transferred, and where it goes are decided in code. The model chooses words and tools.

| Concern | Where |
|---|---|
| Journey as validated data (zod), tool tier floors | `journeys/`, `src/journey/schema.ts`, `src/tools/catalog.ts` |
| Tools: ownership check, quotes, idempotency, spoken amounts | `src/tools/` |
| Step-up state machine (pure reducer, property-tested) | `src/journey/stepup.ts` |
| Agent loop, tier gating, confirmation, guardrails, handoff | `src/journey/runner.ts` |
| Simulations, code checks, LLM judge, gate | `src/sim/`, `src/gate.ts` |
| Analytics, weekly review, incident seed | `src/analytics/` |
| Staged rollout | `src/rollout.ts` |

## Run it

Node 22+.

```bash
npm install
cp .env.example .env            # add ANTHROPIC_API_KEY (never commit .env)
npm test                        # unit and integration tests, no API calls
npm run typecheck

npm run chat -- --phone +14155550101            # verified caller (Maya, loan L1001)
npm run chat                                     # unverified: knowledge answers, or step-up by text code
npm run chat -- --flags payment_declined_once    # failure injection (see src/mock-api/types.ts)

npm run gate                    # all scenarios × SIM_RUNS_PER_SCENARIO; exit 1 blocks the release (~$0.30)
npm run seed:incident           # 60 synthetic production calls, candidate at 20% (~$0.10, cached)
npm run review                  # ranked fix list
npm run queries                 # the five analytics queries
npm run judge:sample            # labeling sheet for judge calibration
npm run judge:negatives         # judge must fail 18 broken calls and pass their controls (~$0.21)

npm run viewer                  # the viewer: http://localhost:4020 (statement, calls, gate runs, live call)
```

## How the gate works

Each scenario (`src/sim/scenarios*.ts`) sets up a caller persona, a session (verified or not), and backend failure
flags. A caller model talks to the real runner; tools hit the in-process mock backend.

1. **Code checks for everything code can decide**: outcome, tools called or not, required verbatim lines, phrases that must never be said,
   and invariants on every run: no quote or payment outside the backend's allowed range, no double charge.
2. **An LLM judge only for what code cannot check**: unsupported material claims (hallucination), and whether a
   transfer summary is accurate and complete. It sees the tool results and system facts; it writes its reason
   before its verdict. The judge runs before the code checks, on every call, and a run passes only if both pass.
3. **Gate rule**: any safety-critical failure, or a pass rate under 90%, exits 1.
4. **Versions**: a journey's semver plus a code-computed content hash. After a full passing gate a version is
   released, and any later content change under the same version fails the gate before a token is spent.

The judge is calibrated two ways (`docs/judge-calibration.md`): against human labels, and against known-bad cases,
real calls with one thing broken that it must fail while still passing the unedited call (`npm run
judge:negatives`). Re-run both after any judge change.

## Viewer

`npm run viewer` builds the React app (`viewer/`) and serves it with a small API (`src/viewer/`) on
http://localhost:4020. Local only: live calls use `ANTHROPIC_API_KEY` from `.env`.

- **Statement**: the project read as a statement of evidence: the current release and the gate run that released it,
  one call with every sentence traced to its source, all gate runs in time order, judge calibration, the incident
  drill, and the fine print.
- **Calls**: every stored call, filterable; one call's trace shows the transcript and the tool ledger side by side,
  with each code-built sentence linked to the tool result it came from, plus verdicts, failed checks, and the
  transfer slip.
- **Gate runs**: every release attempt, a scenario-by-attempt matrix, and two runs compared.
- **Live call**: the real runner, mock backend, and failure flags, with the trace updating per turn; or replay a
  recorded call turn by turn (free, no key). Ended live calls are saved with `source = manual`.

Provenance is matched by text: stored turns and tool calls have no shared order, so a sentence is linked to a tool
when it is that tool's `spoken` text unchanged. A paraphrase shows as the model's words. Calls stored before tool
results were kept show their sources as unknown, not as model text.

## Metrics

| Metric | Definition |
|---|---|
| Containment | Share of calls not transferred to a human. Decided by code from how the call ended, never by the model. |
| Transfer quality | Share of transfers whose summary the judge finds accurate and sufficient for the human agent. |
| Hallucination rate | Share of judged calls with an unsupported material claim (amounts, dates, account facts, policy, promises). |
| Sim-CSAT | A 1–5 rating by the simulated caller, in character. **A proxy, not CSAT.** Reported, never gates. |

## Not built

Real telephony, STT/TTS, or SMS; real customer data or money; a Genesys or other contact-center integration (the
handoff payload is shaped for one); Grafana, SumoLogic, or any monitoring wiring (logs and
alert rules are shaped so a tool could ingest them, see `docs/alerts.md`); streaming responses.

## Docs

- `docs/judge-calibration.md`: how the LLM judge was tested against known-bad and known-good calls.
- `docs/incident-drill.md`: the containment-drop runbook.
- `docs/alerts.md`: alert rules, with the SQL behind each one.
- `DESIGN.md`: the viewer's visual system.
