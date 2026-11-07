// The first screen: the project read as a loan statement of evidence. Every figure is from the
// database (the API) or, for judge calibration, from docs/judge-calibration.md, and says so.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CallDetail, GateRun, IncidentArm, Summary } from "../../../src/viewer/types";
import { api, RequestError, useResource } from "../app/api";
import { fmtCount, fmtDay, fmtPct, fmtPeriod, fmtTime, fmtUsd, reasonLabel, scenarioName } from "../app/format";
import { flowPaths, type BlockedRun } from "../app/flow";
import { Link } from "../app/router";
import { useHorizontalPin, useMotionOk, useReadingPosition, useReveal } from "../app/scroll";
import { Icon } from "../components/Icon";
import { FlowMap } from "../components/FlowMap";
import { Failure, Loading, PassFail } from "../components/Marks";
import { Trace } from "../components/Trace";

const CHAPTERS = [
  { id: "summary", title: "Account summary" },
  { id: "facts", title: "Code owns facts" },
  { id: "gate", title: "Releases and the gate" },
  { id: "judge", title: "Judge calibration" },
  { id: "incident", title: "Incident drill" },
  { id: "terms", title: "Fine print" },
];
const CHAPTER_IDS = CHAPTERS.map((c) => c.id);

// The walkthrough and the map's Blocked release path both tell the story of this one run.
const BLOCKED_RUN = "gate-mvrrlvmt";

type Loaded = { summary: Summary; runs: GateRun[]; incident: IncidentArm[]; featured: CallDetail | null; stepUp: CallDetail | null; blocked: BlockedRun | null };

async function firstCall(gateRunId: string, scenario: string): Promise<CallDetail | null> {
  const page = await api.calls(new URLSearchParams({ gateRunId, q: scenario, limit: "1" }));
  const first = page.items[0];
  return first === undefined ? null : api.call(first.id);
}

// A database without this run shows the other paths. Any other failure is a real one.
async function loadBlocked(): Promise<BlockedRun | null> {
  try {
    const run = await api.gateRun(BLOCKED_RUN);
    const failed = run.results.find((r) => !r.passed);
    return failed === undefined ? null : { run, call: await api.call(failed.callId) };
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) return null;
    throw e;
  }
}

async function loadStatement(): Promise<Loaded> {
  const [summary, runs, incident] = await Promise.all([api.summary(), api.gateRuns(), api.incident()]);
  const gateRunId = summary.current?.gateRunId;
  const [featured, stepUp, blocked] = await Promise.all([
    gateRunId === undefined ? null : firstCall(gateRunId, "pay_happy_path"),
    gateRunId === undefined ? null : firstCall(gateRunId, "phone_mismatch_step_up_pass"),
    loadBlocked(),
  ]);
  return { summary, runs, incident, featured, stepUp, blocked };
}

export function Statement() {
  useMotionOk();
  const res = useResource("statement", loadStatement);
  const { current, progress } = useReadingPosition(CHAPTER_IDS);

  return (
    <main className="statement" aria-labelledby="statement-title">
      <div className="running-head" aria-hidden={res.state !== "ready"}>
        <div className="running-head__inner">
          <span className="running-head__doc">Statement of evidence</span>
          <span className="running-head__chapter">{CHAPTERS[current]?.title}</span>
          <span className="running-head__page">
            Page {current + 1} of {CHAPTERS.length}
          </span>
        </div>
        <span className="running-head__rule" style={{ transform: `scaleX(${progress})` }} />
      </div>

      {res.state === "loading" ? (
        <div className="page">
          <Loading lines={9} label="Loading the statement" />
        </div>
      ) : res.state === "error" ? (
        <div className="page">
          <Failure error={res.error} what="the statement" />
        </div>
      ) : (
        <StatementBody data={res.data} />
      )}
    </main>
  );
}

