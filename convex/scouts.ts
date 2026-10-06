/**
 * Scouts: a folder follows the people it learns from.
 *
 * A scout is a feed: a YouTube channel, a Substack, a blog. Once a day the
 * server reads every feed and keeps each new piece as a find, with no model
 * call. The app then reads each find once against its folder, on the
 * workspace's own key, and the inbox says what it would change: the
 * positions it contradicts, the ones it backs, the ideas it adds. Dropping
 * it stays your call.
 *
 * A first read of a feed keeps its 3 newest pieces from the last 21 days, so
 * following a channel of 500 videos asks about 3, never 500.
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ask, parseJson, linkKey } from "./lib";
import { publicHost, fetchPage, plainClaim } from "./drop";
import { loadSpace } from "./space";

export type Item = { link: string; title: string; date: string; author: string };

const UA = "Mozilla/5.0 (compatible; TasuScout/1.0; +https://tasu.ai)";
const FEED_ACCEPT = "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,text/html;q=0.5";
/* A first read keeps this many, from this many days back. */
const FIRST_KEEP = 3, FIRST_DAYS = 21;
/* A later read keeps at most this many new pieces per feed. */
const LATER_KEEP = 10;

/** A public https address, its redirects checked hop by hop, read as text. */
export async function getPublic(raw: string, accept = FEED_ACCEPT): Promise<{ url: string; type: string; body: string }> {
  let at = new URL(raw);
  const deadline = AbortSignal.timeout(20000);
  for (let hop = 0; hop < 6; hop++) {
    if (at.protocol !== "https:" || !publicHost(at.hostname.toLowerCase())) throw new Error(`${at.hostname} is not a public https address`);
    const r = await fetch(at.toString(), { redirect: "manual", signal: deadline,
      headers: { "User-Agent": UA, "Accept": accept, "Accept-Language": "en,*;q=0.5" } });
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (next) { at = new URL(next, at); continue; }
    if (!r.ok) throw new Error(`${at.hostname} answered ${r.status}`);
    return { url: at.toString(), type: (r.headers.get("content-type") ?? "").toLowerCase(), body: (await r.text()).slice(0, 3_000_000) };
  }
  throw new Error(`${at.hostname} redirected more than 5 times`);
}

