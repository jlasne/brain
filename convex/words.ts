/**
 * Matching a question, or a batch of a source, to the concepts it touches.
 *
 * Every brain used to go to the model whole. At 1000 concepts that is about
 * 524,000 tokens per question, near the call deadline and past the point where
 * more text helps the answer. These pick what bears on the question, so the
 * cost of an answer stays flat however large the brains grow.
 */

export const norm = (s: any) => String(s ?? "").toLowerCase().trim();

/* Accents folded, so "linéaire" is one word and matches "lineaire". */
const fold = (s: any) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
  "was way we were what when where which while who whom why will with within would you your " +
  /* French, since questions often come in French and the concepts in English. */
  "les des une est que qui quoi dans pour par sur avec pas plus son ses leur leurs aux mais comme tout tous " +
  "toute toutes fait faire quel quelle quels quelles comment pourquoi donc alors ont sont etre avoir cette " +
  "ces cet elle elles nous vous ils entre sans sous chez aussi tres peu bien").split(" "));

export const keywords = (q: string) =>
  fold(q).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));

/**
 * A word's stem, near enough: "rates" and "rate" meet, "accurate" and "rate"
 * do not. Words used to match anywhere inside another word, so "est" found
 * "interest" and "rate" found "corporate".
 */
export function stem(w: string): string {
  if (w.length < 4) return w;
  for (const x of ["ations", "ation", "ings", "ing", "ies", "ied", "ers", "ed", "es", "er", "ly", "s", "e"]) {
    if (w.endsWith(x) && w.length - x.length >= 3) return w.slice(0, -x.length);
  }
  return w;
}

/* A concept's words, read once per concept object rather than once per word. */
const bags = new WeakMap<object, { title: Set<string>; all: Set<string> }>();
function bagOf(c: any) {
  let b = bags.get(c);
  if (b) return b;
  const set = (t: string) => new Set(keywords(t).map(stem));
  b = {
    title: set(String(c.title ?? "")),
    all: set([c.title, c.summaryLine, c.position, (c.data ?? []).join(" "),
      (c.evidence ?? []).map((e: any) => e?.claim ?? "").join(" ")].join(" ")),
  };
  bags.set(c, b);
  return b;
}


/**
 * How strongly one concept bears on a set of words. A title hit counts three.
 * A word of the brain's name or scope only breaks a tie: it used to count a
 * full point, so one word of a scope made every concept of that brain a match.
 * A weight below one lets a follow-up borrow the question before it without
 * that question outweighing this one.
 */
export function scoreConcept(c: any, words: string[], brainText = "", weight?: (w: string) => number): number {
  if (!words.length) return 0;
  const bag = bagOf(c);
  const brain = brainText ? new Set(keywords(brainText).map(stem)) : null;
  let score = 0;
  for (const w of new Set(words)) {
    const s = stem(w), k = weight ? weight(w) : 1;
    if (bag.title.has(s)) score += 3 * k;
    if (bag.all.has(s)) score += 1 * k;
    if (brain && brain.has(s)) score += 0.25 * k;
  }
  return score;
}

/**
 * Concepts ranked for a set of words, best first, ties to the fuller concept.
 * With no words at all, the fullest concepts lead, so a vague question still
 * reaches the positions with the most behind them.
 */
export function rankConcepts(concepts: any[], words: string[], brains: any[] = [], weight?: (w: string) => number) {
  const brainText = new Map(brains.map((b: any) => [b.slug, `${b.name} ${b.scope}`]));
  return concepts.map((c: any) => ({ c, score: scoreConcept(c, words, brainText.get(c.brain) ?? "", weight) }))
    .sort((a, b) => b.score - a.score || (b.c.evidence?.length ?? 0) - (a.c.evidence?.length ?? 0));
}

/* What one question may send: 30 concepts in full within 60,000 characters,
   and up to 120 more named by title within 12,000. About 18,000 tokens at most,
   whatever the size of the brains behind it. */
export const FULL_MAX = 30, FULL_CHARS = 60000, TITLE_MAX = 120, TITLE_CHARS = 12000;
/* One concept opens at most this much, so no single one eats the budget. */
export const ROW_MAX = 8000;

