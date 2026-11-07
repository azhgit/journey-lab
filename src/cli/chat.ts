// CLAUDE-OWNED (M6). Manual chat with the real agent model against the in-process mock backend.
//   npm run chat -- --phone +14155550101            Tier 1 as Maya (L1001)
//   npm run chat -- --channel voice --flags timeout
//   npm run chat                                     Tier 0: knowledge answers, or step-up by text code
// Type /quit to hang up. Step-up codes are printed by the mock sender (fake SMS).
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { makePayment } from "../../journeys/make-payment.js";
import { makePaymentCandidate } from "../../journeys/make-payment.candidate.js";
import { armFor, candidatePercentFromEnv } from "../rollout.js";
import { anthropicModel } from "../journey/anthropic.js";
import type { ChannelName } from "../journey/prompt.js";
import { createCall, type Utterance } from "../journey/runner.js";
import { Channel, parseJourney } from "../journey/schema.js";
import { INITIAL } from "../journey/stepup.js";
import { createApp } from "../mock-api/app.js";
import { SCENARIO_FLAGS, type ScenarioFlag } from "../mock-api/types.js";
import { parseE164 } from "../tools/brand.js";
import type { Session } from "../tools/context.js";
import { loadKnowledge } from "../tools/searchKnowledge.js";
import { fileCallLog } from "../lib/logger.js";

const API_KEY = "cli-key";

const { values } = parseArgs({
  options: {
    phone: { type: "string" },
    channel: { type: "string", default: "chat" },
    flags: { type: "string", default: "" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const channel: ChannelName = Channel.safeParse(values.channel).data ?? fail(`unknown channel: ${values.channel}`);
const phone = values.phone === undefined ? null : (parseE164(values.phone) ?? fail(`not an E.164 phone: ${values.phone}`));
const flags = values.flags
  .split(",")
  .filter((f) => f !== "")
  .map((f): ScenarioFlag => SCENARIO_FLAGS.find((known) => known === f) ?? fail(`unknown flag: ${f}`));


const { app, store } = createApp({ apiKey: API_KEY, testRoutes: true, hangMs: 8_000 });
const sessionId = `cli-${Date.now().toString(36)}`;
// Staged rollout (SPEC §12): CANDIDATE_PERCENT=0 is the rollback switch.
const arm = armFor(sessionId, candidatePercentFromEnv());
const journey = parseJourney(arm === "candidate" ? makePaymentCandidate : makePayment);
if (!journey.ok) fail(`journey is invalid: ${JSON.stringify(journey.error, null, 2)}`);

const session: Session = {
  id: sessionId,
  verifiedPhone: phone,
  stepUpVerifiedLoanId: null,
  stepUp: INITIAL,
  quotes: new Map(),
  now: Date.now,
  api: { baseUrl: "http://mock.local", apiKey: API_KEY, timeoutMs: 3_000, fetchImpl: (input, init) => Promise.resolve(app.fetch(new Request(input, init))) },
};
await app.request(`/__test/scenarios/${session.id}`, {
  method: "PUT",
  headers: { "x-api-key": API_KEY, "content-type": "application/json" },
  body: JSON.stringify({ flags }),
});

const call = createCall({
  journey: journey.data,
  channel,
  session,
  model: anthropicModel({ model: process.env.AGENT_MODEL ?? "claude-haiku-5-5" }),
  articles: loadKnowledge("knowledge"),
  log: fileCallLog("logs/calls.jsonl"),
});

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
function show(utterances: Utterance[]): void {
  for (const u of utterances) console.log(u.kind === "verbatim" ? `agent ${dim(`[verbatim:${u.lineId}]`)} ${u.text}` : `agent  ${u.text}`);
}

// The mock SMS: show each code the backend would have texted, once.
const shownCodes = new Set<string>();
function showSentCodes(): void {
  for (const [loanId, rec] of store.stepUp) {
    if (shownCodes.has(rec.code)) continue;
    shownCodes.add(rec.code);
    console.log(dim(`(fake sms to the phone on file for ${loanId}: ${rec.code})`));
  }
}

console.log(dim(`journey ${journey.data.id}@${journey.data.version} (${arm}) · ${channel} · ${phone === null ? "Tier 0" : `verified ${phone}`}${flags.length > 0 ? ` · flags ${flags.join(",")}` : ""}`));
show((await call.open()).utterances);

// An async iterator buffers lines, so piped input (a scripted demo) works as well as typing.
const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
for (;;) {
  process.stdout.write("you    ");
  const next = await lines.next();
  if (next.done === true) {
    call.hangUp();
    break;
  }
  const line = next.value.trim();
  if (!process.stdin.isTTY) console.log(line);
  if (line === "/quit") {
    call.hangUp();
    break;
  }
  if (line === "") continue;
  const out = await call.say(line);
  show(out.utterances);
  showSentCodes();
  if (out.ended) break;
}
rl.close();

const rec = call.record();
console.log(dim(`\noutcome ${rec.outcome} (${rec.endReason}) · ${rec.callerTurns} caller turns · tokens in ${rec.usage.inputTokens} (+${rec.usage.cacheWriteTokens} cache write, ${rec.usage.cacheReadTokens} cache read) / out ${rec.usage.outputTokens}`));
console.log(dim(`tools: ${rec.toolCalls.map((t) => `${t.name}${t.executed ? (t.ok ? "" : `!${t.errorKind}`) : `⊘${t.errorKind}`}`).join(", ") || "none"}`));
if (rec.handoff !== null) console.log(dim(`handoff: ${JSON.stringify(rec.handoff, null, 2)}`));
if (store.payments.length > 0) console.log(dim(`payments: ${JSON.stringify(store.payments.map((p) => [p.amountCents, p.status]))}`));
