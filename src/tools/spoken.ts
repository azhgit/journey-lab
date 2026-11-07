// HUMAN-OWNED (M3), written by Claude at Andrew's request. Tests: src/tools/spoken.test.ts
// Code-owned speech for facts the model must not format itself. SPEC §8.3.

const UNDER_20 = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MAX_CENTS = 99_999_999_999;

// 0–99. 21–99 are hyphenated ("sixty-eight").
function sayUnder100(n: number): string {
  if (n < 20) return UNDER_20[n] as string;
  const tens = TENS[Math.floor(n / 10)] as string;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${UNDER_20[ones]}`;
}

// 0–999. No "and" after hundred: US English ("one hundred nineteen").
function sayUnder1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return sayUnder100(rest);
  const head = `${UNDER_20[hundreds]} hundred`;
  return rest === 0 ? head : `${head} ${sayUnder100(rest)}`;
}

// 1–999,999,999. Zero groups are skipped so we never say "zero thousand".
function sayWhole(n: number): string {
  const groups: Array<[number, string]> = [
    [Math.floor(n / 1_000_000), " million"],
    [Math.floor(n / 1_000) % 1_000, " thousand"],
    [n % 1_000, ""],
  ];
  return groups
    .filter(([value]) => value > 0)
    .map(([value, scale]) => sayUnder1000(value) + scale)
    .join(" ");
}

// "" for zero, so the caller can drop that part entirely.
function sayUnit(n: number, singular: string, plural: string): string {
  if (n === 0) return "";
  return n === 1 ? `one ${singular}` : `${sayWhole(n)} ${plural}`;
}

// Integer cents → words. 21450 → "two hundred fourteen dollars and fifty cents".
// Bad input is a programmer error (the tools always pass integer cents), so it throws instead of returning a Result.
export function spokenAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS) {
    throw new RangeError(`spokenAmount: expected integer cents in [0, ${MAX_CENTS}], got ${cents}`);
  }
  const parts = [
    sayUnit(Math.floor(cents / 100), "dollar", "dollars"),
    sayUnit(cents % 100, "cent", "cents"),
  ].filter((part) => part !== "");
  return parts.length === 0 ? "zero dollars" : parts.join(" and ");
}

// "2026-11-14" → "Saturday, November 14". A date-only ISO string parses as UTC midnight, and formatting
// in UTC keeps the weekday stable no matter the server's timezone.
export function spokenDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// "4821" → "four eight two one". Digit by digit, so TTS never says "forty-eight twenty-one".
export function spokenDigits(digits: string): string {
  return digits
    .split("")
    .map((ch) => UNDER_20[Number(ch)])
    .join(" ");
}
