/**
 * Matching a question, or a batch of a source, to the concepts it touches.
 *
 * Every brain used to go to the model whole. At 1000 concepts that is about
 * 524,000 tokens per question, near the call deadline and past the point where
 * more text helps the answer. These pick what bears on the question, so the
 * cost of an answer stays flat however large the brains grow.
 */

export const norm = (s: any) => String(s ?? "").toLowerCase().trim();

/**
 * Question words carry no subject, and scope lines are written in prose, so
 * "how do I bake sourdough" matched a scope that merely opens with "how".
 * Routing reads the words that name a subject and drops the rest.
 */
export const STOP = new Set(("a about after again all also am an and any are as at be because been before being " +
  "between both but by can cannot could did do does doing done down during each few for from further get " +
  "give got had has have having her here hers him his how i if in into is it its just know let like made " +
  "make many may me more most much must my need no nor not now of off on once one only or other our out " +
  "over own per put same say said see should since so some such take than that the their them then there " +
  "these they thing things think this those through to too two under until up us use used using very want " +
  "was way we were what when where which while who whom why will with within would you your").split(" "));

export const keywords = (q: string) =>
  norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));


/** How strongly one concept bears on a set of words. A title hit counts three. */
export function scoreConcept(c: any, words: string[], brainText = ""): number {
  if (!words.length) return 0;
  const title = norm(c.title);
  const hay = norm([c.title, c.summaryLine, c.position, (c.data ?? []).join(" "),
    (c.evidence ?? []).map((e: any) => e?.claim ?? "").join(" ")].join(" "));
  const brain = norm(brainText);
  let score = 0;
  for (const w of words) {
    if (title.includes(w)) score += 3;
    if (hay.includes(w)) score += 1;
    if (brain && brain.includes(w)) score += 1;
  }
  return score;
}

/**
 * Concepts ranked for a set of words, best first, ties to the fuller concept.
 * With no words at all, the fullest concepts lead, so a vague question still
 * reaches the positions with the most behind them.
 */
export function rankConcepts(concepts: any[], words: string[], brains: any[] = []) {
  const brainText = new Map(brains.map((b: any) => [b.slug, `${b.name} ${b.scope}`]));
  return concepts.map((c: any) => ({ c, score: scoreConcept(c, words, brainText.get(c.brain) ?? "") }))
    .sort((a, b) => b.score - a.score || (b.c.evidence?.length ?? 0) - (a.c.evidence?.length ?? 0));
}

/* What one question may send: 30 concepts in full within 60,000 characters,
   and up to 120 more named by title within 12,000. About 18,000 tokens at most,
   whatever the size of the brains behind it. */
export const FULL_MAX = 30, FULL_CHARS = 60000, TITLE_MAX = 120, TITLE_CHARS = 12000;

/**
 * The stored knowledge a question reads.
 *
 * Every brain in the pool is searched. The concepts that bear on the question
 * open in full, the next ones are named by title so the answer knows what else
 * is held, and a follow-up borrows the words of the question before it.
 */
