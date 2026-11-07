// CLAUDE-OWNED (M10). Which parts of an agent line are a tool's code-built text, and which are the model's words.
// Matched by text: a stored call keeps its turns and its tool calls in two tables with no shared order, so the
// tool a sentence came from is found by the sentence itself. Exact for "code owns facts": a tool's spoken
// sentence that reaches the caller unchanged is found; a paraphrase is the model's language, and shows as such.
import type { Span } from "./types.js";

export type SpokenSource = { seq: number; name: string; spoken: string[] };

const MIN_SENTENCE = 12; // shorter fragments ("Thanks.") match by accident

// Every string under a "spoken" or "spokenToCustomer" key: the success text, a decline, an invalid amount.
export function spokenIn(result: unknown): string[] {
  if (Array.isArray(result)) return result.flatMap(spokenIn);
  if (typeof result !== "object" || result === null) return [];
  return Object.entries(result).flatMap(([k, v]) =>
    (k === "spoken" || k === "spokenToCustomer") && typeof v === "string" && v !== "" ? [v] : spokenIn(v),
  );
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE);
}

type Match = { start: number; end: number; seq: number; name: string };

// Tool results are used in call order, so for each turn prefer the earliest source at or after the last one the
// previous turns used. `cursor` carries that position from turn to turn.
export function provenance(text: string, sources: SpokenSource[], cursor = 0): { spans: Span[]; cursor: number } {
  const found: Match[] = [];
  const candidates = new Map<string, SpokenSource[]>();
  for (const src of sources) {
    for (const s of src.spoken.flatMap(sentences)) candidates.set(s, [...(candidates.get(s) ?? []), src]);
  }
  for (const [sentence, srcs] of candidates) {
    const src = srcs.find((x) => x.seq >= cursor) ?? srcs[0];
    if (src === undefined) continue;
    for (let at = text.indexOf(sentence); at !== -1; at = text.indexOf(sentence, at + sentence.length)) {
      found.push({ start: at, end: at + sentence.length, seq: src.seq, name: src.name });
    }
  }

  // Longest first wins an overlap, then left to right.
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Match[] = [];
  for (const m of found) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  kept.sort((a, b) => a.start - b.start);

  const spans: Span[] = [];
  const push = (span: Span) => {
    const last = spans.at(-1);
    const same =
      last !== undefined &&
      (span.from.kind === "tool"
        ? last.from.kind === "tool" && last.from.seq === span.from.seq
        : last.from.kind === span.from.kind);
    if (same) last.text += span.text;
    else spans.push(span);
  };
  let pos = 0;
  for (const m of kept) {
    const gap = text.slice(pos, m.start);
    // Whitespace between two sentences of one tool stays inside that tool's span.
    const prev = spans.at(-1);
    if (gap.trim() === "" && prev?.from.kind === "tool" && prev.from.seq === m.seq) prev.text += gap;
    else if (gap !== "") push({ text: gap, from: { kind: "model" } });
    push({ text: text.slice(m.start, m.end), from: { kind: "tool", seq: m.seq, name: m.name } });
    pos = m.end;
  }
  if (pos < text.length) push({ text: text.slice(pos), from: { kind: "model" } });

  const used = kept.map((m) => m.seq);
  return { spans, cursor: used.length > 0 ? Math.max(cursor, ...used) : cursor };
}
