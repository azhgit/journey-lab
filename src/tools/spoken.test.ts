import { describe, expect, it } from "vitest";
import { spokenAmount, spokenDate, spokenDigits } from "./spoken.js";

describe("spokenAmount", () => {
  it.each([
    [21_450, "two hundred fourteen dollars and fifty cents"],
    [100, "one dollar"],
    [1, "one cent"],
    [5, "five cents"],
    [101, "one dollar and one cent"],
    [0, "zero dollars"],
    [2_105, "twenty-one dollars and five cents"],
    [1_000, "ten dollars"],
    [11_900, "one hundred nineteen dollars"],
    [43_900, "four hundred thirty-nine dollars"],
    [845_300, "eight thousand four hundred fifty-three dollars"],
    [1_236_800, "twelve thousand three hundred sixty-eight dollars"],
    [100_000_000, "one million dollars"],
    [100_100_099, "one million one thousand dollars and ninety-nine cents"],
    [12_345_678_901, "one hundred twenty-three million four hundred fifty-six thousand seven hundred eighty-nine dollars and one cent"],
  ])("%i → %s", (cents, words) => {
    expect(spokenAmount(cents)).toBe(words);
  });

  it.each([-1, 1.5, Number.NaN, 100_000_000_000])("throws RangeError for %d", (bad) => {
    expect(() => spokenAmount(bad)).toThrow(RangeError);
  });
});

describe("spokenDate", () => {
  it.each([
    ["2026-11-14", "Saturday, November 14"],
    ["2026-10-01", "Thursday, October 1"],
    ["2026-11-20", "Friday, November 20"],
    ["2026-01-05", "Monday, January 5"],
  ])("%s → %s", (iso, words) => {
    expect(spokenDate(iso)).toBe(words);
  });

  it("does not shift with the process timezone", () => {
    const before = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      expect(spokenDate("2026-11-14")).toBe("Saturday, November 14");
    } finally {
      // Assigning undefined to process.env stores the string "undefined", so delete instead.
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("spokenDigits", () => {
  it.each([
    ["4821", "four eight two one"],
    ["0937", "zero nine three seven"],
  ])("%s → %s", (digits, words) => {
    expect(spokenDigits(digits)).toBe(words);
  });
});
