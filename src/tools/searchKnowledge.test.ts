import { describe, expect, it } from "vitest";
import { loadKnowledge, searchKnowledge } from "./searchKnowledge.js";

const articles = loadKnowledge("knowledge");
const ids = (query: string) => searchKnowledge(articles, query).matches.map((a) => a.id);

describe("loadKnowledge", () => {
  it("reads every article with an id, a title and a body", () => {
    expect(articles.length).toBeGreaterThanOrEqual(6);
    for (const a of articles) {
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.title.startsWith("#")).toBe(false);
      expect(a.text.length).toBeGreaterThan(0);
    }
  });
});

describe("searchKnowledge", () => {
  it.each([
    ["When will my payment post?", "payment-posting"],
    ["What are your business hours on Saturday?", "business-hours"],
    ["How does autopay work?", "autopay"],
    ["My bank declined the payment, what happens now?", "declined-payment"],
    ["Can I change my linked bank account?", "update-linked-account"],
    ["Is there a late fee?", "late-fees"],
  ])("finds the right article first: %s", (query, id) => {
    expect(ids(query)[0]).toBe(id);
  });

  it("returns at most two articles", () => {
    expect(ids("autopay payment posting declined late fee hours").length).toBeLessThanOrEqual(2);
  });

  // Scenario 9: the agent must not answer this from a loosely related article.
  it.each(["Do you have hardship programs?", "Can I defer my loan?", "What is the meaning of life?"])(
    "returns no match when no article covers it: %s",
    (query) => {
      expect(ids(query)).toEqual([]);
    },
  );

  it("generic words alone match nothing", () => {
    expect(ids("my loan payment")).toEqual([]);
  });
});
