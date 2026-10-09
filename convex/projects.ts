/**
 * Projects: what the database holds.
 *
 * A project is a folder of type "project". Its memory is the folder's own
 * concepts, in the format every folder has. Beside it sit one file, cut in
 * sections (projectFiles, projectCards, projectSections), one running thread
 * of the last 10 exchanges (projectThreads), and the changes its chat proposed
 * to the file (projectEdits).
 *
 * A project belongs to one workspace and is never shared: no other folder,
 * chat, digest or connector reads it. Only the personal folder's chat reads
 * its memory, and only that.
 */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { readSpace, slug, today } from "./lib";
import { MAX_SECTIONS, TABLE_BYTES, PAGE_BYTES, MAX_OPS, FILE_KINDS, ROUTES_KEEP, replaceOnce, parseCsv, csvOf, rowFrom, fnv, colIndex, utf8, blocksOf, columnsOf, colNames } from "./sheet";
import type { Col } from "./sheet";

/** Rows one change may build a sheet from. */
export const TABLE_OP_ROWS = 1000;
/** A sheet this small has its column totals worked out again after a change. */
const RECOUNT_CHARS = 1000000;

/** Exchanges the running thread keeps. */
export const THREAD_KEEP = 10;
/** Changes kept to undo. */
export const EDITS_KEEP = 10;
/** Sections one change may touch, and the most words it may carry. */
export const EDIT_SECTIONS = 8;
export const EDIT_CHARS = 60000;
/** A section grows no further than this through changes. */
export const SECTION_MAX = 30000;

/** The folder behind a project, when it is one of this workspace's own. */
async function projectIn(ctx: any, space: string, brain: string): Promise<any | null> {
  const b = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", brain)).unique();
  return b && b.type === "project" && readSpace(b.space) === readSpace(space) ? b : null;
}
const need = async (ctx: any, space: string, brain: string) => {
  const b = await projectIn(ctx, space, brain);
  if (!b) throw new Error("that project is not in this workspace");
  return b;
};
const fileOf = async (ctx: any, brain: string) =>
  await ctx.db.query("projectFiles").withIndex("by_brain", (q: any) => q.eq("brain", brain)).first();
const cardsOf = async (ctx: any, brain: string): Promise<any[]> =>
  (await ctx.db.query("projectCards").withIndex("by_brain_ord", (q: any) => q.eq("brain", brain)).collect())
    .sort((a: any, b: any) => a.ord - b.ord);

/* ---------------- reading ---------------- */

/** The projects of a workspace, each with its file and how much it remembers. */
export const projectsOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const brains = (await ctx.db.query("brains").collect()).filter((b: any) => b.type === "project" && readSpace(b.space) === space);
    const out: any[] = [];
    for (const b of brains) {
      const f = await fileOf(ctx, b.slug);
      const mem = await ctx.db.query("cards").withIndex("by_brain", (q: any) => q.eq("brain", b.slug)).collect();
      out.push({ slug: b.slug, name: b.name, created: b.created, kind: f?.kind ?? null, file: f?.name ?? "", status: f?.status ?? "empty",
        made: !!f?.made, chars: f?.chars ?? 0, sections: f?.parts ?? 0, memory: mem.length, at: f?.at ?? 0 });
    }
    return out.sort((x, y) => y.at - x.at || x.name.localeCompare(y.name));
  },
});

/**
 * Everything the project screen opens with: the file's shape, the contents
 * list, the thread, the changes still open or recently applied, and what the
 * project remembers.
 */
export const projectGet = internalQuery({
  args: { space: v.string(), brain: v.string() },
  handler: async (ctx, a) => {
    const b = await need(ctx, a.space, a.brain);
    const file = await fileOf(ctx, a.brain);
    const cards = file ? await cardsOf(ctx, a.brain) : [];
    const thread = await ctx.db.query("projectThreads").withIndex("by_brain", (q: any) => q.eq("brain", a.brain)).first();
    const edits = (await ctx.db.query("projectEdits").withIndex("by_brain_at", (q: any) => q.eq("brain", a.brain)).collect())
      .sort((x: any, y: any) => y.at - x.at).slice(0, EDITS_KEEP)
      .map((e: any) => ({ id: String(e._id), at: e.at, status: e.status, preview: e.preview }));
    return {
      project: { slug: b.slug, name: b.name, created: b.created },
      file: file ? { name: file.name, kind: file.kind, made: !!file.made, sheets: file.sheets, chars: file.chars, sections: file.parts, status: file.status, ver: file.ver, at: file.at } : null,
      cards: cards.map((c: any) => ({ sid: c.sid, ord: c.ord, sheet: c.sheet, title: c.title, summary: c.summary, chars: c.chars, ...(c.rows != null ? { rows: c.rows } : {}) })),
      turns: thread?.turns ?? [],
      edits,
      memory: await memoryRows(ctx, a.brain),
      shortcuts: file?.routes ?? [],
    };
  },
});

async function memoryRows(ctx: any, brain: string) {
  const rows = await ctx.db.query("concepts").withIndex("by_brain", (q: any) => q.eq("brain", brain)).collect();
  return rows.map((c: any) => ({ slug: c.slug, title: c.title, position: c.position, summaryLine: c.summaryLine, updated: c.updated,
    dates: (c.evidence ?? []).map((e: any) => e?.date).filter(Boolean).slice(0, 3) }))
    .sort((x: any, y: any) => String(y.updated).localeCompare(String(x.updated)) || x.title.localeCompare(y.title));
}

/** What a project remembers, whole, for the chat to read. */
export const memoryOf = internalQuery({
  args: { space: v.string(), brain: v.string() },
  handler: async (ctx, a) => { await need(ctx, a.space, a.brain); return await memoryRows(ctx, a.brain); },
});

