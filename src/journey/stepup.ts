// HUMAN-OWNED (M4). Tests: src/journey/stepup.test.ts. SPEC §5, §8.4.
// Step-up limits live here, in code, never in the prompt. The runner (M6) feeds events in and
// acts on the resulting state; the model cannot talk its way past a limit.

export const MAX_SENDS = 2;
export const MAX_WRONG = 2;

export type State =
  | { readonly tag: "unverified" }
  | { readonly tag: "code_sent"; readonly loanId: string; readonly sends: number; readonly wrong: number }
  | { readonly tag: "verified"; readonly loanId: string }
  | { readonly tag: "transfer"; readonly reason: "too_many_sends" | "too_many_wrong" | "sms_unavailable" };

export type TransferReason = Extract<State, { tag: "transfer" }>["reason"];

export type Event =
  | { readonly type: "send_requested"; readonly loanId: string }
  | { readonly type: "send_failed" }
  | { readonly type: "code_checked"; readonly passed: boolean };

export const INITIAL: State = { tag: "unverified" };

// Pure reducer: never mutates `state`; returns a new object when something changes.
//
// unverified
//   send_requested(loanId) → code_sent { loanId, sends: 1, wrong: 0 }
//   send_failed            → transfer(sms_unavailable)
//   code_checked           → unverified (no code was sent, so nothing can pass: fail closed)
// code_sent
//   send_requested(loanId) → sends === MAX_SENDS ? transfer(too_many_sends)
//                            : code_sent { loanId (the new one), sends + 1, wrong unchanged }
//                            Counters never reset, even for a different loan: switching loans must
//                            not buy more attempts.
//   send_failed            → transfer(sms_unavailable)
//   code_checked(true)     → verified { loanId }
//   code_checked(false)    → wrong + 1 === MAX_WRONG ? transfer(too_many_wrong) : code_sent { wrong + 1 }
// verified, transfer
//   any event              → unchanged (terminal)
export function step(state: State, event: Event): State {
  switch (state.tag) {
    case "verified":
    case "transfer":
      return state;

    case "unverified":
      if (event.type === "send_requested") return { tag: "code_sent", loanId: event.loanId, sends: 1, wrong: 0 };
      if (event.type === "send_failed") return { tag: "transfer", reason: "sms_unavailable" };
      return state;

    case "code_sent":
      return fromCodeSent(state, event);

    default: {
      // Every tag is handled above, so `state` is `never` here. A new tag without a case fails to compile.
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function fromCodeSent(state: Extract<State, { tag: "code_sent" }>, event: Event): State {
  switch (event.type) {
    case "send_requested":
      if (state.sends >= MAX_SENDS) return { tag: "transfer", reason: "too_many_sends" };
      return { ...state, loanId: event.loanId, sends: state.sends + 1 };

    case "send_failed":
      return { tag: "transfer", reason: "sms_unavailable" };

    case "code_checked": {
      if (event.passed) return { tag: "verified", loanId: state.loanId };
      const wrong = state.wrong + 1;
      return wrong >= MAX_WRONG ? { tag: "transfer", reason: "too_many_wrong" } : { ...state, wrong };
    }

    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
