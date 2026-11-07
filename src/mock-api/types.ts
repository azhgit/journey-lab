// Domain types for the fictional Northwind Lending backend. SPEC §4.

export type LoanStatus = "current" | "past_due" | "paid_off";

export type Customer = { id: string; name: string; phone: string };

export type Loan = {
  id: string;
  customerId: string;
  status: LoanStatus;
  principalBalanceCents: number;
  payoffAmountCents: number;
  nextPayment: { amountDueCents: number; dueDate: string } | null;
  monthlyPaymentCents: number; // one scheduled installment; what is due next once the amount due is paid
  autopay: { enabled: boolean; linkedAccountId: string | null };
};

// last4 only: a full account number never exists in this system.
export type LinkedAccount = { id: string; customerId: string; bankName: string; last4: string };

export type Payment = {
  id: string;
  loanId: string;
  linkedAccountId: string;
  amountCents: number;
  status: "pending" | "succeeded" | "failed";
  failureCode: string | null;
  idempotencyKey: string;
  createdAt: string;
};

// Failure injection, set per x-session-id. SPEC §7.3.
export const SCENARIO_FLAGS = [
  "payment_declined",
  "payment_declined_once",
  "insufficient_funds",
  "timeout", // POST /v1/payments commits, then the first response hangs past the tool timeout
  "flaky_503_then_ok", // first hit per (method, path) in the session returns 503
  "rate_limited_with_retry_after", // first hit per (method, path) returns 429 + Retry-After: 1
  "past_due_account", // every loan reads as past_due
  "phone_mismatch", // harness-level (session.verifiedPhone differs); the backend ignores it
  "graphql_partial_error", // Loan.nextPayment fails with UPSTREAM_UNAVAILABLE
  "empty_loans", // GET /v1/loans?phone= returns []
  "slow_tool", // every response is delayed by slowMs
  "sms_unavailable", // POST /v1/step-up/send returns 503
] as const;

export type ScenarioFlag = (typeof SCENARIO_FLAGS)[number];