/** Sections' words by id, with their titles. At most 60,000 characters in all. */
export const sectionsRead = internalQuery({
  args: { space: v.string(), brain: v.string(), sids: v.array(v.number()) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const out: any[] = [];
    let chars = 0;
    for (const sid of [...new Set<number>(a.sids as number[])].slice(0, 100)) {
      const card = await ctx.db.query("projectCards").withIndex("by_brain_sid", (q: any) => q.eq("brain", a.brain).eq("sid", sid)).first();
      const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", a.brain).eq("sid", sid)).first();
      if (!card || !body) continue;
      if (chars + body.text.length > 200000) break;
      chars += body.text.length;
      out.push({ sid, sheet: card.sheet, title: card.title, rows: card.rows ?? null, text: body.text });
    }
    return out;
  },
});

/**
 * The sections of a document in reading order, for the page to show as it
 * scrolls: from the start, after a given place, or from a given section on.
 */
export const docPage = internalQuery({
  args: { space: v.string(), brain: v.string(), from: v.number(), n: v.number(), sid: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const all = await cardsOf(ctx, a.brain);
    const start = a.sid != null ? all.find((c: any) => c.sid === a.sid) : null;
    const cards = all.filter((c: any) => start ? c.ord >= start.ord : c.ord > a.from).slice(0, Math.max(1, Math.min(6, a.n)));
    const out: any[] = [];
    for (const c of cards) {
      const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", a.brain).eq("sid", c.sid)).first();
      out.push({ sid: c.sid, ord: c.ord, title: c.title, text: body?.text ?? "" });
    }
    return out;
  },
});

/**
 * A page of the words of a file's sections in order, at most about 3 MB, for
 * what must read every row or every section: a question over a table, the
 * columns' totals, a download. The caller asks again from `next` until it is
 * null, so a file of any size is read in pages no query refuses.
 */
export const blocksPage = internalQuery({
  args: { space: v.string(), brain: v.string(), sheet: v.optional(v.number()), from: v.number() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const cards = (await cardsOf(ctx, a.brain)).filter((c: any) => a.sheet == null || c.sheet === a.sheet);
    const items: string[] = [];
    let bytes = 0, i = a.from;
    for (; i < cards.length; i++) {
      const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", a.brain).eq("sid", cards[i].sid)).first();
      const text = body?.text ?? "";
      const size = utf8(text);
      if (items.length && bytes + size > PAGE_BYTES) break;
      items.push(text); bytes += size;
    }
    return { items, next: i < cards.length ? i : null };
  },
});

/** Rows of a table sheet, from row `from` on, as the grid shows them. */
export const rowsPage = internalQuery({
  args: { space: v.string(), brain: v.string(), sheet: v.number(), from: v.number(), n: v.number() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const cards = (await cardsOf(ctx, a.brain)).filter((c: any) => c.sheet === a.sheet);
    const want = Math.max(1, Math.min(300, a.n));
    const rows: { n: number; cells: string[] }[] = [];
    let at = 0;
    for (const c of cards) {
      const size = c.rows ?? 0;
      if (at + size >= a.from && rows.length < want) {
        const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", a.brain).eq("sid", c.sid)).first();
        parseCsv(body?.text ?? "").forEach((cells, i) => {
          const n = at + i + 1;
          if (n >= a.from && rows.length < want) rows.push({ n, cells });
        });
      }
      at += size;
      if (rows.length >= want) break;
    }
    return { rows, total: cards.reduce((s: number, c: any) => s + (c.rows ?? 0), 0) };
  },
});

/** Individual rows by number, with their block, for a change to check and preview. */
async function rowsAt(ctx: any, brain: string, sheet: number, wanted: number[]) {
  const cards = (await cardsOf(ctx, brain)).filter((c: any) => c.sheet === sheet);
  const out = new Map<number, { cells: string[]; sid: number; at: number }>();
  let at = 0;
  for (const c of cards) {
    const size = c.rows ?? 0;
    if (wanted.some(n => n > at && n <= at + size)) {
      const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", brain).eq("sid", c.sid)).first();
      parseCsv(body?.text ?? "").forEach((cells, i) => { if (wanted.includes(at + i + 1)) out.set(at + i + 1, { cells, sid: c.sid, at }); });
    }
    at += size;
  }
  return out;
}

/* ---------------- a project ---------------- */

/** A new project: a folder of type project, private from the start. */
export const projectCreate = internalMutation({
  args: { space: v.string(), name: v.string(), owner: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const name = a.name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) throw new Error("a project needs a name");
    const base = slug(name);
    let s = base;
    for (let n = 1; ; n++) {
      const seen = await ctx.db.query("brains").withIndex("by_slug", (q: any) => q.eq("slug", s)).unique();
      if (!seen) break;
      if (readSpace(seen.space) === space && seen.type === "project" && s === base) throw new Error("a project with that name exists");
      s = n === 1 ? `${base}-${space}` : `${base}-${space}-${n}`;
      if (n > 50) throw new Error("pick another name");
    }
    await ctx.db.insert("brains", { slug: s, name, type: "project", created: today(), visibility: "private", space,
      scope: "What I decide and keep in this project, dated.", ...(a.owner ? { owner: a.owner } : {}) });
    return s;
  },
});

/** A project renamed: the name changes and the slug stays, so nothing that points at it moves. */
export const projectRename = internalMutation({
  args: { space: v.string(), brain: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    const b = await need(ctx, a.space, a.brain);
    const name = a.name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) throw new Error("a project needs a name");
    await ctx.db.patch(b._id, { name });
    return { slug: b.slug, name };
  },
});

/**
 * Take a project apart, a batch at a time. Each call deletes up to 120 rows
 * and says whether more are left; the caller asks again until it says no.
 * `file` clears only the file side, for a new file in the same project.
 */
