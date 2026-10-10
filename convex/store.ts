/** Internal reads and writes. HTTP actions reach the database only through these. */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { linkId, conceptSlug, legacySlug, sameTitle, mergeEvidence, unionCap, cardOf, mergeFile, dedupeOpen, CACHE_DAYS } from "./words";
import { sha256, randomHex, today, slug, gateKey, readSpace, HOME, SPACE_RE, SPACES,
         SESSION_MS, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS, inSpace, isViewer, SPACE_NAME, linkKey, DAY_MS } from "./lib";

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
    if (brain && inSpace(brain, space)) return true;
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

/**
 * Every door with a passphrase, for the landing's one field: its space, salt
 * and hash. A workspace that is gone is left out, so its door opens nothing.
 */
export const doorsAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("config").collect()).filter(r => r.hash && r.salt && (r.key === "gate" || r.key.startsWith("gate:")));
    const out: { space: string; salt: string; hash: string }[] = [];
    for (const r of rows) {
      const space = r.key === "gate" ? HOME : r.key.slice(5);
      const own = (SPACES as readonly string[]).includes(space);
      if (!own && !(await ctx.db.query("workspaces").withIndex("by_slug", q => q.eq("slug", space)).unique())) continue;
      out.push({ space, salt: r.salt as string, hash: r.hash as string });
    }
    /* The owner's own two first, then the rest by name. */
    return out.sort((x, y) => Number((SPACES as readonly string[]).includes(y.space)) - Number((SPACES as readonly string[]).includes(x.space)) || x.space.localeCompare(y.space));
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

/**
 * One guess at a passphrase, counted before it is checked. Guesses sent all at
 * once each take their turn here, so 8 an hour is the most any burst gets.
 * It hands back the salt and hash only while the door is open to guesses.
 */
export const takeAttempt = internalMutation({
  args: { space: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await gateRow(ctx, a.space);
    if (!row?.hash) return { set: false, locked: false };
    const now = Date.now();
    const fresh = now - (row.attemptWindow ?? 0) > ATTEMPT_WINDOW_MS;
    const attempts = fresh ? 0 : (row.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) return { set: true, locked: true };
    await ctx.db.patch(row._id, { attempts: attempts + 1, attemptWindow: fresh ? now : (row.attemptWindow ?? now) });
    return { set: true, locked: false, salt: row.salt as string, hash: row.hash as string };
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

/**
 * End every session of a workspace but one: the passphrase changed, so
 * whoever held the old one is signed out, and the person who changed it is not.
 */
export const endOtherSessions = internalMutation({
  args: { space: v.string(), keep: v.string() },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("sessions").withIndex("by_space", q => q.eq("space", readSpace(a.space))).collect();
    let ended = 0;
    for (const s of rows) if (s.token !== a.keep) { await ctx.db.delete(s._id); ended++; }
    return ended;
  },
});

/* ---------------- shared brains ---------------- */

/** The demo workspace, when there is one: the one place a brain is shared to be read only. */
async function demoSlug(ctx: any): Promise<string | null> {
  for (const w of await ctx.db.query("workspaces").collect()) if (w.kind === "demo") return w.slug;
  return null;
}

/** The workspaces made for someone on this deployment's key: they may be given a brain to feed. */
async function hostedSpaces(ctx: any): Promise<{ slug: string; name: string }[]> {
  return (await ctx.db.query("workspaces").collect()).filter((w: any) => w.kind === "hosted").map((w: any) => ({ slug: w.slug, name: w.name }));
}

/**
 * What a workspace's owner sees under Share brain: the workspaces a brain can
 * go to, the brains that live here and which of those it already goes to, and
 * the brains other workspaces shared into this one.
 *
 * A target is the owner's other workspace, which can feed the brain too, or
 * the demo, which can only read it.
 */
export const shareState = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const all = await ctx.db.query("brains").collect();
    const hosted = await hostedSpaces(ctx);
    const demo = await demoSlug(ctx);
    const name = (s: string) => SPACE_NAME[s] ?? hosted.find(h => h.slug === s)?.name ?? s;
    const targets = [
      ...(SPACES as readonly string[]).filter(s => s !== space).map(s => ({ slug: s, name: name(s), mode: "edit" })),
      ...hosted.filter(h => h.slug !== space).map(h => ({ slug: h.slug, name: h.name, mode: "edit" })),
      ...(demo && demo !== space ? [{ slug: demo, name: name(demo), mode: "read" }] : []),
    ];
    return {
      targets,
      brains: all.filter(b => readSpace(b.space) === space && b.type !== "personal" && b.type !== "project")
        .map(b => ({ slug: b.slug, name: b.name, type: b.type, to: [...(b.shared ?? []), ...(b.viewers ?? [])] })),
      joined: all.filter(b => readSpace(b.space) !== space && inSpace(b, space))
        .map(b => ({ slug: b.slug, name: b.name, type: b.type, from: readSpace(b.space), fromName: name(readSpace(b.space)),
                     readOnly: isViewer(b, space) })),
    };
  },
});

/**
 * Put one brain in one more workspace, or take it out. Only the owner of the
 * brain's own workspace does this, and never for a personal brain: what you
 * told it stays in its chat.
 *
 * The owner's other workspace gets the brain whole, so a drop in either fills
 * both. The demo is open to anyone, so it only reads the brain.
 */
export const shareBrain = internalMutation({
  args: { slug: v.string(), space: v.string(), to: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    const home = readSpace(a.space);
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b || readSpace(b.space) !== home) throw new Error("that brain does not live in this workspace");
    if (b.type === "personal") throw new Error("a personal brain is never shared");
    if (b.type === "project") throw new Error("a project is never shared");
    const to = String(a.to).trim().toLowerCase();
    const editor = to !== home && ((SPACES as readonly string[]).includes(to) || (await hostedSpaces(ctx)).some(h => h.slug === to));
    const viewer = !editor && to !== home && to === (await demoSlug(ctx));
    if (!editor && !viewer) throw new Error(`a brain cannot be shared with "${to}"`);
    const without = (list: string[] | undefined) => (list ?? []).filter(s => s !== to);
    const shared = editor ? (a.on ? [...without(b.shared), to] : without(b.shared)) : (b.shared ?? []);
    const viewers = viewer ? (a.on ? [...without(b.viewers), to] : without(b.viewers)) : (b.viewers ?? []);
    await ctx.db.patch(b._id, { shared, viewers });
    return { slug: b.slug, shared, viewers };
  },
});

/** A workspace stops seeing a brain that was shared with it. The brain stays where it lives. */
export const leaveBrain = internalMutation({
  args: { slug: v.string(), space: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.slug)).unique();
    if (!b || readSpace(b.space) === space || !inSpace(b, space)) throw new Error("that brain is not shared with this workspace");
    await ctx.db.patch(b._id, { shared: (b.shared ?? []).filter((s: string) => s !== space), viewers: (b.viewers ?? []).filter((s: string) => s !== space) });
    return { slug: b.slug };
  },
});

