/**
 * The four steps of a drop, with no transport around them.
 *
 * Two callers run exactly this code: the app, through the /api/drop routes, and
 * a signed connector, through the MCP write tools. Keeping one copy is what
 * stops the two from drifting into different rules about what gets stored.
 *
 * Each function takes the caller (who), the payload (b), and the model key and
 * model name already resolved, because an MCP call carries no request body to
 * read them from. One model call per function: several inside one request run
 * past the response deadline.
 */

import { internal } from "./_generated/api";
import {
  ask, parseJson, today, slug, linkKey, sourceId, canDrop, CHUNK, MENTIONS, HOME,
} from "./lib";
import type { Who } from "./lib";
import { keywords, rankConcepts, linkId, conceptSlug, compress, unionCap } from "./words";
export { compress } from "./words";

/* ---------- the rules, named so two thinkers can share them ---------- */

/**
 * Every prompt below is exported.
 *
 * The app pays a model on OpenRouter to follow them. A connector hands them to
 * the client's own model instead, which costs this deployment nothing. Same
 * rules either way, and the writing side validates whatever comes back, so the
 * thinker can change without the brain's rules changing.
 */

export const READ_SYSTEM =
  "You extract source material. You write in English whatever language the source is in, " +
  "except inside quotes, which stay exact in the original. You reply with JSON only.";

export const READ_RULES =
`Extract everything worth keeping from this source. Cover EVERY topic present, whether or not it looks relevant. This is the only read, so nothing gets a second pass.

Keep ideas, numbers, names, dates, reasoning chains, exact quotes and historical comparisons. Drop repetition, advertising, small talk and filler.

Write every field in English, whatever language the source uses. The one exception is "quotes", where text stays exact in the original language, because a translated quote stops being evidence.

Reply with only JSON:
{"title":"","author":"","date":"YYYY-MM-DD or empty","kind":"study|argument","topics":[{"topic":"","ideas":[""],"data":[""]}],"quotes":[{"text":"","speaker":""}],"thin":[""]}

"thin" holds only opinions or predictions asserted with nothing behind them. A definition, a rule, a method, a procedure, a formula, a framework or a worked example is knowledge, not thin: it goes in "ideas" even with no number attached. A document that teaches is made of these.

Keep one topic per distinct subject the source covers. A source that teaches twelve things has twelve topics, not one topic called after the document.

"kind" says what the source is:
"study" when it teaches or lists rules, formulas, methods or definitions: a course, textbook, syllabus, formula sheet, manual, exam material, documentation.
"argument" when it argues, tells or reports: a video, interview, podcast, article, essay, opinion piece, news.`;

export const PLAN_SYSTEM =
  "You file sources into a knowledge base. You write in English. You reply with JSON only.";

export const PLAN_RULES =
`Decide where this source goes and what it changes. Use ONLY the brains listed.

RULES
- Propose every brain it belongs to. A subject brain holds the user's own position. A person brain holds one person's view.
- A concept belongs to a brain only if it fits that brain's scope line.
- "new" = ideas, numbers or reasoning the brains lack.
- "echo" = what this repeats, naming the earlier source.
- "conflict" = a claim contradicting a stored position. Rank each: "flip" if it would change the position, "caveat" if it only adds nuance.
- In a PERSON brain, a claim contradicting that same person's earlier view is drift, not conflict. Mark it kind "drift".
- Thin means an opinion or prediction asserted with nothing behind it. Only those stay out of concepts. A definition, rule, method, procedure, formula, framework or worked example is knowledge and gets filed, number or not.
- ONE CONCEPT PER DISTINCT IDEA a reader could look up on its own. Never fold several into one umbrella concept named after the document or its subject.
- The grain follows SOURCE KIND, stated under THE NEW SOURCE:
  study: every rule, formula, method, definition and worked procedure is its own concept, so each can be asked about exactly. Two formulas are two concepts. Nearly every topic gets its own entry.
  argument: passages arguing the same idea from several angles are one concept. File the ideas, not the passages.
  unknown: judge from the topics which of the two the source is.
- Before replying, walk every "###" topic under THE NEW SOURCE. Each one ends up under "matched" or "candidates", unless it falls outside every brain's scope or is thin.
- "matched" = an EXISTING concept this source adds to. Copy its id exactly as listed below, in the form brain/slug. One entry per concept touched. "whatItAdds" says what this source contributes to it.
- "candidates" = a NEW concept this source argues for, one no listed concept covers. Give a short title, the brain slug it belongs in, and why.
- EVERY item in "new" MUST also be filed: under "matched" when a listed concept covers it, under "candidates" when none does. An idea belonging to no concept and needing no new one is thin, not new.
- So "matched" and "candidates" are both empty only when "new" is empty too.
- "related" links a concept to up to 4 others it builds on, explains, or is used with: a listed concept by its id brain/slug, or a candidate proposed in this reply by brain/its title. Leave it empty when nothing connects. These links are how an answer moves from one concept to the next.

Reply with only JSON:
{"brains":["id"],
 "matched":[{"conceptId":"","brain":"","whatItAdds":"","related":["brain/slug"]}],
 "candidates":[{"title":"","brain":"","why":"","related":["brain/slug"]}],
 "new":[""],
 "echo":[{"claim":"","repeatsSource":""}],
 "conflicts":[{"concept":"","conceptId":"","brain":"","kind":"flip|caveat|drift","says":"","saysDate":"","stored":"","storedDate":"","why":""}]}`;

