import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Event, INITIAL, MAX_SENDS, MAX_WRONG, type State, step } from "./stepup.js";

const send = (loanId = "L1001"): Event => ({ type: "send_requested", loanId });
const sendFailed: Event = { type: "send_failed" };
const pass: Event = { type: "code_checked", passed: true };
const fail: Event = { type: "code_checked", passed: false };

const sent = (sends: number, wrong: number, loanId = "L1001"): State => ({ tag: "code_sent", loanId, sends, wrong });

// Deep-freeze so any mutation inside step() throws (ESM is strict mode).
function frozen<T extends object>(value: T): T {
  for (const v of Object.values(value)) if (typeof v === "object" && v !== null) frozen(v);
  return Object.freeze(value);
}

const run = (events: Event[], from: State = INITIAL): State => events.reduce(step, from);

describe("step: transition table", () => {
  it.each<[string, State, Event, State]>([
    ["first send", INITIAL, send(), sent(1, 0)],
    ["send fails before any code", INITIAL, sendFailed, { tag: "transfer", reason: "sms_unavailable" }],
    ["check with no code sent fails closed", INITIAL, pass, INITIAL],
    ["resend under the limit", sent(1, 0), send(), sent(2, 0)],
    ["resend over the limit", sent(MAX_SENDS, 0), send(), { tag: "transfer", reason: "too_many_sends" }],
    ["resend for another loan keeps the counters", sent(1, 1), send("L1004"), sent(2, 1, "L1004")],
    ["send fails after a code was sent", sent(1, 0), sendFailed, { tag: "transfer", reason: "sms_unavailable" }],
    ["correct code", sent(1, 0), pass, { tag: "verified", loanId: "L1001" }],
    ["correct code verifies the latest loan", sent(2, 0, "L1004"), pass, { tag: "verified", loanId: "L1004" }],
    ["first wrong code", sent(1, 0), fail, sent(1, 1)],
    ["wrong code at the limit", sent(1, MAX_WRONG - 1), fail, { tag: "transfer", reason: "too_many_wrong" }],
  ])("%s", (_name, state, event, expected) => {
    expect(step(frozen(state), frozen(event))).toEqual(expected);
  });

  it.each<State>([
    { tag: "verified", loanId: "L1001" },
    { tag: "transfer", reason: "too_many_sends" },
    { tag: "transfer", reason: "too_many_wrong" },
    { tag: "transfer", reason: "sms_unavailable" },
  ])("terminal state %j ignores every event", (state) => {
    for (const event of [send(), send("L1004"), sendFailed, pass, fail]) {
      expect(step(frozen(state), event)).toEqual(state);
    }
  });
});

describe("step: whole calls", () => {
  it("send, wrong, resend, right → verified", () => {
    expect(run([send(), fail, send(), pass])).toEqual({ tag: "verified", loanId: "L1001" });
  });

  it("two wrong codes → transfer, and a later correct code does not rescue it", () => {
    expect(run([send(), fail, fail, pass])).toEqual({ tag: "transfer", reason: "too_many_wrong" });
  });

  it("three sends → transfer", () => {
    expect(run([send(), send(), send()])).toEqual({ tag: "transfer", reason: "too_many_sends" });
  });

  it("hopping between loans does not buy extra attempts", () => {
    expect(run([send("L1001"), fail, send("L1004"), fail])).toEqual({ tag: "transfer", reason: "too_many_wrong" });
  });
});

describe("step: types", () => {
  it("state is readonly (compile-time check)", () => {
    const s: Extract<State, { tag: "code_sent" }> = { tag: "code_sent", loanId: "L1001", sends: 1, wrong: 0 };
    // @ts-expect-error readonly: the reducer must build a new state, not edit this one
    s.sends = 2;
    expectTypeOf(step).returns.toEqualTypeOf<State>();
  });
});

// ---- properties: hold for ANY event sequence, not just the ones we thought of ----

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  fc.record({ type: fc.constant("send_requested" as const), loanId: fc.constantFrom("L1001", "L1004", "L9999") }),
  fc.constant(sendFailed),
  fc.record({ type: fc.constant("code_checked" as const), passed: fc.boolean() }),
);
const eventsArb = fc.array(eventArb, { maxLength: 30 });

// Calls `check(prev, event, next)` on every transition of the sequence.
function eachTransition(events: Event[], check: (prev: State, event: Event, next: State) => void): void {
  let state = INITIAL;
  for (const event of events) {
    const next = step(frozen(state), frozen(event));
    check(state, event, next);
    state = next;
  }
}

describe("step: properties", () => {
  it("verified is only entered from code_sent on a passed check, for that same loan", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        eachTransition(events, (prev, event, next) => {
          if (prev.tag === "verified" || next.tag !== "verified") return;
          expect(prev.tag).toBe("code_sent");
          expect(event).toEqual(pass);
          expect(prev.tag === "code_sent" && prev.loanId).toBe(next.loanId);
        });
      }),
    );
  });

  it("terminal states are never left", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        eachTransition(events, (prev, _event, next) => {
          if (prev.tag === "verified" || prev.tag === "transfer") expect(next).toEqual(prev);
        });
      }),
    );
  });

  it("counters stay inside the limits", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        eachTransition(events, (_prev, _event, next) => {
          if (next.tag !== "code_sent") return;
          expect(next.sends).toBeGreaterThanOrEqual(1);
          expect(next.sends).toBeLessThanOrEqual(MAX_SENDS);
          expect(next.wrong).toBeGreaterThanOrEqual(0);
          expect(next.wrong).toBeLessThan(MAX_WRONG);
        });
      }),
    );
  });

  it("no more than MAX_WRONG failed checks are ever accepted in one call", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        let counted = 0;
        eachTransition(events, (prev, event, _next) => {
          if (prev.tag === "code_sent" && event.type === "code_checked" && !event.passed) counted += 1;
        });
        expect(counted).toBeLessThanOrEqual(MAX_WRONG);
      }),
    );
  });
});