/* ---------------- accounts ---------------- */

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
    const brains = all.filter(b => inSpace(b, space));
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
      if (inSpace(seen, space) && s === base) throw new Error("a brain with that name exists");
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
    /* A project is renamed from its own screen: its file, thread and changes are kept under its slug. */
    if (b.type === "project") throw new Error("rename a project from its own screen");
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
      /* Every workspace that sees this brain holds links into it. */
      const seenIn = [readSpace(b.space), ...(b.shared ?? []), ...(b.viewers ?? [])];
      const pool = (await ctx.db.query("brains").collect()).filter(x => seenIn.some((sp: string) => inSpace(x, sp)));
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
 * One concept folded into another of the same idea: the evidence, sources,
 * data, conflicts and links join, and the folded row goes. The kept one holds
 * its position until it is derived again from the joined evidence.
 */
async function joinConcept(ctx: any, keep: any, gone: any) {
  const keepId = `${keep.brain}/${keep.slug}`, goneId = `${gone.brain}/${gone.slug}`;
  await ctx.db.patch(keep._id, {
    evidence: mergeEvidence(gone.evidence ?? [], keep.evidence ?? []),
    sources: unionCap(keep.sources ?? [], gone.sources ?? [], 1e9, String).slice(-2000),
    data: unionCap(keep.data ?? [], gone.data ?? [], 24, String),
    conflicts: unionCap(keep.conflicts ?? [], gone.conflicts ?? [], 12),
    related: unionCap(keep.related ?? [], gone.related ?? [], 12, String).filter((r: string) => r !== keepId && r !== goneId),
    kinds: unionCap(keep.kinds ?? [], gone.kinds ?? [], 12, (k: any) => k.to).filter((k: any) => k.to !== keepId && k.to !== goneId),
    updated: today(),
  });
  await ctx.db.delete(gone._id); await syncCard(ctx, gone._id); await syncCard(ctx, keep._id);
}

/** Links across the workspace follow the concepts that moved or joined, found on the slim cards. */
async function followLinks(ctx: any, to: Map<string, string>, write: boolean): Promise<number> {
  if (!to.size) return 0;
  const follow = (r: string) => to.get(r) ?? r;
  let n = 0;
  for (const card of await ctx.db.query("cards").collect()) {
    const rel: string[] = card.related ?? [];
    if (!rel.some(r => to.has(r))) continue;
    const c = await ctx.db.get(card.cid);
    if (!c) continue;
    const self = `${c.brain}/${c.slug}`;
    n++;
    if (write) {
      await ctx.db.patch(c._id, { related: [...new Set<string>((c.related ?? []).map(follow))].filter(r => r !== self),
        ...(c.kinds ? { kinds: c.kinds.map((k: any) => ({ to: follow(k.to), type: k.type })).filter((k: any) => k.to !== self) } : {}) });
      await syncCard(ctx, c._id);
    }
  }
  return n;
}

/**
 * A concept this workspace may change, by its id: in a folder it holds or one
 * shared into it, never one it only views, never a personal one.
 */
async function ownConcept(ctx: any, space: string, id: string) {
  const cut = id.indexOf("/");
  if (cut < 1) return null;
  const b = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", id.slice(0, cut))).unique();
  if (!b || !inSpace(b, space) || isViewer(b, space) || b.type === "personal" || b.type === "project") return null;
  return await ctx.db.query("concepts")
    .withIndex("by_brain_slug", (q: any) => q.eq("brain", id.slice(0, cut)).eq("slug", id.slice(cut + 1))).unique();
}

/**
 * Concepts of one folder that hold the same idea, folded into the first.
 * Links anywhere in the workspace that named a folded one now name the kept one.
 */
