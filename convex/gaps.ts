/**
 * Blind spots: what the brains cannot answer yet, and the kind of source that
 * would fill each one.
 *
 * Two signals. Questions: an answer that finds the stored knowledge short ends
 * with a GAP line, which is cut off before the answer is shown and kept. Data:
 * a brain fed by few sources, by one voice or by old ones, and concepts that
 * rest on a single source. Both are read from what is stored, so listing them
 * calls no model. One call then writes each spot precisely.
 *
 * A blind spot says what to look for and never names a source: no title, no
 * author, no channel, no link. Finding it is the owner's job, so what goes in
 * is chosen by the owner, not suggested by the model.
 */

import { ask, parseJson } from "./lib";

/* A question logged as a gap is kept this long. */
export const GAP_DAYS = 90;
/* A subject brain with fewer sources than this is a thin brain. */
const FEW = 5;
/* One author behind this share of a subject brain's sources is one voice. */
const ONE_VOICE = 0.6;
/* A brain whose newest source is older than this is stale. */
const OLD_DAYS = 365;
const DAY = 86400000;

/** The line an answer adds when the stored knowledge falls short. */
export const GAP_RULE =
`- When the stored knowledge answers only part of the question, or none of it, add one last line after everything else:
  GAP: {the precise part it does not cover, under 20 words} | FIND: {the kind of source that would cover it: its angle, the type of author and the format, under 25 words}
  The FIND part describes a source. It never names a title, a person, a channel, a website or a link.
  When the stored knowledge answers all of it, write no GAP line.`;