export const REWRITE_SYSTEM =
  "You maintain a knowledge base. You write in English. You reply with JSON only.";

/** What the planner is shown: every brain it may feed, and the source itself. */
/* The concept list the plan matches against stays under this, so a batch costs
   the same at 50 concepts and at 5000. Below it, every concept is listed. */
const PLAN_LIST_CHARS = 60000;
/* Past that: the closest concepts with their summary, every other one by
   title, up to 1,000 concepts listed. At 1,000 that is about 30,000 tokens. */
const PLAN_FULL_CHARS = 36000, PLAN_MAX = 1000;

export function planContext(pool: any[], concepts: any[], sources: any[], ext: any) {
  const line = (c: any) => `- id=${c.brain}/${c.slug} | ${c.title}: ${c.summaryLine || c.position || c.lead || "no position yet"}`;
  const bare = (c: any) => `- id=${c.brain}/${c.slug} | ${c.title}`;
  const all = concepts.filter((c: any) => pool.some((b: any) => b.slug === c.brain));
  const full = new Set<any>(all), titled = new Set<any>();
  if (all.reduce((n: number, c: any) => n + line(c).length + 1, 0) > PLAN_LIST_CHARS) {
    /* Too many to list whole. The ones sharing words with this batch of the
       source come with their summary line, and every other one still comes by
       title, up to PLAN_MAX in all, so an idea the brain holds is matched
       rather than filed a second time. Past PLAN_MAX, the closest are listed. */
    const words = keywords((ext?.topics ?? []).map((t: any) => `${t.topic} ${(t.ideas ?? []).join(" ")}`).join(" "));
    full.clear();
    let used = 0;
    for (const { c } of rankConcepts(all, words, pool)) {
      if (full.size + titled.size >= PLAN_MAX) break;
      const n = line(c).length + 1;
      if (used + n <= PLAN_FULL_CHARS) { full.add(c); used += n; }
      else titled.add(c);
    }
  }
  const summaries = pool.map((br: any) => {
    const own = concepts.filter((c: any) => c.brain === br.slug);
    const cs = own.filter((c: any) => full.has(c) || titled.has(c)).sort((x: any, y: any) => x.n - y.n);
    const hidden = own.length - cs.length;
    return `## ${br.name} [${br.type}] id=${br.slug}\nscope: ${br.scope}\n` +
      (cs.length ? cs.map((c: any) => full.has(c) ? line(c) : bare(c)).join("\n") : own.length ? "" : "- no concepts yet") +
      (hidden ? `\n- ${hidden} more concepts, not listed because they share no words with this part of the source` : "");
  }).join("\n\n");
  const recent = sources.slice(-40).map((s: any) => `${s.sid} | ${s.author || "?"} | ${s.title || ""}`).join("\n") || "none";

  return `
BRAINS AND THEIR CONCEPTS
${summaries}

EARLIER SOURCES
${recent}

THE NEW SOURCE
SOURCE KIND: ${ext?.kind === "study" || ext?.kind === "argument" ? ext.kind : "unknown"}
title: ${ext?.title ?? ""}
author: ${ext?.author ?? ""}
date: ${ext?.date ?? ""}
${(ext?.topics ?? []).map((t: any) => `### ${t.topic}\n${(t.ideas ?? []).join("\n")}\n${(t.data ?? []).join("\n")}`).join("\n\n").slice(0, 30000)}`;
}

export const REWRITE_RULES =
`Rewrite each position below from its WHOLE evidence list, now carrying the new source. Re-derive, never append. A position that reads as a list of who said what has failed.

RULES
- One view per position, a few lines, stating what holds.
- Obey MY DECISION on every concept that carries one. It is the owner's ruling, so it outranks your own reading of the evidence.
- NEW means the position flips to the new claim, and the old view moves into evidence with its date.
- OLD means the stored position holds, and the new claim joins the evidence as a minority view.
- BOTH means the position holds and the clash goes into open conflicts, dated, with the reason.
- Never delete a view.
- English, always. No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording.
- summaryLine is ONE line, under 18 words.
- data lists only NEW figures from this source. STORED DATA is kept for you, so never repeat it.
- conflicts lists only NEW clashes. OPEN CONFLICTS are kept for you, so never repeat them.

Reply with only JSON:
{"rewrites":[{"conceptId":"","position":"","summaryLine":"","data":[""],"conflicts":[{"a":"","aDate":"","b":"","bDate":"","why":""}]}]}`;

