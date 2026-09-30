/** Internal reads and writes. HTTP actions reach the database only through these. */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { linkId, conceptSlug, legacySlug, sameTitle, mergeEvidence, unionCap, cardOf } from "./words";
import { sha256, randomHex, today, slug, gateKey, readSpace, HOME, SPACE_RE, SPACES,
         SESSION_MS, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS } from "./lib";

/* ---------------- the gate ---------------- */

/** The row holding one space's passphrase. Octopus keeps the original key. */
const gateRow = async (ctx: any, space?: string) =>
  await ctx.db.query("config")
    .withIndex("by_key", (q: any) => q.eq("key", gateKey(readSpace(space)))).unique();

/**
 * Whether a source row belongs to a space: one of the brains it was filed
 * into lives there. A source carries no space of its own, its brains do.
 */
async function sourceIn(ctx: any, row: any, space: string): Promise<boolean> {
  for (const b of row?.brains ?? []) {
    const brain = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", b)).unique();
    if (brain && readSpace(brain.space) === space) return true;
  }
  return false;
}

/** A link a page may show: http or https, nothing else. */
const safeLink = (s: any) => /^https?:\/\//i.test(String(s ?? "").trim()) ? String(s).trim() : "";

export const gateState = internalQuery({
  args: { space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await gateRow(ctx, a.space);
    return row ? { set: !!row.hash, salt: row.salt, hash: row.hash, attempts: row.attempts ?? 0, attemptWindow: row.attemptWindow ?? 0 } : null;
  },
});

/** Which spaces have a passphrase. The landing asks this before drawing a door. */
export const gatesSet = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("config").collect();
    const has = (k: string) => rows.some(r => r.key === k && !!r.hash);
    return { octopus: has(gateKey("octopus")), squidgy: has(gateKey("squidgy")) };
  },
});

export const setGate = internalMutation({
  args: { salt: v.string(), hash: v.string(), space: v.optional(v.string()), replace: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const row = await gateRow(ctx, space);
    if (row?.hash && !a.replace) throw new Error("a passphrase is already set");
    const doc = { key: gateKey(space), salt: a.salt, hash: a.hash, attempts: 0, attemptWindow: Date.now(), setAt: today() };
    if (row) await ctx.db.patch(row._id, doc); else await ctx.db.insert("config", doc);
  },
});

export const noteAttempt = internalMutation({
  args: { ok: v.boolean(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await gateRow(ctx, a.space);
    if (!row) return;
    const now = Date.now();
    const fresh = now - (row.attemptWindow ?? 0) > ATTEMPT_WINDOW_MS;
    await ctx.db.patch(row._id, {
      attempts: a.ok ? 0 : (fresh ? 1 : (row.attempts ?? 0) + 1),
      attemptWindow: fresh ? now : (row.attemptWindow ?? now),
    });
  },
});

export const newSession = internalMutation({
  args: { account: v.optional(v.string()), kind: v.string(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const token = randomHex(24);
    await ctx.db.insert("sessions", {
      token, expires: Date.now() + SESSION_MS, kind: a.kind, space: readSpace(a.space),
      ...(a.account ? { account: a.account } : {}),
      /* A demo visitor gets a name of their own, for their chats. */
      ...(a.kind === "demo" ? { visitor: randomHex(8) } : {}),
    });
    return token;
  },
});

/**
 * Who is calling. Null means no live session. Sessions written before guests
 * existed carry no kind, and those were all the owner's.
 */
export const checkSession = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const s = await ctx.db.query("sessions").withIndex("by_token", q => q.eq("token", a.token)).unique();
    if (!s || s.expires <= Date.now()) return null;
    const kind = s.kind === "member" || s.kind === "guest" || s.kind === "demo" ? s.kind : "owner";
    return { kind, account: s.account ?? null, space: readSpace(s.space), visitor: s.visitor ?? null };
  },
});

/* ---------------- accounts ---------------- */

export const findAccount = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, a) =>
    await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique(),
});

/**
 * Each project has one connector address, held by one account of its own:
 * "owner" for Octopus, "owner-squidgy" for Squidgy. Before each project had
 * one, the Octopus address sat on the deployment's only account, whatever
 * its name, so that account still holds it.
 */
const holderSlug = (space: string) => space === HOME ? "owner" : `owner-${space}`;
async function holderIn(ctx: any, space: string): Promise<string | null> {
  const named = await ctx.db.query("accounts").withIndex("by_slug", (q: any) => q.eq("slug", holderSlug(space))).unique();
  if (named) return named.slug;
  if (space !== HOME) return null;
  const home = (await ctx.db.query("accounts").take(20)).filter((r: any) => readSpace(r.space) === HOME);
  return home.length === 1 ? home[0].slug : null;
}

/** The account holding a project's connector address, made the first time it is asked for. */
export const connectorHolder = internalMutation({
  args: { space: v.string(), salt: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const held = await holderIn(ctx, space);
    if (held) return held;
    const slug = holderSlug(space);
    await ctx.db.insert("accounts", { name: "Owner", slug, salt: a.salt, space, created: today(), lastSeen: today() });
    return slug;
  },
});

