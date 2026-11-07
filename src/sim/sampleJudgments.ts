// CLAUDE-OWNED (M7). Writes a labeling sheet for judge calibration (SPEC §9, docs/judge-calibration.md):
// a sample of stored judgments, each with its transcript, tool calls and the judge's verdict.
//   npm run judge:sample -- --n 12 [--kind transfer_quality]
// Failed verdicts are always included (they are rarer and matter most), then passed ones at random.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openDb } from "../db/db.js";

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "12" },
    db: { type: "string", default: "data/journey-lab.db" },
    out: { type: "string", default: "docs/judge-sample.md" },
    kind: { type: "string" }, // hallucination | transfer_quality; both when omitted
  },
});
if (values.kind !== undefined && values.kind !== "hallucination" && values.kind !== "transfer_quality") {
  throw new Error(`--kind must be hallucination or transfer_quality, got ${values.kind}`);
}

type Row = { id: number; call_id: string; kind: string; passed: number; reason: string; scenario_id: string | null };

const db = openDb(values.db);
const rows = db.sql
  .prepare<[{ kind: string | null }], Row>(
    // Only calls stored with their evidence (identity, tool results, handoff): a labeler must see what the judge saw.
    `SELECT j.id, j.call_id, j.kind, j.passed, j.reason, s.scenario_id
     FROM judgments j JOIN calls c ON c.id = j.call_id LEFT JOIN sim_results s ON s.call_id = j.call_id
     WHERE j.human_label IS NULL AND c.identity_at_start IS NOT NULL AND (@kind IS NULL OR j.kind = @kind)
     ORDER BY j.passed ASC, random()`,
  )
  .all({ kind: values.kind ?? null })
  .slice(0, Number(values.n));

const sections = rows.map((r) => {
  const turns = db.sql
    .prepare<[string], { role: string; line_id: string | null; text_redacted: string }>(
      "SELECT role, line_id, text_redacted FROM turns WHERE call_id = ? ORDER BY idx",
    )
    .all(r.call_id)
    .map((t) => `- **${t.role}**${t.line_id === null ? "" : ` [${t.line_id}]`}: ${t.text_redacted.replaceAll("\n", " ")}`);
  // Inputs and results exist only for calls stored after they were added (older rows have NULL).
  const tools = db.sql
    .prepare<[string], { name: string; executed: number; error_kind: string | null; input_json: string | null; result_json: string | null }>(
      "SELECT name, executed, error_kind, input_json, result_json FROM tool_calls WHERE call_id = ? ORDER BY id",
    )
    .all(r.call_id)
    .map((t) => {
      const head = `${t.name}${t.input_json === null ? "" : `(${t.input_json})`}${t.executed ? "" : " (blocked)"}`;
      return `- ${head}${t.result_json === null ? (t.error_kind === null ? "" : ` !${t.error_kind}`) : ` → ${t.result_json}`}`;
    });
  const handoff = db.sql.prepare<[string], { handoff_json: string | null }>("SELECT handoff_json FROM calls WHERE id = ?").get(r.call_id);
  const handoffLines =
    r.kind !== "transfer_quality"
      ? []
      : handoff?.handoff_json == null
        ? ["**Handoff**: not stored for this call (stored before the column existed).", ""]
        : ["**Handoff** (what the judge judged):", "", "```json", handoff.handoff_json, "```", ""];
  // The verdict comes after the evidence, so a labeler can decide before seeing it.
  return [
    `## Judgment ${r.id}: ${r.kind} on ${r.scenario_id ?? "?"} (${r.call_id})`,
    "",
    "**Tools** (input → exact result the agent saw):",
    "",
    ...(tools.length > 0 ? tools : ["- none"]),
    "",
    "**Transcript**:",
    "",
    ...turns,
    "",
    ...handoffLines,
    "Your label (PASS/FAIL) and why: ",
    "",
    "<details><summary>Judge verdict (open after you decide)</summary>",
    "",
    `**${r.passed ? "PASS" : "FAIL"}**`,
    "",
    `> ${r.reason.replaceAll("\n", "\n> ")}`,
    "",
    "</details>",
    "",
  ].join("\n");
});

writeFileSync(
  values.out,
  `# Judge sample for labeling\n\nGenerated ${new Date().toISOString()} from ${values.db}. Decide each label before opening ` +
    "the judge's verdict, then record the results in docs/judge-calibration.md.\n\n" +
    sections.join("\n"),
);
db.close();
console.log(`wrote ${rows.length} judgments to ${values.out}`);
