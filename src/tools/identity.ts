// HUMAN-OWNED (M4 tools), written by Claude at Andrew's request. Tests: src/tools/identity.test.ts. SPEC §5, §8.2, §8.4.
// Step-up (Tier 2): a one-time code texted to the phone on file for a loan. The limits come from
// step() in src/journey/stepup.ts: ask the state machine first, then call the backend.
import { z } from "zod";
import { MAX_WRONG, step } from "../journey/stepup.js";
import { request } from "../lib/http.js";
import { err, ok } from "../lib/result.js";
import { apiOptions, apiUrl, type Session, type StepUpCheck, type ToolResult } from "./context.js";

// Same words whether or not the loan exists: the caller learns nothing about our records.
const CODE_SENT = "If that matches our records, you'll get a text with a code at the phone number on file.";

export async function sendStepUpCode(session: Session, input: { loanId: string }): Promise<ToolResult<null>> {
  const next = step(session.stepUp, { type: "send_requested", loanId: input.loanId });
  if (next.tag === "transfer") {
    session.stepUp = next;
    return err({ kind: "step_up_transfer", reason: next.reason });
  }

  // POSTed once: no `idempotent`, because a retry could text the customer twice.
  const res = await request({
    ...apiOptions(session),
    url: apiUrl(session, "/v1/step-up/send"),
    method: "POST",
    body: { loanId: input.loanId },
    schema: z.unknown(), // 202, no body
  });

  if (!res.ok) {
    // Any send failure fails closed: the state machine turns it into transfer(sms_unavailable).
    const failed = step(next, { type: "send_failed" });
    session.stepUp = failed;
    return failed.tag === "transfer" ? err({ kind: "step_up_transfer", reason: failed.reason }) : res;
  }

  session.stepUp = next;
  return ok({ data: null, spoken: CODE_SENT });
}

// Speech-to-text often hears "123 456" or "123-456".
function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

const CheckResponse = z.object({ passed: z.boolean() });

export async function checkStepUpCode(session: Session, input: { code: string }): Promise<ToolResult<StepUpCheck>> {
  // State gate, zero fetches.
  const state = session.stepUp;
  if (state.tag === "unverified") return err({ kind: "step_up_not_sent" });
  if (state.tag === "transfer") return err({ kind: "step_up_transfer", reason: state.reason });
  if (state.tag === "verified") {
    return ok({ data: { passed: true, attemptsLeft: MAX_WRONG }, spoken: "You're already verified." });
  }

  // A malformed code cannot be right, so it counts as wrong without asking the backend.
  let passed = false;
  const code = normalizeCode(input.code);
  if (code !== null) {
    // The loan comes from the state (the one the code was sent for), never from the caller.
    // POSTed once: each check counts against the backend's own limit too.
    const res = await request({
      ...apiOptions(session),
      url: apiUrl(session, "/v1/step-up/check"),
      method: "POST",
      body: { loanId: state.loanId, code },
      schema: CheckResponse,
    });
    // Doubt is not a pass: leave the state as it was and let the runner decide.
    if (!res.ok) return res;
    passed = res.data.passed;
  }

  const next = step(state, { type: "code_checked", passed });
  session.stepUp = next;

  switch (next.tag) {
    case "verified":
      session.stepUpVerifiedLoanId = next.loanId;
      return ok({ data: { passed: true, attemptsLeft: MAX_WRONG - state.wrong }, spoken: "Thanks, you're verified." });
    case "code_sent": {
      const attemptsLeft = MAX_WRONG - next.wrong;
      const tries = attemptsLeft === 1 ? "one more try" : `${attemptsLeft} more tries`;
      return ok({ data: { passed: false, attemptsLeft }, spoken: `That code didn't match. You have ${tries}.` });
    }
    case "transfer":
      return err({ kind: "step_up_transfer", reason: next.reason });
    case "unverified":
      // step() never goes from code_sent back to unverified; if it ever did, fail closed.
      return err({ kind: "step_up_not_sent" });
  }
}
