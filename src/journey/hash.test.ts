import { describe, expect, it } from "vitest";
import { makePayment } from "../../journeys/make-payment.js";
import { checkVersion, journeyHash } from "./hash.js";
import { parseJourney, type Journey, type JourneyInput } from "./schema.js";

function parsed(input: JourneyInput): Journey {
  const res = parseJourney(input);
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data;
}

const base = parsed(makePayment);

describe("journeyHash (Q13)", () => {
  it("is stable for the same journey, whatever the key order", () => {
    const reordered = parsed({ ...structuredClone(makePayment), handoff: { routes: makePayment.handoff.routes, defaultQueue: "customer_care" } });
    expect(journeyHash(base)).toBe(journeyHash(parsed(structuredClone(makePayment))));
    expect(journeyHash(reordered)).toBe(journeyHash(base));
  });

  it("changes when the instructions change", () => {
    const edited = parsed({ ...structuredClone(makePayment), instructions: makePayment.instructions + "\nBe brief." });
    expect(journeyHash(edited)).not.toBe(journeyHash(base));
  });

  it("changes when a channel is added (a different prompt is composed)", () => {
    const edited = parsed({ ...structuredClone(makePayment), channels: ["chat"] });
    expect(journeyHash(edited)).not.toBe(journeyHash(base));
  });
});

describe("checkVersion (Q13)", () => {
  it("accepts a version seen for the first time, and the same content again", () => {
    expect(checkVersion(base, "abc", null)).toEqual({ ok: true, known: false });
    expect(checkVersion(base, "abc", "abc")).toEqual({ ok: true, known: true });
  });

  it("rejects new content under an old version", () => {
    const res = checkVersion(base, "def", "abc");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain(`make-payment@${base.version} changed`);
  });
});
