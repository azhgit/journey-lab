// CLAUDE-OWNED (M7). Q13: a journey version is a manual semver plus a hash computed by code over everything
// that shapes the agent's behavior: the journey data, the composed prompt (shared rules and channel format, which
// live in code), and the tool definitions. The gate fails when the hash changes but the version does not.
import { createHash } from "node:crypto";
import { composeSystemPrompt, identityLine } from "./prompt.js";
import type { Journey } from "./schema.js";
import { anthropicTools, createToolDefs } from "./tools.js";

// Keys sorted at every level, so the same data always gives the same string.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function journeyHash(journey: Journey): string {
  // Fixed placeholders: the date and the caller's identity change per call, not per version.
  const prompts = journey.channels.flatMap((c) =>
    [true, false].map((verified) => composeSystemPrompt(journey, c, "<today>", identityLine(verified))),
  );
  const tools = anthropicTools(journey, createToolDefs([]));
  const hash = createHash("sha256").update(canonical({ journey, prompts, tools }));
  return hash.digest("hex").slice(0, 16);
}

export type VersionCheck = { ok: true; known: boolean } | { ok: false; message: string };

// `recorded` is the hash stored the first time this id@version was seen, or null if never seen.
export function checkVersion(journey: Journey, hash: string, recorded: string | null): VersionCheck {
  if (recorded === null) return { ok: true, known: false };
  if (recorded === hash) return { ok: true, known: true };
  return {
    ok: false,
    message: `${journey.id}@${journey.version} changed (hash ${recorded} → ${hash}) without a version bump`,
  };
}
