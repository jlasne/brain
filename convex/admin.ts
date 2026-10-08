/**
 * One-off jobs run from the CLI under your own deploy key, so nothing here is
 * reachable from a browser.
 *
 * setPass sets or replaces a space's passphrase from a terminal, so a door is
 * closed before anyone can reach it. The CLI parses JSON5, so in PowerShell the
 * values go in single quotes and nothing needs escaping:
 *
 *     npx convex run admin:setPass "{space:'squidgy',pass:'...'}" --prod
 */

import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { today, sha256, randomHex, gateKey, readSpace, slugOfName, SPACE_RE, SPACES, MODEL, MODEL_ID, ask, parseJson } from "./lib";
import { linkCandidates, linkId, idOf, conceptSlug, findByTitle, sameTitle, kindsOf } from "./words";
import { syncCard, mergeInto, mergeOpenLines, putModels } from "./store";
import { loadSpace } from "./space";
import { rederive, needsPosition, REDERIVE_MAX } from "./tidy";
import { embedConcepts, nearest, writeInsights, buildTopics } from "./graph";

/**
 * Turn every waiting candidate into a position.
 *
 *     npx convex run admin:promoteAll --prod
 *
 * The mention threshold used to hold an idea back until several sources argued
 * for it. With the threshold at 1 nothing new waits, but the ideas parked under
 * the old rule are still parked, and nothing reads that list.
 *
 * Each one becomes a concept carrying what every source that mentioned it
 * contributed, as dated evidence. The position is assembled from those lines
 * rather than re-derived, because re-deriving needs a model call and this runs
 * under a deploy key. The next drop that touches the concept rewrites it
 * properly, which is the normal path for every position.
 *
 * Pass `dry: true` to see what it would do and write nothing.
 */
export const promoteAll = internalMutation({
  args: { dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("candidates").collect();
    const made: any[] = [], skipped: string[] = [];

    for (const c of rows) {
      const brain = await ctx.db.query("brains")
        .withIndex("by_slug", q => q.eq("slug", c.brain)).unique();
      if (!brain) { skipped.push(`${c.title}: no brain "${c.brain}"`); continue; }

      const s2 = conceptSlug(c.title);
      const held = await ctx.db.query("concepts")
        .withIndex("by_brain", q => q.eq("brain", c.brain)).collect();
      const seen = findByTitle(held, c.brain, c.title);
      if (seen) {
        /* Already a position, so the row is stale rather than pending. */
        if (!a.dry) await ctx.db.delete(c._id);
        skipped.push(`${c.title}: already a concept`);
        continue;
      }

      /* What each source actually argued, from the note it left behind. */
      const evidence: any[] = [];
      for (const sid of c.notes ?? []) {
        const src = await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", sid)).first();
        const note = await ctx.db.query("notes").withIndex("by_sid", q => q.eq("sid", sid)).first();
        const said = ((note?.connections ?? []) as any[])
          .find(x => sameTitle(String(x?.title ?? ""), c.title));
        evidence.push({
          date: src?.date || note?.date || today(),
          author: src?.author || note?.author || "unknown",
          claim: String(said?.why ?? `argued for ${c.title}`).slice(0, 240),
          source: sid,
        });
      }
      evidence.sort((x, y) => String(y.date).localeCompare(String(x.date)));

      const lines = evidence.map(e => e.claim).filter(Boolean);
      const doc = {
        position: lines.join(" "),
        summaryLine: (lines[0] ?? c.title).slice(0, 110),
        evidence,
        data: [], conflicts: [], sources: Array.from(new Set(c.notes ?? [])), related: [],
      };

      if (!a.dry) {
        const count = (await ctx.db.query("concepts")
          .withIndex("by_brain", q => q.eq("brain", c.brain)).collect()).length;
        const id = await ctx.db.insert("concepts",
          { brain: c.brain, slug: s2, n: count + 1, title: c.title, ...doc, updated: today() });
        await syncCard(ctx, id);
        await ctx.db.delete(c._id);
      }
      made.push({ brain: c.brain, title: c.title, sources: evidence.length });
    }

    return { dry: !!a.dry, waiting: rows.length, promoted: made.length, made, skipped };
  },
});

/**
 * Set or replace a space's passphrase.
 *
 * The first visit to a door with no passphrase sets it, which leaves a window
 * where whoever arrives first chooses. Running this closes the door before it is
 * public. It also resets the attempt counter, so a locked-out door reopens.
 *
 *     npx convex run admin:setPass "{space:'squidgy',pass:'at least 8'}" --prod
 */
export const setPass = internalMutation({
  args: { space: v.string(), pass: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    if (String(a.space).trim().toLowerCase() !== space) {
      throw new Error(`a workspace slug is lower case letters, digits and dashes, like ${SPACES.join(" or ")}`);
    }
    if (a.pass.length < 8) throw new Error("use at least 8 characters");
    const key = gateKey(space);
    const salt = randomHex(16);
    const doc = { key, salt, hash: await sha256(salt, a.pass), attempts: 0, attemptWindow: Date.now(), setAt: today() };
    const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", key)).unique();
    if (row) { await ctx.db.patch(row._id, doc); return { space, replaced: true }; }
    await ctx.db.insert("config", doc);
    return { space, replaced: false };
  },
});

