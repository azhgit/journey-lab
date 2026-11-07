// The system map on page 1: stored records, stepped by the presenter. Lines draw only on a click, never on a loop.
// Teal is code, ink is the model and the caller, red is a refusal or a failure. Each state also has a word in the panel.
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import type { CheckId, Evidence, FlowPath, FlowStep, MapId, NodeId, Owner } from "../app/flow";
import { Link } from "../app/router";
import { reducedMotion } from "../app/scroll";
import { Icon } from "./Icon";

type Box = { x: number; y: number; w: number; h: number };
type Point = readonly [number, number];
// `lane` separates the two directions of one line. Forward adds it, back subtracts it.
type Line = { a: NodeId; b: NodeId; points: readonly Point[]; lane: Point };
type Layout = { width: number; height: number; boxes: Partial<Record<NodeId, Box>>; lines: readonly Line[]; stackChecks: boolean };

const NONE: Point = [0, 0];

const LAYOUTS: Record<MapId, { wide: Layout; narrow: Layout }> = {
  call: {
    wide: {
      width: 720,
      height: 252,
      stackChecks: false,
      boxes: {
        caller: { x: 0, y: 0, w: 130, h: 96 },
        runner: { x: 210, y: 0, w: 290, h: 96 },
        model: { x: 580, y: 12, w: 140, h: 72 },
        db: { x: 0, y: 168, w: 130, h: 72 },
        tools: { x: 210, y: 156, w: 290, h: 96 },
        backend: { x: 580, y: 168, w: 140, h: 72 },
      },
      lines: [
        { a: "caller", b: "runner", points: [[130, 48], [210, 48]], lane: [0, 10] },
        { a: "runner", b: "model", points: [[500, 48], [580, 48]], lane: [0, 10] },
        { a: "runner", b: "tools", points: [[355, 96], [355, 156]], lane: [10, 0] },
        { a: "tools", b: "backend", points: [[500, 204], [580, 204]], lane: [0, 10] },
        { a: "runner", b: "db", points: [[250, 96], [250, 132], [65, 132], [65, 168]], lane: NONE },
      ],
    },
    narrow: {
      width: 340,
      height: 412,
      stackChecks: true,
      boxes: {
        caller: { x: 0, y: 0, w: 160, h: 84 },
        model: { x: 180, y: 20, w: 160, h: 64 },
        runner: { x: 0, y: 132, w: 216, h: 130 },
        db: { x: 250, y: 165, w: 90, h: 64 },
        tools: { x: 0, y: 308, w: 216, h: 104 },
        backend: { x: 250, y: 328, w: 90, h: 64 },
      },
      lines: [
        { a: "caller", b: "runner", points: [[80, 84], [80, 132]], lane: [10, 0] },
        { a: "runner", b: "model", points: [[180, 132], [180, 108], [260, 108], [260, 84]], lane: [10, 0] },
        { a: "runner", b: "tools", points: [[108, 262], [108, 308]], lane: [10, 0] },
        { a: "tools", b: "backend", points: [[216, 360], [250, 360]], lane: [0, 8] },
        { a: "runner", b: "db", points: [[216, 197], [250, 197]], lane: NONE },
      ],
    },
  },
  gate: {
    wide: {
      width: 720,
      height: 372,
      stackChecks: false,
      boxes: {
        scenarios: { x: 0, y: 12, w: 130, h: 72 },
        runsim: { x: 210, y: 0, w: 290, h: 96 },
        call: { x: 580, y: 12, w: 140, h: 72 },
        judge: { x: 0, y: 168, w: 130, h: 72 },
        checks: { x: 210, y: 168, w: 290, h: 72 },
        gate: { x: 580, y: 156, w: 140, h: 96 },
        db: { x: 580, y: 300, w: 140, h: 72 },
      },
      lines: [
        { a: "scenarios", b: "runsim", points: [[130, 48], [210, 48]], lane: NONE },
        { a: "runsim", b: "call", points: [[500, 48], [580, 48]], lane: [0, 10] },
        { a: "runsim", b: "judge", points: [[250, 96], [250, 132], [65, 132], [65, 168]], lane: NONE },
        { a: "runsim", b: "checks", points: [[355, 96], [355, 168]], lane: NONE },
        { a: "checks", b: "gate", points: [[500, 204], [580, 204]], lane: NONE },
        { a: "judge", b: "gate", points: [[65, 240], [65, 276], [620, 276], [620, 252]], lane: NONE },
        { a: "gate", b: "db", points: [[680, 252], [680, 300]], lane: NONE },
      ],
    },
    narrow: {
      width: 340,
      height: 570,
      stackChecks: false,
      boxes: {
        scenarios: { x: 0, y: 0, w: 150, h: 64 },
        call: { x: 190, y: 0, w: 150, h: 64 },
        runsim: { x: 0, y: 112, w: 340, h: 96 },
        judge: { x: 0, y: 256, w: 150, h: 64 },
        checks: { x: 190, y: 256, w: 150, h: 64 },
        gate: { x: 95, y: 368, w: 150, h: 90 },
        db: { x: 95, y: 506, w: 150, h: 64 },
      },
      lines: [
        { a: "scenarios", b: "runsim", points: [[75, 64], [75, 112]], lane: NONE },
        { a: "runsim", b: "call", points: [[265, 112], [265, 64]], lane: [10, 0] },
        { a: "runsim", b: "judge", points: [[75, 208], [75, 256]], lane: NONE },
        { a: "runsim", b: "checks", points: [[265, 208], [265, 256]], lane: NONE },
        { a: "checks", b: "gate", points: [[265, 320], [265, 344], [215, 344], [215, 368]], lane: NONE },
        { a: "judge", b: "gate", points: [[75, 320], [75, 344], [125, 344], [125, 368]], lane: NONE },
        { a: "gate", b: "db", points: [[170, 458], [170, 506]], lane: NONE },
      ],
    },
  },
};

