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

import { ask } from "./lib";
import { indexFor } from "./words";

const ROUTE_RULES = `You choose which concepts of a knowledge base a question needs.

Below is the question, the question asked just before it when there is one, and a numbered list of every concept title.

- Pick the concepts whose content the answer needs, best first, at most 30.
- Match on meaning, whatever language the question is in. The titles are in English.
- Spell out abbreviations and jargon in your head: "P/E" is price to earnings, "amortissement" is depreciation.
- Include a concept the answer builds on, not only the one named.
- Pick nothing when no title bears on the question. An empty list is a correct answer.
- "terms" is the question rewritten as English search words: the subject, its synonyms, and abbreviations spelled out. Up to 12.

Reply with only JSON: {"picks":[3,17,42],"terms":["depreciation","straight line","useful life"]}`;

export async function routeQuestion(
  pool: any[], concepts: any[], q: string, history: any, key?: string, model?: string,
): Promise<{ picked: string[]; terms: string[]; routed: boolean }> {
  const index = indexFor(pool, concepts, q);
  if (!index.ids.length) return { picked: [], terms: [], routed: false };
  const last = (Array.isArray(history) ? history : []).slice(-1)[0];
  try {
    const { text } = await ask([
      { role: "system", content: "You route questions to the right entries of a knowledge base. You reply with JSON only." },
      { role: "user", content: `${ROUTE_RULES}

QUESTION: ${q.slice(0, 600)}
${last?.q ? `ASKED JUST BEFORE: ${String(last.q).slice(0, 400)}\n` : ""}
CONCEPTS (${index.ids.length}${index.total > index.ids.length ? ` of ${index.total}, the closest by wording` : ""})
${index.text}` },
    ], { json: true, maxTokens: 600, timeout: 30000, key, model });
    const d = JSON.parse(String(text).replace(/^```(?:json)?|```$/g, "").trim());
    const picked = (Array.isArray(d?.picks) ? d.picks : [])
      .map((n: any) => index.ids[Number(n) - 1]).filter(Boolean).slice(0, 30);
    const terms = (Array.isArray(d?.terms) ? d.terms : []).map(String).slice(0, 12);
    return { picked: [...new Set<string>(picked)], terms, routed: true };
  } catch {
    return { picked: [], terms: [], routed: false };
  }
}