/** The brains a caller may feed in their own space, and the ones the plan was
    pointed at. */
export async function feedable(ctx: any, who: Who, brain?: string) {
  const { brains: seen, cards: concepts, sources } = await ctx.runQuery(internal.store.cardsOf, { space: who.space });
  const brains = seen.filter((x: any) => canDrop(x, who));
  const only = brain && brain !== "all" ? String(brain) : null;
  const pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  return { brains, concepts, sources, pool };
}

/**
 * Pull a page's readable text.
 *
 * It writes nothing, yet it sits behind a token anyway: an open fetcher would
 * make this deployment a proxy for anyone who found the address. Private and
 * link-local hosts are refused, because the only reason to aim this at one is
 * to read something the caller could not reach themselves.
 *
 * Nothing fetched is stored. The text goes to the caller, who decides what is
 * worth keeping, and only that extraction ever reaches a brain.
 */
const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|::1$)/i;

/** A host a fetch may reach: named, public, never this network's own. */
function publicHost(host: string): boolean {
  if (PRIVATE_HOST.test(host) || host.endsWith(".internal") || host.endsWith(".local") || !host.includes(".")) return false;
  /* The shared address range carriers use inside their own networks. */
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return false;
  return true;
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com)$/i;

const CAP = 60000;

/**
 * A video's own captions, through Supadata.
 *
 * YouTube hands captions to a signed-in browser and to nothing else, which a
 * deployment is not. Supadata fetches them on its own infrastructure and this
 * asks it for the text. Unset key means the paste instruction, so a deployment
 * without one behaves exactly as it did before.
 *
 * mode=native is the default because it costs one credit and only returns
 * captions that already exist. mode=auto falls back to generating them from the
 * audio at 2 credits per minute, so a one hour video costs 120 credits instead
 * of 1. That is a bill worth asking for on purpose.
 */
const SUPADATA_HOST =
  /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)$/i;

