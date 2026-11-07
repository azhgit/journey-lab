// CLAUDE-OWNED (M6). SPEC §8.6. Keyword search over knowledge/*.md. Retrieval quality is not the point;
// the failure mode is: with no match the agent must say so and offer a human (knowledge_gap).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Article = { id: string; title: string; text: string };
export type KnowledgeMatches = { matches: Article[] };

const MAX_MATCHES = 2;

const STOPWORDS = new Set(
  ("a an and are be by can do does for from have how i if in is it me my of on or our the this to " +
    "was we what when where which who why will with you your about any there").split(" "),
);

// Lowercase words, crude plural strip ("posts" → "post"), no stopwords.
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

// First line "# Title", the rest is the body. The id is the file name without ".md".
export function loadKnowledge(dir: string): Article[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const [first = "", ...rest] = readFileSync(join(dir, f), "utf8").split("\n");
      return { id: basename(f, ".md"), title: first.replace(/^#\s*/, "").trim(), text: rest.join("\n").trim() };
    });
}

// Title hits count 3x. A term found in more than half of the articles ("loan", "payment") carries no
// weight, so a question about something we have no article for does not match on generic words.
export function searchKnowledge(articles: Article[], query: string): KnowledgeMatches {
  const docs = articles.map((a) => ({ article: a, title: terms(a.title), body: terms(a.text) }));
  const queryTerms = [...new Set(terms(query))];

  const scored = docs.map((d) => {
    let score = 0;
    for (const t of queryTerms) {
      const df = docs.filter((x) => x.title.includes(t) || x.body.includes(t)).length;
      if (df === 0 || df > docs.length / 2) continue;
      const hits = 3 * d.title.filter((w) => w === t).length + d.body.filter((w) => w === t).length;
      score += hits * Math.log(1 + docs.length / df);
    }
    return { article: d.article, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, MAX_MATCHES)
    .map((s) => s.article);
  return { matches };
}
