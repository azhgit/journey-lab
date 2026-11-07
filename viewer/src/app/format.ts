// Display formats. Dates are shown in UTC: sims run on a fixed clock, and gate runs are compared across days.

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export const fmtDay = (iso: string) => (iso === "" ? "—" : day.format(new Date(iso)));
export const fmtDayYear = (iso: string) => (iso === "" ? "—" : dayYear.format(new Date(iso)));
export const fmtTime = (iso: string) => (iso === "" ? "—" : `${time.format(new Date(iso))} UTC`);
export const fmtPct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const fmtUsd = (x: number | null) => (x === null ? "—" : `$${x.toFixed(2)}`);
export const fmtCount = (n: number) => n.toLocaleString("en-US");

export function fmtPeriod(from: string, to: string): string {
  return from === "" ? "—" : `${fmtDay(from)} – ${fmtDayYear(to)}`;
}

// Scenario ids are snake_case; shown as words.
const PROPER: Record<string, string> = { graphql: "GraphQL", kb: "KB" };
export const scenarioName = (id: string) => {
  const words = id
    .split("_")
    .map((w) => PROPER[w] ?? w)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const OUTCOME_LABEL = { resolved: "Resolved", transferred: "Transferred", abandoned: "Abandoned" } as const;
export const SOURCE_LABEL = { sim: "Simulation", synthetic_prod: "Synthetic production", manual: "Live (manual)" } as const;

export const REASON_LABEL: Record<string, string> = {
  unverified: "Caller not verified",
  caller_requested: "Caller asked for a person",
  tool_failure: "Tool failure",
  step_up_failed: "Identity check failed",
  knowledge_gap: "No article for the question",
  unsupported_request: "Request the agent cannot handle",
  agent_error: "Agent error",
  delinquent: "Past-due account",
};
export const reasonLabel = (r: string | null) => (r === null ? "—" : (REASON_LABEL[r] ?? r.replaceAll("_", " ")));

export function prettyJson(v: unknown): string {
  return v === null || v === undefined ? "—" : JSON.stringify(v, null, 2);
}