async function videoTranscript(ctx: any, url: string, host: string): Promise<any | null> {
  const key = (process.env.SUPADATA_API_KEY ?? "").trim();
  if (!key) return null;
  /* Supadata covers these. The rest keep the paste instruction rather than
     spending a credit on a refusal. */
  if (!SUPADATA_HOST.test(host)) return null;

  const mode = (process.env.SUPADATA_MODE ?? "native").trim() === "auto" ? "auto" : "native";
  /* Timed chunks rather than one string, because each chunk is a caption cue
     and one cue per line is the shape a pasted transcript arrives in. Asking
     for text=true returns the same words with every break removed, and the
     reader then faces one unbroken run tens of thousands of characters long. */
  const ask = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&mode=${mode}`;

  /* A deadline, because the caller's own is three minutes and a hang there
     spends all of it to say nothing useful. Generating a transcript from audio
     is slower than reading one, so the wait allowed depends on which was asked
     for. */
  let r: Response;
  try {
    r = await fetch(ask, {
      headers: { "x-api-key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(mode === "auto" ? 120000 : 45000),
    });
  } catch (e: any) {
    const why = String(e?.name === "TimeoutError" || e?.name === "AbortError"
      ? `it did not answer within ${mode === "auto" ? 120 : 45} seconds`
      : String(e?.message ?? e).slice(0, 140));
    return await note(ctx, host, false, 0, "no answer", { error: [
      `the transcript service did not answer: ${why}.`,
      `Paste the transcript with the link instead.`,
    ].join("\n") });
  }

  const raw = await r.text();
  let d: any = {};
  try { d = JSON.parse(raw); } catch { /* an error page, handled below */ }

  if (!r.ok) {
    const why = String(d?.message ?? d?.error ?? raw).slice(0, 200);
    if (r.status === 402 || r.status === 429) {
      return await note(ctx, host, false, 0, "out of credits",
        { error: `the transcript service is out of credits or rate limited: ${why}` });
    }
    if (r.status === 401 || r.status === 403) {
      return await note(ctx, host, false, 0, "key refused",
        { error: `the transcript service refused the key: ${why}` });
    }
    /* No captions on the video, which is the common case for a 404 here. */
    return await note(ctx, host, false, 0, "no captions", { error: [
      `${host} has no transcript to fetch for that video: ${why}`,
      `Paste the text with the link instead.`,
    ].join("\n") });
  }

  /* One cue per line. A plain string still arrives when the service decides to
     send one, and it keeps whatever breaks it came with. */
  const body = Array.isArray(d?.content)
    ? d.content.map((c: any) => String(c?.text ?? "").trim()).filter(Boolean).join("\n")
    : String(d?.content ?? "");
  /* Runs of spaces collapse, line breaks stay. They are the only structure an
     auto-caption has, and the reader needs it. */
  const clean = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < 200) {
    return await note(ctx, host, false, clean.length, "too short", { error: [
      `the transcript came back with ${clean.length} characters, which is too little to read.`,
      `Paste the text with the link instead.`,
    ].join("\n") });
  }
  return await note(ctx, host, true, clean.length, mode,
    { url, chars: clean.length, cut: clean.length > CAP, text: clean.slice(0, CAP),
      lang: d?.lang ?? "" });
}

/** Record the attempt, then hand back the answer unchanged. */
async function note(ctx: any, host: string, ok: boolean, chars: number, why: string, out: any) {
  try { await ctx.runMutation(internal.store.logFetch, { host, ok, chars, why }); }
  catch { /* the count is a convenience, never a reason to fail a drop */ }
  return out;
}

export async function fetchPage(ctx: any, raw: string): Promise<any> {
  const want = raw.trim();
  let u: URL;
  try { u = new URL(want); }
  catch { return { error: `"${want.slice(0, 60)}" is not a full address. Include https://` }; }
  if (u.protocol !== "https:") return { error: "Only https addresses are fetched." };
  const host = u.hostname.toLowerCase();
  if (!publicHost(host)) return { error: `${host} is not a public address.` };
  if (VIDEO_HOST.test(host)) {
    const t = await videoTranscript(ctx, u.toString(), host);
    if (t) return t;
    /* No service reached it. Which of the two reasons applies matters: one is
       how this host works, the other is a setting that looks done and is not. */
    const covered = SUPADATA_HOST.test(host);
    const keyed = !!(process.env.SUPADATA_API_KEY ?? "").trim();
    return { error: [
      `${host} serves captions only to a signed-in browser, so a fetched page carries none.`,
      ...(covered && !keyed
        ? [`A transcript service could fetch it, and none is configured on this deployment.`,
           `SUPADATA_API_KEY is empty here. Set it with --prod, because a key set without that`,
           `flag lands on the dev deployment while the live site reads production.`]
        : []),
      `Open the transcript panel under the video, copy it, and drop that text with the link.`,
      `The link is what catches a repeat later.`,
    ].join("\n") };
  }

  let r: Response;
  try {
    /* Redirects are followed by hand, so every hop passes the same check as
       the first address: a public page cannot bounce the fetch inward. */
    const deadline = AbortSignal.timeout(25000);
    let at = u;
    for (let hop = 0; ; hop++) {
      r = await fetch(at.toString(), {
        redirect: "manual",
        signal: deadline,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OctopusBrains/1.0; +https://brain.jeremylasne.com/doc)",
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9",
          "Accept-Language": "en,*;q=0.5",
        },
      });
      const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!next) break;
      if (hop >= 5) return { error: `${host} redirected more than 5 times. Paste the text instead.` };
      at = new URL(next, at);
      if (at.protocol !== "https:" || !publicHost(at.hostname.toLowerCase())) {
        return { error: `${host} redirected to ${at.hostname}, which is not a public https address.` };
      }
    }
  } catch (e: any) {
    const why = e?.name === "TimeoutError" || e?.name === "AbortError"
      ? "it did not answer within 25 seconds"
      : String(e?.message ?? e).slice(0, 140);
    return { error: `${host} did not answer: ${why}. Paste the text instead.` };
  }
  if (!r.ok) {
    return { error: `${host} answered ${r.status}. ` +
      (r.status === 401 || r.status === 403
        ? "That page sits behind a login or a bot check, so paste the text instead."
        : "Paste the text instead.") };
  }
  const kind = (r.headers.get("content-type") ?? "").toLowerCase();
  if (!kind.includes("html") && !kind.includes("text/plain")) {
    return { error: `That address serves ${kind || "something that is not a web page"}. ` +
      `This reads web pages. A file is read directly instead, so attach it.` };
  }

  const body = await r.text();
  const clean = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|nav|footer|header|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

  if (clean.length < 200) {
    return { error: `${host} returned almost no text, which usually means the page builds itself in the ` +
      `browser. Paste what you read instead.` };
  }
  return { url: u.toString(), chars: clean.length,
           cut: clean.length > CAP, text: clean.slice(0, CAP) };
}


