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
    all: set([c.title, c.summaryLine, c.position ?? c.lead, (c.data ?? []).join(" "),
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
    .sort((a, b) => b.score - a.score || (b.c.evidence?.length ?? b.c.ev ?? 0) - (a.c.evidence?.length ?? a.c.ev ?? 0));
}

/* What one question may send: 30 concepts in full within 60,000 characters,
   and up to 40 more named by title within 4,000. About 16,000 tokens at most,
   whatever the size of the brains behind it. */
export const FULL_MAX = 30, FULL_CHARS = 60000, TITLE_MAX = 40, TITLE_CHARS = 4000;
/**
 * When the router picked concepts, those open first, then the ones named in the question, the nearest in meaning and the ones they link to; a
 * concept that only shares a word with the question fills the dossier up to this many concepts in all, no more. Loose matches were most of
 * what a dossier held. A router that picked nothing, or failed, leaves every match to open as before.
 */
export const MIN_OPEN = 8;
/**
 * A folder too long to read title by title shows the router this many titles: the nearest in meaning first (the question is embedded before the
 * router runs), then by words. It needs the meaning of the folders to be kept: with fewer than NEAR_NEEDED found, the router reads every title.
 */
export const INDEX_SHORT = 120, NEAR_SHORT = 40, NEAR_NEEDED = 20;
/**
 * How close in meaning a concept must be to open on that alone once the router has read its title and passed it over: the floor the
 * project search uses for the same model. Below it, a near concept only shares a field with the question ("Tax shield" for a VAT rate).
 */
export const NEAR_FLOOR = 0.45;
/** The concepts the last answer opened, carried to the next message so "the second one" still finds its subject: this many at most. */
export const PRIOR_MAX = 12;
/* One concept opens at most this much, so no single one eats the budget. */
export const ROW_MAX = 8000;

const CLOSE_WORDS = new Set(["thanks", "thank", "thx", "ty", "cheers", "merci", "hello", "hi", "hey", "bonjour", "bonsoir", "salut", "bye", "goodbye", "revoir", "bientot"]);
const CLOSE_FILL = new Set(["ok", "okay", "great", "perfect", "super", "parfait", "nice", "cool", "got", "it", "you", "a", "lot", "very", "much", "so", "again", "beaucoup", "bien", "encore", "au", "see", "good", "all", "the", "for", "help",
  "your", "that", "this", "helps", "helped", "helpful", "works", "appreciate", "really", "awesome", "amazing", "excellent", "i", "later", "soon", "take", "care", "have", "day", "night", "evening", "morning", "weekend", "now",
  "bonne", "journee", "soiree", "nuit", "vraiment", "genial", "de", "rien", "tres"]);
/**
 * Thanks, a greeting or a goodbye, and nothing else: it needs no part of the
 * file, no folder and no router. A bare "ok" or "yes" is not one, since it may
 * answer the question before it.
 */
export function isCloser(q: string): boolean {
  /* A number or a question mark asks something: "Great, thanks. For 2025?" is a question. */
  if (/[0-9?¿]/.test(String(q ?? ""))) return false;
  const w =String(q ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  return w.length > 0 && w.length <= 6 && w.some(x => CLOSE_WORDS.has(x)) && w.every(x => CLOSE_WORDS.has(x) || CLOSE_FILL.has(x));
}

/**
 * The last turns of a chat, as a message reads them: the last in full (its
 * question, and its answer up to `last` characters), the ones before it as the
 * question and the first line of the answer. They only say what "the second
 * one" or "that" points at: every claim still comes from what is stored.
 */
export function threadOf(history: any, max = 4, last = 900): { q: string; a: string }[] {
  const turns = (Array.isArray(history) ? history : []).slice(-max);
  const one = (t: any, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const first = (t: any, n: number) => one(String(t ?? "").split("\n").map(l => l.trim()).find(Boolean), n);
  return turns.map((h: any, i: number) => i === turns.length - 1
    ? { q: one(h?.q, 400), a: String(h?.a ?? "").trim().slice(0, last) }
    : { q: one(h?.q, 200), a: first(h?.a, 200) });
}

/**
 * The concepts the last answer opened, as the page sent them back with the thread: only ids this chat may read, each once. They are a
 * hint for the next message, never a source: what opens is still read from the store.
 */
export function priorOf(history: any, allowed: Set<string>): string[] {
  const last = (Array.isArray(history) ? history : []).slice(-1)[0];
  const ids = Array.isArray(last?.opened) ? last.opened : [];
  return [...new Set<string>(ids.map((x: any) => String(x ?? "").slice(0, 200)))].filter(id => allowed.has(id)).slice(0, PRIOR_MAX);
}

/* Words that name no one in particular, so two sources sharing one are not the same source. */
const SOURCE_STOP = new Set(["the", "and", "for", "inc", "ltd", "llc", "report", "blog", "news", "university", "company", "group", "team", "unknown", "source", "sources", "none", "des", "les", "von", "van"]);
const nameOf = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const nameWords = (s: string) => nameOf(s).split(" ").filter(w => w.length >= 3 && !SOURCE_STOP.has(w) && !/^\d+$/.test(w));

/**
 * The Sources line of an answer, held to what was read: an entry whose author is in none of the opened concepts' evidence goes, and a
 * line left empty goes whole. The model writes the line; this checks it. A name written a little differently ("Damodaran" for "Aswath
 * Damodaran") still counts, since one shared name is enough.
 */
export function checkSources(text: string, opened: any[]): string {
  const lines = String(text ?? "").split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*[*_]*sources?[*_]*\s*:/i.test(lines[i])) { at = i; break; }
  if (at < 0) return String(text ?? "");
  const held = opened.flatMap((c: any) => (c.evidence ?? []).map((e: any) => nameOf(String(e?.author ?? "")))).filter(Boolean);
  const body = lines[at].replace(/^\s*[*_]*sources?[*_]*\s*:\s*[*_]*\s*/i, "").replace(/\s*[*_]+\s*$/, "");
  const entries = body.split(/\s+[-–—·|]\s+|\s*;\s*/).map(x => x.trim()).filter(Boolean);
  const keep = entries.filter(e => {
    const who = e.includes(",") ? e.slice(0, e.lastIndexOf(",")) : e;
    const n = nameOf(who), words = nameWords(who);
    if (!n) return false;
    /* Whole words only: "A" is not inside "Invented Author". */
    return held.some(h => ` ${h} `.includes(` ${n} `) || ` ${n} `.includes(` ${h} `) || nameWords(h).some(w => words.includes(w)));
  });
  if (keep.length === entries.length && entries.length) return String(text ?? "");
  if (keep.length) lines[at] = `Sources: ${keep.join(" - ")}`;
  else {
    lines.splice(at, 1);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  }
  return lines.join("\n");
}

/**
 * The stored knowledge a question reads.
 *
 * Every brain in the pool is searched. The concepts that bear on the question
 * open in full, the next ones are named by title so the answer knows what else
 * is held, and a follow-up borrows the words of the question before it.
 */
export function dossierFor(pool: any[], concepts: any[], q: string, history?: any,
                           opts: { picked?: string[]; terms?: string[]; routed?: boolean; ran?: boolean; near?: string[]; prior?: string[] } = {}) {
  return writeDossier(pool, planDossier(pool, concepts, q, history, opts),
    new Map(concepts.map((c: any) => [idOf(c), c])));
}

/**
 * Which concepts a question reads, in order, from cards alone: the slim copy
 * of each concept is enough to rank them. Only the ones this puts first are
 * then read whole, by writeDossier.
 */
export function planDossier(pool: any[], concepts: any[], q: string, history?: any,
                            opts: { picked?: string[]; terms?: string[]; routed?: boolean; ran?: boolean; near?: string[]; prior?: string[] } = {}) {
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
  /* A concept whose title carries the question's own words always opens, even
     when the router passed it over: "Finance formulas reference" for a
     question asking for a formula. The router picks by sampling, and missing
     one such concept was the difference between an answer and "not held". */
  const named = hits.filter((c: any) => scoreConcept(c, words) >= 3).slice(0, 5);
  /* The closest by meaning, found from the question's embedding: a question
     in another language, or in other words, still reaches its concept. */
  const near = (opts.near ?? []).map(id => byId.get(id)).filter(Boolean).slice(0, 6);
  /* What the last answer opened, given when no router read this message: a follow-up with no words of its own ("and the second one?")
     keeps its subject. */
  const prior = (opts.prior ?? []).map(id => byId.get(id)).filter(Boolean).slice(0, 4);
  const seeds = picked.length ? [...new Set([...picked, ...named, ...near])]
    : [...new Set([...titleHits.slice(0, 10), ...near, ...prior])];
  const linked = neighbours(seeds, inPool).slice(0, 10);
  /* The seeds lead: the picks, or with none the best word matches. Then what
     they link to, then the rest of the matches: with picks, only as many as it
     takes to open MIN_OPEN concepts. */
  const firm = new Set<any>([...seeds, ...linked]);
  const fill = picked.length ? titleHits.filter((c: any) => !firm.has(c)).slice(0, Math.max(0, MIN_OPEN - firm.size)) : titleHits;
  const lead0 = [...seeds, ...linked, ...fill];
  /* With nothing to go on, the fullest positions open, unless a router read the titles: one that saw them and picked none (on the whole list,
     or on the nearest in meaning, `ran`) leaves nothing to open, rather than thirty concepts that only happen to hold the most evidence. */
  const lead = [...new Set(lead0.length || judgedEmpty || opts.ran ? lead0 : ranked.map(r => r.c))];
  return { lead, ranked, inPool, hits, picked, linked, words, titled: named.length };
}

/* How many of the leading concepts a caller reads whole: the 30 that can
   open, with room for long ones passed over. */
export const OPEN_READ = 60;

/** What a dossier may hold: how many concepts open in full and within how many characters, and how many more are named by title. A caller that reads the folders to support something else sets less. */
export type DossierLimits = { fullMax?: number; fullChars?: number; titleMax?: number; titleChars?: number };

/** The dossier itself, from the plan and the leading concepts read whole. */
export function writeDossier(pool: any[], plan: ReturnType<typeof planDossier>, full: Map<string, any>, limits: DossierLimits = {}) {
  const { lead, ranked, inPool, hits, picked, linked } = plan;
  const fullMax = limits.fullMax ?? FULL_MAX, fullChars = limits.fullChars ?? FULL_CHARS, titleMax = limits.titleMax ?? TITLE_MAX, titleChars = limits.titleChars ?? TITLE_CHARS;
  const brainOf = (c: any) => pool.find((x: any) => x.slug === c.brain);
  const titles = new Map(inPool.map((c: any) => [idOf(c), c.title]));
  /* What each link means, so an answer can follow a chain: a formula needs
     its inputs, one cause drives the next. */
  const linksOf = (c: any) => {
    const kinds = new Map(kindsOf(c).map(k => [k.to, k.type]));
    return (c.related ?? []).slice(0, 12).map((r: string) => {
      const id = linkId(String(r), c.brain), t = titles.get(id);
      return t ? `${kinds.get(id) ?? "related"}: ${t}` : "";
    }).filter(Boolean).join("; ");
  };
  const row = (c: any) => {
    const br = brainOf(c);
    const links = linksOf(c);
    return `### ${c.title} in ${br?.name ?? c.brain} [${br?.type ?? "subject"}]
POSITION: ${c.position || "none"}${links ? `\nLINKS: ${links}` : ""}${c.file ? `\nTHE PERSON'S FILE\n${fileText(c, 4000, (plan as any).words ?? [])}` : ""}
EVIDENCE: ${(c.evidence ?? []).map((e: any) => `${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join(" | ") || "none"}
DATA: ${(c.data ?? []).join(" | ") || "none"}
OPEN CONFLICTS: ${(c.conflicts ?? []).map((x: any) => `${x.a} (${x.aDate}) vs ${x.b} (${x.bDate}), because ${x.why}`).join(" | ") || "none"}`;
  };

  const opened: any[] = [];
  let used = 0;
  for (const card of lead) {
    if (opened.length >= fullMax) break;
    const c = full.get(idOf(card));
    if (!c) continue;
    const r = row(c);
    /* One long concept is passed over, not the end of the list: a smaller
       pick after it still opens. */
    if (used + Math.min(r.length, ROW_MAX) > fullChars && opened.length) continue;
    opened.push(c); used += Math.min(r.length, ROW_MAX);
  }
  const openedIds = new Set(opened.map(idOf));
  const named: string[] = [];
  let usedT = 0;
  for (const { c } of ranked) {
    if (named.length >= titleMax) break;
    if (openedIds.has(idOf(c))) continue;
    const line = `- ${c.title} (${brainOf(c)?.name ?? c.brain}): ${c.summaryLine || "no summary"}`;
    if (usedT + line.length > titleChars) break;
    named.push(line); usedT += line.length;
  }
  const left = inPool.length - opened.length - named.length;
  const empty = inPool.length ? "Nothing held bears directly on this question." : "The chosen brains hold no concepts yet.";
  const dossier = (opened.map(c => row(c).slice(0, ROW_MAX)).join("\n\n") || empty) +
    (named.length ? `\n\nALSO HELD, not opened here:\n${named.join("\n")}` +
      (left > 0 ? `\n...and ${left} more.` : "") : "");
  return { dossier, opened, named: named.length, left, matched: hits.length,
           picked: picked.length, linked: linked.filter((c: any) => openedIds.has(idOf(c))).length };
}

/* ---------- folders tagged with @ ---------- */

/** The most folders one message can tag. */
export const MAX_TAGS = 4;

/** The folders a message tagged, from the slugs the page sent: only ones the chat may read, each once, in the order sent. */
export function tagsOf(raw: unknown, allowed: { slug: string }[]): string[] {
  const ok = new Set(allowed.map(b => b.slug));
  return [...new Set((Array.isArray(raw) ? raw : []).map(String))].filter(s => ok.has(s)).slice(0, MAX_TAGS);
}

/**
 * What was tagged, said to the model: those folders were named on purpose and
 * are read below, and one that held nothing for this message says so. `who` is
 * the one who tagged, as the prompt calls them.
 */
export function taggedLine(tagged: { slug: string; name: string }[], opened: { brain: string }[], who = "THE OWNER"): string {
  if (!tagged.length) return "";
  const held = new Set(opened.map(c => c.brain));
  const none = tagged.filter(b => !held.has(b.slug)).map(b => b.name);
  return `${who} TAGGED ${tagged.map(b => `@${b.name}`).join(", ")} in the message: ${tagged.length === 1 ? "that folder was" : "those folders were"} named on purpose, and what ${tagged.length === 1 ? "it holds" : "they hold"} is read below.` +
    (none.length ? ` Nothing in ${none.join(", ")} bears on this message: say so in one sentence.` : "");
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
export function indexFor(pool: any[], concepts: any[], q: string, opts: { cap?: number; first?: string[]; extra?: string[]; keep?: string[] } = {}) {
  const inPool = concepts.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  const name = new Map(pool.map((b: any) => [b.slug, b.name]));
  const lines: string[] = [], ids: string[] = [];
  let used = 0;
  /* Past the cut, the newest concepts come first among equals, so what was
     just dropped is never the part the router cannot see. One brain needs no
     brain name on each line, which leaves room for a quarter more titles. */
  const one = pool.length === 1;
  /* A caller that wants a short list says how many titles, which concepts lead (the nearest by meaning) and what other words to rank by. */
  const lead = new Set(opts.first ?? []);
  const ranked = rankConcepts(inPool, [...keywords(q), ...keywords((opts.extra ?? []).join(" "))], pool)
    .sort((a, b) => b.score - a.score || String(b.c.updated ?? "").localeCompare(String(a.c.updated ?? "")));
  /* What the caller always wants listed (what the last answer opened, the personal notes of the personal chat, whose meaning is not kept)
     comes first, in the caller's order, and is not counted in the cap; then the nearest in meaning, the nearest first; then the rest, by words. */
  const must = new Map((opts.keep ?? []).map((id, i) => [id, i] as [string, number]));
  const rank = new Map((opts.first ?? []).map((id, i) => [id, i]));
  const rest = ranked.filter(x => !must.has(idOf(x.c)));
  const order = [...ranked.filter(x => must.has(idOf(x.c))).sort((a, b) => must.get(idOf(a.c))! - must.get(idOf(b.c))!),
    ...(lead.size ? [...rest.filter(x => lead.has(idOf(x.c))).sort((a, b) => rank.get(idOf(a.c))! - rank.get(idOf(b.c))!), ...rest.filter(x => !lead.has(idOf(x.c)))] : rest)];
  let others = 0;
  for (const { c } of order) {
    const kept = must.has(idOf(c));
    if (opts.cap && !kept && others >= opts.cap) break;
    if (!kept) others++;
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
export function linkCandidates(concepts: any[], sources: any[] = [], per = 6, floor = 0.12, only?: Set<string>) {
  const N = concepts.length;
  const out = new Map<string, { id: string; score: number }[]>();
  if (N < 2) return out;

  const terms = (c: any) => (norm([c.title, c.summaryLine, c.position ?? c.lead, (c.data ?? []).join(" ")].join(" "))
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
  concepts.forEach((c, j) => { for (const s of c.sources ?? c.srcIds ?? []) (bySource.get(s) ?? bySource.set(s, []).get(s)!).push(j); });

  /* Titles indexed by their first word, so a concept's text is only searched
     for the titles that could possibly be in it. */
  const titles = concepts.map(c => norm(c.title));
  const text = concepts.map(c => norm([c.summaryLine, c.position ?? c.lead, (c.data ?? []).join(" ")].join(" ")));
  const byFirst = new Map<string, number[]>();
  titles.forEach((t, j) => {
    /* Specific enough to mean it: two words, or one long one. */
    if (!(t.includes(" ") || t.length >= 8)) return;
    const f = t.split(/[^a-z0-9]+/).find(Boolean) ?? "";
    if (f) (byFirst.get(f) ?? byFirst.set(f, []).get(f)!).push(j);
  });

  for (let i = 0; i < N; i++) {
    /* A drop links what it wrote: the index covers every concept, the scores
       are worked out only for the ones asked about. */
    if (only && !only.has(idOf(concepts[i]))) continue;
    const score = new Map<number, number>();
    const add = (j: number, x: number) => { if (j !== i) score.set(j, (score.get(j) ?? 0) + x); };
    for (const [w, x] of vecs[i]) for (const j of post.get(w)!) add(j, x * vecs[j].get(w)!);
    /* Naming another's title is the strongest sign. */
    for (const w of new Set(text[i].split(/[^a-z0-9]+/))) {
      for (const j of byFirst.get(w) ?? []) if (text[i].includes(titles[j])) add(j, 0.5);
    }
    for (const s of concepts[i].sources ?? concepts[i].srcIds ?? []) {
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

/* ---------- the slim copy of a concept ---------- */

/* The opening of a position a card keeps. */
export const LEAD_CHARS = 300;

/** What a card holds for a concept: enough to rank, list and link it. */
export function cardOf(c: any) {
  return {
    brain: String(c.brain ?? ""), slug: String(c.slug ?? ""), n: Number(c.n ?? 0),
    title: String(c.title ?? ""), summaryLine: String(c.summaryLine ?? ""),
    lead: String(c.position ?? "").slice(0, LEAD_CHARS),
    ev: (c.evidence ?? []).length, src: (c.sources ?? []).length,
    srcIds: (c.sources ?? []).slice(-5).map(String),
    related: (c.related ?? []).slice(0, 12).map(String),
    kinds: kindsOf(c),
    ...(c.tag ? { tag: String(c.tag) } : {}),
    ...(Array.isArray(c.aliases) && c.aliases.length ? { aliases: c.aliases.slice(0, 12).map(String) } : {}),
    /* A person's file: the last day you were with them, whether it is built, and how many lines are still open. */
    ...(c.tag === "contact" ? { seen: String(c.file?.seen ?? ""), full: !!c.file, open: (c.file?.open ?? []).filter((x: any) => x && !x.done).length } : {}),
    updated: String(c.updated ?? ""),
  };
}

/** The kinds a link may carry, from the concept holding it to the one it names. */
export const LINK_TYPES = ["needs", "causes", "supports", "contradicts", "example"] as const;

/**
 * A concept's typed links, only for links it still holds: a link folded away
 * by a merge or a rename drops its type with it. "related" is the default and
 * is never stored.
 */
export function kindsOf(c: any): { to: string; type: string }[] {
  const held = new Set((c.related ?? []).map((r: string) => linkId(String(r), c.brain)));
  const seen = new Set<string>();
  return (Array.isArray(c.kinds) ? c.kinds : [])
    .filter((k: any) => k && held.has(String(k.to)) && (LINK_TYPES as readonly string[]).includes(String(k.type)) && !seen.has(k.to) && seen.add(k.to))
    .map((k: any) => ({ to: String(k.to), type: String(k.type) })).slice(0, 12);
}

/* ---------- a person's file ---------- */

/**
 * A contact in a personal brain is a file, not a summary rewritten each
 * time: lasting facts by section, the person's history as dated moments,
 * the people they are linked to, and what is still open. It only grows: a
 * fact that changes keeps the old value with the day it ended, and a moment
 * once told stays told.
 */
export const FILE_SECTIONS: [string, string][] = [
  ["identity", "Identity"], ["contact", "Contact details"], ["you", "You and them"],
  ["work", "Work"], ["tastes", "Tastes and character"], ["other", "Other"],
];
const SECTION_KEYS = new Set(FILE_SECTIONS.map(x => x[0]));
const flat = (t: any) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();
const same = (a: any, b: any) => flat(a).toLowerCase() === flat(b).toLowerCase();
const dayOk = (d: any) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(d ?? "")) ? String(d) : "";
const keyOf = (t: string) => { let h = 5381; for (const ch of t) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36); };

/**
 * Two open lines that say the same thing: the same words, or nearly (three in
 * four shared, two at least), once the person's own names are set aside, since
 * every line of a file is about them. "Send Marc the contract" and "Send the
 * contract to Marc" are one line; "Call about the price" and "Call Monday" are two.
 */
export function sameOpen(a: string, b: string, names: string[] = []): boolean {
  const skip = new Set(names.flatMap(n => keywords(n).map(stem)));
  const w = (t: string) => new Set(keywords(t).map(stem).filter(x => !skip.has(x)));
  const x = w(a), y = w(b);
  if (!x.size || !y.size) return flat(a).toLowerCase() === flat(b).toLowerCase();
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  const union = x.size + y.size - both;
  return both === union || (both >= 2 && both / union >= 0.6);
}

/**
 * A file's open lines with the ones that say the same thing made one: the
 * oldest keeps its key and the day it was opened, the newest wording is kept.
 * Closed lines stay as they are.
 */
export function dedupeOpen(open: any[], names: string[] = []): { open: any[]; merged: number } {
  const out: any[] = [];
  let merged = 0;
  for (const x of open ?? []) {
    const had = x?.done ? null : out.find(y => !y.done && sameOpen(y.t, x.t, names));
    if (had) { had.t = x.t; merged++; }
    else out.push({ ...x });
  }
  return { open: out, merged };
}

/**
 * A file with what a message adds folded in. Each part comes in either as
 * the filer writes it ({section, label, value}) or as a file stores it
 * ({s, l, v}), so two files merge the same way a message does.
 */
export function mergeFile(old: any, add: any, date: string, names: string[] = []) {
  const f = {
    v: 1,
    facts: [...(old?.facts ?? [])].map((x: any) => ({ ...x })),
    events: [...(old?.events ?? [])].map((x: any) => ({ ...x })),
    links: [...(old?.links ?? [])].map((x: any) => ({ ...x })),
    open: [...(old?.open ?? [])].map((x: any) => ({ ...x })),
    seen: String(old?.seen ?? ""),
  };
  for (const x of Array.isArray(add?.facts) ? add.facts : []) {
    const sec = String(x?.section ?? x?.s ?? "").toLowerCase();
    const s = SECTION_KEYS.has(sec) ? sec : "other";
    const l = flat(x?.label ?? x?.l).slice(0, 40), v = flat(x?.value ?? x?.v).slice(0, 400);
    if (!l || !v) continue;
    if (f.facts.some(y => y.s === s && same(y.l, l) && same(y.v, v) && !y.until)) continue;
    const since = dayOk(x?.since), at = dayOk(x?.at) || date;
    /* A value that replaces the old one closes it, on the day it changed. */
    if (x?.replaces) for (const y of f.facts) if (y.s === s && same(y.l, l) && !y.until) y.until = since || date;
    f.facts.push({ k: keyOf(`${s}|${l}|${v}|${at}`), s, l, v, ...(since ? { since } : {}), ...(dayOk(x?.until) ? { until: x.until } : {}), at });
  }
  for (const x of Array.isArray(add?.events) ? add.events : []) {
    const t = flat(x?.text ?? x?.t).slice(0, 1500);
    if (t.length < 3) continue;
    const d = dayOk(x?.date ?? x?.d) || date;
    if (f.events.some(y => y.d === d && same(y.t, t))) continue;
    const seen = x?.seen === true;
    f.events.push({ k: keyOf(`${d}|${t}`), d, t, ...(seen ? { seen: true } : {}), at: dayOk(x?.at) || date });
    if (seen && d > f.seen) f.seen = d;
  }
  for (const x of Array.isArray(add?.links) ? add.links : []) {
    const n = flat(x?.name ?? x?.n).slice(0, 80), r = flat(x?.rel ?? x?.r).slice(0, 60);
    if (n.length < 2) continue;
    const had = f.links.find(y => same(y.n, n));
    if (had) { if (r && !same(had.r, r)) had.r = r; continue; }
    f.links.push({ k: keyOf(`${n}|${r}`), n, r, at: dayOk(x?.at) || date });
  }
  for (const x of Array.isArray(add?.open) ? add.open : []) {
    const t = flat(x?.text ?? x?.t).slice(0, 300);
    if (t.length < 3) continue;
    const had = f.open.find(y => same(y.t, t));
    if (had) { if (x?.done) had.done = dayOk(x?.done) || date; continue; }
    /* A line already open that says the same thing is that line: closed by a done, reworded by a new one. */
    const alike = f.open.find(y => !y.done && sameOpen(y.t, t, names));
    if (alike) { if (x?.done) alike.done = dayOk(x?.done) || date; else alike.t = t; continue; }
    f.open.push({ k: keyOf(t), t, at: dayOk(x?.at) || date, ...(x?.done ? { done: dayOk(x?.done) || date } : {}) });
  }
  f.events.sort((a: any, b: any) => String(b.d).localeCompare(String(a.d)));
  f.facts = f.facts.slice(-400); f.events = f.events.slice(0, 3000); f.links = f.links.slice(-200); f.open = f.open.slice(-100);
  return f;
}

/**
 * A person's file as a model reads it: the facts that hold, the past ones,
 * links, what is open, then the history. With words to look for, the moments
 * that carry them come first, whatever their age, then the newest: a file of
 * years is read where it bears, not only at its latest page.
 */
const momentLine = (x: any) => `- ${x.d}${x.seen ? " (together)" : ""}: ${x.t}`;
/** The history as read: what bears on the words first, up to 12 moments, then the newest. */
function history(events: any[], c: any, focus: string | string[]) {
  if (!events.length) return [""];
  const names = new Set(keywords([c?.title ?? "", ...(c?.aliases ?? [])].join(" ")).map(stem));
  const want = new Set((Array.isArray(focus) ? focus : keywords(String(focus))).map(stem).filter(w => !names.has(w)));
  const score = (x: any) => keywords(String(x.t)).reduce((n, w) => n + (want.has(stem(w)) ? 1 : 0), 0);
  const bears = want.size ? events.map(x => ({ x, n: score(x) })).filter(e => e.n > 0).sort((a, b) => b.n - a.n).slice(0, 12).map(e => e.x) : [];
  const rest = events.filter(x => !bears.includes(x));
  return bears.length
    ? [`HISTORY THAT BEARS ON THIS\n${bears.map(momentLine).join("\n")}`, rest.length ? `MORE HISTORY, NEWEST FIRST\n${rest.map(momentLine).join("\n")}` : ""]
    : [`HISTORY, NEWEST FIRST\n${events.map(momentLine).join("\n")}`];
}

export function fileText(c: any, max = 3500, focus: string | string[] = []) {
  const f = c?.file;
  if (!f) return "";
  const name = (s: string) => FILE_SECTIONS.find(x => x[0] === s)?.[1] ?? s;
  const facts = (f.facts ?? []).map((x: any) => `- ${name(x.s)}, ${x.l}: ${x.v}${x.since ? ` (since ${x.since})` : ""}${x.until ? ` (until ${x.until}, no longer true)` : ""}`);
  const lines = [
    facts.length ? `FACTS\n${facts.join("\n")}` : "",
    (f.links ?? []).length ? `LINKED TO: ${f.links.map((x: any) => `${x.n}${x.r ? ` (${x.r})` : ""}`).join("; ")}` : "",
    (f.open ?? []).filter((x: any) => !x.done).length ? `STILL OPEN: ${f.open.filter((x: any) => !x.done).map((x: any) => x.t).join("; ")}` : "",
    f.seen ? `LAST SEEN: ${f.seen}` : "",
    ...history(f.events ?? [], c, focus),
  ].filter(Boolean).join("\n");
  return lines.length > max ? lines.slice(0, max) + "\n(older history left out)" : lines;
}