export const joinConcepts = internalMutation({
  args: { space: v.optional(v.string()), into: v.string(), from: v.array(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const keep = await ownConcept(ctx, space, a.into);
    if (!keep) throw new Error("that concept is not in this workspace");
    const to = new Map<string, string>();
    for (const id of [...new Set<string>(a.from as string[])].filter(x => x !== a.into).slice(0, 20)) {
      const c = await ownConcept(ctx, space, id);
      if (!c) continue;
      if (c.brain !== keep.brain) throw new Error("only concepts of one folder merge");
      /* Read again each time, so a third concept joins what the second added. */
      await joinConcept(ctx, await ctx.db.get(keep._id), c);
      to.set(id, a.into);
    }
    const links = await followLinks(ctx, to, true);
    return { into: a.into, joined: to.size, links };
  },
});

/** A concept's title, changed in place. Its id stays, so no link breaks. */
export const renameConcept = internalMutation({
  args: { space: v.optional(v.string()), id: v.string(), title: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const title = a.title.replace(/\s+/g, " ").trim().slice(0, 160);
    if (title.length < 3) throw new Error("a title takes 3 characters at least");
    const c = await ownConcept(ctx, space, a.id);
    if (!c) throw new Error("that concept is not in this workspace");
    const other = await byTitle(ctx, "concepts", c.brain, title);
    if (other && other._id !== c._id && sameTitle(other.title, title)) {
      throw new Error(`"${other.title}" is already in this folder: merge the two instead`);
    }
    await ctx.db.patch(c._id, { title, updated: today() });
    await syncCard(ctx, c._id);
    return { id: a.id, title };
  },
});

/**
 * One folder poured into another, in one write: every concept moves, a
 * concept whose title the target already holds joins that one, and every
 * source, link, candidate, chat and gap that named the old folder follows.
 * The old folder then goes. Both must live in this workspace, and neither may
 * be personal. With dry, it only counts.
 */
export async function mergeInto(ctx: any, a: { from: string; into: string; space: string; dry?: boolean }) {
  const space = readSpace(a.space);
  if (a.from === a.into) throw new Error("a folder cannot merge into itself");
  const bFrom = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", a.from)).unique();
  const bInto = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", a.into)).unique();
  if (!bFrom || readSpace(bFrom.space) !== space) throw new Error(`no folder "${a.from}" in this workspace`);
  if (!bInto || readSpace(bInto.space) !== space) throw new Error(`no folder "${a.into}" in this workspace`);
  if (bFrom.type === "personal" || bInto.type === "personal") throw new Error("a personal folder never merges");
  if (bFrom.type === "project" || bInto.type === "project") throw new Error("a project never merges");
  const write = !a.dry;
  const done = { moved: 0, joined: 0, links: 0, sources: 0, candidates: 0, chats: 0 };
  /* Where each old concept now lives, so links into it can follow. */
  const to = new Map<string, string>();
  let n = (await ctx.db.query("concepts").withIndex("by_brain", (q: any) => q.eq("brain", a.into)).order("desc").first())?.n ?? 0;

  for (const c of await ctx.db.query("concepts").withIndex("by_brain", (q: any) => q.eq("brain", a.from)).collect()) {
    const twin = await byTitle(ctx, "concepts", a.into, c.title);
    if (twin && sameTitle(twin.title, c.title)) {
      /* The same idea in both: the target keeps its position and gains the evidence. */
      to.set(`${a.from}/${c.slug}`, `${a.into}/${twin.slug}`); done.joined++;
      if (write) await joinConcept(ctx, twin, c);
      continue;
    }
    /* A slug the target already uses gets a suffix, so no two rows share one. */
    let slugTo = c.slug;
    for (let i = 2; await ctx.db.query("concepts").withIndex("by_brain_slug", (q: any) => q.eq("brain", a.into).eq("slug", slugTo)).unique(); i++) slugTo = `${c.slug}-${i}`;
    to.set(`${a.from}/${c.slug}`, `${a.into}/${slugTo}`); done.moved++;
    if (write) { await ctx.db.patch(c._id, { brain: a.into, slug: slugTo, n: ++n }); await syncCard(ctx, c._id); }
  }

  done.links = await followLinks(ctx, to, write);
  for (const s2 of await ctx.db.query("sources").collect()) {
    if (!(s2.brains ?? []).includes(a.from)) continue;
    done.sources++;
    if (write) await ctx.db.patch(s2._id, { brains: [...new Set(s2.brains.map((x: string) => x === a.from ? a.into : x))] });
  }
  for (const c of await ctx.db.query("candidates").collect()) {
    if (c.brain !== a.from) continue;
    done.candidates++;
    if (!write) continue;
    const same = await ctx.db.query("candidates").withIndex("by_brain_slug", (q: any) => q.eq("brain", a.into).eq("slug", c.slug)).unique();
    if (same) {
      await ctx.db.patch(same._id, { count: (same.count ?? 0) + (c.count ?? 0), notes: unionCap(same.notes ?? [], c.notes ?? [], 20, String), updated: today() });
      await ctx.db.delete(c._id);
    } else await ctx.db.patch(c._id, { brain: a.into });
  }
  const swap = (list: string) => [...new Set(String(list).split(",").map(x => x === a.from ? a.into : x))].join(",");
  for (const ch of await ctx.db.query("chats").withIndex("by_space_updated", (q: any) => q.eq("space", space)).collect()) {
    if (!String(ch.brain).split(",").includes(a.from)) continue;
    done.chats++;
    if (write) await ctx.db.patch(ch._id, { brain: swap(ch.brain) });
  }
  if (write) {
    await ctx.db.delete(bFrom._id);
  }
  return { from: a.from, into: a.into, fromName: bFrom.name, intoName: bInto.name, merged: write, ...done };
}

/** The app's Merge into: the folder poured into another of the same workspace. */
export const mergeBrains = internalMutation({
  args: { from: v.string(), into: v.string(), space: v.string(), dry: v.optional(v.boolean()) },
  handler: async (ctx, a) => await mergeInto(ctx, a),
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
      /* An instruction of a project changes only when its owner adds the file again: a note a chat or a file filed under the same title never rewrites it. */
      if (seen.tag === "instructions" && d.tag !== "instructions") return seen._id;
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
    const since = Date.now() - a.days * DAY_MS;
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
  args: { brain: v.string(), slug: v.string(), ids: v.array(v.string()),
          kinds: v.optional(v.array(v.object({ to: v.string(), type: v.string() }))) },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("concepts")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", a.slug)).unique();
    if (!c) return { added: 0 };
    const self = `${a.brain}/${a.slug}`;
    const before = [...new Set((c.related ?? []).map((r: string) => linkId(r, c.brain)))];
    const next = [...new Set([...before, ...a.ids])].filter(x => x !== self).slice(0, 12);
    const added = next.filter(x => !before.includes(x)).length;
    /* What each link means: a new reading of a link replaces the old one. */
    const typed = new Map<string, string>((c.kinds ?? []).map((k: any) => [k.to, k.type]));
    for (const k of a.kinds ?? []) typed.set(k.to, k.type);
    const kinds = next.filter(x => typed.has(x)).map(x => ({ to: x, type: typed.get(x)! }));
    const kindsChanged = JSON.stringify(kinds) !== JSON.stringify(c.kinds ?? []);
    if (added > 0 || before.length !== (c.related ?? []).length || kindsChanged) {
      await ctx.db.patch(c._id, { related: next, ...(kinds.length || c.kinds ? { kinds } : {}) });
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
 *
 * Its meaning follows it too. The search by meaning filters on the folder a
 * vector names, so a concept moved by a rename or a merge took its vector's
 * old folder along and was never found again; a concept gone left a vector
 * that still took a place among the nearest.
 */
export async function syncCard(ctx: any, id: any) {
  const c = await ctx.db.get(id);
  const card = await ctx.db.query("cards").withIndex("by_cid", (q: any) => q.eq("cid", id)).unique();
  if (!c) {
    if (card) await ctx.db.delete(card._id);
    for (const vec of await ctx.db.query("vectors").withIndex("by_cid", (q: any) => q.eq("cid", id)).collect()) await ctx.db.delete(vec._id);
    return;
  }
  const doc = cardOf(c);
  if (card) {
    const moved = card.brain !== doc.brain;
    await ctx.db.patch(card._id, doc);
    /* Read only when the folder changed: a vector is 8 KB, and most writes leave the folder as it was. */
    if (moved) {
      for (const vec of await ctx.db.query("vectors").withIndex("by_cid", (q: any) => q.eq("cid", id)).collect()) {
        if (vec.brain !== doc.brain) await ctx.db.patch(vec._id, { brain: doc.brain });
      }
    }
  }
  else await ctx.db.insert("cards", { cid: id, ...doc });
}

const CARDS_READY = "cards:v1", CARDS_BUILDING = "cards:building";

/**
 * A space's brains and sources, and whether the cards are built. The cards
 * themselves come a page at a time, from cardsPage: one list of every card
 * stopped at 8,192, the most a single returned list may hold.
 */
export const spaceHead = internalQuery({
  args: { space: v.optional(v.string()), projects: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    /* A project's folder is read by its own chat and by the personal chat, and by nothing else: callers ask for it. */
    const brains = (await ctx.db.query("brains").collect()).filter(b => inSpace(b, space) && (a.projects || b.type !== "project"));
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
        ok.set(brain, !!b && inSpace(b, space));
      }
      if (!ok.get(brain)) continue;
      const c = await ctx.db.query("concepts").withIndex("by_brain_slug", q => q.eq("brain", brain).eq("slug", slug)).unique();
      if (c) out.push(c.tag === "contact" ? await withMoments(ctx, c) : c);
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
    if (!b || !inSpace(b, readSpace(a.space))) return { concepts: [], next: null };
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
    if (!b || !inSpace(b, readSpace(a.space)) || isViewer(b, readSpace(a.space))) return { items: [], next: null };
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

/** The ruling suggested for each clash, kept so it is asked once. */
export const hintConflicts = internalMutation({
  args: { space: v.optional(v.string()), hints: v.array(v.object({ id: v.string(), a: v.string(), b: v.string(), pick: v.string(), why: v.string() })) },
  handler: async (ctx, a) => {
    const by = new Map<string, typeof a.hints>();
    for (const h of a.hints) by.set(h.id, [...(by.get(h.id) ?? []), h]);
    for (const [id, hs] of by) {
      const c = await conceptIn(ctx, a.space, id);
      if (!c) continue;
      const next = (c.conflicts ?? []).map((x: any) => {
        const h = hs.find(y => sameClash(x, y.a, y.b));
        return h ? { ...x, hint: { pick: h.pick, why: h.why } } : x;
      });
      await ctx.db.patch(c._id, { conflicts: next });
      await syncCard(ctx, c._id);
    }
  },
});

/** One finding taken off a folder's list, for good. */
export const findingsDrop = internalMutation({
  args: { space: v.string(), brain: v.string(), kind: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || !inSpace(b, readSpace(a.space)) || !b.findings) return { ok: false };
    const f: any = b.findings, list = Array.isArray(f[a.kind]) ? f[a.kind] : [];
    await ctx.db.patch(b._id, { findings: { ...f, [a.kind]: list.filter((x: any) => x?.id !== a.id) } });
    return { ok: true };
  },
});

/** What an audit of a folder found, kept on the folder for the inbox. */
export const findingsSet = internalMutation({
  args: { space: v.string(), brain: v.string(), findings: v.any() },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || !inSpace(b, readSpace(a.space))) return;
    await ctx.db.patch(b._id, { findings: a.findings });
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
    const home = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", c.brain)).unique();
    if (isViewer(home, readSpace(a.space))) return { ok: false, why: "this brain is read only here" };
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
  if (!b || !inSpace(b, readSpace(space))) return null;
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
    const brains = (await ctx.db.query("brains").collect()).filter(b => inSpace(b, space));
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
  const cut = Date.now() - CHAT_DAYS * DAY_MS;
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
                          updated: c.updated, turns: c.turns.length, ...(c.concept ? { concept: c.concept } : {}) }));
  },
});

