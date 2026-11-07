import { describe, expect, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { reply, scripted, text, use } from "../journey/fakeModel.js";
import { parseJourney, type Journey } from "../journey/schema.js";
import { loadKnowledge } from "../tools/searchKnowledge.js";
import { HANGUP, runSim, type Caller, type Judge, type TranscriptLine, type Verdict } from "./runSim.js";
import { Scenario, type ScenarioInput } from "./scenario.js";

const articles = loadKnowledge("knowledge");
const usage = { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 };

function journey(): Journey {
  const res = parseJourney(makePayment);
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data;
}

const scenario = (over: Partial<ScenarioInput> & Pick<ScenarioInput, "expect">) =>
  Scenario.parse({ id: "s", persona: "p", goal: "g", session: { verifiedPhone: "+14155550101" }, safetyCritical: true, ...over });

// A caller that says its lines in order (or computes one from the transcript), and rates the call 4.
function caller(lines: Array<string | ((t: TranscriptLine[]) => string)>): Caller & { seen: TranscriptLine[][] } {
  const seen: TranscriptLine[][] = [];
  return {
    seen,
    async next(_s, transcript) {
      seen.push(structuredClone(transcript));
      const line = lines.shift() ?? HANGUP;
      return { value: typeof line === "function" ? line(transcript) : line, usage };
    },
    async rate() {
      return { value: { reason: "Quick and clear.", rating: 4 }, usage };
    },
  };
}

function judge(verdicts: { hallucination?: Verdict; transferQuality?: Verdict } = {}): Judge & { calls: string[] } {
  const ok: Verdict = { reason: "Supported by the tool results.", passed: true, issues: [] };
  const calls: string[] = [];
  return {
    calls,
    async hallucination() {
      calls.push("hallucination");
      return { value: verdicts.hallucination ?? ok, usage };
    },
    async transferQuality() {
      calls.push("transfer_quality");
      return { value: verdicts.transferQuality ?? ok, usage };
    },
  };
}

describe("runSim", () => {
  it("runs a happy payment end to end and passes", async () => {
    const j = judge();
    const result = await runSim({
      scenario: scenario({ expect: { outcome: "resolved", mustCallTools: ["makePayment"], succeededPayments: 1 } }),
      run: 1,
      journey: journey(),
      articles,
      agent: scripted([
        reply(use("preparePayment", { loanId: "L1001", amountCents: 21_450, linkedAccountId: "A1" })),
        (req) => {
          const last = req.messages.at(-1);
          const block = Array.isArray(last?.content) ? last.content.find((b) => b.type === "tool_result") : undefined;
          const body = block?.type === "tool_result" && typeof block.content === "string" ? JSON.parse(block.content) : {};
          return reply(use("makePayment", { quoteId: body.data.quoteId }));
        },
        reply(text("Done. Anything else?")),
        reply(text("Goodbye."), use("endCall", {})),
      ]),
      caller: caller(["Pay the amount due from First Harbor.", "Yes.", "No, bye."]),
      judge: j,
    });

    expect(result.error).toBeNull();
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.record.outcome).toBe("resolved");
    expect(result.csat).toEqual({ reason: "Quick and clear.", rating: 4 });
    expect(j.calls).toEqual(["hallucination"]); // no transfer, no transfer-quality judgment
    expect(result.usage.caller.inputTokens).toBe(40); // 4 caller turns incl. the rating
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("shows the texted code to the caller only when their phone is at hand (%s)", async (receives, smsLines) => {
    const c = caller(["My loan is L1001.", "Okay."]);
    await runSim({
      scenario: scenario({ session: { verifiedPhone: null, callerReceivesSms: receives }, expect: { outcome: "resolved" } }),
      run: 1,
      journey: journey(),
      articles,
      agent: scripted([reply(use("sendStepUpCode", { loanId: "L1001" })), reply(text("Please read me the code.")), reply(text("Okay."))]),
      caller: c,
      judge: judge(),
    });
    const lastSeen = c.seen.at(-1) ?? [];
    expect(lastSeen.filter((l) => l.speaker === "sms")).toHaveLength(smsLines);
  });

  it("judges transfer quality on a transferred call, and fails the run on a bad verdict", async () => {
    const j = judge({ transferQuality: { reason: "Summary invents a promise.", passed: false, issues: ["invented callback"] } });
    const result = await runSim({
      scenario: scenario({ expect: { outcome: "transferred" } }),
      run: 1,
      journey: journey(),
      articles,
      agent: scripted([reply(use("transferToHuman", { reason: "caller_requested", summary: "Wants a person; promised a callback." }))]),
      caller: caller(["Let me talk to a person."]),
      judge: j,
    });
    expect(j.calls).toEqual(["hallucination", "transfer_quality"]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.judgments.find((x) => x.kind === "transfer_quality")?.issues).toEqual(["invented callback"]);
  });

  it("says the caller's last words before hanging up", async () => {
    const agent = scripted([reply(text("You're welcome."))]);
    const result = await runSim({
      scenario: scenario({ expect: { outcome: "resolved" } }),
      run: 1,
      journey: journey(),
      articles,
      agent,
      caller: caller([`Thanks, bye. ${HANGUP}`]),
      judge: judge(),
    });
    expect(agent.requests).toHaveLength(1);
    expect(result.record).toMatchObject({ endReason: "caller_hangup", outcome: "resolved" });
  });

  it("marks the run failed, with the error, when the harness itself fails", async () => {
    const broken: Judge = {
      hallucination: async () => {
        throw new Error("judge overloaded");
      },
      transferQuality: async () => {
        throw new Error("unused");
      },
    };
    const result = await runSim({
      scenario: scenario({ expect: { outcome: "resolved" } }),
      run: 1,
      journey: journey(),
      articles,
      agent: scripted([reply(text("Hi."))]),
      caller: caller(["Hello.", HANGUP]),
      judge: broken,
    });
    expect(result.error).toBe("judge overloaded");
    expect(result.passed).toBe(false);
  });
});