/** R1.2 runs before anything expensive, so a repeat costs zero pasting. */
export async function dropCheck(ctx: any, b: any, space: string = HOME) {
  const link = String(b.link ?? "");
  /* A space other than home prefixes its ids, so the same link dropped in both
     spaces makes two sources, each with its own note. */
  const base = sourceId(link, String(b.text ?? ""));
  const sid = space === HOME ? base : `${space}-${base}`;
  const found = await ctx.runQuery(internal.store.findSource, { linkKey: linkKey(link), sid, space });
  return found
    ? { duplicate: true, sid: found.sid, date: found.date, brains: found.brains,
        title: found.title, author: found.author, link: found.link }
    : { duplicate: false, sid };
}

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
export async function dropRead(ctx: any, who: Who, b: any, key?: string, model?: string) {
  const part = Number(b.part ?? 1), total = Number(b.total ?? 1);
  /* ONE model call per request. Several inside one request runs past the
     response deadline, and the caller sees a dead connection rather than an
     error, so the caller loops instead. Any size up to the ceiling is fine:
     the budget below, not the input size, was the original failure. */
  const chunk = String(b.chunk ?? "");
  if (!chunk) return { error: "that part was empty" };
  if (chunk.length > CHUNK * 4) {
    return { error: `that part is ${chunk.length} characters. Reload the page, which splits a source into ${CHUNK} character passes.` };
  }

  const { text, finish } = await ask([
    { role: "system", content: READ_SYSTEM },
    { role: "user", content:
`${READ_RULES}

SOURCE${total > 1 ? ` (part ${part} of ${total})` : ""}:
${chunk}` },
  ], { json: true, maxTokens: 24000, key, model });
  return { part: parseJson(text, finish) };
}

/** R3. Summaries only, never whole brains, so this costs the same at any size. */
export async function dropPlan(ctx: any, who: Who, b: any, key?: string, model?: string) {
  const { brains: seen, cards: concepts, sources } = await ctx.runQuery(internal.store.cardsOf, { space: who.space });
  /* Only brains this caller may feed. Everyone reads more than they can write. */
  const brains = seen.filter((x: any) => canDrop(x, who));
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  let pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  /* Filing a stored source into a second brain. The brains already holding it
     drop out, so the plan proposes somewhere new rather than rewriting the same
     positions with a source they already carry. */
  const held: string[] = Array.isArray(b.exclude) ? b.exclude.map(String) : [];
  if (held.length) pool = pool.filter((x: any) => !held.includes(x.slug));
  if (!pool.length) {
    return { error: held.length
      ? "every brain you can feed already holds this source."
      : "no brain exists yet" };
  }

  const ext = b.ext ?? {};

  /* A long source is planned in batches of topics, one request each. A batch
     sees the titles the earlier ones proposed, so an idea spread across the
     document lands under one name instead of three near-duplicates. */
  const proposed: string[] = Array.isArray(b.proposed) ? b.proposed.map(String).slice(0, 400) : [];
  const SO_FAR = proposed.length ? `
ALREADY PROPOSED FROM THIS SOURCE, in earlier batches
${proposed.join("\n")}
When an idea below belongs under one of these, propose it as a candidate with that exact title and brain, rather than a new name.
` : "";

  const { text, finish } = await ask([
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content:
`${PLAN_RULES}
${SO_FAR}${planContext(pool, concepts, sources, ext)}` },
  ], { json: true, maxTokens: 16000, key, model });

  return { plan: parseJson(text, finish) };
}

/**
 * The part of the source a batch of concepts needs, within 20,000 characters.
 *
 * The rewrite used the first 20,000 characters of the extraction, so concepts
 * from late in a long document were rewritten without their own numbers. The
 * topics sharing the most words with this batch's titles and additions go in
 * first, then the rest in order while room remains. Kept in document order.
 */