/**
 * The model of every workspace that runs on this deployment's key, set at once:
 * Octopus, Squidgy and each workspace made with makeWorkspace. It is what each
 * would pick in Settings, and each can change it there afterwards. The demo and
 * the workspaces visitors made on their own key are left alone.
 *
 *     npx convex run admin:setModel "{model:'deepseek/deepseek-v4.1-flash'}" --prod
 *
 * Pass `dry: true` to see what it would change and write nothing, and `spaces`
 * to name a few instead of all, by slug or by name. `model: null` takes them
 * back to the default, which is what a workspace with no pick runs on.
 */
export const setModel = internalMutation({
  args: { model: v.union(v.string(), v.null()), spaces: v.optional(v.array(v.string())), dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const model = a.model === null ? null : String(a.model).trim();
    if (model !== null && (model.length > 80 || !MODEL_ID.test(model))) {
      throw new Error(`"${model.slice(0, 40)}" is not a model id. They read vendor/model, like ${MODEL}.`);
    }
    const hosted = (await ctx.db.query("workspaces").collect()).filter((w: any) => w.kind === "hosted");
    const names = new Map<string, string>([...SPACES.map(s => [s, s] as [string, string]), ...hosted.map((w: any) => [w.slug, w.name] as [string, string])]);
    const asked: string[] = (a.spaces ?? []).map((s: string) => slugOfName(s));
    const strange = asked.filter(s => !names.has(s));
    if (strange.length) throw new Error(`${strange.join(", ")} ${strange.length === 1 ? "is" : "are"} not on this deployment's key. They are: ${[...names.keys()].join(", ")}.`);
    /* The default is kept as no pick, the way Settings keeps it. */
    const to = model === MODEL ? null : model;
    const out: { space: string; name: string; was: string | null; now: string | null }[] = [];
    const list: string[] = asked.length ? [...new Set(asked)] : [...names.keys()];
    for (const space of list) {
      const row = await ctx.db.query("models").withIndex("by_space", (q: any) => q.eq("space", space)).unique();
      out.push({ space, name: names.get(space) ?? space, was: row?.chat ?? null, now: to });
      if (!a.dry) await putModels(ctx, { space, chat: to });
    }
    console.log(`model ${model ?? "default"} ${a.dry ? "would be set" : "set"} for ${out.map(x => x.space).join(", ")}`);
    return { dry: !!a.dry, model, spaces: out };
  },
});

/**
 * Forget the model keys an earlier sign-in scheme kept, sealed, on member
 * accounts (13 to 27 September). Nothing reads them now. Run it once, then
 * remove KEY_SECRET from the deployment. The keys themselves stay valid:
 *
 *     npx convex run admin:forgetOldKeys --prod
 */
export const forgetOldKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cleared = 0;
    for (const a of await ctx.db.query("accounts").collect()) {
      const r = a as any;
      if (r.keyCipher === undefined && r.keyIv === undefined && r.keyHash === undefined && r.keyHint === undefined && r.keySavedAt === undefined) continue;
      await ctx.db.patch(a._id, { keyCipher: undefined, keyIv: undefined, keyHash: undefined, keyHint: undefined, keySavedAt: undefined } as any);
      cleared++;
    }
    return { cleared };
  },
});

/**
 * What the app no longer keeps: Projects and their pages, saved one-pagers,
 * the side panel's mode, the old blind-spot log, the scouts' feeds and finds, the map's question counts, and the lab's calls and turns. Their code is gone;
 * this empties their tables, 300 rows each a call. Run it until it says
 * "runAgain": false, then the tables can leave schema.ts.
 *
 *     npx convex run admin:clearRemoved --prod
 */
export const clearRemoved = internalMutation({
  args: {},
  handler: async (ctx) => {
    const deleted: Record<string, number> = {};
    let runAgain = false;
    for (const t of ["pages", "projects", "onepagers", "modes", "gaps", "heat", "scouts", "finds", "labTurns", "labs"]) {
      const rows = await (ctx.db as any).query(t).take(300);
      for (const r of rows) await ctx.db.delete(r._id);
      deleted[t] = rows.length;
      if (rows.length === 300) runAgain = true;
    }
    return { deleted, runAgain };
  },
});

/**
 * Make the open lines of every person in a workspace's personal folder one
 * line each where they say the same thing, the way "Still open" does when it
 * opens. The oldest line stays, with the newest wording, and each card's
 * count is written. No model call.
 *
 *     npx convex run admin:dedupeOpen "{space:'octopus'}" --prod
 *     npx convex run admin:dedupeOpen "{space:'pandaaahh'}" --prod
 *
 * Pass `dry: true` to count what it would merge and write nothing. The space
 * may be written as its name, "PandAAAHH", or its slug.
 */
export const dedupeOpen = internalAction({
  args: { space: v.string(), dry: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<any> => {
    const space = readSpace(slugOfName(a.space));
    const head = await ctx.runQuery(internal.store.spaceHead, { space });
    const folders = head.brains.filter((b: any) => b.type === "personal" && readSpace(b.space) === space);
    if (!folders.length) return { space, error: "that workspace has no personal folder" };
    const out = { space, dry: !!a.dry, folders: folders.map((b: any) => b.slug), people: 0, lines: 0, merged: 0 };
    for (const b of folders) {
      let cursor: string | null = null;
      do {
        const r: any = await ctx.runMutation(internal.admin.dedupeOpenPage, { brain: b.slug, cursor, ...(a.dry ? { dry: true } : {}) });
        out.people += r.people; out.lines += r.lines; out.merged += r.merged;
        cursor = r.next;
      } while (cursor);
    }
    console.log(`${space}: ${out.merged} doubled open lines ${a.dry ? "found" : "made one"}, ${out.lines} left across ${out.people} people`);
    return out;
  },
});

/** One page of a personal folder's people: their doubled open lines made one. */
export const dedupeOpenPage = internalMutation({
  args: { brain: v.string(), cursor: v.union(v.string(), v.null()), dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const p = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).paginate({ numItems: 30, cursor: a.cursor });
    let people = 0, lines = 0, merged = 0;
    for (const c of p.page) {
      if (c.tag !== "contact") continue;
      const before = (c.file?.open ?? []).filter((x: any) => x && !x.done).length;
      const m = before ? await mergeOpenLines(ctx, c, !!a.dry) : 0;
      /* A card the merge did not write is written, so every card carries its count. */
      if (!m && !a.dry) await syncCard(ctx, c._id);
      merged += m;
      /* Each merge takes one open line away, so this is what is left, in a dry run too. */
      if (before - m > 0) { people++; lines += before - m; }
    }
    return { people, lines, merged, next: p.isDone ? null : p.continueCursor };
  },
});

