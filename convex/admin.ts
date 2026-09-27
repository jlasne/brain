/**
 * One-off jobs run from the CLI under your own deploy key, so nothing here is
 * reachable from a browser.
 *
 *     npx convex run admin:state --prod
 *     npx convex run admin:claim --prod
 *
 * claim takes no argument when one account exists, because passing JSON through
 * PowerShell strips the inner quotes. Name one explicitly only when several
 * accounts exist:
 *
 *     npx convex run admin:claim '{\"account\":\"octopus\"}' --prod
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
import { today, sha256, randomHex, gateKey, readSpace, SPACES, ask, parseJson } from "./lib";
import { linkCandidates, linkId, idOf, conceptSlug, findByTitle, sameTitle } from "./words";
import { syncCard } from "./store";
import { loadSpace } from "./space";

/** Who exists, and who owns what. Read this before and after a claim. */
export const state = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = (await ctx.db.query("accounts").collect()).map(a => ({
      name: a.name, slug: a.slug, hasKey: !!a.keyCipher, created: a.created,
    }));
    const brains = (await ctx.db.query("brains").collect()).map(b => ({
      slug: b.slug, name: b.name,
      owner: b.owner ?? "(nobody)",
      feeding: b.visibility === "open" || b.visibility === "drop" ? "anyone" : "owner only",
    }));
    return { accounts, brains };
  },
});

/**
 * Hand the brains to an account.
 *
 * Brains made before accounts existed carry no owner, which left them feedable
 * by the passphrase alone. With that door closed, they need a real owner or
 * nobody can feed them again.
 *
 * Ownerless brains are claimed by default. Pass `all: true` to take brains that
 * already belong to someone, which is a takeover and worth meaning on purpose.
 */
export const claim = internalMutation({
  args: { account: v.optional(v.string()), all: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const all = await ctx.db.query("accounts").collect();

    /* Passing JSON through a shell is the fiddliest part of running this, and
       PowerShell strips the inner quotes. With one account there is nothing to
       choose, so the argument is optional and the common case needs none. */
    let slug = a.account;
    if (!slug) {
      if (all.length === 1) slug = all[0].slug;
      else if (!all.length) throw new Error("no accounts exist yet. Sign in once to create one.");
      else throw new Error(
        `name which account: ${all.map(x => x.slug).join(", ")}`);
    }

    const acc = all.find(x => x.slug === slug);
    if (!acc) {
      throw new Error(
        `no account "${slug}". Sign in once to create it. ` +
        (all.length ? `Accounts that exist: ${all.map(x => x.slug).join(", ")}` : "No accounts exist yet."));
    }

    const claimed: string[] = [], skipped: string[] = [];
    for (const b of await ctx.db.query("brains").collect()) {
      if (b.owner && b.owner !== slug && !a.all) { skipped.push(`${b.slug} -> ${b.owner}`); continue; }
      if (b.owner === slug) { skipped.push(`${b.slug} already`); continue; }
      await ctx.db.patch(b._id, { owner: slug });
      claimed.push(b.slug);
    }
    return { owner: acc.name, account: slug, claimed, skipped };
  },
});

/** Open one brain to everyone's sources, or close it again. */
export const feeding = internalMutation({
  args: { brain: v.string(), open: v.boolean() },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b) throw new Error(`no brain "${a.brain}"`);
    await ctx.db.patch(b._id, { visibility: a.open ? "open" : "closed" });
    return { brain: a.brain, feeding: a.open ? "anyone" : "owner only" };
  },
});

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
      throw new Error(`space reads one of: ${SPACES.join(", ")}`);
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
    if (!a.dry) await ctx.db.patch(b._id, { space });
    return { slug: a.slug, name: b.name, from, to: space, moved: !a.dry };
  },
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
function linkWork(concepts: any[], only?: Set<string>) {
  const cand = linkCandidates(concepts, [], 6, 0.12, only);
  const byId = new Map(concepts.map((c: any) => [idOf(c), c]));
  return concepts.filter((c: any) => !only || only.has(idOf(c))).map((c: any) => {
    const have = new Set((c.related ?? []).map((r: string) => linkId(r, c.brain)));
    const fresh = (cand.get(idOf(c)) ?? []).filter(x => !have.has(x.id)).map(x => byId.get(x.id));
    return { c, cands: fresh };
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

const LINK_RULES = `For each concept below, keep the candidates it truly connects to.

- Keep a candidate when this concept builds on it, explains it, is used together with it, is a case of it, or is weighed against it.
- Drop a candidate that only shares words.
- At most 4 per concept. None is a correct answer.

Reply with only JSON, concept numbers to candidate numbers: {"links":{"1":[2,3],"2":[]}}`;

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
async function confirmLinks(ctx: any, items: any[]): Promise<number | null> {
  const job = items.map((it: any, n: number) =>
    `### ${n + 1} | ${it.title} [${it.brainName}]\n${it.summary}\ncandidates:\n` +
    it.cands.map((c: any, k: number) => `  ${k + 1}) ${c.title} [${c.brainName}]: ${c.summary}`).join("\n")).join("\n\n");
  let links: Record<string, number[]> = {};
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
  for (const [n, it] of items.entries()) {
    const keep = (links[String(n + 1)] ?? []).map((k: any) => it.cands[Number(k) - 1]?.id).filter(Boolean).slice(0, 4);
    if (!keep.length) continue;
    added += (await ctx.runMutation(internal.store.addRelated, { brain: it.brain, slug: it.slug, ids: keep })).added;
  }
  return added;
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
    const added = await confirmLinks(ctx, items);
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
    const work = linkWork(concepts, want).sort((x, y) => idOf(x.c).localeCompare(idOf(y.c)));
    const RUN = LINK_BATCH * 4;
    let added = 0;
    for (let i = 0; i < Math.min(work.length, RUN); i += LINK_BATCH) {
      added += (await confirmLinks(ctx, toItems(work.slice(i, i + LINK_BATCH), name))) ?? 0;
    }
    const rest = work.slice(RUN).map(w => idOf(w.c));
    if (rest.length) await ctx.scheduler.runAfter(0, internal.admin.linkConcepts, { space: a.space, ids: rest, ...(a.sid ? { sid: a.sid } : {}) });
    console.log(`linked ${added} for ${Math.min(work.length, RUN)} concepts just stored${rest.length ? `, ${rest.length} handed on` : ""}`);
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