export const projectWipe = internalMutation({
  args: { space: v.string(), brain: v.string(), file: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const b = await need(ctx, a.space, a.brain);
    let left = 120;
    const clear = async (table: string, index: string) => {
      const rows = await ctx.db.query(table as any).withIndex(index as any, (q: any) => q.eq("brain", a.brain)).take(left);
      for (const r of rows) await ctx.db.delete(r._id);
      left -= rows.length;
      return left <= 0;
    };
    for (const [t, i] of [["projectSections", "by_brain_sid"], ["projectCards", "by_brain_sid"], ["projectEdits", "by_brain_at"]]) {
      if (await clear(t, i)) return { more: true };
    }
    if (a.file) {
      const f = await fileOf(ctx, a.brain);
      if (f) await ctx.db.delete(f._id);
      return { more: false };
    }
    for (const [t, i] of [["projectThreads", "by_brain"], ["projectFiles", "by_brain"]]) {
      if (await clear(t, i)) return { more: true };
    }
    /* Its memory: concepts, their cards and their meanings. */
    const concepts = await ctx.db.query("concepts").withIndex("by_brain", (q: any) => q.eq("brain", a.brain)).take(left);
    for (const c of concepts) {
      for (const card of await ctx.db.query("cards").withIndex("by_cid", (q: any) => q.eq("cid", c._id)).collect()) await ctx.db.delete(card._id);
      for (const vec of await ctx.db.query("vectors").withIndex("by_cid", (q: any) => q.eq("cid", c._id)).collect()) await ctx.db.delete(vec._id);
      await ctx.db.delete(c._id);
    }
    left -= concepts.length;
    if (left <= 0) return { more: true };
    /* The notes it was kept from: sources that belong to this project alone. */
    for (const s of (await ctx.db.query("sources").collect()).filter((x: any) => (x.brains ?? []).length === 1 && x.brains[0] === a.brain)) {
      for (const n of await ctx.db.query("notes").withIndex("by_sid", (q: any) => q.eq("sid", s.sid)).collect()) await ctx.db.delete(n._id);
      await ctx.db.delete(s._id);
    }
    await ctx.db.delete(b._id);
    return { more: false };
  },
});

/* ---------------- a file, read in pieces ---------------- */

/**
 * A new file starts: the project's file row is made again, empty, and reading.
 * The old sections are already gone (projectWipe with file set), so a file that
 * fails halfway leaves a project with no file, never a mixed one.
 */
export const fileBegin = internalMutation({
  args: { space: v.string(), brain: v.string(), name: v.string(), kind: v.string(), sheets: v.array(v.any()) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    if (!FILE_KINDS.includes(a.kind)) throw new Error("a file is a document, a page or a table");
    const old = await fileOf(ctx, a.brain);
    const sheets = a.sheets.slice(0, 40).map((s: any) => ({ name: String(s?.name ?? "").slice(0, 60) || "Sheet",
      header: (Array.isArray(s?.header) ? s.header : []).slice(0, 60).map((x: any) => String(x ?? "").slice(0, 60)), cols: [], rows: 0 }));
    const doc = { space: readSpace(a.space), brain: a.brain, name: a.name.slice(0, 200), kind: a.kind, sheets: sheets.length ? sheets : [{ name: a.name.slice(0, 60), header: [], cols: [], rows: 0 }],
      chars: 0, parts: 0, next: 1, status: "reading", ver: (old?.ver ?? 0) + 1, at: Date.now() };
    if (old) await ctx.db.replace(old._id, doc); else await ctx.db.insert("projectFiles", doc);
    return { ver: doc.ver };
  },
});

/**
 * A project that starts from nothing: an empty file of the kind chosen, ready
 * at once, for the chat to write by what the owner describes. Its changes
 * apply as they come, since there is nothing to lose.
 */
export const fileMake = internalMutation({
  args: { space: v.string(), brain: v.string(), kind: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    if (!FILE_KINDS.includes(a.kind)) throw new Error("make a document, a page or a table");
    if (await fileOf(ctx, a.brain)) throw new Error("this project has a file already");
    const name = a.name.replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
    await ctx.db.insert("projectFiles", { space: readSpace(a.space), brain: a.brain, name, kind: a.kind, made: true,
      sheets: [{ name: a.kind === "table" ? "Sheet 1" : name.slice(0, 60), header: [], cols: [], rows: 0 }],
      chars: 0, parts: 0, next: 1, status: "ready", ver: 1, at: Date.now() });
    return { ver: 1 };
  },
});

/**
 * Where things are, learned from an answer: the words of the question and the
 * sections that answered it. A route that rests on the same sections gains the
 * new words; any other starts a route of its own. The latest 40 are kept, and
 * a new file takes them all away with it.
 */