const decode = (t: string) => t
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const tag = (x: string, name: string) => {
  const m = x.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

/** An RSS or Atom feed: its name and its pieces, newest first. Null when it is not one. */
export function parseFeed(xml: string): { name: string; items: Item[] } | null {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return null;
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0];
  const name = tag(head, "title");
  const items: Item[] = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < 60) {
    const x = m[2];
    const alt = x.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
      || x.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
      || x.match(/<link\b[^>]*href=["']([^"']+)["']/i);
    const link = (alt ? alt[1] : tag(x, "link") || tag(x, "guid")).replace(/&amp;/g, "&").trim();
    if (!/^https:\/\//i.test(link)) continue;
    const t = Date.parse(tag(x, "published") || tag(x, "pubDate") || tag(x, "updated") || tag(x, "dc:date"));
    items.push({ link, title: tag(x, "title").slice(0, 200) || link,
      date: isNaN(t) ? "" : new Date(t).toISOString(),
      author: (tag(x, "name") || tag(x, "dc:creator") || tag(x, "author") || name).slice(0, 120) });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return { name: name.slice(0, 120), items };
}

const YT = /(^|\.)(youtube\.com|youtu\.be)$/i;

/** A YouTube channel, a handle or one of its videos, as the channel's feed. */
async function youtubeFeed(u: URL): Promise<string> {
  let id = u.pathname.match(/\/channel\/(UC[\w-]{22})/)?.[1] ?? "";
  if (!id) {
    const b = (await getPublic(u.toString(), "text/html")).body;
    id = (b.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
      || b.match(/"externalId":"(UC[\w-]{22})"/) || b.match(/itemprop="channelId" content="(UC[\w-]{22})"/)
      || b.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] ?? "";
  }
  if (!id) throw new Error("that YouTube page names no channel. Paste the channel's address, like youtube.com/@name");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

/**
 * The feed behind an address: a YouTube channel or video, a feed itself, or
 * a site whose page names its feed. A site that names none is tried at the
 * usual places: /feed, /rss and the like.
 */
export async function resolveFeed(raw: string): Promise<{ feed: string; name: string; kind: string; items: Item[] }> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("that is not a full address. Include https://"); }
  if (u.protocol === "http:") u.protocol = "https:";
  if (YT.test(u.hostname)) {
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) u = new URL(`https://www.youtube.com/watch?v=${u.pathname.slice(1)}`);
    const feed = await youtubeFeed(u);
    const got = parseFeed((await getPublic(feed)).body);
    if (!got) throw new Error("YouTube gave no feed for that channel");
    return { feed, name: got.name || "YouTube channel", kind: "youtube", items: got.items };
  }
  const first = await getPublic(u.toString());
  const direct = parseFeed(first.body);
  const base = new URL(first.url);
  if (direct) return { feed: first.url, name: direct.name || base.hostname, kind: "feed", items: direct.items };
  const tries: string[] = [];
  for (const m of first.body.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (!/rel=["']?alternate/i.test(t) || !/(rss|atom)\+xml/i.test(t)) continue;
    const h = t.match(/href=["']([^"']+)["']/i);
    if (h) { try { tries.push(new URL(h[1].replace(/&amp;/g, "&"), first.url).toString()); } catch { /* a broken href */ } }
  }
  for (const p of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]) tries.push(base.origin + p);
  for (const f of [...new Set(tries)].slice(0, 8)) {
    try {
      const r = await getPublic(f);
      const got = parseFeed(r.body);
      if (got && got.items.length) return { feed: r.url, name: got.name || base.hostname, kind: "feed", items: got.items };
    } catch { /* the next place */ }
  }
  throw new Error(`${base.hostname} has no feed to follow. Paste the address of its RSS feed, or of its YouTube channel.`);
}

/** What is new in a feed since the last read: newer than the newest seen, never a find or a source already. */
export function freshOf(items: Item[], seen: string | undefined, now: number): Item[] {
  const since = seen || new Date(now - FIRST_DAYS * 86400000).toISOString();
  return items.filter(i => i.date && i.date > since).slice(0, seen ? LATER_KEEP : FIRST_KEEP);
}

/* ---------- the store ---------- */

const pub = (s: any) => ({ id: s._id, brain: s.brain, url: s.url, feed: s.feed, name: s.name, kind: s.kind, added: s.added,
  checked: s.checked ?? "", seen: s.seen ?? "", error: s.error ?? "" });

export const scoutsOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => (await ctx.db.query("scouts").withIndex("by_space", q => q.eq("space", a.space)).collect()).map(pub),
});

export const scoutsAll = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("scouts").take(500)).map(s => ({ ...pub(s), space: s.space })),
});

export const scoutAdd = internalMutation({
  args: { space: v.string(), brain: v.string(), url: v.string(), feed: v.string(), name: v.string(), kind: v.string(), d: v.string() },
  handler: async (ctx, a) => {
    const mine = await ctx.db.query("scouts").withIndex("by_space", q => q.eq("space", a.space)).collect();
    if (mine.some(s => s.brain === a.brain && s.feed === a.feed)) return { error: `this folder already follows ${a.name}` };
    if (mine.length >= 60) return { error: "a workspace follows 60 feeds at most. Remove one first." };
    const id = await ctx.db.insert("scouts", { space: a.space, brain: a.brain, url: a.url, feed: a.feed, name: a.name, kind: a.kind, added: a.d });
    return { scout: pub(await ctx.db.get(id)) };
  },
});

/** A scout goes, with the finds still waiting on it. Dropped ones stay as history. */
export const scoutRemove = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("scouts", a.id);
    const s = id ? await ctx.db.get(id) : null;
    if (!s || s.space !== a.space) return { error: "that scout is gone" };
    for (const f of await ctx.db.query("finds").withIndex("by_scout", q => q.eq("scout", a.id)).collect())
      if (["new", "read", "failed"].includes(f.status)) await ctx.db.delete(f._id);
    await ctx.db.delete(s._id);
    return { ok: true };
  },
});

