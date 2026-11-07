// A live call against the real runner, mock backend, and checks the gate uses; or a recorded call replayed turn
// by turn (free, no API key). Operate mode: state motion only.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { CallDetail, LiveCall, LiveOptions, LiveStart, Turn } from "../../../src/viewer/types";
import { api, RequestError, useResource } from "../app/api";
import { fmtCount, reasonLabel, scenarioName } from "../app/format";
import { Link, navigate } from "../app/router";
import { HandoffSlip } from "./Calls";
import { Icon } from "../components/Icon";
import { Failure, Loading, OutcomeMark } from "../components/Marks";
import { Trace } from "../components/Trace";

const FLAG_HELP: Record<string, string> = {
  payment_declined: "Every payment is declined",
  payment_declined_once: "The first payment is declined, the next one works",
  insufficient_funds: "Payments fail for insufficient funds",
  timeout: "The payment commits, but its response hangs past the tool timeout",
  flaky_503_then_ok: "The first request to each endpoint returns 503",
  rate_limited_with_retry_after: "The first request to each endpoint returns 429 with Retry-After",
  past_due_account: "Every loan reads as past due",
  graphql_partial_error: "Loan details come back without the next payment",
  empty_loans: "The phone has no loans",
  slow_tool: "Every backend response is slow",
  sms_unavailable: "Text codes cannot be sent",
};

type Recipe = { title: string; detail: string; start: LiveStart; opener: string };
const RECIPES: Recipe[] = [
  {
    title: "Declined, then another account",
    detail: "Maya pays; the first account is declined.",
    start: { phone: "+14155550101", channel: "chat", flags: ["payment_declined_once"], arm: "stable" },
    opener: "Hi, I'd like to pay the amount due on my loan L1001.",
  },
  {
    title: "The candidate's regression",
    detail: "Same call on the candidate version from the incident drill.",
    start: { phone: "+14155550101", channel: "chat", flags: ["payment_declined_once"], arm: "candidate" },
    opener: "Hi, I'd like to pay the amount due on my loan L1001.",
  },
  {
    title: "Past-due notice",
    detail: "Jordan's loan is past due; the notice is said by code.",
    start: { phone: "+14155550102", channel: "voice", flags: [], arm: "stable" },
    opener: "How much do I owe on my loan?",
  },
  {
    title: "Step-up by text code",
    detail: "No caller ID: the agent must verify by a code first.",
    start: { phone: null, channel: "chat", flags: [], arm: "stable" },
    opener: "I want to check the balance on loan L1001.",
  },
];

export function Live({ query }: { query: URLSearchParams }) {
  const replay = query.get("replay");
  return (
    <main className="page live">
      <header className="tool-head live__head">
        <div>
          <h1>Live call</h1>
          <p className="lede">The same runner, mock backend, and code checks the gate uses. Underlined sentences came from a tool's code-built text.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={replay === null} className="segmented__item" onClick={() => navigate("/live")}>
            Live
          </button>
          <button role="tab" aria-selected={replay !== null} className="segmented__item" onClick={() => navigate(`/live?replay=${replay ?? ""}`)}>
            Replay a recorded call
          </button>
        </div>
      </header>
      {replay === null ? <LiveMode /> : <ReplayMode id={replay === "" ? null : replay} />}
    </main>
  );
}

// ---- live ----

function toTurns(call: LiveCall): { turns: Turn[]; notes: Map<number, ReactNode> } {
  const turns: Turn[] = [];
  const notes = new Map<number, ReactNode>();
  for (const step of call.steps) {
    if (step.caller !== null) {
      turns.push({ idx: turns.length, role: "caller", text: step.caller });
    }
    if (step.toolSeqs.length > 0 && turns.length > 0) {
      const names = step.toolSeqs.map((s) => `${s + 1} ${call.toolCalls[s]?.name ?? ""}`);
      notes.set(turns.length - 1, <p className="turn__ran">Ran: {names.join(" · ")}</p>);
    }
    for (const u of step.utterances) {
      turns.push(u.kind === "agent" ? { idx: turns.length, role: "agent", text: u.text, latencyMs: null, spans: u.spans } : { idx: turns.length, role: "verbatim", lineId: u.lineId, text: u.text, fromToolSeq: null });
    }
  }
  return { turns, notes };
}

