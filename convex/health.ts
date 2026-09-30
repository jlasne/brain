/**
 * A brain's health, out of 10, from what it stores. No model call.
 *
 *   Variety    3  named authors behind it. A person brain is one voice by
 *                 design, so it counts its sources instead.
 *   Depth      3  share of its concepts backed by two sources or more.
 *   Freshness  2  days since its last source was stored.
 *   Conflicts  2  open conflicts, fewer is better.
 *
 * An unknown author counts for nothing: a source nobody signed widens no
 * view. Each score comes with the one move that raises it most, so the ring
 * says what to do as well as how the brain stands.
 */

import { knownAuthor } from "./drop";

const DAY = 86400000;

export type Part = { got: number; max: number; say: string };
export type Health = {
  slug: string;
  score: number;
  parts: { variety: Part; depth: Part; fresh: Part; conflicts: Part };
  best: string;
  open: number;
};

/* A signed source, and the name it is counted under: "Alex (Hormozi)" and
   "Alex, host" are one Alex. */
const named = (a: any) => knownAuthor(a) && !/^unnamed\b/i.test(String(a).trim());
const authorKey = (a: any) => String(a).split(/[(,;]/)[0].trim().toLowerCase();

/* Tiers: the points a count earns, and the count the next tier needs. */
const VARIETY = [[7, 3], [4, 2.5], [2, 1.5], [1, 0.5], [0, 0]] as const;
const SOURCES = [[10, 3], [5, 2.5], [2, 1.5], [1, 0.5], [0, 0]] as const;
const DEPTH = [[0.6, 3], [0.4, 2.5], [0.2, 1.5], [0, 0.5]] as const;
const tier = (tiers: readonly (readonly [number, number])[], x: number) => (tiers.find(([at]) => x >= at) ?? [0, 0])[1];
const nextTier = (tiers: readonly (readonly [number, number])[], x: number) => {
  const up = [...tiers].reverse().find(([at]) => at > x);
  return up ? { at: up[0], gain: up[1] - tier(tiers, x) } : null;
};

const freshness = (days: number | null) =>
  days == null ? 0 : days <= 14 ? 2 : days <= 60 ? 1.5 : days <= 180 ? 1 : days <= 365 ? 0.5 : 0;
const calm = (open: number) => open === 0 ? 2 : open <= 2 ? 1.5 : open <= 5 ? 1 : 0.5;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const pts = (x: number) => `+${Number.isInteger(x) ? x : x.toFixed(1)}`;

export function healthOf(brains: any[], cards: any[], sources: any[], open: Map<string, number>, now = Date.now()): Health[] {
  return brains.map((b: any) => {
    const person = b.type === "person";
    const own = sources.filter((s: any) => (s.brains ?? []).includes(b.slug));
    const cs = cards.filter((c: any) => c.brain === b.slug);
    const authors = new Set(own.filter((s: any) => named(s.author)).map((s: any) => authorKey(s.author)));
    const unsigned = own.filter((s: any) => !named(s.author)).length;
    const deep = cs.filter((c: any) => Number(c.src ?? 0) >= 2).length;
    const share = cs.length ? deep / cs.length : 0;
    const last = own.map((s: any) => String(s.stored || s.date || "")).filter(d => /^\d{4}-\d\d-\d\d/.test(d)).sort().pop();
    const days = last ? Math.max(0, Math.floor((now - Date.parse(last.slice(0, 10))) / DAY)) : null;
    const nOpen = open.get(b.slug) ?? 0;

    const variety: Part = person
      ? { got: tier(SOURCES, own.length), max: 3, say: `${plural(own.length, "source")} by this person` }
      : { got: tier(VARIETY, authors.size), max: 3,
          say: `${plural(authors.size, "named author")}${unsigned ? `, ${unsigned} unsigned` : ""}` };
    const depth: Part = { got: cs.length ? tier(DEPTH, share) : 0, max: 3,
      say: cs.length ? `${deep} of ${plural(cs.length, "concept")} rest on 2+ sources (${Math.round(share * 100)}%)` : "No concept yet" };
    const fresh: Part = { got: freshness(days), max: 2,
      say: days == null ? "No source yet" : days === 0 ? "Last source today" : `Last source ${plural(days, "day")} ago` };
    const conflicts: Part = { got: calm(nOpen), max: 2, say: nOpen ? plural(nOpen, "open conflict") : "No open conflict" };

    /* The move that earns the most, the quickest first when two tie. */
    const moves: [number, string][] = [];
    if (nOpen) moves.push([2 - conflicts.got, `Settle the ${plural(nOpen, "open conflict")}: ${pts(2 - conflicts.got)}`]);
    if (fresh.got < 2) moves.push([2 - fresh.got, `Add a source this week: ${pts(2 - fresh.got)}`]);
    if (person) {
      const up = nextTier(SOURCES, own.length);
      if (up) moves.push([up.gain, `${plural(up.at - own.length, "more source")} by ${b.name}: ${pts(up.gain)}`]);
    } else {
      const up = nextTier(VARIETY, authors.size);
      if (up) moves.push([up.gain, `${up.at - authors.size === 1 ? "A source by a new named author" : `Sources by ${up.at - authors.size} new named authors`}: ${pts(up.gain)}`]);
    }
    if (cs.length) {
      const up = nextTier(DEPTH, share);
      if (up) {
        const need = Math.max(1, Math.ceil(up.at * cs.length - 1e-9) - deep);
        moves.push([up.gain, `Back ${plural(need, "concept")} with a second source: ${pts(up.gain)}`]);
      }
    }
    moves.sort((x, y) => y[0] - x[0]);
    const score = variety.got + depth.got + fresh.got + conflicts.got;
    return { slug: b.slug, score, parts: { variety, depth, fresh, conflicts }, open: nOpen,
             best: moves[0]?.[1] ?? "Full marks. Keep feeding it." };
  });
}
