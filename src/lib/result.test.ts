import { describe, expect, expectTypeOf, it } from "vitest";
import { err, ok, type Result } from "./result.js";

describe("Result", () => {
  it("ok() builds the success variant", () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it("err() builds the failure variant", () => {
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("narrows on `ok` (compile-time check, runs under `npm run typecheck`)", () => {
    const r: Result<number, string> = Math.random() > 2 ? err("x") : ok(1);
    if (r.ok) {
      expectTypeOf(r.data).toEqualTypeOf<number>();
    } else {
      expectTypeOf(r.error).toEqualTypeOf<string>();
    }
  });
});
