// HUMAN-OWNED (M3), written by Claude at Andrew's request. Tests: src/tools/loans.test.ts. SPEC §5, §8.2.
import { z } from "zod";
import { graphqlRequest, request, type GraphQLErrorItem } from "../lib/http.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  apiOptions,
  apiUrl,
  type LinkedAccountSummary,
  type LoanDetails,
  type LoanStatus,
  type Session,
  type ToolFailure,
  type ToolResult,
} from "./context.js";
import { spokenAmount, spokenDate, spokenDigits } from "./spoken.js";

// Rules shared by every tool that touches a loan:
// 1. Identity first, before any backend call (no enumeration):
//      Tier 2: session.stepUpVerifiedLoanId === loanId  → identity proven for this loan
//      Tier 1: session.verifiedPhone !== null           → must still pass the ownership check (rule 2)
//      neither                                          → err { kind: "unverified" } with ZERO fetches
// 2. Ownership in code: compare the loan's customer.phone to session.verifiedPhone; mismatch → not_owner.
//    Never trust the backend's filtering alone. (Skip the compare on the Tier 2 path.)
// 3. Data handed to the model never includes the customer's phone.

type Identity = "step_up" | "phone";

// Pure: decides from the session alone, so an unverified caller never reaches the network.
export function identityFor(session: Session, loanId: string): Identity | null {
  if (session.stepUpVerifiedLoanId === loanId) return "step_up";
  if (session.verifiedPhone !== null) return "phone";
  return null;
}

const LoanOwner = z.object({ customer: z.object({ phone: z.string() }) });

// Identity + ownership for tools that don't otherwise fetch the loan (linked accounts, payments).
// Costs one GET on the Tier 1 path, none on Tier 2 or when unverified.
export async function checkOwnership(session: Session, loanId: string): Promise<Result<void, ToolFailure>> {
  const identity = identityFor(session, loanId);
  if (identity === null) return err({ kind: "unverified" });
  if (identity === "step_up") return ok(undefined);

  const res = await request({
    ...apiOptions(session),
    url: apiUrl(session, `/v1/loans/${encodeURIComponent(loanId)}`),
    schema: LoanOwner,
  });
  if (!res.ok) return res;
  return res.data.customer.phone === session.verifiedPhone ? ok(undefined) : err({ kind: "not_owner" });
}

// ---- getLoanDetails ----

// customer { phone } is fetched only for the ownership compare; it is dropped before anything reaches the model.
const LOAN_DETAILS_QUERY = /* GraphQL */ `
  query LoanDetails($id: ID!) {
    loanDetails(id: $id) {
      id
      status
      principalBalanceCents
      payoffAmountCents
      nextPayment { amountDueCents dueDate }
      autopay { enabled linkedAccount { bankName last4 } }
      customer { phone }
    }
  }
`;

const Cents = z.number().int().nonnegative();

// Nullable where the schema is nullable: loanDetails (unknown loan) and nextPayment (paid off, or partial error).
const LoanDetailsData = z.object({
  loanDetails: z
    .object({
      id: z.string(),
      status: z.enum(["CURRENT", "PAST_DUE", "PAID_OFF"]),
      principalBalanceCents: Cents,
      payoffAmountCents: Cents,
      nextPayment: z.object({ amountDueCents: Cents, dueDate: z.string() }).nullable(),
      autopay: z.object({
        enabled: z.boolean(),
        linkedAccount: z.object({ bankName: z.string(), last4: z.string() }).nullable(),
      }),
      customer: z.object({ phone: z.string() }),
    })
    .nullable(),
});

const STATUS: Record<"CURRENT" | "PAST_DUE" | "PAID_OFF", LoanStatus> = {
  CURRENT: "current",
  PAST_DUE: "past_due",
  PAID_OFF: "paid_off",
};

const SPOKEN_STATUS: Record<LoanStatus, string> = {
  current: "current",
  past_due: "past due",
  paid_off: "paid off",
};

function hasErrorAt(errors: GraphQLErrorItem[], path: Array<string | number>): boolean {
  return errors.some((e) => e.path?.length === path.length && e.path.every((p, i) => p === path[i]));
}