export const dropSession = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const s = await ctx.db.query("sessions").withIndex("by_token", q => q.eq("token", a.token)).unique();
    if (s) await ctx.db.delete(s._id);
  },
});

/* ---------------- reading the brains ---------------- */

/**
 * Everything one space holds.
 *
 * The brains of that space, then only the concepts and sources that name one of
 * them. A concept carries its brain's slug and a source carries a list of them,
 * so the brains decide the rest. Slugs are unique across both spaces, which is
 * what lets this filter be a name match.
 */
export const everything = internalQuery({
  args: { space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const all = await ctx.db.query("brains").collect();
    const brains = all.filter(b => readSpace(b.space) === space);
    const mine = new Set(brains.map(b => b.slug));
    /* Read brain by brain through the index, so the other space's concepts
       are never read and never count toward this call's read limit. */
    const concepts = (await Promise.all(brains.map(b =>
      ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", b.slug)).collect()))).flat();
    const sources = (await ctx.db.query("sources").collect())
      .filter(s => (s.brains ?? []).some((x: string) => mine.has(x)));
    return { brains, concepts, sources };
  },
});

/** The duplicate check. An index lookup, so it stays flat at any size. */
export const findSource = internalQuery({
  args: { linkKey: v.string(), sid: v.string(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    /* Only a row of this space counts: a source the other space holds is
       neither shown nor reused here. */
    const space = readSpace(a.space);
    if (a.linkKey) {
      for (const row of await ctx.db.query("sources").withIndex("by_linkKey", q => q.eq("linkKey", a.linkKey)).collect()) {
        if (await sourceIn(ctx, row, space)) return row;
      }
    }
    for (const row of await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", a.sid)).collect()) {
      if (await sourceIn(ctx, row, space)) return row;
    }
    return null;
  },
});

export const conceptsOf = internalQuery({
  args: { brain: v.string() },
  handler: async (ctx, a) =>
    await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).collect(),
});

/* ---------------- writing ---------------- */

export const createBrain = internalMutation({
  args: { name: v.string(), type: v.string(), scope: v.string(),
          visibility: v.optional(v.string()), owner: v.optional(v.string()),
          space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    /* Slugs are unique across every workspace. A name taken in another one
       gets this workspace's slug added, so it never collides or says the
       other exists. */
    const space = readSpace(a.space);
    const base = slug(a.name);
    let s = base;
    for (let n = 1; ; n++) {
      const seen = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", s)).unique();
      if (!seen) break;
      if (readSpace(seen.space) === space && s === base) throw new Error("a brain with that name exists");
      s = n === 1 ? `${base}-${space}` : `${base}-${space}-${n}`;
      if (n > 50) throw new Error("pick another name");
    }
    await ctx.db.insert("brains", {
      slug: s, name: a.name, type: a.type, scope: a.scope, created: today(),
      visibility: a.visibility === "private" ? "private" : a.visibility === "drop" ? "drop" : "ask",
      space: readSpace(a.space),
      ...(a.owner ? { owner: a.owner } : {}),
    });
    return s;
  },
});

/** Flip one brain between hidden and readable. */


/**
 * Rename a brain, and carry everything that points at it.
 *
 * A brain is addressed by its slug in three other tables, so a name that
 * changes the slug has to move the concepts, the source rows and the counted
 * candidates with it. Miss one and the concepts orphan.
 *
 * The notes keep the old slug inside their raw findings. Nothing reads that for
 * routing, so it stays as the record of what the plan said at the time.
 */
/* ---------------- the personal connector ---------------- */

/**
 * The account behind a connector address.
 *
 * The token is the whole credential, so it is matched on its own index and
 * nothing else is accepted. An empty token never matches, because a row with no
 * token stores undefined rather than "".
 */
export const accountByMcpToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (a.token.length < 24) return null;
    const acc = await ctx.db.query("accounts")
      .withIndex("by_mcpToken", q => q.eq("mcpToken", a.token)).unique();
    if (!acc) return null;
    /* Only the address of a project's holder opens it. A member's address
       from before the app was owner only opens nothing. */
    const space = readSpace(acc.space);
    if ((await holderIn(ctx, space)) !== acc.slug) return null;
    /* The shape the MCP server reads as its caller: `account` names the
       holder, and every draft is keyed to it. */
    return { account: acc.slug, name: acc.name, space };
  },
});

/** Issue, replace or withdraw an account's connector address. */
export const setMcpToken = internalMutation({
  args: { slug: v.string(), token: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts")
      .withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!acc) throw new Error("no such account");
    await ctx.db.patch(acc._id, a.token
      ? { mcpToken: a.token, mcpMade: today() }
      : { mcpToken: undefined, mcpMade: undefined });
    return { token: a.token, made: a.token ? today() : "" };
  },
});

/**
 * The account's own address, token included.
 *
 * Only a signed-in session reaches this, and that same session can already
 * write to these brains directly, so showing the token to it adds no reach.
 * Hiding it would only mean the owner has to replace a working address every
 * time they want to paste it into a second client.
 */
export const mcpState = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts")
      .withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    return { has: !!acc?.mcpToken, token: acc?.mcpToken ?? "", made: acc?.mcpMade ?? "" };
  },
});

