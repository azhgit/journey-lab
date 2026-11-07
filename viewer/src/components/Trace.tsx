// A call as registered views: the transcript on the left, the tool ledger on the right, and a leader from each
// code-owned sentence to the tool result it came from. Pointing at either side lights its pair.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Span, ToolCall, Turn } from "../../../src/viewer/types";
import { prettyJson } from "../app/format";
import { Icon } from "./Icon";

const ROLE_LABEL = { caller: "Caller", agent: "Agent", verbatim: "Fixed text" } as const;

const LINE_LABEL: Record<string, string> = {
  greeting_disclosure: "Greeting and recording disclosure",
  delinquent_notice: "Past-due notice",
  payment_confirmation: "Payment read-back from preparePayment",
  transfer_notice: "Transfer notice",
};

type Leader = { seq: number; d: string; key: string };

export type TraceProps = {
  turns: Turn[];
  toolCalls: ToolCall[];
  proving?: { idx: number; note: string }; // the one line that proves the chapter's claim
  post?: boolean; // the focal moment: entries post when the trace scrolls into view
  notes?: Map<number, ReactNode>; // shown under a turn, by turn idx (live calls: which tools ran)
  ledgerEmpty?: string;
  footer?: ReactNode;
};

export function Trace({ turns, toolCalls, proving, post = false, notes, ledgerEmpty = "No tool calls on this call.", footer }: TraceProps) {
  const [lit, setLit] = useState<number | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [posted, setPosted] = useState(!post);
  const root = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const el = root.current;
    if (el === null) return;
    const box = el.getBoundingClientRect();
    // When the ledger stacks under the transcript (narrow screens), the reference numbers carry the link alone.
    const column = el.querySelector<HTMLElement>(".trace__transcript");
    const ledger = el.querySelector<HTMLElement>(".trace__ledger");
    if (column === null || ledger === null || ledger.getBoundingClientRect().left < column.getBoundingClientRect().right) {
      setLeaders([]);
      return;
    }
    const edge = column.getBoundingClientRect().right - box.left;
    const next: Leader[] = [];
    el.querySelectorAll<HTMLElement>("[data-span-seq]").forEach((span, i) => {
      const seq = Number(span.dataset.spanSeq);
      const entry = el.querySelector<HTMLElement>(`[data-tool-seq="${seq}"]`);
      if (entry === null) return;
      const rects = span.getClientRects();
      const last = rects[rects.length - 1];
      if (last === undefined) return;
      const e = entry.getBoundingClientRect();
      const x1 = last.right - box.left + 4;
      const y1 = last.top - box.top + last.height / 2;
      const x2 = e.left - box.left - 6;
      const y2 = e.top - box.top + 22;
      // Straight along the empty end of the line to the column edge, then a curve through the gutter only,
      // so a leader never crosses text.
      const gx = Math.max(edge + 4, x1);
      if (x2 - gx < 16) return;
      const mid = gx + (x2 - gx) * 0.5;
      next.push({ seq, key: `${seq}-${i}`, d: `M${x1},${y1} L${gx},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` });
    });
    setLeaders(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = root.current;
    if (el === null) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, turns, toolCalls]);

  useEffect(() => {
    if (!post || root.current === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPosted(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting === true) {
          setPosted(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(root.current);
    return () => io.disconnect();
  }, [post]);

  let order = 0; // posting order of code-owned spans, for the stagger
  const spanView = (s: Span, key: string) => {
    if (s.from.kind !== "tool") return <span key={key} className={s.from.kind === "unknown" ? "span-unknown" : undefined}>{s.text}</span>;
    const seq = s.from.seq;
    const n = order++;
    return (
      <span
        key={key}
        className={`span-tool${lit === seq ? " is-lit" : ""}`}
        data-span-seq={seq}
        style={{ "--post-delay": `${Math.min(n, 8) * 140}ms` } as CSSProperties}
        tabIndex={0}
        onMouseEnter={() => setLit(seq)}
        onMouseLeave={() => setLit(null)}
        onFocus={() => setLit(seq)}
        onBlur={() => setLit(null)}
        aria-label={`${s.text} — from ${s.from.name}, entry ${seq + 1}`}
      >
        {s.text}
        <sup className="span-ref" aria-hidden="true">
          {seq + 1}
        </sup>
      </span>
    );
  };

  const unknown = turns.some((t) => t.role === "agent" && t.spans.some((s) => s.from.kind === "unknown"));

  return (
    <div className={`trace${posted ? " is-posted" : ""}${post ? " trace--post" : ""}`} ref={root}>
      <ol className="trace__transcript" aria-label="Transcript">
        {turns.map((t) => (
          <li key={t.idx} className={`turn turn--${t.role}${proving?.idx === t.idx ? " turn--proving" : ""}`}>
            <span className="turn__who">{ROLE_LABEL[t.role]}</span>
            <div className="turn__body">
              {t.role === "verbatim" ? (
                <>
                  <span className="turn__line">
                    {LINE_LABEL[t.lineId] ?? t.lineId}
                    {t.fromToolSeq === null ? null : <span className="mono"> · entry {t.fromToolSeq + 1}</span>}
                  </span>
                  <p>{t.text}</p>
                </>
              ) : t.role === "agent" ? (
                <p>{t.spans.map((s, i) => spanView(s, `${t.idx}-${i}`))}</p>
              ) : (
                <p>{t.text}</p>
              )}
              {proving?.idx === t.idx ? <p className="turn__proving">{proving.note}</p> : null}
              {notes?.get(t.idx) ?? null}
            </div>
          </li>
        ))}
      </ol>

      <svg className="trace__leaders" aria-hidden="true">
        {leaders.map((l, i) => (
          <path
            key={l.key}
            d={l.d}
            pathLength={1}
            className={lit === l.seq ? "is-lit" : undefined}
            style={{ "--post-delay": `${Math.min(i, 8) * 140 + 260}ms` } as CSSProperties}
          />
        ))}
      </svg>

      <ol className="trace__ledger" aria-label="Tool calls">
        {toolCalls.length === 0 ? <li className="ledger-empty">{ledgerEmpty}</li> : null}
        {toolCalls.map((t) => (
          <li
            key={t.seq}
            data-tool-seq={t.seq}
            className={`entry${lit === t.seq ? " is-lit" : ""}${t.executed ? "" : " entry--blocked"}${t.executed && !t.ok ? " entry--failed" : ""}`}
            onMouseEnter={() => setLit(t.seq)}
            onMouseLeave={() => setLit(null)}
          >
            <div className="entry__head">
              <span className="entry__ref mono">{t.seq + 1}</span>
              <span className="entry__name mono">{t.name}</span>
              <span className="entry__state">
                {!t.executed ? (
                  <span className="mark mark--fail">Blocked</span>
                ) : t.ok ? (
                  <span className="entry__ok">ok · {t.latencyMs} ms</span>
                ) : (
                  <span className="mark mark--fail">{t.errorKind ?? "error"}</span>
                )}
              </span>
            </div>
            {t.input === null ? null : <code className="entry__input">{compactInput(t.input)}</code>}
            {t.spoken.map((s, i) => (
              <p key={i} className="entry__spoken">
                {s}
              </p>
            ))}
            {t.result === null ? (
              <p className="entry__missing">Result not stored (call recorded before tool results were kept).</p>
            ) : (
              <details className="entry__result">
                <summary>
                  <Icon name="arrow" /> Result the model saw
                </summary>
                <pre>{prettyJson(t.result)}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>

      <div className="trace__legend">
        <span>
          <span className="legend-swatch legend-swatch--tool" /> Code-built text from a tool, said unchanged
        </span>
        <span>
          <span className="legend-swatch legend-swatch--fixed" /> Fixed text said by code
        </span>
        <span>
          <span className="legend-swatch legend-swatch--model" /> The model's own words
        </span>
        {unknown ? <span className="legend-note">This call was stored before tool results were kept, so its sources cannot be shown.</span> : null}
      </div>
      {footer}
    </div>
  );
}

function compactInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return String(input);
  const entries = Object.entries(input);
  if (entries.length === 0) return "()";
  return `(${entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")})`;
}
