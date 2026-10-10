/**
 * Finding things in a project's other files, with no model: the words of a
 * question against the words a section is known by, and the sections nearest
 * in meaning. Pure functions: the server reads the cards and the vectors, and
 * asks these what to open.
 *
 * Two kinds of search, because each misses what the other finds. Words are
 * free and exact for a name or a number. Meaning finds a question put in other
 * words, or in another language, which no word of the question meets.
 */

import { keywords, stem } from "./words";

/** What a section is known by: the stems of its most used words, and its numbers, kept on its card. */
export const KEYS_MAX = 40;

/** A number in a text: with its thousands grouped (1,290 or 1.290 or 1 290) or plain, with a decimal part or none. */
const NUMBER = /\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?/g;

/**
 * The words a section is known by, cheap to keep and to match. The stems that
 * stand at least twice, or in a name (a capital letter inside the sentence),
 * the most used first, then every number of three digits or more, with no
 * separator: 1,290 and 1.290 and 1 290 all read 1290.
 */
export function keysOf(text: string, max = KEYS_MAX): string[] {
  const t = String(text ?? "");
  const count = new Map<string, number>();
  for (const w of keywords(t).map(stem)) count.set(w, (count.get(w) ?? 0) + 1);
  /* A name: a capitalised word that does not start a sentence. */
  const named = new Set<string>();
  for (const m of t.matchAll(/(?<=[a-z,;:(] )[A-Z][a-zà-ÿ]{2,}/g)) named.add(stem(m[0].toLowerCase()));
  const words = [...count].filter(([w, n]) => n >= 2 || named.has(w)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
  const nums = [...new Set([...t.matchAll(NUMBER)].map(m => numberKey(m[0])).filter((n): n is string => !!n))];
  return [...words.slice(0, Math.max(0, max - Math.min(nums.length, 12))), ...nums.slice(0, 12)].slice(0, max);
}

/** A number as it is matched: its digits, from three of them up, with a decimal part dropped. */
export function numberKey(raw: string): string | null {
  const s = String(raw).replace(/[\s\u00a0]/g, "");
  const grouped = s.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d{1,2})?$/);
  if (grouped) return grouped[1].replace(/[.,]/g, "");
  const whole = s.split(/[.,]/)[0];
  return /^\d{3,}$/.test(whole) ? whole : null;
}

/** The keys of a question and of the words a router made of it: stems and numbers. */
export function askKeys(q: string, terms: string[] = []): string[] {
  const t = `${q} ${terms.join(" ")}`;
  const nums = [...t.matchAll(NUMBER)].map(m => numberKey(m[0])).filter((n): n is string => !!n);
  return [...new Set([...keywords(t).map(stem), ...nums])];
}

export type Card = { fid: number; sid: number; title: string; summary?: string; keys?: string[] };

/**
 * The points the words of a question earn a section: a key in its title counts
 * 3, in its keys 2, in its summary 1. A section with no keys of its own (a
 * file read before they were kept) is known by its title and summary alone.
 */
export function wordPoints(want: string[], c: Card): number {
  const title = new Set(keywords(c.title ?? "").map(stem)), summary = new Set(keywords(c.summary ?? "").map(stem)), keys = new Set(c.keys ?? []);
  let got = 0;
  for (const w of want) got += title.has(w) ? 3 : keys.has(w) ? 2 : summary.has(w) ? 1 : 0;
  return got;
}

/** The points over the best a question of that many keys could earn, from 0 to 1. */
export const wordFit = (want: string[], c: Card): number => want.length ? wordPoints(want, c) / (3 * want.length) : 0;

/**
 * A section is read when the question earns it 3 points (a word in its title, or two in its keys, or one key and one summary line),
 * or when its meaning is this close. A long question full of small words earns no more than a short one: what counts is how much of
 * the section it names, not how much of the question the section answers.
 */
export const MIN_POINTS = 3;
export const MIN_MEANING = 0.45;
/** At most this many sections, and this many characters of them, are read from the other files. */
export const FIND_N = 3;
export const FIND_CHARS = 6000;

export type Hit = { fid: number; sid: number; words: number; meaning: number; score: number };

/**
 * The sections of the other files worth reading for a question, best first.
 * The two searches are merged by rank (a section high in either list is
 * high), and one needs enough points, or enough meaning, to be read at all:
 * a question the other files do not touch reads none of them.
 */
export function findIn(cards: Card[], want: string[], meaning: { fid: number; sid: number; score: number }[] = []): Hit[] {
  const sim = new Map(meaning.map(m => [`${m.fid}.${m.sid}`, m.score]));
  type Row = { c: Card; points: number; words: number; meaning: number };
  const rows: Row[] = cards.map(c => { const points = wordPoints(want, c); return { c, points, words: want.length ? points / (3 * want.length) : 0, meaning: sim.get(`${c.fid}.${c.sid}`) ?? 0 }; });
  /* Reciprocal rank over the two lists: no score has to be on the same scale as the other. */
  const rank = (by: (r: Row) => number) => new Map(rows.filter(r => by(r) > 0).sort((a, b) => by(b) - by(a)).map((r, i) => [r, i] as [Row, number]));
  const byWords = rank(r => r.points), byMeaning = rank(r => r.meaning);
  return rows
    .filter(r => r.points >= MIN_POINTS || r.meaning >= MIN_MEANING)
    .map(r => ({ fid: r.c.fid, sid: r.c.sid, words: r.words, meaning: r.meaning,
      score: (byWords.has(r) ? 1 / (60 + byWords.get(r)!) : 0) + (byMeaning.has(r) ? 1 / (60 + byMeaning.get(r)!) : 0) }))
    .sort((a, b) => b.score - a.score || b.words - a.words || a.fid - b.fid || a.sid - b.sid)
    .slice(0, FIND_N);
}

export type FileLine = { id: number; name: string; kind: string; chars: number; sections: number; line?: string; status?: string };

/** What the answer is told of a project's other files: one line each, so it knows what else the project holds. */
export function mapText(files: FileLine[]): string {
  return files.map(f => {
    const what = f.kind === "table" ? "a table" : f.kind === "html" ? "a page" : `a document of ${f.sections} section${f.sections === 1 ? "" : "s"}`;
    return `${f.id} | ${f.name} | ${f.status && f.status !== "ready" ? "not read yet" : (f.line || what)}`;
  }).join("\n");
}

/** A table's one line, made in code: its sheets and their columns. */
export function tableLine(sheets: { name: string; cols?: { name: string }[]; header?: string[]; rows: number }[]): string {
  return sheets.slice(0, 3).map(s => `${s.name}: ${s.rows} row${s.rows === 1 ? "" : "s"}, columns ${(s.cols?.length ? s.cols.map(c => c.name) : s.header ?? []).slice(0, 8).join(", ")}`).join("; ").slice(0, 220);
}
