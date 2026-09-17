/** Internal reads and writes. HTTP actions reach the database only through these. */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { sha256, randomHex, today, slug, MENTIONS, SESSION_MS, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS } from "./lib";

/* ---------------- the gate ---------------- */

export const gateState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "gate")).unique();
    return row ? { set: !!row.hash, salt: row.salt, hash: row.hash, attempts: row.attempts ?? 0, attemptWindow: row.attemptWindow ?? 0 } : null;
  },
});

export const setGate = internalMutation({
  args: { salt: v.string(), hash: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "gate")).unique();
    if (row?.hash) throw new Error("a passphrase is already set");
    const doc = { key: "gate", salt: a.salt, hash: a.hash, attempts: 0, attemptWindow: Date.now(), setAt: today() };
    if (row) await ctx.db.patch(row._id, doc); else await ctx.db.insert("config", doc);
  },
});

export const noteAttempt = internalMutation({
  args: { ok: v.boolean() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "gate")).unique();
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
  args: { account: v.optional(v.string()), kind: v.string() },
  handler: async (ctx, a) => {
    const token = randomHex(24);
    await ctx.db.insert("sessions", {
      token, expires: Date.now() + SESSION_MS, kind: a.kind,
      ...(a.account ? { account: a.account } : {}),
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
    const kind = s.kind === "member" || s.kind === "guest" ? s.kind : "owner";
    return { kind, account: s.account ?? null };
  },
});

/* ---------------- accounts ---------------- */

export const findAccount = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, a) =>
    await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique(),
});

export const createAccount = internalMutation({
  args: { name: v.string(), slug: v.string(), salt: v.string(), passHash: v.string() },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (seen) throw new Error("that name is taken");
    await ctx.db.insert("accounts", {
      name: a.name, slug: a.slug, salt: a.salt, passHash: a.passHash,
      created: today(), lastSeen: today(),
    });
    return a.slug;
  },
});

/**
 * Remember a member's model key, or forget it. Only ciphertext reaches this
 * mutation: the plaintext key is sealed in the HTTP action and never becomes a
 * function argument, because Convex records those.
 */
export const setAccountKey = internalMutation({
  args: {
    slug: v.string(),
    cipher: v.optional(v.string()),
    iv: v.optional(v.string()),
    hint: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!acc) throw new Error("no such account");
    if (!a.cipher) {
      await ctx.db.patch(acc._id, {
        keyCipher: undefined, keyIv: undefined, keyHint: undefined, keySavedAt: undefined,
      });
      return { saved: false };
    }
    await ctx.db.patch(acc._id, {
      keyCipher: a.cipher, keyIv: a.iv, keyHint: a.hint, keySavedAt: today(),
    });
    return { saved: true, hint: a.hint };
  },
});

/** The sealed key for one account, for the HTTP action to open. */
export const accountKey = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!acc?.keyCipher || !acc.keyIv) return null;
    return { cipher: acc.keyCipher, iv: acc.keyIv, hint: acc.keyHint ?? "" };
  },
});

export const touchAccount = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (acc) await ctx.db.patch(acc._id, { lastSeen: today() });
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

export const everything = internalQuery({
  args: {},
  handler: async (ctx) => ({
    brains: await ctx.db.query("brains").collect(),
    concepts: await ctx.db.query("concepts").collect(),
    sources: await ctx.db.query("sources").collect(),
  }),
});

/** The duplicate check. An index lookup, so it stays flat at any size. */
export const findSource = internalQuery({
  args: { linkKey: v.string(), sid: v.string() },
  handler: async (ctx, a) => {
    if (a.linkKey) {
      const byLink = await ctx.db.query("sources").withIndex("by_linkKey", q => q.eq("linkKey", a.linkKey)).first();
      if (byLink) return byLink;
    }
    return await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", a.sid)).first();
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
          visibility: v.optional(v.string()), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const s = slug(a.name);
    const seen = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", s)).unique();
    if (seen) throw new Error("a brain with that name exists");
    await ctx.db.insert("brains", {
      slug: s, name: a.name, type: a.type, scope: a.scope, created: today(),
      visibility: a.visibility === "private" ? "private" : a.visibility === "drop" ? "drop" : "ask",
      ...(a.owner ? { owner: a.owner } : {}),
    });
    return s;
  },
});

