import * as seed from "./seed.js";
import type { Customer, LinkedAccount, Loan, Payment, ScenarioFlag } from "./types.js";

type IdempotencyRecord = { fingerprint: string; status: 201 | 402; body: unknown };
type StepUpRecord = { code: string; phone: string; expiresAt: number; checks: number; used: boolean };
type SessionState = { flags: Set<ScenarioFlag>; hits: Set<string> };

export const STEP_UP_TTL_MS = 5 * 60_000;
// Backend defense in depth only; the journey's own limits (2 sends, 2 wrong) live in stepup.ts.
export const STEP_UP_MAX_CHECKS = 5;

export type Store = {
  customers: Map<string, Customer>;
  loans: Map<string, Loan>;
  accounts: Map<string, LinkedAccount>;
  payments: Payment[];
  idempotency: Map<string, IdempotencyRecord>;
  stepUp: Map<string, StepUpRecord>; // keyed by loanId
  lastCodeByPhone: Map<string, string>; // test-only read path
  sessions: Map<string, SessionState>;
};

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, structuredClone(r)]));

export function createStore(): Store {
  return {
    customers: byId(seed.customers),
    loans: byId(seed.loans),
    accounts: byId(seed.linkedAccounts),
    payments: [],
    idempotency: new Map(),
    stepUp: new Map(),
    lastCodeByPhone: new Map(),
    sessions: new Map(),
  };
}

export function session(store: Store, sessionId: string): SessionState {
  let s = store.sessions.get(sessionId);
  if (!s) {
    s = { flags: new Set(), hits: new Set() };
    store.sessions.set(sessionId, s);
  }
  return s;
}

// True only the first time `key` is seen in this session. Drives the "fail once, then ok" flags.
export function firstHit(s: SessionState, key: string): boolean {
  if (s.hits.has(key)) return false;
  s.hits.add(key);
  return true;
}