export const scoutMark = internalMutation({
  args: { id: v.string(), checked: v.string(), seen: v.optional(v.string()), error: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("scouts", a.id);
    if (!id || !(await ctx.db.get(id))) return;
    await ctx.db.patch(id, { checked: a.checked, error: a.error, ...(a.seen ? { seen: a.seen } : {}) });
  },
});

/** New pieces kept as finds, minus any this workspace found before or already holds as a source. */
export const findsAdd = internalMutation({
  args: { space: v.string(), brain: v.string(), scout: v.string(), d: v.string(),
    items: v.array(v.object({ link: v.string(), title: v.string(), date: v.string(), author: v.string() })) },
  handler: async (ctx, a) => {
    let added = 0;
    for (const i of a.items) {
      const key = linkKey(i.link);
      if (!key) continue;
      if (await ctx.db.query("finds").withIndex("by_key", q => q.eq("space", a.space).eq("key", key)).first()) continue;
      const held = await ctx.db.query("sources").withIndex("by_linkKey", q => q.eq("linkKey", key)).collect();
      if (held.some(s => (s.brains ?? []).includes(a.brain))) continue;
      await ctx.db.insert("finds", { space: a.space, brain: a.brain, scout: a.scout, link: i.link, key, title: i.title,
        date: i.date, author: i.author, status: "new", found: a.d });
      added++;
    }
    return added;
  },
});

const findPub = (f: any) => ({ id: f._id, brain: f.brain, scout: f.scout, link: f.link, title: f.title, date: f.date, author: f.author,
  status: f.status, found: f.found, read: f.read ?? null, error: f.error ?? "" });

/** The finds waiting on a call, newest first, without their text. */
export const findsOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const out: any[] = [];
    for (const st of ["new", "read", "failed"])
      for (const f of await ctx.db.query("finds").withIndex("by_space", q => q.eq("space", a.space).eq("status", st)).take(200)) out.push(findPub(f));
    return out.sort((x, y) => String(y.date || y.found).localeCompare(String(x.date || x.found))).slice(0, 200);
  },
});

export const findGet = internalQuery({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("finds", a.id);
    const f = id ? await ctx.db.get(id) : null;
    return f && f.space === a.space ? { ...findPub(f), text: f.text ?? "" } : null;
  },
});

export const findSet = internalMutation({
  args: { space: v.string(), id: v.string(), status: v.string(), read: v.optional(v.any()), text: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("finds", a.id);
    const f = id ? await ctx.db.get(id) : null;
    if (!f || f.space !== a.space) return { error: "that find is gone" };
    await ctx.db.patch(f._id, { status: a.status, ...(a.read !== undefined ? { read: a.read } : {}),
      ...(a.text !== undefined ? { text: a.text } : {}), ...(a.error !== undefined ? { error: a.error } : {}) });
    return { ok: true };
  },
});

/* ---------- reading the feeds ---------- */

/** One feed read: what is new becomes finds. A failure is kept on the scout, so Settings can say it. */
export async function sweep(ctx: any, space: string, s: any): Promise<number> {
  const now = new Date().toISOString();
  try {
    const got = parseFeed((await getPublic(s.feed)).body);
    if (!got) throw new Error("the feed did not read as RSS or Atom");
    const fresh = freshOf(got.items, s.seen || undefined, Date.now());
    const newest = got.items.reduce((m, i) => i.date > m ? i.date : m, s.seen || "");
    const added: number = fresh.length ? await ctx.runMutation(internal.scouts.findsAdd,
      { space, brain: s.brain, scout: s.id, d: now.slice(0, 10), items: fresh }) : 0;
    await ctx.runMutation(internal.scouts.scoutMark, { id: s.id, checked: now, ...(newest ? { seen: newest } : {}), error: "" });
    return added;
  } catch (e: any) {
    await ctx.runMutation(internal.scouts.scoutMark, { id: s.id, checked: now, error: String(e?.message ?? e).slice(0, 200) });
    return 0;
  }
}

