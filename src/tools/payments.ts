// HUMAN-OWNED (M3), written by Claude at Andrew's request. Tests: src/tools/payments.test.ts. SPEC §4, §8.2.
import { z } from "zod";
import { request } from "../lib/http.js";
import { err, ok } from "../lib/result.js";
import { newQuoteId } from "./brand.js";
import {
  apiOptions,
  apiUrl,
  QUOTE_TTL_MS,
  type LoanStatus,
  type PaymentQuote,
  type PaymentReceipt,
  type PreparedPayment,
  type QuoteId,
  type Session,
  type ToolResult,
} from "./context.js";
import { checkOwnership, describeAccount, fetchLinkedAccounts, getLoanDetails, paymentSpeech } from "./loans.js";
import { spokenAmount } from "./spoken.js";

// ---- preparePayment: validate and quote, but do NOT pay ----

const PaymentOptions = z.object({ minCents: z.number().int(), maxCents: z.number().int() });

export async function preparePayment(
  session: Session,
  input: { loanId: string; amountCents: number; linkedAccountId: string },
): Promise<ToolResult<PreparedPayment>> {
  const owned = await checkOwnership(session, input.loanId);
  if (!owned.ok) return owned;

  // The backend decides which amounts are payable; the agent never invents a range.
  const options = await request({
    ...apiOptions(session),
    url: apiUrl(session, `/v1/loans/${encodeURIComponent(input.loanId)}/payment-options`),
    schema: PaymentOptions,
  });
  if (!options.ok) {
    if (options.error.kind === "http" && options.error.status === 409) return err({ kind: "nothing_due" });
    return options;
  }

  // Integer check catches dollars passed as cents (214.5), which the backend range alone would miss.
  const { minCents, maxCents } = options.data;
  const amount = input.amountCents;
  if (!Number.isInteger(amount) || amount < minCents || amount > maxCents) {
    const spoken = `I can take a payment between ${spokenAmount(minCents)} and ${spokenAmount(maxCents)}.`;
    return err({ kind: "invalid_amount", minCents, maxCents, spoken });
  }

  const accounts = await fetchLinkedAccounts(session, input.loanId);
  if (!accounts.ok) return accounts;
  const account = accounts.data.find((a) => a.id === input.linkedAccountId);
  if (account === undefined) return err({ kind: "unknown_account" });

  const quote: PaymentQuote = {
    id: newQuoteId(),
    loanId: input.loanId,
    linkedAccountId: account.id,
    amountCents: amount,
    expiresAt: session.now() + QUOTE_TTL_MS,
    used: false,
  };
  session.quotes.set(quote.id, quote);

  return ok({
    data: {
      quoteId: quote.id,
      loanId: quote.loanId,
      linkedAccountId: quote.linkedAccountId,
      amountCents: quote.amountCents,
      expiresAt: quote.expiresAt,
    },
    // The runner reads this back and waits for an explicit yes before calling makePayment.
    spoken: `That's a payment of ${spokenAmount(amount)} from ${describeAccount(account)}. Shall I go ahead?`,
  });
}

// ---- makePayment: pay a quote; the model passes only its id, never an amount ----

const PaymentCreated = z.object({ id: z.string(), amountCents: z.number().int() });

const FAILURE_CODES = ["payment_declined", "insufficient_funds"] as const;
type FailureCode = (typeof FAILURE_CODES)[number];

function isFailureCode(code: string | undefined): code is FailureCode {
  return FAILURE_CODES.some((c) => c === code);
}

export async function makePayment(session: Session, input: { quoteId: QuoteId }): Promise<ToolResult<PaymentReceipt>> {
  // Local checks only: an invented, spent, or stale quote never reaches the payments API.
  const quote = session.quotes.get(input.quoteId);
  if (quote === undefined) return err({ kind: "quote_invalid", reason: "unknown" });
  if (quote.used) return err({ kind: "quote_invalid", reason: "used" });
  if (session.now() >= quote.expiresAt) return err({ kind: "quote_invalid", reason: "expired" });

  // Same quote → same key → same body, so every retry (inside request() or a later call) replays
  // the first charge instead of making a second one.
  const base = apiOptions(session);
  const res = await request({
    ...base,
    headers: { ...base.headers, "Idempotency-Key": `quote-${quote.id}` },
    url: apiUrl(session, "/v1/payments"),
    method: "POST",
    idempotent: true,
    body: { loanId: quote.loanId, amountCents: quote.amountCents, linkedAccountId: quote.linkedAccountId },
    schema: PaymentCreated,
  });

  if (!res.ok) {
    // 402 is a definitive "no": the quote is spent and the customer must choose again.
    if (res.error.kind === "http" && res.error.status === 402) {
      quote.used = true;
      if (isFailureCode(res.error.code)) {
        // A 402 means the backend recorded the payment as failed and credited nothing, so "not collected"
        // is a backend fact. The model would otherwise infer it ("no money was taken"), see judgment #43.
        const why = res.error.code === "insufficient_funds" ? " for insufficient funds" : "";
        const spoken = `That payment of ${spokenAmount(quote.amountCents)} was declined${why}, so Northwind did not collect it.`;
        return err({ kind: "payment_failed", code: res.error.code, spoken });
      }
    }
    // Timeout / network: the charge may or may not exist. Keep the quote unused so a retry reuses the key.
    return res;
  }

  quote.used = true;
  // The payment may have changed the loan (past due → current, or paid off). Read it back so the agent never
  // repeats the status it fetched before paying. A failed read must not turn a charged payment into an error.
  // The next payment is said too, so "is there anything else I owe?" has an answer without a transfer.
  const after = await getLoanDetails(session, { loanId: quote.loanId });
  const loanStatusAfter = after.ok ? after.data.data.status : null;
  const paid = `Your payment of ${spokenAmount(res.data.amountCents)} went through.`;
  const spoken = after.ok
    ? [paid, STATUS_AFTER_PAYMENT[after.data.data.status], paymentSpeech(after.data.data)].filter((t) => t !== "").join(" ")
    : `${paid} I can't see the loan's updated status right now.`;
  return ok({
    data: { paymentId: res.data.id, amountCents: res.data.amountCents, status: "succeeded", loanStatusAfter },
    spoken,
  });
}

const STATUS_AFTER_PAYMENT: Record<LoanStatus, string> = {
  current: "Your loan is now current.",
  past_due: "Your loan is still past due.",
  paid_off: "Your loan is now paid off.",
};
