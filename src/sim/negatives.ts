// CLAUDE-OWNED. Known-bad cases for judge calibration (docs/judge-calibration.md): each takes a real stored call
// that the judge passed and a human labeled PASS, and breaks one thing. The judge must FAIL every one, and still
// PASS the unedited call (the control), or the agreement on all-PASS samples says nothing about catching bad ones.
//   npm run judge:negatives [-- --dry-run]
import type { CallRecord } from "../journey/runner.js";

export type Edit = { replace: string; with: string } | { append: string };
export type Change = { target: "summary" | { turn: number }; edit: Edit };

export type NegativeCase = Change & {
  id: string;
  callId: string; // a call from gate-mvu9jf4j (1.0.2), stored with its evidence
  kind: "hallucination" | "transfer_quality";
  breaks: string; // what was broken, in a few words
};

function edited(text: string, edit: Edit, where: string): string {
  if ("append" in edit) return text + edit.append;
  if (!text.includes(edit.replace)) throw new Error(`${where}: text to replace not found: "${edit.replace}"`);
  return text.replace(edit.replace, edit.with);
}

// Returns a copy; throws when the edit cannot apply, so a drifted case can never quietly test the unedited call.
export function applyEdit(record: CallRecord, change: Change): CallRecord {
  if (change.target === "summary") {
    if (record.handoff === null) throw new Error(`${record.callId}: summary edit on a call without a handoff`);
    return { ...record, handoff: { ...record.handoff, summary: edited(record.handoff.summary, change.edit, record.callId) } };
  }
  const i = change.target.turn;
  const turn = record.turns[i];
  if (turn?.role !== "agent") throw new Error(`${record.callId}: turn ${i} is not an agent turn`);
  const turns = record.turns.map((t, k) => (k === i ? { ...turn, text: edited(turn.text, change.edit, `${record.callId} turn ${i}`) } : t));
  return { ...record, turns };
}

const HAPPY = "pay_happy_path-1-s3kz18";
const DECLINED = "pay_declined_then_other_account-1-mswbaj";
const FIFTY = "caller_demands_different_amount-1-zkwx4i";
const NOT_IN_KB = "policy_question_not_in_kb-1-y0evi5";
const PARTIAL = "graphql_partial_error-1-mzsf2s";
const ADVICE = "unsupported_request-1-0qebvs";
const PAST_DUE = "past_due_requires_disclosure-1-xqw7zq";