/* ---------------- a drop in progress ---------------- */

/** Twelve hours is long enough for a conversation and short enough to forget. */
const DRAFT_MS = 1000 * 60 * 60 * 12;

export const newDraft = internalMutation({
  args: { token: v.string(), account: v.string(), link: v.string(), sid: v.string(),
          brain: v.string(), ext: v.any() },
  handler: async (ctx, a) => {
    await ctx.db.insert("drafts", {
      ...a, plan: null, parts: 1, created: today(), expires: Date.now() + DRAFT_MS,
    });
    return { token: a.token };
  },
});

export const getDraft = internalQuery({
  args: { token: v.string(), account: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db.query("drafts")
      .withIndex("by_token", q => q.eq("token", a.token)).unique();
    /* A draft belongs to the account that started it, so another connector
       cannot read or store it. */
    if (!d || d.account !== a.account) return null;
    if (d.expires < Date.now()) return null;
    return { token: d.token, link: d.link, sid: d.sid, brain: d.brain,
             ext: d.ext, plan: d.plan, parts: d.parts };
  },
});

export const saveDraft = internalMutation({
  args: { token: v.string(), account: v.string(), ext: v.optional(v.any()),
          plan: v.optional(v.any()), parts: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const d = await ctx.db.query("drafts")
      .withIndex("by_token", q => q.eq("token", a.token)).unique();
    if (!d || d.account !== a.account) throw new Error("that draft is gone");
    await ctx.db.patch(d._id, {
      ...(a.ext !== undefined ? { ext: a.ext } : {}),
      ...(a.plan !== undefined ? { plan: a.plan } : {}),
      ...(a.parts !== undefined ? { parts: a.parts } : {}),
    });
    return { ok: true };
  },
});

/** Drop the draft once it has landed, and sweep whatever has gone stale. */
export const killDraft = internalMutation({
  args: { token: v.string(), account: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db.query("drafts")
      .withIndex("by_token", q => q.eq("token", a.token)).unique();
    if (d && d.account === a.account) await ctx.db.delete(d._id);
    const now = Date.now();
    for (const old of await ctx.db.query("drafts").collect()) {
      if (old.expires < now) await ctx.db.delete(old._id);
    }
    return { ok: true };
  },
});

export const renameBrain = internalMutation({
  args: { slug: v.string(), name: v.string(), scope: v.optional(v.string()),
          account: v.union(v.string(), v.null()), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b || readSpace(b.space) !== readSpace(a.space)) throw new Error("no such brain");
    if (a.account !== null && (b.owner ?? null) !== a.account) {
      throw new Error("that brain belongs to someone else");
    }
    const name = a.name.trim();
    if (name.length < 2) throw new Error("give a name of at least 2 characters");
    const to = slug(name);

    if (to !== a.slug) {
      const clash = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", to)).unique();
      if (clash) throw new Error(`"${name}" would collide with the brain already at ${to}`);
    }

    await ctx.db.patch(b._id, { name, slug: to, ...(a.scope?.trim() ? { scope: a.scope.trim() } : {}) });

    const moved = { concepts: 0, sources: 0, candidates: 0 };
    if (to !== a.slug) {
      for (const c of await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.slug)).collect()) {
        await ctx.db.patch(c._id, { brain: to }); moved.concepts++;
        await syncCard(ctx, c._id);
      }
      for (const s2 of await ctx.db.query("sources").collect()) {
        if (!s2.brains.includes(a.slug)) continue;
        await ctx.db.patch(s2._id, { brains: s2.brains.map(x => x === a.slug ? to : x) }); moved.sources++;
      }
      for (const c of await ctx.db.query("candidates").collect()) {
        if (c.brain !== a.slug) continue;
        await ctx.db.patch(c._id, { brain: to }); moved.candidates++;
      }
      /* Links name a concept as brain/slug, so every link into this brain
         follows it too, or it would point at nothing and hold a slot. */
      const space = readSpace(b.space);
      const pool = (await ctx.db.query("brains").collect()).filter(x => readSpace(x.space) === space);
      for (const br of pool) {
        const slugNow = br.slug === a.slug ? to : br.slug;
        for (const c of await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", slugNow)).collect()) {
          if (!(c.related ?? []).some((r: string) => r.startsWith(a.slug + "/"))) continue;
          await ctx.db.patch(c._id, { related: c.related.map((r: string) => r.startsWith(a.slug + "/") ? to + r.slice(a.slug.length) : r) });
          await syncCard(ctx, c._id);
        }
      }
    }
    return { from: a.slug, slug: to, name, scope: a.scope?.trim() || b.scope, moved };
  },
});

/**
 * The row a title already has. Titles over 48 characters used to be cut to a
 * shared prefix, so two ideas could land on one row. The new id keeps them
 * apart; a row stored under the old cut is still found, but only when its
 * full title matches.
 */
