/**
 * A brain's health, out of 10, measured against the best brain of its space.
 * No model call.
 *
 * Four parts, each read as a share of the brain that does best on it:
 *
 *   Variety    3  named authors behind it. A person brain skips it: many
 *                 videos from one channel is how a person brain is fed.
 *   Depth      3  share of its concepts backed by two sources or more.
 *   Freshness  2  how recent its last source is.
 *   Conflicts  2  open conflicts for its size, fewer is better.
 *
 * A person brain's three parts are scaled to 10, so both kinds compare. The
 * totals are then scaled so the best brain reads 10 and every other reads
 * against it. An unknown author counts for nothing. Each score comes with the
 * move that closes the widest gap to the best.
 */

import { knownAuthor } from "./drop";

const DAY = 86400000;
const WEIGHT = { variety: 3, depth: 3, fresh: 2, conflicts: 2 } as const;
type Key = keyof typeof WEIGHT;
const KEYS: Key[] = ["variety", "depth", "fresh", "conflicts"];

export type Part = {
  /* Counted for this brain: variety is not, for a person. */
  counted: boolean;
  /* This brain against the best on this part, 0 to 100. */
  pct: number;
  say: string;
};
export type Health = {
  slug: string;
  score: number;
  top: boolean;
  person: boolean;
  parts: Record<Key, Part>;
  best: string;
  open: number;
};

/* A signed source, and the name it is counted under: "Alex (Hormozi)" and
   "Alex, host" are one Alex. */
