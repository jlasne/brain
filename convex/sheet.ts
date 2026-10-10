/**
 * A file or a table, cut in pieces and searched without reading all of it.
 *
 * A project holds one file of any size. A document is cut in sections of about
 * 12,000 characters, each with a title and a one line summary: the contents
 * list. A question reads that list and opens only the sections it needs, the
 * way a question reads the concept titles of a folder. A table is cut in
 * blocks of rows, and a question about it becomes a filter and a few totals
 * that run over every row, so a count or a sum is exact whatever the size.
 *
 * Pure functions only: no database, no model. The server wraps them.
 */

/* ---------- a document, in sections ---------- */

/** A section runs up to this long. About 3,000 tokens: small enough to open a few for one question. */
export const SECTION_CHARS = 12000;
/** A heading starts a new section once the one before holds at least this much. */
export const SECTION_MIN = 2500;
/** The contents list the chat reads. 1,000 sections is about 4,000 pages. */
export const MAX_SECTIONS = 1000;
/** A text under this many characters is read whole for each question: its contents list would cost about as much as the text. */
export const TINY_CHARS = 8000;
/** A text up to this many characters is read whole when the question is about all of it. Longer, a question reads the sections it needs. */
export const WHOLE_CHARS = 48000;
/** A contents list this long or shorter goes to the router whole. A longer one goes as a short list first: what the project remembers, then the sections that share words with the message. */
export const SHORT_AFTER = 40;
export const SHORT_N = 12;
/** Routes a project keeps: where things are, learned from its own answers. */
export const ROUTES_KEEP = 40;
/** What a project's file can be: words, a page of HTML (words shown rendered), or a table. */
export const FILE_KINDS = ["doc", "html", "table"];
/** The name of a file made from nothing, from the project's name: a page, a table or a document. */
export const madeName = (name: string, kind: string) =>
  `${String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 56) || "Untitled"}.${kind === "html" ? "html" : kind === "table" ? "csv" : "md"}`;
/** The line a PDF page starts with, so an answer can name its page. */
export const PAGE_LINE = /^\[\[p\. (\d+)\]\]$/;

/** What the owner's Brief may hold, in characters: about 1,500 tokens. */
export const BRIEF_MAX = 6000;
/** What the State of play may hold, in characters: about 250 tokens. */
export const STATE_MAX = 1500;
/** What the chat still needs from the owner: at most this many questions, each this long. */
export const ASKS_MAX = 8;
export const ASK_CHARS = 160;
/** The closing next step: one line. */
export const NEXT_CHARS = 140;

export type Part = { title: string; text: string };