async function byTitle(ctx: any, table: "concepts" | "candidates", brain: string, title: string) {
  const id = conceptSlug(title), old = legacySlug(title);
  const hit = await ctx.db.query(table)
    .withIndex("by_brain_slug", (q: any) => q.eq("brain", brain).eq("slug", id)).unique();
  if (hit) return hit;
  const was = old === id ? null : await ctx.db.query(table)
    .withIndex("by_brain_slug", (q: any) => q.eq("brain", brain).eq("slug", old)).unique();
  if (was && sameTitle(was.title, title)) return was;
  /* A concept whose id was set another way is still found by its exact title. */
  if (table !== "concepts") return null;
  const card = await ctx.db.query("cards").withIndex("by_brain_title", (q: any) => q.eq("brain", brain).eq("title", title)).first();
  return card ? await ctx.db.get(card.cid) : null;
}

export const upsertConcept = internalMutation({
  args: { brain: v.string(), title: v.string(), doc: v.any(), slug: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const s = a.slug || conceptSlug(a.title);
    /* The id the caller read wins: a stored concept keeps its row whatever its
       title would give today. */
    const known = a.slug ? await ctx.db.query("concepts")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", a.slug!)).unique() : null;
    const seen = known ?? await byTitle(ctx, "concepts", a.brain, a.title);
    if (seen) {
      /* Lists are joined with the row as it is now, not as the caller read it
         a minute ago, so a parallel write keeps what it added. */
      const d = a.doc ?? {};
      await ctx.db.patch(seen._id, {
        ...d,
        ...(d.evidence ? { evidence: mergeEvidence(d.evidence, seen.evidence ?? []) } : {}),
        /* The newest 2,000 sources, well inside a list's 8,192 limit. The
           sources table keeps the full record. */
        ...(d.sources ? { sources: unionCap(seen.sources ?? [], d.sources, 1e9, String).slice(-2000) } : {}),
        ...(d.related ? { related: unionCap(d.related, seen.related ?? [], 12, String) } : {}),
        ...(d.data ? { data: unionCap(d.data, seen.data ?? [], 24, String) } : {}),
        ...(d.conflicts ? { conflicts: unionCap(d.conflicts, seen.conflicts ?? [], 12) } : {}),
        updated: today(),
      });
      await syncCard(ctx, seen._id);
      return seen._id;
    }
    /* The next number follows the newest concept, one row read, where counting
       read the whole brain on every new concept. */
    const newest = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).order("desc").first();
    const id = await ctx.db.insert("concepts", {
      brain: a.brain, slug: s, n: (newest?.n ?? 0) + 1, title: a.title,
      position: "", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [],
      ...a.doc, updated: today(),
    });
    await syncCard(ctx, id);
    return id;
  },
});

/**
 * One row per source, whatever it takes to get there.
 *
 * The same source can be filed into a second brain later, so this patches the
 * row it already has and unions the brain list. A blind insert left two rows
 * carrying one sid, and the duplicate check reads whichever came first.
 */