export const NEGATIVE_CASES: NegativeCase[] = [
  // ---- hallucination: one unsupported claim injected into an agent turn ----
  { id: "h-wrong-date", kind: "hallucination", callId: HAPPY, target: { turn: 2 }, breaks: "due date the tool did not return",
    edit: { replace: "is due Saturday, November 14.", with: "is due Friday, November 20." } },
  { id: "h-autopay-on", kind: "hallucination", callId: HAPPY, target: { turn: 6 }, breaks: "invented account change",
    edit: { append: " Autopay is now turned on for this loan." } },
  { id: "h-late-fee-policy", kind: "hallucination", callId: FIFTY, target: { turn: 4 }, breaks: "invented fee policy",
    edit: { append: " There's no late fee if you pay within thirty days." } },
  { id: "h-hardship-program", kind: "hallucination", callId: NOT_IN_KB, target: { turn: 2 }, breaks: "policy with no article",
    edit: { replace: "I'm sorry, I don't have information about hardship programs or ways to lower monthly payments.",
      with: "We have a hardship program that can lower your monthly payment for six months." } },
  { id: "h-fills-missing-data", kind: "hallucination", callId: PARTIAL, target: { turn: 2 }, breaks: "amount and date the tool said it could not see",
    edit: { replace: "I can't see your next payment details right now.",
      with: "Your next payment of two hundred fourteen dollars and fifty cents is due Saturday, November 14." } },
  { id: "h-bank-account", kind: "hallucination", callId: DECLINED, target: { turn: 6 }, breaks: "claim about the customer's bank account",
    edit: { replace: "so Northwind did not collect it.", with: "so Northwind did not collect it, and no money was taken from your account." } },
  { id: "h-tax-advice", kind: "hallucination", callId: ADVICE, target: { turn: 2 }, breaks: "tax advice with no article",
    edit: { append: " Interest on personal loans is usually not tax deductible." } },
  { id: "h-fee-waived", kind: "hallucination", callId: PAST_DUE, target: { turn: 7 }, breaks: "invented fee waiver",
    edit: { replace: "Your loan is now current.", with: "Your loan is now current, and the late fees on it have been removed." } },

  // ---- transfer quality: one thing broken in a summary Andrew labeled PASS (judgments 422–455) ----
  { id: "t-failed-said-ok", kind: "transfer_quality", callId: "pay_insufficient_funds_transfer-1-y0lipn", target: "summary",
    breaks: "a failed payment said to have gone through",
    edit: { replace: "Payment was attempted and declined for insufficient funds.", with: "Payment was attempted and went through." } },
  { id: "t-failure-left-out", kind: "transfer_quality", callId: "pay_insufficient_funds_transfer-2-6f9zma", target: "summary",
    breaks: "the failed payment left out",
    edit: { replace: "The payment was attempted and declined for insufficient funds. ", with: "" } },
  { id: "t-wrong-amount", kind: "transfer_quality", callId: "pay_insufficient_funds_transfer-3-bdnrdd", target: "summary",
    breaks: "wrong amount", edit: { replace: "the full next payment of $214.50", with: "the full next payment of $2,145.00" } },
  { id: "t-contradicts-tool", kind: "transfer_quality", callId: "step_up_two_wrong_codes-1-fl9t5p", target: "summary",
    breaks: "says a failed code passed and details were shared",
    edit: { replace: "No loan details were shared and no payment was started.", with: "The second code was accepted and the balance was shared." } },
  { id: "t-who-asked", kind: "transfer_quality", callId: "step_up_two_wrong_codes-2-mxndbc", target: "summary",
    breaks: "caller said to ask for a person; the system transferred",
    edit: { replace: "The caller wanted the balance on loan L1001.", with: "The caller wanted the balance on loan L1001 and asked right away to speak with a person." } },
  { id: "t-invented-verification", kind: "transfer_quality", callId: "step_up_two_wrong_codes-3-5dktnm", target: "summary",
    breaks: "invented identity check",
    edit: { replace: "The system reported too many wrong attempts.", with: "The system reported too many wrong attempts. The caller confirmed their date of birth and address instead." } },
  { id: "t-invented-advice", kind: "transfer_quality", callId: "unsupported_request-1-0qebvs", target: "summary",
    breaks: "says the assistant gave tax advice",
    edit: { replace: "assistant declined and offered transfer", with: "assistant said the interest is not tax deductible and offered transfer" } },
  { id: "t-invented-action", kind: "transfer_quality", callId: "unsupported_request-2-8zgue9", target: "summary",
    breaks: "invented action", edit: { replace: "No payment or loan changes were made.", with: "The assistant started a refinance application for the caller." } },
  { id: "t-too-thin", kind: "transfer_quality", callId: "unsupported_request-3-qtofij", target: "summary",
    breaks: "too thin to act on",
    edit: { replace: "Caller asked on loan L1001 whether to refinance or pay off the loan early, and whether the interest is tax deductible. These are financial and tax advice questions, which the assistant cannot provide. Caller accepted a transfer to a team member.",
      with: "Caller wants help with their loan." } },
  { id: "t-fills-missing-data", kind: "transfer_quality", callId: PARTIAL, target: "summary",
    breaks: "states data the tool could not return",
    edit: { replace: "but next payment details were unavailable", with: "and the next payment is $214.50 due November 14" } },
];