/** The answer without its GAP line, and what that line said. */
export function splitGap(text: string): { answer: string; gap: string; find: string } {
  const t = String(text ?? "");
  const m = t.match(/^[ \t]*\**GAP\**:\**[ \t]*(.+?)[ \t]*(?:\|[ \t]*\**FIND\**:\**[ \t]*(.+?))?[ \t]*$/im);
  if (!m) return { answer: t.trim(), gap: "", find: "" };
  const answer = (t.slice(0, m.index) + t.slice((m.index ?? 0) + m[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  return { answer, gap: clean(m[1], 200), find: noLinks(clean(m[2] ?? "", 260)) };
}

const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").replace(/—/g, ",").trim().slice(0, n);
/* A link that slipped through is cut: a blind spot describes, it never hands over. */
const noLinks = (s: string) => s.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s{2,}/g, " ").trim();

export type Spot = {
  id: string;
  /* "asked": a question fell short. The others come from what is stored. */
  kind: "asked" | "few" | "one-voice" | "old" | "one-source";
  brain: string;
  gap: string;
  find: string;
  /* The data behind it, in one line. */
  why: string;
  /* The logged questions behind an "asked" spot, so it can be cleared. */
  gapIds?: string[];
  questions?: string[];
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Every blind spot, most useful first: the questions that fell short, newest
 * first, then the thinnest brains.
 */
export function spotsFrom(brains: any[], cards: any[], sources: any[], gaps: any[], now = Date.now()): Spot[] {
  const name = (slug: string) => brains.find((b: any) => b.slug === slug)?.name ?? slug;

  /* Questions: one spot per gap, newest first, the same gap asked twice
     counted twice. */
  const asked = new Map<string, Spot>();
  for (const g of [...gaps].sort((x: any, y: any) => (y.at ?? 0) - (x.at ?? 0))) {
    if (now - Number(g.at ?? 0) > GAP_DAYS * DAY) continue;
    const key = String(g.gap || g.q).toLowerCase().replace(/\W+/g, " ").trim();
    const had = asked.get(key);
    if (had) {
      had.gapIds!.push(String(g._id));
      if (!had.questions!.includes(g.q)) had.questions!.push(g.q);
      if (!had.find && g.find) had.find = g.find;
      continue;
    }
    asked.set(key, {
      id: "q-" + String(g._id), kind: "asked", brain: (g.brains ?? [])[0] ?? "",
      gap: g.gap || `Nothing stored answers: ${g.q}`,
      find: g.find || "",
      why: new Date(Number(g.at)).toISOString().slice(0, 10),
      gapIds: [String(g._id)], questions: [String(g.q)],
    });
  }
  for (const s of asked.values()) {
    const n = s.gapIds!.length;
    s.why = n === 1 ? `Asked once, on ${s.why}` : `Asked ${n} times, last on ${s.why}`;
    s.find ||= "A source that answers this question with dated facts and numbers.";
  }

  /* Data: one spot per thin subject brain, its strongest reason first. A
     person brain is one voice by design, so only its size counts. */
  const thin: (Spot & { rank: number })[] = [];
  for (const b of brains) {
    const own = sources.filter((s: any) => (s.brains ?? []).includes(b.slug));
    const cs = cards.filter((c: any) => c.brain === b.slug);
    if (!cs.length && !own.length) continue;
    const scope = String(b.scope || b.name);
    const person = b.type === "person";
    const n = own.length;
    const why: string[] = [`${plural(cs.length, "concept")} from ${plural(n, "source")}`];
    let kind: Spot["kind"] | "" = "", gap = "", find = "", rank = 0;

    const byAuthor = new Map<string, number>();
    for (const s of own) { const a = String(s.author || "").trim(); if (a) byAuthor.set(a, (byAuthor.get(a) ?? 0) + 1); }
    const [top, topN] = [...byAuthor].sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    const newest = own.map((s: any) => String(s.date || "")).filter(d => /^\d{4}-\d\d/.test(d)).sort().pop() ?? "";
    const single = cs.filter((c: any) => Number(c.src ?? 0) <= 1).length;

    if (n < FEW) {
      kind = "few"; rank = 100 - n * 10 + Math.min(cs.length, 40) / 4;
      gap = `${b.name} rests on ${plural(n, "source")} for ${plural(cs.length, "concept")}.`;
      find = person ? `Another long interview or talk by ${b.name}, on a subject the brain holds little on.`
                    : `A second source on ${scope}, by a different author, with numbers.`;
    }
    if (!person && n >= 2 && topN / n >= ONE_VOICE) {
      why.push(`${topN} of ${n} from ${top}`);
      if (!kind) {
        kind = "one-voice"; rank = 60 + (topN / n) * 20;
        gap = `${Math.round((topN / n) * 100)}% of ${b.name} comes from one voice, ${top}.`;
        find = `A source on ${scope} by a different author, ideally one who disagrees.`;
      }
    }
    if (newest && now - Date.parse(newest) > OLD_DAYS * DAY) {
      why.push(`newest source ${newest.slice(0, 7)}`);
      if (!kind) {
        kind = "old"; rank = 40;
        gap = `${b.name}'s newest source dates from ${newest.slice(0, 7)}.`;
        find = `A source on ${scope} from the last 12 months.`;
      }
    }
    if (!person && cs.length >= 6 && single / cs.length >= 0.5) {
      why.push(`${single} of ${cs.length} concepts on one source`);
      if (!kind) {
        kind = "one-source"; rank = 30 + (single / cs.length) * 10;
        gap = `${single} of ${b.name}'s ${cs.length} concepts rest on a single source.`;
        find = `A source that tests the main claims of ${b.name} with its own data.`;
      }
    }
    if (kind) thin.push({ id: "b-" + b.slug, kind, brain: b.slug, gap, find, why: why.join(", "), rank });
  }
  thin.sort((x, y) => y.rank - x.rank);

  return [...asked.values(), ...thin.map(({ rank, ...s }) => ({ ...s, why: `${name(s.brain)}: ${s.why}` }))];
}

const ADVICE = `Below are the blind spots of a personal knowledge base: questions it could not answer, and brains that rest on too little.

For each one, write:
- "gap": the precise piece of knowledge that is missing, in one sentence under 25 words. Name the sub-topic, keep the number from the data line.
- "find": the kind of source to look for, under 35 words: its angle, the type of author, the format, and the one question it must answer.

RULES
- Describe the source to find. Never name a title, a person, a channel, a publication, a website or a link. Finding it is the reader's job.
- Use the concept titles to say which sub-topic is thin, when they show it.
- English. No em-dashes. Under 30 words per sentence. Numbers over adjectives. Plain words.

Reply with only JSON, one entry per spot, same ids: {"spots":[{"id":"","gap":"","find":""}]}`;

/**
 * Each spot rewritten precisely, in one call. A call that fails keeps the
 * spots as they were, so the list never waits on the model.
 */
export async function adviseSpots(spots: Spot[], brains: any[], cards: any[],
  opts: { key?: string; model?: string; timeout?: number } = {}): Promise<{ spots: Spot[]; advised: boolean }> {
  if (!spots.length) return { spots, advised: true };
  const some = spots.slice(0, 12);
  const lines = some.map(s => {
    const b = brains.find((x: any) => x.slug === s.brain);
    const titles = cards.filter((c: any) => c.brain === s.brain)
      .sort((x: any, y: any) => Number(x.src ?? 0) - Number(y.src ?? 0)).slice(0, 12).map((c: any) => c.title);
    return [`ID: ${s.id}`,
      b ? `BRAIN: ${b.name} (${b.type === "person" ? "a person" : "a subject"}): ${b.scope}` : "",
      `DATA: ${s.why}`,
      s.questions?.length ? `ASKED: ${s.questions.slice(0, 3).map(q => `"${q.slice(0, 200)}"`).join("; ")}` : "",
      `DRAFT: ${s.gap} Look for: ${s.find}`,
      titles.length ? `THINNEST CONCEPTS: ${titles.join("; ")}` : ""].filter(Boolean).join("\n");
  }).join("\n\n");
  try {
    const { text } = await ask([
      { role: "system", content: "You find the gaps in a knowledge base. You reply with JSON only." },
      { role: "user", content: `${ADVICE}\n\n${lines}` },
    ], { json: true, maxTokens: 2500, key: opts.key, model: opts.model, timeout: opts.timeout ?? 90000 });
    const got = parseJson(text)?.spots;
    if (!Array.isArray(got)) return { spots, advised: false };
    const by = new Map(got.map((x: any) => [String(x?.id ?? ""), x]));
    return {
      advised: true,
      spots: spots.map(s => {
        const x: any = by.get(s.id);
        const gap = clean(x?.gap, 240), find = noLinks(clean(x?.find, 300));
        return x ? { ...s, gap: gap || s.gap, find: find || s.find } : s;
      }),
    };
  } catch {
    return { spots, advised: false };
  }
}
