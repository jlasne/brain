/**
 * Import a brain built outside the app.
 *
 * Work done in a Claude Code session lands in `brains/` as markdown. This
 * carries it into the store so both sides hold the same brain. It runs from
 * the CLI under your own deploy key, so it never touches the HTTP gate:
 *
 *     npx convex run seed:load --prod
 *
 * It refuses any brain that already exists, so running it twice changes
 * nothing. Nothing here is reachable from a browser.
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import payload from "./seedData.json";

type Payload = typeof payload;

export const load = internalMutation({
  args: {},
  handler: async (ctx) => {
    const p = payload as unknown as Payload & Record<string, any[]>;
    const report = { brains: 0, concepts: 0, sources: 0, notes: 0, candidates: 0, skipped: [] as string[] };

    for (const b of p.brains) {
      const seen = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", b.slug)).unique();
      if (seen) { report.skipped.push(`brain ${b.slug} exists`); continue; }
      await ctx.db.insert("brains", b as any);
      report.brains++;
    }

    for (const c of p.concepts) {
      const seen = await ctx.db.query("concepts")
        .withIndex("by_brain_slug", q => q.eq("brain", c.brain).eq("slug", c.slug)).unique();
      if (seen) { report.skipped.push(`concept ${c.brain}/${c.slug} exists`); continue; }
      await ctx.db.insert("concepts", c as any);
      report.concepts++;
    }

    for (const s of p.sources) {
      const seen = await ctx.db.query("sources").withIndex("by_sid", q => q.eq("sid", s.sid)).unique();
      if (seen) { report.skipped.push(`source ${s.sid} exists`); continue; }
      await ctx.db.insert("sources", s as any);
      report.sources++;
    }

    for (const n of p.notes) {
      const seen = await ctx.db.query("notes").withIndex("by_sid", q => q.eq("sid", n.sid)).unique();
      if (seen) { report.skipped.push(`note ${n.sid} exists`); continue; }
      await ctx.db.insert("notes", n as any);
      report.notes++;
    }

    for (const c of p.candidates) {
      const seen = await ctx.db.query("candidates")
        .withIndex("by_brain_slug", q => q.eq("brain", c.brain).eq("slug", c.slug)).unique();
      if (seen) continue;
      await ctx.db.insert("candidates", c as any);
      report.candidates++;
    }

    return report;
  },
});

/** Undo a load, by brain slug. Same CLI-only reach. */
export const unload = internalMutation({
  args: { brain: v.string() },
  handler: async (ctx, a) => {
    let n = 0;
    const b = await ctx.db.query("brains").withIndex("by_slug", q => q.eq("slug", a.brain)).unique();
    if (b) { await ctx.db.delete(b._id); n++; }
    for (const c of await ctx.db.query("concepts").withIndex("by_brain", q => q.eq("brain", a.brain)).collect()) {
      await ctx.db.delete(c._id); n++;
    }
    return { deleted: n };
  },
});
