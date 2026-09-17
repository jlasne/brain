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
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { slug, today } from "./lib";

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

      const s2 = slug(c.title);
      const seen = await ctx.db.query("concepts")
        .withIndex("by_brain_slug", q => q.eq("brain", c.brain).eq("slug", s2)).unique();
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
          .find(x => slug(String(x?.title ?? "")) === s2);
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
        await ctx.db.insert("concepts",
          { brain: c.brain, slug: s2, n: count + 1, title: c.title, ...doc, updated: today() });
        await ctx.db.delete(c._id);
      }
      made.push({ brain: c.brain, title: c.title, sources: evidence.length });
    }

    return { dry: !!a.dry, waiting: rows.length, promoted: made.length, made, skipped };
  },
});