/**
 * A workspace for someone, on this deployment's own key: the same key that
 * pays for Octopus and Squidgy, with no monthly cap. It starts empty, behind
 * the passphrase given here, which its owner changes from Setup. It opens from
 * the landing by its name, like any workspace.
 *
 *     npx convex run admin:makeWorkspace "{name:'PandAAAHH',pass:'ABC12345'}" --prod
 */
export const makeWorkspace = internalMutation({
  args: { name: v.string(), pass: v.string() },
  handler: async (ctx, a) => {
    const name = a.name.replace(/\s+/g, " ").trim().slice(0, 60), slug = slugOfName(name);
    if (!name || slug.length < 2) throw new Error("give the workspace a name of 2 letters or more");
    if (a.pass.length < 8) throw new Error("use a passphrase of at least 8 characters");
    const taken = !SPACE_RE.test(slug) || (SPACES as readonly string[]).includes(slug)
      || !!(await ctx.db.query("workspaces").withIndex("by_slug", q => q.eq("slug", slug)).unique())
      || !!(await ctx.db.query("config").withIndex("by_key", q => q.eq("key", gateKey(slug))).unique());
    if (taken) throw new Error(`"${name}" is taken. Pick another name.`);
    const salt = randomHex(16);
    await ctx.db.insert("workspaces", { slug, name, kind: "hosted", created: today() });
    await ctx.db.insert("config", { key: gateKey(slug), salt, hash: await sha256(salt, a.pass), attempts: 0, attemptWindow: Date.now(), setAt: today() });
    return { slug, name, opens: `/chat?w=${slug}` };
  },
});

/**
 * Move a brain between the two spaces, with everything under it.
 *
 * A concept, a source and a candidate name their brain by slug and carry no
 * space of their own, so moving the brain moves them. Slugs stay unique across
 * both spaces, which is what makes that safe.
 *
 *     npx convex run admin:moveBrain "{slug:'content',space:'squidgy'}" --prod
 */
export const moveBrain = internalMutation({
  args: { slug: v.string(), space: v.string(), dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b) throw new Error(`no brain called "${a.slug}"`);
    const from = readSpace(b.space);
    if (from === space) return { slug: a.slug, from, to: space, moved: false, why: "already there" };
    /* A brain that moves leaves the workspaces it was shared with. */
    if (!a.dry) await ctx.db.patch(b._id, { space, shared: [], viewers: [] });
    return { slug: a.slug, name: b.name, from, to: space, moved: !a.dry };
  },
});

/**
 * Pour one folder into another of the same workspace: its concepts, sources,
 * links, candidates and chats move, and the folder goes. Run with dry first
 * to see the counts.
 *
 *     npx convex run admin:mergeBrain '{"from":"sport","into":"health","dry":true}' --prod
 *     npx convex run admin:mergeBrain '{"from":"sport","into":"health"}' --prod
 */
export const mergeBrain = internalMutation({
  args: { from: v.string(), into: v.string(), dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.from)).unique();
    if (!b) throw new Error(`no folder called "${a.from}"`);
    return await mergeInto(ctx, { ...a, space: readSpace(b.space) });
  },
});

/**
 * Open the demo workspace: anyone enters it from the landing, and nobody
 * holds a passphrase to it. It runs on the deployment's key, or
 * DEMO_OPENROUTER_API_KEY when set, within 30 drops and 300 questions a
 * month. `copy` fills it with copies of the brains named, in the same call.
 *
 *     npx convex run admin:makeDemo '{"copy":["health","content","social"]}' --prod
 */
export const makeDemo = internalMutation({
  args: { slug: v.optional(v.string()), name: v.optional(v.string()), copy: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const slug = readSpace(a.slug ?? "demo"), name = a.name ?? "Demo";
    if ((SPACES as readonly string[]).includes(slug)) throw new Error("the demo needs a slug of its own");
    const had = await ctx.db.query("workspaces").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    if (had && had.kind !== "demo") throw new Error(`"${slug}" is a workspace someone made. Pick another slug.`);
    for (const w of await ctx.db.query("workspaces").collect()) {
      if (w.kind === "demo" && w.slug !== slug) throw new Error(`the demo is already "${w.slug}"`);
    }
    if (!had) await ctx.db.insert("workspaces", { slug, name, kind: "demo", created: today() });
    /* No door: a passphrase left from an earlier setup is removed. */
    const gate = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", gateKey(slug))).unique();
    if (gate) await ctx.db.delete(gate._id);
    /* A brain already copied in is not copied twice. */
    const copied = [];
    for (const from of a.copy ?? []) {
      const inDemo = (await ctx.db.query("brains").collect()).some(b => readSpace(b.space) === slug && (b.slug === `${from}-${slug}` || b.slug.startsWith(`${from}-${slug}-`)));
      if (inDemo) { copied.push({ slug: from, skipped: "already in the demo" }); continue; }
      copied.push(await copyOne(ctx, from, slug));
    }
    return { slug, name, made: !had, copied };
  },
});

