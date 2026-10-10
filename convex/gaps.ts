/**
 * The gaps in a project's file, found without a model: what a reader would
 * stop at. A placeholder nobody filled ([TBD], [Creator name], TODO), an empty
 * cell in a column that is otherwise filled, a date in the past where a future
 * one is meant, and two different numbers for one thing in two places.
 *
 * Pure functions only: the words of the file go in, a list comes out. The scan
 * costs no call, so it can run as often as the owner asks.
 */

import { numeric, parseCsv } from "./sheet";
import type { Col } from "./sheet";

export type Gap = {
  kind: "placeholder" | "empty" | "date" | "number";
  /** What a reader sees: the gap in a line. */
  text: string;
  /** Where: a section title, or a sheet's name. */
  where: string;
  /** The section in a document; the first row and the sheet in a table. */
  sid?: number; row?: number; sheet?: number;
};

/** The list the owner is shown stops here. */
export const GAPS_MAX = 25;

/* Unicode-aware edges: "à définir" starts with a letter that \b does not count as a word character. */
const PLACEHOLDER_WORDS = /(?<![\p{L}\p{N}_])(?:TBD|TBC|TODO|FIXME|XXX+|lorem ipsum|to be (?:defined|confirmed|decided|determined|announced|completed)|[àa] (?:définir|compléter|confirmer|préciser)|non défini)(?![\p{L}\p{N}_])|\?\?\?+/giu;
/* [Creator name], {{price}}, <<date>>: a label in brackets that is not a link, a footnote number, a checkbox or a page mark. */
const PLACEHOLDER_BRACKETS = /(?<!\[)\[(?!\[)(?![ xX]\])(?!\d+\])(?!\.\.\.\])([A-Za-z][^\]\n]{1,38})\](?!\()|\{\{[^}\n]{1,40}\}\}|<<[^>\n]{1,40}>>/g;

/** The words of an HTML page a reader sees: scripts, styles and tags taken out. */
const visible = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");

/** Placeholders in some words, each distinct one with how many times it stands, in the order they first appear. */
export function placeholdersIn(text: string, brackets = true): { found: string; n: number }[] {
  const seen = new Map<string, { n: number; at: number }>();
  const take = (m: RegExpMatchArray) => {
    const k = m[0].trim(), had = seen.get(k);
    if (had) had.n++; else seen.set(k, { n: 1, at: m.index ?? 0 });
  };
  for (const m of text.matchAll(PLACEHOLDER_WORDS)) take(m);
  if (brackets) for (const m of text.matchAll(PLACEHOLDER_BRACKETS)) take(m);
  return [...seen].sort((a, b) => a[1].at - b[1].at).map(([found, v]) => ({ found, n: v.n }));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_RE = MONTHS.map(m => m.slice(0, 3)).join("|");
/* A date that is meant to be ahead: said with a deadline, a launch, a delivery. */
const FUTURE = /\b(deadline|due|by|before|until|launch(?:es|ing)?|releas(?:e|es|ing)|ship(?:s|ping)?|deliver(?:y|s|ed)?|starts?|opens?|expires?|will|upcoming|scheduled|planned|d'ici|avant|pour le|[ée]ch[ée]ance|lancement|livraison)\b/i;

/** The dates a line names: as a day, or a month (read as the month's last day), with where they stand in the line. */
function datesIn(line: string): { label: string; at: number }[] {
  const out: { label: string; at: number }[] = [];
  const day = (y: number, m: number, d: number) => Date.UTC(y, m, d);
  for (const m of line.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) out.push({ label: m[0], at: day(+m[1], +m[2] - 1, +m[3]) });
  const mi = (s: string) => MONTHS.findIndex(x => x.startsWith(s.toLowerCase().slice(0, 3)));
  for (const m of line.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS_RE})[a-z]*\\.?,?\\s+(20\\d\\d)\\b`, "gi"))) out.push({ label: m[0], at: day(+m[3], mi(m[2]), +m[1]) });
  for (const m of line.matchAll(new RegExp(`\\b(${MONTHS_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, "gi"))) out.push({ label: m[0], at: day(+m[3], mi(m[1]), +m[2]) });
  for (const m of line.matchAll(new RegExp(`\\b(${MONTHS_RE})[a-z]*\\.?\\s+(20\\d\\d)\\b`, "gi"))) {
    if (out.some(x => x.label.includes(m[0]))) continue;
    out.push({ label: m[0], at: day(+m[2], mi(m[1]) + 1, 0) });
  }
  return out;
}

/** Dates in the past that stand where a future one is meant, in some words. */
export function pastDatesIn(text: string, today: string): { label: string; line: string }[] {
  const now = Date.parse(today);
  if (!Number.isFinite(now)) return [];
  const out: { label: string; line: string }[] = [];
  for (const line of text.split(/\n|(?<=[.!?])\s+/)) {
    if (!FUTURE.test(line)) continue;
    for (const d of datesIn(line)) if (d.at < now) out.push({ label: d.label, line: line.trim().slice(0, 90) });
  }
  return out;
}

const AMOUNT = /(?:[$€£]\s?\d[\d.,]*\d|\b\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d+)?\s?(?:€|£|\$|%|euros?|dollars?|usd|eur)(?![a-z])|\b\d[\d.,]*\d?\s?(?:€|£|\$|%|euros?|dollars?|usd|eur)(?![a-z]))/gi;
/* Words that join a thing to its number without naming it. */
const GLUE = new Set(["is", "are", "was", "were", "costs", "cost", "at", "of", "for", "to", "the", "a", "an", "will", "be", "with", "and", "est", "sont", "coute", "coûte", "de", "du", "le", "la", "les", "pour", "a", "au", "now", "only", "about", "around", "from", "up"]);