/**
 * The stored knowledge a question reads.
 *
 * Every brain in the pool is searched. The concepts that bear on the question
 * open in full, the next ones are named by title so the answer knows what else
 * is held, and a follow-up borrows the words of the question before it.
 */
export function dossierFor(pool: any[], concepts: any[], q: string, history?: any,
                           opts: { picked?: string[]; terms?: string[]; routed?: boolean } = {}) {
  const last = (Array.isArray(history) ? history : []).slice(-1)[0];
  const words = keywords(q);
  const echo = last ? keywords(String(last.q ?? "")).filter(w => !words.includes(w)) : [];
  /* The router's English terms, so a question in French or an abbreviation
     still meets the words the concepts are written in. */
  const extra = keywords((opts.terms ?? []).join(" ")).filter(w => !words.includes(w) && !echo.includes(w));
  const inPool = concepts.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  /* The question before counts a third as much, so a follow-up finds its
     subject and a new subject is not buried under the old one. */
  const echoed = new Set(echo);
  const ranked = rankConcepts(inPool, [...words, ...echo, ...extra], pool, w => echoed.has(w) ? 0.3 : 1);
  const hits = ranked.filter(r => r.score >= 1).map(r => r.c);

  /* The order concepts open in: what the router picked, reading every title;
     then what those concepts link to, since an answer usually continues there;
     then what shares words with the question. A question naming nothing held
     still reaches the fullest positions. */
  const byId = new Map(inPool.map((c: any) => [idOf(c), c]));
  const picked = (opts.picked ?? []).map(id => byId.get(id)).filter(Boolean);
  /* A router that read every title and picked none has judged nothing held
     bears on it. Only a concept whose title carries the question's words
     overrules that; loose word matches would fill the answer with noise. */
  const judgedEmpty = !!opts.routed && !picked.length;
  const titleHits = judgedEmpty ? hits.filter((c: any) => scoreConcept(c, words) >= 3) : hits;
  const seeds = picked.length ? picked : titleHits.slice(0, 10);
  const linked = neighbours(seeds, inPool).slice(0, 10);
  /* The seeds lead: the picks, or with none the best word matches. Then what
     they link to, then the rest of the matches. */
  const lead0 = [...seeds, ...linked, ...titleHits];
  const lead = [...new Set(lead0.length || judgedEmpty ? lead0 : ranked.map(r => r.c))];

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
    /* One long concept is passed over, not the end of the list: a smaller
       pick after it still opens. */
    if (used + Math.min(r.length, ROW_MAX) > FULL_CHARS && opened.length) continue;
    opened.push(c); used += Math.min(r.length, ROW_MAX);
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
  const empty = inPool.length ? "Nothing held bears directly on this question." : "The chosen brains hold no concepts yet.";
  const dossier = (opened.map(c => row(c).slice(0, ROW_MAX)).join("\n\n") || empty) +
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
  if (t.includes("/")) { const [b, ...rest] = t.split("/"); return `${slugOf(b)}/${conceptSlug(rest.join("/"))}`; }
  return `${fromBrain}/${conceptSlug(t)}`;
}

/**
 * What a set of concepts links to, read both ways: a concept pointing at a seed
 * counts as much as a seed pointing at it. The most linked lead.
 */
export function neighbours(seeds: any[], all: any[]): any[] {
  const seedIds = new Set(seeds.map(idOf));
  /* A concept answers to its id and to the id its title makes now, so a link
     written either way reaches it. */
  const byId = new Map<string, any>();
  for (const c of all) { byId.set(`${c.brain}/${conceptSlug(c.title)}`, c); byId.set(idOf(c), c); }
  const real = (id: string) => { const c = byId.get(id); return c ? idOf(c) : id; };
  const count = new Map<string, number>();
  const bump = (raw: string) => { const id = real(raw); if (!seedIds.has(id) && byId.has(id)) count.set(id, (count.get(id) ?? 0) + 1); };
  for (const s of seeds) for (const r of s.related ?? []) bump(linkId(r, s.brain));
  for (const c of all) for (const r of c.related ?? []) if (seedIds.has(real(linkId(r, c.brain)))) bump(idOf(c));
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
  /* Past the cut, the newest concepts come first among equals, so what was
     just dropped is never the part the router cannot see. One brain needs no
     brain name on each line, which leaves room for a quarter more titles. */
  const one = pool.length === 1;
  const order = rankConcepts(inPool, keywords(q), pool)
    .sort((a, b) => b.score - a.score || String(b.c.updated ?? "").localeCompare(String(a.c.updated ?? "")));
  for (const { c } of order) {
    const line = one ? `${ids.length + 1}|${c.title}` : `${ids.length + 1}|${c.title} [${name.get(c.brain) ?? c.brain}]`;
    if (used + line.length + 1 > INDEX_CHARS) break;
    lines.push(line); ids.push(idOf(c)); used += line.length + 1;
  }
  return { text: lines.join("\n"), ids, total: inPool.length };
}