/** One brain copied into a workspace, with its concepts, cards and sources. */
async function copyOne(ctx: any, from: string, space: string, name?: string) {
  const src = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", from)).unique();
  if (!src) throw new Error(`no brain called "${from}"`);
  if (src.type === "personal") throw new Error(`"${from}" is a personal brain, and stays in its own workspace`);
  let ns = `${from}-${space}`;
  for (let n = 2; await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", ns)).unique(); n++) ns = `${from}-${space}-${n}`;
  const { _id, _creationTime, ...brain } = src as any;
  await ctx.db.insert("brains", { ...brain, slug: ns, name: name ?? src.name, space, created: today() });
  let n = 0;
  for (const c of await ctx.db.query("concepts").withIndex("by_brain", (q: any) => q.eq("brain", from)).collect()) {
    const { _id: _cid, _creationTime: _ct, ...rest } = c as any;
    const related = (c.related ?? []).map((r: string) => {
      const id = linkId(r, from);
      return id.startsWith(from + "/") ? `${ns}/${id.slice(from.length + 1)}` : id;
    });
    const id = await ctx.db.insert("concepts", { ...rest, brain: ns, related });
    await syncCard(ctx, id);
    n++;
  }
  let sources = 0;
  for (const s of await ctx.db.query("sources").collect()) {
    if (!(s.brains ?? []).includes(from)) continue;
    await ctx.db.patch(s._id, { brains: [...s.brains, ns] });
    sources++;
  }
  return { slug: ns, from, space, concepts: n, sources };
}

/**
 * Copy one more brain into a workspace, the demo most often. The copy gets
 * a slug of its own; the original stays where it was, untouched.
 *
 *     npx convex run admin:copyBrain '{"slug":"health","space":"demo"}' --prod
 */
export const copyBrain = internalMutation({
  args: { slug: v.string(), space: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => await copyOne(ctx, a.slug, readSpace(a.space), a.name),
});

/* ======================================================================
   LINKING WHAT IS ALREADY STORED

   A drop links the concepts it writes. Everything stored before that has no
   links, so these fill them in, brain by brain, in the background.

     npx convex run admin:linkPreview --prod    what it would propose, free
     npx convex run admin:linkAll --prod        do it, in the background
     npx convex run admin:linkStatus --prod     how many are linked so far

   Two steps. The free one reads what each concept holds and shortlists up to
   six likely links: a title named in another's text, rare words shared, a
   small source in common. A model then reads each concept with its shortlist
   and keeps the real links, four at most. It never reads the whole brain at
   once, which is why it stays cheap: about $0.005 for 1000 concepts.
   ====================================================================== */

/**
 * One space's concepts, fetched by an action. The comparison runs in the action
 * because an action has minutes and a query has about a second, which 4000
 * concepts could approach.
 */
async function spaceOf(ctx: any, space: string) {
  /* Cards, not whole concepts: about 1 KB each, so a space of 10,000 still
     fits in one read and in the action's memory. */
  const { brains, cards: concepts } = await loadSpace(ctx, space);
  return { brains, concepts: [...concepts].sort((a: any, b: any) =>
    a.brain.localeCompare(b.brain) || (a.n ?? 0) - (b.n ?? 0)) };
}

/**
 * The work for one space: every concept with at least one new candidate. With
 * `only`, the shortlists are worked out for those concepts alone, against the
 * whole space: a drop's linking costs what it wrote, not the size of the space.
 */
function linkWork(concepts: any[], only?: Set<string>, near?: Map<string, string[]>) {
  const cand = linkCandidates(concepts, [], 6, 0.12, only);
  const byId = new Map(concepts.map((c: any) => [idOf(c), c]));
  return concepts.filter((c: any) => !only || only.has(idOf(c))).map((c: any) => {
    const id = idOf(c);
    const have = new Set((c.related ?? []).map((r: string) => linkId(r, c.brain)));
    /* The closest by meaning first, then the closest by words: eight at most. */
    const ids = [...new Set([...(near?.get(id) ?? []), ...(cand.get(id) ?? []).map(x => x.id)])]
      .filter(x => x !== id && !have.has(x) && byId.has(x)).slice(0, 8);
    return { c, cands: ids.map(x => byId.get(x)) };
  }).filter(w => w.cands.length);
}

const LINK_BATCH = 30;

/** What linking would propose, with no model call and nothing written. */
export const linkPreview = internalAction({
  args: {},
  handler: async (ctx) => {
    const out: any[] = [];
    for (const space of SPACES) {
      const { brains, concepts } = await spaceOf(ctx, space);
      const work = linkWork(concepts);
      const name = new Map(brains.map((b: any) => [b.slug, b.name]));
      out.push({
        space, concepts: concepts.length,
        alreadyLinked: concepts.filter((c: any) => (c.related ?? []).length).length,
        toCheck: work.length,
        modelCalls: Math.ceil(work.length / LINK_BATCH),
        sample: work.slice(0, 8).map(w => `${w.c.title} [${name.get(w.c.brain)}] -> ` +
          w.cands.slice(0, 3).map((x: any) => x.title).join(" | ")),
      });
    }
    return out;
  },
});

/** How many concepts carry links, brain by brain. */
export const linkStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const brains = await ctx.db.query("brains").collect();
    return await Promise.all(brains.map(async (b: any) => {
      const own = await ctx.db.query("cards").withIndex("by_brain", q => q.eq("brain", b.slug)).collect();
      return { brain: b.name, space: readSpace(b.space), concepts: own.length,
        linked: own.filter((c: any) => (c.related ?? []).length).length,
        links: own.reduce((n: number, c: any) => n + (c.related ?? []).length, 0) };
    }));
  },
});