function LiveMode() {
  const options = useResource("live-options", api.liveOptions);
  const [call, setCall] = useState<LiveCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start(body: LiveStart, opener?: string) {
    const c = await run(() => api.liveStart(body));
    if (c === null) return;
    setCall(c);
    setDraft(opener ?? "");
  }

  async function say(e?: FormEvent) {
    e?.preventDefault();
    if (call === null || draft.trim() === "" || busy) return;
    const text = draft;
    setDraft("");
    const c = await run(() => api.liveSay(call.id, text));
    if (c === null) setDraft(text);
    else setCall(c);
  }

  if (options.state === "loading") return <Loading lines={8} label="Loading live call options" />;
  if (options.state === "error") return <Failure error={options.error} what="live call options" />;

  return call === null ? (
    <Setup options={options.data} busy={busy} error={error} onStart={start} />
  ) : (
    <CallPane
      call={call}
      busy={busy}
      error={error}
      draft={draft}
      setDraft={setDraft}
      onSay={say}
      onHangUp={() => run(() => api.liveHangUp(call.id)).then((c) => c !== null && setCall(c))}
      onNew={() => {
        setCall(null);
        setError(null);
      }}
    />
  );
}

function Setup({ options, busy, error, onStart }: { options: LiveOptions; busy: boolean; error: string | null; onStart: (b: LiveStart, opener?: string) => void }) {
  const [phone, setPhone] = useState<string>(options.customers[0]?.phone ?? "");
  const [channel, setChannel] = useState<"chat" | "voice">("chat");
  const [arm, setArm] = useState<"stable" | "candidate">("stable");
  const [flags, setFlags] = useState<string[]>([]);
  const off = !options.modelAvailable;

  return (
    <div className="setup">
      {off ? (
        <div className="notice">
          <p>
            <strong>Live calls are off.</strong> Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and restart <code>npm run viewer</code>. Replay works without a key.{" "}
            <Link to="/live?replay=">Replay a recorded call</Link>
          </p>
        </div>
      ) : null}

      <section aria-labelledby="recipes-title">
        <h2 id="recipes-title" className="section-title">
          Start from a scenario
        </h2>
        <ul className="recipes">
          {RECIPES.map((r) => (
            <li key={r.title}>
              <button className="recipe" disabled={off || busy} onClick={() => onStart(r.start, r.opener)}>
                <span className="recipe__title">{r.title}</span>
                <span className="recipe__detail">{r.detail}</span>
                <span className="recipe__meta mono">
                  {r.start.arm === "candidate" ? options.arms[1]?.version : options.arms[0]?.version} · {r.start.channel}
                  {r.start.flags.length > 0 ? ` · ${r.start.flags.join(", ")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="setup__form"
        aria-labelledby="custom-title"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ phone: phone === "" ? null : phone, channel, flags, arm });
        }}
      >
        <h2 id="custom-title" className="section-title">
          Or set it up yourself
        </h2>
        <div className="setup__grid">
          <label className="field">
            <span>Caller</span>
            <select className="select" value={phone} onChange={(e) => setPhone(e.target.value)}>
              {options.customers.map((c) => (
                <option key={c.phone} value={c.phone}>
                  {c.name}, verified caller ID · {c.loans.map((l) => `${l.id} ${l.status.replace("_", " ")}`).join(", ")}
                </option>
              ))}
              <option value="">No caller ID (Tier 0)</option>
            </select>
          </label>
          <fieldset className="field radios">
            <legend>Channel</legend>
            {(["chat", "voice"] as const).map((c) => (
              <label key={c}>
                <input type="radio" name="channel" checked={channel === c} onChange={() => setChannel(c)} /> {c === "chat" ? "Chat" : "Voice (text as speech)"}
              </label>
            ))}
          </fieldset>
          <fieldset className="field radios">
            <legend>Journey version</legend>
            {options.arms.map((a) => (
              <label key={a.arm}>
                <input type="radio" name="arm" checked={arm === a.arm} onChange={() => setArm(a.arm)} /> <span className="mono">{a.version}</span> {a.arm}
              </label>
            ))}
          </fieldset>
        </div>
        <fieldset className="flags">
          <legend>Backend failures to inject</legend>
          {options.flags.map((f) => (
            <label key={f} className="flag">
              <input type="checkbox" checked={flags.includes(f)} onChange={(e) => setFlags(e.target.checked ? [...flags, f] : flags.filter((x) => x !== f))} />
              <span>
                <span className="mono">{f}</span>
                <span className="flag__help">{FLAG_HELP[f] ?? ""}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error === null ? null : (
          <div className="notice notice--error" role="alert">
            <p>{error}</p>
          </div>
        )}
        <div>
          <button className="button button--primary" type="submit" disabled={off || busy}>
            <Icon name="phone" /> {busy ? "Connecting…" : "Start the call"}
          </button>
          <span className="setup__cost">Model {options.model} · a call costs a few cents</span>
        </div>
      </form>
    </div>
  );
}

function CallPane(props: {
  call: LiveCall;
  busy: boolean;
  error: string | null;
  draft: string;
  setDraft: (s: string) => void;
  onSay: (e?: FormEvent) => void;
  onHangUp: () => void;
  onNew: () => void;
}) {
  const { call, busy, error, draft, setDraft, onSay, onHangUp, onNew } = props;
  const { turns, notes } = useMemo(() => toTurns(call), [call]);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!busy) input.current?.focus();
  }, [turns.length, busy]);

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSay();
    }
  };

  return (
    <div className="callpane">
      <aside className="callpane__side" aria-label="Call details">
        <dl className="facts facts--stack">
          <div>
            <dt>Caller</dt>
            <dd>{call.identity}</dd>
          </div>
          <div>
            <dt>Journey</dt>
            <dd>
              <span className="mono">{call.version}</span> ({call.arm}) · {call.channel}
            </dd>
          </div>
          <div>
            <dt>Injected failures</dt>
            <dd className="mono">{call.flags.length === 0 ? "none" : call.flags.join(", ")}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{call.ended ? <OutcomeMark outcome={call.outcome} /> : busy ? <span className="live-dot is-busy">Agent answering</span> : <span className="live-dot">Your turn</span>}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>
              {fmtCount(call.usage.inputTokens + call.usage.cacheReadTokens + call.usage.cacheWriteTokens)} in ({fmtCount(call.usage.cacheReadTokens)} cached) · {fmtCount(call.usage.outputTokens)} out
            </dd>
          </div>
          {call.guardrailEvents.length === 0 ? null : (
            <div>
              <dt>Guardrails</dt>
              <dd>{call.guardrailEvents.map((g, i) => <span key={i} className="mark mark--fail">{`${g.kind} · ${g.action}`}</span>)}</dd>
            </div>
          )}
        </dl>

        <section className="sms" aria-labelledby="sms-title">
          <h2 id="sms-title" className="sms__title">
            <Icon name="message" /> Text messages
          </h2>
          {call.textMessages.length === 0 ? <p className="sms__empty">None sent. A step-up code would appear here, as if on the phone on file.</p> : null}
          {call.textMessages.map((m) => (
            <p key={m} className="sms__msg mono">
              {m}
            </p>
          ))}
        </section>

        <div className="callpane__actions">
          {call.ended ? (
            <>
              <button className="button button--primary" onClick={onNew}>
                New call
              </button>
              {call.saved ? (
                <Link to={`/calls/${call.id}`} className="button">
                  Open in Calls
                </Link>
              ) : null}
            </>
          ) : (
            <button className="button" onClick={onHangUp} disabled={busy}>
              <Icon name="stop" /> Hang up
            </button>
          )}
        </div>
      </aside>

      <section className="callpane__main" aria-label="Conversation and trace">
        <Trace turns={turns} toolCalls={call.toolCalls} notes={notes} ledgerEmpty="No tool calls yet." />
        <div ref={end} />
        {call.ended ? (
          <div className="ended">
            <p>
              <strong>Call ended:</strong> {call.outcome === null ? call.endReason : `${call.outcome}${call.handoff === null ? "" : `, ${reasonLabel(call.handoff.reason)}`}`}. {call.saved ? "Saved with source manual." : ""}
            </p>
          </div>
        ) : (
          <form className="composer" onSubmit={onSay}>
            <label className="visually-hidden" htmlFor="say">
              Say something as the caller
            </label>
            <textarea id="say" ref={input} className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} placeholder="Speak as the caller. Enter sends, Shift+Enter adds a line." disabled={busy} />
            <button className="button button--primary" type="submit" disabled={busy || draft.trim() === ""}>
              {busy ? "Answering…" : "Send"}
            </button>
          </form>
        )}
        {error === null ? null : (
          <div className="notice notice--error" role="alert">
            <p>{error}</p>
          </div>
        )}
        {call.handoff === null ? null : <HandoffSlip h={call.handoff} />}
      </section>
    </div>
  );
}

// ---- replay ----

function ReplayMode({ id }: { id: string | null }) {
  const summary = useResource("summary", api.summary);
  const gateRunId = summary.state === "ready" ? (summary.data.current?.gateRunId ?? null) : null;
  const list = useResource(gateRunId, () => api.calls(new URLSearchParams({ gateRunId: gateRunId ?? "", limit: "50" })));
  const call = useResource(id, () => api.call(id ?? ""));

  return (
    <div className="replay">
      <label className="field replay__pick">
        <span>Recorded call (latest released gate run, full evidence)</span>
        <select className="select" value={id ?? ""} onChange={(e) => navigate(`/live?replay=${encodeURIComponent(e.target.value)}`, { replace: true })}>
          <option value="">Choose a call…</option>
          {list.state === "ready"
            ? list.data.items
                .filter((c) => c.hasEvidence)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {scenarioName(c.scenarioId ?? c.id)} · {c.id}
                  </option>
                ))
            : null}
        </select>
      </label>
      {id === null ? (
        <div className="empty">
          <h2>Pick a call to replay</h2>
          <p>Replay plays a recorded call back one turn at a time. It costs nothing and needs no API key.</p>
        </div>
      ) : call.state === "loading" ? (
        <Loading lines={8} label="Loading the call" />
      ) : call.state === "error" ? (
        <Failure error={call.error} what={`call ${id}`} />
      ) : (
        <Replayer key={call.data.id} call={call.data} />
      )}
    </div>
  );
}

function Replayer({ call }: { call: CallDetail }) {
  const [shown, setShown] = useState(1);
  const [playing, setPlaying] = useState(false);
  const total = call.turns.length;

  useEffect(() => {
    if (!playing) return;
    if (shown >= total) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), 1500);
    return () => window.clearTimeout(t);
  }, [playing, shown, total]);

  const turns = call.turns.slice(0, shown);
  // Tools appear once a shown sentence quotes them, or once everything is shown.
  const quoted = Math.max(
    -1,
    ...turns.flatMap((t) => (t.role === "agent" ? t.spans.flatMap((s) => (s.from.kind === "tool" ? [s.from.seq] : [])) : t.role === "verbatim" && t.fromToolSeq !== null ? [t.fromToolSeq] : [])),
  );
  const tools = shown >= total ? call.toolCalls : call.toolCalls.filter((t) => t.seq <= quoted);

  return (
    <div className="callpane">
      <aside className="callpane__side" aria-label="Replay controls">
        <dl className="facts facts--stack">
          <div>
            <dt>Scenario</dt>
            <dd>{scenarioName(call.scenarioId ?? call.id)}</dd>
          </div>
          <div>
            <dt>Journey</dt>
            <dd className="mono">{call.version}</dd>
          </div>
          <div>
            <dt>Turn</dt>
            <dd>
              {shown} of {total}
            </dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{shown >= total ? <OutcomeMark outcome={call.outcome} /> : "—"}</dd>
          </div>
        </dl>
        <div className="callpane__actions">
          <button className="button button--primary" onClick={() => setPlaying((p) => !p)} disabled={shown >= total}>
            <Icon name={playing ? "stop" : "play"} /> {playing ? "Pause" : "Play"}
          </button>
          <button className="button" onClick={() => setShown((n) => Math.min(total, n + 1))} disabled={shown >= total}>
            <Icon name="step" /> Next turn
          </button>
          <button
            className="button button--quiet"
            onClick={() => {
              setShown(1);
              setPlaying(false);
            }}
          >
            Restart
          </button>
        </div>
        <p className="replay__note">A recorded call stores turns and tool calls separately, so each tool appears when a shown sentence first quotes it.</p>
        <Link to={`/calls/${call.id}`} className="replay__open">
          Open the full trace <Icon name="arrow" />
        </Link>
      </aside>
      <section className="callpane__main" aria-label="Replayed conversation">
        <Trace turns={turns} toolCalls={tools} ledgerEmpty="Tool calls appear here when a shown sentence quotes them." />
        {shown >= total && call.handoff !== null ? <HandoffSlip h={call.handoff} /> : null}
      </section>
    </div>
  );
}