/** One chat whole, to reopen it. */
export const chatGet = internalQuery({
  args: { space: v.string(), id: v.string(), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await chatIn(ctx, readSpace(a.space), a.id, a.owner ?? "");
    return c ? { id: String(c._id), title: c.title, brain: c.brain, pinned: c.pinned, turns: c.turns, ...(c.concept ? { concept: c.concept } : {}) } : null;
  },
});

/**
 * A piece of an export, read back: the folders, sources and concepts this workspace is missing are added, and what it holds already is
 * kept as it is. A folder whose name another workspace holds is left out, with its concepts. A second personal folder is not made: its
 * notes join the one this workspace has. Returns what was added and kept, and the ids of the concepts added, for linking.
 */
export const restoreBatch = internalMutation({
  args: { space: v.string(), brains: v.optional(v.array(v.any())), sources: v.optional(v.array(v.any())), concepts: v.optional(v.array(v.any())) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const done = { brains: { added: 0, kept: 0, skipped: 0 }, sources: { added: 0, kept: 0 }, concepts: { added: 0, kept: 0, skipped: 0 }, ids: [] as string[] };
    const all = await ctx.db.query("brains").collect();
    const personal = all.find(b => b.type === "personal" && readSpace(b.space) === space);
    /* Where a folder of the file lands here: its own slug, the personal folder this workspace has, or nowhere. */
    const home = (slugIn: string, type?: string): string | null => {
      const b = all.find(x => x.slug === slugIn);
      if (b) return inSpace(b, space) && b.type !== "project" ? b.slug : null;
      if (type === "personal" && personal) return personal.slug;
      return null;
    };
    for (const r of a.brains ?? []) {
      const s0 = slug(String(r.slug ?? "")), type = ["subject", "person", "personal"].includes(r.type) ? r.type : "subject";
      if (!s0) continue;
      const b = all.find(x => x.slug === s0);
      if (b) { if (inSpace(b, space)) done.brains.kept++; else done.brains.skipped++; continue; }
      if (type === "personal" && personal) { done.brains.kept++; continue; }
      const row = { slug: s0, name: String(r.name ?? "").trim().slice(0, 80) || s0, type,
        scope: String(r.scope ?? "").trim().slice(0, 300) || "Restored from an export.", created: today(), visibility: "ask", space };
      await ctx.db.insert("brains", row); all.push(row as any); done.brains.added++;
    }
    for (const r of a.sources ?? []) {
      const sid = String(r.sid ?? "").trim();
      if (!sid) continue;
      if (await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", sid)).first()) { done.sources.kept++; continue; }
      const brains = (Array.isArray(r.brains) ? r.brains : []).map((x: any) => home(String(x))).filter((x: any): x is string => !!x);
      if (!brains.length) continue;
      const link = String(r.link ?? "");
      await ctx.db.insert("sources", { sid, link, linkKey: linkKey(link), title: String(r.title ?? "").slice(0, 300), author: String(r.author ?? "").slice(0, 200),
        date: String(r.date ?? ""), location: "", brains: [...new Set<string>(brains)], stored: today() });
      done.sources.added++;
    }
    for (const r of a.concepts ?? []) {
      const brain = home(String(r.brain ?? ""), r.type ?? all.find(x => x.slug === r.brain)?.type);
      const title = String(r.title ?? "").trim();
      if (!brain || !title) { done.concepts.skipped++; continue; }
      const cslug = conceptSlug(title);
      const had = await ctx.db.query("concepts").withIndex("by_brain_slug", q => q.eq("brain", brain).eq("slug", String(r.slug ?? cslug))).first()
        ?? await byTitle(ctx, "concepts", brain, title);
      if (had) { done.concepts.kept++; continue; }
      const last = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", brain)).order("desc").first();
      const list = (x: any) => Array.isArray(x) ? x : [];
      const id = await ctx.db.insert("concepts", {
        brain, slug: /^[a-z0-9-]+$/.test(String(r.slug ?? "")) ? String(r.slug) : cslug, n: (last?.n ?? 0) + 1, title: title.slice(0, 200),
        position: String(r.position ?? ""), summaryLine: String(r.summaryLine ?? ""),
        evidence: list(r.evidence).slice(0, 2000), data: list(r.data).map(String).slice(0, 200), conflicts: list(r.conflicts).slice(0, 50),
        sources: list(r.sources).map(String), related: list(r.related).map(String).slice(0, 12),
        ...(list(r.kinds).length ? { kinds: list(r.kinds).slice(0, 12) } : {}), ...(list(r.aliases).length ? { aliases: list(r.aliases).map(String).slice(0, 12) } : {}),
        updated: String(r.updated ?? "") || today(),
      });
      await syncCard(ctx, id);
      done.concepts.added++; done.ids.push(`${brain}/${(await ctx.db.get(id))!.slug}`);
    }
    return done;
  },
});

/** An answer given before to the same question, in the same place and the same way, or null. */
export const answerGet = internalQuery({
  args: { space: v.string(), key: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("answerCache").withIndex("by_space_key", q => q.eq("space", readSpace(a.space)).eq("key", a.key)).first();
    return row && row.at > Date.now() - CACHE_DAYS * DAY_MS ? row : null;
  },
});

/** Keeps an answer to give again, in place of an older one to the same question; answers past 14 days go, a few at each write. */
export const answerPut = internalMutation({
  args: { space: v.string(), key: v.string(), fp: v.string(), answer: v.string(), sources: v.number(), opened: v.array(v.string()), tagged: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now();
    const doc = { space, key: a.key, fp: a.fp, answer: a.answer.slice(0, 20000), sources: a.sources, opened: a.opened.slice(0, 12), ...(a.tagged?.length ? { tagged: a.tagged } : {}), at: now };
    const had = await ctx.db.query("answerCache").withIndex("by_space_key", q => q.eq("space", space).eq("key", a.key)).first();
    if (had) await ctx.db.replace(had._id, doc); else await ctx.db.insert("answerCache", doc);
    for (const old of await ctx.db.query("answerCache").withIndex("by_space_at", q => q.eq("space", space).lt("at", now - CACHE_DAYS * DAY_MS)).take(20)) await ctx.db.delete(old._id);
  },
});

/** A question and its answer, added to a chat. No chat, or one gone, starts a new one. */
export const chatTurn = internalMutation({
  args: { space: v.string(), id: v.optional(v.union(v.string(), v.null())), brain: v.string(), turn: v.any(), owner: v.optional(v.string()),
          /* A chat about one concept keeps its id, and is named after it. */
          concept: v.optional(v.string()), title: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now(), owner = a.owner ?? "";
    const had = await chatIn(ctx, space, a.id, owner);
    if (had) {
      await ctx.db.patch(had._id, { turns: [...had.turns, a.turn].slice(-CHAT_TURNS), brain: a.brain, updated: now,
        ...(a.concept ? { concept: a.concept } : {}) });
      return { id: String(had._id), created: false };
    }
    const q = String(a.title || a.turn?.q || a.turn?.title || "").replace(/\s+/g, " ").trim();
    const title = q.length > 80 ? q.slice(0, 77).replace(/\s+\S*$/, "") + "..." : q || "Untitled chat";
    const id = await ctx.db.insert("chats", { space, title, brain: a.brain, pinned: false, turns: [a.turn], created: now, updated: now,
      ...(owner ? { owner } : {}), ...(a.concept ? { concept: a.concept } : {}) });
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

/**
 * The workspaces made for someone on this deployment's key, for the landing to
 * list. A workspace a visitor made on their own key is never listed.
 */
export const hostedList = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("workspaces").collect())
    .filter(w => w.kind === "hosted").map(w => ({ slug: w.slug, name: w.name })),
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

/* ---------------- the models a workspace picked ---------------- */

const modelsRow = async (ctx: any, space: string) =>
  await ctx.db.query("models").withIndex("by_space", (q: any) => q.eq("space", space)).unique();

/** The model a workspace picked, or null for the default, and its languages. */
export const modelsOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const r = await modelsRow(ctx, readSpace(a.space));
    return { chat: r?.chat ?? null, reply: r?.reply === "en" ? "en" : "same", voice: VOICES.includes(r?.voice) ? r.voice : null,
      /* The favourites, only when there are some: the model running is the cheapest of them. */
      ...(r?.favs?.length ? { favs: r.favs as string[], favAt: (r.favAt ?? null) as number | null, favPrices: (r.favPrices ?? []) as { id: string; price: number }[] } : {}) };
  },
});

