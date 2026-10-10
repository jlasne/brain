/**
 * The weekly digest: what every space learned in the last 7 days, in one mail.
 *
 * It calls no model. It reads each space's cards, which are light, and opens
 * whole only the concepts written since the cutoff: that tells a new concept
 * from one fed again, counts the evidence this week's sources added, and finds
 * the open conflicts. A week with nothing new sends nothing.
 *
 * The address is DIGEST_TO in this deployment's environment, never in the
 * code, because the repository is public. crons.ts runs it every Monday.
 *
 *     npx convex run digest:send --prod                  sends it now
 *     npx convex run digest:send '{"dry":true}' --prod   shows it, sends nothing
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { SPACES, spaceName, HOME, readSpace, DAY_MS } from "./lib";
import type { Space } from "./lib";
import { loadSpace } from "./space";
import { mail, asText, looksLikeMail } from "./onepager";
import type { Pager, Bullet } from "./onepager";

/* Lines per list before the rest is counted. */
export const LIST_MAX = 12;
/* Concepts opened whole per space. Past this, a fed concept is counted only. */
const OPEN_MAX = 300;

export type SpaceWeek = {
  space: Space;
  brains: any[];
  /* Concepts first written this week, whole. */
  fresh: any[];
  /* Older concepts fed this week, whole. */
  fed: any[];
  /* Fed concepts past the read cap, counted only. */
  more: number;
  /* Sources stored this week. */
  sources: any[];
};

const cut = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "..." : t;
};
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The mail, from each space's week. Null when no space has anything new. */
export function digestPage(weeks: SpaceWeek[], since: string, today: string): Pager | null {
  const sections: Pager["sections"] = [];
  let nNew = 0, nFed = 0, nConf = 0, nSrc = 0;

  for (const w of weeks) {
    const name = spaceName(w.space);
    const brainName = (slug: string) => w.brains.find((b: any) => b.slug === slug)?.name ?? slug;
    const fromWeek = new Set(w.sources.map((s: any) => s.sid));
    const list = <T>(items: T[], line: (x: T) => Bullet, extra = 0): Bullet[] => {
      const out = items.slice(0, LIST_MAX).map(line);
      const left = items.length - LIST_MAX + extra;
      if (left > 0) out.push({ k: "", say: `And ${left} more.` });
      return out;
    };
    const byBrain = (x: any, y: any) => brainName(x.brain).localeCompare(brainName(y.brain)) || String(x.title).localeCompare(String(y.title));
    const added = (c: any) => (c.evidence ?? []).filter((e: any) => fromWeek.has(e.source)).length;
    const conflicts = [...w.fresh, ...w.fed].flatMap((c: any) => (c.conflicts ?? []).map((x: any) => ({ c, x })));

    if (w.sources.length) sections.push({
      head: `${name}: ${plural(w.sources.length, "source")} read`,
      bullets: list(w.sources, (s: any) => ({ k: cut(s.title || s.sid, 120),
        say: [s.author, s.date, (s.brains ?? []).map(brainName).join(", ")].filter(Boolean).join(" · ") })),
    });
    if (w.fresh.length) sections.push({
      head: `${name}: ${plural(w.fresh.length, "new concept")}`,
      bullets: list([...w.fresh].sort(byBrain), (c: any) => ({ k: `${c.title} (${brainName(c.brain)})`,
        say: cut(c.summaryLine || c.position, 180) })),
    });
    if (w.fed.length + w.more) sections.push({
      head: `${name}: ${plural(w.fed.length + w.more, "concept")} fed again`,
      bullets: list([...w.fed].sort((x, y) => added(y) - added(x)), (c: any) => {
        const n = added(c);
        return { k: `${c.title} (${brainName(c.brain)})`,
                 say: (n ? `+${plural(n, "piece")} of evidence. ` : "") + cut(c.summaryLine || c.position, 150) };
      }, w.more),
    });
    if (conflicts.length) sections.push({
      head: `${name}: ${plural(conflicts.length, "open conflict")}`,
      bullets: list(conflicts, ({ c, x }) => ({ k: `${c.title} (${brainName(c.brain)})`,
        say: cut(`${x.a ?? ""} (${x.aDate ?? "?"}) against ${x.b ?? ""} (${x.bDate ?? "?"})${x.why ? `. ${x.why}` : ""}`, 220) })),
    });

    nNew += w.fresh.length; nFed += w.fed.length + w.more; nConf += conflicts.length; nSrc += w.sources.length;
  }
  if (!sections.length) return null;

  return {
    title: `Your week: ${plural(nNew, "new concept")}, ${nFed} fed again`,
    line: `${since} to ${today} · ${plural(nSrc, "source")} read · ${plural(nConf, "open conflict")}`,
    sections,
    foot: `Across ${weeks.map(w => spaceName(w.space)).join(" and ")}. Sent every Monday.`,
  };
}

/** Build the week across every space, then mail it to DIGEST_TO. */
export const send = internalAction({
  args: { days: v.optional(v.number()), dry: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<any> => {
    const days = Math.max(1, Math.min(31, Math.round(a.days ?? 7)));
    const now = Date.now(), sinceMs = now - days * DAY_MS;
    const since = new Date(sinceMs).toISOString().slice(0, 10);
    const today = new Date(now).toISOString().slice(0, 10);

    const weeks: SpaceWeek[] = [];
    for (const space of SPACES) {
      /* A shared brain is told once, under the workspace it lives in. */
      const seen = await loadSpace(ctx, space);
      const home = new Set(seen.brains.filter((b: any) => readSpace(b.space) === space).map((b: any) => b.slug));
      const brains = seen.brains.filter((b: any) => home.has(b.slug));
      const cards = seen.cards.filter((c: any) => home.has(c.brain));
      const sources = seen.sources.map((s: any) => ({ ...s, brains: (s.brains ?? []).filter((x: string) => home.has(x)) }))
        .filter((s: any) => s.brains.length);
      const touched = cards.filter((c: any) => String(c.updated ?? "") >= since)
        .sort((x: any, y: any) => String(y.updated).localeCompare(String(x.updated)));
      const open = touched.slice(0, OPEN_MAX);
      const whole: any[] = [];
      for (let i = 0; i < open.length; i += 100) {
        whole.push(...await ctx.runQuery(internal.store.conceptsByIds,
          { space, ids: open.slice(i, i + 100).map((c: any) => `${c.brain}/${c.slug}`) }));
      }
      weeks.push({
        space, brains,
        fresh: whole.filter(c => c._creationTime >= sinceMs),
        fed: whole.filter(c => c._creationTime < sinceMs),
        more: touched.length - open.length,
        sources: sources.filter((s: any) => String(s.stored ?? "") >= since),
      });
    }

    const page = digestPage(weeks, since, today);
    if (!page) return { sent: false, why: `nothing new since ${since}` };
    if (a.dry) return { sent: false, dry: true, text: asText(page) };
    const to = String(process.env.DIGEST_TO ?? "").trim();
    if (!looksLikeMail(to)) {
      return { sent: false, why: "no address: run npx convex env set DIGEST_TO you@example.com --prod" };
    }
    const r = await mail(to, page, HOME);
    return { sent: true, id: r.id };
  },
});
