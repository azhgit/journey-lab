// CLAUDE-OWNED (M3). The contract every tool shares. SPEC §8.2.
import type { State as StepUpState, TransferReason } from "../journey/stepup.js";
import type { Sleep, ToolError } from "../lib/http.js";
import type { Result } from "../lib/result.js";

// Branded strings: a plain string cannot be passed where these are expected. Constructors live in brand.ts.
export type E164 = string & { readonly __brand: "E164" };
export type QuoteId = string & { readonly __brand: "QuoteId" };

export type ApiConfig = {
  baseUrl: string; // e.g. "http://localhost:4010"
  apiKey: string;
  timeoutMs?: number; // per attempt, passed to request()
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
};

// Created by preparePayment, consumed once by makePayment. Lives in the session, never in the model's hands
// except as an opaque id.
export type PaymentQuote = {
  id: QuoteId;
  loanId: string;
  linkedAccountId: string;
  amountCents: number;
  expiresAt: number; // epoch ms
  used: boolean;
};

export const QUOTE_TTL_MS = 5 * 60_000;

export type Session = {
  id: string; // sent as x-session-id; drives failure injection in the mock backend
  verifiedPhone: E164 | null; // Tier 1: set by the harness from verified caller ID, never from caller words
  stepUpVerifiedLoanId: string | null; // Tier 2: set only by checkStepUpCode when stepUp reaches verified
  stepUp: StepUpState; // limits for this call; advanced only through step() in src/journey/stepup.ts
  quotes: Map<QuoteId, PaymentQuote>;
  now: () => number;
  api: ApiConfig;
};

// What a tool hands back to the runner. `spoken` is code-built text the model must read verbatim
// (amounts, dates, account digits), so the model never formats money itself.
export type ToolOk<T> = { data: T; spoken: string };

// Transport errors from request(), plus failures that only make sense at the tool level.
export type ToolFailure =
  | ToolError
  | { kind: "unverified" } // no identity in the session covers this loan; no backend call was made
  | { kind: "invalid_amount"; minCents: number; maxCents: number; spoken: string }
  | { kind: "unknown_account" } // linkedAccountId is not one of this loan's accounts
  | { kind: "nothing_due" } // loan is paid off
  | { kind: "quote_invalid"; reason: "unknown" | "expired" | "used" }
  | { kind: "payment_failed"; code: "payment_declined" | "insufficient_funds"; spoken: string } // nothing was collected
  | { kind: "step_up_required" } // the action needs Tier 2 for this loan; no backend call was made
  | { kind: "step_up_not_sent" } // checkStepUpCode before any code was sent; no backend call was made
  | { kind: "step_up_transfer"; reason: TransferReason }; // limit hit or SMS down: the runner must transfer

export type ToolResult<T> = Result<ToolOk<T>, ToolFailure>;

// ---- domain shapes returned to the runner (no customer phone: the model does not need it) ----

export type LoanStatus = "current" | "past_due" | "paid_off";

export type LoanDetails = {
  id: string;
  status: LoanStatus;
  principalBalanceCents: number;
  payoffAmountCents: number;
  nextPayment: { amountDueCents: number; dueDate: string } | null;
  nextPaymentUnavailable: boolean; // true when the backend failed to return nextPayment (partial data)
  autopay: { enabled: boolean; linkedAccount: { bankName: string; last4: string } | null };
};

export type LinkedAccountSummary = { id: string; bankName: string; last4: string };

export type PreparedPayment = {
  quoteId: QuoteId;
  loanId: string;
  linkedAccountId: string;
  amountCents: number;
  expiresAt: number;
};

export type StepUpCheck = { passed: boolean; attemptsLeft: number };

// enabled: true requires an account; enabled: false must not carry one. Checked at compile time.
// (`?: never` makes passing an account with enabled: false an error, not a silently ignored field.)
export type AutopayChange = { loanId: string } & (
  | { enabled: true; linkedAccountId: string }
  | { enabled: false; linkedAccountId?: never }
);

export type AutopaySettings = LoanDetails["autopay"];

// loanStatusAfter is read back after the charge (null when that read failed): the status fetched before a payment
// is stale once it succeeds.
export type PaymentReceipt = { paymentId: string; amountCents: number; status: "succeeded"; loanStatusAfter: LoanStatus | null };

// ---- request plumbing shared by all tools ----

export function apiUrl(session: Session, path: string): string {
  return session.api.baseUrl + path;
}

// Spread into request()/graphqlRequest() options. Add per-call headers (Idempotency-Key) on top.
export function apiOptions(session: Session) {
  return {
    headers: { "x-api-key": session.api.apiKey, "x-session-id": session.id },
    timeoutMs: session.api.timeoutMs,
    fetchImpl: session.api.fetchImpl,
    sleep: session.api.sleep,
  };
}