/* ---------- finding links without a model ---------- */

/**
 * Likely links between concepts, from what they already hold. No model call.
 *
 * Three signals, strongest first:
 *   - one concept's text names another's title
 *   - they share rare words, weighed so a word every concept uses counts for
 *     nothing and a word two concepts share counts for a lot
 *   - they came from the same source, weighed by how small the source was: two
 *     ideas from one short article are close, two of 229 from one manual are not
 *
 * The rare words are matched through an index of which concepts hold each word,
 * so only pairs sharing a word are ever compared. At 4000 concepts that is well
 * under a second, instead of eight million comparisons.
 *
 * Returns, per concept id, up to `per` candidates, best first. A model then
 * keeps the real ones.
 */
export function linkCandidates(concepts: any[], sources: any[] = [], per = 6, floor = 0.12) {
  const N = concepts.length;
  const out = new Map<string, { id: string; score: number }[]>();
  if (N < 2) return out;

  const terms = (c: any) => (norm([c.title, c.summaryLine, c.position, (c.data ?? []).join(" ")].join(" "))
    .match(/[a-z0-9]{4,}/g) ?? []).filter(w => !STOP.has(w));
  const docs = concepts.map(terms);

  /* Rare words weigh most. A word held by over a fifth of the concepts, when
     there are enough of them for that to mean something, says nothing. */
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const common = N >= 25 ? N * 0.2 : N;
  const vecs = docs.map(d => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map<string, number>();
    let len = 0;
    for (const [w, n] of tf) {
      const f = df.get(w)!;
      if (f < 2 || f > common) continue;
      const x = (1 + Math.log(n)) * Math.log(N / f);
      v.set(w, x); len += x * x;
    }
    len = Math.sqrt(len) || 1;
    for (const [w, x] of v) v.set(w, x / len);
    return v;
  });
  const post = new Map<string, number[]>();
  vecs.forEach((v, i) => { for (const w of v.keys()) (post.get(w) ?? post.set(w, []).get(w)!).push(i); });

  /* A source that produced few concepts binds them tightly. */
  const bySource = new Map<string, number[]>();
  concepts.forEach((c, j) => { for (const s of c.sources ?? []) (bySource.get(s) ?? bySource.set(s, []).get(s)!).push(j); });

  /* Titles indexed by their first word, so a concept's text is only searched
     for the titles that could possibly be in it. */
  const titles = concepts.map(c => norm(c.title));
  const text = concepts.map(c => norm([c.summaryLine, c.position, (c.data ?? []).join(" ")].join(" ")));
  const byFirst = new Map<string, number[]>();
  titles.forEach((t, j) => {
    /* Specific enough to mean it: two words, or one long one. */
    if (!(t.includes(" ") || t.length >= 8)) return;
    const f = t.split(/[^a-z0-9]+/).find(Boolean) ?? "";
    if (f) (byFirst.get(f) ?? byFirst.set(f, []).get(f)!).push(j);
  });

  for (let i = 0; i < N; i++) {
    const score = new Map<number, number>();
    const add = (j: number, x: number) => { if (j !== i) score.set(j, (score.get(j) ?? 0) + x); };
    for (const [w, x] of vecs[i]) for (const j of post.get(w)!) add(j, x * vecs[j].get(w)!);
    /* Naming another's title is the strongest sign. */
    for (const w of new Set(text[i].split(/[^a-z0-9]+/))) {
      for (const j of byFirst.get(w) ?? []) if (text[i].includes(titles[j])) add(j, 0.5);
    }
    for (const s of concepts[i].sources ?? []) {
      const held = bySource.get(s) ?? [];
      for (const j of held) add(j, 0.2 / Math.log(2 + held.length));
    }
    const best = [...score.entries()].filter(([, s]) => s >= floor).sort((a, b) => b[1] - a[1]).slice(0, per);
    out.set(idOf(concepts[i]), best.map(([j, s]) => ({ id: idOf(concepts[j]), score: Math.round(s * 100) / 100 })));
  }
  return out;
}

