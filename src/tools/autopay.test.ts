import { beforeEach, describe, expect, it } from "vitest";
import { updateAutopay } from "./autopay.js";
import type { AutopayChange } from "./context.js";
import { createTestBackend, MAYA, type TestBackend } from "./testing.js";

let backend: TestBackend;
beforeEach(() => {
  backend = createTestBackend();
});

const steppedUp = (loanId: string) => backend.session({ stepUpVerifiedLoanId: loanId });

describe("updateAutopay", () => {
  it("a verified phone alone is not enough → step_up_required, zero fetches", async () => {
    const res = await updateAutopay(backend.session({ verifiedPhone: MAYA }), {
      loanId: "L1001",
      enabled: true,
      linkedAccountId: "A2",
    });

    expect(res).toEqual({ ok: false, error: { kind: "step_up_required" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("step-up for one loan does not unlock another", async () => {
    const res = await updateAutopay(steppedUp("L1001"), { loanId: "L1004", enabled: false });
    expect(res).toEqual({ ok: false, error: { kind: "step_up_required" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("enables autopay on a linked account, spoken digit by digit", async () => {
    const res = await updateAutopay(steppedUp("L1001"), { loanId: "L1001", enabled: true, linkedAccountId: "A2" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toEqual({ enabled: true, linkedAccount: { bankName: "Cedar Credit Union", last4: "0937" } });
    expect(res.data.spoken).toContain("Cedar Credit Union ending in zero nine three seven");
    expect(backend.store.loans.get("L1001")?.autopay).toEqual({ enabled: true, linkedAccountId: "A2" });
  });

  it("disables autopay", async () => {
    const res = await updateAutopay(steppedUp("L1004"), { loanId: "L1004", enabled: false });

    expect(res.ok && res.data.data).toEqual({ enabled: false, linkedAccount: null });
    expect(res.ok && res.data.spoken).toMatch(/off/);
    expect(backend.store.loans.get("L1004")?.autopay.enabled).toBe(false);
  });

  it("account not on this loan → unknown_account, nothing changed", async () => {
    const res = await updateAutopay(steppedUp("L1001"), { loanId: "L1001", enabled: true, linkedAccountId: "A3" });

    expect(res).toEqual({ ok: false, error: { kind: "unknown_account" } });
    expect(backend.store.loans.get("L1001")?.autopay.enabled).toBe(false);
  });

  it("enabling requires an account; disabling forbids one (compile-time check)", () => {
    // @ts-expect-error enabled: true without linkedAccountId
    const missing: AutopayChange = { loanId: "L1001", enabled: true };
    // @ts-expect-error enabled: false with an account
    const extra: AutopayChange = { loanId: "L1001", enabled: false, linkedAccountId: "A1" };
    void missing;
    void extra;
  });
});
