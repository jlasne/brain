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
