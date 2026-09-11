/** Internal reads and writes. HTTP actions reach the database only through these. */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { sha256, randomHex, today, slug, SESSION_MS, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS } from "./lib";

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
  args: {},
  handler: async (ctx) => {
    const token = randomHex(24);
    await ctx.db.insert("sessions", { token, expires: Date.now() + SESSION_MS });
    return token;
  },
});

export const checkSession = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const s = await ctx.db.query("sessions").withIndex("by_token", q => q.eq("token", a.token)).unique();
    return !!s && s.expires > Date.now();
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
  args: { name: v.string(), type: v.string(), scope: v.string() },
  handler: async (ctx, a) => {
    const s = slug(a.name);
    const seen = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", s)).unique();
    if (seen) throw new Error("a brain with that name exists");
    await ctx.db.insert("brains", { slug: s, name: a.name, type: a.type, scope: a.scope, created: today() });
    return s;
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

export const writeSource = internalMutation({
  args: { doc: v.any() },
  handler: async (ctx, a) => { await ctx.db.insert("sources", { ...a.doc, stored: today() }); },
});

export const writeNote = internalMutation({
  args: { doc: v.any() },
  handler: async (ctx, a) => { await ctx.db.insert("notes", { ...a.doc, written: today() }); },
});

/** R5.5 seeding and the 3 mention rule both live here. */
export const bumpCandidate = internalMutation({
  args: { brain: v.string(), title: v.string(), sid: v.string() },
  handler: async (ctx, a) => {
    const s = slug(a.title);
    const row = await ctx.db.query("candidates")
      .withIndex("by_brain_slug", q => q.eq("brain", a.brain).eq("slug", s)).unique();
    const notes = Array.from(new Set([...(row?.notes ?? []), a.sid]));
    if (notes.length >= 3) {
      if (row) await ctx.db.delete(row._id);
      return { promoted: true, notes };
    }
    if (row) await ctx.db.patch(row._id, { notes, count: notes.length, updated: today() });
    else await ctx.db.insert("candidates", { brain: a.brain, slug: s, title: a.title, notes, count: notes.length, updated: today() });
    return { promoted: false, notes };
  },
});