/** Flip one brain between hidden and readable. */
/** Open a brain to everyone's sources, or close it to its creator's. */
export const setVisibility = internalMutation({
  args: { slug: v.string(), visibility: v.string(), account: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b) throw new Error("no such brain");
    /* The owner may change any brain. A member may change only their own. */
    if (a.account !== null && (b.owner ?? null) !== a.account) {
      throw new Error("that brain belongs to someone else");
    }
    const v2 = a.visibility === "open" || a.visibility === "drop" ? "open" : "closed";
    await ctx.db.patch(b._id, { visibility: v2 });
    return { slug: a.slug, visibility: v2 };
  },
});


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
    return acc ? { slug: acc.slug, name: acc.name } : null;
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
          account: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b) throw new Error("no such brain");
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
      }
      for (const s2 of await ctx.db.query("sources").collect()) {
        if (!s2.brains.includes(a.slug)) continue;
        await ctx.db.patch(s2._id, { brains: s2.brains.map(x => x === a.slug ? to : x) }); moved.sources++;
      }
      for (const c of await ctx.db.query("candidates").collect()) {
        if (c.brain !== a.slug) continue;
        await ctx.db.patch(c._id, { brain: to }); moved.candidates++;
      }
    }
    return { from: a.slug, slug: to, name, scope: a.scope?.trim() || b.scope, moved };
  },
});

export const upsertConcept = internalMutation({
  args: { brain: v.string(), title: v.string(), doc: v.any() },
  handler: async (ctx, a) => {
    const s = slug(a.title);
    const seen = await ctx.db.query("concepts")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", s)).unique();
    if (seen) { await ctx.db.patch(seen._id, { ...a.doc, updated: today() }); return seen._id; }
    const count = (await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).collect()).length;
    return await ctx.db.insert("concepts", {
      brain: a.brain, slug: s, n: count + 1, title: a.title,
      position: "", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [],
      ...a.doc, updated: today(),
    });
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
  args: { doc: v.any() },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query("sources")
      .withIndex("by_sid", q => q.eq("sid", a.doc.sid)).first();
    if (!seen) { await ctx.db.insert("sources", { ...a.doc, stored: today() }); return; }
    await ctx.db.patch(seen._id, {
      ...a.doc,
      brains: Array.from(new Set([...(seen.brains ?? []), ...(a.doc.brains ?? [])])),
      stored: seen.stored,
    });
  },
});

/** One note per source too, replaced rather than stacked. */
export const writeNote = internalMutation({
  args: { doc: v.any() },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query("notes")
      .withIndex("by_sid", q => q.eq("sid", a.doc.sid)).first();
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
  args: { sid: v.string() },
  handler: async (ctx, a) => {
    const n = await ctx.db.query("notes").withIndex("by_sid", q => q.eq("sid", a.sid)).first();
    if (!n) return null;
    return { title: n.title, author: n.author, date: n.date,
             topics: n.topics ?? [], quotes: n.quotes ?? [], thin: n.thin ?? [] };
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

/** R5.5 seeding and the mention threshold both live here. */
export const bumpCandidate = internalMutation({
  args: { brain: v.string(), title: v.string(), sid: v.string() },
  handler: async (ctx, a) => {
    const s = slug(a.title);
    const row = await ctx.db.query("candidates")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", s)).unique();
    const notes = Array.from(new Set([...(row?.notes ?? []), a.sid]));
    if (notes.length >= MENTIONS) {
      if (row) await ctx.db.delete(row._id);
      return { promoted: true, notes };
    }
    if (row) await ctx.db.patch(row._id, { notes, count: notes.length, updated: today() });
    else await ctx.db.insert("candidates", { brain: a.brain, slug: s, title: a.title, notes, count: notes.length, updated: today() });
    return { promoted: false, notes };
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