export const writeSource = internalMutation({
  args: { doc: v.any(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const doc = { ...a.doc, link: safeLink(a.doc.link) };
    const seen = await ctx.db.query("sources")
      .withIndex("by_sid", q => q.eq("sid", a.doc.sid)).first();
    if (!seen) { await ctx.db.insert("sources", { ...doc, stored: today() }); return; }
    /* A source id is handed in by the caller, so a row of the other space is
       never rewritten from here. */
    if (!(await sourceIn(ctx, seen, readSpace(a.space)))) throw new Error("that source belongs to another space");
    await ctx.db.patch(seen._id, {
      ...doc,
      brains: Array.from(new Set([...(seen.brains ?? []), ...(a.doc.brains ?? [])])),
      stored: seen.stored,
    });
  },
});

/** One note per source too, replaced rather than stacked. */
export const writeNote = internalMutation({
  args: { doc: v.any(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query("notes")
      .withIndex("by_sid", q => q.eq("sid", a.doc.sid)).first();
    const src = await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", a.doc.sid)).first();
    if (seen && src && !(await sourceIn(ctx, src, readSpace(a.space)))) throw new Error("that source belongs to another space");
    if (seen) await ctx.db.patch(seen._id, { ...a.doc, written: seen.written });
    else await ctx.db.insert("notes", { ...a.doc, written: today() });
  },
});

/**
 * The extraction a source already gave up.
 *
 * Filing it into a second brain reuses this, so a source is read once in its
 * life however many brains end up holding it.
 */
export const noteBySid = internalQuery({
  args: { sid: v.string(), space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const n = await ctx.db.query("notes").withIndex("by_sid", q => q.eq("sid", a.sid)).first();
    if (!n) return null;
    const src = await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", a.sid)).first();
    if (!src || !(await sourceIn(ctx, src, readSpace(a.space)))) return null;
    /* The kind comes back too, so filing it again keeps the grain it was read at. */
    return { title: n.title, author: n.author, date: n.date,
             topics: n.topics ?? [], quotes: n.quotes ?? [], thin: n.thin ?? [],
             ...(n.findings?.kind ? { kind: n.findings.kind } : {}) };
  },
});

/* ---------------- what the transcript service cost ---------------- */

export const logFetch = internalMutation({
  args: { host: v.string(), ok: v.boolean(), chars: v.number(), why: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("fetches", { ...a, at: Date.now() });
  },
});

/**
 * How many transcripts were fetched, and how they went.
 *
 * A failed fetch still spends nothing on most plans, so the two are counted
 * apart: the successful ones are the quota, the failures are the noise.
 */
export const fetchCount = internalQuery({
  args: { days: v.number() },
  handler: async (ctx, a) => {
    const since = Date.now() - a.days * 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("fetches")
      .withIndex("by_at", q => q.gte("at", since)).collect();
    const ok = rows.filter(r => r.ok);
    /* Oldest first, so a caller can see whether the pace is rising. */
    const byDay: Record<string, number> = {};
    for (const r of ok) {
      const d = new Date(r.at).toISOString().slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + 1;
    }
    return { days: a.days, got: ok.length, failed: rows.length - ok.length, byDay };
  },
});

/**
 * Count one public MCP call against an address, and say whether it may proceed.
 * A fixed window is enough here: the point is to stop a loop, not to meter
 * anybody precisely.
 */
export const mcpRate = internalMutation({
  args: { who: v.string(), max: v.number(), windowMs: v.number() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const row = await ctx.db.query("mcpHits").withIndex("by_who", q => q.eq("who", a.who)).unique();
    if (!row) {
      await ctx.db.insert("mcpHits", { who: a.who, windowStart: now, count: 1 });
      return { allowed: true, remaining: a.max - 1, retryAfter: 0 };
    }
    if (now - row.windowStart > a.windowMs) {
      await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      return { allowed: true, remaining: a.max - 1, retryAfter: 0 };
    }
    if (row.count >= a.max) {
      return { allowed: false, remaining: 0,
        retryAfter: Math.ceil((a.windowMs - (now - row.windowStart)) / 1000) };
    }
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return { allowed: true, remaining: a.max - row.count - 1, retryAfter: 0 };
  },
});

/**
 * Links added to one concept, joined to the ones it had, twelve at most, never
 * to itself. Starter links written as prose are rewritten as ids on the way.
 */
export const addRelated = internalMutation({
  args: { brain: v.string(), slug: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("concepts")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", a.slug)).unique();
    if (!c) return { added: 0 };
    const self = `${a.brain}/${a.slug}`;
    const before = [...new Set((c.related ?? []).map((r: string) => linkId(r, c.brain)))];
    const next = [...new Set([...before, ...a.ids])].filter(x => x !== self).slice(0, 12);
    const added = next.filter(x => !before.includes(x)).length;
    if (added > 0 || before.length !== (c.related ?? []).length) {
      await ctx.db.patch(c._id, { related: next });
      await syncCard(ctx, c._id);
    }
    return { added };
  },
});

/* ---------------- cards: the slim copy of each concept ---------------- */

/**
 * Rewrite one concept's card from the concept as stored now. Every mutation
 * that inserts, changes or deletes a concept calls this, so the cards never
 * drift from what they copy.
 */
export async function syncCard(ctx: any, id: any) {
  const c = await ctx.db.get(id);
  const card = await ctx.db.query("cards").withIndex("by_cid", (q: any) => q.eq("cid", id)).unique();
  if (!c) { if (card) await ctx.db.delete(card._id); return; }
  const doc = cardOf(c);
  if (card) await ctx.db.patch(card._id, doc);
  else await ctx.db.insert("cards", { cid: id, ...doc });
}

const CARDS_READY = "cards:v1", CARDS_BUILDING = "cards:building";

/**
 * A space's brains and sources, and whether the cards are built. The cards
 * themselves come a page at a time, from cardsPage: one list of every card
 * stopped at 8,192, the most a single returned list may hold.
 */
export const spaceHead = internalQuery({
  args: { space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const brains = (await ctx.db.query("brains").collect()).filter(b => readSpace(b.space) === space);
    const mine = new Set(brains.map(b => b.slug));
    const ready = !!(await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_READY)).unique());
    /* A source filed in two workspaces lists only this one's brains here. */
    const sources = (await ctx.db.query("sources").collect())
      .filter(s => (s.brains ?? []).some((x: string) => mine.has(x)))
      .map(s => ({ ...s, brains: (s.brains ?? []).filter((x: string) => mine.has(x)) }));
    return { brains, sources, ready };
  },
});

/**
 * One page of a brain's cards. Until the cards are built, the page is made
 * from the concepts, in smaller pages since a concept weighs more.
 */
export const cardsPage = internalQuery({
  args: { brain: v.string(), cursor: v.union(v.string(), v.null()), ready: v.boolean() },
  handler: async (ctx, a) => {
    if (a.ready) {
      const p = await ctx.db.query("cards").withIndex("by_brain", q => q.eq("brain", a.brain))
        .paginate({ numItems: 4000, cursor: a.cursor });
      return { cards: p.page, done: p.isDone, cursor: p.continueCursor };
    }
    const p = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain))
      .paginate({ numItems: 800, cursor: a.cursor });
    return { cards: p.page.map(c => ({ cid: c._id, ...cardOf(c) })), done: p.isDone, cursor: p.continueCursor };
  },
});

