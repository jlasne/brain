/**
 * The graph: what makes each new concept worth more than the one before.
 *
 * A drop writes concepts; then, in the background, on the deployment's key:
 *
 *   1. Each concept it wrote is turned into numbers (an embedding), so links
 *      and questions find it by meaning, not only by the words it shares.
 *   2. Its closest concepts by meaning join the word shortlist for linking,
 *      and the model says what each link is: needs, causes, supports,
 *      contradicts, example of. Plain "related" otherwise.
 *   3. The new links that join two folders are read in pairs, and the model
 *      writes what follows from the two: a conclusion neither states alone,
 *      kept apart and always shown as derived.
 *   4. The folders it touched have their topics worked out again: concepts
 *      that link to each other, grouped, named and summed up.
 *
 * Each step costs what the drop wrote, never the size of the space: a new
 * concept is compared with its nearest few, and the value comes from the
 * paths those few open.
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ask, parseJson, readSpace, today, OPENROUTER } from "./lib";
import { idOf } from "./words";

/* ---------- embeddings ---------- */

/* Multilingual, so a question in French meets a concept written in English.
   About $0.01 per million tokens: a whole space of 1,000 concepts costs a
   fraction of a cent. */
export const EMBED_MODEL = "baai/bge-m3";
export const EMBED_DIMS = 1024;

/** The text a concept is known by: its title, its line and the start of its position. */
export const embedText = (c: any) =>
  [c.title, c.summaryLine, String(c.position ?? c.lead ?? "").slice(0, 400)].filter(Boolean).join(". ").slice(0, 1200);

/** Numbers for each text, in order. Throws when the host refuses. */
export async function embed(texts: string[], key?: string): Promise<number[][]> {
  const k = key || process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("no model key for embeddings");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fetch(`${OPENROUTER}/embeddings`, {
      method: "POST",
      headers: { Authorization: "Bearer " + k, "Content-Type": "application/json", "X-Title": "Octopus" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.slice(i, i + 64) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`embeddings refused (${r.status}): ${(await r.text()).slice(0, 160)}`);
    const d: any = await r.json();
    const rows = (d?.data ?? []).slice().sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0)).map((x: any) => x.embedding);
    if (rows.length !== Math.min(64, texts.length - i) || rows.some((x: any) => !Array.isArray(x) || x.length !== EMBED_DIMS)) {
      throw new Error("embeddings came back short");
    }
    out.push(...rows);
  }
  return out;
}

/** One vector per concept, replaced when the concept is embedded again. */
export const putVectors = internalMutation({
  args: { items: v.array(v.object({ cid: v.id("concepts"), brain: v.string(), vec: v.array(v.float64()) })) },
  handler: async (ctx, a) => {
    for (const it of a.items) {
      const had = await ctx.db.query("vectors").withIndex("by_cid", q => q.eq("cid", it.cid)).unique();
      if (had) await ctx.db.patch(had._id, { brain: it.brain, vec: it.vec });
      else await ctx.db.insert("vectors", it);
    }
  },
});

/** The concepts behind a list of vector rows, as brain/slug ids, gone ones left out. */
export const vectorOwners = internalQuery({
  args: { ids: v.array(v.id("vectors")) },
  handler: async (ctx, a) => {
    const out: (string | null)[] = [];
    for (const id of a.ids) {
      const row = await ctx.db.get(id);
      const c = row ? await ctx.db.get(row.cid) : null;
      out.push(c ? `${c.brain}/${c.slug}` : null);
    }
    return out;
  },
});

/**
 * Embed some concepts and keep their vectors. Returns the vectors by id, so a
 * caller can look for neighbours at once. A concept that is gone is skipped.
 */
export async function embedConcepts(ctx: any, space: string, ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i += 64) {
    const cs: any[] = await ctx.runQuery(internal.store.conceptsByIds, { space, ids: ids.slice(i, i + 64) });
    if (!cs.length) continue;
    const vecs = await embed(cs.map(embedText));
    await ctx.runMutation(internal.graph.putVectors, { items: cs.map((c, k) => ({ cid: c._id, brain: c.brain, vec: vecs[k] })) });
    cs.forEach((c, k) => out.set(idOf(c), vecs[k]));
  }
  return out;
}