type NodeSpec = { title: string; sub: string; role: "code" | "language" | "store"; checks?: readonly CheckId[]; stamped?: boolean };

const NODES: Record<NodeId, NodeSpec> = {
  caller: { title: "Caller", sub: "Simulated caller", role: "language", stamped: true },
  runner: { title: "Runner", sub: "Code: checks each tool call", role: "code", checks: ["tier", "confirm", "verbatim"] },
  model: { title: "Agent model", sub: "Words and tool choice", role: "language" },
  tools: { title: "Tools", sub: "Code: builds the facts", role: "code", checks: ["ownership", "limits"] },
  backend: { title: "Mock backend", sub: "REST and GraphQL", role: "store" },
  db: { title: "SQLite", sub: "Calls and gate runs", role: "store" },
  scenarios: { title: "Scenarios", sub: "Goal, identity, flags", role: "code" },
  runsim: { title: "runSim", sub: "Code: runs one simulated call", role: "code", checks: ["callerModel", "failures"] },
  call: { title: "Runner", sub: "Same as a live call", role: "code" },
  judge: { title: "LLM judge", sub: "Claims, transfers", role: "language" },
  checks: { title: "Code checks", sub: "Tools, lines, amounts", role: "code" },
  gate: { title: "Gate", sub: "Code: decides release", role: "code", stamped: true },
};

const CHECK_LABEL: Record<CheckId, string> = {
  tier: "Tier check",
  confirm: "Confirmation",
  verbatim: "Fixed lines",
  ownership: "Ownership compare",
  limits: "Step-up limits",
  callerModel: "Caller model",
  failures: "Injected failures",
};

const OWNER_LABEL: Record<Owner, string> = { code: "Code", model: "Model", caller: "Caller" };

const SEGMENT_MS = 240; // one line draws in this time, and the next starts when it ends
const narrowQuery = "(max-width: 640px)";

function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(narrowQuery);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(narrowQuery).matches,
  );
}

const edgeKey = (a: NodeId, b: NodeId) => [a, b].sort().join("-");

function hops(route: readonly NodeId[]): [NodeId, NodeId][] {
  return route.slice(1).map((to, i) => [route[i] as NodeId, to]);
}