/** Concepts read whole, by brain/slug id, inside one space. At most 100. */
export const conceptsByIds = internalQuery({
  args: { space: v.optional(v.string()), ids: v.array(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const ok = new Map<string, boolean>();
    const out: any[] = [];
    for (const id of [...new Set<string>(a.ids as string[])].slice(0, 100)) {
      const cut = id.indexOf("/");
      if (cut < 1) continue;
      const brain = id.slice(0, cut), slug = id.slice(cut + 1);
      if (!ok.has(brain)) {
        const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", brain)).unique();
        ok.set(brain, !!b && readSpace(b.space) === space);
      }
      if (!ok.get(brain)) continue;
      const c = await ctx.db.query("concepts").withIndex("by_brain_slug", q => q.eq("brain", brain).eq("slug", slug)).unique();
      if (c) out.push(c);
    }
    return out;
  },
});

/** One page of a brain's concepts whole. A page of 100 keeps a brain of any
    size under the read limit. */
export const conceptsOfBrain = internalQuery({
  args: { space: v.optional(v.string()), brain: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || readSpace(b.space) !== readSpace(a.space)) return { concepts: [], next: null };
    const page = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain))
      .paginate({ numItems: 100, cursor: a.cursor ?? null });
    return { concepts: page.page, next: page.isDone ? null : page.continueCursor };
  },
});

/**
 * One page of a brain's concepts that carry an open conflict, with only what
 * settling one needs. A page reads 100 concepts, so a brain of any size is
 * walked a page at a time.
 */
export const conflictsPage = internalQuery({
  args: { space: v.optional(v.string()), brain: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || readSpace(b.space) !== readSpace(a.space)) return { items: [], next: null };
    const p = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain))
      .paginate({ numItems: 100, cursor: a.cursor });
    return {
      items: p.page.filter(c => (c.conflicts ?? []).length).map(c => ({
        id: `${c.brain}/${c.slug}`, brain: c.brain, title: c.title, conflicts: c.conflicts })),
      next: p.isDone ? null : p.continueCursor,
    };
  },
});

/* A clash is known by its two claims, which stay put while its index may not. */
const sameClash = (x: any, a: string, b: string) => String(x?.a ?? "") === a && String(x?.b ?? "") === b;

/** Whether each open conflict is a real contradiction, as a check decided once. */
export const flagConflicts = internalMutation({
  args: { space: v.optional(v.string()), flags: v.array(v.object({ id: v.string(), a: v.string(), b: v.string(), real: v.boolean() })) },
  handler: async (ctx, a) => {
    const by = new Map<string, typeof a.flags>();
    for (const f of a.flags) by.set(f.id, [...(by.get(f.id) ?? []), f]);
    for (const [id, fs] of by) {
      const c = await conceptIn(ctx, a.space, id);
      if (!c) continue;
      const next = (c.conflicts ?? []).map((x: any) => {
        const f = fs.find(y => sameClash(x, y.a, y.b));
        return f ? { ...x, real: f.real } : x;
      });
      await ctx.db.patch(c._id, { conflicts: next });
      await syncCard(ctx, c._id);
    }
  },
});

/**
 * Settle one open conflict: it leaves the list, and when the owner picked a
 * side, the position rewritten around it replaces the old one.
 */
export const settleConflict = internalMutation({
  args: { space: v.optional(v.string()), id: v.string(), a: v.string(), b: v.string(),
          position: v.optional(v.string()), summaryLine: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await conceptIn(ctx, a.space, a.id);
    if (!c) return { ok: false, why: "that concept is not in this space" };
    const had = (c.conflicts ?? []).length;
    const conflicts = (c.conflicts ?? []).filter((x: any) => !sameClash(x, a.a, a.b));
    if (conflicts.length === had) return { ok: false, why: "that conflict is already settled" };
    await ctx.db.patch(c._id, {
      conflicts,
      ...(a.position ? { position: a.position, updated: today() } : {}),
      ...(a.summaryLine ? { summaryLine: a.summaryLine } : {}),
    });
    await syncCard(ctx, c._id);
    return { ok: true };
  },
});

/** A concept by its brain/slug id, only inside the given space. */
async function conceptIn(ctx: any, space: string | undefined, id: string) {
  const cut = id.indexOf("/");
  if (cut < 1) return null;
  const brain = id.slice(0, cut), slugged = id.slice(cut + 1);
  const b = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", brain)).unique();
  if (!b || readSpace(b.space) !== readSpace(space)) return null;
  return await ctx.db.query("concepts").withIndex("by_brain_slug", (q: any) => q.eq("brain", brain).eq("slug", slugged)).unique();
}

/** One page of the card build. */
export const cardsBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const page = await ctx.db.query("concepts").paginate({ numItems: 200, cursor: a.cursor });
    for (const c of page.page) await syncCard(ctx, c._id);
    return { done: page.isDone, cursor: page.continueCursor, n: page.page.length };
  },
});

/** Whether a build should start now: not built, and nobody building it. */
export const claimCardBuild = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_READY)).unique()) return false;
    const mark = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_BUILDING)).unique();
    const now = Date.now();
    /* A build that went quiet for 15 minutes died, so another may start. */
    if (mark && now - (mark.at ?? 0) < 15 * 60 * 1000) return false;
    if (mark) await ctx.db.patch(mark._id, { at: now }); else await ctx.db.insert("config", { key: CARDS_BUILDING, at: now });
    return true;
  },
});