/** Every feed of every workspace, once a day. Six read at once. */
export const sweepAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const all: any[] = await ctx.runQuery(internal.scouts.scoutsAll, {});
    let at = 0, found = 0;
    const one = async () => { while (at < all.length) { const s = all[at++]; found += await sweep(ctx, s.space, s); } };
    await Promise.all([one(), one(), one(), one(), one(), one()]);
    return { feeds: all.length, found };
  },
});

/* ---------- reading one find against its folder ---------- */

const READ_RULES = `A new source arrived for a folder of a knowledge base. Compare it with what the folder holds.

RULES
- summary: 2 sentences on what the source argues, with its numbers and dates.
- touches: at most 6, the concepts this source bears on most, by number. stance is "contradicts" when it says the opposite or gives a different number, "supports" when it backs the position with new evidence, "adds" when it brings a new detail or case.
- why: one line under 20 words, with the number or the claim that differs or agrees.
- fresh: at most 3 ideas the folder holds nowhere, each a short title.
- English. No em-dashes. Under 30 words per sentence. Numbers over adjectives.

Reply with only JSON:
{"summary":"","touches":[{"n":1,"stance":"contradicts","why":""}],"fresh":[""]}`;

const STANCES = new Set(["contradicts", "supports", "adds"]);

/** One find read once: its text kept, and what it would change in its folder. */
export async function readFind(ctx: any, space: string, f: any, key?: string, model?: string) {
  const page = await fetchPage(ctx, f.link);
  if (!page?.text) {
    const error = String(page?.error ?? "the page gave nothing back").slice(0, 300);
    await ctx.runMutation(internal.scouts.findSet, { space, id: f.id, status: "failed", error });
    return { error };
  }
  const { brains, cards } = await loadSpace(ctx, space);
  const b = brains.find((x: any) => x.slug === f.brain);
  const mine = cards.filter((c: any) => c.brain === f.brain).sort((x: any, y: any) => (y.ev ?? 0) - (x.ev ?? 0)).slice(0, 300);
  const list = mine.map((c: any, i: number) => `${i + 1}|${c.title}|${String(c.summaryLine || c.lead || "").replace(/\s+/g, " ").slice(0, 140)}`).join("\n");
  const { text, finish } = await ask([
    { role: "system", content: "You compare a new source with a knowledge base. You reply with JSON only." },
    { role: "user", content: `${READ_RULES}\n\nFOLDER: ${b?.name ?? f.brain}${b?.scope ? `, ${b.scope}` : ""}\nWHAT THE FOLDER HOLDS (number|title|position)\n${list || "nothing yet"}\n\n` +
      `NEW SOURCE: "${f.title}" by ${f.author || "an unknown author"}, ${String(f.date).slice(0, 10) || "undated"}\n${page.text.slice(0, 20000)}` },
  ], { json: true, maxTokens: 1500, timeout: 90000, key, model });
  const d = parseJson(String(text), finish) ?? {};
  const touches: any[] = [];
  for (const t of Array.isArray(d.touches) ? d.touches : []) {
    const c = mine[Number(t?.n) - 1];
    const stance = String(t?.stance ?? "");
    if (!c || !STANCES.has(stance) || touches.some(x => x.id === `${c.brain}/${c.slug}`)) continue;
    touches.push({ id: `${c.brain}/${c.slug}`, title: c.title, stance, why: plainClaim(String(t?.why ?? "")).slice(0, 200) });
    if (touches.length >= 6) break;
  }
  const read = {
    summary: plainClaim(String(d.summary ?? "")).slice(0, 600),
    touches,
    fresh: (Array.isArray(d.fresh) ? d.fresh : []).map((x: any) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean).slice(0, 3),
    words: (page.text.match(/\S+/g) ?? []).length,
  };
  await ctx.runMutation(internal.scouts.findSet, { space, id: f.id, status: "read", read, text: page.text.slice(0, 60000), error: "" });
  return { read };
}
