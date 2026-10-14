/**
 * Reading a file in, and out again.
 *
 * The browser reads the file and sends it a piece at a time. A document's piece is cut in sections, each given a line of the contents
 * list by the model (a title and a summary, four sections a call); a table's piece is cut in blocks of rows. Once the last piece is in,
 * a table's columns are read over every row and the file opens. Reading it out goes through the same blocks, a page at a time.
 *
 * The model calls take their key and model from the caller, as everywhere. Nothing here writes a key anywhere.
 */

import { internal } from "./_generated/api";
import { ask, parseJson } from "./lib";
import { keysOf } from "./find";
import { splitDoc, openingOf, withoutPages, pagesIn, SECTION_CHARS, columnsOf, colNames, parseCsv, csvOf, blocksOf } from "./sheet";
import type { Part } from "./sheet";
import { NO_DASH } from "./style";

const SUMMARY_RULES = `You write the lines of the contents list of a long file, one for each numbered section below.
Reply with only JSON: {"lines":[{"n":1,"title":"","summary":""}]}
- One line for each section, with "n" its number.
- "title": 2 to 8 words naming what the section is about. Keep the section's own heading when it has one.
- "summary": one sentence of at most 25 words with the main facts, names and numbers a reader would look for here. Write it in English.
- ${NO_DASH}`;

const pageSuffix = (text: string) => {
  const p = pagesIn(text);
  return p ? ` (${p.from === p.to ? "p. " + p.from : `pp. ${p.from} to ${p.to}`})` : "";
};

/** Sections written up in one call: the rules and the instructions are sent once for all of them. */
const LINES_A_CALL = 4;

/**
 * A title and a one line summary for each section, four sections a call, six
 * calls at a time. A section the model fails on, or leaves out of its reply,
 * keeps the title and the opening words it already has, so a busy model never
 * stops a file from being read.
 */
export async function summarise(parts: Part[], o: { key?: string; model?: string; meter?: (u: any) => void }): Promise<{ title: string; summary: string }[]> {
  const out: { title: string; summary: string }[] = parts.map(p => ({ title: p.title, summary: openingOf(p.text) }));
  const batches: number[][] = [];
  for (let i = 0; i < parts.length; i += LINES_A_CALL) batches.push(parts.slice(i, i + LINES_A_CALL).map((_, k) => i + k));
  const one = (t: any, n: number) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const batch = batches[next++];
      if (!batch) return;
      try {
        const sections = batch.map((i, k) => `SECTION ${k + 1}\n${parts[i].text.slice(0, SECTION_CHARS + 2000)}`).join("\n\n");
        const { text, finish, usage } = await ask([
          { role: "system", content: "You write contents lines for long files. You reply with JSON only." },
          { role: "user", content: `${SUMMARY_RULES}\n\n${sections}` },
        ], { json: true, maxTokens: 150 + 250 * batch.length, timeout: 90000, temperature: 0, key: o.key, model: o.model });
        o.meter?.(usage);
        const d = parseJson(String(text), finish);
        const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
        batch.forEach((i, k) => {
          const line = lines.find(l => Number(l?.n) === k + 1);
          if (!line) { console.log(`a section kept its opening words: the reply had no line ${k + 1}`); return; }
          const p = parts[i];
          const headed = /^#{1,3}\s+\S/m.test(withoutPages(p.text));
          const title = headed ? p.title : one(line.title, 90) || p.title;
          out[i] = { title: title + (headed ? "" : pageSuffix(p.text)), summary: one(line.summary, 220) || out[i].summary };
        });
      } catch (e: any) {
        console.log(`${batch.length} section${batch.length === 1 ? "" : "s"} kept their opening words: ${String(e?.message ?? e).slice(0, 140)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, batches.length) }, worker));
  return out;
}

/** A piece of a document: cut in sections, each given a contents line and the words it is known by, stored in order. */
export async function addDocPiece(ctx: any, o: { space: string; brain: string; ver: number; text: string; page: number; key?: string; model?: string; meter?: (u: any) => void }) {
  const parts = splitDoc(o.text, SECTION_CHARS, o.page);
  if (!parts.length) return { sections: 0, chars: 0 };
  const lines = await summarise(parts, o);
  return await ctx.runMutation(internal.files.sectionAdd, { space: o.space, brain: o.brain, ver: o.ver, sheet: 0,
    items: parts.map((p, i) => ({ title: lines[i].title, summary: lines[i].summary, text: p.text, keys: keysOf(p.text) })) });
}

/** A piece of a table sheet: its rows cut in blocks, stored in order. */
export async function addRowPiece(ctx: any, o: { space: string; brain: string; ver: number; sheet: number; rows: string[][] }) {
  const blocks = blocksOf(o.rows);
  if (!blocks.length) return { sections: 0, chars: 0 };
  return await ctx.runMutation(internal.files.sectionAdd, { space: o.space, brain: o.brain, ver: o.ver, sheet: o.sheet,
    items: blocks.map(b => ({ title: "Rows", summary: "", text: csvOf(b), rows: b.length })) });
}

/** Every block of a sheet, or every section of a document, read in pages that never pass what a query may read. */
export async function readBlocks(ctx: any, o: { space: string; brain: string; sheet?: number }): Promise<string[]> {
  const out: string[] = [];
  for (let from: number | null = 0; from !== null;) {
    const p: { items: string[]; next: number | null } = await ctx.runQuery(internal.files.blocksPage, { space: o.space, brain: o.brain, ...(o.sheet != null ? { sheet: o.sheet } : {}), from });
    out.push(...p.items); from = p.next;
  }
  return out;
}

/** The last piece is in. A table's columns are read over every row, then the file opens. */
export async function finishFile(ctx: any, o: { space: string; brain: string; ver: number }) {
  const { file } = await ctx.runQuery(internal.files.fileGet, { space: o.space, brain: o.brain });
  if (file.ver !== o.ver) throw new Error("this file was replaced: start it again");
  let cols: any[] | undefined;
  if (file.kind === "table") {
    cols = [];
    for (let i = 0; i < file.sheets.length; i++) {
      const rows = (await readBlocks(ctx, { space: o.space, brain: o.brain, sheet: i })).flatMap((b: string) => parseCsv(b));
      cols.push(columnsOf(file.sheets[i].header?.length ? colNames(file.sheets[i].header) : colNames((rows[0] ?? []).map(() => "")), rows));
    }
  }
  return await ctx.runMutation(internal.files.fileFinish, { space: o.space, brain: o.brain, ver: o.ver, ...(cols ? { cols } : {}) });
}