/**
 * The concepts closest in meaning to a vector, among some folders, best first.
 * Convex reads at most 256; a folder list too long to filter in one search is
 * searched in groups.
 */
export async function nearest(ctx: any, vec: number[], brains: string[], limit = 8): Promise<{ id: string; score: number }[]> {
  if (!brains.length || !ctx.vectorSearch) return [];
  const hits: { _id: any; _score: number }[] = [];
  for (let i = 0; i < brains.length; i += 16) {
    const group = brains.slice(i, i + 16);
    hits.push(...await ctx.vectorSearch("vectors", "by_vec", {
      vector: vec, limit: Math.min(256, limit + 4),
      filter: (q: any) => group.length === 1 ? q.eq("brain", group[0]) : q.or(...group.map(b => q.eq("brain", b))),
    }));
  }
  hits.sort((a, b) => b._score - a._score);
  const top = hits.slice(0, limit + 4);
  const owners: (string | null)[] = await ctx.runQuery(internal.graph.vectorOwners, { ids: top.map(h => h._id) });
  const seen = new Set<string>();
  return top.map((h, i) => ({ id: owners[i], score: h._score }))
    .filter((x): x is { id: string; score: number } => !!x.id && !seen.has(x.id) && !!seen.add(x.id)).slice(0, limit);
}

/* ---------- topics ---------- */

/**
 * The groups a folder's concepts fall into, by their links: label propagation,
 * each concept taking the label most of its neighbours hold, in a fixed order
 * so the same graph gives the same groups. A link counts 1, two concepts from
 * one small source count half. Groups of three or more are kept, the largest
 * first, twelve at most.
 */
export function groupsOf(cards: any[]): string[][] {
  const ids = cards.map(idOf).sort();
  const at = new Set(ids);
  const edges = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, w: number) => {
    if (a === b || !at.has(a) || !at.has(b)) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const m = edges.get(x) ?? edges.set(x, new Map()).get(x)!;
      m.set(y, (m.get(y) ?? 0) + w);
    }
  };
  for (const c of cards) for (const r of c.related ?? []) link(idOf(c), String(r).includes("/") ? String(r) : `${c.brain}/${r}`, 1);
  const bySource = new Map<string, string[]>();
  for (const c of cards) for (const s of c.srcIds ?? c.sources ?? []) (bySource.get(s) ?? bySource.set(s, []).get(s)!).push(idOf(c));
  for (const members of bySource.values()) {
    if (members.length < 2 || members.length > 15) continue;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) link(members[i], members[j], 0.5);
  }
  const label = new Map(ids.map(id => [id, id]));
  for (let round = 0; round < 12; round++) {
    let moved = 0;
    for (const id of ids) {
      const m = edges.get(id); if (!m) continue;
      const votes = new Map<string, number>();
      for (const [n, w] of m) votes.set(label.get(n)!, (votes.get(label.get(n)!) ?? 0) + w);
      let best = label.get(id)!, bw = votes.get(best) ?? 0;
      for (const [l, w] of [...votes.entries()].sort((p, q) => p[0] < q[0] ? -1 : 1)) if (w > bw) { best = l; bw = w; }
      if (best !== label.get(id)) { label.set(id, best); moved++; }
    }
    if (!moved) break;
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) (groups.get(label.get(id)!) ?? groups.set(label.get(id)!, []).get(label.get(id)!)!).push(id);
  return [...groups.values()].filter(g => g.length >= 3).sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1)).slice(0, 12);
}

const overlap = (a: string[], b: string[]) => {
  const s = new Set(a); let both = 0; for (const x of b) if (s.has(x)) both++;
  return both / (a.length + b.length - both || 1);
};