/**
 * Build the slim copy of every concept, 200 at a time. It starts on its own
 * the first time the app opens after this deploy; running it by hand is safe:
 * npx convex run admin:buildCards --prod
 */
export const buildCards = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    if (!a.force && !(await ctx.runMutation(internal.store.claimCardBuild, {}))) return "already built, or building";
    let cursor: string | null = null, n = 0;
    for (;;) {
      const r: any = await ctx.runMutation(internal.store.cardsBatch, { cursor });
      n += r.n;
      await ctx.runMutation(internal.store.touchCardBuild, {});
      if (r.done) break;
      cursor = r.cursor;
    }
    await ctx.runMutation(internal.store.markCardsReady, {});
    console.log(`cards built for ${n} concepts`);
    return `cards built for ${n} concepts`;
  },
});

/**
 * The batch a step works on, read fresh each time so a drop in between is fine.
 * With `only`, the work is those concepts alone, still shortlisted against the
 * whole space: that is how a drop links what it just wrote.
 */
async function linkBatch(ctx: any, space: string, after: string, only?: string[]) {
  const { brains, concepts } = await spaceOf(ctx, space);
  const name = new Map(brains.map((b: any) => [b.slug, b.name]));
  /* Walked in id order from a cursor. Walking by batch number over a list
     rebuilt each step skipped concepts: one that got its links left the list,
     and the next ones slid into places already done. Shortlists are worked out
     only for the concepts ahead of the cursor, a few dozen at a time, so a
     step costs the same at the start of a space as at its end. */
  const want = only ? new Set(only) : null;
  const ahead = concepts.map((c: any) => idOf(c)).filter((id: string) => id > after && (!want || want.has(id))).sort();
  const slice: any[] = [];
  let at = 0;
  while (slice.length < LINK_BATCH && at < ahead.length) {
    const chunk = ahead.slice(at, at + LINK_BATCH * 2);
    at += chunk.length;
    for (const w of linkWork(concepts, new Set(chunk)).sort((x, y) => idOf(x.c).localeCompare(idOf(y.c)))) {
      if (slice.length < LINK_BATCH) slice.push(w);
    }
  }
  const last = slice.length ? idOf(slice[slice.length - 1].c) : null;
  return {
    total: Math.ceil(ahead.length / LINK_BATCH),
    next: last && ahead.some((id: string) => id > last) ? last : null,
    items: toItems(slice, name),
  };
}

/** A batch as the model reads it. */
function toItems(slice: any[], name: Map<any, any>) {
  return slice.map(w => ({
    brain: w.c.brain, slug: w.c.slug, title: w.c.title, brainName: name.get(w.c.brain) ?? w.c.brain,
    summary: w.c.summaryLine || String(w.c.position ?? w.c.lead ?? "").slice(0, 200),
    cands: w.cands.map((x: any) => ({ id: idOf(x), title: x.title, brainName: name.get(x.brain) ?? x.brain,
      summary: x.summaryLine || String(x.position ?? x.lead ?? "").slice(0, 140) })),
  }));
}

const LINK_RULES = `For each concept below, keep the candidates it truly connects to, and say how.

- Keep a candidate when this concept builds on it, explains it, is used together with it, is a case of it, or is weighed against it.
- Drop a candidate that only shares words.
- At most 4 per concept. None is a correct answer.
- "t" says what the link is, read from this concept to the candidate:
  "needs": this concept is understood only after the candidate (a formula needs its inputs, a method needs its definition).
  "causes": this concept leads to or drives the candidate.
  "supports": this concept is evidence for the candidate.
  "contradicts": the two disagree.
  "example": this concept is a case of the candidate.
  "related": anything else.

Reply with only JSON, concept numbers to candidates: {"links":{"1":[{"c":2,"t":"needs"},{"c":3,"t":"related"}],"2":[]}}`;

/** Start linking, in the background. */
export const linkAll = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.admin.linkStep, { space: SPACES[0], batch: 0 });
    return "Linking started in the background. Follow it with: npx convex logs --prod, " +
      "or count it with: npx convex run admin:linkStatus --prod";
  },
});

/**
 * The model reads each concept with its shortlist and keeps the real links,
 * which are written. Returns how many were added, or null when the call failed.
 */
