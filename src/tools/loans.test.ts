import { beforeEach, describe, expect, it } from "vitest";
import { getLoanDetails, listLinkedAccounts } from "./loans.js";
import { createTestBackend, JORDAN, MAYA, SAM, type TestBackend } from "./testing.js";

let backend: TestBackend;
beforeEach(() => {
  backend = createTestBackend();
});

describe("getLoanDetails", () => {
  it("Tier 1 owner gets details plus code-built speech", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: MAYA }), { loanId: "L1001" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toEqual({
      id: "L1001",
      status: "current",
      principalBalanceCents: 842_000,
      payoffAmountCents: 845_300,
      nextPayment: { amountDueCents: 21_450, dueDate: "2026-11-14" },
      nextPaymentUnavailable: false,
      autopay: { enabled: false, linkedAccount: null },
    });
    expect(res.data.spoken).toContain("two hundred fourteen dollars and fifty cents");
    expect(res.data.spoken).toContain("Saturday, November 14");
  });

  it("past due: the amount due is said as what is owed now, the catch-up amount, not as a 'next payment'", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: JORDAN }), { loanId: "L1002" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.spoken).toBe(
      "Your loan is past due. The amount due now is four hundred thirty-nine dollars. It was due Thursday, October 1. " +
        "Paying that amount brings the loan current.",
    );
  });

  it("never hands the customer's phone to the model", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: MAYA }), { loanId: "L1001" });
    expect(JSON.stringify(res)).not.toContain("+1415555");
  });

  it("maps GraphQL enum values to lowercase status", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: JORDAN }), { loanId: "L1002" });
    expect(res.ok && res.data.data.status).toBe("past_due");
  });

  it("someone else's loan → not_owner", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: MAYA }), { loanId: "L1004" });
    expect(res).toEqual({ ok: false, error: { kind: "not_owner" } });
  });

  it("unknown loan (partial data + NOT_FOUND) → not_found", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: MAYA }), { loanId: "L9999" });
    expect(res).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("no identity → unverified, and the backend is never called (no enumeration)", async () => {
    const res = await getLoanDetails(backend.session(), { loanId: "L1001" });
    expect(res).toEqual({ ok: false, error: { kind: "unverified" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("Tier 2 step-up for this loan is enough without a verified phone", async () => {
    const res = await getLoanDetails(backend.session({ stepUpVerifiedLoanId: "L1001" }), { loanId: "L1001" });
    expect(res.ok).toBe(true);
  });

  it("Tier 2 step-up for one loan does not unlock another", async () => {
    const res = await getLoanDetails(backend.session({ stepUpVerifiedLoanId: "L1001" }), { loanId: "L1004" });
    expect(res).toEqual({ ok: false, error: { kind: "unverified" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("partial error on nextPayment → flagged unavailable, and speech states no amount or date", async () => {
    const s = backend.session({ verifiedPhone: MAYA });
    await backend.setFlags(s, ["graphql_partial_error"]);

    const res = await getLoanDetails(s, { loanId: "L1001" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data.nextPayment).toBeNull();
    expect(res.data.data.nextPaymentUnavailable).toBe(true);
    expect(res.data.spoken).not.toMatch(/dollars|cents|November/);
  });

  it("paid-off loan: no next payment, and that is not an outage", async () => {
    const res = await getLoanDetails(backend.session({ verifiedPhone: SAM }), { loanId: "L1003" });
    expect(res.ok && res.data.data).toMatchObject({ status: "paid_off", nextPayment: null, nextPaymentUnavailable: false });
  });

  it("transient 503 is absorbed by the client's retry", async () => {
    const s = backend.session({ verifiedPhone: MAYA });
    await backend.setFlags(s, ["flaky_503_then_ok"]);
    expect((await getLoanDetails(s, { loanId: "L1001" })).ok).toBe(true);
  });
});

describe("listLinkedAccounts", () => {
  it("owner gets last4-only accounts, spoken digit by digit", async () => {
    const res = await listLinkedAccounts(backend.session({ verifiedPhone: MAYA }), { loanId: "L1001" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toEqual([
      { id: "A1", bankName: "First Harbor Bank", last4: "4821" },
      { id: "A2", bankName: "Cedar Credit Union", last4: "0937" },
    ]);
    expect(res.data.spoken).toContain("First Harbor Bank ending in four eight two one");
    expect(res.data.spoken).toContain("Cedar Credit Union ending in zero nine three seven");
  });

  it("someone else's loan → not_owner", async () => {
    const res = await listLinkedAccounts(backend.session({ verifiedPhone: MAYA }), { loanId: "L1004" });
    expect(res).toEqual({ ok: false, error: { kind: "not_owner" } });
  });

  it("no identity → unverified with zero fetches", async () => {
    const res = await listLinkedAccounts(backend.session(), { loanId: "L1001" });
    expect(res).toEqual({ ok: false, error: { kind: "unverified" } });
    expect(backend.fetchCount).toBe(0);
  });
});