export function dossierFor(pool: any[], concepts: any[], q: string, history?: any,
                           opts: { picked?: string[]; terms?: string[] } = {}) {
  const last = (Array.isArray(history) ? history : []).slice(-1)[0];
  const words = keywords(q);
  const echo = last ? keywords(String(last.q ?? "")).filter(w => !words.includes(w)) : [];
  /* The router's English terms, so a question in French or an abbreviation
     still meets the words the concepts are written in. */
  const extra = keywords((opts.terms ?? []).join(" ")).filter(w => !words.includes(w) && !echo.includes(w));
  const inPool = concepts.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  const ranked = rankConcepts(inPool, [...words, ...echo, ...extra], pool);
  const hits = ranked.filter(r => r.score > 0).map(r => r.c);

  /* The order concepts open in: what the router picked, reading every title;
     then what those concepts link to, since an answer usually continues there;
     then what shares words with the question. A question naming nothing held
     still reaches the fullest positions. */
  const byId = new Map(inPool.map((c: any) => [idOf(c), c]));
  const picked = (opts.picked ?? []).map(id => byId.get(id)).filter(Boolean);
  const seeds = picked.length ? picked : hits.slice(0, 10);
  const linked = neighbours(seeds, inPool).slice(0, 10);
  /* The seeds lead: the picks, or with none the best word matches. Then what
     they link to, then the rest of the matches. */
  const lead0 = [...seeds, ...linked, ...hits];
  const lead = [...new Set(lead0.length ? lead0 : ranked.map(r => r.c))];

  const brainOf = (c: any) => pool.find((x: any) => x.slug === c.brain);
  const row = (c: any) => {
    const br = brainOf(c);
    return `### ${c.title} in ${br?.name ?? c.brain} [${br?.type ?? "subject"}]
POSITION: ${c.position || "none"}
EVIDENCE: ${(c.evidence ?? []).map((e: any) => `${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join(" | ") || "none"}
DATA: ${(c.data ?? []).join(" | ") || "none"}
OPEN CONFLICTS: ${(c.conflicts ?? []).map((x: any) => `${x.a} (${x.aDate}) vs ${x.b} (${x.bDate}), because ${x.why}`).join(" | ") || "none"}`;
  };

  const opened: any[] = [];
  let used = 0;
  for (const c of lead) {
    if (opened.length >= FULL_MAX) break;
    const r = row(c);
    if (used + r.length > FULL_CHARS && opened.length) break;
    opened.push(c); used += r.length;
  }
  const named: string[] = [];
  let usedT = 0;
  for (const { c } of ranked) {
    if (named.length >= TITLE_MAX) break;
    if (opened.includes(c)) continue;
    const line = `- ${c.title} (${brainOf(c)?.name ?? c.brain}): ${c.summaryLine || "no summary"}`;
    if (usedT + line.length > TITLE_CHARS) break;
    named.push(line); usedT += line.length;
  }
  const left = inPool.length - opened.length - named.length;
  const dossier = (opened.map(row).join("\n\n") || "The chosen brains hold no concepts yet.") +
    (named.length ? `\n\nALSO HELD, not opened here:\n${named.join("\n")}` +
      (left > 0 ? `\n...and ${left} more.` : "") : "");
  return { dossier, opened, named: named.length, left, matched: hits.length,
           picked: picked.length, linked: linked.filter(c => opened.includes(c)).length };
}

/* ---------- links between concepts ---------- */

/* The same slug the server writes, kept here so this file stays free of the
   deployment's environment and can be tested on its own. */
const slugOf = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";

export const idOf = (c: any) => `${c.brain}/${c.slug}`;

/**
 * One link, as a concept id.
 *
 * A drop writes brain/slug. The starter concepts were written as prose, like
 * "Prudence in `03-prudence.md`", so the title before " in `" is read as a
 * concept of the same brain.
 */
export function linkId(entry: string, fromBrain: string): string {
  const t = String(entry ?? "").replace(/\s+in\s+`[^`]*`\s*$/, "").trim();
  if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(t)) return t;
  if (t.includes("/")) { const [b, ...rest] = t.split("/"); return `${slugOf(b)}/${slugOf(rest.join("/"))}`; }
  return `${fromBrain}/${slugOf(t)}`;
}

/**
 * What a set of concepts links to, read both ways: a concept pointing at a seed
 * counts as much as a seed pointing at it. The most linked lead.
 */
export function neighbours(seeds: any[], all: any[]): any[] {
  const seedIds = new Set(seeds.map(idOf));
  const byId = new Map(all.map((c: any) => [idOf(c), c]));
  const count = new Map<string, number>();
  const bump = (id: string) => { if (!seedIds.has(id) && byId.has(id)) count.set(id, (count.get(id) ?? 0) + 1); };
  for (const s of seeds) for (const r of s.related ?? []) bump(linkId(r, s.brain));
  for (const c of all) for (const r of c.related ?? []) if (seedIds.has(linkId(r, c.brain))) bump(idOf(c));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id));
}

/* ---------- the list of titles a router reads ---------- */

/* About 2300 titles fit. Past that, the ones sharing words with the question
   and the fullest go in first. */
export const INDEX_CHARS = 80000;

/**
 * Every concept title, numbered, for a model to pick from. Numbers keep the
 * reply short and cannot be misspelled into a concept that does not exist.
 */
export function indexFor(pool: any[], concepts: any[], q: string) {
  const inPool = concepts.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  const name = new Map(pool.map((b: any) => [b.slug, b.name]));
  const lines: string[] = [], ids: string[] = [];
  let used = 0;
  for (const { c } of rankConcepts(inPool, keywords(q), pool)) {
    const line = `${ids.length + 1}|${c.title} [${name.get(c.brain) ?? c.brain}]`;
    if (used + line.length + 1 > INDEX_CHARS) break;
    lines.push(line); ids.push(idOf(c)); used += line.length + 1;
  }
  return { text: lines.join("\n"), ids, total: inPool.length };
}
