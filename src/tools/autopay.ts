// HUMAN-OWNED (M4 tools), written by Claude at Andrew's request. Tests: src/tools/autopay.test.ts. SPEC §5, §8.2.
import { z } from "zod";
import { request } from "../lib/http.js";
import { err, ok } from "../lib/result.js";
import { apiOptions, apiUrl, type AutopayChange, type AutopaySettings, type Session, type ToolResult } from "./context.js";
import { describeAccount, fetchLinkedAccounts } from "./loans.js";

const AutopayResponse = z.object({ enabled: z.boolean() });

export async function updateAutopay(session: Session, input: AutopayChange): Promise<ToolResult<AutopaySettings>> {
  // Tier 2 for this exact loan. A verified phone is not enough: this changes where money is pulled from.
  if (session.stepUpVerifiedLoanId !== input.loanId) return err({ kind: "step_up_required" });

  let linkedAccount: AutopaySettings["linkedAccount"] = null;
  if (input.enabled) {
    // `input.enabled` narrowed the union, so linkedAccountId is a string here.
    const accounts = await fetchLinkedAccounts(session, input.loanId);
    if (!accounts.ok) return accounts;
    const account = accounts.data.find((a) => a.id === input.linkedAccountId);
    if (account === undefined) return err({ kind: "unknown_account" });
    linkedAccount = { bankName: account.bankName, last4: account.last4 };
  }

  // PATCH sets a value, so repeating it is harmless: safe to retry.
  const res = await request({
    ...apiOptions(session),
    url: apiUrl(session, `/v1/loans/${encodeURIComponent(input.loanId)}/autopay`),
    method: "PATCH",
    idempotent: true,
    body: { enabled: input.enabled, linkedAccountId: input.enabled ? input.linkedAccountId : null },
    schema: AutopayResponse,
  });
  if (!res.ok) return res;

  const spoken = linkedAccount ? `Autopay is now on, from ${describeAccount(linkedAccount)}.` : "Autopay is now off.";
  return ok({ data: { enabled: res.data.enabled, linkedAccount }, spoken });
}