async function confirmLinks(ctx: any, items: any[]): Promise<{ added: number; pairs: { a: string; b: string; type: string }[] } | null> {
  const job = items.map((it: any, n: number) =>
    `### ${n + 1} | ${it.title} [${it.brainName}]\n${it.summary}\ncandidates:\n` +
    it.cands.map((c: any, k: number) => `  ${k + 1}) ${c.title} [${c.brainName}]: ${c.summary}`).join("\n")).join("\n\n");
  let links: Record<string, any[]> = {};
  try {
    const { text } = await ask([
      { role: "system", content: "You connect the concepts of a knowledge base. You reply with JSON only." },
      { role: "user", content: `${LINK_RULES}\n\n${job}` },
    ], { json: true, maxTokens: 2000, timeout: 90000 });
    links = parseJson(String(text))?.links ?? {};
  } catch (e: any) {
    console.log(`linking failed: ${String(e?.message ?? e).slice(0, 200)}`);
    return null;
  }
  let added = 0;
  const pairs: { a: string; b: string; type: string }[] = [];
  const TYPES = ["needs", "causes", "supports", "contradicts", "example", "related"];
  for (const [n, it] of items.entries()) {
    /* A candidate number alone, from an older reply shape, is plainly related. */
    const keep = (Array.isArray(links[String(n + 1)]) ? links[String(n + 1)] : []).map((k: any) => {
      const c = it.cands[Number(typeof k === "object" && k ? k.c : k) - 1];
      const t = String(typeof k === "object" && k ? k.t : "related").toLowerCase();
      return c ? { to: c.id, type: TYPES.includes(t) ? t : "related" } : null;
    }).filter(Boolean).slice(0, 4) as { to: string; type: string }[];
    if (!keep.length) continue;
    added += (await ctx.runMutation(internal.store.addRelated, { brain: it.brain, slug: it.slug, ids: keep.map(k => k.to),
      kinds: keep.filter(k => k.type !== "related") })).added;
    for (const k of keep) pairs.push({ a: `${it.brain}/${it.slug}`, b: k.to, type: k.type });
  }
  return { added, pairs };
}

/** One batch of the whole-space run, then the next one is scheduled. */
export const linkStep = internalAction({
  args: { space: v.string(), batch: v.number(), after: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { total, items, next: cursor } = await linkBatch(ctx, a.space, a.after ?? "");
    const next = async () => {
      if (cursor) return ctx.scheduler.runAfter(0, internal.admin.linkStep, { space: a.space, batch: a.batch + 1, after: cursor });
      const i = SPACES.indexOf(a.space as any);
      if (i + 1 < SPACES.length) return ctx.scheduler.runAfter(0, internal.admin.linkStep, { space: SPACES[i + 1], batch: 0 });
      console.log("linking finished");
    };
    if (!items.length) return await next();
    /* A failed batch skips its concepts and the run goes on. Running linkAll
       again picks them up, since only unlinked candidates are sent. */
    const added = (await confirmLinks(ctx, items))?.added ?? null;
    console.log(added === null
      ? `linking ${a.space} batch ${a.batch + 1} failed, skipped (about ${total} left)`
      : `linking ${a.space} batch ${a.batch + 1}: ${added} links over ${items.length} concepts (about ${total} left)`);
    await next();
  },
});

/**
 * The concepts one drop just wrote, linked the same way as the whole-space
 * run: shortlisted against every concept in the space, checked by the model.
 * Scheduled by each store batch, so it never slows the drop down.
 */
