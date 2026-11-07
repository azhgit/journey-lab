import { describe, expect, expectTypeOf, it } from "vitest";
import { newQuoteId, parseE164 } from "./brand.js";
import type { E164, QuoteId } from "./context.js";

describe("parseE164", () => {
  it.each(["+14155550101", "+447911123456", "+12"])("accepts %s", (raw) => {
    expect(parseE164(raw)).toBe(raw);
  });

  it.each(["4155550101", "+04155550101", "+1 415 555 0101", "+1415555010112345", "", "+"])("rejects %j", (raw) => {
    expect(parseE164(raw)).toBeNull();
  });

  it("returns the branded type (compile-time check)", () => {
    expectTypeOf(parseE164).returns.toEqualTypeOf<E164 | null>();
    // @ts-expect-error a plain string is not an E164
    const notBranded: E164 = "+14155550101";
    void notBranded;
  });
});

describe("newQuoteId", () => {
  it("is unique and non-trivial", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newQuoteId()));
    expect(ids.size).toBe(1000);
    expect([...ids][0]?.length).toBeGreaterThanOrEqual(16);
    expectTypeOf(newQuoteId).returns.toEqualTypeOf<QuoteId>();
  });
});