/** Amounts with the two words before them, as a thing and its number: "team plan" and 1,290 euros. */
function amountsIn(text: string): { key: string; label: string; value: number; shown: string }[] {
  const out: { key: string; label: string; value: number; shown: string }[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0).split(/[\n.;:!?()]/).pop() ?? "";
    const words = before.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w && !GLUE.has(w));
    const label = words.slice(-2);
    if (label.length < 2 || label.some(w => w.length < 3)) continue;
    const value = numeric(m[0].replace(/\b(?:euros?|dollars?)\b/i, "").trim());
    if (value === null) continue;
    const unit = /%/.test(m[0]) ? "%" : /[€]|eur/i.test(m[0]) ? "eur" : /[$]|usd|dollar/i.test(m[0]) ? "usd" : /£/.test(m[0]) ? "gbp" : "";
    out.push({ key: `${label.join(" ")}|${unit}`, label: label.join(" "), value, shown: m[0].trim() });
  }
  return out;
}

export type Piece = { sid: number; title: string; text: string };

/** The gaps in a document or a page, section by section. */
export function scanDoc(pieces: Piece[], today: string, html = false): Gap[] {
  const gaps: Gap[] = [];
  /* One: the placeholders, a section at a time. */
  for (const p of pieces) {
    const text = html ? visible(p.text) : p.text;
    const found = placeholdersIn(text, !html);
    for (const f of found.slice(0, 4)) gaps.push({ kind: "placeholder", text: `${f.found} is not filled in${f.n > 1 ? ` (${f.n} times)` : ""}`, where: p.title, sid: p.sid });
    if (found.length > 4) gaps.push({ kind: "placeholder", text: `${found.length - 4} more placeholders`, where: p.title, sid: p.sid });
  }
  /* Two: dates that are behind us. */
  for (const p of pieces) {
    for (const d of pastDatesIn(html ? visible(p.text) : p.text, today).slice(0, 2)) gaps.push({ kind: "date", text: `${d.label} is in the past: "${d.line}"`, where: p.title, sid: p.sid });
  }
  /* Three: one thing with two numbers, in different sections or lines. */
  const seen = new Map<string, { value: number; shown: string; piece: Piece }[]>();
  for (const p of pieces) {
    const text = html ? visible(p.text) : p.text;
    for (const a of amountsIn(text)) {
      const list = seen.get(a.key) ?? [];
      if (!list.some(x => x.value === a.value && x.piece.sid === p.sid)) list.push({ value: a.value, shown: a.shown, piece: p });
      seen.set(a.key, list);
    }
  }
  for (const [key, list] of seen) {
    const values = new Set(list.map(x => x.value));
    if (values.size < 2) continue;
    const first = list[0], other = list.find(x => x.value !== first.value)!;
    gaps.push({ kind: "number", text: `Two numbers for "${key.split("|")[0]}": ${first.shown} in ${first.piece.title}, ${other.shown} in ${other.piece.title}. Check which holds`, where: first.piece.title, sid: first.piece.sid });
  }
  return rank(gaps);
}

/** The gaps in a table: columns filled in part, and placeholders in its cells. */
export function scanTable(sheets: { name: string; cols: Col[]; rows: number }[], blocks: string[][]): Gap[] {
  const gaps: Gap[] = [];
  sheets.forEach((s, si) => {
    for (const c of s.cols ?? []) {
      const filled = Number(c.filled ?? 0), empty = s.rows - filled;
      if (s.rows > 0 && empty > 0 && filled > 0) gaps.push({ kind: "empty", text: `${empty} empty cell${empty === 1 ? "" : "s"} in "${c.name}"`, where: s.name, sheet: si });
      else if (s.rows > 0 && filled === 0) gaps.push({ kind: "empty", text: `The column "${c.name}" is empty`, where: s.name, sheet: si });
    }
    const rowsWith = new Map<string, number[]>();
    let n = 0;
    for (const b of (blocks[si] ?? []).slice(0, 400)) {
      for (const r of parseCsv(b)) {
        n++;
        for (const cell of r) for (const f of placeholdersIn(String(cell), true)) {
          const list = rowsWith.get(f.found) ?? []; if (list.length < 6) list.push(n); rowsWith.set(f.found, list);
        }
      }
    }
    for (const [found, rows] of rowsWith) gaps.push({ kind: "placeholder", text: `${found} is not filled in, in row${rows.length === 1 ? "" : "s"} ${rows.join(", ")}`, where: s.name, sheet: si, row: rows[0] });
  });
  return rank(gaps);
}

const ORDER = ["placeholder", "empty", "date", "number"];
/** Placeholders first, then empty cells, dates and numbers, and no more than the owner is shown. */
function rank(gaps: Gap[]): Gap[] {
  return gaps.map((g, i) => ({ g, i })).sort((a, b) => ORDER.indexOf(a.g.kind) - ORDER.indexOf(b.g.kind) || a.i - b.i).map(x => x.g);
}

/** The scan as the app shows it: a short list, and how many more there were. */
export function gapList(gaps: Gap[]): { gaps: Gap[]; total: number } {
  return { gaps: gaps.slice(0, GAPS_MAX), total: gaps.length };
}
