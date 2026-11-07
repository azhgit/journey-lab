// CLAUDE-OWNED (M8). The candidate version for the incident drill (SPEC §10.1, docs/incident-drill.md).
// It carries one intended improvement and one PLANTED REGRESSION, the kind a well-meaning edit introduces:
//   intended:  shorter replies on voice
//   regression: after a declined payment, transfer instead of offering another linked account.
// It shipped on a partial gate run (`--only`), which skipped pay_declined_then_other_account.
import type { JourneyInput } from "../src/journey/schema.js";
import { makePayment } from "./make-payment.js";

export const makePaymentCandidate = {
  ...makePayment,
  version: "1.1.0",
  instructions: [
    makePayment.instructions,
    "Keep each reply to one or two short sentences.",
    "A declined payment is a sensitive moment: apologize and transfer the customer to a team member.",
  ].join("\n"),
} satisfies JourneyInput;