// What is due, as spoken text ("" when nothing is due). On a past-due loan the amount due is the catch-up amount
// (paying it makes the loan current), so it is said as what is owed now: called a "next payment", the agent
// told callers it could not say how much they owe.
export function paymentSpeech(details: LoanDetails): string {
  // Missing data is said as missing: never a guessed amount or date.
  if (details.nextPaymentUnavailable) return "I can't see your next payment details right now.";
  if (details.nextPayment === null) return "";
  const amount = spokenAmount(details.nextPayment.amountDueCents);
  const date = spokenDate(details.nextPayment.dueDate);
  return details.status === "past_due"
    ? `The amount due now is ${amount}. It was due ${date}. Paying that amount brings the loan current.`
    : `Your next payment of ${amount} is due ${date}.`;
}

function loanSpeech(details: LoanDetails): string {
  const status = `Your loan is ${SPOKEN_STATUS[details.status]}.`;
  const payment = paymentSpeech(details);
  return payment === "" ? status : `${status} ${payment}`;
}

export async function getLoanDetails(session: Session, input: { loanId: string }): Promise<ToolResult<LoanDetails>> {
  const identity = identityFor(session, input.loanId);
  if (identity === null) return err({ kind: "unverified" });

  // One round trip: the details query also carries customer.phone, so no separate ownership GET.
  const res = await graphqlRequest({
    ...apiOptions(session),
    url: apiUrl(session, "/graphql"),
    query: LOAN_DETAILS_QUERY,
    variables: { id: input.loanId },
    dataSchema: LoanDetailsData,
  });
  if (!res.ok) return res;

  const { data, errors } = res.data;
  const loan = data.loanDetails;
  if (loan === null) {
    // Unknown loan is partial data, not a transport error: data.loanDetails = null plus NOT_FOUND.
    if (errors.some((e) => e.extensions?.code === "NOT_FOUND")) return err({ kind: "not_found" });
    const first = errors[0];
    return err({ kind: "graphql", code: first?.extensions?.code ?? "UNKNOWN", message: first?.message ?? "loanDetails was null" });
  }

  if (identity === "phone" && loan.customer.phone !== session.verifiedPhone) return err({ kind: "not_owner" });

  // Build the result field by field so customer.phone cannot leak through a spread.
  const details: LoanDetails = {
    id: loan.id,
    status: STATUS[loan.status],
    principalBalanceCents: loan.principalBalanceCents,
    payoffAmountCents: loan.payoffAmountCents,
    nextPayment: loan.nextPayment,
    // null alone is ambiguous (a paid-off loan has none too); the error on that path is what marks an outage.
    nextPaymentUnavailable: loan.nextPayment === null && hasErrorAt(errors, ["loanDetails", "nextPayment"]),
    autopay: loan.autopay,
  };
  return ok({ data: details, spoken: loanSpeech(details) });
}

// ---- listLinkedAccounts ----

const LinkedAccounts = z.array(z.object({ id: z.string(), bankName: z.string(), last4: z.string() }));

export function describeAccount(account: { bankName: string; last4: string }): string {
  return `${account.bankName} ending in ${spokenDigits(account.last4)}`;
}

// No ownership check here: callers run checkOwnership first.
export async function fetchLinkedAccounts(session: Session, loanId: string) {
  return request({
    ...apiOptions(session),
    url: apiUrl(session, `/v1/loans/${encodeURIComponent(loanId)}/linked-accounts`),
    schema: LinkedAccounts,
  });
}

export async function listLinkedAccounts(
  session: Session,
  input: { loanId: string },
): Promise<ToolResult<LinkedAccountSummary[]>> {
  const owned = await checkOwnership(session, input.loanId);
  if (!owned.ok) return owned;

  const res = await fetchLinkedAccounts(session, input.loanId);
  if (!res.ok) return res;

  const spoken =
    res.data.length === 0
      ? "I don't see any bank accounts linked to this loan."
      : `The accounts on file are ${res.data.map(describeAccount).join(", and ")}.`;
  return ok({ data: res.data, spoken });
}