/* The languages the mic may listen in. */
export const VOICES = ["en-US", "fr-FR", "es-ES", "de-DE", "it-IT", "pt-PT"];

/** A new pick. null goes back to the default; absent leaves it. */
/**
 * A workspace's model, languages and favourites, written: only the fields given
 * change. A list of favourites is kept with when it was priced and what each one
 * cost; no list (null or empty) clears all three.
 */
export async function putModels(ctx: any, a: { space: string; chat?: string | null; reply?: string; voice?: string | null;
    favs?: string[] | null; favAt?: number; favPrices?: { id: string; price: number }[] }) {
  const space = readSpace(a.space), row = await modelsRow(ctx, space), at = Date.now();
  const next: any = { chat: row?.chat, reply: row?.reply, voice: row?.voice, favs: row?.favs, favAt: row?.favAt, favPrices: row?.favPrices };
  if (a.chat !== undefined) next.chat = a.chat ?? undefined;
  if (a.reply !== undefined) next.reply = a.reply === "en" ? "en" : "same";
  if (a.voice !== undefined) next.voice = VOICES.includes(a.voice as string) ? a.voice : undefined;
  if (a.favs !== undefined) next.favs = a.favs?.length ? a.favs : undefined;
  if (!next.favs) { next.favAt = undefined; next.favPrices = undefined; }
  else { if (a.favAt !== undefined) next.favAt = a.favAt; if (a.favPrices !== undefined) next.favPrices = a.favPrices; }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const cleared = { chat: undefined, project: undefined, voice: undefined, favs: undefined, favAt: undefined, favPrices: undefined };
  if (row) await ctx.db.patch(row._id, { ...cleared, ...next, updated: at });
  else await ctx.db.insert("models", { space, ...next, updated: at });
  return { chat: next.chat ?? null, reply: next.reply === "en" ? "en" : "same", voice: next.voice ?? null, favs: (next.favs ?? null) as string[] | null };
}

export const setModels = internalMutation({
  args: { space: v.string(), chat: v.optional(v.union(v.string(), v.null())),
          reply: v.optional(v.string()), voice: v.optional(v.union(v.string(), v.null())),
          /* null ends the daily choice among favourites: a model picked by hand stays. */
          favs: v.optional(v.union(v.array(v.string()), v.null())) },
  handler: async (ctx, a) => await putModels(ctx, a),
});

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

/* ---------- a personal brain's interview ---------- */

/** The interview row of one personal brain, or null before it first asks. */
export const interviewGet = internalQuery({
  args: { space: v.string(), brain: v.string() },
  handler: async (ctx, a) => await ctx.db.query("interviews")
    .withIndex("by_brain", q => q.eq("space", readSpace(a.space)).eq("brain", a.brain)).first(),
});

/** Changes to that row, which is made on its first write. */
export const interviewSet = internalMutation({
  args: { space: v.string(), brain: v.string(), patch: v.any() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || b.type !== "personal" || readSpace(b.space) !== space) throw new Error("that is not a personal brain of this workspace");
    const allowed = ["on", "marks", "pending", "sinceCheck", "sinceAsk", "opens", "test", "profile"];
    const patch: any = { updated: Date.now() };
    for (const k of allowed) if (k in (a.patch ?? {})) patch[k] = a.patch[k] ?? undefined;
    const had = await ctx.db.query("interviews").withIndex("by_brain", q => q.eq("space", space).eq("brain", a.brain)).first();
    /* A null clears a field on a patch; a new row simply leaves it out. */
    if (had) { await ctx.db.patch(had._id, patch); return { ...had, ...patch }; }
    const row: any = { space, brain: a.brain, on: false, marks: {}, sinceCheck: 0, sinceAsk: 0, ...patch };
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    await ctx.db.insert("interviews", row);
    return row;
  },
});

/* ---------- a personal brain's contacts ---------- */

/** A contact card of this workspace's personal brain, by its id, or null. */
async function ownContact(ctx: any, space: string, id: string) {
  const cut = String(id).indexOf("/");
  if (cut < 1) return null;
  const b = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", id.slice(0, cut))).unique();
  if (!b || b.type !== "personal" || readSpace(b.space) !== space) return null;
  const c = await ctx.db.query("concepts")
    .withIndex("by_brain_slug", (q: any) => q.eq("brain", id.slice(0, cut)).eq("slug", id.slice(cut + 1))).unique();
  return c?.tag === "contact" ? c : null;
}