/** The build is done: every reader switches to the cards. */
export const markCardsReady = internalMutation({
  args: {},
  handler: async (ctx) => {
    const mark = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_BUILDING)).unique();
    if (mark) await ctx.db.delete(mark._id);
    if (!(await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_READY)).unique())) {
      await ctx.db.insert("config", { key: CARDS_READY, setAt: today() });
    }
  },
});

/** Keeps a running build marked as alive. */
export const touchCardBuild = internalMutation({
  args: {},
  handler: async (ctx) => {
    const mark = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", CARDS_BUILDING)).unique();
    if (mark) await ctx.db.patch(mark._id, { at: Date.now() });
  },
});

/**
 * What one store batch reads: the brains of the space, the concepts its plan
 * names by id, and the concept each new title already is, if any. A batch used
 * to read the whole space, about 4 MB at 1,000 concepts, 29 times a document.
 */
export const settleReads = internalQuery({
  args: { space: v.optional(v.string()), ids: v.array(v.string()),
          titles: v.array(v.object({ brain: v.string(), title: v.string() })) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const brains = (await ctx.db.query("brains").collect()).filter(b => readSpace(b.space) === space);
    const mine = new Set(brains.map(b => b.slug));
    const byId: Record<string, any> = {};
    for (const id of [...new Set<string>(a.ids as string[])].slice(0, 400)) {
      const cut = id.indexOf("/");
      if (cut < 1 || !mine.has(id.slice(0, cut))) continue;
      const c = await ctx.db.query("concepts")
        .withIndex("by_brain_slug", q => q.eq("brain", id.slice(0, cut)).eq("slug", id.slice(cut + 1))).unique();
      if (c) byId[id] = c;
    }
    const byTitleOut: any[] = [];
    for (const t of (a.titles as any[]).slice(0, 200)) {
      byTitleOut.push(mine.has(t.brain) ? await byTitle(ctx, "concepts", t.brain, t.title) : null);
    }
    const empty: Record<string, boolean> = {};
    for (const b of brains) {
      empty[b.slug] = !(await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", b.slug)).first());
    }
    return { brains, byId, byTitle: byTitleOut, empty };
  },
});

/* ---------------- chats ---------------- */

export const CHAT_DAYS = 30;
export const CHAT_KEEP = 20;
export const CHAT_PINS = 5;
/* A chat keeps its last 60 turns, which holds a long one under the size a
   row may reach. */
const CHAT_TURNS = 60;

/* Whose chats: the workspace's, or one demo visitor's. */
const ownerOf = (c: any) => c.owner ?? "";

/** Unpinned chats past 30 days, and past the newest 20 of this owner, go. */
async function pruneChats(ctx: any, space: string, owner = "") {
  const rows = await ctx.db.query("chats").withIndex("by_space_updated", (q: any) => q.eq("space", space))
    .order("desc").collect();
  const cut = Date.now() - CHAT_DAYS * 86400000;
  let kept = 0;
  for (const c of rows) {
    if (c.pinned) continue;
    if (c.updated < cut) { await ctx.db.delete(c._id); continue; }
    if (ownerOf(c) !== owner) continue;
    if (kept >= CHAT_KEEP) await ctx.db.delete(c._id);
    else kept++;
  }
}

/** A chat of this space and this owner, or null. */
async function chatIn(ctx: any, space: string, id: any, owner = "") {
  const nid = typeof id === "string" ? ctx.db.normalizeId("chats", id) : null;
  const c = nid ? await ctx.db.get(nid) : null;
  return c && c.space === space && ownerOf(c) === owner ? c : null;
}

/** The chats of a space, pinned first, then newest. Old ones are cleared first. */
export const chatList = internalMutation({
  args: { space: v.string(), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), owner = a.owner ?? "";
    await pruneChats(ctx, space, owner);
    const rows = (await ctx.db.query("chats").withIndex("by_space_updated", (q: any) => q.eq("space", space))
      .order("desc").collect()).filter((c: any) => ownerOf(c) === owner);
    return rows.sort((x: any, y: any) => Number(y.pinned) - Number(x.pinned) || y.updated - x.updated)
      .map((c: any) => ({ id: String(c._id), title: c.title, brain: c.brain, pinned: c.pinned,
                          updated: c.updated, turns: c.turns.length }));
  },
});

/** One chat whole, to reopen it. */
export const chatGet = internalQuery({
  args: { space: v.string(), id: v.string(), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await chatIn(ctx, readSpace(a.space), a.id, a.owner ?? "");
    return c ? { id: String(c._id), title: c.title, brain: c.brain, pinned: c.pinned, turns: c.turns } : null;
  },
});

