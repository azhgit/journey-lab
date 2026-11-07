import { describe, expect, it } from "vitest";
import { provenance, sentences, spokenIn, type SpokenSource } from "./provenance.js";

const loan: SpokenSource = {
  seq: 0,
  name: "getLoanDetails",
  spoken: ["Your loan is current. Your next payment of two hundred fourteen dollars and fifty cents is due Saturday, November 14."],
};
const accounts: SpokenSource = {
  seq: 1,
  name: "listLinkedAccounts",
  spoken: ["The accounts on file are First Harbor Bank ending in four eight two one."],
};

describe("spokenIn", () => {
  it("finds spoken text at any depth, including a decline's", () => {
    const result = { ok: false, error: { kind: "payment_failed", spoken: "That payment was declined." }, spokenToCustomer: "Shall I go ahead?" };
    expect(spokenIn(result).sort()).toEqual(["Shall I go ahead?", "That payment was declined."]);
  });

  it("ignores empty and non-string values", () => {
    expect(spokenIn({ spoken: "", data: { spoken: 3 } })).toEqual([]);
  });
});

describe("sentences", () => {
  it("splits on sentence ends and drops short fragments", () => {
    expect(sentences("Thanks. Your loan is current. Is that right?")).toEqual(["Your loan is current.", "Is that right?"]);
  });
});

describe("provenance", () => {
  it("marks a tool's sentences and leaves the model's words as model", () => {
    const text = `Thanks, Ms. Chen. ${loan.spoken[0]}\n\n${accounts.spoken[0]}\n\nWhich account would you like to use?`;
    const { spans, cursor } = provenance(text, [loan, accounts]);
    expect(spans.map((s) => [s.from.kind === "tool" ? s.from.name : "model", s.text])).toEqual([
      ["model", "Thanks, Ms. Chen. "],
      ["getLoanDetails", loan.spoken[0]],
      ["model", "\n\n"],
      ["listLinkedAccounts", accounts.spoken[0]],
      ["model", "\n\nWhich account would you like to use?"],
    ]);
    expect(cursor).toBe(1);
    expect(spans.map((s) => s.text).join("")).toBe(text);
  });

  it("treats a paraphrase as the model's language", () => {
    const { spans } = provenance("You owe two hundred and fourteen fifty by the fourteenth.", [loan]);
    expect(spans).toEqual([{ text: "You owe two hundred and fourteen fifty by the fourteenth.", from: { kind: "model" } }]);
  });

  it("prefers the source at or after the cursor when two tools said the same sentence", () => {
    const later: SpokenSource = { seq: 4, name: "makePayment", spoken: ["Your loan is current."] };
    const { spans } = provenance("Your loan is current.", [loan, later], 2);
    expect(spans[0]?.from).toEqual({ kind: "tool", seq: 4, name: "makePayment" });
  });

  it("returns one model span for text with no sources", () => {
    expect(provenance("Hello there, how can I help?", []).spans).toEqual([{ text: "Hello there, how can I help?", from: { kind: "model" } }]);
  });
});