export const topicsOf = internalQuery({
  args: { brain: v.string() },
  handler: async (ctx, a) => await ctx.db.query("topics").withIndex("by_brain", q => q.eq("brain", a.brain)).collect(),
});

export const setTopics = internalMutation({
  args: { space: v.string(), brain: v.string(), topics: v.array(v.object({ title: v.string(), summary: v.string(), members: v.array(v.string()) })) },
  handler: async (ctx, a) => {
    for (const t of await ctx.db.query("topics").withIndex("by_brain", q => q.eq("brain", a.brain)).collect()) await ctx.db.delete(t._id);
    for (const t of a.topics) await ctx.db.insert("topics", { space: readSpace(a.space), brain: a.brain, ...t, updated: today() });
  },
});

/**
 * A folder's topics worked out again. A group that barely changed keeps its
 * name and summary, so only new or reshaped groups cost a model call, all of
 * a folder's in one.
 */
export async function buildTopics(ctx: any, space: string, brain: any, cards: any[], meter?: (usage: any) => void) {
  const own = cards.filter((c: any) => c.brain === brain.slug);
  const groups = groupsOf(own);
  const was: any[] = await ctx.runQuery(internal.graph.topicsOf, { brain: brain.slug });
  const byId = new Map(own.map((c: any) => [idOf(c), c]));
  const keep: { title: string; summary: string; members: string[] }[] = [];
  const fresh: string[][] = [];
  for (const g of groups) {
    const same = was.find(t => overlap(t.members, g) >= 0.7);
    if (same) keep.push({ title: same.title, summary: same.summary, members: g });
    else fresh.push(g);
  }
  if (fresh.length) {
    const list = fresh.map((g, i) => `### ${i + 1}\n` + g.slice(0, 25).map(id => {
      const c = byId.get(id); return `- ${c?.title}: ${c?.summaryLine || String(c?.lead ?? "").slice(0, 120)}`;
    }).join("\n")).join("\n\n");
    try {
      const { text, finish } = await ask([
        { role: "system", content: "You name the themes of a knowledge base. You reply with JSON only." },
        { role: "user", content: `Each numbered group below is concepts of the folder "${brain.name}" (${brain.scope}) that link to each other.

For each group give:
- "title": the theme in 2 to 5 words, in English, plain, no colon.
- "summary": one sentence under 25 words saying what the group holds and why it matters, with a number when the concepts carry one.

Reply with only JSON: {"topics":[{"n":1,"title":"","summary":""}]}

${list}` },
      ], { json: true, maxTokens: 1500, timeout: 90000, temperature: 0.2, meter });
      const got = parseJson(String(text), finish)?.topics;
      for (const [i, g] of fresh.entries()) {
        const t = (Array.isArray(got) ? got : []).find((x: any) => Number(x?.n) === i + 1);
        const title = String(t?.title ?? "").trim().slice(0, 60);
        if (title) keep.push({ title, summary: String(t?.summary ?? "").trim().slice(0, 240), members: g });
      }
    } catch (e: any) {
      console.log(`topics for ${brain.slug} skipped: ${String(e?.message ?? e).slice(0, 160)}`);
      if (!keep.length) return 0;
    }
  }
  keep.sort((a, b) => b.members.length - a.members.length);
  await ctx.runMutation(internal.graph.setTopics, { space, brain: brain.slug, topics: keep });
  return keep.length;
}

/* ---------- what follows ---------- */

/* The kinds that carry a conclusion best come first. */
const TYPE_RANK: Record<string, number> = { causes: 5, contradicts: 4, supports: 3, needs: 2, example: 1, related: 0 };

export const insightKey = (a: string, b: string) => [a, b].sort().join("|");

export const insightsFor = internalQuery({
  args: { space: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const out = new Map<string, any>();
    for (const id of a.ids.slice(0, 60)) {
      for (const ix of ["by_a", "by_b"] as const) {
        for (const r of await ctx.db.query("insights").withIndex(ix, (q: any) => q.eq(ix === "by_a" ? "a" : "b", id)).take(10)) {
          if (r.space === space) out.set(r.key, { a: r.a, b: r.b, type: r.type, title: r.title, text: r.text, at: r.at });
        }
      }
    }
    return [...out.values()];
  },
});

