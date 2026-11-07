// Gate runs: every release attempt, one run's scenario matrix, and two runs side by side.
import type { GateResult, GateRun, GateRunDetail } from "../../../src/viewer/types";
import { api, useResource } from "../app/api";
import { fmtDay, fmtPct, fmtTime, fmtUsd, reasonLabel, scenarioName } from "../app/format";
import { Link, navigate } from "../app/router";
import { Icon } from "../components/Icon";
import { Failure, Loading, OutcomeMark, PassFail } from "../components/Marks";

export function GateRuns({ id, query }: { id: string | null; query: URLSearchParams }) {
  return id === null ? <RunList /> : <RunView id={id} compare={query.get("compare")} />;
}

function RunList() {
  const res = useResource("gate-runs", api.gateRuns);
  return (
    <main className="page">
      <header className="tool-head">
        <h1>Gate runs</h1>
        <p className="lede">A release needs a full gate with no safety-critical failure and a pass rate of 90% or more. The first passing run for a version and content hash releases it.</p>
      </header>
      {res.state === "loading" ? (
        <Loading lines={10} label="Loading gate runs" />
      ) : res.state === "error" ? (
        <Failure error={res.error} what="gate runs" />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h2>No gate runs yet</h2>
          <p>Run npm run gate to record one.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="runs-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Version</th>
                <th scope="col" className="num">
                  Calls passed
                </th>
                <th scope="col" className="num">
                  Pass rate
                </th>
                <th scope="col">Failed scenarios</th>
                <th scope="col" className="num">
                  Cost
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...res.data].reverse().map((r) => (
                <tr key={r.id} className="row-link" onClick={(e) => (e.target as HTMLElement).closest("a") === null && navigate(`/gate/${r.id}`)}>
                  <td>
                    <Link to={`/gate/${r.id}`} className="mono row-link__title">
                      {r.id}
                    </Link>
                    <span className="row-link__id">
                      {fmtDay(r.startedAt)}, {fmtTime(r.startedAt)}
                    </span>
                  </td>
                  <td>
                    <span className="mono">{r.version}</span>
                    <span className="row-link__id mono">{r.hash}</span>
                  </td>
                  <td className="num">
                    {r.runs - r.failedRuns} of {r.runs}
                  </td>
                  <td className="num">{fmtPct(r.passRate)}</td>
                  <td className="fails-cell">{r.failedScenarios.length === 0 ? <span className="cell-note">None</span> : r.failedScenarios.map(scenarioName).join(", ")}</td>
                  <td className="num">{fmtUsd(r.costUsd)}</td>
                  <td>{r.releases ? <span className="mark mark--perf">Released</span> : <PassFail passed={r.passed} pass="Passed" fail="Blocked" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function RunView({ id, compare }: { id: string; compare: string | null }) {
  const key = `${id}|${compare ?? ""}`;
  const res = useResource(key, async () => {
    const [run, all, other] = await Promise.all([api.gateRun(id), api.gateRuns(), compare === null ? Promise.resolve(null) : api.gateRun(compare)]);
    return { run, all, other };
  });
  return (
    <main className="page">
      <Link to="/gate" className="back">
        <Icon name="back" /> All gate runs
      </Link>
      {res.state === "loading" ? (
        <Loading lines={12} label="Loading the gate run" />
      ) : res.state === "error" ? (
        <Failure error={res.error} what={`gate run ${id}`} />
      ) : (
        <RunBody run={res.data.run} all={res.data.all} other={res.data.other} />
      )}
    </main>
  );
}

type ScenarioRow = { scenarioId: string; safetyCritical: boolean; results: GateResult[] };

function byScenario(run: GateRunDetail): ScenarioRow[] {
  const rows = new Map<string, ScenarioRow>();
  for (const r of run.results) {
    const row = rows.get(r.scenarioId) ?? { scenarioId: r.scenarioId, safetyCritical: r.safetyCritical, results: [] };
    row.results.push(r);
    rows.set(r.scenarioId, row);
  }
  return [...rows.values()];
}

function RunBody({ run, all, other }: { run: GateRunDetail; all: GateRun[]; other: GateRunDetail | null }) {
  const rows = byScenario(run);
  const otherRows = other === null ? null : new Map(byScenario(other).map((r) => [r.scenarioId, r]));
  const scenarios = [...new Set([...rows.map((r) => r.scenarioId), ...(otherRows === null ? [] : otherRows.keys())])];
  const mine = new Map(rows.map((r) => [r.scenarioId, r]));
  const width = Math.max(...rows.map((r) => r.results.length), 1);

  return (
    <article>
      <header className="call__head">
        <div>
          <h1 className="mono run-title">{run.id}</h1>
          <p className="call__id">
            make-payment <span className="mono">{run.version}</span> · hash <span className="mono">{run.hash}</span> · {fmtDay(run.startedAt)}, {fmtTime(run.startedAt)} · cost {fmtUsd(run.costUsd)}
          </p>
        </div>
        <div className="call__marks">{run.releases ? <span className="mark mark--perf">Released {run.version}</span> : <PassFail passed={run.passed} pass="Passed" fail="Blocked" />}</div>
      </header>

      <dl className="facts">
        <div>
          <dt>Calls passed</dt>
          <dd>
            {run.runs - run.failedRuns} of {run.runs}
          </dd>
        </div>
        <div>
          <dt>Pass rate</dt>
          <dd>{fmtPct(run.passRate)}</dd>
        </div>
        <div>
          <dt>Safety-critical failures</dt>
          <dd>{run.safetyFailures}</dd>
        </div>
        <div>
          <dt>Scenarios</dt>
          <dd>{rows.length}</dd>
        </div>
      </dl>

      <div className="compare-bar">
        <label className="field">
          <span>Compare with another run</span>
          <select className="select" value={other?.id ?? ""} onChange={(e) => navigate(`/gate/${run.id}${e.target.value === "" ? "" : `?compare=${e.target.value}`}`, { replace: true })}>
            <option value="">No comparison</option>
            {all
              .filter((g) => g.id !== run.id)
              .reverse()
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id} · {g.version} · {g.runs - g.failedRuns}/{g.runs}
                </option>
              ))}
          </select>
        </label>
        <Link to={`/calls?gateRunId=${run.id}`} className="button button--quiet">
          List these calls
        </Link>
      </div>

      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col" colSpan={width}>
                This run, each attempt
              </th>
              {other === null ? null : (
                <>
                  <th scope="col" className="num">
                    This run
                  </th>
                  <th scope="col" className="num">
                    <span className="mono">{other.id}</span>
                  </th>
                  <th scope="col">Change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const row = mine.get(s);
              const theirs = otherRows?.get(s);
              const a = row?.results.filter((r) => r.passed).length ?? 0;
              const b = theirs?.results.filter((r) => r.passed).length ?? 0;
              return (
                <tr key={s}>
                  <th scope="row">
                    {scenarioName(s)}
                    {row?.safetyCritical === true || theirs?.safetyCritical === true ? <span className="cell-note">Safety-critical</span> : null}
                  </th>
                  {Array.from({ length: width }, (_, i) => {
                    const r = row?.results[i];
                    return <td key={i}>{r === undefined ? <span className="cell-note">—</span> : <Attempt r={r} />}</td>;
                  })}
                  {other === null ? null : (
                    <>
                      <td className="num">{row === undefined ? "—" : `${a}/${row.results.length}`}</td>
                      <td className="num">{theirs === undefined ? "—" : `${b}/${theirs.results.length}`}</td>
                      <td>{row === undefined || theirs === undefined ? <span className="cell-note">Not in both</span> : a / row.results.length > b / theirs.results.length ? <span className="change change--up">Better here</span> : a / row.results.length < b / theirs.results.length ? <span className="change change--down">Worse here</span> : <span className="cell-note">Same</span>}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function Attempt({ r }: { r: GateResult }) {
  const why = r.failedChecks.length > 0 ? r.failedChecks.join(", ") : r.transferReason === null ? "" : reasonLabel(r.transferReason);
  return (
    <Link to={`/calls/${encodeURIComponent(r.callId)}`} className={`attempt${r.passed ? "" : " attempt--fail"}`} title={why === "" ? r.callId : `${r.callId}: ${why}`}>
      <PassFail passed={r.passed} />
      <span className="attempt__outcome">
        <OutcomeMark outcome={r.outcome} />
      </span>
      {r.failedChecks.length > 0 ? <span className="attempt__why mono">{r.failedChecks.join(", ")}</span> : null}
    </Link>
  );
}