const named = (a: any) => knownAuthor(a) && !/^unnamed\b/i.test(String(a).trim());
const authorKey = (a: any) => String(a).split(/[(,;]/)[0].trim().toLowerCase();
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ago = (d: number) => d === 0 ? "today" : `${plural(d, "day")} ago`;

export function healthOf(brains: any[], cards: any[], sources: any[], open: Map<string, number>, now = Date.now()): Health[] {
  /* What each brain holds, and how good each part is, higher better. */
  const m = brains.map((b: any) => {
    const own = sources.filter((s: any) => (s.brains ?? []).includes(b.slug));
    const cs = cards.filter((c: any) => c.brain === b.slug);
    const authors = new Set(own.filter((s: any) => named(s.author)).map((s: any) => authorKey(s.author))).size;
    const deep = cs.filter((c: any) => Number(c.src ?? 0) >= 2).length;
    const share = cs.length ? deep / cs.length : 0;
    const last = own.map((s: any) => String(s.stored || s.date || "")).filter(d => /^\d{4}-\d\d-\d\d/.test(d)).sort().pop();
    const days = last ? Math.max(0, Math.floor((now - Date.parse(last.slice(0, 10))) / DAY)) : null;
    const nOpen = open.get(b.slug) ?? 0;
    const person = b.type === "person";
    return {
      b, person, authors, share, days, nOpen, concepts: cs.length, unsigned: own.length - own.filter((s: any) => named(s.author)).length,
      g: {
        variety: person ? 0 : authors,
        depth: share,
        /* Two weeks old reads half as fresh as today. */
        fresh: days == null ? 0 : 1 / (1 + days / 14),
        /* One open conflict per ten concepts reads half as calm as none. */
        conflicts: cs.length ? 1 / (1 + 10 * nOpen / cs.length) : 0,
      } as Record<Key, number>,
    };
  });

  /* The best on each part. Variety is measured among subjects only. */
  const lead = {} as Record<Key, { g: number; x: (typeof m)[number] | null }>;
  for (const k of KEYS) {
    const pool = k === "variety" ? m.filter(x => !x.person) : m;
    const top = pool.reduce<(typeof m)[number] | null>((a, x) => !a || x.g[k] > a.g[k] ? x : a, null);
    lead[k] = { g: top?.g[k] ?? 0, x: top };
  }
  const ratio = (x: (typeof m)[number], k: Key) => lead[k].g > 0 ? Math.min(1, x.g[k] / lead[k].g) : 0;

  const raw = m.map(x => {
    const keys = KEYS.filter(k => !(x.person && k === "variety"));
    const max = keys.reduce((t, k) => t + WEIGHT[k], 0);
    return keys.reduce((t, k) => t + WEIGHT[k] * ratio(x, k), 0) * 10 / max;
  });
  const topRaw = Math.max(0, ...raw);

  return m.map((x, i) => {
    const score = topRaw > 0 ? Math.round(raw[i] / topRaw * 100) / 10 : 0;
    const bestOf = (k: Key) => lead[k].x && lead[k].x !== x ? lead[k].x : null;
    const leadName = (k: Key) => bestOf(k)?.b.name;
    const pct = (k: Key) => Math.round(ratio(x, k) * 100);

    const parts: Record<Key, Part> = {
      variety: x.person
        ? { counted: false, pct: 100, say: "Not counted: a person brain is one voice, fed from the same channels." }
        : { counted: true, pct: pct("variety"),
            say: `${plural(x.authors, "named author")}${x.unsigned ? `, ${x.unsigned} unsigned` : ""}` +
                 (bestOf("variety") ? `. Best: ${leadName("variety")}, ${lead.variety.x!.authors}` : x.authors ? ". The most of any brain" : "") },
      depth: { counted: true, pct: pct("depth"),
        say: (x.concepts ? `${Math.round(x.share * 100)}% of ${plural(x.concepts, "concept")} rest on 2+ sources` : "No concept yet") +
             (bestOf("depth") ? `. Best: ${leadName("depth")}, ${Math.round(lead.depth.x!.share * 100)}%` : "") },
      fresh: { counted: true, pct: pct("fresh"),
        say: (x.days == null ? "No source yet" : `Last source ${ago(x.days)}`) +
             (bestOf("fresh") && lead.fresh.x!.days != null ? `. Best: ${leadName("fresh")}, ${ago(lead.fresh.x!.days!)}` : "") },
      conflicts: { counted: true, pct: pct("conflicts"),
        say: (x.nOpen ? `${plural(x.nOpen, "open conflict")} in ${plural(x.concepts, "concept")}` : x.concepts ? "No open conflict" : "No concept yet") +
             (x.nOpen && bestOf("conflicts") ? `. Best: ${leadName("conflicts")}, ${lead.conflicts.x!.nOpen || "none"} open` : "") },
    };

    /* The move that closes the widest gap to the best. */
    const gaps = KEYS.filter(k => parts[k].counted).map(k => [WEIGHT[k] * (1 - ratio(x, k)), k] as [number, Key])
      .filter(([g, k]) => g > 0.05 && lead[k].g > 0).sort((p, q) => q[0] - p[0]);
    const say: Record<Key, () => string> = {
      variety: () => `Add sources by new named authors: ${x.authors} here, ${lead.variety.x!.authors} in ${leadName("variety")}.`,
      depth: () => `Back more concepts with a second source: ${Math.round(x.share * 100)}% here, ${Math.round(lead.depth.x!.share * 100)}% in ${leadName("depth")}.`,
      fresh: () => x.days == null ? "Add a first source." : `Add a source: the last one is ${plural(x.days, "day")} old, ${lead.fresh.x!.days} in ${leadName("fresh")}.`,
      conflicts: () => `Settle the ${plural(x.nOpen, "open conflict")}.`,
    };
    const first = gaps.find(([, k]) => k !== "conflicts" ? bestOf(k) : x.nOpen);
    return {
      slug: x.b.slug, score, top: topRaw > 0 && raw[i] === topRaw, person: x.person, parts, open: x.nOpen,
      best: x.days == null ? "Add a first source."
        : first ? say[first[1]]() : score === 10 ? "The best brain: every other score is measured against it." : "Keep feeding it.",
    };
  });
}