/* ---------- a concept's name ---------- */

/**
 * The id part of a concept, from its title.
 *
 * Every id used to be the title cut to 48 characters, so two long titles that
 * start alike became one concept: "Discount offer analysis for Ziggy Indonesia:
 * comparison with money market hedge" and "... with forward contract" merged,
 * and the second was lost. A title up to 48 characters keeps exactly the id it
 * always had. A longer one keeps its first 41 and a 6 character fingerprint of
 * the whole title, so two different titles never share an id. Still 48 at most.
 */
export function conceptSlug(title: string): string {
  const full = String(title ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  if (full.length <= 48) return full;
  let h = 0x811c9dc5;
  for (let i = 0; i < full.length; i++) { h ^= full.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${full.slice(0, 41).replace(/-+$/, "")}-${h.toString(36).padStart(6, "0").slice(-6)}`;
}

/** The id a long title was given before, cut at 48, so stored concepts stay findable. */
export const legacySlug = (title: string) => slugOf(title);

export const sameTitle = (a: string, b: string) => norm(a).replace(/\s+/g, " ") === norm(b).replace(/\s+/g, " ");

/**
 * The stored concept a title names in a brain: by its id, or, for a concept
 * stored under the old cut id, by that id when the whole title matches too.
 * A different title that merely starts the same way is not it.
 */
export function findByTitle(concepts: any[], brain: string, title: string): any {
  const id = conceptSlug(title), old = legacySlug(title);
  return concepts.find((x: any) => x.brain === brain && x.slug === id)
    ?? (old !== id ? concepts.find((x: any) => x.brain === brain && x.slug === old && sameTitle(x.title, title)) : undefined)
    /* A concept whose id was set another way, by a seed or a rename, is still
       the same concept when its title is. */
    ?? concepts.find((x: any) => x.brain === brain && sameTitle(x.title, title));
}

/** R5.9. Keep 12, fold older agreeing entries into one dated line. */
export function compress(ev: any[]) {
  const real = ev.filter(e => !e.rollup), roll = ev.find(e => e.rollup);
  if (real.length <= 12) return roll ? [...real, roll] : real;
  const keep = real.slice(0, 12), fold = real.slice(12);
  const years = fold.map(e => String(e.date ?? "").slice(0, 4)).filter(Boolean).sort();
  const n = fold.length + (roll?.count ?? 0);
  const from = roll?.from || years[0] || "", to = years[years.length - 1] || roll?.to || "";
  return [...keep, { rollup: true, count: n, from, to,
    claim: `${n} earlier source${n === 1 ? "" : "s"} agreed${from ? `, ${from} to ${to}` : ""}` }];
}

/* ---------- writing a concept without losing what landed meanwhile ---------- */

/**
 * Two evidence lists as one, newest first.
 *
 * A drop reads a concept, spends a minute on the model, then writes. Anything
 * written in between, by a parallel batch or a second drop, used to be lost to
 * the older copy. The write now unions with the stored row: an entry is the
 * same entry when its source and claim match.
 */
export function mergeEvidence(mine: any[], stored: any[]): any[] {
  const seen = new Set<string>();
  const real: any[] = [];
  let roll: any = null;
  for (const e of [...(mine ?? []), ...(stored ?? [])]) {
    if (!e) continue;
    if (e.rollup) { if (!roll || (e.count ?? 0) > (roll.count ?? 0)) roll = e; continue; }
    const k = `${e.source ?? ""}|${String(e.claim ?? "").trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); real.push(e);
  }
  real.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return compress(roll ? [...real, roll] : real);
}

/** A union, first list first, duplicates out, capped. */
export function unionCap<T>(first: T[], second: T[], cap: number, key: (x: T) => string = x => JSON.stringify(x)): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const x of [...(first ?? []), ...(second ?? [])]) {
    const k = key(x);
    if (x == null || seen.has(k)) continue;
    seen.add(k); out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}