export const putInsights = internalMutation({
  args: { space: v.string(), items: v.array(v.object({ a: v.string(), b: v.string(), type: v.string(), title: v.string(), text: v.string() })) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    let n = 0;
    for (const it of a.items) {
      const key = insightKey(it.a, it.b);
      const had = await ctx.db.query("insights").withIndex("by_key", q => q.eq("key", key)).unique();
      if (had) await ctx.db.patch(had._id, { ...it, space, key, at: today() });
      else { await ctx.db.insert("insights", { ...it, space, key, at: today() }); n++; }
    }
    return n;
  },
});

/**
 * What follows from linked pairs of concepts across two folders. Up to five a
 * drop, the kinds that carry a conclusion first, in one model call. A pair
 * whose two concepts only restate each other gets nothing.
 */
export async function writeInsights(ctx: any, space: string, pairs: { a: string; b: string; type: string }[], max = 5, meter?: (usage: any) => void) {
  const seen = new Set<string>();
  const pick = pairs.filter(p => p.a.split("/")[0] !== p.b.split("/")[0])
    .sort((x, y) => (TYPE_RANK[y.type] ?? 0) - (TYPE_RANK[x.type] ?? 0))
    .filter(p => { const k = insightKey(p.a, p.b); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
  if (!pick.length) return 0;
  const cs: any[] = await ctx.runQuery(internal.store.conceptsByIds, { space, ids: [...new Set(pick.flatMap(p => [p.a, p.b]))] });
  const byId = new Map(cs.map((c: any) => [idOf(c), c]));
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  const nameOf = (slug: string) => head.brains.find((b: any) => b.slug === slug)?.name ?? slug;
  const rows = pick.filter(p => byId.has(p.a) && byId.has(p.b));
  if (!rows.length) return 0;
  const job = rows.map((p, i) => {
    const a = byId.get(p.a), b = byId.get(p.b);
    return `### ${i + 1} (A ${p.type === "related" ? "relates to" : p.type} B)
A, in ${nameOf(a.brain)}: ${a.title}. ${String(a.position || a.summaryLine).slice(0, 500)}
B, in ${nameOf(b.brain)}: ${b.title}. ${String(b.position || b.summaryLine).slice(0, 500)}`;
  }).join("\n\n");
  try {
    const { text, finish } = await ask([
      { role: "system", content: "You draw conclusions from pairs of positions in a knowledge base. You reply with JSON only." },
      { role: "user", content: `Each numbered pair below joins two concepts from two folders.

For each, write what FOLLOWS from holding both: one conclusion neither states alone, something the reader can act on or test.
- "title": the conclusion in under 9 words.
- "text": one or two sentences under 30 words each, naming both concepts' ideas, with a number when one is held.
- Build only on what A and B say. No outside facts.
- When the two only restate each other or nothing new follows, leave "text" empty.
- English. No em-dashes. Plain words.

Reply with only JSON: {"insights":[{"n":1,"title":"","text":""}]}

${job}` },
    ], { json: true, maxTokens: 1500, timeout: 90000, temperature: 0.3, meter });
    const got = parseJson(String(text), finish)?.insights;
    const items = rows.map((p, i) => {
      const x = (Array.isArray(got) ? got : []).find((y: any) => Number(y?.n) === i + 1);
      return { a: p.a, b: p.b, type: p.type, title: String(x?.title ?? "").trim().slice(0, 90), text: String(x?.text ?? "").trim().slice(0, 400) };
    }).filter(x => x.text && x.title);
    return items.length ? await ctx.runMutation(internal.graph.putInsights, { space, items }) : 0;
  } catch (e: any) {
    console.log(`what follows skipped: ${String(e?.message ?? e).slice(0, 160)}`);
    return 0;
  }
}