export const linkConcepts = internalAction({
  args: { space: v.string(), ids: v.array(v.string()), sid: v.optional(v.string()) },
  handler: async (ctx, a) => {
    /* Every concept is reached, however many. The shortlists are worked out
       once, for what the drop wrote, and walked 30 at a time. After four
       batches the rest is handed to a fresh run, so no run nears the
       10 minute limit an action has. */
    const { brains, concepts } = await spaceOf(ctx, a.space);
    const name = new Map(brains.map((b: any) => [b.slug, b.name]));
    /* With a source id, only concepts that source fed are linked: the ids
       come from the browser, and this keeps them to what the drop wrote. */
    const fed = a.sid ? new Set(concepts.filter((c: any) => (c.srcIds ?? c.sources ?? []).includes(a.sid)).map(idOf)) : null;
    const want = new Set<string>((a.ids as string[]).filter((id: string) => !fed || fed.has(id)));
    const RUN = LINK_BATCH * 4;
    const mine = [...want].sort().slice(0, RUN);
    /* Meaning first: what this run wrote is embedded, and the closest concepts
       by meaning join the word shortlist. Without embeddings, words alone. */
    const near = new Map<string, string[]>();
    try {
      const vecs = await embedConcepts(ctx, a.space, mine);
      const slugs = brains.map((b: any) => b.slug);
      for (const [id, vec] of vecs) near.set(id, (await nearest(ctx, vec, slugs, 6)).map(x => x.id).filter(x => x !== id));
    } catch (e: any) {
      console.log(`embeddings skipped: ${String(e?.message ?? e).slice(0, 160)}`);
    }
    const work = linkWork(concepts, new Set(mine), near).sort((x, y) => idOf(x.c).localeCompare(idOf(y.c)));
    let added = 0;
    const pairs: { a: string; b: string; type: string }[] = [];
    for (let i = 0; i < work.length; i += LINK_BATCH) {
      const r = await confirmLinks(ctx, toItems(work.slice(i, i + LINK_BATCH), name));
      if (r){ added += r.added; pairs.push(...r.pairs); }
    }
    const rest = [...want].sort().slice(RUN);
    if (rest.length) await ctx.scheduler.runAfter(0, internal.admin.linkConcepts, { space: a.space, ids: rest, ...(a.sid ? { sid: a.sid } : {}) });
    /* What follows from the new links across folders, then the topics of the
       folders this run touched, read from the links as they stand now. */
    const insights = await writeInsights(ctx, a.space, pairs);
    let topics = 0;
    const touched = new Set(mine.map(id => id.split("/")[0]));
    const after = touched.size ? (await spaceOf(ctx, a.space)).concepts : [];
    for (const b of brains.filter((x: any) => touched.has(x.slug))) {
      try { topics += await buildTopics(ctx, a.space, b, after); } catch (e: any) { console.log(`topics ${b.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
    }
    console.log(`linked ${added} for ${mine.length} concepts just stored, ${insights} new insights, ${topics} topics` +
      `${rest.length ? `, ${rest.length} handed on` : ""}`);
  },
});

/**
 * What one drop did, from what it left behind: how the source was read, how
 * many concepts it opened and how many it fed. With no argument it reports
 * the newest source and lists the others to pick from.
 *
 * npx convex run admin:dropReport --prod
 * npx convex run admin:dropReport "{title:'accounting'}" --prod
 */
export const dropReport = internalQuery({
  args: { title: v.optional(v.string()), sid: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const recent = await ctx.db.query("sources").order("desc").take(12);
    const want = (a.title ?? "").toLowerCase();
    const src = a.sid ? await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", a.sid!)).first()
      : want ? (await ctx.db.query("sources").collect()).reverse().find(s => String(s.title ?? "").toLowerCase().includes(want))
      : recent[0];
    if (!src) return { error: "no source matches", recent: recent.map(s => `${s.sid} | ${s.title}`) };

    const note = await ctx.db.query("notes").withIndex("by_sid", q => q.eq("sid", src.sid)).first();
    const f: any = note?.findings ?? {};
    let fed = 0, opened = 0;
    const perBrain: Record<string, { concepts: number; fed: number; opened: number }> = {};
    for (const br of src.brains ?? []) {
      const all = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", br)).collect();
      const mine = all.filter(c => (c.sources ?? []).includes(src.sid));
      /* A concept this source opened has it as its oldest evidence. */
      const first = (c: any) => [...(c.evidence ?? [])].filter((e: any) => !e?.rollup).pop()?.source;
      const made = mine.filter(c => first(c) === src.sid).length;
      perBrain[br] = { concepts: all.length, fed: mine.length - made, opened: made };
      fed += mine.length - made; opened += made;
    }
    return {
      source: { sid: src.sid, title: src.title, author: src.author, date: src.date, brains: src.brains },
      read: { kind: f.kind ?? "unknown", passages: (note?.topics ?? []).length,
              newFindings: (f.new ?? []).length, echoes: (f.echo ?? []).length, conflicts: (f.conflicts ?? []).length },
      filed: { concepts: fed + opened, opened, fed },
      perBrain,
      recent: recent.map(s => `${s.sid} | ${s.title}`),
    };
  },
});

/**
 * Write a position for every concept that has none, or holds a note about
 * its filing in place of one, from the evidence it already carries.
 *
 *     npx convex run admin:repairPositions "{dry:true}" --prod
 *     npx convex run admin:repairPositions --prod
 *
 * Octopus and Squidgy, on the deployment's key, never a personal folder.
 * Eight concepts a call, 40 a run; the rest go to a fresh run, so none nears
 * the 10 minute limit an action has.
 */
export const repairPositions = internalAction({
  args: { space: v.optional(v.string()), dry: v.optional(v.boolean()), ids: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<any> => {
    const spaces = a.space ? [readSpace(a.space)] : [...SPACES];
    if (a.ids) {
      const space = spaces[0];
      const who = { kind: "owner" as const, account: null, space };
      let written = 0;
      const run = a.ids.slice(0, REDERIVE_MAX * 5);
      for (let i = 0; i < run.length; i += REDERIVE_MAX) {
        try { written += (await rederive(ctx, who, run.slice(i, i + REDERIVE_MAX))).written.length; }
        catch (e: any) { console.log(`repair batch skipped: ${String(e?.message ?? e).slice(0, 160)}`); }
      }
      const rest = a.ids.slice(run.length);
      if (rest.length) await ctx.scheduler.runAfter(0, internal.admin.repairPositions, { space, ids: rest });
      console.log(`${space}: ${written} positions written, ${rest.length} handed on`);
      return { space, written, left: rest.length };
    }
    const out: any[] = [];
    for (const space of spaces) {
      const { cards } = await loadSpace(ctx, space);
      const want = cards.filter(needsPosition);
      const ids = want.map((c: any) => `${c.brain}/${c.slug}`);
      out.push({ space, count: ids.length, ids: a.dry ? ids : ids.slice(0, 5) });
      if (!a.dry && ids.length) await ctx.scheduler.runAfter(0, internal.admin.repairPositions, { space, ids });
    }
    return a.dry ? { dry: true, spaces: out } : { started: true, spaces: out };
  },
});

/**
 * The graph for everything already stored: run once after the upgrade.
 *
 *     npx convex run admin:graphAll --prod
 *
 * Octopus and Squidgy, on the deployment's key, in four steps a space, each
 * run handing on to the next so none nears the 10 minute limit:
 *   embed     every concept turned into numbers, 128 a run
 *   type      every link already held given its kind, 60 concepts a run
 *   topics    every folder's topics, 4 folders a run
 *   insights  what follows from the 20 strongest links across folders
 * About $0.08 for a space of 1,000 concepts on GLM 5.3 Flash, most of it typing.
 */
export const graphAll = internalAction({
  args: { space: v.optional(v.string()) },
  handler: async (ctx, a): Promise<string> => {
    const space = a.space ? readSpace(a.space) : SPACES[0];
    await ctx.scheduler.runAfter(0, internal.admin.graphStep, { space, phase: "embed", at: 0, only: !!a.space });
    return `The graph is being built for ${a.space ? space : SPACES.join(" and ")}. Follow it with: npx convex logs --prod`;
  },
});

const TYPE_RULES = `Each concept below lists the concepts it already links to. Say what each link is, read from the concept to the one it links to:
"needs": the concept is understood only after that one (a formula needs its inputs, a method needs its definition).
"causes": the concept leads to or drives that one.
"supports": the concept is evidence for that one.
"contradicts": the two disagree.
"example": the concept is a case of that one.
"related": anything else.

Reply with only JSON, one list per concept, in the order its links are listed: {"types":{"1":["needs","related"],"2":["causes"]}}`;

export const graphStep = internalAction({
  args: { space: v.string(), phase: v.string(), at: v.number(), only: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const { brains, concepts } = await spaceOf(ctx, a.space);
    const next = async (phase: string, at = 0) => ctx.scheduler.runAfter(0, internal.admin.graphStep, { space: a.space, phase, at, only: a.only });
    const done = async () => {
      const i = SPACES.indexOf(a.space as any);
      if (!a.only && i >= 0 && i + 1 < SPACES.length) return ctx.scheduler.runAfter(0, internal.admin.graphStep, { space: SPACES[i + 1], phase: "embed", at: 0 });
      console.log("graph finished");
    };
    const ids = concepts.map(idOf).sort();
    if (a.phase === "embed") {
      const slice = ids.slice(a.at, a.at + 128);
      try { await embedConcepts(ctx, a.space, slice); }
      catch (e: any) { console.log(`graph ${a.space}: embeddings stopped, ${String(e?.message ?? e).slice(0, 160)}`); return await next("type"); }
      console.log(`graph ${a.space}: embedded ${Math.min(a.at + 128, ids.length)} of ${ids.length}`);
      return a.at + 128 < ids.length ? await next("embed", a.at + 128) : await next("type");
    }
    if (a.phase === "type") {
      const titled = new Map(concepts.map((c: any) => [idOf(c), c]));
      const linked = concepts.filter((c: any) => (c.related ?? []).length).sort((x: any, y: any) => idOf(x).localeCompare(idOf(y)));
      for (let k = 0; k < 2; k++) {
        const part = linked.slice(a.at + k * 30, a.at + (k + 1) * 30);
        if (!part.length) break;
        const rows = part.map((c: any) => ({ c, to: (c.related ?? []).map((r: string) => linkId(r, c.brain)).filter((id: string) => titled.has(id)).slice(0, 12) }));
        const job = rows.map((r: any, n: number) => `### ${n + 1} | ${r.c.title}: ${r.c.summaryLine || String(r.c.lead ?? "").slice(0, 140)}\n` +
          r.to.map((id: string, j: number) => `  ${j + 1}) ${titled.get(id).title}: ${titled.get(id).summaryLine || ""}`).join("\n")).join("\n\n");
        try {
          const { text, finish } = await ask([
            { role: "system", content: "You say how the concepts of a knowledge base relate. You reply with JSON only." },
            { role: "user", content: `${TYPE_RULES}\n\n${job}` },
          ], { json: true, maxTokens: 3000, timeout: 120000, temperature: 0 });
          const got = parseJson(String(text), finish)?.types ?? {};
          for (const [n, r] of rows.entries()) {
            const list = Array.isArray(got[String(n + 1)]) ? got[String(n + 1)] : [];
            const kinds = r.to.map((id: string, j: number) => ({ to: id, type: String(list[j] ?? "related").toLowerCase() }))
              .filter((k: any) => ["needs", "causes", "supports", "contradicts", "example"].includes(k.type));
            if (kinds.length) await ctx.runMutation(internal.store.addRelated, { brain: r.c.brain, slug: r.c.slug, ids: [], kinds });
          }
        } catch (e: any) { console.log(`graph ${a.space}: typing batch skipped, ${String(e?.message ?? e).slice(0, 160)}`); }
      }
      console.log(`graph ${a.space}: typed links of ${Math.min(a.at + 60, linked.length)} of ${linked.length} concepts`);
      return a.at + 60 < linked.length ? await next("type", a.at + 60) : await next("topics");
    }
    if (a.phase === "topics") {
      const part = brains.slice(a.at, a.at + 4);
      for (const b of part) {
        try { console.log(`graph ${a.space}: ${b.slug}, ${await buildTopics(ctx, a.space, b, concepts)} topics`); }
        catch (e: any) { console.log(`graph ${a.space}: topics ${b.slug} skipped, ${String(e?.message ?? e).slice(0, 120)}`); }
      }
      return a.at + 4 < brains.length ? await next("topics", a.at + 4) : await next("insights");
    }
    if (a.phase === "insights") {
      const pairs: { a: string; b: string; type: string }[] = [];
      for (const c of concepts) {
        const kinds = new Map(kindsOf(c).map((k: any) => [k.to, k.type]));
        for (const r of c.related ?? []) {
          const to = linkId(r, c.brain);
          if (to.split("/")[0] !== c.brain) pairs.push({ a: idOf(c), b: to, type: kinds.get(to) ?? "related" });
        }
      }
      /* The 20 strongest, the kinds that carry a conclusion first, five a call. */
      const RANK: Record<string, number> = { causes: 5, contradicts: 4, supports: 3, needs: 2, example: 1, related: 0 };
      const seen = new Set<string>();
      const top = pairs.sort((x, y) => (RANK[y.type] ?? 0) - (RANK[x.type] ?? 0))
        .filter(p => { const k = [p.a, p.b].sort().join("|"); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
      let n = 0;
      for (let k = 0; k < top.length; k += 5) n += await writeInsights(ctx, a.space, top.slice(k, k + 5), 5);
      console.log(`graph ${a.space}: ${n} insights`);
      return await done();
    }
  },
});
