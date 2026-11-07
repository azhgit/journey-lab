// CLAUDE-OWNED (M5). The make-payment journey as data. Validated by parseJourney() in src/journey/schema.ts.
// Fictional company (Northwind Lending). Verbatim texts are illustrative, NOT legal text.
import type { JourneyInput } from "../src/journey/schema.js";

export const makePayment = {
  id: "make-payment",
  version: "1.0.2",
  goal: "Help a verified customer make a one-time payment on their own loan from a linked bank account.",
  channels: ["chat", "voice"],
  // Shared safety rules, the step outline, and channel formatting are added by code (Q14); this is only
  // the journey-specific part.
  instructions: [
    "You help Northwind Lending customers make a one-time loan payment.",
    "Find out which loan and which linked account the customer wants to use, then how much to pay.",
    "If the customer is unsure of the amount, offer the amount due or the payoff amount from the loan details.",
    "Once you know the loan, the account, and the amount, call preparePayment right away. Do not ask the customer to confirm first: the system reads the payment back and asks for their answer.",
    "Be patient and plain-spoken with customers who are behind on payments; never shame or pressure them.",
    // 1.0.2: after a decline the agent kept adding its own reassurance in new words each time ("no money was taken
    // from your account", "your loan has not been charged"); see docs/judge-calibration.md.
    "If a payment is declined, say the tool's spoken text, then offer another linked account. Add nothing of your own about money, the loan, or the customer's bank account: Northwind cannot see the customer's bank.",
  ].join("\n"),
  steps: [
    { id: "verify_identity", description: "Only if the session is not verified: step-up by text code.", tools: ["sendStepUpCode", "checkStepUpCode"] },
    { id: "review_loan", description: "Look up the loan so the customer hears what is due.", tools: ["getLoanDetails"] },
    { id: "choose_account", description: "Confirm which linked account to pay from.", tools: ["listLinkedAccounts"] },
    { id: "quote", description: "Validate the amount and account; the read-back is spoken by code.", tools: ["preparePayment"] },
    { id: "pay", description: "Only after the customer clearly agrees to that read-back.", tools: ["makePayment"] },
  ],
  tools: [
    "getLoanDetails",
    "listLinkedAccounts",
    "preparePayment",
    "makePayment",
    "sendStepUpCode",
    "checkStepUpCode",
    "searchKnowledge", // policy questions mid-call (Tier 0); answers only from returned articles
  ],
  verbatim: [
    {
      id: "greeting_disclosure",
      when: "on_start",
      source: {
        kind: "static",
        text: {
          voice: "Thanks for calling Northwind Lending. You're speaking with an automated assistant, and this call may be recorded.",
          chat: "Thanks for contacting Northwind Lending. You're chatting with an automated assistant, and this chat may be saved.",
        },
      },
    },
    {
      // ILLUSTRATIVE placeholder, not legal text. Spoken as soon as a past-due loan comes up (Q6).
      id: "delinquent_notice",
      when: "on_loan_identified",
      condition: "loan_past_due",
      source: { kind: "static", text: "[Illustrative notice] This account is past due. This is a communication from a debt collector." },
    },
    { id: "payment_confirmation", when: "after_tool", tool: "preparePayment", source: { kind: "tool_spoken" } },
    { id: "transfer_notice", when: "on_transfer", source: { kind: "static", text: "I'm connecting you with a member of our team now." } },
  ],
  guardrails: [
    { kind: "amount_from_code_only" },
    { kind: "require_confirmation", tool: "makePayment", readBack: "preparePayment" },
    {
      kind: "never_say",
      pattern: "\\b(we|i) (will |can )?guarantee\\b",
      shouldMatch: ["We guarantee your credit score will go up.", "I can guarantee approval."],
      shouldNotMatch: ["I can't guarantee that, but I can tell you what is due."],
    },
    {
      kind: "never_say",
      pattern: "\\b(waive|forgive|cancel)\\b.{0,20}\\b(fee|fees|interest|balance)\\b",
      shouldMatch: ["I'll waive the late fee for you.", "We can forgive the remaining balance."],
      shouldNotMatch: ["I can't change fees, but I can connect you with our team."],
    },
    {
      // Found by the M7 gate: agreeing to the caller's amount before preparePayment checked it.
      kind: "never_say",
      pattern: "\\b(i|we)('ll| will| can)\\s+(set up|take|process|make|schedule|do)\\s+(a|that|your|the)\\s+[a-z -]+?\\s+dollars?\\s+payment\\b",
      shouldMatch: ["I can set up a fifty dollar payment for you.", "We can take that fifty dollar payment today."],
      shouldNotMatch: [
        "I can't take a fifty dollar payment on this loan.",
        "I can take a payment between two hundred fourteen dollars and fifty cents and eight thousand dollars.",
      ],
    },
    {
      // Found in judge calibration (#219, #220): after a decline, the agent added claims about the customer's own
      // bank account, which Northwind cannot see. The decline result supports only "Northwind did not collect it".
      kind: "never_say",
      pattern:
        "\\b(no money|nothing|no funds)\\b[^.]{0,40}\\b(taken|charged|withdrawn|debited|came out)\\b[^.]{0,20}\\byour (bank )?account\\b" +
        "|\\byour (bank )?account (was|wasn't|was not|hasn't been|has not been|won't be|will not be) (charged|debited)\\b",
      shouldMatch: [
        "No money was taken from your account.",
        "Your loan is still current, and nothing was taken from your account.",
        "Your bank account was not charged.",
      ],
      shouldNotMatch: [
        "That payment was declined, so Northwind did not collect it.",
        "No payment was made on this call.",
        "Your payment went through. It was taken from Cedar Credit Union ending in zero nine three seven.",
      ],
    },
  ],
  handoff: {
    defaultQueue: "customer_care",
    routes: { delinquent: "collections", step_up_failed: "fraud_review" },
  },
} satisfies JourneyInput;
