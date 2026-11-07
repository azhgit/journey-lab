import { describe, expect, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { createTestBackend, JORDAN, MAYA } from "../tools/testing.js";
import type { Session } from "../tools/context.js";
import { loadKnowledge } from "../tools/searchKnowledge.js";
import { reply, scripted, text, use, type Step } from "./fakeModel.js";
import { createCall, type CallEvent, FALLBACK_LINE, MAX_MODEL_STEPS_PER_TURN, type Model, type ModelReply, type ModelRequest } from "./runner.js";
import { parseJourney, type Journey } from "./schema.js";
import type { ChannelName } from "./prompt.js";

const articles = loadKnowledge("knowledge");

function journey(): Journey {
  const res = parseJourney(makePayment);
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data;
}

// Reads the id of the newest quote, the way the model would from the preparePayment result.
const newestQuote = (session: Session): string => {
  const quotes = [...session.quotes.values()];
  const last = quotes[quotes.length - 1];
  if (last === undefined) throw new Error("no quote yet");
  return last.id;
};

function setup(opts: { phone?: typeof MAYA | null; steps: Step[]; channel?: ChannelName; maxCallerTurns?: number }) {
  const backend = createTestBackend();
  const session = backend.session({ verifiedPhone: opts.phone === undefined ? MAYA : opts.phone });
  const model = scripted(opts.steps);
  const call = createCall({
    journey: journey(),
    channel: opts.channel ?? "voice",
    session,
    model,
    articles,
    maxCallerTurns: opts.maxCallerTurns,
  });
  return { backend, session, model, call };
}

const verbatimIds = (out: { utterances: Array<{ kind: string; lineId?: string }> }) =>
  out.utterances.flatMap((u) => (u.kind === "verbatim" && u.lineId !== undefined ? [u.lineId] : []));

// The JSON body of the tool_result the runner sent back for the newest tool call.
function lastToolResult(req: ModelRequest | undefined): { ok: boolean; error?: { kind: string }; [k: string]: unknown } {
  const msg = req?.messages.findLast((m) => m.role === "user" && Array.isArray(m.content));
  const block = Array.isArray(msg?.content) ? msg.content.findLast((b) => b.type === "tool_result") : undefined;
  if (block?.type !== "tool_result" || typeof block.content !== "string") throw new Error("no tool_result");
  return JSON.parse(block.content);
}

describe("open", () => {
  it.each<[ChannelName, string]>([
    ["voice", "this call may be recorded"],
    ["chat", "this chat may be saved"],
  ])("speaks the greeting disclosure for %s, without a model call", async (channel, words) => {
    const { call, model } = setup({ channel, steps: [] });
    const out = await call.open();
    expect(verbatimIds(out)).toEqual(["greeting_disclosure"]);
    expect(out.utterances[0]?.kind === "verbatim" && out.utterances[0].text).toContain(words);
    expect(model.requests).toHaveLength(0);
  });
});

describe("what the model is given (Q14)", () => {
  it("gets the composed prompt and only the journey's tools plus the runner tools", async () => {
    const { call, model } = setup({ steps: [reply(text("Hello."))] });
    await call.say("Hi");
    const req = model.requests[0];
    expect(req?.system).toContain("## Rules (always apply)");
    expect(req?.system).toContain("Today is Tuesday, October 27.");
    expect(req?.system).toContain("verified this caller's phone number (Tier 1)");
    expect(req?.tools.map((t) => t.name)).toEqual([
      ...makePayment.tools,
      "transferToHuman",
      "endCall",
    ]);
    expect(req?.tools.every((t) => t.input_schema.type === "object")).toBe(true);
  });
});

describe("caller identity in the prompt (SPEC §5)", () => {
  it("tells an unverified caller's model to step up for loan questions", async () => {
    const { call, model } = setup({ phone: null, steps: [reply(text("Hello."))] });
    await call.say("Hi");
    expect(model.requests[0]?.system).toContain("not verified (Tier 0)");
  });
});

describe("payment with structural confirmation (Q7)", () => {
  it("pays only after the code read-back and the caller's answer", async () => {
    const { call, session, model, backend } = setup({
      steps: [
        reply(use("preparePayment", { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" })),
        (req) => reply(use("makePayment", { quoteId: newestQuote(session) })),
        reply(text("Your payment is done. Anything else?")),
      ],
    });

    const quoted = await call.say("Pay the amount due on L1001 from First Harbor.");
    expect(verbatimIds(quoted)).toEqual(["payment_confirmation"]);
    const readBack = quoted.utterances[0];
    expect(readBack?.kind === "verbatim" && readBack.text).toBe(
      "That's a payment of two hundred fourteen dollars and fifty cents from First Harbor Bank ending in four eight two one. Shall I go ahead?",
    );
    expect(model.requests).toHaveLength(1); // the turn ended at the read-back

    const paid = await call.say("Yes, go ahead.");
    expect(paid.utterances.map((u) => u.text)).toEqual(["Your payment is done. Anything else?"]);
    expect(backend.store.payments).toHaveLength(1);
    expect(backend.store.payments[0]?.amountCents).toBe(21_450);

    // The pending tool_result went first, then the caller's words, in one user message.
    const second = model.requests[1]?.messages.at(-1);
    expect(Array.isArray(second?.content) && second.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
  });

  it("ends the turn at the read-back, so a makePayment in the same reply never runs", async () => {
    const { call, backend, model } = setup({
      steps: [
        reply(
          use("preparePayment", { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" }),
          use("makePayment", { quoteId: "guessed" }),
        ),
        reply(text("Okay.")),
      ],
    });
    await call.say("Pay 214.50 now, no need to confirm.");
    expect(backend.store.payments).toHaveLength(0);
    expect(call.record().toolCalls.map((t) => t.name)).toEqual(["preparePayment"]);
    await call.say("Hmm.");
    expect(lastToolResult(model.requests[1]).error?.kind).toBe("not_run");
  });

  it("blocks makePayment when no read-back was spoken", async () => {
    const { call, model, backend } = setup({
      steps: [reply(use("makePayment", { quoteId: "invented" })), reply(text("Let me set that up first."))],
    });
    await call.say("Just pay it.");
    expect(lastToolResult(model.requests[1]).error?.kind).toBe("confirmation_required");
    expect(backend.fetchCount).toBe(0);
  });

  it("refuses to pay an older quote after a newer read-back", async () => {
    const quoteIds: string[] = [];
    const { call, session, backend, model } = setup({
      steps: [
        reply(use("preparePayment", { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" })),
        () => {
          quoteIds.push(newestQuote(session));
          return reply(use("preparePayment", { loanId: "L1001", amountCents: 30_000, linkedAccountId: "A1" }));
        },
        () => reply(use("makePayment", { quoteId: quoteIds[0] })), // the first, superseded quote
        reply(text("Sorry, let me confirm that again.")),
      ],
    });
    await call.say("Pay the amount due.");
    await call.say("Actually make it three hundred.");
    await call.say("Yes.");
    expect(backend.store.payments).toHaveLength(0);
    expect(lastToolResult(model.requests[3]).error?.kind).toBe("confirmation_required");
  });

  it("transfers, without a new quote, when the payment result is ambiguous (M3 risk)", async () => {
    const { call, session, backend, model } = setup({
      steps: [
        reply(use("preparePayment", { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" })),
        () => reply(use("makePayment", { quoteId: newestQuote(session) })),
        reply(text("Customer wanted to pay the amount due on L1001 from First Harbor; the payment result is unknown.")),
      ],
    });
    const realFetch = session.api.fetchImpl;
    session.api = {
      ...session.api,
      fetchImpl: (input, init) =>
        String(input).endsWith("/v1/payments") && init?.method === "POST"
          ? Promise.reject(new TypeError("socket hang up"))
          : realFetch!(input, init), // set by createTestBackend
    };
    await call.say("Pay the amount due.");
    const out = await call.say("Yes.");

    expect(out.ended).toBe(true);
    expect(verbatimIds(out)).toEqual(["transfer_notice"]);
    const rec = call.record();
    // Code decided the transfer; the model only wrote the narrative, and code's facts are attached.
    expect(rec.handoff).toMatchObject({ reason: "tool_failure", queue: "customer_care", summaryBy: "model_and_code" });
    expect(rec.handoff?.summary).toContain("Customer wanted to pay the amount due");
    expect(rec.handoff?.summary).toContain("[System facts: Payment status unknown");
    expect(rec.handoff?.summary).toContain("makePayment failed (network)");
    // The third request asked for the summary only; the model never got a turn to re-quote.
    const summaryRequest = model.requests[2]?.messages;
    expect(summaryRequest?.at(-1)?.role).toBe("system");
    const closing = summaryRequest?.at(-2)?.content;
    expect(Array.isArray(closing) && closing.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(backend.store.payments).toHaveLength(0);
  });
});

describe("tier gating (SPEC §5)", () => {
  it("does not run a Tier 1 tool for an unverified caller, and makes no backend call", async () => {
    const { call, model, backend } = setup({
      phone: null,
      steps: [reply(use("getLoanDetails", { loanId: "L1001" })), reply(text("I need to verify you first."))],
    });
    await call.say("What do I owe on L1001?");
    expect(lastToolResult(model.requests[1])).toEqual({ ok: false, error: { kind: "auth_required", requiredTier: 1 } });
    expect(backend.fetchCount).toBe(0);
  });

  it("does not run a tool the journey does not list, even if the catalog has it", async () => {
    const { call, model, backend } = setup({
      steps: [reply(use("updateAutopay", { loanId: "L1001", enabled: false })), reply(text("I can't do that here."))],
    });
    await call.say("Turn off autopay.");
    expect(lastToolResult(model.requests[1]).error?.kind).toBe("unknown_tool");
    expect(backend.fetchCount).toBe(0);
  });

  it("rejects input that does not match the tool schema", async () => {
    const { call, model } = setup({
      steps: [
        reply(use("preparePayment", { loanId: "L1001", amountCents: 214.5, linkedAccountId: "A1" })),
        reply(text("How much would you like to pay?")),
      ],
    });
    await call.say("Pay 214.50.");
    expect(lastToolResult(model.requests[1]).error?.kind).toBe("invalid_input");
  });
});

describe("on_loan_identified (Q6)", () => {
  it("says the past-due notice once, before the first loan tool runs", async () => {
    const { call } = setup({
      phone: JORDAN,
      steps: [
        reply(use("getLoanDetails", { loanId: "L1002" })),
        reply(text("Your loan is past due.")),
        reply(use("listLinkedAccounts", { loanId: "L1002" })),
        reply(text("You have one account on file.")),
      ],
    });
    const first = await call.say("What's going on with L1002?");
    expect(first.utterances.map((u) => (u.kind === "verbatim" ? u.lineId : "agent"))).toEqual(["delinquent_notice", "agent"]);
    const second = await call.say("Which accounts can I pay from?");
    expect(verbatimIds(second)).toEqual([]);
  });

  it("says nothing for a loan that is not past due", async () => {
    const { call } = setup({ steps: [reply(use("getLoanDetails", { loanId: "L1001" })), reply(text("You're current."))] });
    expect(verbatimIds(await call.say("How is L1001?"))).toEqual([]);
  });

  it("fails closed to a human when the status lookup fails", async () => {
    const { call, session, model } = setup({ phone: JORDAN, steps: [reply(use("listLinkedAccounts", { loanId: "L1002" }))] });
    const realFetch = session.api.fetchImpl;
    session.api = {
      ...session.api,
      fetchImpl: (input, init) =>
        String(input).endsWith("/graphql") ? Promise.reject(new TypeError("connection reset")) : realFetch!(input, init), // set by createTestBackend
    };
    const out = await call.say("Which accounts are on L1002?");
    expect(out.ended).toBe(true);
    expect(verbatimIds(out)).toEqual(["transfer_notice"]);
    expect(call.record().toolCalls).toEqual([expect.objectContaining({ name: "listLinkedAccounts", executed: false })]);
    expect(model.requests).toHaveLength(2); // the second asks for the handoff summary (script empty: code summary)
    expect(call.record().handoff?.summaryBy).toBe("code");
  });
});

describe("never_say and amount guardrails (Q10)", () => {
  it("asks for one rewrite; the blocked reply never reaches the caller or the history", async () => {
    const { call, model } = setup({
      steps: [reply(text("We guarantee your credit score will go up.")), reply(text("I can't promise anything about your credit score."))],
    });
    const out = await call.say("Will paying help my credit?");
    expect(out.utterances.map((u) => u.text)).toEqual(["I can't promise anything about your credit score."]);
    const retry = model.requests[1]?.messages;
    expect(retry?.at(-1)?.role).toBe("system");
    expect(retry?.some((m) => m.role === "assistant")).toBe(false);
    expect(call.record().guardrailEvents).toEqual([{ kind: "never_say", action: "rewrite" }]);
  });

  it("falls back to a safe line when the rewrite is blocked too", async () => {
    const { call } = setup({
      steps: [reply(text("I'll waive the late fee.")), reply(text("Fine, I can waive that fee for you."))],
    });
    const out = await call.say("Can you drop the late fee?");
    expect(out.utterances.map((u) => u.text)).toEqual([FALLBACK_LINE]);
    expect(call.record().guardrailEvents.map((e) => e.action)).toEqual(["rewrite", "fallback"]);
  });

  it("blocks amounts stated in digits", async () => {
    const { call } = setup({
      steps: [reply(text("You owe $214.50.")), reply(text("You owe two hundred fourteen dollars and fifty cents."))],
    });
    await call.say("How much do I owe?");
    expect(call.record().guardrailEvents).toEqual([{ kind: "amount_from_code_only", action: "rewrite" }]);
  });
});

describe("handoff (Q8)", () => {
  it("fills every field but the summary from code, and routes by reason", async () => {
    const { call } = setup({
      phone: JORDAN,
      steps: [reply(text("Let me connect you."), use("transferToHuman", { reason: "delinquent", summary: "Caller is behind and wants options." }))],
    });
    const out = await call.say("I can't pay this month, what can I do?");
    expect(out.ended).toBe(true);
    expect(out.utterances.map((u) => (u.kind === "verbatim" ? u.lineId : u.text))).toEqual(["Let me connect you.", "transfer_notice"]);
    const rec = call.record();
    expect(rec.handoff).toEqual({
      callId: rec.callId,
      journeyId: "make-payment",
      journeyVersion: makePayment.version,
      reason: "delinquent",
      queue: "collections",
      authTier: 1,
      verifiedBy: "caller_id",
      loanId: null,
      summary: "Caller is behind and wants options.",
      summaryBy: "model",
    });
    expect(rec.outcome).toBe("transferred");
    await expect(call.say("Hello?")).rejects.toThrow("ended");
  });

  it("routes an SMS outage to customer care, not fraud review", async () => {
    const { call, session, backend } = setup({ phone: null, steps: [reply(use("sendStepUpCode", { loanId: "L1001" }))] });
    await backend.setFlags(session, ["sms_unavailable"]);
    const out = await call.say("My loan is L1001.");
    expect(out.ended).toBe(true);
    expect(call.record().handoff).toMatchObject({ reason: "tool_failure", queue: "customer_care", verifiedBy: "none", authTier: 0 });
    // A code-written summary still gives the human the context, all from the record.
    const summary = call.record().handoff?.summary ?? "";
    expect(summary).toContain('Caller said: "My loan is L1001."');
    expect(summary).toContain("sendStepUpCode failed (step_up_transfer)");
    expect(summary).toContain("not verified; no account details were shared");
  });

  it("routes too many wrong codes to fraud review", async () => {
    const { call, backend } = setup({
      phone: null,
      steps: [
        reply(use("sendStepUpCode", { loanId: "L1001" })),
        reply(text("Please read me the code.")),
        reply(use("checkStepUpCode", { code: "000000" })),
        reply(text("That didn't match.")),
        reply(use("checkStepUpCode", { code: "111111" })),
      ],
    });
    await call.say("My loan is L1001.");
    await call.say("000000");
    const out = await call.say("111111");
    expect(out.ended).toBe(true);
    expect(call.record().handoff).toMatchObject({ reason: "step_up_failed", queue: "fraud_review" });
    expect(backend.store.stepUp.size).toBe(1);
  });

  it.each<[string, ModelReply | Error]>([
    ["the model API throws", new Error("overloaded")],
    ["the model refuses", { ...reply(text("")), stopReason: "refusal" }],
    ["the reply is cut off", { ...reply(text("Your payment of")), stopReason: "max_tokens" }],
  ])("fails closed to a human when %s", async (_name, result) => {
    const backend = createTestBackend();
    const model: Model = async () => {
      if (result instanceof Error) throw result;
      return result;
    };
    const call = createCall({ journey: journey(), channel: "voice", session: backend.session({ verifiedPhone: MAYA }), model, articles });
    const out = await call.say("Hi");
    expect(out.ended).toBe(true);
    expect(call.record().handoff).toMatchObject({ reason: "agent_error", summaryBy: "code" });
    expect(out.utterances.map((u) => u.text)).not.toContain("Your payment of");
  });

  it("rethrows a caller cancel instead of transferring", async () => {
    const backend = createTestBackend();
    const controller = new AbortController();
    const model: Model = async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    const call = createCall({
      journey: journey(),
      channel: "voice",
      session: backend.session({ verifiedPhone: MAYA }),
      model,
      articles,
      signal: controller.signal,
    });
    await expect(call.say("Hi")).rejects.toThrow("aborted");
    expect(call.record().handoff).toBeNull();
  });
});

describe("knowledge (SPEC §8.6)", () => {
  it("lets a Tier 0 caller search, and hands the articles to the model", async () => {
    const { call, model } = setup({
      phone: null,
      steps: [reply(use("searchKnowledge", { query: "when does a payment post" })), reply(text("Usually the same business day."))],
    });
    await call.say("When will my payment post?");
    const result = lastToolResult(model.requests[1]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.data)).toContain("payment-posting");
  });
});

describe("ending", () => {
  it("endCall resolves the call", async () => {
    const { call } = setup({ steps: [reply(text("Goodbye!"), use("endCall", {}))] });
    const out = await call.say("That's all, thanks.");
    expect(out.ended).toBe(true);
    expect(call.record()).toMatchObject({ endReason: "end_call", outcome: "resolved", handoff: null });
  });

  it("stops after the caller-turn limit without calling the model", async () => {
    const { call, model } = setup({ maxCallerTurns: 1, steps: [reply(text("Hi."))] });
    await call.say("Hello");
    const out = await call.say("Hello again");
    expect(out.ended).toBe(true);
    expect(call.record()).toMatchObject({ endReason: "max_turns", outcome: "abandoned" });
    expect(model.requests).toHaveLength(1);
  });

  it("transfers when the model keeps calling tools without answering", async () => {
    const loop = Array.from({ length: MAX_MODEL_STEPS_PER_TURN }, () => reply(use("searchKnowledge", { query: "hours" })));
    const { call, model } = setup({ steps: loop });
    const out = await call.say("Hours?");
    expect(out.ended).toBe(true);
    expect(model.requests).toHaveLength(MAX_MODEL_STEPS_PER_TURN);
    expect(call.record().handoff?.reason).toBe("agent_error");
  });

  it("hangUp ends the call as resolved", async () => {
    const { call } = setup({ steps: [] });
    call.hangUp();
    expect(call.record()).toMatchObject({ endReason: "caller_hangup", outcome: "resolved" });
  });
});

describe("structured log events (SPEC §11)", () => {
  it("logs start, each tool, guardrails, each turn and the end, all tagged with the journey version", async () => {
    const backend = createTestBackend();
    const events: CallEvent[] = [];
    const call = createCall({
      journey: journey(),
      channel: "voice",
      session: backend.session({ verifiedPhone: MAYA }),
      model: scripted([
        reply(use("getLoanDetails", { loanId: "L1001" })),
        reply(text("We guarantee approval.")),
        reply(text("Your loan is current."), use("transferToHuman", { reason: "caller_requested", summary: "Wants a person." })),
      ]),
      articles,
      log: (e) => events.push(e),
    });
    await call.open();
    await call.say("How is my loan? Then a person, please.");

    expect(events.map((e) => e.event)).toEqual(["call_started", "tool", "guardrail", "tool", "turn", "call_ended"]);
    expect(events.every((e) => e.journeyVersion === makePayment.version && e.callId === call.record().callId)).toBe(true);
    expect(events[1]).toMatchObject({ event: "tool", tool: "getLoanDetails", ok: true, executed: true, tier: 1 });
    expect(events.at(-1)).toMatchObject({ event: "call_ended", endReason: "transfer", outcome: "transferred", transferReason: "caller_requested" });
  });
});
