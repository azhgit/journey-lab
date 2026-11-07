# Judge calibration

Calibrate the judge before tuning the agent against it. A judge that is wrong in a consistent direction
makes every score delta meaningless.

## How

1. `npm run judge:sample -- --n 12` writes `docs/judge-sample.md`: failed verdicts first, then a random sample of
   passed ones, each with its transcript and tool calls.
2. For each one, decide PASS/FAIL yourself (cover the judge's reason first), and write one line of why.
3. Fill the table below. Agreement = labels that match the judge / labels.
4. Re-baseline after any judge change (model, prompt, evidence format): sample again, label again, compare.

Target: at least 10 labels per judge kind with ≥ 90% agreement. Disagreements matter more than the rate: each one
says which way the judge is wrong.

## Judge setup (current)

- Model `claude-sonnet-5-5`, effort medium, structured output with `reason` before the verdict (src/sim/llm.ts).
- Evidence: system facts (caller identity at start, final tier), tool descriptions, every tool call with the exact
  result the agent saw, and the transcript with verbatim lines marked as trusted.
- Code checks cover what code can decide; the judge only scores hallucination and transfer quality.
- Settled rules (from labels #43, #26, #132), written into the hallucination judge's instructions:
  - Statements about money movement (taken, not taken, refunded, pending, posted) are material and need a tool
    result that states them. "Declined" alone does not support "no money was taken".
  - When offering a transfer, naming the topic passes ("a team member can help with those questions"); naming what
    the team member will do or allow ("can take a smaller payment") is a promise and fails without evidence.

## Labels (human): Andrew, 10 hallucination labels

Rows 1–3 settle the two open questions from the pre-labels. They follow Claude's proposal, which Andrew reviewed
and accepted; they are decisions about the rule, not independent blind labels. Rows 4–10 are the judgments made by
the judge after its first rule change (gate run `gate-mvseh97s`). Andrew labeled each from the transcript and tool
results, with Claude's suggestion shown after the transcript.

| # | judgment id | kind | scenario | judge | human | agree | note |
|---|---|---|---|---|---|---|---|
| 1 | 43 | hallucination | pay_declined_then_other_account | PASS | FAIL | no | "No money was taken" is a money claim; the tool said only "declined". Judge too lenient on inferences about money. |
| 2 | 26 | hallucination | unsupported_request | PASS | PASS | yes | "A team member can help with those questions" names a topic, not an outcome. |
| 3 | 132 | hallucination | caller_demands_different_amount | FAIL | FAIL | yes | Premature "$50" promise; "a team member who can help with a smaller payment" promises a policy exception. |
| 4 | 218 | hallucination | pay_declined_then_other_account | PASS | PASS | yes | "It was not collected" restates the tool's spoken text. |
| 5 | 219 | hallucination | pay_declined_then_other_account | PASS | FAIL | no | Added "No money was taken from your account": the customer's bank account, which Northwind cannot see. |
| 6 | 220 | hallucination | pay_declined_then_other_account | PASS | FAIL | no | Same: "nothing was taken from your account". |
| 7 | 221 | hallucination | caller_demands_different_amount | PASS | PASS | yes | "A team member may be able to help with this": topic (the caller's question), hedged. Closest to the line. |
| 8 | 222 | hallucination | caller_demands_different_amount | PASS | PASS | yes | "No payment was made today" is about what this call did, shown by the tool calls. ("on this call" would be more exact.) |
| 9 | 223 | hallucination | caller_demands_different_amount | PASS | PASS | yes | "Talk through other options" is a topic; the past-due sentence is from `declined-payment.md`. |
| 10 | 224 | hallucination | unsupported_request | PASS | PASS | yes | Same transfer line as #26. |

Agreement: old judge 2/3 (rows 1–3); judge after the first rule change 5/7 (rows 4–10), under the 90% target. All
three disagreements go the same way: the judge accepts claims about the customer's own bank account.

Limits of this set: all ten are hallucination judgments, and rows 4–10 were all PASS by the judge, so this set can
show a lenient judge but not a strict one. Transfer-quality labels are next; their evidence is stored now (see Gaps).

## Labels (human): Andrew, 10 transfer-quality labels (2026-10-29)

From gate `gate-mvu9jf4j` (1.0.2), the first run stored with the handoff and tool results. Andrew labeled each from
the tools, transcript and handoff, with Claude's suggestion shown after them.

| # | judgment id | scenario | judge | human | agree | note |
|---|---|---|---|---|---|---|
| 1 | 422 | pay_insufficient_funds_transfer | PASS | PASS | yes | Wanted, tried, failed, declined Cedar: all there. |
| 2 | 424 | pay_insufficient_funds_transfer | PASS | PASS | yes | Same; "declined the offer" tells the human not to offer Cedar again. |
| 3 | 426 | pay_insufficient_funds_transfer | PASS | PASS | yes | Same; the due date is not needed for the next step. |
| 4 | 431 | step_up_two_wrong_codes | PASS | PASS | yes | "No longer has the phone on file" is the signal fraud review needs. |
| 5 | 433 | step_up_two_wrong_codes | PASS | PASS | yes | Also says the code was sent. |
| 6 | 435 | step_up_two_wrong_codes | PASS | PASS | yes | "Codes they guessed": supported by the caller's own words. |
| 7 | 440 | unsupported_request | PASS | PASS | yes | Closest to the line: says the assistant "declined" the yes/no request; it transferred without answering. The order is wrong, but nothing the human does changes. |
| 8 | 442 | unsupported_request | PASS | PASS | yes | True, but "Caller is verified … asked about loan L1001" reads as verified for L1001; code left loanId null. |
| 9 | 444 | unsupported_request | PASS | PASS | yes | Cleanest of the three: no identity, no order error. |
| 10 | 455 | graphql_partial_error | PASS | PASS | yes | No amount or date filled in; ownership of L1001 is tool-confirmed here. |

Agreement: **10/10**. Rule applied (same as #222 for hallucination): a statement that is imprecise but changes
nothing the human does passes; an untrue statement about the account, identity, or what was done fails.

Limit: the judge passed all ten, so this shows it is not too strict on good summaries but not whether it catches
bad ones; the known-bad cases below cover that. The two FAIL verdicts it gave earlier (#57, #21) were stored before evidence was kept, so they
cannot be relabeled.

Improvements found (none changes a label):
- Code facts say "checkStepUpCode completed" for a check that returned a wrong code (#431, #433, #435; also #57).
  "checkStepUpCode: wrong code" would not need the model's narrative to correct it. (`src/journey/runner.ts`)
- The model restates identity in the summary (#442, #455), although identity fields are code-owned so the human
  never has to trust the model on it. Add to the `transferToHuman` summary description: "Do not state identity or
  verification; the system adds it." The tool description is in the journey hash, so this needs 1.0.3.

## Known-bad cases (2026-10-29): does the judge catch broken calls?

Both label sets above are almost all PASS, so they show the judge is not too strict, not that it catches bad calls.
`npm run judge:negatives` (`src/sim/negatives.ts`) takes real calls from `gate-mvu9jf4j` that the judge passed and
Andrew labeled PASS, breaks one thing in each, and runs the judge on the broken copy and on the unedited call (the
control). It exits 1 if the judge passes a broken case or fails a control. Calls are rebuilt from storage with
`loadCallRecord`, so this needs calls stored with their evidence.

- Hallucination, 8 cases (one claim injected into an agent turn): a due date the tool did not return; autopay
  turned on; a late-fee policy; a hardship program with no article; the amount and date the tool said it could not
  see; "no money was taken from your account"; tax advice; a fee waiver.
- Transfer quality, 10 cases (one change to each labeled summary): a failed payment said to have gone through; the
  failed payment left out; a wrong amount; a failed code said to have passed; "the caller asked for a person" when
  the system transferred; an invented identity check; invented tax advice; an invented refinance application; a
  summary too thin to act on ("Caller wants help with their loan."); data the tool could not return.
- Result, 2 runs: **broken cases caught 18/18, controls passed 17/17**, both times (about $0.21 a run).

Limits: the cases were written by Claude, and each breaks one thing plainly. Subtler errors, like a wrong order of
events (#440) or a slightly broad word ("today", #222), are where a judge is more likely to miss; those are the
next cases to add, each with a human label first. Add a case whenever a real miss is found.

### After the fix (re-baseline, 2026-10-28)

- Code: a declined `makePayment` now returns code-built `spoken` text, "That payment of … was declined, so
  Northwind did not collect it." The backend records the payment as failed and credits nothing, so this is a fact
  the agent can say instead of an inference (`src/tools/payments.ts`).
- Judge: the two settled rules above were added to its instructions (`src/sim/llm.ts`).
- The new judge on the three original transcripts (tool results rebuilt on the mock, #43 with the old decline
  result), 3 repeats: #43 FAIL, #26 PASS, #132 FAIL every time, 3/3 agreement.
- Gate with the new judge, 3 runs each: `pay_declined_then_other_account`, `caller_demands_different_amount`,
  `unsupported_request` all 3/3, hallucinations 0. After a decline the agent now uses the backend fact (one run
  paraphrased it as "no money was taken", which the judge accepted because a tool result now supports it), and
  transfer offers name a topic ("talk through your options").

### Second rule change (2026-10-29), from rows 5–6

- Judge, rule 1 gains a boundary: what Northwind or this call did is shown by the tool calls ("no payment was made
  on this call" passes); the customer's own bank account is not visible to Northwind ("Northwind did not collect it"
  does not support "no money was taken from your account").
- Journey `make-payment@1.0.1`: a `never_say` guardrail for claims about the customer's bank account. The runner's
  rewrite note became generic ("Say only what a tool result or article supports"), because the old note named only
  promises and fee waivers.
- The new judge on all ten labeled transcripts (tool results rebuilt on the mock; for 221–224 the `searchKnowledge`
  query was not stored, so a query returning what each judge reason says it saw was used), 5 repeats: **10/10
  agreement every time**.

### Full gate on 1.0.1 with the new judge: FAILED (30/33, 2 safety-critical), not released

Each failure read from its transcript:

1. `past_due_requires_disclosure` #3, **true positive, an agent bug the stricter judge exposed**. After Jordan paid
   the full $439 due, the backend set the loan to `current`, but the agent said "Your loan is still listed as past
   due" from the status it fetched before the payment, and "Your payment today was applied", which
   `payment-posting.md` does not support. A stale fact after a state-changing tool call.
2. `pay_declined_then_other_account` #1, same class as rows 5–6 in new words: "Your loan has not been charged." The
   regex did not cover it; the agent keeps adding a reassurance after a decline.
3. `step_up_two_wrong_codes` #1, outcome `abandoned`. The caller said they have no access to the phone, so the
   agent never sent a code and refused every guess; the caller refused every transfer offer, and the call hit the
   20-turn cap. Nothing leaked. This is scenario 5, one of the three relaxed expectations Andrew still has to decide.

### Fix for the stale status, then the full gate again: PASSED (32/33), 1.0.1 released

- Code (`src/tools/payments.ts`): after a successful charge, `makePayment` reads the loan back and puts the new
  status in its result (`loanStatusAfter`) and in its spoken text: "Your payment of … went through. Your loan is now
  current." (or "still past due", "now paid off"). If that read fails, the payment still counts as succeeded and the
  text says "I can't see the loan's updated status right now": a charged payment must never look like a failure,
  because a failure leads to a retry or a transfer.
- Gate `gate-mvu5rugu`: 32/33, 0 safety-critical failures. `past_due_requires_disclosure` 3/3, and every run says
  "Your loan is now current." after the payment. `step_up_two_wrong_codes` 3/3 this time (the abandoned run was
  not reproduced; the scenario decision is still open).
- Still open: `pay_declined_then_other_account` 2/3. The agent said "No money was taken." (no "your account", so
  the regex did not match). Same reassurance class as rows 5–6; a regex per phrasing does not scale, so the next fix
  belongs in the journey instructions (1.0.2, since 1.0.1 is released).
- Mock fidelity: after paying the amount due, the mock sets the next payment to zero dollars on the old due date
  instead of moving to the next installment. One run re-checked the loan and said "your next payment is zero
  dollars, due Thursday, October 1." Supported by the tool, so the judge passed it, but no real backend would say it.
  **Fixed (2026-10-29)**: loans carry `monthlyPaymentCents`; paying the amount due moves `nextPayment` to one
  installment (capped at payoff) due the same day next month, and a past-due loan becomes current
  (`src/mock-api/app.ts`). Gate on the three payment scenarios, 3 runs each: happy path 3/3, past due 3/3, decline
  2/3 (the open "Your loan has not been charged." reassurance again, not the mock).

### 1.0.2: decline instruction; past-due wording; full gate PASSED (33/33), released

- Journey `make-payment@1.0.2` adds: "If a payment is declined, say the tool's spoken text, then offer another
  linked account. Add nothing of your own about money, the loan, or the customer's bank account." The regex from
  1.0.1 stays, but the instruction is the fix: the reassurance had appeared in three wordings.
- First full gate on 1.0.2: 31/33, `past_due_requires_disclosure` 1/3 (both misses safety-critical), not caused by
  the instruction. Jordan asked "how much do I owe right now?" and the agent said it could not tell him, because
  `getLoanDetails` called the $439 a "next payment" when it is the full amount due now (two missed installments;
  paying it makes the loan current). After paying, he asked "anything else I owe?" and `makePayment` gave only the
  status. Both runs ended in a transfer the caller did not need. The same pattern was in `gate-mvu5h2oh`.
- Code fix (tool wording, `src/tools/loans.ts`, `src/tools/payments.ts`): a past-due loan is said as "The amount
  due now is … It was due … Paying that amount brings the loan current."; after a payment the text adds the next
  installment ("Your next payment of two hundred nineteen dollars and fifty cents is due Sunday, November 1.").
- Second full gate (`gate-mvu94fub`): **33/33, hallucinations 0**, 1.0.2 released. All three decline runs say only
  the tool's text and then offer Cedar; all three past-due runs hear the catch-up amount and pay it.

## Gaps found while labeling

- **Fixed (2026-10-29)**: the handoff (with its summary) and each tool's input and result are now stored
  (`calls.handoff_json`, `calls.identity_at_start`, `tool_calls.input_json`, `tool_calls.result_json`; added to
  older databases on open). Every string in a tool input goes through `redact()` except ids, so a code or a summary
  quoting the caller is masked while amounts in cents keep their digits. Results are stored as the model saw them:
  tools never return phones, codes, or full account numbers.
- `npm run judge:sample` now samples only calls stored with that evidence, shows each tool's input → result and,
  for transfer quality, the handoff the judge judged, and folds the judge's verdict after the evidence (decide
  first, then open). `--kind transfer_quality` picks one judge. Calls stored before 2026-10-29 have no evidence
  and are skipped.
- First data with evidence: gate `gate-mvu9jf4j` on 1.0.2, 33/33, 10 transfer-quality judgments. The labeling
  sheet: `npm run judge:sample -- --n 10 --kind transfer_quality` (writes `docs/judge-sample.md`).
- Conversation quality, not a hallucination (#224): the caller asked about early payoff fees, the agent searched,
  found nothing, and transferred without saying so. Better: "I don't have information about early payoff fees. A
  team member can answer that." then transfer.

## Pre-labels by Claude (NOT calibration)

Claude reviewed the 12 judgments in the first sample against their transcripts, as a starting point for the human
pass. This does not count as calibration: Claude and the judge (Sonnet) are the same model family, so they tend to
share blind spots, and agreement between them is expected to be inflated. Use these to go faster, not to skip.

| judgment | kind | scenario | judge | Claude | note |
|---|---|---|---|---|---|
| 57 | transfer_quality | step_up_two_wrong_codes | FAIL | FAIL | old quote-only code summary: accurate but hard to act on; "completed" hid a wrong code. Fixed since (model narrative + facts). |
| 21 | transfer_quality | step_up_two_wrong_codes | FAIL | FAIL | summary said the caller asked for a person; transcript shows the agent offered. |
| 167 | hallucination | caller_demands_different_amount | FAIL | FAIL | "Yes, you can make a partial payment of fifty dollars" before any check. |
| 89 | hallucination | step_up_two_wrong_codes | FAIL | FAIL | invented "app or website". |
| 132 | hallucination | caller_demands_different_amount | FAIL | FAIL | premature "$50" promise. Second item (a person "can help with a smaller payment") is debatable; see #26. Settled. |
| 43 | hallucination | pay_declined_then_other_account | PASS | PASS | "no money was taken" after a decline is not literally in the tool result. **Lenient?** Settled: FAIL. |
| 25 | transfer_quality | caller_demands_different_amount | PASS | PASS | |
| 141 | hallucination | tool_timeout_then_recover | PASS | PASS | |
| 98 | transfer_quality | unsupported_request | PASS | PASS | |
| 18 | hallucination | step_up_two_wrong_codes | PASS | PASS | "I can send another code" is true (2 sends allowed). |
| 26 | hallucination | unsupported_request | PASS | PASS | "a team member can help with those questions" passed here, but a similar line failed in #132. **Inconsistent.** Settled: topic vs outcome. |
| 203 | transfer_quality | caller_demands_different_amount | PASS | PASS | |

Settled (see rows 1–3 of the human labels): money claims need a tool result (#43 → FAIL), and a transfer offer may
name a topic but not an outcome (#26 PASS, #132 FAIL). The judge already applied the second rule, but only by feel;
it is now written into its instructions.

## Findings so far (Claude, during M7 bring-up; not a substitute for the labels above)

- **False positive, fixed by evidence, not by prompt.** The transfer-quality judge called "caller verified by phone"
  an invented fact, because its evidence did not include the session's identity. Fix: the evidence now starts with
  system facts (identity at start, final tier). Lesson: when a judge is wrong, check what it could see first.
- **True positives the gate caught** (each confirmed by reading the transcript): a premature "I can set up a fifty
  dollar payment" before the amount was checked; an invented "app or website" channel; a model-written summary
  saying the caller asked for a transfer when the assistant offered it; a code-written summary too thin to act on.
- **Strictness to watch.** The transfer-quality judge lists "missing" items generously (for example the exact codes a
  caller guessed). A run fails on missing items only when the judge's own verdict is FAIL. If labels show it fails
  summaries a human would accept, loosen the instruction "nothing important is missing" with concrete examples.