function pathOf(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

// The points of one hop in its travel direction, on its own lane.
function travel(layout: Layout, from: NodeId, to: NodeId): readonly Point[] | null {
  const line = layout.lines.find((l) => edgeKey(l.a, l.b) === edgeKey(from, to));
  if (line === undefined) return null;
  const forward = line.a === from;
  const sign = forward ? 1 : -1;
  const shifted = line.points.map(([x, y]): Point => [x + sign * line.lane[0], y + sign * line.lane[1]]);
  return forward ? shifted : [...shifted].reverse();
}

function Arrow({ points }: { points: readonly Point[] }) {
  const end = points.at(-1);
  const before = points.at(-2);
  if (end === undefined || before === undefined) return null;
  const angle = (Math.atan2(end[1] - before[1], end[0] - before[0]) * 180) / Math.PI;
  return <path className="flow__arrow" d="M-7 -4 L0 0 L-7 4 Z" transform={`translate(${end[0]} ${end[1]}) rotate(${angle})`} />;
}

function NodeBox({ id, box, stackChecks, step, stamped }: { id: NodeId; box: Box; stackChecks: boolean; step: FlowStep; stamped: boolean }) {
  const node = NODES[id];
  const arrival = (step.route.length - 1) * SEGMENT_MS;
  const at = step.route.at(-1) === id;
  const small = box.w < 100;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const bare = node.checks === undefined && node.stamped !== true; // nothing under the text, so the text centres
  const titleY = small ? cy + (node.title.includes(" ") ? -3 : 5) : bare ? cy - 3 : box.y + 24;
  const subY = bare ? cy + 15 : box.y + 41;
  const stamp = step.stamp?.node === id ? step.stamp : null;

  return (
    <g className={`flow__node flow__node--${node.role}${step.route.includes(id) ? " is-on" : ""}${at ? " is-at" : ""}`} style={{ "--arrive": `${arrival}ms` } as CSSProperties}>
      <rect className="flow__box" x={box.x} y={box.y} width={box.w} height={box.h} rx={3} />
      <rect className="flow__cap" x={box.x} y={box.y} width={box.w} height={3} />
      <text className="flow__title" x={cx} y={titleY} textAnchor="middle">
        {small ? node.title.split(" ").map((word, i) => <tspan key={word} x={cx} dy={i === 0 ? 0 : 15}>{word}</tspan>) : node.title}
      </text>
      {small ? null : (
        <text className="flow__sub" x={cx} y={subY} textAnchor="middle">
          {node.sub}
        </text>
      )}
      {node.checks?.map((check, i, all) => {
        const pad = 10;
        const gap = 8;
        const w = stackChecks ? box.w - pad * 2 : (box.w - pad * 2 - gap * (all.length - 1)) / all.length;
        const x = stackChecks ? box.x + pad : box.x + pad + i * (w + gap);
        const y = stackChecks ? box.y + 50 + i * 25 : box.y + 56;
        return (
          <g key={check} className={`flow__check${step.checks.includes(check) ? " is-lit" : ""}`}>
            <rect x={x} y={y} width={w} height={22} rx={2} />
            <text x={x + w / 2} y={y + 15} textAnchor="middle">
              {CHECK_LABEL[check]}
            </text>
          </g>
        );
      })}
      {stamp === null ? null : (
        <g key={stamp.text} className={`flow__stamp flow__stamp--${stamp.tone}${stamped ? " is-stamped" : ""}`}>
          <rect x={cx - 34} y={box.y + box.h - 34} width={68} height={24} rx={2} />
          <text x={cx} y={box.y + box.h - 17.5} textAnchor="middle">
            {stamp.text}
          </text>
        </g>
      )}
    </g>
  );
}

function SystemMap({ steps, at, step, layout }: { steps: FlowStep[]; at: number; step: FlowStep; layout: Layout }) {
  const walked = new Set(steps.slice(0, at).flatMap((s) => hops(s.route).map(([a, b]) => edgeKey(a, b))));
  const stamped = at > 0 && steps[at - 1]?.stamp?.text !== step.stamp?.text;
  const names = (Object.keys(layout.boxes) as NodeId[]).map((id) => NODES[id].title);

  return (
    <svg className="flow__map" viewBox={`-1 -1 ${layout.width + 2} ${layout.height + 2}`} role="img" aria-label={`System map: ${names.join(", ")}. The panel next to it describes the current step.`}>
      <g>
        {layout.lines.map((l) => (
          <path key={edgeKey(l.a, l.b)} className={`flow__line${walked.has(edgeKey(l.a, l.b)) ? " is-walked" : ""}`} d={pathOf(l.points)} />
        ))}
      </g>
      {(Object.entries(layout.boxes) as [NodeId, Box][]).map(([id, box]) => (
        <NodeBox key={id} id={id} box={box} stackChecks={layout.stackChecks} step={step} stamped={stamped} />
      ))}
      {/* Keyed by step, so moving to another step draws its route again from the start. */}
      <g key={at}>
        {hops(step.route).map(([from, to], i) => {
          const points = travel(layout, from, to);
          if (points === null) return null;
          const refused = step.refusedFrom !== undefined && i >= step.refusedFrom;
          const tone = refused ? "refused" : i < step.languageHops ? "language" : "code";
          return (
            <g key={i} className={`flow__hop flow__hop--${tone}`} style={{ "--delay": `${i * SEGMENT_MS}ms`, "--draw": `${SEGMENT_MS}ms` } as CSSProperties}>
              <path className="flow__draw" d={pathOf(points)} pathLength={1} />
              <Arrow points={points} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function EvidenceRow({ item }: { item: Evidence }) {
  const failed = item.kind === "data" && item.failed === true;
  return (
    <div className={`flow__ev flow__ev--${item.kind}`}>
      <dt>{item.label}</dt>
      <dd>
        {item.kind === "tool" ? (
          <span className="span-tool">{item.text}</span>
        ) : item.kind === "data" ? (
          <code className={failed ? "flow__refused" : undefined}>{item.text}</code>
        ) : (
          item.text
        )}
      </dd>
    </div>
  );
}

function PathView({ path }: { path: FlowPath }) {
  const [at, setAt] = useState(0);
  const [openAll] = useState(reducedMotion);
  const narrow = useNarrow();
  const { steps, source } = path;
  const step = steps[at];
  if (step === undefined) return null;
  const last = at === steps.length - 1;
  const layouts = LAYOUTS[path.map];

  return (
    <>
      <p className="flow__lede">{path.lede}</p>

      <div className="flow__grid">
        <div>
          <SystemMap steps={steps} at={at} step={step} layout={narrow ? layouts.narrow : layouts.wide} />
          <ul className="flow__legend" aria-label="Line colours">
            <li>
              <span className="flow__swatch flow__swatch--code" /> Code
            </li>
            <li>
              <span className="flow__swatch flow__swatch--language" /> Model or caller
            </li>
            <li>
              <span className="flow__swatch flow__swatch--refused" /> Refused or failed
            </li>
          </ul>
        </div>

        <div className="flow__panel">
          <div className="flow__bar">
            <p className="flow__count">
              Step {at + 1} of {steps.length}
            </p>
            <div className="flow__controls">
              <button type="button" className="button" disabled={at === 0} onClick={() => setAt(at - 1)}>
                Back
              </button>
              <button type="button" className="button button--primary" onClick={() => setAt(last ? 0 : at + 1)}>
                {last ? "Start again" : "Next"}
                {last ? null : <Icon name="arrow" />}
              </button>
            </div>
          </div>

          <div aria-live="polite">
            <h3 className="flow__title-text">{step.title}</h3>
            <p className="flow__owner">
              <span className={step.owner === "code" ? "mark mark--perf" : "mark mark--neutral"}>{OWNER_LABEL[step.owner]}</span>
            </p>
            <p className="flow__detail">{step.detail}</p>
            <dl className="flow__evidence">
              {step.evidence.map((item) => (
                <EvidenceRow key={item.label} item={item} />
              ))}
            </dl>
          </div>
        </div>
      </div>

      <p className="source-note flow__source">
        Source: {source.kind} <Link to={source.to} className="mono">{source.id}</Link>. {source.note}
      </p>

      <details className="flow__all" open={openAll}>
        <summary>Read all {steps.length} steps as text</summary>
        <ol>
          {steps.map((s) => (
            <li key={s.title}>
              <strong>{s.title}.</strong> {s.detail}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}

export function FlowMap({ paths }: { paths: FlowPath[] }) {
  const [pathId, setPathId] = useState(paths[0]?.id);
  const path = paths.find((p) => p.id === pathId) ?? paths[0];

  return (
    <section id="flow" className="flow" aria-labelledby="flow-title">
      <h2 className="sheet__h2" id="flow-title">
        How the system works
      </h2>
      {path === undefined ? (
        <p className="lede">No stored call or gate run matches these paths. Run the gate to record them.</p>
      ) : (
        <>
          <div className="flow__paths" role="group" aria-label="Choose a path">
            {paths.map((p) => (
              <button key={p.id} type="button" className="flow__path" aria-pressed={p.id === path.id} onClick={() => setPathId(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Keyed by path, so a new path starts at its first step. */}
          <PathView key={path.id} path={path} />
        </>
      )}
    </section>
  );
}