const cleanNames = (list: any[], title: string) => [...new Set((Array.isArray(list) ? list : [])
  .map(x => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(x => x.length >= 2 && !sameTitle(x, title)))].slice(0, 12);

/**
 * A contact edited by hand: its name, the other names it goes by, its card
 * and its line. Its id stays, and so do the dated mentions behind it.
 */
export const contactEdit = internalMutation({
  args: { space: v.string(), id: v.string(), title: v.optional(v.string()), aliases: v.optional(v.array(v.string())),
          position: v.optional(v.string()), summaryLine: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const c = await ownContact(ctx, space, a.id);
    if (!c) throw new Error("that person is not in your personal folder");
    const title = a.title != null ? a.title.replace(/\s+/g, " ").trim().slice(0, 80) : c.title;
    if (title.length < 2) throw new Error("a name takes 2 characters at least");
    if (!sameTitle(title, c.title)) {
      const other = await byTitle(ctx, "concepts", c.brain, title);
      if (other && other._id !== c._id && sameTitle(other.title, title)) throw new Error(`"${other.title}" already has a card: merge the two instead`);
    }
    const patch: any = { title, updated: today() };
    /* The old name stays findable as another name. */
    const names = a.aliases != null ? a.aliases : (c.aliases ?? []);
    patch.aliases = cleanNames([...names, ...(sameTitle(title, c.title) ? [] : [c.title])], title);
    if (a.position != null) patch.position = a.position.trim().slice(0, 4000);
    if (a.summaryLine != null) patch.summaryLine = a.summaryLine.replace(/\s+/g, " ").trim().slice(0, 200);
    await ctx.db.patch(c._id, patch);
    await syncCard(ctx, c._id);
    return { id: a.id, title };
  },
});

/**
 * Two cards that are one person, folded into the one kept: every dated
 * mention and source joins it, the other's names become its other names, and
 * the two cards' text is kept side by side until it is written again as one.
 */
export const contactMerge = internalMutation({
  args: { space: v.string(), into: v.string(), from: v.array(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const kept = await ownContact(ctx, space, a.into);
    if (!kept) throw new Error("that person is not in your personal folder");
    const keep = await splitFile(ctx, kept);
    let joined = 0;
    for (const id of [...new Set<string>(a.from)].filter(x => x !== a.into).slice(0, 10)) {
      const gone0 = await ownContact(ctx, space, id);
      if (!gone0 || gone0.brain !== keep.brain) continue;
      const gone = await splitFile(ctx, gone0);
      /* Their moments follow them to the card kept; one told on both stays once. */
      const had = new Set((await momentRows(ctx, keep.brain, keep.slug)).map(momentKey));
      for (const r of await momentRows(ctx, gone.brain, gone.slug)) {
        if (had.has(momentKey(r))) await ctx.db.delete(r._id);
        else { await ctx.db.patch(r._id, { slug: keep.slug }); had.add(momentKey(r)); }
      }
      const now = await ctx.db.get(keep._id);
      await ctx.db.patch(keep._id, {
        aliases: cleanNames([...(now.aliases ?? []), gone.title, ...(gone.aliases ?? [])], now.title),
        position: [now.position, gone.position].map((t: any) => String(t ?? "").trim()).filter(Boolean).join("\n\n").slice(0, 4000),
        /* Both files join: every fact, link and open item kept; the moments moved above. */
        ...(now.file || gone.file ? { file: await withNewMoments(ctx, keep.brain, keep.slug, mergeFile(now.file, { ...(gone.file ?? {}), events: [] }, today(), [keep.title, ...(keep.aliases ?? [])]), [], today()) } : {}),
      });
      /* Their raw notes follow them to the card kept. */
      for (const r of await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", gone.brain).eq("slug", gone.slug)).collect())
        await ctx.db.patch(r._id, { slug: keep.slug });
      await joinConcept(ctx, await ctx.db.get(keep._id), gone);
      joined++;
    }
    return { into: a.into, joined };
  },
});

/**
 * A person's file written from one message: the summary and line replaced,
 * the mention kept, and what the message adds folded into the file, never
 * over it. Made when the person is new.
 */
export const fileContact = internalMutation({
  args: { brain: v.string(), title: v.string(), slug: v.optional(v.string()), doc: v.any(), add: v.any(), date: v.string() },
  handler: async (ctx, a) => {
    const d = a.doc ?? {};
    const known = a.slug ? await ctx.db.query("concepts")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", a.slug!)).unique() : null;
    const seen = known ?? await byTitle(ctx, "concepts", a.brain, a.title);
    const fields: any = { tag: "contact", updated: today() };
    if (d.position) fields.position = String(d.position).slice(0, 4000);
    if (d.summaryLine) fields.summaryLine = String(d.summaryLine).slice(0, 200);
    if (Array.isArray(d.aliases)) fields.aliases = d.aliases.map(String).slice(0, 12);
    if (seen) {
      const was = await splitFile(ctx, seen);
      await ctx.db.patch(seen._id, {
        ...fields,
        ...(d.evidence ? { evidence: mergeEvidence(d.evidence, was.evidence ?? []) } : {}),
        ...(d.sources ? { sources: unionCap(was.sources ?? [], d.sources, 1e9, String).slice(-2000) } : {}),
        file: await withNewMoments(ctx, was.brain, was.slug, mergeFile(was.file, { ...(a.add ?? {}), events: [] }, a.date, [was.title, ...(was.aliases ?? [])]), a.add?.events, a.date),
      });
      await syncCard(ctx, seen._id);
      return seen._id;
    }
    const newest = await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).order("desc").first();
    const slug = conceptSlug(a.title);
    const id = await ctx.db.insert("concepts", {
      brain: a.brain, slug, n: (newest?.n ?? 0) + 1, title: a.title,
      position: "", summaryLine: "", evidence: d.evidence ?? [], data: [], conflicts: [], sources: d.sources ?? [], related: [],
      ...fields, file: await withNewMoments(ctx, a.brain, slug, mergeFile(null, { ...(a.add ?? {}), events: [] }, a.date, [a.title]), a.add?.events, a.date),
    });
    await syncCard(ctx, id);
    return id;
  },
});

/**
 * A person's open lines that say the same thing, made one in their file: the
 * oldest line stays, with the newest wording. Returns how many were merged;
 * with `dry` nothing is written.
 */
export async function mergeOpenLines(ctx: any, c0: any, dry = false): Promise<number> {
  if (!c0?.file?.open?.length) return 0;
  const c = await splitFile(ctx, c0);
  if (!c.file?.open?.length) return 0;
  const r = dedupeOpen(c.file.open, [c.title, ...(c.aliases ?? [])]);
  if (r.merged && !dry) {
    await ctx.db.patch(c._id, { file: { ...c.file, open: r.open } });
    await syncCard(ctx, c._id);
  }
  return r.merged;
}

export const contactOpenMerge = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const c0 = await ownContact(ctx, readSpace(a.space), a.id);
    return { merged: c0 ? await mergeOpenLines(ctx, c0) : 0 };
  },
});

