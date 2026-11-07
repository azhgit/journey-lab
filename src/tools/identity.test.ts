import { beforeEach, describe, expect, it } from "vitest";
import { MAX_WRONG } from "../journey/stepup.js";
import type { Session } from "./context.js";
import { checkStepUpCode, sendStepUpCode } from "./identity.js";
import { getLoanDetails } from "./loans.js";
import { createTestBackend, MAYA, SAM, type TestBackend } from "./testing.js";

let backend: TestBackend;
let s: Session;
beforeEach(() => {
  backend = createTestBackend();
  s = backend.session(); // Tier 0: no verified phone, which is exactly when step-up is used
});

const codeFor = (phone: string): string => {
  const code = backend.store.lastCodeByPhone.get(phone);
  if (code === undefined) throw new Error(`no code was sent to ${phone}`);
  return code;
};
// A 6-digit code guaranteed to differ from the real one.
const wrongCode = (phone: string): string => (codeFor(phone) === "000000" ? "111111" : "000000");

describe("sendStepUpCode", () => {
  it("texts a code to the phone on file, with no identity needed", async () => {
    const res = await sendStepUpCode(s, { loanId: "L1001" });

    expect(res.ok).toBe(true);
    expect(s.stepUp).toEqual({ tag: "code_sent", loanId: "L1001", sends: 1, wrong: 0 });
    expect(codeFor(MAYA)).toMatch(/^\d{6}$/);
  });

  it("an unknown loan gets the exact same answer (no enumeration), and no code is sent", async () => {
    const known = await sendStepUpCode(s, { loanId: "L1001" });
    const unknown = await sendStepUpCode(backend.session(), { loanId: "L9999" });

    expect(unknown).toEqual(known);
    expect(backend.store.stepUp.has("L9999")).toBe(false);
  });

  it("never reads the phone number back", async () => {
    const res = await sendStepUpCode(s, { loanId: "L1001" });
    expect(JSON.stringify(res)).not.toMatch(/0101|5550|415/);
  });

  it("third send → step_up_transfer, without calling the backend", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });
    await sendStepUpCode(s, { loanId: "L1001" });
    const before = backend.fetchCount;

    const res = await sendStepUpCode(s, { loanId: "L1001" });

    expect(res).toEqual({ ok: false, error: { kind: "step_up_transfer", reason: "too_many_sends" } });
    expect(backend.fetchCount).toBe(before);
    expect(s.stepUp).toEqual({ tag: "transfer", reason: "too_many_sends" });
  });

  it("SMS provider down → step_up_transfer(sms_unavailable)", async () => {
    await backend.setFlags(s, ["sms_unavailable"]);

    const res = await sendStepUpCode(s, { loanId: "L1001" });

    expect(res).toEqual({ ok: false, error: { kind: "step_up_transfer", reason: "sms_unavailable" } });
    expect(s.stepUp).toEqual({ tag: "transfer", reason: "sms_unavailable" });
  });

  it("is sent once, never retried (a retry could text the customer twice)", async () => {
    await backend.setFlags(s, ["flaky_503_then_ok"]);

    const res = await sendStepUpCode(s, { loanId: "L1001" });

    expect(res.ok).toBe(false);
    expect(backend.fetchCount).toBe(1);
  });
});

describe("checkStepUpCode", () => {
  it("right code → verified for that loan, which then unlocks Tier 2 reads", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });

    const res = await checkStepUpCode(s, { code: codeFor(MAYA) });

    expect(res.ok && res.data.data).toEqual({ passed: true, attemptsLeft: MAX_WRONG });
    expect(s.stepUp).toEqual({ tag: "verified", loanId: "L1001" });
    expect(s.stepUpVerifiedLoanId).toBe("L1001");
    expect((await getLoanDetails(s, { loanId: "L1001" })).ok).toBe(true);
  });

  it("accepts a code spoken with spaces or dashes", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });
    const code = codeFor(MAYA);

    const res = await checkStepUpCode(s, { code: `${code.slice(0, 3)} ${code.slice(3)}` });

    expect(res.ok && res.data.data.passed).toBe(true);
  });

  it("wrong code → not verified, one attempt left", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });

    const res = await checkStepUpCode(s, { code: wrongCode(MAYA) });

    expect(res.ok && res.data.data).toEqual({ passed: false, attemptsLeft: 1 });
    expect(s.stepUpVerifiedLoanId).toBeNull();
  });

  it("two wrong codes → step_up_transfer, and the right code afterwards changes nothing", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });
    await checkStepUpCode(s, { code: wrongCode(MAYA) });

    const second = await checkStepUpCode(s, { code: wrongCode(MAYA) });
    expect(second).toEqual({ ok: false, error: { kind: "step_up_transfer", reason: "too_many_wrong" } });

    const before = backend.fetchCount;
    const late = await checkStepUpCode(s, { code: codeFor(MAYA) });
    expect(late).toEqual({ ok: false, error: { kind: "step_up_transfer", reason: "too_many_wrong" } });
    expect(backend.fetchCount).toBe(before);
    expect(s.stepUpVerifiedLoanId).toBeNull();
  });

  it("malformed code counts as wrong without calling the backend", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });
    const before = backend.fetchCount;

    const res = await checkStepUpCode(s, { code: "12345" });

    expect(res.ok && res.data.data).toEqual({ passed: false, attemptsLeft: 1 });
    expect(backend.fetchCount).toBe(before);
  });

  it("check before any send → step_up_not_sent, zero fetches", async () => {
    const res = await checkStepUpCode(s, { code: "123456" });
    expect(res).toEqual({ ok: false, error: { kind: "step_up_not_sent" } });
    expect(backend.fetchCount).toBe(0);
  });

  it("unknown loan: any code simply fails", async () => {
    await sendStepUpCode(s, { loanId: "L9999" });
    const res = await checkStepUpCode(s, { code: "123456" });
    expect(res.ok && res.data.data.passed).toBe(false);
  });

  it("verifies the loan the code was sent for, not a different one", async () => {
    await sendStepUpCode(s, { loanId: "L1001" });
    await sendStepUpCode(s, { loanId: "L1004" }); // resend for Sam's loan: the code goes to Sam's phone

    await checkStepUpCode(s, { code: codeFor(SAM) });

    expect(s.stepUpVerifiedLoanId).toBe("L1004");
  });

  it("backend timeout → error returned, state unchanged, never verified", async () => {
    const slow = backend.session({ timeoutMs: 50 });
    await sendStepUpCode(slow, { loanId: "L1001" });
    await backend.setFlags(slow, ["slow_tool"]);

    const res = await checkStepUpCode(slow, { code: codeFor(MAYA) });

    expect(res).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(slow.stepUp).toEqual({ tag: "code_sent", loanId: "L1001", sends: 1, wrong: 0 });
    expect(slow.stepUpVerifiedLoanId).toBeNull();
  });
});