/** A question and its answer, added to a chat. No chat, or one gone, starts a new one. */
export const chatTurn = internalMutation({
  args: { space: v.string(), id: v.optional(v.union(v.string(), v.null())), brain: v.string(), turn: v.any(), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now(), owner = a.owner ?? "";
    const had = await chatIn(ctx, space, a.id, owner);
    if (had) {
      await ctx.db.patch(had._id, { turns: [...had.turns, a.turn].slice(-CHAT_TURNS), brain: a.brain, updated: now });
      return { id: String(had._id), created: false };
    }
    const q = String(a.turn?.q ?? "").replace(/\s+/g, " ").trim();
    const title = q.length > 80 ? q.slice(0, 77).replace(/\s+\S*$/, "") + "..." : q || "Untitled chat";
    const id = await ctx.db.insert("chats", { space, title, brain: a.brain, pinned: false, turns: [a.turn], created: now, updated: now,
      ...(owner ? { owner } : {}) });
    await pruneChats(ctx, space, owner);
    return { id: String(id), created: true };
  },
});

/** Rename, pin or unpin, or delete a chat. At most 5 are pinned. */
export const chatEdit = internalMutation({
  args: { space: v.string(), id: v.string(), title: v.optional(v.string()), pinned: v.optional(v.boolean()), remove: v.optional(v.boolean()),
          owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), owner = a.owner ?? "";
    const c = await chatIn(ctx, space, a.id, owner);
    if (!c) return { error: "that chat is gone" };
    if (a.remove) { await ctx.db.delete(c._id); return { ok: true, removed: true }; }
    const patch: any = {};
    if (a.title != null) {
      const t = a.title.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!t) return { error: "a chat needs a name" };
      patch.title = t;
    }
    if (a.pinned != null && a.pinned !== c.pinned) {
      if (a.pinned) {
        const pins = (await ctx.db.query("chats").withIndex("by_space_updated", (q: any) => q.eq("space", space)).collect())
          .filter((x: any) => x.pinned && ownerOf(x) === owner).length;
        if (pins >= CHAT_PINS) return { error: `${CHAT_PINS} chats are pinned already. Unpin one first.` };
      }
      patch.pinned = a.pinned;
      /* An unpinned chat counts from now, so unpinning an old one does not delete it on the spot. */
      if (!a.pinned) patch.updated = Date.now();
    }
    await ctx.db.patch(c._id, patch);
    if (a.pinned === false) await pruneChats(ctx, space, owner);
    return { ok: true };
  },
});

/* ---------------- workspaces ---------------- */

/** A workspace beyond the owner's two, or null. */
export const workspaceOf = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, a) => await ctx.db.query("workspaces").withIndex("by_slug", q => q.eq("slug", a.slug)).unique(),
});

/** The demo workspace, when there is one. */
export const demoWorkspace = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("workspaces").collect()).find(w => w.kind === "demo") ?? null,
});

/**
 * A new workspace and its passphrase, in one write. A slug the owner's
 * workspaces hold, one taken, or one a brain already uses is refused.
 */
export const createWorkspace = internalMutation({
  args: { slug: v.string(), name: v.string(), kind: v.string(), salt: v.optional(v.string()), hash: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const slug = a.slug;
    if (!SPACE_RE.test(slug) || (SPACES as readonly string[]).includes(slug)) return { error: "that name is taken. Pick another." };
    if (await ctx.db.query("workspaces").withIndex("by_slug", q => q.eq("slug", slug)).unique()) return { error: "that name is taken. Pick another." };
    if (await ctx.db.query("config").withIndex("by_key", q => q.eq("key", gateKey(slug))).unique()) return { error: "that name is taken. Pick another." };
    await ctx.db.insert("workspaces", { slug, name: a.name.slice(0, 60), kind: a.kind, created: today() });
    if (a.salt && a.hash) {
      await ctx.db.insert("config", { key: gateKey(slug), salt: a.salt, hash: a.hash, attempts: 0, attemptWindow: Date.now(), setAt: today() });
    }
    return { ok: true, slug };
  },
});

/* ---------------- a workspace's look ---------------- */

const brandRow = async (ctx: any, space: string) =>
  await ctx.db.query("brands").withIndex("by_space", (q: any) => q.eq("space", space)).unique();
const brandView = (b: any) => b && (b.logo || b.accent || b.bg)
  ? { logo: b.logo ?? null, accent: b.accent ?? null, bg: b.bg ?? null } : null;

/** A workspace's logo and colours, or null for the look it wears by default. */
export const brandOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => brandView(await brandRow(ctx, a.space)),
});

/**
 * Set a workspace's look. A field left out stays as it is, a null clears it,
 * and reset clears all three.
 */
export const setBrand = internalMutation({
  args: {
    space: v.string(), reset: v.optional(v.boolean()),
    logo: v.optional(v.union(v.string(), v.null())),
    accent: v.optional(v.union(v.string(), v.null())),
    bg: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const row = await brandRow(ctx, a.space);
    if (a.reset) { if (row) await ctx.db.delete(row._id); return null; }
    const next: any = { logo: row?.logo, accent: row?.accent, bg: row?.bg };
    for (const k of ["logo", "accent", "bg"] as const) {
      if (a[k] === undefined) continue;
      next[k] = a[k] === null ? undefined : a[k];
    }
    const doc: any = { space: a.space, updated: Date.now() };
    for (const k of ["logo", "accent", "bg"]) if (next[k]) doc[k] = next[k];
    if (row) await ctx.db.replace(row._id, doc); else await ctx.db.insert("brands", doc);
    return brandView(doc);
  },
});