/** The open-line count of some people's cards, for the cards made before the count existed. */
export const setOpenCounts = internalMutation({
  args: { brain: v.string(), counts: v.array(v.object({ slug: v.string(), n: v.number() })) },
  handler: async (ctx, a) => {
    for (const x of a.counts.slice(0, 200)) {
      const c = await ctx.db.query("concepts").withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", x.slug)).unique();
      if (!c || c.tag !== "contact") continue;
      const card = await ctx.db.query("cards").withIndex("by_cid", q => q.eq("cid", c._id)).unique();
      if (card && card.open !== x.n) await ctx.db.patch(card._id, { open: x.n });
    }
  },
});

/** One line of a person's file taken out, or an open item marked done, open again, or reworded. */
export const contactPart = internalMutation({
  args: { space: v.string(), id: v.string(), part: v.string(), key: v.string(), done: v.optional(v.boolean()), text: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c0 = await ownContact(ctx, readSpace(a.space), a.id);
    if (!c0) throw new Error("that person is not in your personal folder");
    const c = await splitFile(ctx, c0);
    const parts: Record<string, string> = { fact: "facts", event: "events", link: "links", open: "open" };
    const list = parts[a.part];
    if (!list || !c.file) throw new Error("there is no such line in this file");
    let file = { ...c.file };
    if (a.part === "event") {
      /* A moment is a row of its own; the last day together follows the history left. */
      const rows = await momentRows(ctx, c.brain, c.slug);
      const row = rows.find((r: any) => r.k === a.key);
      if (!row) throw new Error("that line is already gone");
      await ctx.db.delete(row._id);
      file = await withNewMoments(ctx, c.brain, c.slug, file, [], today());
    } else {
      file = { ...file, [list]: [...(c.file[list] ?? [])] };
      const at = file[list].findIndex((x: any) => x.k === a.key);
      if (at < 0) throw new Error("that line is already gone");
      if (a.part === "open" && a.text != null) {
        /* The line says something new, and keeps its key and the day it was opened. */
        const t = a.text.replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 300);
        if (t.length < 3) throw new Error("that line needs a few words");
        file.open[at] = { ...file.open[at], t };
      }
      else if (a.part === "open" && a.done != null) {
        const { done: _was, ...rest } = file.open[at];
        file.open[at] = a.done ? { ...rest, done: today() } : rest;
      }
      else file[list].splice(at, 1);
    }
    await ctx.db.patch(c._id, { file, updated: today() });
    await syncCard(ctx, c._id);
    return { ok: true };
  },
});

/** The other people whose files link to this one, by any name it goes by. */
export const contactsLinking = internalQuery({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const c = await ownContact(ctx, readSpace(a.space), a.id);
    if (!c) return [];
    const names = [c.title, ...(c.aliases ?? [])];
    const out: any[] = [];
    for (const x of await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", c.brain)).collect()) {
      if (x._id === c._id || x.tag !== "contact") continue;
      const link = (x.file?.links ?? []).find((l: any) => names.some(n => sameTitle(String(l.n), n)));
      if (link) out.push({ id: `${x.brain}/${x.slug}`, title: x.title, rel: link.r ?? "" });
    }
    return out.slice(0, 60);
  },
});

/* ---------- a person's raw notes ---------- */

const RAW_MAX = 8000;

/** A contact of a personal brain by its slug, else by its title, else null. */
async function contactNamed(ctx: any, brain: string, title: string, slug?: string) {
  const c = slug ? await ctx.db.query("concepts").withIndex("by_brain_slug", (q: any) => q.eq("brain", brain).eq("slug", slug)).unique()
    : await byTitle(ctx, "concepts", brain, title);
  return c?.tag === "contact" ? c : null;
}

/**
 * What the owner said about a person, word for word and dated: one row a
 * message, in the language it was said. The same words on the same day are
 * kept once, so a filing tried twice adds nothing.
 */
export const rawAdd = internalMutation({
  args: { brain: v.string(), title: v.string(), slug: v.optional(v.string()), date: v.string(), kind: v.string(), text: v.string(),
          asked: v.optional(v.string()), at: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const text = a.text.trim().slice(0, RAW_MAX);
    if (text.length < 2) return false;
    const c = await contactNamed(ctx, a.brain, a.title, a.slug);
    if (!c) return false;
    const had = await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", c.brain).eq("slug", c.slug)).collect();
    if (had.some((r: any) => r.date === a.date && r.text === text)) return false;
    await ctx.db.insert("rawNotes", { brain: c.brain, slug: c.slug, date: a.date, kind: a.kind, text,
      ...(a.asked ? { asked: a.asked.trim().slice(0, 600) } : {}), at: a.at ?? Date.now() });
    return true;
  },
});

/** A person's raw notes, newest first, and how many there are. */
export const rawOf = internalQuery({
  args: { space: v.string(), id: v.string(), n: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const c = await ownContact(ctx, readSpace(a.space), a.id);
    if (!c) return { notes: [], total: 0 };
    const rows = await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", c.brain).eq("slug", c.slug)).order("desc").collect();
    return { notes: rows.slice(0, a.n ?? 300).map((r: any) => ({ date: r.date, kind: r.kind, text: r.text, ...(r.asked ? { asked: r.asked } : {}), at: r.at })),
             total: rows.length };
  },
});

/**
 * A person's raw notes gathered once from the chats still kept: every
 * message of the personal chat that filed something about them, as typed.
 */
export const rawFromChats = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const c = await ownContact(ctx, space, a.id);
    if (!c || c.rawScan) return 0;
    const names = [c.title, ...(c.aliases ?? [])];
    const had = await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", c.brain).eq("slug", c.slug)).collect();
    const seen = new Set(had.map((r: any) => `${r.date}|${r.text}`));
    let added = 0;
    for (const chat of await ctx.db.query("chats").withIndex("by_space_updated", (q: any) => q.eq("space", space)).collect()) {
      if (chat.brain !== c.brain || chat.owner) continue;
      let asked = "";
      for (const t of chat.turns ?? []) {
        const text = String(t?.q ?? "").trim().slice(0, RAW_MAX);
        const about = (t?.filed?.people ?? []).some((p: any) => names.some(n => sameTitle(String(p), n)));
        const date = new Date(Number(t?.at) || chat.created).toISOString().slice(0, 10);
        if (text.length >= 2 && about && !seen.has(`${date}|${text}`)) {
          seen.add(`${date}|${text}`);
          await ctx.db.insert("rawNotes", { brain: c.brain, slug: c.slug, date, kind: t.interview ? "interview" : "chat", text,
            ...(t.interview && asked ? { asked: asked.slice(0, 600) } : {}), at: Number(t?.at) || chat.created });
          added++;
        }
        /* An interview turn's reply ends on the next question. */
        asked = t?.interview ? String(t?.a ?? "").trim().split("\n").filter(Boolean).pop() ?? "" : "";
      }
    }
    await ctx.db.patch(c._id, { rawScan: today() });
    return added;
  },
});

/** One concept and the folder it sits in, inside one space. */
export const conceptHome = internalQuery({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const cut = a.id.indexOf("/");
    if (cut < 1) return null;
    const b = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", a.id.slice(0, cut))).unique();
    if (!b || !inSpace(b, readSpace(a.space))) return null;
    const c = await ctx.db.query("concepts").withIndex("by_brain_slug", (q: any) => q.eq("brain", b.slug).eq("slug", a.id.slice(cut + 1))).unique();
    return c ? { concept: c, brain: { slug: b.slug, name: b.name, type: b.type } } : null;
  },
});