export function excerptFor(topics: any[], touched: any[], limit = 20000): string {
  const words = (s: string) => new Set(String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const want = new Set<string>();
  for (const { c, adds } of touched) for (const w of words(`${c.title} ${adds ?? ""}`)) want.add(w);
  const rows = topics.map((t: any, i: number) => {
    const text = `${t.topic}: ${(t.ideas ?? []).join("; ")} ${(t.data ?? []).join("; ")}`;
    let hit = 0;
    for (const w of words(text)) if (want.has(w)) hit++;
    return { text, hit, i };
  });
  const picked: typeof rows = [];
  let used = 0;
  for (const r of [...rows].sort((a, b) => b.hit - a.hit || a.i - b.i)) {
    if (used + r.text.length + 1 > limit) continue;
    picked.push(r); used += r.text.length + 1;
  }
  return picked.sort((a, b) => a.i - b.i).map(r => r.text).join("\n");
}

/** Text, whatever the model sent: a list of authors, a year as a number. */
export const str = (x: any): string =>
  typeof x === "string" ? x : Array.isArray(x) ? x.map(str).filter(Boolean).join(", ")
  : x == null ? "" : typeof x === "object" ? String(x.text ?? x.name ?? x.value ?? JSON.stringify(x)) : String(x);

/** The extraction with its text fields as text, so a typed column never throws. */
function cleanExt(e: any) {
  const list = (x: any) => Array.isArray(x) ? x : x == null ? [] : [x];
  return { ...e, title: str(e.title), author: str(e.author), date: str(e.date),
           topics: list(e.topics), quotes: list(e.quotes), thin: list(e.thin).map(str).filter(Boolean) };
}

/* A database row holds 1 MiB. A note stays well under it. */
const NOTE_BYTES = 800_000;
function fitNote(n: any) {
  const size = () => JSON.stringify(n).length;
  while (size() > NOTE_BYTES && n.quotes.length > 20) n.quotes = n.quotes.slice(0, Math.floor(n.quotes.length * 0.7));
  while (size() > NOTE_BYTES && n.topics.length > 20) n.topics = n.topics.slice(0, Math.floor(n.topics.length * 0.8));
  while (size() > NOTE_BYTES && n.connections.length > 20) n.connections = n.connections.slice(0, Math.floor(n.connections.length * 0.7));
  return n;
}

/** R5. Re-derive, never append, then write. One pass, before the receipt. */
export async function dropSettle(ctx: any, who: Who, b: any, key?: string, model?: string) {
  const plan = b.plan ?? {}, sid = String(b.sid ?? "");
  /* Only what this batch touches is read: the concepts its plan names, and
     whether each new title is already a concept. */
  const ids = new Set<string>(), titles: { brain: string; title: string }[] = [];
  const planned = [...new Set<string>([...(plan.brains ?? []).map(String),
    ...(plan.candidates ?? []).map((c: any) => String(c.brain ?? "")),
    ...(plan.matched ?? []).map((m: any) => String(m.brain ?? String(m.conceptId ?? "").split("/")[0]))])].filter(Boolean);
  for (const m of plan.matched ?? []) {
    const id = String(m.conceptId ?? "");
    if (id.includes("/")) ids.add(id);
    for (const br of m.brain ? [String(m.brain)] : planned) {
      ids.add(`${br}/${slug(id)}`); ids.add(`${br}/${conceptSlug(id)}`);
    }
  }
  for (const c of plan.candidates ?? []) for (const br of [String(c.brain ?? ""), ...planned]) {
    if (br) titles.push({ brain: br, title: String(c.title ?? "") });
  }
  const read = await ctx.runQuery(internal.store.settleReads, { space: who.space, ids: [...ids], titles });
  const titleAt = (br: string, t: string) => {
    const i = titles.findIndex(x => x.brain === br && x.title === t);
    return i >= 0 ? read.byTitle[i] : null;
  };
  /* Re-checked here, because this is where the writing happens. */
  const brains = read.brains.filter((x: any) => canDrop(x, who));
  const ext = cleanExt(b.ext ?? {});
  /* A later batch of a long source sends no extraction: it is read back from
     the note the first batch wrote, rather than uploaded again each time. */
  const uploaded = Array.isArray(b.ext?.topics);
  if (!uploaded && sid) {
    const note = await ctx.runQuery(internal.store.noteBySid, { sid, space: who.space });
    if (note) Object.assign(ext, { topics: note.topics ?? [], ...(ext.kind ? {} : note.kind ? { kind: note.kind } : {}) });
  }
  /* A long source is stored in batches: the app hands in a slice of the plan
     each time, and the whole plan beside it for the note and the receipt. The
     connector hands in one plan, which is both. */
  const full = b.fullPlan ?? plan;
  const choices: Record<string, string> = b.choices ?? {};
  const may = (x: string) => brains.some((y: any) => y.slug === x);
  let targets: string[] = (plan.brains ?? []).map(String).filter(may);
  /* A plan that named its brains by name rather than id still says where each
     concept goes, through the ids it matched and the brains its candidates name. */
  if (!targets.length) {
    targets = [...new Set<string>([
      ...(plan.matched ?? []).map((m: any) => String(m.brain ?? String(m.conceptId ?? "").split("/")[0])),
      ...(plan.candidates ?? []).map((c: any) => String(c.brain ?? "")),
    ])].filter(may);
  }
  if (!targets.length) return { error: "no brain matched" };

  const touched: any[] = [];
  const missed: string[] = [];
  /* Only concepts of the brains this drop may feed. A matched id is what the
     caller sent, so a concept of a brain they cannot feed is never rewritten. */
  for (const m of (plan.matched ?? [])) {
    const id = String(m.conceptId ?? "");
    const exact = targets.includes(id.split("/")[0]) ? read.byId[id] : null;
    const bare = exact ? null : (m.brain ? [String(m.brain)] : targets).filter(br => targets.includes(br))
      .map(br => read.byId[`${br}/${slug(id)}`] ?? read.byId[`${br}/${conceptSlug(id)}`]).find(Boolean);
    const c = exact ?? bare;
    if (c) touched.push({ c, adds: m.whatItAdds, isNew: false, rel: m.related });
    else if (id) missed.push(id);
  }
  /* R5.5. A candidate is an idea the brain does not hold yet. MENTIONS separate
     sources make it a position, so an early mention is counted and kept, never
     thrown away. Two brains skip the wait: one that is still empty, and one
     where the owner picked the candidate on the card. */
  const counted: any[] = [];
  const promote: string[] = Array.isArray(b.promote) ? b.promote.map(String) : [];
  for (const cand of (plan.candidates ?? [])) {
    const br = targets.includes(cand.brain) ? cand.brain : targets[0];
    const already = titleAt(br, String(cand.title ?? ""));
    if (already) { touched.push({ c: already, adds: cand.why, isNew: false, rel: cand.related }); continue; }
    const seeding = !!read.empty[br];
    const asked = promote.includes(cand.title) || promote.includes(`${br}/${conceptSlug(cand.title)}`);
    /* At a threshold of 1 there is nothing to wait for, so the candidate is
       taken here with what the source argued as its first evidence, rather than
       through a counter that would promote it on the same call anyway. */
    if (seeding || asked || MENTIONS <= 1) {
      touched.push({ c: { brain: br, slug: conceptSlug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: [] }, adds: cand.why, isNew: true, rel: cand.related });
    } else {
      const r = await ctx.runMutation(internal.store.bumpCandidate, { brain: br, title: cand.title, sid });
      if (r.promoted) touched.push({ c: { brain: br, slug: conceptSlug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: r.notes }, adds: `promoted after ${MENTIONS} mentions`, isNew: true });
      else counted.push({ brain: br, title: cand.title, have: r.notes.length, need: MENTIONS - r.notes.length });
    }
  }

  /* One concept, one entry. The same concept reached twice, as a match and as
     a candidate folded into it, used to be written twice from one old copy,
     and the second write erased the first one's evidence. */
  const byId = new Map<string, any>();
  for (const t of touched) {
    const id = `${t.c.brain}/${t.c.slug}`;
    const had = byId.get(id);
    if (!had) { byId.set(id, t); continue; }
    had.adds = [had.adds, t.adds].filter(Boolean).join(" ").slice(0, 600);
    had.rel = [...(Array.isArray(had.rel) ? had.rel : []), ...(Array.isArray(t.rel) ? t.rel : [])];
    had.isNew = had.isNew && t.isNew;
  }
  touched.splice(0, touched.length, ...byId.values());

  /* A plan with findings that lands nowhere would write a source row and rewrite
     no position: the knowledge would vanish, and the receipt would read fine.
     Refuse and say so. A counted candidate is not that case. It landed in the
     candidate list, and it says so on the receipt. */
  const filedAny = (full.matched ?? []).length + (full.candidates ?? []).length > 0;
  if (!touched.length && !counted.length && (full.new ?? []).length > 0 && (!b.fullPlan || !filedAny)) {
    return { error:
      `the plan found ${(plan.new ?? []).length} new items and filed none of them into a concept, ` +
      `so nothing would be rewritten. Drop the source again.` };
  }

  let rewrites: any[] = [];
  if (touched.length) {
    const packet = touched.map(({ c, adds }) => {
      const br = brains.find((x: any) => x.slug === c.brain);
      const id = `${c.brain}/${c.slug}`;
      /* Each concept carries only its own decision, spelled out with the two
         claims it sits between. Sending every decision to every concept, keyed
         by a position number, gave the model nothing it could act on. */
      const mine = (plan.conflicts ?? []).filter((x: any) =>
        x.conceptId === id || [slug(x.concept ?? ""), conceptSlug(x.concept ?? "")].includes(c.slug));
      const decisions = mine.map((x: any) => {
        const pick = choices[x.conceptId ?? ""] ?? choices[`${x.brain}/${x.concept}`]
          ?? choices[x.concept ?? ""] ?? choices[id] ?? "both";
        return `${pick.toUpperCase()} on: new claims "${x.says ?? ""}" (${x.saysDate || "undated"}) ` +
               `against stored "${x.stored ?? ""}" (${x.storedDate || "undated"})`;
      });
      return `### ${id}
brain: ${br?.name} [${br?.type}], scope: ${br?.scope}
concept: ${c.title}
CURRENT POSITION: ${c.position || "none yet"}
FULL EVIDENCE LIST (newest first):
${(c.evidence ?? []).map((e: any) => `- ${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join("\n") || "- none"}
STORED DATA: ${(c.data ?? []).length ? (c.data ?? []).join(" | ") : "none"}
OPEN CONFLICTS: ${(c.conflicts ?? []).length ? (c.conflicts ?? []).map((x: any) => `${x.a ?? ""} (${x.aDate ?? "?"}) vs ${x.b ?? ""} (${x.bDate ?? "?"})`).join(" | ") : "none"}
THIS SOURCE ADDS: ${adds ?? ""}
MY DECISION: ${decisions.length ? decisions.join("\n") : "no contradiction here"}`;
    }).join("\n\n");

    const job = `${REWRITE_RULES}

CONCEPTS
${packet}

NEW SOURCE
author: ${ext.author || "unknown"} | date: ${ext.date || today()}
${excerptFor(ext.topics ?? [], touched)}`;

    /* Three ways to get the rewrites.
       - handed in: the caller's own model already did this work, so no model
         call is made here and this deployment spends nothing.
       - asked for: the caller wants the job, not the answer, so it gets the
         whole prompt back and nothing is written yet.
       - neither: the app's own path, paying a model on the caller's key. */
    if (Array.isArray(b.rewrites)) {
      rewrites = b.rewrites;
    } else if (b.packetOnly) {
      return { job, counted, positions: touched.length,
               concepts: touched.map(({ c }: any) => `${c.brain}/${c.slug}`) };
    } else {
      const { text, finish } = await ask([
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: job },
      ], { json: true, maxTokens: 24000, key, model });
      rewrites = parseJson(text, finish)?.rewrites ?? [];
    }
  } else if (b.packetOnly) {
    /* Nothing to rewrite, so there is no job. Storing it is one more call. */
    return { job: "", counted, positions: 0, concepts: [] };
  }

  /* The source and its note go first. A source of another space is refused
     here, before any concept is written, and a failure costs no concept. */
  await ctx.runMutation(internal.store.writeSource, { doc: {
    sid, link: String(b.link ?? ""), linkKey: linkKey(String(b.link ?? "")),
    title: ext.title ?? "", author: ext.author ?? "", date: ext.date || today(),
    location: String(b.location ?? "pasted, not kept"), brains: targets,
    ...(who.account ? { by: who.account } : {}),
  }, space: who.space });
  /* The whole extraction is kept, so filing into another brain later reuses
     every topic. It held 40 before, and a 229 topic document lost the rest. The
     ceilings keep one note well under a database row's 1MB. */
  if (uploaded) await ctx.runMutation(internal.store.writeNote, { space: who.space, doc: fitNote({
    sid, title: ext.title ?? "", author: ext.author ?? "", date: ext.date || today(),
    topics: (ext.topics ?? []).slice(0, 500), quotes: (ext.quotes ?? []).slice(0, 200),
    thin: (ext.thin ?? []).slice(0, 150),
    connections: [...(full.matched ?? []), ...(full.candidates ?? [])],
    findings: { new: full.new ?? [], echo: full.echo ?? [], conflicts: full.conflicts ?? [], choices,
                ...(ext.kind ? { kind: ext.kind } : {}) },
  }) });

  for (const { c, adds, rel } of touched) {
    const id = `${c.brain}/${c.slug}`;
    /* Links from this drop join the ones the concept had, as brain/slug ids,
       never to itself, twelve at most. */
    const links = Array.from(new Set([...(c.related ?? []), ...(Array.isArray(rel) ? rel : [])]
      .map((r: any) => linkId(String(r), c.brain)).filter((r: string) => r !== id))).slice(0, 12);
    const rw = rewrites.find((r: any) => r.conceptId === id || r.conceptId === c.slug) ?? {};
    const newData = Array.isArray(rw.data) ? rw.data.map(str).filter(Boolean) : [];
    /* A concept already carrying this source keeps its evidence as it is. That
       makes a resumed store, and a source read again, add nothing twice. */
    const fresh = !(c.sources ?? []).includes(sid);
    const ev = fresh
      ? [{ date: ext.date || today(), author: ext.author || "unknown", claim: String(adds ?? "").slice(0, 240), source: sid }, ...(c.evidence ?? [])]
      : (c.evidence ?? []);
    await ctx.runMutation(internal.store.upsertConcept, {
      brain: c.brain, title: c.title, slug: c.slug,
      doc: {
        position: str(rw.position) || c.position || "",
        summaryLine: str(rw.summaryLine) || c.summaryLine || "",
        evidence: compress(ev),
        /* The model's figures lead and the stored ones follow, so a rewrite
           that forgot them loses none. Conflicts the same way. */
        data: unionCap(newData, (c.data ?? []).map(str), 24, String),
        conflicts: unionCap(Array.isArray(rw.conflicts) ? rw.conflicts.filter((x: any) => x && typeof x === "object") : [],
                            c.conflicts ?? [], 12),
        sources: Array.from(new Set([...(c.sources ?? []), sid])),
        related: links,
      },
    });
  }

  /* The concepts just written are linked in the background, the same way as
     linkAll: shortlisted against the whole space, then checked by the model.
     The plan's own links only reach the concepts it listed, so a concept from
     page 5 could not link to one from page 80. This one can. */
  /* The app stores a long source in parts and asks for linking once, at the
     end, for everything it wrote. A single store links here. */
  const written = touched.map(({ c }: any) => `${c.brain}/${c.slug}`);
  if (written.length && ctx.scheduler && !b.linkLater) {
    await ctx.scheduler.runAfter(0, internal.admin.linkConcepts, { space: who.space, ids: written });
  }

  return { sid, brains: targets, positions: touched.length, counted, missed, written,
    counts: { new: (full.new ?? []).length, echo: (full.echo ?? []).length } };
}