export const routeLearn = internalMutation({
  args: { space: v.string(), brain: v.string(), terms: v.array(v.string()), sids: v.array(v.number()), q: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const f = await fileOf(ctx, a.brain);
    if (!f || f.status !== "ready") return { n: 0 };
    /* The question that last used the route, for the owner to read; the words matched are the stems. */
    const q = String(a.q ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    const have = new Set((await cardsOf(ctx, a.brain)).map((c: any) => c.sid));
    const sids = [...new Set(a.sids)].filter(s => have.has(s)).slice(0, 8);
    const terms = [...new Set(a.terms.map(t => String(t).slice(0, 24)).filter(Boolean))].slice(0, 20);
    const held = (f.routes ?? []).map((r: any) => ({ ...r, s: r.s.filter((x: number) => have.has(x)) })).filter((r: any) => r.s.length);
    if (!sids.length || !terms.length) return { n: held.length };
    const same = held.findIndex((r: any) => r.s.filter((x: number) => sids.includes(x)).length / Math.min(r.s.length, sids.length) >= 0.5);
    const at = Date.now();
    /* The route just used goes first, so that when times tie the oldest are the ones to go. */
    if (same >= 0) { const old = held.splice(same, 1)[0]; held.unshift({ t: [...new Set([...terms, ...old.t])].slice(0, 20), s: sids, n: old.n + 1, at, ...(q || old.q ? { q: q || old.q } : {}) }); }
    else held.unshift({ t: terms, s: sids, n: 1, at, ...(q ? { q } : {}) });
    held.sort((x: any, y: any) => y.at - x.at);
    const keep = held.slice(0, ROUTES_KEEP);
    await ctx.db.patch(f._id, { routes: keep });
    return { n: keep.length };
  },
});

/**
 * Sections stored: a card and its words each. They land in the order sent.
 * Past 1,000 sections, or 6,000,000 characters of a table, the file is too
 * big and says so.
 */
export const sectionAdd = internalMutation({
  args: { space: v.string(), brain: v.string(), ver: v.number(), sheet: v.number(),
          items: v.array(v.object({ title: v.string(), summary: v.string(), text: v.string(), rows: v.optional(v.number()) })) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const f = await fileOf(ctx, a.brain);
    if (!f || f.ver !== a.ver || f.status !== "reading") throw new Error("this file was replaced or finished: start it again");
    if (f.parts + a.items.length > MAX_SECTIONS) throw new Error(`this file is longer than the ${MAX_SECTIONS} sections a project reads. Drop it in two projects.`);
    const add = a.items.reduce((s, x) => s + x.text.length, 0), bytes = a.items.reduce((s, x) => s + utf8(x.text), 0);
    if (f.kind === "table" && (f.bytes ?? 0) + bytes > TABLE_BYTES) throw new Error("this table is bigger than a project reads: about 40,000 rows of 10 columns");
    let sid = f.next, at = f.sheets[a.sheet]?.rows ?? 0;
    for (const x of a.items) {
      /* A block of rows is named by the rows it holds. */
      const title = x.rows != null ? `Rows ${at + 1} to ${at + x.rows}` : x.title.slice(0, 120);
      if (x.rows != null) at += x.rows;
      await ctx.db.insert("projectCards", { brain: a.brain, sid, ord: sid, sheet: a.sheet, title, summary: x.summary.slice(0, 300),
        chars: x.text.length, ...(x.rows != null ? { rows: x.rows } : {}) });
      await ctx.db.insert("projectSections", { brain: a.brain, sid, text: x.text });
      sid++;
    }
    const sheets = f.sheets.map((s: any, i: number) => i === a.sheet ? { ...s, rows: (s.rows ?? 0) + a.items.reduce((n, x) => n + (x.rows ?? 0), 0) } : s);
    const parts = f.parts + a.items.length, chars = f.chars + add;
    await ctx.db.patch(f._id, { next: sid, parts, chars, ...(f.kind === "table" ? { bytes: (f.bytes ?? 0) + bytes } : {}), sheets });
    return { sections: parts, chars };
  },
});

/** The last piece is in: a table's columns are written, and the file opens. */
export const fileFinish = internalMutation({
  args: { space: v.string(), brain: v.string(), ver: v.number(), cols: v.optional(v.array(v.any())) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const f = await fileOf(ctx, a.brain);
    if (!f || f.ver !== a.ver) throw new Error("this file was replaced: start it again");
    if (!f.parts) throw new Error("the file gave nothing to read");
    const sheets = f.sheets.map((s: any, i: number) => ({ ...s, cols: (a.cols?.[i] as Col[] | undefined) ?? s.cols ?? [] }));
    await ctx.db.patch(f._id, { status: "ready", sheets, at: Date.now() });
    return { sections: f.parts, chars: f.chars };
  },
});

/* ---------------- the thread ---------------- */

/** One exchange added to the thread. Only the last 10 stay. */
export const threadPush = internalMutation({
  args: { space: v.string(), brain: v.string(), turn: v.any() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const row = await ctx.db.query("projectThreads").withIndex("by_brain", (q: any) => q.eq("brain", a.brain)).first();
    const turn = { ...a.turn, id: a.turn?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() };
    const turns = [...(row?.turns ?? []), turn].slice(-THREAD_KEEP);
    if (row) await ctx.db.patch(row._id, { turns, updated: Date.now() });
    else await ctx.db.insert("projectThreads", { brain: a.brain, turns, updated: Date.now() });
    return turn;
  },
});

/** A mark on one exchange: the project kept it in memory, or a change from it was applied. */
export const threadMark = internalMutation({
  args: { space: v.string(), brain: v.string(), id: v.string(), mark: v.any() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const row = await ctx.db.query("projectThreads").withIndex("by_brain", (q: any) => q.eq("brain", a.brain)).first();
    const turn = row?.turns.find((t: any) => t.id === a.id);
    if (!row || !turn) return null;
    await ctx.db.patch(row._id, { turns: row.turns.map((t: any) => t.id === a.id ? { ...t, ...a.mark } : t) });
    return turn;
  },
});

/** One exchange of the thread, by id. */
export const threadTurn = internalQuery({
  args: { space: v.string(), brain: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const row = await ctx.db.query("projectThreads").withIndex("by_brain", (q: any) => q.eq("brain", a.brain)).first();
    return row?.turns.find((t: any) => t.id === a.id) ?? null;
  },
});

/** One thing the project remembers, forgotten: its concept, card and meaning. */
export const memoryForget = internalMutation({
  args: { space: v.string(), brain: v.string(), slug: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const c = await ctx.db.query("concepts").withIndex("by_brain_slug", (q: any) => q.eq("brain", a.brain).eq("slug", a.slug)).unique();
    if (!c) return { ok: false };
    for (const card of await ctx.db.query("cards").withIndex("by_cid", (q: any) => q.eq("cid", c._id)).collect()) await ctx.db.delete(card._id);
    for (const vec of await ctx.db.query("vectors").withIndex("by_cid", (q: any) => q.eq("cid", c._id)).collect()) await ctx.db.delete(vec._id);
    await ctx.db.delete(c._id);
    return { ok: true };
  },
});

/* ---------------- changes to the file ---------------- */

/** A change the model proposed, as written: checked in `check`, never trusted. */
export type Op = { op: string; sid?: number; after?: number; find?: string; with?: string; text?: string; title?: string;
  sheet?: number; row?: number; rows?: any; col?: string | number; value?: unknown; values?: Record<string, unknown>;
  name?: string; columns?: string[] };

const short = (t: string, n = 280) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "..." : s; };