const headingOf = (line: string) => /^#{1,3}\s+\S/.test(line);
const cleanTitle = (t: string) => t.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** Pages named by the markers in a text, first and last, or null when it has none. */
export function pagesIn(text: string): { from: number; to: number } | null {
  let from = 0, to = 0;
  for (const line of String(text ?? "").split("\n")) {
    const m = PAGE_LINE.exec(line.trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (!from) from = n;
    to = n;
  }
  return from ? { from, to } : null;
}

/** A text with its page markers taken out, for a title or a summary. */
export const withoutPages = (t: string) => String(t ?? "").split("\n").filter(l => !PAGE_LINE.test(l.trim())).join("\n");

/** A section's own title: its first heading, else its pages, else its first words. */
export function titleOf(text: string, page = 0): string {
  const lines = withoutPages(text).split("\n").map(l => l.trim()).filter(Boolean);
  const head = lines.find(headingOf);
  if (head) return cleanTitle(head).slice(0, 90);
  const pg = pagesIn(text);
  if (pg || page) {
    /* A section that opens inside a page starts on the page before its first marker. */
    const from = page && (!pg || page < pg.from) ? page : pg!.from;
    const to = pg ? pg.to : from;
    return to > from ? `Pages ${from} to ${to}` : `Page ${from}`;
  }
  const line = cleanTitle(lines[0] ?? "");
  if (!line) return "Untitled";
  return line.length > 70 ? line.slice(0, 70).replace(/\s+\S*$/, "") + "..." : line;
}

/** The opening of a section as plain words, for a contents line when no model wrote one. */
export function openingOf(text: string, n = 160): string {
  const t = withoutPages(text).replace(/^#{1,6}\s+/gm, "").replace(/[*_`|]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "..." : t;
}

/** A block longer than the limit, cut at line ends, then at sentence ends, then wherever it must. */
function pieces(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  const out: string[] = [];
  let cur = "";
  const push = (x: string) => {
    if (cur && cur.length + x.length + 1 > max) { out.push(cur); cur = ""; }
    cur = cur ? cur + "\n" + x : x;
  };
  for (const line of block.split("\n")) {
    if (line.length <= max) { push(line); continue; }
    for (const s of line.split(/(?<=[.!?;])\s+/)) {
      if (s.length <= max) { push(s); continue; }
      for (let i = 0; i < s.length; i += max) push(s.slice(i, i + max));
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Cut a text in sections: whole paragraphs, up to `max` characters each, and a
 * heading opens a new section once the one before is worth keeping apart.
 * Nothing is dropped and nothing is repeated, so the sections joined with a
 * blank line give the text back.
 */
export function splitDoc(text: string, max = SECTION_CHARS, firstPage = 0): Part[] {
  const blocks = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map(b => b.replace(/\s+$/, "")).filter(b => b.trim());
  const out: Part[] = [];
  let cur: string[] = [], len = 0, page = firstPage, startPage = firstPage;
  const flush = () => {
    if (!cur.length) return;
    const body = cur.join("\n\n");
    out.push({ title: titleOf(body, startPage), text: body });
    cur = []; len = 0;
  };
  for (const raw of blocks) {
    for (const b of pieces(raw, max)) {
      const lines = b.split("\n").map(l => l.trim());
      const heading = headingOf(lines.find(l => l && !PAGE_LINE.test(l)) ?? "");
      if (cur.length && (len + b.length + 2 > max || (heading && len >= SECTION_MIN))) flush();
      if (!cur.length) {
        const opens = PAGE_LINE.exec(lines[0] ?? "");
        startPage = opens ? Number(opens[1]) : page;
      }
      cur.push(b); len += b.length + 2;
      const pg = pagesIn(b);
      if (pg) page = pg.to;
    }
  }
  flush();
  return out;
}

/** The last page marker in a text, so the next piece of the same file starts from it. */
export const lastPage = (text: string): number => pagesIn(text)?.to ?? 0;

/* ---------- a table, in blocks of rows ---------- */

/** A block of rows runs up to this long, written as CSV. */
export const BLOCK_CHARS = 12000;
/** A table's rows, in every sheet together, up to this many bytes of CSV. About 40,000 rows of 10 columns. */
export const TABLE_BYTES = 6000000;
/** What one read of a file's sections returns at most, in bytes: a query reads 8 MiB at most. */
export const PAGE_BYTES = 3000000;
/** The bytes a text takes as stored. */
export const utf8 = (t: string): number => new TextEncoder().encode(String(t ?? "")).length;
/** Most columns a sheet keeps. */
export const MAX_COLS = 60;

const quote = (c: string) => /[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
/** Rows as CSV text: one line a row, a cell quoted when it holds a comma, a quote or a line break. */
export const csvOf = (rows: string[][]): string => rows.map(r => r.map(c => quote(String(c ?? ""))).join(",")).join("\n");

/** CSV text as rows. A quoted cell may hold commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = ""; out.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
}

/** Rows in groups that each write as CSV in at most `max` characters, one row at least. */
export function blocksOf(rows: string[][], max = BLOCK_CHARS): string[][][] {
  const out: string[][][] = [];
  let cur: string[][] = [], len = 0;
  for (const r of rows) {
    const n = csvOf([r]).length + 1;
    if (cur.length && len + n > max) { out.push(cur); cur = []; len = 0; }
    cur.push(r); len += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * A number out of a cell: "1,490", "€1 490", "12%", "(300)", "1.490,50" and
 * "-5" all read; a word does not. One comma and three digits after it is a
 * thousands mark; one dot is a decimal point.
 */
export function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/[\s  ]/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^[-−–]/, () => { neg = !neg; return ""; });
  for (let i = 0; i < 2; i++) s = s.replace(/^(?:[$€£¥]|USD|EUR|GBP|CHF)/i, "").replace(/(?:[$€£¥%]|USD|EUR|GBP|CHF)$/i, "");
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) {
    if ((s.match(/,/g) ?? []).length > 1 || /^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : "";
  const n = Number(s);
  return s && Number.isFinite(n) ? (neg ? -n : n) : null;
}

export type Col = {
  name: string;
  /** "num" when nine cells in ten that hold something read as a number. */
  kind: "num" | "text";
  filled: number;
  /** A number column: the total, the smallest, the largest and the average. */
  sum?: number; min?: number; max?: number; avg?: number;
  /** A text column that holds few different words: all of them. */
  values?: string[];
};
export type Sheet = { name: string; cols: Col[]; rows: number };

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** A header row made into unique names: an empty cell is "Column 3", a repeat is "Price 2". */
export function colNames(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.slice(0, MAX_COLS).map((h, i) => {
    const base = String(h ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || `Column ${i + 1}`;
    const k = base.toLowerCase(), n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

/** What each column holds, read over every row. */
export function columnsOf(names: string[], rows: string[][]): Col[] {
  return names.map((name, i) => {
    let filled = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity;
    const words = new Map<string, number>();
    for (const r of rows) {
      const c = String(r[i] ?? "").trim();
      if (!c) continue;
      filled++;
      const n = numeric(c);
      if (n !== null) { nums++; sum += n; if (n < min) min = n; if (n > max) max = n; }
      if (words.size <= 40) words.set(c, (words.get(c) ?? 0) + 1);
    }
    if (filled && nums / filled >= 0.9) {
      /* A column read as numbers sums only the cells that are numbers. */
      return { name, kind: "num" as const, filled, sum: round(sum), min: round(min), max: round(max), avg: nums ? round(sum / nums) : 0 };
    }
    const list = [...words.keys()];
    return { name, kind: "text" as const, filled,
      ...(list.length >= 1 && list.length <= 12 && list.every(w => w.length <= 40) ? { values: list } : {}) };
  });
}

/** One column's stats as a line the chat reads: "Price (number): total 13,050, average 1,305, lowest 490, highest 2,400". */
export function colLine(c: Col): string {
  const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return c.kind === "num"
    ? `${c.name} (number, ${c.filled} filled): total ${n(c.sum)}, average ${n(c.avg)}, lowest ${n(c.min)}, highest ${n(c.max)}`
    : `${c.name} (text, ${c.filled} filled)${c.values ? `: ${c.values.join(" | ")}` : ""}`;
}

/* ---------- a question about a table: a filter and a few totals ---------- */

export type Cond = { col: number; op: string; value: string | number | (string | number)[] };
export type Calc = { fn: string; col?: number; by?: number };
export type Query = { sheet: number; where: Cond[]; any: boolean; show: number[]; sort?: { col: number; desc: boolean }; limit: number; calc: Calc[] };

const OPS = new Set(["=", "!=", ">", ">=", "<", "<=", "has", "in", "empty", "filled"]);
const FNS = new Set(["count", "sum", "avg", "min", "max"]);
export const QUERY_ROWS = 100;

/** A column named in a query, by its name or its position, as an index; -1 when it is not there. */
export function colIndex(cols: Col[], ref: unknown): number {
  if (typeof ref === "number" && Number.isInteger(ref)) return ref >= 1 && ref <= cols.length ? ref - 1 : -1;
  const t = String(ref ?? "").trim().toLowerCase();
  if (!t) return -1;
  const i = cols.findIndex(c => c.name.toLowerCase() === t);
  return i >= 0 ? i : cols.findIndex(c => c.name.toLowerCase().includes(t));
}

/**
 * A query as the model wrote it, checked against the sheet. A condition or a
 * total that names a column the sheet does not have is dropped, so a wrong
 * name costs that one line and never the answer. Null when nothing is left to
 * run and no rows are asked for.
 */
export function readQuery(raw: any, sheets: Sheet[]): Query | null {
  if (!raw || typeof raw !== "object") return null;
  let si = typeof raw.sheet === "number" ? raw.sheet - 1 : sheets.findIndex(s => s.name.toLowerCase() === String(raw.sheet ?? "").toLowerCase());
  if (si < 0 || si >= sheets.length) si = 0;
  const sheet = sheets[si];
  if (!sheet) return null;
  const cols = sheet.cols;
  const where: Cond[] = (Array.isArray(raw.where) ? raw.where : []).slice(0, 8).map((c: any) => {
    const col = colIndex(cols, c?.col), op = String(c?.op ?? "=").trim().toLowerCase();
    if (col < 0 || !OPS.has(op)) return null;
    const v = c?.value;
    const value = Array.isArray(v) ? v.slice(0, 40).map((x: any) => typeof x === "number" ? x : String(x ?? "")) : typeof v === "number" ? v : String(v ?? "");
    return { col, op, value } as Cond;
  }).filter(Boolean) as Cond[];
  const calc: Calc[] = (Array.isArray(raw.calc) ? raw.calc : []).slice(0, 6).map((c: any) => {
    const fn = String(c?.fn ?? "").trim().toLowerCase();
    if (!FNS.has(fn)) return null;
    const col = c?.col == null ? -1 : colIndex(cols, c.col), by = c?.by == null ? -1 : colIndex(cols, c.by);
    if (fn !== "count" && (col < 0 || cols[col].kind !== "num")) return null;
    return { fn, ...(col >= 0 ? { col } : {}), ...(by >= 0 ? { by } : {}) } as Calc;
  }).filter(Boolean) as Calc[];
  const show: number[] = (Array.isArray(raw.show) ? raw.show : []).map((c: any) => colIndex(cols, c)).filter((i: number) => i >= 0).slice(0, 12);
  const sortCol = raw.sort ? colIndex(cols, raw.sort.col ?? raw.sort) : -1;
  const shown = show.length ? show : cols.slice(0, 12).map((_, i) => i);
  /* Rows are ordered by a column they show, so a sort column joins the list. */
  if (sortCol >= 0 && !shown.includes(sortCol)) shown.push(sortCol);
  const asked = Number(raw.limit);
  const limit = Number.isFinite(asked) && asked >= 0 ? Math.min(QUERY_ROWS, Math.floor(asked)) : 40;
  return { sheet: si, where, any: raw.any === true, show: shown,
    ...(sortCol >= 0 ? { sort: { col: sortCol, desc: raw.sort?.desc === true || /^desc/i.test(String(raw.sort?.dir ?? "")) } } : {}),
    limit, calc };
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();

function matches(row: string[], cols: Col[], c: Cond): boolean {
  const cell = String(row[c.col] ?? "").trim();
  if (c.op === "empty") return !cell;
  if (c.op === "filled") return !!cell;
  const numeral = cols[c.col]?.kind === "num";
  const vals = Array.isArray(c.value) ? c.value : [c.value];
  if (c.op === "has") return vals.some(v => lower(cell).includes(lower(v)));
  if (c.op === "in") return vals.some(v => lower(cell) === lower(v) || (numeral && numeric(cell) !== null && numeric(cell) === numeric(v)));
  const want = vals[0];
  const a = numeric(cell), b = numeric(want);
  if (numeral && a !== null && b !== null) {
    return c.op === "=" ? a === b : c.op === "!=" ? a !== b : c.op === ">" ? a > b : c.op === ">=" ? a >= b : c.op === "<" ? a < b : a <= b;
  }
  if (c.op === "=") return lower(cell) === lower(want);
  if (c.op === "!=") return lower(cell) !== lower(want);
  /* Order on text is by the words, and an empty cell is never above or below. */
  if (!cell) return false;
  const x = lower(cell), y = lower(want);
  return c.op === ">" ? x > y : c.op === ">=" ? x >= y : c.op === "<" ? x < y : x <= y;
}

export type Found = { n: number; cells: string[] };
export type Result = {
  /** How many rows matched, and the first of them, with their row numbers. */
  matched: number; rows: Found[]; show: number[];
  /** Each total asked: its label, its value, or its value for each group. */
  calc: { label: string; value?: number; groups?: { key: string; value: number }[] }[];
};

/** The query run over blocks of CSV in order. A row's number counts from 1 across the whole sheet. */
export function runQuery(blocks: string[], cols: Col[], q: Query): Result {
  const found: Found[] = [];
  const keep = q.sort ? Infinity : q.limit;
  let n = 0, matched = 0;
  const acc = q.calc.map(() => ({ count: 0, sum: 0, min: Infinity, max: -Infinity, by: new Map<string, { count: number; sum: number; min: number; max: number }>() }));
  for (const text of blocks) {
    for (const row of parseCsv(text)) {
      n++;
      const ok = !q.where.length || (q.any ? q.where.some(c => matches(row, cols, c)) : q.where.every(c => matches(row, cols, c)));
      if (!ok) continue;
      matched++;
      if (found.length < keep) found.push({ n, cells: q.show.map(i => String(row[i] ?? "")) });
      q.calc.forEach((c, k) => {
        /* A count counts the rows, or the rows where its column holds something. */
        const cell = c.col == null ? "x" : String(row[c.col] ?? "").trim();
        const v = c.fn === "count" ? (cell ? 1 : null) : numeric(cell);
        if (v === null) return;
        const into = (t: { count: number; sum: number; min: number; max: number }) => { t.count++; t.sum += v; if (v < t.min) t.min = v; if (v > t.max) t.max = v; };
        into(acc[k] as any);
        if (c.by != null) {
          const key = String(row[c.by] ?? "").trim() || "(empty)";
          let g = acc[k].by.get(key);
          if (!g) { g = { count: 0, sum: 0, min: Infinity, max: -Infinity }; acc[k].by.set(key, g); }
          into(g);
        }
      });
    }
  }
  let rows = found;
  if (q.sort) {
    const at = q.show.indexOf(q.sort.col);
    /* The sort column may not be shown, so it is read again from the sheet when it is not. */
    const key = (f: Found) => f.cells[at];
    if (at >= 0) {
      const num = cols[q.sort.col]?.kind === "num";
      rows = [...found].sort((a, b) => {
        const x = key(a), y = key(b);
        const d = num ? (numeric(x) ?? -Infinity) - (numeric(y) ?? -Infinity) : lower(x) < lower(y) ? -1 : lower(x) > lower(y) ? 1 : 0;
        return (q.sort!.desc ? -d : d) || a.n - b.n;
      });
    }
    rows = rows.slice(0, q.limit);
  }
  const val = (t: { count: number; sum: number; min: number; max: number }, fn: string) =>
    round(fn === "count" ? t.count : fn === "sum" ? t.sum : fn === "avg" ? (t.count ? t.sum / t.count : 0) : fn === "min" ? (t.count ? t.min : 0) : (t.count ? t.max : 0));
  const calc = q.calc.map((c, k) => {
    const label = `${c.fn}${c.col != null ? " of " + cols[c.col].name : ""}${c.by != null ? " by " + cols[c.by].name : ""}`;
    if (c.by != null) {
      const groups = [...acc[k].by.entries()].map(([key, t]) => ({ key, value: val(t, c.fn) }))
        .sort((a, b) => b.value - a.value).slice(0, 30);
      return { label, groups };
    }
    return { label, value: val(acc[k] as any, c.fn) };
  });
  return { matched, rows, show: q.show, calc };
}

/** A result as the chat reads it: a table of the rows found, each with its row number, and the totals. */
const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
export function resultText(r: Result, cols: Col[], sheet: string, total: number): string {
  const head = ["row", ...r.show.map(i => cols[i]?.name ?? "")];
  const body = r.rows.map(f => [String(f.n), ...f.cells.map(c => c.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 120))]);
  const lines = [
    `SHEET "${sheet}": ${r.matched} of ${total} rows match${r.rows.length < r.matched ? `, the first ${r.rows.length} shown` : ""}.`,
    ...r.calc.map(c => c.groups ? `${c.label}: ${c.groups.map(g => `${g.key} ${fmt(g.value)}`).join("; ")}` : `${c.label}: ${fmt(c.value ?? 0)}`),
  ];
  if (r.rows.length) lines.push(head.join(" | "), ...body.map(b => b.join(" | ")));
  return lines.join("\n");
}

/* ---------- changing a file ---------- */

export const MAX_OPS = 12;
export const MAX_NEW_CHARS = 30000;

/** `find` replaced by `to` when it stands exactly once in the text, else why not. */
export function replaceOnce(text: string, find: string, to: string): { text: string } | { error: string } {
  if (!find) return { error: "no words to find" };
  const first = text.indexOf(find);
  if (first < 0) return { error: "those words are not in the section" };
  if (text.indexOf(find, first + find.length) >= 0) return { error: "those words stand more than once in the section" };
  return { text: text.slice(0, first) + to + text.slice(first + find.length) };
}

/** A row's cells set to what a change says, by column name, in a row of the sheet's width. */
export function rowFrom(cols: Col[], values: Record<string, unknown>, base: string[] = []): string[] {
  const row = cols.map((_, i) => String(base[i] ?? ""));
  for (const [k, v] of Object.entries(values ?? {})) {
    const i = colIndex(cols, k);
    if (i >= 0) row[i] = String(v ?? "");
  }
  return row;
}

/** The text of a whole document, from its sections, with the markers a PDF page started with left in. */
export const joinSections = (texts: string[]) => texts.join("\n\n");

/** A line of a document as a Markdown file, with the page markers of a PDF taken out. */
export const downloadText = (texts: string[]) => withoutPages(joinSections(texts)).replace(/\n{3,}/g, "\n\n").trim() + "\n";

/** A short fingerprint of a text, to tell whether it changed. */
export function fnv(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
