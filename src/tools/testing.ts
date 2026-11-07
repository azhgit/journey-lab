// CLAUDE-OWNED (M3). Test harness: the real mock backend, in-process, behind a fetch-compatible function.
import { createApp } from "../mock-api/app.js";
import type { ScenarioFlag } from "../mock-api/types.js";
import { INITIAL } from "../journey/stepup.js";
import type { E164, Session } from "./context.js";

const API_KEY = "test-key";

export type TestBackend = ReturnType<typeof createTestBackend>;

export function createTestBackend(opts: { hangMs?: number } = {}) {
  const { app, store } = createApp({ apiKey: API_KEY, testRoutes: true, hangMs: opts.hangMs ?? 200 });
  let fetchCount = 0;

  // Behaves like real fetch: rejects with the signal's reason when aborted, even if the handler is still running.
  const fetchImpl: typeof fetch = (input, init) => {
    fetchCount += 1;
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      Promise.resolve(app.fetch(new Request(input, init))).then(resolve, reject);
    });
  };

  let clock = Date.parse("2026-10-27T15:00:00Z");

  function session(overrides: Partial<Omit<Session, "api">> & { timeoutMs?: number } = {}): Session {
    const { timeoutMs, ...rest } = overrides;
    return {
      id: `s-${Math.random().toString(36).slice(2)}`,
      verifiedPhone: null,
      stepUpVerifiedLoanId: null,
      stepUp: INITIAL,
      quotes: new Map(),
      now: () => clock,
      api: { baseUrl: "http://mock.test", apiKey: API_KEY, fetchImpl, sleep: async () => {}, timeoutMs: timeoutMs ?? 2_000 },
      ...rest,
    };
  }

  return {
    store,
    session,
    get fetchCount() {
      return fetchCount;
    },
    advanceClock(ms: number) {
      clock += ms;
    },
    async setFlags(s: Session, flags: ScenarioFlag[]) {
      const res = await app.request(`/__test/scenarios/${s.id}`, {
        method: "PUT",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      if (res.status !== 200) throw new Error(`setFlags failed: ${res.status}`);
    },
  };
}

// Seed phones (fictional). Cast is fine here: these literals are known-valid E.164 test fixtures.
export const MAYA = "+14155550101" as E164; // L1001, accounts A1 (4821) and A2 (0937)
export const JORDAN = "+14155550102" as E164; // L1002 past_due, account A3
export const SAM = "+14155550103" as E164; // L1003 paid_off, L1004 current with autopay on A4
