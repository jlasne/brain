/**
 * One-off jobs run from the CLI under your own deploy key, so nothing here is
 * reachable from a browser.
 *
 *     npx convex run admin:state --prod
 *     npx convex run admin:claim '{"account":"octopus"}' --prod
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
  args: { account: v.string(), all: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const acc = await ctx.db.query("accounts")
      .withIndex("by_slug", q => q.eq("slug", a.account)).unique();
    if (!acc) {
      const known = (await ctx.db.query("accounts").collect()).map(x => x.slug).join(", ");
      throw new Error(
        `no account "${a.account}". Sign in once to create it. ` +
        (known ? `Accounts that exist: ${known}` : "No accounts exist yet."));
    }

    const claimed: string[] = [], skipped: string[] = [];
    for (const b of await ctx.db.query("brains").collect()) {
      if (b.owner && b.owner !== a.account && !a.all) { skipped.push(`${b.slug} -> ${b.owner}`); continue; }
      if (b.owner === a.account) { skipped.push(`${b.slug} already`); continue; }
      await ctx.db.patch(b._id, { owner: a.account });
      claimed.push(b.slug);
    }
    return { owner: acc.name, account: a.account, claimed, skipped };
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
