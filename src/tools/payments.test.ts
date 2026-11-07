import { beforeEach, describe, expect, it } from "vitest";
import { QUOTE_TTL_MS, type QuoteId, type Session } from "./context.js";
import { makePayment, preparePayment } from "./payments.js";
import { createTestBackend, JORDAN, MAYA, SAM, type TestBackend } from "./testing.js";

let backend: TestBackend;
let maya: Session;
beforeEach(() => {
  backend = createTestBackend();
  maya = backend.session({ verifiedPhone: MAYA });
});

const DUE = { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" };

async function quote(s: Session = maya, input = DUE): Promise<QuoteId> {
  const res = await preparePayment(s, input);
  if (!res.ok) throw new Error(`preparePayment failed: ${JSON.stringify(res.error)}`);
  return res.data.data.quoteId;
}

describe("preparePayment", () => {
  it("stores a quote and returns the read-back, without paying", async () => {
    const res = await preparePayment(maya, DUE);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const q = res.data.data;
    expect(q).toMatchObject({ loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" });
    expect(q.expiresAt).toBe(maya.now() + QUOTE_TTL_MS);
    expect(maya.quotes.get(q.quoteId)).toMatchObject({ amountCents: 21_450, used: false });
    expect(res.data.spoken).toContain("two hundred fourteen dollars and fifty cents");
    expect(res.data.spoken).toContain("First Harbor Bank ending in four eight two one");
    expect(backend.store.payments).toHaveLength(0);
  });

  it("paying more than due, up to payoff, is allowed", async () => {
    expect((await preparePayment(maya, { ...DUE, amountCents: 845_300 })).ok).toBe(true);
  });

  it.each([
    ["below amount due", 100],
    ["above payoff", 845_301],
    ["not whole cents (dollars passed by mistake)", 214.5],
  ])("%s → invalid_amount with the allowed range spoken, no quote", async (_label, amountCents) => {
    const res = await preparePayment(maya, { ...DUE, amountCents });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: "invalid_amount", minCents: 21_450, maxCents: 845_300 });
    expect(res.error.kind === "invalid_amount" && res.error.spoken).toContain("two hundred fourteen dollars and fifty cents");
    expect(maya.quotes.size).toBe(0);
  });

  it("account that is not on this loan → unknown_account", async () => {
    const res = await preparePayment(maya, { ...DUE, linkedAccountId: "A3" });
    expect(res).toEqual({ ok: false, error: { kind: "unknown_account" } });
    expect(maya.quotes.size).toBe(0);
  });

  it("someone else's loan → not_owner", async () => {
    const res = await preparePayment(maya, { ...DUE, loanId: "L1004", linkedAccountId: "A4" });
    expect(res).toEqual({ ok: false, error: { kind: "not_owner" } });
  });

  it("no identity → unverified with zero fetches", async () => {
    const res = await preparePayment(backend.session(), DUE);
    expect(res).toEqual({ ok: false, error: { kind: "unverified" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("paid-off loan → nothing_due", async () => {
    const sam = backend.session({ verifiedPhone: SAM });
    const res = await preparePayment(sam, { loanId: "L1003", amountCents: 100, linkedAccountId: "A4" });
    expect(res).toEqual({ ok: false, error: { kind: "nothing_due" } });
  });
});

describe("makePayment", () => {
  it("pays the quoted amount once, keyed by the quote", async () => {
    const quoteId = await quote();

    const res = await makePayment(maya, { quoteId });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toMatchObject({ amountCents: 21_450, status: "succeeded" });
    expect(res.data.spoken).toContain("two hundred fourteen dollars and fifty cents");
    expect(backend.store.payments).toHaveLength(1);
    expect(backend.store.payments[0]?.idempotencyKey).toContain(quoteId);
  });

  it("reads the loan back after paying: a past-due loan paid up is said as current, not the stale status", async () => {
    const jordan = backend.session({ verifiedPhone: JORDAN });
    const quoteId = await quote(jordan, { loanId: "L1002", amountCents: 43_900, linkedAccountId: "A3" });

    const res = await makePayment(jordan, { quoteId });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data.loanStatusAfter).toBe("current");
    expect(res.data.spoken).toBe(
      "Your payment of four hundred thirty-nine dollars went through. Your loan is now current. " +
        "Your next payment of two hundred nineteen dollars and fifty cents is due Sunday, November 1.",
    );
  });

  it("a failed read-back never turns a succeeded payment into an error", async () => {
    const quoteId = await quote();
    const { fetchImpl } = maya.api;
    if (fetchImpl === undefined) throw new Error("test backend always sets fetchImpl");
    maya.api = {
      ...maya.api,
      fetchImpl: (input, init) =>
        String(input).endsWith("/graphql") ? Promise.reject(new TypeError("network down")) : fetchImpl(input, init),
    };

    const res = await makePayment(maya, { quoteId });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toMatchObject({ status: "succeeded", loanStatusAfter: null });
    expect(res.data.spoken).toBe("Your payment of two hundred fourteen dollars and fifty cents went through. I can't see the loan's updated status right now.");
    expect(backend.store.payments).toHaveLength(1);
  });

  it("a quote cannot be paid twice", async () => {
    const quoteId = await quote();
    await makePayment(maya, { quoteId });

    const again = await makePayment(maya, { quoteId });

    expect(again).toEqual({ ok: false, error: { kind: "quote_invalid", reason: "used" } });
    expect(backend.store.payments).toHaveLength(1);
  });

  it("unknown quote id (e.g. invented by the model) → unknown, zero fetches", async () => {
    const res = await makePayment(maya, { quoteId: "made-up" as QuoteId });
    expect(res).toEqual({ ok: false, error: { kind: "quote_invalid", reason: "unknown" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("a quote from another session is unknown here", async () => {
    const quoteId = await quote();
    const other = backend.session({ verifiedPhone: MAYA });
    expect(await makePayment(other, { quoteId })).toEqual({ ok: false, error: { kind: "quote_invalid", reason: "unknown" } });
  });

  it("expired quote → expired, nothing charged", async () => {
    const quoteId = await quote();
    backend.advanceClock(QUOTE_TTL_MS);

    const res = await makePayment(maya, { quoteId });

    expect(res).toEqual({ ok: false, error: { kind: "quote_invalid", reason: "expired" } });
    expect(backend.store.payments).toHaveLength(0);
  });

  it.each(["payment_declined", "insufficient_funds"] as const)("%s → payment_failed, and the quote is spent", async (code) => {
    const quoteId = await quote();
    await backend.setFlags(maya, [code]);

    const res = await makePayment(maya, { quoteId });

    expect(res).toMatchObject({ ok: false, error: { kind: "payment_failed", code } });
    // The spoken fact is only true because the backend credited nothing.
    expect(!res.ok && "spoken" in res.error && res.error.spoken).toMatch(/declined.*did not collect it\.$/);
    expect(backend.store.loans.get("L1001")?.nextPayment?.amountDueCents).toBe(21_450);
    expect(await makePayment(maya, { quoteId })).toEqual({ ok: false, error: { kind: "quote_invalid", reason: "used" } });
  });

  it("declined once, then a new quote on the other account succeeds", async () => {
    await backend.setFlags(maya, ["payment_declined_once"]);
    const first = await makePayment(maya, { quoteId: await quote() });
    expect(first.ok).toBe(false);

    const second = await makePayment(maya, { quoteId: await quote(maya, { ...DUE, linkedAccountId: "A2" }) });
    expect(second.ok).toBe(true);
  });

  it("response lost after the charge (timeout) → retry replays it: exactly one payment", async () => {
    const s = backend.session({ verifiedPhone: MAYA, timeoutMs: 50 });
    const quoteId = await quote(s);
    await backend.setFlags(s, ["timeout"]);

    const res = await makePayment(s, { quoteId });

    expect(res.ok).toBe(true);
    expect(backend.store.payments).toHaveLength(1);
  });

  it("503 before the charge → retried with the same key: exactly one payment", async () => {
    const quoteId = await quote();
    await backend.setFlags(maya, ["flaky_503_then_ok"]);

    expect((await makePayment(maya, { quoteId })).ok).toBe(true);
    expect(backend.store.payments).toHaveLength(1);
  });
});
