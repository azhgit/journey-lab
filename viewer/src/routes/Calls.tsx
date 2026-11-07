// Every call on record, and one call's full trace. Operate mode: calm, dense, no scroll motion.
import { useState, type FormEvent, type ReactNode } from "react";
import type { CallDetail, CallSummary, Handoff, Judgment } from "../../../src/viewer/types";
import { api, useResource } from "../app/api";
import { fmtCount, fmtDay, fmtTime, reasonLabel, scenarioName, SOURCE_LABEL } from "../app/format";
import { Link, navigate } from "../app/router";
import { Icon } from "../components/Icon";
import { Failure, Loading, OutcomeMark, PassFail } from "../components/Marks";
import { Trace } from "../components/Trace";

const PAGE = 50;
const FILTERS = ["source", "version", "outcome", "q", "gateRunId"] as const;

export function Calls({ id, query }: { id: string | null; query: URLSearchParams }) {
  return id === null ? <CallList query={query} /> : <CallView id={id} back={query.get("from")} />;
}

function CallList({ query }: { query: URLSearchParams }) {
  const offset = Number(query.get("offset") ?? 0) || 0;
  const params = new URLSearchParams();
  for (const f of FILTERS) {
    const v = query.get(f);
    if (v !== null && v !== "") params.set(f, v);
  }
  params.set("limit", String(PAGE));
  params.set("offset", String(offset));
  const key = params.toString();
  const res = useResource(key, () => api.calls(params));
  const summary = useResource("summary", api.summary);
  const [q, setQ] = useState(query.get("q") ?? "");

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value === "") next.delete(name);
    else next.set(name, value);
    next.delete("offset");
    navigate(`/calls${next.size > 0 ? `?${next}` : ""}`, { replace: true });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    setFilter("q", q.trim());
  };
  const versions = summary.state === "ready" ? summary.data.versions : [];
  const listQuery = new URLSearchParams(query).toString();

  return (
    <main className="page">
      <header className="tool-head">
        <h1>Calls</h1>
        <p className="lede">
          Every call stored by the gate, the incident drill, and live sessions. Open one to see each sentence's source.
        </p>
      </header>

      <form className="filters" onSubmit={search} role="search">
        <label className="field filters__search">
          <span>Search call or scenario</span>
          <span className="input-icon">
            <Icon name="search" />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. declined, prod-12" />
          </span>
        </label>
        <Select label="Source" value={query.get("source") ?? ""} onChange={(v) => setFilter("source", v)} options={[["", "All sources"], ["sim", SOURCE_LABEL.sim], ["synthetic_prod", SOURCE_LABEL.synthetic_prod], ["manual", SOURCE_LABEL.manual]]} />
        <Select label="Version" value={query.get("version") ?? ""} onChange={(v) => setFilter("version", v)} options={[["", "All versions"], ...versions.map((v): [string, string] => [v, v])]} />
        <Select label="Outcome" value={query.get("outcome") ?? ""} onChange={(v) => setFilter("outcome", v)} options={[["", "All outcomes"], ["resolved", "Resolved"], ["transferred", "Transferred"], ["abandoned", "Abandoned"]]} />
        <button className="button" type="submit">
          Search
        </button>
      </form>
      {query.get("gateRunId") === null ? null : (
        <p className="filter-chip">
          Gate run <span className="mono">{query.get("gateRunId")}</span>{" "}
          <button type="button" className="link-button" onClick={() => setFilter("gateRunId", "")}>
            Clear
          </button>
        </p>
      )}

      {res.state === "loading" ? (
        <Loading lines={10} label="Loading calls" />
      ) : res.state === "error" ? (
        <Failure error={res.error} what="calls" />
      ) : res.data.items.length === 0 ? (
        <div className="empty">
          <h2>No calls match</h2>
          <p>Clear a filter, or record calls with npm run gate or a live call.</p>
        </div>
      ) : (
        <>
          <p className="count">
            {fmtCount(res.data.total)} calls · showing {offset + 1}–{offset + res.data.items.length}
          </p>
          <div className="table-wrap">
            <table className="calls-table">
              <thead>
                <tr>
                  <th scope="col">Call</th>
                  <th scope="col">Source</th>
                  <th scope="col">Version</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Gate check</th>
                  <th scope="col">Judge</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((c) => (
                  <CallRow key={c.id} c={c} from={listQuery} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={res.data.total} offset={offset} query={query} />
        </>
      )}
    </main>
  );
}

function CallRow({ c, from }: { c: CallSummary; from: string }) {
  const href = `/calls/${encodeURIComponent(c.id)}${from === "" ? "" : `?from=${encodeURIComponent(from)}`}`;
  return (
    <tr className="row-link" onClick={(e) => (e.target as HTMLElement).closest("a") === null && navigate(href)}>
      <td>
        <Link to={href} className="row-link__title">
          {c.scenarioId === null ? c.id : scenarioName(c.scenarioId)}
        </Link>
        <span className="row-link__id mono">{c.id}</span>
      </td>
      <td>{SOURCE_LABEL[c.source]}</td>
      <td className="mono">{c.version}</td>
      <td>
        <OutcomeMark outcome={c.outcome} />
        {c.transferReason === null ? null : <span className="cell-note">{reasonLabel(c.transferReason)}</span>}
      </td>
      <td>{c.simPassed === null ? <span className="cell-note">—</span> : <PassFail passed={c.simPassed} />}</td>
      <td className="judge-cell">
        {c.judgments.length === 0 ? <span className="cell-note">—</span> : null}
        {c.judgments.map((j) => (
          <span key={j.kind} title={j.kind === "hallucination" ? "Hallucination judge" : "Transfer-quality judge"}>
            <PassFail passed={j.passed} pass={j.kind === "hallucination" ? "Claims" : "Summary"} fail={j.kind === "hallucination" ? "Claims" : "Summary"} />
          </span>
        ))}
      </td>
      <td>{c.hasEvidence ? <span className="cell-ok">Full</span> : <span className="mark mark--neutral">Transcript only</span>}</td>
    </tr>
  );
}

function Pager({ total, offset, query }: { total: number; offset: number; query: URLSearchParams }) {
  if (total <= PAGE) return null;
  const go = (o: number) => {
    const next = new URLSearchParams(query);
    next.set("offset", String(o));
    navigate(`/calls?${next}`);
  };
  return (
    <nav className="pager" aria-label="Pages">
      <button className="button button--quiet" disabled={offset === 0} onClick={() => go(Math.max(0, offset - PAGE))}>
        <Icon name="back" /> Newer
      </button>
      <span>
        Page {Math.floor(offset / PAGE) + 1} of {Math.ceil(total / PAGE)}
      </span>
      <button className="button button--quiet" disabled={offset + PAGE >= total} onClick={() => go(offset + PAGE)}>
        Older <Icon name="arrow" />
      </button>
    </nav>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- one call ----

function CallView({ id, back }: { id: string; back: string | null }) {
  const res = useResource(id, () => api.call(id));
  return (
    <main className="page">
      <Link to={back === null ? "/calls" : `/calls?${back}`} className="back">
        <Icon name="back" /> All calls
      </Link>
      {res.state === "loading" ? <Loading lines={12} label="Loading the call" /> : res.state === "error" ? <Failure error={res.error} what={`call ${id}`} /> : <CallBody call={res.data} />}
    </main>
  );
}

function CallBody({ call }: { call: CallDetail }) {
  return (
    <article className="call">
      <header className="call__head">
        <div>
          <h1>{call.scenarioId === null ? call.id : scenarioName(call.scenarioId)}</h1>
          <p className="call__id mono">{call.id}</p>
        </div>
        <div className="call__marks">
          <OutcomeMark outcome={call.outcome} />
          {call.simPassed === null ? null : <PassFail passed={call.simPassed} pass="Gate check passed" fail="Gate check failed" />}
        </div>
      </header>

      <dl className="facts">
        <Fact label="Source" value={SOURCE_LABEL[call.source]} />
        <Fact label="Journey version" value={call.version} mono />
        {call.gateRunId === null ? null : <Fact label="Gate run" value={<Link to={`/gate/${call.gateRunId}`} className="mono">{call.gateRunId}</Link>} />}
        <Fact label="Identity at start" value={call.identityAtStart === "caller_id" ? "Verified caller ID (Tier 1)" : call.identityAtStart === "none" ? "Not verified (Tier 0)" : "Not stored"} />
        <Fact label="Tier at end" value={`Tier ${call.authTierFinal}`} />
        <Fact label="Caller turns" value={String(call.callerTurns)} />
        {call.transferReason === null ? null : <Fact label="Transfer reason" value={reasonLabel(call.transferReason)} />}
        <Fact label="Tokens" value={`${fmtCount(call.inputTokens)} in · ${fmtCount(call.outputTokens)} out`} />
        {call.csat === null ? null : <Fact label="Sim-CSAT (proxy)" value={`${call.csat} of 5`} />}
        {call.source === "sim" ? null : <Fact label="Recorded" value={`${fmtDay(call.startedAt)}, ${fmtTime(call.startedAt)}`} />}
      </dl>

      {call.hasEvidence ? null : (
        <div className="notice">
          <p>
            <strong>Transcript and verdicts only.</strong> This call was stored before tool inputs and results were kept, so the trace cannot show which tool each sentence came from.
          </p>
        </div>
      )}

      {call.failedChecks.length === 0 && call.judgmentsFull.length === 0 ? null : (
        <section className="verdicts" aria-label="Checks and verdicts">
          {call.failedChecks.length === 0 ? null : (
            <div className="verdict verdict--fail">
              <h2>Failed code checks</h2>
              <ul>
                {call.failedChecks.map((c) => (
                  <li key={c} className="mono">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {call.judgmentsFull.map((j) => (
            <JudgmentView key={j.kind} j={j} />
          ))}
        </section>
      )}

      <section aria-labelledby="trace-title" className="call__trace">
        <h2 id="trace-title" className="section-title">
          Trace
        </h2>
        <Trace turns={call.turns} toolCalls={call.toolCalls} />
      </section>

      {call.handoff === null ? null : <HandoffSlip h={call.handoff} />}

      {call.hasEvidence ? (
        <p className="call__replay">
          <Link to={`/live?replay=${encodeURIComponent(call.id)}`} className="button">
            <Icon name="play" /> Replay this call turn by turn
          </Link>
        </p>
      ) : null}
    </article>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

function JudgmentView({ j }: { j: Judgment }) {
  return (
    <div className={`verdict${j.passed ? "" : " verdict--fail"}`}>
      <h2>
        {j.kind === "hallucination" ? "Hallucination judge" : "Transfer-quality judge"} <PassFail passed={j.passed} />
      </h2>
      <p>{j.reason}</p>
      {j.humanLabel === null ? null : <p className="verdict__label">Hand label: {j.humanLabel ? "pass" : "fail"}{j.humanLabel === j.passed ? ", agrees" : ", disagrees"}</p>}
    </div>
  );
}

export function HandoffSlip({ h }: { h: Handoff }) {
  return (
    <section className="slip" aria-labelledby="slip-title">
      <h2 id="slip-title" className="slip__title">
        Transfer slip
      </h2>
      <dl className="slip__fields">
        <div>
          <dt>Reason</dt>
          <dd>{reasonLabel(h.reason)}</dd>
        </div>
        <div>
          <dt>Queue</dt>
          <dd className="mono">{h.queue}</dd>
        </div>
        <div>
          <dt>Identity</dt>
          <dd>
            Tier {h.authTier}, {h.verifiedBy === "caller_id" ? "caller ID" : h.verifiedBy === "step_up" ? "text code" : "not verified"}
          </dd>
        </div>
        <div>
          <dt>Loan</dt>
          <dd className="mono">{h.loanId ?? "—"}</dd>
        </div>
      </dl>
      <p className="slip__by">Fields above filled by code. Summary below written by {h.summaryBy === "model" ? "the model" : h.summaryBy === "code" ? "code" : "the model, with facts added by code"}.</p>
      <p className="slip__summary">{h.summary}</p>
    </section>
  );
}