/**
 * The proposed changes checked against the file as it is now. A change that
 * cannot hold is left out and says why; the rest are returned as they would
 * apply, each with the words before and after for the app to show.
 */
async function check(ctx: any, brain: string, raw: any[]) {
  const f = await fileOf(ctx, brain);
  if (!f || f.status !== "ready") return { ops: [] as Op[], preview: [] as any[], bad: ["there is no file to change yet"] };
  const cards = await cardsOf(ctx, brain);
  const textOf = async (sid: number) => (await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", brain).eq("sid", sid)).first())?.text as string | undefined;
  const ops: Op[] = [], preview: any[] = [], bad: string[] = [];
  const touched = new Set<number>();
  let chars = 0;
  const reject = (why: string) => { bad.push(why); };
  const pending = new Map<number, string>();   // a section changed twice in one go reads the first change
  /* A sheet built whole in this change takes no other change in it. */
  const rebuilt = new Set<number>();
  const sheetOf = (o: any) => Math.max(0, Math.min(f.sheets.length - 1, Number(o?.sheet ?? 1) - 1 || 0));
  if (f.kind === "table") for (const o of Array.isArray(raw) ? raw.slice(0, MAX_OPS) : []) if (String(o?.op ?? "").toLowerCase() === "table") rebuilt.add(sheetOf(o));
  for (const o of (Array.isArray(raw) ? raw : []).slice(0, MAX_OPS)) {
    const kind = String(o?.op ?? "").toLowerCase();
    const words = String(o?.with ?? o?.text ?? "");
    chars += words.length + String(o?.find ?? "").length + (kind === "table" && Array.isArray(o?.rows) ? o.rows.reduce((n: number, r: any) => n + (Array.isArray(r) ? r.join("").length : 0), 0) : 0);
    if (chars > EDIT_CHARS) { reject("that is more words than one change carries"); break; }
    if (f.kind !== "table") {
      const card = (sid: any) => cards.find((c: any) => c.sid === Number(sid) && c.sheet === 0);
      if (kind === "replace") {
        const c = card(o.sid), t = c ? (pending.get(c.sid) ?? await textOf(c.sid)) : undefined;
        if (!c || t == null) { reject(`section ${o?.sid} is not in the file`); continue; }
        const r = replaceOnce(t, String(o.find ?? ""), String(o.with ?? ""));
        if ("error" in r) { reject(`In "${c.title}": ${r.error}`); continue; }
        if (r.text.length > SECTION_MAX) { reject(`"${c.title}" would grow past ${SECTION_MAX} characters`); continue; }
        touched.add(c.sid); pending.set(c.sid, r.text);
        ops.push({ op: "replace", sid: c.sid, find: String(o.find), with: String(o.with ?? "") });
        preview.push({ label: `In "${c.title}"`, before: short(o.find), after: short(o.with ?? "") });
      } else if (kind === "rewrite") {
        const c = card(o.sid), t = c ? (pending.get(c.sid) ?? await textOf(c.sid)) : undefined;
        const text = String(o.text ?? "").trim();
        if (!c || t == null) { reject(`section ${o?.sid} is not in the file`); continue; }
        if (!text || text.length > SECTION_MAX) { reject(`"${c.title}": the new text is empty or longer than ${SECTION_MAX} characters`); continue; }
        touched.add(c.sid); pending.set(c.sid, text);
        ops.push({ op: "rewrite", sid: c.sid, text });
        preview.push({ label: `Rewrite "${c.title}"`, before: short(t), after: short(text) });
      } else if (kind === "insert") {
        const after = Number(o.after ?? 0);
        const c = after ? card(after) : null;
        const text = String(o.text ?? "").trim();
        if (after && !c) { reject(`section ${after} is not in the file`); continue; }
        if (!text || text.length > SECTION_MAX) { reject("a new section needs words, up to " + SECTION_MAX + " characters"); continue; }
        if (cards.length + ops.filter(x => x.op === "insert").length >= MAX_SECTIONS) { reject("the file holds as many sections as a project reads"); continue; }
        ops.push({ op: "insert", after, title: short(String(o.title ?? ""), 90), text });
        preview.push({ label: c ? `New section after "${c.title}"` : "New section at the start", before: "", after: short(text) });
      } else if (kind === "remove") {
        const c = card(o.sid), t = c ? (pending.get(c.sid) ?? await textOf(c.sid)) : undefined;
        if (!c || t == null) { reject(`section ${o?.sid} is not in the file`); continue; }
        touched.add(c.sid);
        ops.push({ op: "remove", sid: c.sid });
        preview.push({ label: `Remove "${c.title}"`, before: short(t), after: "" });
      } else reject(`"${kind}" is not a change a document takes`);
    } else {
      const si = sheetOf(o);
      const sheet = f.sheets[si], cols: Col[] = sheet.cols ?? [];
      const sname = f.sheets.length > 1 ? ` (${sheet.name})` : "";
      if (kind === "table") {
        const names = colNames((Array.isArray(o.columns) ? o.columns : []).map((x: any) => String(x ?? "").slice(0, 60)).slice(0, 60));
        if (!names.length || names.every((n: string) => /^Column \d+$/.test(n))) { reject("a table needs column names"); continue; }
        const rows: string[][] = (Array.isArray(o.rows) ? o.rows : []).slice(0, TABLE_OP_ROWS)
          .map((r: any) => Array.from({ length: names.length }, (_, i) => String((Array.isArray(r) ? r[i] : "") ?? "").slice(0, 2000)))
          .filter((r: string[]) => r.some(c => c.trim()));
        const name = short(String(o.name ?? ""), 60);
        ops.push({ op: "table", sheet: si + 1, ...(name ? { name } : {}), columns: names, rows });
        preview.push({ label: `${sheet.rows ? "Rebuild" : "New"} table${sname}`, before: sheet.rows ? `${sheet.rows} rows` : "",
          after: `${names.length} column${names.length === 1 ? "" : "s"}: ${short(names.join(", "), 120)}. ${rows.length} row${rows.length === 1 ? "" : "s"}.` });
        continue;
      }
      if (rebuilt.has(si)) { reject("that sheet is built whole in this change: it takes no other change in it"); continue; }
      if (kind === "set") {
        const row = Number(o.row), ci = colIndex(cols, o.col);
        const got = await rowsAt(ctx, brain, si, [row]);
        if (!got.has(row)) { reject(`row ${o?.row} is not in the table`); continue; }
        if (ci < 0) { reject(`there is no column "${o?.col}"`); continue; }
        const at = got.get(row)!;
        touched.add(at.sid);
        ops.push({ op: "set", sheet: si + 1, row, col: cols[ci].name, value: String(o.value ?? "") });
        preview.push({ label: `Row ${row}, ${cols[ci].name}${sname}`, before: short(at.cells[ci] ?? "", 120) || "(empty)", after: short(String(o.value ?? ""), 120) || "(empty)" });
      } else if (kind === "delete") {
        const rows = [...new Set<number>((Array.isArray(o.rows) ? o.rows : [o.row]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 50);
        const got = await rowsAt(ctx, brain, si, rows);
        const real = rows.filter(n => got.has(n));
        if (!real.length) { reject("those rows are not in the table"); continue; }
        for (const n of real) touched.add(got.get(n)!.sid);
        ops.push({ op: "delete", sheet: si + 1, rows: real });
        for (const n of real.slice(0, 8)) preview.push({ label: `Delete row ${n}${sname}`, before: short(got.get(n)!.cells.join(" | "), 160), after: "" });
        if (real.length > 8) preview.push({ label: `and ${real.length - 8} more rows${sname}`, before: "", after: "" });
      } else if (kind === "add") {
        const after = o.after == null ? 0 : Number(o.after);
        const row = rowFrom(cols, (o.values && typeof o.values === "object") ? o.values as Record<string, unknown> : {});
        if (!row.some(c => c)) { reject("a new row needs values"); continue; }
        if (!(sheet.rows > 0)) { reject("that sheet has no rows yet: build it with a table change"); continue; }
        if (after) { const got = await rowsAt(ctx, brain, si, [after]); if (!got.has(after)) { reject(`row ${after} is not in the table`); continue; } touched.add(got.get(after)!.sid); }
        ops.push({ op: "add", sheet: si + 1, after, values: Object.fromEntries(cols.map((c, i) => [c.name, row[i]]).filter(([, x]) => x)) });
        preview.push({ label: `New row ${after ? `after row ${after}` : "at the end"}${sname}`, before: "", after: short(row.join(" | "), 160) });
      } else reject(`"${kind}" is not a change a table takes`);
    }
  }
  if (touched.size > EDIT_SECTIONS) return { ops: [], preview: [], bad: [`that change touches more than ${EDIT_SECTIONS} places at once. Ask for it in parts.`] };
  return { ops, preview, bad };
}

/** The changes a chat answer proposed, checked against the file and kept to apply. */
export const editPropose = internalMutation({
  args: { space: v.string(), brain: v.string(), ops: v.array(v.any()) },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const r = await check(ctx, a.brain, a.ops);
    if (!r.ops.length) return { id: null, preview: [], bad: r.bad };
    const id = await ctx.db.insert("projectEdits", { brain: a.brain, at: Date.now(), status: "open", ops: r.ops, preview: r.preview });
    const all = (await ctx.db.query("projectEdits").withIndex("by_brain_at", (q: any) => q.eq("brain", a.brain)).collect()).sort((x: any, y: any) => y.at - x.at);
    for (const old of all.slice(EDITS_KEEP)) await ctx.db.delete(old._id);
    return { id: String(id), preview: r.preview, bad: r.bad };
  },
});

const editOf = async (ctx: any, brain: string, id: string) => {
  /* An id of another table, or none at all, is no change. */
  const nid = ctx.db.normalizeId("projectEdits", id);
  const e = nid ? await ctx.db.get(nid) : null;
  return e && e.brain === brain ? e : null;
};

/** A proposed change turned down. */
export const editDismiss = internalMutation({
  args: { space: v.string(), brain: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const e = await editOf(ctx, a.brain, a.id);
    if (!e || e.status !== "open") return { ok: false };
    await ctx.db.patch(e._id, { status: "dismissed" });
    return { ok: true };
  },
});

/** The characters a file holds, from its cards: what decides whether a question reads it whole. */
const sizeOf = (cards: any[]) => cards.reduce((n: number, c: any) => n + (c.chars ?? 0), 0);

/** A small sheet's column totals worked out again after a change, so the grid and the questions see what it holds now. */
async function recount(ctx: any, brain: string, si: number) {
  const f = await fileOf(ctx, brain);
  const names = (f?.sheets?.[si]?.cols ?? []).map((c: Col) => c.name);
  const cards = (await cardsOf(ctx, brain)).filter((c: any) => c.sheet === si);
  if (!f || !names.length || sizeOf(cards) > RECOUNT_CHARS) return;
  const rows: string[][] = [];
  for (const c of cards) rows.push(...parseCsv((await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", brain).eq("sid", c.sid)).first())?.text ?? ""));
  await ctx.db.patch(f._id, { sheets: f.sheets.map((s: any, i: number) => i === si ? { ...s, cols: columnsOf(names, rows) } : s) });
}

/** One section's card and words, read and written back whole. */
async function sectionRow(ctx: any, brain: string, sid: number) {
  const card = await ctx.db.query("projectCards").withIndex("by_brain_sid", (q: any) => q.eq("brain", brain).eq("sid", sid)).first();
  const body = await ctx.db.query("projectSections").withIndex("by_brain_sid", (q: any) => q.eq("brain", brain).eq("sid", sid)).first();
  return { card, body };
}

/**
 * A change applied, whole or not at all. It is checked again against the file
 * as it is now, so a file that moved since the proposal refuses it. What it
 * replaced is kept on the change, so Undo puts it back.
 */
export const editApply = internalMutation({
  args: { space: v.string(), brain: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const e = await editOf(ctx, a.brain, a.id);
    if (!e) throw new Error("that change is gone");
    if (e.status !== "open") throw new Error(`that change is ${e.status}`);
    const f = await fileOf(ctx, a.brain);
    const r = await check(ctx, a.brain, e.ops);
    if (!f || r.ops.length !== e.ops.length || r.bad.length) throw new Error("the file changed since this was proposed. Ask again.");
    const before: any[] = [];
    const save = (rows: any) => { if (!before.some(x => x.sid === rows.sid)) before.push(rows); };
    const wrote = new Map<number, string>();
    const touch = async (sid: number) => {
      const { card, body } = await sectionRow(ctx, a.brain, sid);
      if (!card || !body) throw new Error("a section is gone");
      save({ sid, text: body.text, title: card.title, summary: card.summary, rows: card.rows ?? null, ord: card.ord, sheet: card.sheet });
      return { card, body };
    };
    if (f.kind !== "table") {
      for (const o of e.ops as Op[]) {
        if (o.op === "replace" || o.op === "rewrite") {
          const { card, body } = await touch(o.sid!);
          const now = wrote.get(o.sid!) ?? body.text;
          const next = o.op === "rewrite" ? String(o.text) : (replaceOnce(now, String(o.find), String(o.with)) as any).text;
          if (next == null) throw new Error("the file changed since this was proposed. Ask again.");
          await ctx.db.patch(body._id, { text: next });
          await ctx.db.patch(card._id, { chars: next.length });
          wrote.set(o.sid!, next);
        } else if (o.op === "remove") {
          const { card, body } = await touch(o.sid!);
          await ctx.db.delete(card._id); await ctx.db.delete(body._id);
          before.find(x => x.sid === o.sid)!.removed = true;
        } else if (o.op === "insert") {
          const all = await cardsOf(ctx, a.brain);
          const i = o.after ? all.findIndex((c: any) => c.sid === o.after) : -1;
          const prev = i >= 0 ? all[i].ord : (all[0]?.ord ?? 1) - 1;
          const nextOrd = i >= 0 ? (all[i + 1]?.ord ?? prev + 2) : (all[0]?.ord ?? 1);
          const now = await fileOf(ctx, a.brain);
          const sid = now.next;
          const text = String(o.text);
          const first = text.split("\n").map(l => l.trim()).find(Boolean) ?? "";
          await ctx.db.insert("projectCards", { brain: a.brain, sid, ord: (prev + nextOrd) / 2, sheet: 0,
            title: (o.title || first.replace(/^#+\s*/, "")).slice(0, 90) || "New section", summary: short(text, 160), chars: text.length });
          await ctx.db.insert("projectSections", { brain: a.brain, sid, text });
          await ctx.db.patch(now._id, { next: sid + 1, chars: now.chars + text.length });
          before.push({ sid, inserted: true, wrote: fnv(text) });
        }
      }
    } else {
      /* A table: every change names rows as the table is now. They are noted
         first and the blocks rebuilt once, so a row deleted above never shifts
         where another change lands. */
      const bySheet = new Map<number, Op[]>();
      for (const o of e.ops as Op[]) bySheet.set((o.sheet ?? 1) - 1, [...(bySheet.get((o.sheet ?? 1) - 1) ?? []), o]);
      for (const [si, ops] of bySheet) {
        const sheet = f.sheets[si], cols: Col[] = sheet.cols ?? [];
        const built = ops.find(x => x.op === "table");
        if (built) {
          /* The sheet is built whole: what it held goes, and comes back on Undo with its columns. */
          const rows = (built.rows ?? []) as string[][], names = built.columns ?? [];
          for (const c of (await cardsOf(ctx, a.brain)).filter((x: any) => x.sheet === si)) {
            const { card, body } = await touch(c.sid);
            await ctx.db.delete(card._id); await ctx.db.delete(body._id);
            before.find(x => x.sid === c.sid)!.removed = true;
          }
          before.push({ meta: true, si, sheet });
          const now = await fileOf(ctx, a.brain);
          let sid = now.next;
          for (const b of blocksOf(rows)) {
            const text = csvOf(b);
            await ctx.db.insert("projectCards", { brain: a.brain, sid, ord: sid, sheet: si, title: "Rows", summary: "", chars: text.length, rows: b.length });
            await ctx.db.insert("projectSections", { brain: a.brain, sid, text });
            before.push({ sid, inserted: true, wrote: fnv(text) });
            sid++;
          }
          const mine = (await cardsOf(ctx, a.brain)).filter((x: any) => x.sheet === si);
          await ctx.db.patch(now._id, { next: sid, sheets: now.sheets.map((s: any, i: number) => i === si
            ? { ...s, name: built.name || s.name, header: names, cols: columnsOf(names, rows), rows: mine.reduce((n: number, x: any) => n + (x.rows ?? 0), 0) } : s) });
          continue;
        }
        const cards = (await cardsOf(ctx, a.brain)).filter((c: any) => c.sheet === si);
        const starts: number[] = []; let total = 0;
        for (const c of cards) { starts.push(total); total += c.rows ?? 0; }
        const blocks = new Map<number, string[][]>();
        const dead = new Map<number, Set<number>>(), adds = new Map<number, Map<number, string[][]>>();
        const load = async (k: number) => {
          if (!blocks.has(k)) { const { body } = await touch(cards[k].sid); blocks.set(k, parseCsv(body.text)); dead.set(k, new Set()); adds.set(k, new Map()); }
          return blocks.get(k)!;
        };
        /* The block a row is in, and its place there. */
        const where = (n: number): [number, number] => { let k = starts.length - 1; while (k > 0 && starts[k] >= n) k--; return [k, n - starts[k] - 1]; };
        const stale = () => new Error("the file changed since this was proposed. Ask again.");
        for (const o of ops.filter(x => x.op === "set")) {
          const [k, i] = where(o.row!), rows = await load(k), ci = colIndex(cols, o.col);
          if (!rows[i] || ci < 0) throw stale();
          rows[i][ci] = String(o.value ?? "");
        }
        for (const o of ops.filter(x => x.op === "delete")) {
          for (const n of o.rows!) { const [k, i] = where(n); await load(k); if (n > total) throw stale(); dead.get(k)!.add(i); }
        }
        for (const o of ops.filter(x => x.op === "add")) {
          const [k, i] = where(o.after || total);
          await load(k);
          const at = adds.get(k)!;
          at.set(i, [...(at.get(i) ?? []), rowFrom(cols, o.values ?? {})]);
        }
        for (const [k, rows] of blocks) {
          const out: string[][] = [];
          rows.forEach((r, i) => { if (!dead.get(k)!.has(i)) out.push(r); for (const x of adds.get(k)!.get(i) ?? []) out.push(x); });
          const { card, body } = await sectionRow(ctx, a.brain, cards[k].sid);
          if (!out.length) { await ctx.db.delete(card._id); await ctx.db.delete(body._id); before.find(x => x.sid === cards[k].sid)!.removed = true; continue; }
          const text = csvOf(out);
          await ctx.db.patch(body._id, { text });
          await ctx.db.patch(card._id, { chars: text.length, rows: out.length });
          wrote.set(cards[k].sid, text);
        }
        const rowsNow = (await cardsOf(ctx, a.brain)).filter((c: any) => c.sheet === si).reduce((n: number, c: any) => n + (c.rows ?? 0), 0);
        const fresh = await fileOf(ctx, a.brain);
        await ctx.db.patch(fresh._id, { sheets: fresh.sheets.map((s: any, i: number) => i === si ? { ...s, rows: rowsNow } : s) });
        await recount(ctx, a.brain, si);
      }
    }
    for (const b of before) if (wrote.has(b.sid)) b.wrote = fnv(wrote.get(b.sid)!);
    const fresh = await fileOf(ctx, a.brain);
    const all = await cardsOf(ctx, a.brain);
    await ctx.db.patch(fresh._id, { at: Date.now(), parts: all.length, chars: sizeOf(all) });
    await ctx.db.patch(e._id, { status: "applied", before });
    return { ok: true, sections: before.filter(x => x.sid != null).map(x => x.sid) };
  },
});

/** A change put back, when the sections it wrote are as it left them. */
export const editUndo = internalMutation({
  args: { space: v.string(), brain: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const e = await editOf(ctx, a.brain, a.id);
    if (!e || e.status !== "applied") throw new Error("that change is not applied");
    for (const b of e.before ?? []) {
      if (b.meta || b.removed) continue;
      const { body } = await sectionRow(ctx, a.brain, b.sid);
      if (body && b.wrote && fnv(body.text) !== b.wrote) throw new Error("that part of the file changed since. Undo it by asking for the old words.");
    }
    const metas = (e.before ?? []).filter((b: any) => b.meta);
    for (const b of e.before ?? []) {
      if (b.meta) continue;
      const { card, body } = await sectionRow(ctx, a.brain, b.sid);
      if (b.inserted) { if (card) await ctx.db.delete(card._id); if (body) await ctx.db.delete(body._id); continue; }
      if (b.removed) {
        await ctx.db.insert("projectCards", { brain: a.brain, sid: b.sid, ord: b.ord, sheet: b.sheet, title: b.title, summary: b.summary, chars: b.text.length, ...(b.rows != null ? { rows: b.rows } : {}) });
        await ctx.db.insert("projectSections", { brain: a.brain, sid: b.sid, text: b.text });
        continue;
      }
      if (body) await ctx.db.patch(body._id, { text: b.text });
      if (card) await ctx.db.patch(card._id, { chars: b.text.length, title: b.title, summary: b.summary, ...(b.rows != null ? { rows: b.rows } : {}) });
    }
    const f = await fileOf(ctx, a.brain);
    const cards = await cardsOf(ctx, a.brain);
    await ctx.db.patch(f._id, { parts: cards.length, chars: sizeOf(cards), at: Date.now(),
      sheets: f.sheets.map((s: any, i: number) => {
        /* A sheet that was built whole gets back its name, columns and totals. */
        const was = metas.find((m: any) => m.si === i);
        const back = was ? was.sheet : s;
        return f.kind === "table" ? { ...back, rows: cards.filter((c: any) => c.sheet === i).reduce((n: number, c: any) => n + (c.rows ?? 0), 0) } : s;
      }) });
    if (f.kind === "table") for (let i = 0; i < f.sheets.length; i++) if (!metas.some((m: any) => m.si === i)) await recount(ctx, a.brain, i);
    await ctx.db.patch(e._id, { status: "undone" });
    return { ok: true };
  },
});

/** A file's name, kind and sheets, to name a download. */
export const fileMeta = internalQuery({
  args: { space: v.string(), brain: v.string() },
  handler: async (ctx, a) => {
    await need(ctx, a.space, a.brain);
    const f = await fileOf(ctx, a.brain);
    return f ? { name: f.name, kind: f.kind, made: !!f.made, sheets: f.sheets.map((s: any) => ({ name: s.name, header: s.header ?? [] })) } : null;
  },
});
