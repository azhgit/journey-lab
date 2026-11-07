// CLAUDE-OWNED (M8). Loads the named queries in queries.sql and runs them; `npm run queries` prints them all.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { Db } from "../db/db.js";
import { openDb } from "../db/db.js";

export type Row = Record<string, unknown>;

export function loadQueries(path = new URL("./queries.sql", import.meta.url)): Map<string, string> {
  const queries = new Map<string, string>();
  for (const chunk of readFileSync(path, "utf8").split(/^-- name: /m).slice(1)) {
    const [name = "", ...body] = chunk.split("\n");
    queries.set(name.trim(), body.join("\n").trim());
  }
  return queries;
}

export function runQuery(db: Db, queries: Map<string, string>, name: string, source: string): Row[] {
  const sql = queries.get(name);
  if (sql === undefined) throw new Error(`no query named ${name} in queries.sql`);
  return db.sql.prepare<{ source: string }, Row>(sql).all({ source });
}

export function formatRows(rows: Row[]): string {
  const first = rows[0];
  if (first === undefined) return "(no rows)";
  const cols = Object.keys(first);
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}

// CLI: npm run queries -- --source synthetic_prod
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: { source: { type: "string", default: "synthetic_prod" }, db: { type: "string", default: "data/journey-lab.db" } },
  });
  const db = openDb(values.db);
  const queries = loadQueries();
  for (const name of queries.keys()) console.log(`\n## ${name} (source = ${values.source})\n${formatRows(runQuery(db, queries, name, values.source))}`);
  db.close();
}