function StatementBody({ data }: { data: Loaded }) {
  const { summary, runs, incident, featured, stepUp, blocked: blockedRun } = data;
  const paths = useMemo(() => flowPaths(featured, stepUp, blockedRun), [featured, stepUp, blockedRun]);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root, [data]);
  // The sections mount after the data loads, so the browser's own jump to a #anchor finds nothing.
  useEffect(() => {
    if (window.location.hash !== "") document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);
  const releasing = runs.find((r) => r.id === summary.current?.gateRunId);
  const blocked = runs.filter((r) => !r.passed).length;

  return (
    <div ref={root}>
      {/* ---- Page 1: header, account summary, amount due, activity ---- */}
      <section id="summary" className="page sheet">
        <dl className="sheet__band">
          <div>
            <dt>Account</dt>
            <dd className="mono">{summary.journeyId} journey</dd>
          </div>
          <div>
            <dt>Statement period</dt>
            <dd>{fmtPeriod(summary.period.from, summary.period.to)}</dd>
          </div>
          <div>
            <dt>Prepared from</dt>
            <dd className="mono">data/journey-lab.db</dd>
          </div>
        </dl>
        <header className="sheet__head">
          <div>
            <h1 id="statement-title" className="sheet__title">
              Statement of evidence
            </h1>
            <p className="sheet__sub">
              What the agent said, what code guaranteed, and what each release had to pass. Every figure below comes from the stored calls and gate runs.
            </p>
          </div>

          {summary.current === null ? null : (
            <aside className="due" aria-label="Current release">
              <p className="due__bar">Current release</p>
              <div className="due__body">
                <p className="due__figure">
                  <span className="mono">{summary.journeyId}</span> {summary.current.version}
                </p>
                <p className="due__line">
                  Gate run{" "}
                  <Link to={`/gate/${summary.current.gateRunId}`} className="mono">
                    {summary.current.gateRunId}
                  </Link>
                </p>
                <p className="due__line">
                  <strong>
                    {summary.current.passed} of {summary.current.runs}
                  </strong>{" "}
                  simulated calls passed
                </p>
                {releasing === undefined ? null : <p className="due__fine">{fmtDay(releasing.startedAt)}, {fmtTime(releasing.startedAt)} · cost {fmtUsd(releasing.costUsd)}</p>}
                <span className="mark mark--perf due__mark">Released</span>
              </div>
            </aside>
          )}
        </header>

        <div className="sheet__cols">
          <div>
            <h2 className="sheet__h2">Account summary</h2>
            <dl className="leaders">
              <Row label="Releases" value={String(summary.releases.length)} note={summary.releases.map((r) => r.version).join(", ")} />
              <Row label="Gate runs" value={String(summary.gateRuns.total)} note={`${summary.gateRuns.passed} passed, ${blocked} blocked a release`} />
              <Row label="Calls on record" value={fmtCount(summary.calls.total)} note={`${fmtCount(summary.calls.bySource.sim)} simulated, ${fmtCount(summary.calls.bySource.synthetic_prod)} synthetic production${summary.calls.bySource.manual > 0 ? `, ${summary.calls.bySource.manual} live` : ""}`} />
              <Row label="Calls with full evidence" value={fmtCount(summary.calls.withEvidence)} note="tool inputs, results, and handoff stored" />
              <Row label="Tool calls" value={fmtCount(summary.toolCalls)} />
              <Row label="Judge verdicts" value={fmtCount(summary.judgments)} note="20 checked against hand labels" />
              <Row label="Known-bad calls caught" value="18 of 18" note="17 of 17 controls kept" />
            </dl>
          </div>

          <div>
            <h2 className="sheet__h2">Activity this period</h2>
            <table className="activity">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="num">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                <ActivityRow n={0} href="#facts" title="Code owns facts" detail="One call, every sentence traced to its source" result={featured === null ? "—" : `${featured.toolCalls.length} tool calls`} />
                <ActivityRow n={1} href="#gate" title="Releases and the gate" detail={`${runs.length} gate runs across ${summary.releases.length} versions`} result={`${summary.gateRuns.passed} passed · ${blocked} blocked`} />
                <ActivityRow n={2} href="#judge" title="Judge calibration" detail="Hand labels and known-bad calls" result="18/18 caught" />
                <ActivityRow n={3} href="#incident" title="Incident drill" detail="Containment dropped on a candidate" result={incidentResult(incident)} />
                <ActivityRow n={4} href="#terms" title="Fine print" detail="What this project does not do" result="—" />
              </tbody>
            </table>
          </div>
        </div>

        <FlowMap paths={paths} />
      </section>

      <Chapter id="facts" tint="facts" title="Code owns facts" lede="Amounts, dates, and statuses reach the caller as text the tools built in code. The model chooses the words around them. Point at an underlined sentence to see the tool result it came from.">
        {featured === null ? (
          <p className="lede">No call with stored evidence on the current release yet. Run the gate to record one.</p>
        ) : (
          <>
            <p className="chapter__ref">
              Call <Link to={`/calls/${featured.id}`} className="mono">{featured.id}</Link> · scenario {scenarioName(featured.scenarioId ?? "")} · {featured.version} · verified by caller ID
            </p>
            <Trace turns={featured.turns} toolCalls={featured.toolCalls} post proving={provingLine(featured)} />
          </>
        )}
      </Chapter>

      <GateChapter runs={runs} />

      <Chapter id="judge" tint="judge" title="Judge calibration" lede="An LLM judge scores what code cannot check: unsupported claims, and whether a transfer summary is accurate. Before trusting it, it was checked in both directions.">
        <div className="table-wrap" data-reveal>
        <table className="ledger-table">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col" className="num">
                Cases
              </th>
              <th scope="col" className="num">
                Matched
              </th>
              <th scope="col" className="col-result">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            <JudgeRow check="Hallucination judge against hand labels" cases={10} matched={10} note="after two rule changes, 5 repeats" />
            <JudgeRow check="Transfer-quality judge against hand labels" cases={10} matched={10} note="all ten were good summaries" />
            <JudgeRow check="Known-bad calls the judge must fail" cases={18} matched={18} note="one thing broken in each real call, 2 runs" />
            <JudgeRow check="Unedited calls the judge must pass" cases={17} matched={17} note="the controls, 2 runs" />
          </tbody>
        </table>
        </div>
        <div className="adjustments" data-reveal>
          <h3>Adjustments made to the judge</h3>
          <ol>
            <li>
              <strong>Money movement needs a tool result.</strong> "Declined" supports "Northwind did not collect it", not "no money was taken from your account": the customer's bank is not visible to Northwind.
            </li>
            <li>
              <strong>A transfer offer may name a topic, not an outcome.</strong> "A team member can help with those questions" passes; "a team member can take a smaller payment" is a promise.
            </li>
          </ol>
          <p className="source-note">
            Source: <code>docs/judge-calibration.md</code>. Limit: the known-bad cases were written for this check, and each break is plain. Subtler breaks, such as events in the wrong order, are not covered yet.
          </p>
        </div>
      </Chapter>

      <IncidentChapter arms={incident} />

      <Chapter id="terms" tint="fine" title="Fine print" lede="What this statement does not show, so nothing on it is read as more than it is.">
        <div className="terms" data-reveal>
          <p>
            <strong>Modeled on public descriptions of agent platforms. Not built on Sierra. Fictional company and data.</strong> Northwind Lending and every customer, loan, and account are invented.
          </p>
          <p>Not built: real telephony, speech to text, or SMS; real customer data or money; a contact-center integration (the handoff payload is shaped for one); monitoring wiring (logs and alert rules are shaped so a tool could ingest them); streaming replies.</p>
          <p>Simulated CSAT is a rating by the simulated caller, in character. It is a proxy, not CSAT, and never gates a release.</p>
          <p>Calls stored before the evidence columns existed show their transcript and verdicts, but not the tool results behind each sentence.</p>
        </div>

        <div className="stub" data-reveal>
          <div className="stub__cut" aria-hidden="true">
            <Icon name="scissors" />
            <span>Detach and keep</span>
          </div>
          <div className="stub__body">
            <div>
              <h3 className="stub__title">See it for yourself</h3>
              <p className="stub__text">Run a call against the same runner and checks the gate uses, or open any of the {fmtCount(summary.calls.total)} calls on record.</p>
            </div>
            <div className="stub__actions">
              <Link to="/live" className="button button--primary">
                Start a live call <Icon name="arrow" />
              </Link>
              <Link to="/calls" className="button">
                Browse calls
              </Link>
            </div>
          </div>
          <p className="stub__scan mono" aria-label="Release reference">
            {[summary.journeyId, summary.current?.version ?? "—", summary.releases.at(-1)?.hash ?? "", summary.current?.gateRunId ?? "", summary.current === null ? "" : `${summary.current.passed}/${summary.current.runs}`].map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </p>
        </div>
      </Chapter>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="leaders__row" data-reveal>
      <dt>{label}</dt>
      <span className="leaders__dots" aria-hidden="true" />
      {note === undefined ? null : <dd className="leaders__note">{note}</dd>}
      <dd className="leaders__value">{value}</dd>
    </div>
  );
}

function ActivityRow({ n, href, title, detail, result }: { n: number; href: string; title: string; detail: string; result: string }) {
  return (
    <tr data-reveal style={{ "--row": n } as CSSProperties}>
      <td className="activity__entry">p. {n + 2}</td>
      <td>
        <a href={href}>{title}</a>
        <span className="activity__detail">{detail}</span>
      </td>
      <td className="num">{result}</td>
    </tr>
  );
}

function JudgeRow({ check, cases, matched, note }: { check: string; cases: number; matched: number; note: string }) {
  return (
    <tr>
      <td>
        {check}
        <span className="activity__detail">{note}</span>
      </td>
      <td className="num">{cases}</td>
      <td className="num">{matched}</td>
      <td className="col-result">
        <PassFail passed={matched === cases} pass="Matched" fail="Mismatch" />
      </td>
    </tr>
  );
}

function Chapter({ id, tint, title, lede, children }: { id: string; tint: string; title: string; lede: string; children: ReactNode }) {
  return (
    <section id={id} className={`chapter chapter--${tint}`} aria-labelledby={`${id}-title`}>
      <div className="page chapter__inner">
        <h2 id={`${id}-title`} className="chapter__title">
          {title}
        </h2>
        <p className="lede chapter__lede">{lede}</p>
        <div className="chapter__body">{children}</div>
      </div>
    </section>
  );
}

// The sentence the stale-status fix made code-owned: makePayment's own text after the charge.
function provingLine(call: CallDetail): { idx: number; note: string } | undefined {
  const pay = call.toolCalls.find((t) => t.name === "makePayment" && t.ok);
  if (pay === undefined) return undefined;
  const turn = call.turns.find((t) => t.role === "agent" && t.spans.some((s) => s.from.kind === "tool" && s.from.seq === pay.seq));
  if (turn === undefined) return undefined;
  return {
    idx: turn.idx,
    note: `Entry ${pay.seq + 1}: makePayment read the loan back after the charge and wrote this status. The model only passed it on.`,
  };
}

function incidentResult(arms: IncidentArm[]): string {
  if (arms.length < 2) return "—";
  return arms.map((a) => fmtPct(a.containment, 0)).join(" → ");
}

// ---- Releases and the gate: a pinned horizontal run of gate stubs, left to right in time ----

function GateChapter({ runs }: { runs: GateRun[] }) {
  const { section, track, pinned, height, shift } = useHorizontalPin();
  const versions = useMemo(() => [...new Set(runs.map((r) => r.version))], [runs]);
  const [inView, setInView] = useState(runs[0]?.version ?? "");

  // The version of the first stub still in view, so the pinned frame always says which release you are reading.
  useEffect(() => {
    const t = track.current;
    if (t === null) return;
    const left = t.getBoundingClientRect().left + 48;
    const first = [...t.querySelectorAll<HTMLElement>("[data-version]")].find((el) => el.getBoundingClientRect().right > left);
    if (first?.dataset.version !== undefined) setInView(first.dataset.version);
  }, [shift, track]);

  return (
    <section id="gate" className="chapter chapter--gate" aria-labelledby="gate-title">
      <section ref={section} className={`gate-pin${pinned ? " is-pinned" : ""}`} style={pinned ? { height } : undefined} aria-label="Gate runs in time order">
        <div className="gate-pin__frame">
          <div className="page gate-pin__head">
            <h2 id="gate-title" className="chapter__title">
              Releases and the gate
            </h2>
            <p className="lede chapter__lede">
              A full gate runs every scenario three times against a simulated caller. Any safety-critical failure, or a pass rate under 90%, blocks the release. {runs.filter((r) => !r.passed).length} of {runs.length} runs blocked one.
            </p>
            <div className="gate-pin__legend">
              {pinned ? (
                <span>
                  Now showing <strong className="mono">make-payment {inView}</strong>
                  <span className="gate-pin__of">
                    {" "}
                    · version {versions.indexOf(inView) + 1} of {versions.length}, oldest first
                  </span>
                </span>
              ) : (
                <span>
                  {runs.length} runs across {versions.length} versions, oldest first
                </span>
              )}
              <span className="gate-pin__hint">{pinned ? "Keep scrolling to move through time" : "Scroll sideways"}</span>
            </div>
          </div>
          <div ref={track} className="gate-track" tabIndex={0} aria-label="Gate runs, oldest first">
            <ol className="gate-track__strip" style={pinned ? { transform: `translateX(${-shift}px)` } : undefined}>
              {runs.map((r, i) => {
                const firstOfVersion = runs[i - 1]?.version !== r.version;
                return (
                  <li key={r.id} data-version={r.version} className={`gate-stub${r.passed ? "" : " gate-stub--blocked"}${firstOfVersion ? " gate-stub--first" : ""}`} data-reveal>
                    {firstOfVersion ? <span className="gate-stub__version mono">make-payment {r.version}</span> : null}
                    <div className="gate-stub__perf" aria-hidden="true" />
                    <p className="gate-stub__when">
                      {fmtDay(r.startedAt)} · {fmtTime(r.startedAt)}
                    </p>
                    <p className="gate-stub__figure">
                      {r.runs - r.failedRuns}
                      <span> of {r.runs}</span>
                    </p>
                    <p className="gate-stub__rate">{fmtPct(r.passRate)} passed · {fmtUsd(r.costUsd)}</p>
                    <div className="gate-stub__mark">
                      {r.releases ? <span className="mark mark--perf">Released {r.version}</span> : r.passed ? <span className="state-ok">Passed, not a release</span> : <span className="mark mark--fail">Blocked</span>}
                    </div>
                    {r.failedScenarios.length > 0 ? (
                      <ul className="gate-stub__fails">
                        {r.failedScenarios.slice(0, 3).map((s) => (
                          <li key={s}>
                            <Icon name="cross" />
                            {scenarioName(s)}
                          </li>
                        ))}
                        {r.failedScenarios.length > 3 ? <li>and {r.failedScenarios.length - 3} more</li> : null}
                      </ul>
                    ) : (
                      <p className="gate-stub__clean">No failed scenario</p>
                    )}
                    <p className="gate-stub__id">
                      <Link to={`/gate/${r.id}`} className="mono">
                        {r.id}
                      </Link>
                      {r.safetyFailures > 0 ? <span className="gate-stub__safety">{r.safetyFailures} safety-critical</span> : null}
                    </p>
                    {r.passed ? null : (
                      <span className="gate-stub__void" aria-hidden="true">
                        VOID
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>
    </section>
  );
}

// ---- Incident drill ----

function IncidentChapter({ arms }: { arms: IncidentArm[] }) {
  const stable = arms[0];
  const candidate = arms[1];
  return (
    <Chapter id="incident" tint="incident" title="Incident drill" lede="A candidate version shipped at 20% on a partial gate run that skipped the decline scenario. After a declined payment it transferred callers instead of offering another linked account.">
      {stable === undefined || candidate === undefined ? (
        <p className="lede">No synthetic production calls yet. Run npm run seed:incident.</p>
      ) : (
        <div className="incident">
          <div className="table-wrap" data-reveal>
          <table className="ledger-table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col" className="num">
                  Calls
                </th>
                <th scope="col" className="num">
                  Transferred
                </th>
                <th scope="col">Containment</th>
              </tr>
            </thead>
            <tbody>
              {[stable, candidate].map((a, i) => (
                <tr key={a.version}>
                  <td>
                    <span className="mono">{a.version}</span> <span className="activity__detail">{i === 0 ? "stable, 80%" : "candidate, 20%"}</span>
                  </td>
                  <td className="num">{a.calls}</td>
                  <td className="num">{a.transferred}</td>
                  <td>
                    <span className="meter" role="img" aria-label={`${fmtPct(a.containment)} contained`}>
                      <span className={`meter__fill${i === 1 ? " meter__fill--low" : ""}`} style={{ width: `${a.containment * 100}%` }} />
                    </span>
                    <span className="meter__value">{fmtPct(a.containment)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="incident__cols">
            <div data-reveal>
              <h3>Why the candidate transferred</h3>
              <ul className="reasons">
                {candidate.reasons.map((r) => (
                  <li key={r.reason}>
                    <span>{reasonLabel(r.reason)}</span>
                    <span className="num">{r.calls}</span>
                  </li>
                ))}
              </ul>
              <p className="source-note">
                Transferred calls:{" "}
                {candidate.transferredCallIds.map((id, i) => (
                  <span key={id}>
                    {i === 0 ? "" : ", "}
                    <Link to={`/calls/${id}`} className="mono">
                      {id}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
            <div data-reveal>
              <h3>What was done, in order</h3>
              <ol className="runbook">
                <li>Sized it by version before reading any prompt.</li>
                <li>Grouped transfers by version, reason, and the tool failure just before.</li>
                <li>Read two transcripts: no offer of the other linked account.</li>
                <li>
                  Rolled back with <code>CANDIDATE_PERCENT=0</code>, a config change.
                </li>
                <li>Fixed it; the broken version fails the decline scenario, the fix passes the full gate.</li>
              </ol>
              <p className="source-note">
                Runbook: <code>docs/incident-drill.md</code>
              </p>
            </div>
          </div>
        </div>
      )}
    </Chapter>
  );
}
