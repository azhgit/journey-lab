import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armFor, bucket, candidatePercentFromEnv } from "./rollout.js";

describe("rollout (SPEC §12)", () => {
  it("is deterministic: the same call id always gets the same bucket", () => {
    fc.assert(fc.property(fc.string(), (id) => bucket(id) === bucket(id)));
  });

  it("buckets are 0–99", () => {
    fc.assert(fc.property(fc.string(), (id) => Number.isInteger(bucket(id)) && bucket(id) >= 0 && bucket(id) < 100));
  });

  it("is monotonic: raising the percent never moves a call off the candidate", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (id, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return armFor(id, low) !== "candidate" || armFor(id, high) === "candidate";
      }),
    );
  });

  it("0 sends everyone to stable and 100 everyone to candidate (rollback and full rollout)", () => {
    fc.assert(fc.property(fc.string(), (id) => armFor(id, 0) === "stable" && armFor(id, 100) === "candidate"));
  });

  it("splits roughly by the percent", () => {
    const ids = Array.from({ length: 5_000 }, (_, i) => `call-${i}`);
    const share = ids.filter((id) => armFor(id, 20) === "candidate").length / ids.length;
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });

  it.each([-1, 101, 2.5, Number.NaN])("rejects a bad percent (%s) instead of guessing", (p) => {
    expect(() => armFor("x", p)).toThrow(RangeError);
  });

  it("reads CANDIDATE_PERCENT, defaulting to 0", () => {
    expect(candidatePercentFromEnv({})).toBe(0);
    expect(candidatePercentFromEnv({ CANDIDATE_PERCENT: "20" })).toBe(20);
  });
});
