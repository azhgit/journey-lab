// HUMAN-OWNED (M3). Tests: src/tools/brand.test.ts
import type { E164, QuoteId } from "./context.js";

// TODO(M3): return the branded value if `raw` is valid E.164 ("+" then 2–15 digits, first digit 1–9), else null.
// This is the only place a string becomes an E164 (outside test fixtures).
export function parseE164(raw: string): E164 | null {
  if (/^\+[1-9]\d{1,14}$/.test(raw)) return raw as E164;
  return null;  
}

// TODO(M3): a fresh, unguessable quote id (hint: node:crypto), branded as QuoteId.
export function newQuoteId(): QuoteId {
  return crypto.randomUUID() as QuoteId;
}
