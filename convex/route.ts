/**
 * The step before an answer: a model reads every concept title and picks the
 * ones the question needs.
 *
 * Word matching found a concept when the question shared its words, and missed
 * a question in French or one written as "P/E". A model reading the titles
 * matches on meaning. It also hands back the question as English search terms,
 * which the word matching then uses for everything the titles alone miss.
 *
 * It costs about 10,000 tokens in at 1000 concepts, about $0.0002, and a second
 * or two. If it fails for any reason the question carries on with word matching
 * alone, so a router problem never costs an answer.
 */

import { ask, parseJson } from "./lib";
import { indexFor } from "./words";

const ROUTE_RULES = `You choose which concepts of a knowledge base a question needs.

Below is the question, the questions asked before it when there are any, and a numbered list of every concept title.

- Pick the concepts whose content the answer needs, best first, at most 30.
- Match on meaning, whatever language the question is in. The titles are in English.
- Spell out abbreviations and jargon in your head: "P/E" is price to earnings, "amortissement" is depreciation.
- Include a concept the answer builds on, not only the one named.
- The earlier questions only resolve a reference like "that one" or "the second". The subject is the QUESTION's.
- Pick nothing when no title bears on the question. An empty list is a correct answer.
- "terms" is the question rewritten as English search words: the subject, its synonyms, and abbreviations spelled out. Up to 12.

Reply with only JSON: {"picks":[3,17,42],"terms":["depreciation","straight line","useful life"]}`;

export async function routeQuestion(
  pool: any[], concepts: any[], q: string, history: any, key?: string, model?: string,
): Promise<{ picked: string[]; terms: string[]; routed: boolean }> {
  const index = indexFor(pool, concepts, q);
  if (!index.ids.length) return { picked: [], terms: [], routed: false };
  /* Three questions back, oldest first, so "compare it with the first one"
     still finds the first one. */
  const before = (Array.isArray(history) ? history : []).slice(-3).map((h: any) => String(h?.q ?? "").slice(0, 300)).filter(Boolean);
  try {
    const { text, finish } = await ask([
      { role: "system", content: "You route questions to the right entries of a knowledge base. You reply with JSON only." },
      { role: "user", content: `${ROUTE_RULES}

QUESTION: ${q.slice(0, 600)}
${before.length ? `ASKED BEFORE, oldest first:\n${before.map(x => `- ${x}`).join("\n")}\n` : ""}
CONCEPTS (${index.ids.length}${index.total > index.ids.length ? ` of ${index.total}, the closest by wording` : ""})
${index.text}` },
    ], { json: true, maxTokens: 600, timeout: 30000, key, model });
    const d = parseJson(String(text), finish);
    const picked = (Array.isArray(d?.picks) ? d.picks : [])
      .map((n: any) => index.ids[Number(n) - 1]).filter(Boolean).slice(0, 30);
    const terms = (Array.isArray(d?.terms) ? d.terms : []).map(String).slice(0, 12);
    return { picked: [...new Set<string>(picked)], terms, routed: true };
  } catch (e: any) {
    /* Said in the logs, since the answer carries on by words alone. */
    console.log(`router fell back to word matching: ${String(e?.message ?? e).slice(0, 200)}`);
    return { picked: [], terms: [], routed: false };
  }
}
