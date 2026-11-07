import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("runs on Node 22+ with AbortSignal.any and AbortSignal.timeout", () => {
    expect(typeof AbortSignal.any).toBe("function");
    expect(typeof AbortSignal.timeout).toBe("function");
  });
});