/* ---------- error reports ---------- */

export const FEEDBACK_PER_HOUR = 5;
export const FEEDBACK_SPACE_PER_HOUR = 20;

/**
 * One error report counted, or refused past 5 an hour per sender and 20 an
 * hour per workspace, so a stuck screen or the demo cannot flood the inbox.
 * Reports past a week are cleared as this runs.
 */
export const feedbackLog = internalMutation({
  args: { space: v.string(), owner: v.optional(v.string()), error: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now(), owner = a.owner ?? "";
    const rows = await ctx.db.query("feedback").withIndex("by_space_at", (q: any) => q.eq("space", space)).collect();
    for (const r of rows) if (r.at < now - 7 * DAY_MS) await ctx.db.delete(r._id);
    const hour = rows.filter((r: any) => r.at >= now - 3600000);
    if (hour.length >= FEEDBACK_SPACE_PER_HOUR || hour.filter((r: any) => (r.owner ?? "") === owner).length >= FEEDBACK_PER_HOUR) return { ok: false };
    await ctx.db.insert("feedback", { space, ...(owner ? { owner } : {}), error: a.error.slice(0, 200), at: now });
    return { ok: true };
  },
});

/* ---------- a person's moments ---------- */

/* What a read of a person carries of their history: the newest 300 moments.
   The years before come a page at a time. */
const MOMENTS_READ = 300;
const asMoment = (r: any) => ({ k: r.k, d: r.d, t: r.t, ...(r.seen ? { seen: true } : {}), at: r.at });
const momentKey = (r: any) => `${r.d}|${String(r.t ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
const byDateDesc = (x: any, y: any) => String(y.d).localeCompare(String(x.d));

async function momentRows(ctx: any, brain: string, slug: string) {
  return await ctx.db.query("moments").withIndex("by_person", (q: any) => q.eq("brain", brain).eq("slug", slug)).collect();
}

/**
 * A file with the moments a message adds written as rows of their own, each
 * once: a moment told twice on the same day stays one. The file keeps its
 * count and the last day together, never the moments themselves, so a
 * person grows without a size limit.
 */
async function withNewMoments(ctx: any, brain: string, slug: string, file: any, events: any[] | undefined, date: string) {
  const { events: _none, ...f } = file ?? {};
  const rows = await momentRows(ctx, brain, slug);
  const have = new Set(rows.map(momentKey));
  const fresh = (mergeFile(null, { events: Array.isArray(events) ? events : [] }, date).events ?? []) as any[];
  const all = [...rows];
  for (const e of fresh) {
    if (have.has(momentKey(e))) continue;
    have.add(momentKey(e));
    await ctx.db.insert("moments", { brain, slug, k: e.k, d: e.d, t: e.t, ...(e.seen ? { seen: true } : {}), at: e.at });
    all.push(e);
  }
  const seen = all.filter((x: any) => x.seen).map((x: any) => String(x.d)).sort().pop() ?? "";
  return { ...f, seen, n: all.length };
}

/** A file written before moments had rows of their own, split once: its history moves to rows. */
async function splitFile(ctx: any, c: any) {
  if (!c?.file || !Array.isArray(c.file.events)) return c;
  const file = await withNewMoments(ctx, c.brain, c.slug, c.file, c.file.events, today());
  await ctx.db.patch(c._id, { file });
  return { ...c, file };
}

/** A person as the readers know it: the file with its newest moments in it. */
async function withMoments(ctx: any, c: any) {
  if (!c.file) return c;
  const rows = (await momentRows(ctx, c.brain, c.slug)).map(asMoment);
  const legacy = Array.isArray(c.file.events) ? c.file.events : [];
  const events = [...rows, ...legacy].sort(byDateDesc);
  return { ...c, file: { ...c.file, events: events.slice(0, MOMENTS_READ), n: events.length, ...(legacy.length ? { legacy: true } : {}) } };
}

/** Split once by hand: what opening an old person's file runs. */
export const splitContact = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const c = await ownContact(ctx, readSpace(a.space), a.id);
    if (c) await splitFile(ctx, c);
    return true;
  },
});

/** A person's pages: the years of their history and the months of their raw notes, each with its count. */
export const personPages = internalQuery({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const c = await ownContact(ctx, readSpace(a.space), a.id);
    if (!c) return { years: [], months: [] };
    const count = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
      .sort((x, y) => y[0].localeCompare(x[0]));
    const legacy = Array.isArray(c.file?.events) ? c.file.events : [];
    const years = count([...(await momentRows(ctx, c.brain, c.slug)), ...legacy].map((r: any) => String(r.d).slice(0, 4)));
    const raw = await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", c.brain).eq("slug", c.slug)).collect();
    const months = count(raw.map((r: any) => String(r.date).slice(0, 7)));
    return { years: years.map(([y, n]) => ({ y, n })), months: months.map(([m, n]) => ({ m, n })) };
  },
});

/** One page of a person: the moments of a year, or the raw notes of a month, newest first. */
export const personPage = internalQuery({
  args: { space: v.string(), id: v.string(), year: v.optional(v.string()), month: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await ownContact(ctx, readSpace(a.space), a.id);
    if (!c) return { moments: [], raw: [] };
    if (a.year) {
      const legacy = Array.isArray(c.file?.events) ? c.file.events : [];
      const rows = [...(await momentRows(ctx, c.brain, c.slug)).map(asMoment), ...legacy];
      return { moments: rows.filter((r: any) => String(r.d).startsWith(a.year!)).sort(byDateDesc), raw: [] };
    }
    const raw = await ctx.db.query("rawNotes").withIndex("by_contact", (q: any) => q.eq("brain", c.brain).eq("slug", c.slug)).collect();
    return { moments: [], raw: raw.filter((r: any) => String(r.date).startsWith(a.month ?? "")).sort((x: any, y: any) => y.at - x.at)
      .map((r: any) => ({ date: r.date, kind: r.kind, text: r.text, ...(r.asked ? { asked: r.asked } : {}), at: r.at })) };
  },
});

/* ---------- audits ---------- */

/** "a|b": one pair, the same whichever way round it is named. */
export const pairKey = (x: string, y: string) => [x, y].sort().join("|");

/**
 * An audit run on a folder: the day, and how many sources it held then, so
 * the app counts what was dropped since. Or pairs to keep apart, so the
 * next audit never asks about them again.
 */
export const auditMark = internalMutation({
  args: { space: v.string(), brain: v.string(), apart: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (!b || !inSpace(b, readSpace(a.space))) throw new Error("that folder is not in this workspace");
    if (a.apart) {
      const ids: string[] = [...new Set<string>(a.apart)].slice(0, 10), keys: string[] = [];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) keys.push(pairKey(ids[i], ids[j]));
      await ctx.db.patch(b._id, { apart: [...new Set([...(b.apart ?? []), ...keys])].slice(-2000) });
      return { apart: keys.length };
    }
    const sources = (await ctx.db.query("sources").collect()).filter(s => (s.brains ?? []).includes(b.slug)).length;
    const audit = { at: today(), sources };
    await ctx.db.patch(b._id, { audit });
    return { audit };
  },
});
