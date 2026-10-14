/**
 * Finding the sections of a long asset that bear on a message, with no model: the words of the message against the words a section is
 * known by. Free, and exact for a name or a number. Pure functions: the server reads the cards and asks these what to open.
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

/** The keys of a message: stems and numbers. */
export function askKeys(t: string): string[] {
  const nums = [...t.matchAll(NUMBER)].map(m => numberKey(m[0])).filter((n): n is string => !!n);
  return [...new Set([...keywords(t).map(stem), ...nums])];
}

export type Card = { sid: number; title: string; summary?: string; keys?: string[] };

/**
 * The points the words of a message earn a section: a key in its title counts
 * 3, in its keys 2, in its summary 1. A section with no keys of its own (a
 * file read before they were kept) is known by its title and summary alone.
 */
export function wordPoints(want: string[], c: Card): number {
  const title = new Set(keywords(c.title ?? "").map(stem)), summary = new Set(keywords(c.summary ?? "").map(stem)), keys = new Set(c.keys ?? []);
  let got = 0;
  for (const w of want) got += title.has(w) ? 3 : keys.has(w) ? 2 : summary.has(w) ? 1 : 0;
  return got;
}

/** The sections of a long document that bear on a message, best first: the ones its words earn points in, at most `n`. */
export function pickSections(cards: Card[], q: string, n: number): number[] {
  const want = askKeys(q);
  return cards.map(c => ({ sid: c.sid, p: wordPoints(want, c) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p || a.sid - b.sid).slice(0, n).map(x => x.sid);
}
