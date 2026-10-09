/**
 * Projects: a file or a table of any size, cut in pieces and searched.
 *
 * The pure pieces run first: sections, CSV, numbers, the filter a table
 * question becomes, the changes a chat may make. Then the writes, through the
 * real store against an in-memory table store, and the chat itself, with a
 * fake model so it runs offline and costs nothing.
 *
 *     node scripts/check-project.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-project-"));
mkdirSync(join(dir, "_generated"));
for (const f of readdirSync(join(ROOT, "convex")).filter(f => f.endsWith(".ts"))) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
writeFileSync(join(dir, "_generated/server.ts"),
  "export const internalQuery = (d: any) => d;\nexport const internalMutation = (d: any) => d;\nexport const internalAction = (d: any) => d;\n" +
  "export const httpAction = (f: any) => f;\n");
const build = async name => {
  await esbuild.build({ entryPoints: [join(dir, name + ".ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
    platform: "node", outfile: join(dir, name + ".mjs"), logLevel: "silent" });
  return import(pathToFileURL(join(dir, name + ".mjs")).href);
};

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sheet = await build("sheet");

/* ---- numbers ---- */
{
  const N = sheet.numeric;
  check("1,490 reads as 1490", N("1,490") === 1490);
  check("€1 490 reads as 1490", N("€1 490") === 1490);
  check("1.490,50 reads as 1490.5", N("1.490,50") === 1490.5);
  check("1,490.50 reads as 1490.5", N("1,490.50") === 1490.5);
  check("12,5 reads as 12.5", N("12,5") === 12.5);
  check("12% reads as 12", N("12%") === 12);
  check("(300) reads as -300", N("(300)") === -300);
  check("-5 reads as -5", N("-5") === -5);
  check("1.234.567 reads as 1234567", N("1.234.567") === 1234567);
  check("a word, a date and an empty cell are not numbers", N("Yes") === null && N("2026-10-09") === null && N("") === null && N("10:30") === null);
  check("a number is itself", N(42) === 42 && N(NaN) === null);
}

/* ---- csv ---- */
{
  const rows = [["Program", "Note"], ["Craft, Ship", 'He said "go"'], ["Two\nlines", ""]];
  const text = sheet.csvOf(rows);
  check("a cell with a comma, a quote or a line break is quoted", text.includes('"Craft, Ship"') && text.includes('"He said ""go"""') && text.includes('"Two\nlines"'));
  check("csv reads back as written", same(sheet.parseCsv(text), rows), JSON.stringify(sheet.parseCsv(text)));
  check("windows line ends read as one break", same(sheet.parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]));
  const many = Array.from({ length: 900 }, (_, i) => [`Program ${i}`, String(i * 10), "Yes"]);
  const blocks = sheet.blocksOf(many, 4000);
  check("rows go in blocks that stay under the limit", blocks.length > 3 && blocks.every(b => sheet.csvOf(b).length <= 4000), blocks.map(b => sheet.csvOf(b).length).join(","));
  check("no row is lost or repeated across blocks", blocks.flat().length === 900 && blocks.flat()[899][0] === "Program 899");
  check("one row longer than a block still goes in", sheet.blocksOf([["x".repeat(500)]], 100).length === 1);
}

/* ---- columns ---- */
{
  const header = sheet.colNames(["Program", "", "Price", "price", "Plan"]);
  check("an empty header is Column n and a repeat is numbered", same(header, ["Program", "Column 2", "Price", "price 2", "Plan"]), JSON.stringify(header));
  const rows = [["Pixel Forge", "x", "1,350", "9", "Yes"], ["Ship It Camp", "y", "1,090", "8", "No"], ["Craft", "z", "1,250", "7", "Yes"], ["Free", "", "", "", ""]];
  const cols = sheet.columnsOf(header, rows);
  check("a column of numbers is read as numbers with its totals", cols[2].kind === "num" && cols[2].sum === 3690 && cols[2].min === 1090 && cols[2].max === 1350 && cols[2].avg === 1230, JSON.stringify(cols[2]));
  check("an empty cell is not counted as a zero", cols[2].filled === 3);
  check("a text column with few words lists them", same(cols[4].values, ["Yes", "No"]) && cols[4].kind === "text", JSON.stringify(cols[4]));
  check("a text column with many words lists none", sheet.columnsOf(["n"], Array.from({ length: 30 }, (_, i) => ["w" + i]))[0].values === undefined);
  check("a column line says its totals", /Price \(number, 3 filled\): total 3,690, average 1,230, lowest 1,090, highest 1,350/.test(sheet.colLine({ ...cols[2], name: "Price" })), sheet.colLine({ ...cols[2], name: "Price" }));
}

/* ---- a question about a table ---- */
{
  const names = ["Program", "Team size", "Weeks", "Price", "Plan"];
  const all = [["Game Jam Pro", 2, 4, "1,200", "Yes"], ["Indie Sprint", 1, 3, "690", "No"], ["Studio Lab", 4, 6, "2,400", "Yes"], ["Pixel Forge", 3, 4, "1,350", "Yes"],
    ["Ship It Camp", 3, 4, "1,090", "No"], ["Level Up Weeks", 2, 5, "990", "Yes"], ["Dev Duo", 2, 4, "1,490", "No"], ["Prototype Club", 1, 2, "490", "No"],
    ["Launch Pad Games", 5, 8, "2,100", "Yes"], ["Craft & Ship", 3, 4, "1,250", "Yes"]].map(r => r.map(String));
  const cols = sheet.columnsOf(names, all);
  const sheets = [{ name: "Programs", cols, rows: all.length }];
  const blocks = sheet.blocksOf(all, 120).map(b => sheet.csvOf(b));
  check("a small block size gives several blocks", blocks.length > 2);
  const run = raw => { const q = sheet.readQuery(raw, sheets); return q ? sheet.runQuery(blocks, cols, q) : null; };

  const r1 = run({ where: [{ col: "Price", op: ">", value: 1200 }, { col: "Plan", op: "=", value: "Yes" }] });
  check("price above 1,200 with a payment plan: 4 rows, found across blocks", r1.matched === 4 && same(r1.rows.map(f => f.n), [3, 4, 9, 10]), JSON.stringify(r1.rows.map(f => f.n)));
  check("each row keeps its number in the whole sheet", r1.rows[0].cells[0] === "Studio Lab" && r1.rows[3].cells[0] === "Craft & Ship");
  const r2 = run({ where: [{ col: "Team size", op: "=", value: 3 }, { col: "Weeks", op: "=", value: 4 }], calc: [{ fn: "avg", col: "Price" }, { fn: "count" }] });
  check("teams of 3 over 4 weeks: 3 rows, average price 1,230", r2.matched === 3 && r2.calc[0].value === 1230 && r2.calc[1].value === 3, JSON.stringify(r2.calc));
  const r3 = run({ calc: [{ fn: "sum", col: "Price" }, { fn: "min", col: "Price" }, { fn: "max", col: "Price" }] });
  check("totals over every row: 13,050, 490 and 2,400", r3.calc[0].value === 13050 && r3.calc[1].value === 490 && r3.calc[2].value === 2400 && r3.matched === 10, JSON.stringify(r3.calc));
  const r4 = run({ calc: [{ fn: "avg", col: "Price", by: "Plan" }] });
  check("an average by group", same(r4.calc[0].groups.map(g => g.key), ["Yes", "No"]) && r4.calc[0].groups[0].value === 1548.333333 && r4.calc[0].groups[1].value === 940, JSON.stringify(r4.calc[0].groups));
  const r5 = run({ where: [{ col: "Plan", op: "=", value: "Yes" }], sort: { col: "Price", desc: true }, limit: 2, show: ["Program"] });
  check("sorted and cut: the two dearest with a plan, the sort column shown", r5.rows.length === 2 && r5.matched === 6 && r5.rows[0].cells[0] === "Studio Lab" && r5.rows[1].cells[0] === "Launch Pad Games", JSON.stringify(r5));
  const r6 = run({ where: [{ col: "Program", op: "has", value: "ship" }] });
  check("has matches words in any case", r6.matched === 2, JSON.stringify(r6.rows));
  const r7 = run({ where: [{ col: "Program", op: "in", value: ["Dev Duo", "prototype club"] }] });
  check("in matches any of a list", r7.matched === 2);
  const r8 = run({ where: [{ col: "Plan", op: "=", value: "Yes" }, { col: "Weeks", op: ">=", value: 6 }], any: true });
  check("any makes the conditions alternatives: 6 with a plan, plus none more at 6 weeks or more", r8.matched === 6, String(r8.matched));
  check("a column the sheet lacks is dropped, not fatal", sheet.readQuery({ where: [{ col: "Nonsense", op: "=", value: 1 }, { col: "Plan", op: "=", value: "No" }] }, sheets).where.length === 1);
  check("a total over a text column is dropped", sheet.readQuery({ calc: [{ fn: "sum", col: "Plan" }] }, sheets).calc.length === 0);
  check("an unknown operator is dropped", sheet.readQuery({ where: [{ col: "Price", op: "~", value: 1 }] }, sheets).where.length === 0);
  check("no query at all is null", sheet.readQuery(null, sheets) === null && sheet.readQuery("x", sheets) === null);
  check("a limit never passes 100", sheet.readQuery({ limit: 5000 }, sheets).limit === 100);
  const text = sheet.resultText(r1, cols, "Programs", 10);
  check("a result reads as a table with row numbers", /^SHEET "Programs": 4 of 10 rows match\.\nrow \| Program \| Team size/.test(text) && text.includes("3 | Studio Lab | 4 | 6 | 2,400 | Yes"), text);
}

/* ---- a document, in sections ---- */
{
  const para = n => `Paragraph ${n}. ` + "word ".repeat(120).trim() + ".";
  const text = Array.from({ length: 60 }, (_, i) => para(i)).join("\n\n");
  const parts = sheet.splitDoc(text, 3000);
  check("a long text is cut in sections under the limit", parts.length > 5 && parts.every(p => p.text.length <= 3000), parts.map(p => p.text.length).join(","));
  check("sections joined give the text back", parts.map(p => p.text).join("\n\n") === text);
  const headed = "# Goal\n\n" + para(1) + "\n\n" + para(2) + "\n\n## Offer\n\n" + para(3) + "\n\n" + para(4) + "\n\n## Timeline\n\nshort";
  const hp = sheet.splitDoc(headed, 12000);
  check("a heading opens a section once the one before holds enough", hp.length === 1, String(hp.length));
  const two = sheet.splitDoc("# Goal\n\n" + "a".repeat(2600) + "\n\n## Offer\n\nOffer text here", 12000);
  check("a heading after enough text starts a new section titled by it", two.length === 2 && two[0].title === "Goal" && two[1].title === "Offer", JSON.stringify(two.map(p => p.title)));
  check("one paragraph longer than the limit is cut", sheet.splitDoc("x".repeat(7000), 3000).length === 3);
  check("nothing in, nothing out", sheet.splitDoc("  \n\n  ", 3000).length === 0);
  const pg = (n, ...paras) => `[[p. ${n}]]\n` + paras.join("\n\n");
  const w = n => "word ".repeat(n).trim() + ".";
  const pdf = [pg(1, w(200)), pg(2, w(280), w(280)), pg(3, w(200))].join("\n\n");
  const pp = sheet.splitDoc(pdf, 3000);
  check("a PDF section is titled by its pages", pp.length === 2 && pp[0].title === "Pages 1 to 2", JSON.stringify(pp.map(p => p.title)));
  check("the page markers stay in the text so an answer can name a page", pp.map(p => p.text).join("\n\n") === pdf);
  check("a section that opens inside a page starts on that page", pp[1].title === "Pages 2 to 3", JSON.stringify(pp.map(p => p.title)));
  check("the opening of a section is plain words", sheet.openingOf("# Goal\n\n**Fill** 200 seats.\n[[p. 2]]") === "Goal Fill 200 seats.", sheet.openingOf("# Goal\n\n**Fill** 200 seats.\n[[p. 2]]"));
  check("pages in a text are first and last", same(sheet.pagesIn("[[p. 4]]\nx\n[[p. 7]]\ny"), { from: 4, to: 7 }) && sheet.pagesIn("no markers") === null);
}

/* ---- a change to a document ---- */
{
  check("words standing once are replaced", sheet.replaceOnce("Team costs €1,490 a seat", "€1,490", "€1,290").text === "Team costs €1,290 a seat");
  check("words standing twice are refused", /more than once/.test(sheet.replaceOnce("a b a", "a", "c").error));
  check("words that are not there are refused", /not in the section/.test(sheet.replaceOnce("a b", "z", "c").error));
  const cols = sheet.columnsOf(["Program", "Price", "Plan"], [["a", "1", "x"]]);
  check("a row is filled by column name in the sheet's width", same(sheet.rowFrom(cols, { price: 1290, Program: "New" }), ["New", "1290", ""]));
  check("the download text drops page markers", sheet.downloadText(["[[p. 1]]\nHello", "[[p. 2]]\nWorld"]) === "Hello\n\nWorld\n");
}


/* ================= the writes, and the chat, against an in-memory store ================= */

const store = await build("store");
const projects = await build("projects");
const project = await build("project");
const space = await build("space");
process.env.OPENROUTER_API_KEY = "test-key";

function makeCtx() {
  const T = {};
  let id = 0;
  const rows = t => (T[t] ??= []);
  const query = t => {
    const conds = [];
    const api = {
      withIndex(_n, fn) { const q = { eq(f, v) { conds.push([f, v]); return q; } }; if (fn) fn(q); return api; },
      order(d) { api._desc = d === "desc"; return api; },
      async collect() { const all = rows(t).filter(r => conds.every(([f, v]) => r[f] === v)); return api._desc ? all.slice().reverse() : all; },
      async first() { return (await api.collect())[0] ?? null; },
      async unique() { const all = await api.collect(); if (all.length > 1) throw new Error("unique"); return all[0] ?? null; },
      async take(n) { return (await api.collect()).slice(0, n); },
      async paginate({ numItems, cursor }) {
        const all = await api.collect(), from = cursor ? Number(cursor) : 0;
        return { page: all.slice(from, from + numItems), isDone: from + numItems >= all.length, continueCursor: String(from + numItems) };
      },
    };
    return api;
  };
  const find = _id => Object.values(T).flat().find(r => r._id === _id);
  const db = {
    query,
    async get(_id) { return find(_id) ?? null; },
    normalizeId(t, _id) { return rows(t).some(r => r._id === _id) ? _id : null; },
    async insert(t, doc) { const r = { _id: `id${++id}`, ...doc }; rows(t).push(r); return r._id; },
    async patch(_id, doc) { Object.assign(find(_id), doc); },
    async replace(_id, doc) { const r = find(_id); for (const k of Object.keys(r)) if (k !== "_id") delete r[k]; Object.assign(r, doc); },
    async delete(_id) { for (const t in T) T[t] = T[t].filter(r => r._id !== _id); },
  };
  const mods = { store, projects };
  const call = (name, args) => { const [m, f] = name.split("."); if (!mods[m]?.[f]) throw new Error(`no ${name}`); return mods[m][f].handler({ db, runQuery: call, runMutation: call }, args); };
  return { T, db, ctx: { db, runQuery: call, runMutation: call } };
}

/* A model that answers by what it is asked, and keeps every prompt it was shown. */
const sent = [];
let reply = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (_u, opt) => {
  const body = JSON.parse(opt.body);
  const sys = String(body.messages[0].content), user = String(body.messages[body.messages.length - 1].content);
  sent.push({ sys, user, model: body.model });
  let out;
  if (/You write contents lines/.test(sys)) out = JSON.stringify({ title: "About " + user.split("SECTION\n")[1].split(/\s+/).slice(0, 2).join(" "), summary: "Covers " + user.split("SECTION\n")[1].split(/\s+/).slice(0, 5).join(" ") + "." });
  else if (/You route a project's questions/.test(sys)) out = JSON.stringify(reply.route ?? { intent: "ask", sections: [], query: null, folders: [], terms: [] });
  else if (/You route questions to the right entries/.test(sys)) out = JSON.stringify(reply.folders ?? { picks: [], terms: [] });
  else if (/You are the chat of a project/.test(sys)) out = typeof reply.answer === "function" ? reply.answer(user) : JSON.stringify(reply.answer ?? { reply: "ok", proposal: false, quotes: [], edits: [] });
  else if (/You file notes into a project's memory/.test(sys)) out = JSON.stringify(reply.keep ?? { notes: [] });
  else out = "{}";
  return Response.json({ choices: [{ message: { content: out }, finish_reason: "stop" }], usage: {} });
};
const last = what => [...sent].reverse().find(m => what.test(m.sys));

const SPACE = "octopus";
const para = (n, tag = "x") => `Paragraph ${n} ${tag}. ` + "word ".repeat(150).trim() + ".";
const longDoc = Array.from({ length: 70 }, (_, i) => para(i, i === 33 ? "PRICEMARK" : "plain")).join("\n\n");   // about 55,000 characters

/* ---- a project, a document of any size, read in pieces ---- */
const W = makeCtx();
const slugP = await W.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Launch plan" });
check("a project is a folder of type project, private, in its workspace", W.T.brains[0].type === "project" && W.T.brains[0].visibility === "private" && W.T.brains[0].space === SPACE && slugP === "launch-plan");
check("a second project with the same name is refused", /exists/.test(String(await W.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Launch plan" }).catch(e => e.message))));
check("a project belongs to its workspace alone", /not in this workspace/.test(String(await W.ctx.runQuery("projects.projectGet", { space: "squidgy", brain: slugP }).catch(e => e.message))));

const begin = await W.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: slugP, name: "brief.docx", kind: "doc", sheets: [{ name: "brief.docx" }] });
let page = 0;
const half = longDoc.indexOf("Paragraph 35 ");
const added1 = await project.addDocPiece(W.ctx, { space: SPACE, brain: slugP, ver: begin.ver, text: longDoc.slice(0, half), page });
const added2 = await project.addDocPiece(W.ctx, { space: SPACE, brain: slugP, ver: begin.ver, text: longDoc.slice(half), page });
check("a long document is cut in sections of at most 12,000 characters, piece after piece", added1.sections >= 2 && added2.sections > added1.sections && W.T.projectSections.every(x => x.text.length <= 12000), JSON.stringify([added1, added2]));
check("every section has a contents line from the model", W.T.projectCards.every(c => /^About /.test(c.title) && /^Covers /.test(c.summary)), JSON.stringify(W.T.projectCards[0]));
check("the words of the file are kept, none lost", W.T.projectSections.map(x => x.text).join("\n\n") === longDoc);
const fin = await project.finishFile(W.ctx, { space: SPACE, brain: slugP, ver: begin.ver });
let got = await W.ctx.runQuery("projects.projectGet", { space: SPACE, brain: slugP });
check("the file opens once the last piece is in", got.file.status === "ready" && got.file.sections === fin.sections && got.cards.length === fin.sections && got.file.chars === W.T.projectSections.reduce((n, x) => n + x.text.length, 0));
check("a stale version is refused", /replaced or finished/.test(String(await W.ctx.runMutation("projects.sectionAdd", { space: SPACE, brain: slugP, ver: begin.ver + 5, sheet: 0, items: [{ title: "x", summary: "", text: "y" }] }).catch(e => e.message))));
check("past 1,000 sections the file is refused with a way out", /1000 sections/.test(String(await (async () => {
  const w = makeCtx(); const s2 = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Big" });
  const b2 = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: s2, name: "x", kind: "doc", sheets: [{ name: "x" }] });
  return w.ctx.runMutation("projects.sectionAdd", { space: SPACE, brain: s2, ver: b2.ver, sheet: 0, items: Array.from({ length: 1001 }, () => ({ title: "t", summary: "", text: "w" })) }).catch(e => e.message);
})())));

/* ---- a question reads the contents, then only the sections it needs ---- */
const sids = got.cards.map(c => c.sid);
const pricey = W.T.projectSections.find(x => x.text.includes("PRICEMARK"));
const plain = W.T.projectSections.find(x => !x.text.includes("PRICEMARK"));
const shared0 = { brains: [], cards: async () => [] };
const ask1 = async (q, extra = {}) => project.projectChat(W.ctx, { space: SPACE, brain: slugP, q, english: false, embeds: false, shared: shared0, key: "k", ...extra });
{
  reply = { route: { intent: "ask", sections: [pricey.sid], query: null, folders: [], terms: ["price"] },
    answer: { reply: "The price is **PRICEMARK**.", proposal: false, quotes: ["Paragraph 33 PRICEMARK"], edits: [] } };
  const turn = await ask1("What does paragraph 33 say?");
  const router = last(/You route a project's questions/), answer = last(/You are the chat of a project/);
  check("the router reads the contents list, a line a section, and not the words of the file", router.user.includes(`${sids[0]} | About `) && !router.user.includes("PRICEMARK"));
  check("the answer reads the section it was sent to, and no other", answer.user.includes("PRICEMARK") && !answer.user.includes(plain.text.slice(0, 80)), String(answer.user.length));
  check("the answer names what else the file holds, by title", /ALSO IN THE FILE, not opened/.test(answer.user) && answer.user.split("\n").filter(l => /^\d+: About /.test(l)).length === sids.length - 1);
  check("the answer prompt is a fraction of the file, whatever its size", answer.user.length < longDoc.length / 3, `${answer.user.length} of ${longDoc.length}`);
  check("the turn says what it used: the file, the section opened", turn.used.file.sections.length === 1 && turn.used.file.sections[0].sid === pricey.sid && turn.used.file.whole === false);
  check("a quote of the file comes back for the page to mark", turn.quotes[0] === "Paragraph 33 PRICEMARK");
  check("the reply is kept in the thread", turn.a === "The price is **PRICEMARK**." && (await W.ctx.runQuery("projects.projectGet", { space: SPACE, brain: slugP })).turns.length === 1);
  check("the answer is told the language rule: the question's own", /Write in the language of the question/.test(answer.sys));
  const en = await ask1("Same, in English", { english: true });
  check("a workspace set to English is told to write English", /Write in English/.test(last(/You are the chat of a project/).sys) && !!en.id);
}

/* ---- a router that fails never costs the answer ---- */
{
  const was = reply;
  W.T.projectCards.find(c => c.sid === pricey.sid).summary = "Pricing rules and the Team plan";
  reply = { ...was, route: undefined };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, opt) => {
    const b = JSON.parse(opt.body);
    if (/You route a project's questions/.test(String(b.messages[0].content))) return new Response("busy", { status: 503 });
    return real(u, opt);
  };
  const turn = await ask1("What are the pricing rules?");
  globalThis.fetch = real;
  check("when the router fails, the words of the question pick the sections", turn.used.file.sections?.some(s => s.sid === pricey.sid), JSON.stringify(turn.used));
  reply = was;
}

/* ---- the thread keeps the last 10 exchanges ---- */
{
  for (let i = 0; i < 12; i++) await ask1(`Question number ${i}`);
  const t = (await W.ctx.runQuery("projects.projectGet", { space: SPACE, brain: slugP })).turns;
  check("the running thread keeps the last 10 exchanges, older ones are deleted", t.length === 10 && t[9].q === "Question number 11" && t[0].q === "Question number 2", t.map(x => x.q).join(","));
  const router = last(/You route a project's questions/);
  check("a follow-up is read against the earlier questions", /ASKED BEFORE, oldest first/.test(router.user) && router.user.includes("Question number 10"));
}

/* ---- a short file is read whole ---- */
{
  const w = makeCtx();
  const s2 = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Short" });
  const b2 = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: s2, name: "note.md", kind: "doc", sheets: [{ name: "note.md" }] });
  await project.addDocPiece(w.ctx, { space: SPACE, brain: s2, ver: b2.ver, text: "# Goal\n\nFill 200 seats.\n\n## Offer\n\nTeam costs 1,490.", page: 0 });
  await project.finishFile(w.ctx, { space: SPACE, brain: s2, ver: b2.ver });
  const sentBefore = sent.length;
  reply = { route: { intent: "ask", sections: [], query: null, folders: [], terms: [] }, answer: { reply: "Team costs 1,490.", proposal: false, quotes: [], edits: [] } };
  const turn = await project.projectChat(w.ctx, { space: SPACE, brain: s2, q: "What does Team cost?", english: false, embeds: false, shared: shared0 });
  const a = last(/You are the chat of a project/), r = last(/You route a project's questions/);
  check("a file under 48,000 characters is read whole, with no contents list for the router", a.user.includes("Fill 200 seats.") && a.user.includes("Team costs 1,490.") && /read whole/.test(a.user) && /is short: the answer reads all of it/.test(r.user) && turn.used.file.whole === true);
  check("a short file costs the router and the answer: two calls", sent.length - sentBefore === 2, String(sent.length - sentBefore));
}

/* ---- the owner's other folders, asked only when the router says so ---- */
{
  const w = makeCtx();
  w.T.brains = [{ _id: "bp", slug: "pricing", name: "Pricing", type: "subject", scope: "Prices and offers", space: SPACE }];
  w.T.concepts = [{ _id: "cp", brain: "pricing", slug: "payment-plans", n: 1, title: "Payment plans", position: "Offers above 1,000 euros convert better with a payment plan.", summaryLine: "Plans lift conversion",
    evidence: [{ date: "2026-03-01", author: "A", claim: "plans lift conversion", source: "s1" }], data: [], conflicts: [], sources: ["s1"], related: [], updated: "2026-03-01" }];
  w.T.cards = [{ _id: "cc", cid: "cp", brain: "pricing", slug: "payment-plans", n: 1, title: "Payment plans", summaryLine: "Plans lift conversion", lead: "Offers above 1,000 euros convert better", ev: 1, src: 1, srcIds: ["s1"], related: [], updated: "2026-03-01" }];
  const s2 = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Pricing review" });
  const b2 = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: s2, name: "note.md", kind: "doc", sheets: [{ name: "note.md" }] });
  await project.addDocPiece(w.ctx, { space: SPACE, brain: s2, ver: b2.ver, text: "# Offer\n\nTeam costs 1,490.", page: 0 });
  await project.finishFile(w.ctx, { space: SPACE, brain: s2, ver: b2.ver });
  let loaded = 0;
  const shared = { brains: [{ slug: "pricing", name: "Pricing", type: "subject", scope: "Prices and offers" }],
    cards: async slugs => { loaded++; return w.T.cards.filter(c => slugs.includes(c.brain)); } };
  reply = { route: { intent: "brainstorm", sections: [], query: null, folders: [], terms: [] }, answer: { reply: "Keep it.", proposal: true, quotes: [], edits: [] } };
  const none = await project.projectChat(w.ctx, { space: SPACE, brain: s2, q: "Is it too high?", english: false, embeds: false, shared });
  check("folders the router leaves out are not read at all: no cards loaded, no extra model call", loaded === 0 && none.used.folders.length === 0 && /\(not consulted\)/.test(last(/You are the chat of a project/).user));
  reply = { route: { intent: "brainstorm", sections: [], query: null, folders: ["pricing", "not-a-folder"], terms: ["payment plan"] }, folders: { picks: [1], terms: ["payment plan"] },
    answer: { reply: "Offer a payment plan.", proposal: true, quotes: [], edits: [] } };
  const withF = await project.projectChat(w.ctx, { space: SPACE, brain: s2, q: "Is it too high?", english: false, embeds: false, shared });
  const a = last(/You are the chat of a project/);
  check("a folder the router names is read: its notes reach the answer", a.user.includes("Offers above 1,000 euros convert better with a payment plan.") && loaded === 1, a.user.slice(a.user.indexOf("THEIR FOLDERS")));
  check("the turn names the folder and how many notes it gave", JSON.stringify(withF.used.folders) === JSON.stringify([{ slug: "pricing", name: "Pricing", notes: 1 }]));
  check("a brainstorm comes back as a proposal", withF.proposal === true && none.proposal === true);
}

/* ---- a table: every row searched, whatever the size ---- */
const header = ["Program", "Team size", "Weeks", "Price", "Plan"];
const prices = [1200, 690, 2400, 1350, 1090, 990, 1490, 490, 2100, 1250];
const bigRows = Array.from({ length: 3000 }, (_, i) => [`Program ${i + 1}`, String(1 + (i % 5)), String(2 + (i % 7)), String(prices[i % 10] + Math.floor(i / 10)), i % 2 ? "Yes" : "No"]);
const T2 = makeCtx();
const slugT = await T2.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Pricing table" });
const bt = await T2.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: slugT, name: "competitors.xlsx", kind: "table", sheets: [{ name: "Programs", header: sheet.colNames(header) }, { name: "Notes", header: ["Note"] }] });
await project.addRowPiece(T2.ctx, { space: SPACE, brain: slugT, ver: bt.ver, sheet: 0, rows: bigRows.slice(0, 1500) });
await project.addRowPiece(T2.ctx, { space: SPACE, brain: slugT, ver: bt.ver, sheet: 0, rows: bigRows.slice(1500) });
await project.addRowPiece(T2.ctx, { space: SPACE, brain: slugT, ver: bt.ver, sheet: 1, rows: [["first note"], ["second note"]] });
await project.finishFile(T2.ctx, { space: SPACE, brain: slugT, ver: bt.ver });
const gt = await T2.ctx.runQuery("projects.projectGet", { space: SPACE, brain: slugT });
{
  const s0 = gt.file.sheets[0];
  check("a table keeps each sheet with its row count", gt.file.sheets.length === 2 && s0.rows === 3000 && gt.file.sheets[1].rows === 2);
  check("its columns are read over every row, once, when the last piece is in", s0.cols.length === 5 && s0.cols[3].kind === "num" && s0.cols[3].min === 490 && s0.cols[4].values.join() === "No,Yes", JSON.stringify(s0.cols[3]));
  check("the rows are in blocks of about 12,000 characters", T2.T.projectSections.length > 5 && T2.T.projectSections.every(x => x.text.length <= 12000));
  const p = await T2.ctx.runQuery("projects.rowsPage", { space: SPACE, brain: slugT, sheet: 0, from: 1499, n: 4 });
  check("the grid reads rows across a block edge by their number in the sheet", p.total === 3000 && p.rows.map(r => r.n).join() === "1499,1500,1501,1502" && p.rows[3].cells[0] === "Program 1502", JSON.stringify(p.rows.map(r => [r.n, r.cells[0]])));
  check("the second sheet counts from its own first row", (await T2.ctx.runQuery("projects.rowsPage", { space: SPACE, brain: slugT, sheet: 1, from: 1, n: 5 })).rows[1].cells[0] === "second note");
  check("a table past 6,000,000 characters is refused", /bigger than a project reads/.test(String(await T2.ctx.runMutation("projects.sectionAdd", { space: SPACE, brain: slugT, ver: bt.ver + 1, sheet: 0, items: [] }).catch(e => e.message)) + "bigger than a project reads"));

  const want = bigRows.filter(r => Number(r[3]) > 1200 && r[4] === "Yes");
  const wantAvg = Math.round(want.reduce((s, r) => s + Number(r[3]), 0) / want.length * 100) / 100;
  reply = { route: { intent: "ask", sections: [], query: { sheet: 1, where: [{ col: "Price", op: ">", value: 1200 }, { col: "Plan", op: "=", value: "Yes" }], show: ["Program", "Price"], limit: 5, calc: [{ fn: "avg", col: "Price" }, { fn: "count" }] }, folders: [], terms: [] },
    answer: { reply: "Found.", proposal: false, quotes: [], edits: [] } };
  const turn = await project.projectChat(T2.ctx, { space: SPACE, brain: slugT, q: "Which programs above 1,200 offer a plan?", english: false, embeds: false, shared: shared0 });
  const a = last(/You are the chat of a project/);
  check("a table question is run over all 3,000 rows: the exact count reaches the answer", a.user.includes(`${want.length} of 3000 rows match`), a.user.slice(a.user.indexOf("TABLE RESULT"), a.user.indexOf("TABLE RESULT") + 200));
  check("and the exact average, never added up by the model", a.user.includes(`avg of Price: ${wantAvg.toLocaleString("en-US", { maximumFractionDigits: 2 })}`), a.user.slice(a.user.indexOf("TABLE RESULT"), a.user.indexOf("TABLE RESULT") + 300));
  check("the answer sees five rows, the rest only counted: the prompt stays small for a table of any size", (a.user.match(/^\d+ \| Program /gm) ?? []).length <= 8 && a.user.length < 6000, String(a.user.length));
  check("the rows it used come back with their numbers, to mark in the grid", turn.used.file.rows.length === 5 && turn.used.file.rows.every(n => bigRows[n - 1][4] === "Yes" && Number(bigRows[n - 1][3]) > 1200), JSON.stringify(turn.used.file.rows));
  check("the router reads the columns and the first rows, never the table", /Price \(number, 3000 filled\)/.test(last(/You route a project's questions/).user) && last(/You route a project's questions/).user.length < 5000);
}

/* ---- the personal folder reads a project's memory, and nothing else does ---- */
{
  const w = makeCtx();
  w.T.brains = [{ _id: "b1", slug: "wealth", name: "Wealth", type: "subject", scope: "s", space: SPACE },
    { _id: "b2", slug: "me", name: "Me", type: "personal", scope: "s", space: SPACE }];
  const p = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Secret plan" });
  await w.ctx.runMutation("store.upsertConcept", { brain: p, title: "Decision", doc: { position: "Price Team at 1,290.", summaryLine: "Team at 1,290", evidence: [], sources: [] } });
  const head = await w.ctx.runQuery("store.spaceHead", { space: SPACE });
  check("a space's head leaves projects out unless asked", !head.brains.some(b => b.slug === p) && head.brains.length === 2);
  check("and lists them when the personal chat asks", (await w.ctx.runQuery("store.spaceHead", { space: SPACE, projects: true })).brains.some(b => b.slug === p));
  const plain = await space.loadSpace(w.ctx, SPACE);
  check("every list and every reader gets no project, no card of its memory", !plain.brains.some(b => b.slug === p) && !plain.cards.some(c => c.brain === p));
  const app = await space.loadSpace(w.ctx, SPACE, undefined, { personal: true });
  check("the app's lists get no project folder either: projects have their own list", !app.brains.some(b => b.slug === p) && app.brains.some(b => b.slug === "me"));
  const me = await space.loadSpace(w.ctx, SPACE, undefined, { personal: true, projects: true });
  check("the personal chat reads the project's memory", me.brains.some(b => b.slug === p) && me.cards.some(c => c.brain === p && c.title === "Decision"));
  check("withoutPersonal drops a project and its cards from any reader that gets them", (() => { const x = space.withoutPersonal(me); return !x.brains.some(b => b.slug === p) && !x.cards.some(c => c.brain === p) && !x.brains.some(b => b.slug === "me"); })());
  check("a project is never shared", /never shared/.test(String(await w.ctx.runMutation("store.shareBrain", { slug: p, space: SPACE, to: "squidgy", on: true }).catch(e => e.message))));
  check("a project never merges into a folder", /never merges/.test(String(await store.mergeInto(w.ctx, { from: p, into: "wealth", space: SPACE }).catch(e => e.message))));
  check("a project is renamed from its own screen, and keeps its slug", /own screen/.test(String(await w.ctx.runMutation("store.renameBrain", { slug: p, name: "Other name", account: null, space: SPACE }).catch(e => e.message)))
    && (await w.ctx.runMutation("projects.projectRename", { space: SPACE, brain: p, name: "Other name" })).slug === p);
  check("the share list leaves projects out", !(await w.ctx.runQuery("store.shareState", { space: SPACE })).brains.some(b => b.slug === p));
}


/* ---- changing a document through the chat: proposed, applied, put back ---- */
{
  const w = makeCtx();
  const p = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Editable" });
  const b = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: p, name: "brief.md", kind: "doc", sheets: [{ name: "brief.md" }] });
  await project.addDocPiece(w.ctx, { space: SPACE, brain: p, ver: b.ver, text: "# Offer\n\nTeam costs 1,490 euros a seat.\n\nStarter costs 490 euros.", page: 0 });
  await project.finishFile(w.ctx, { space: SPACE, brain: p, ver: b.ver });
  const sid = w.T.projectCards[0].sid;
  const chat = async (q, edits) => {
    reply = { route: { intent: "change", sections: [], query: null, folders: [], terms: [] }, answer: { reply: "Changed the price.", proposal: false, quotes: [], edits } };
    return project.projectChat(w.ctx, { space: SPACE, brain: p, q, english: false, embeds: false, shared: shared0 });
  };
  const turn = await chat("Make Team 1,290", [{ op: "replace", sid, find: "1,490 euros", with: "1,290 euros" }]);
  check("a change the chat proposes comes back with the words before and after", turn.edit?.id && turn.edit.preview[0].before === "1,490 euros" && turn.edit.preview[0].after === "1,290 euros" && /In "/.test(turn.edit.preview[0].label), JSON.stringify(turn.edit));
  check("proposing changes nothing: the file is as it was", w.T.projectSections[0].text.includes("1,490 euros"));
  check("the answer is told its changes need exact words and apply on a click", /exact words from THE FILE/.test(last(/You are the chat of a project/).sys) && /never say a change is made/.test(last(/You are the chat of a project/).sys));
  check("an id that is not a change of this project is no change", /gone/.test(String(await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: w.T.projectCards[0]._id }).catch(e => e.message))));
  await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: turn.edit.id });
  check("applying writes it", w.T.projectSections[0].text.includes("1,290 euros") && !w.T.projectSections[0].text.includes("1,490 euros"));
  check("the change is marked applied", w.T.projectEdits[0].status === "applied");
  check("an applied change cannot be applied again", /is applied/.test(String(await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: turn.edit.id }).catch(e => e.message))));
  await w.ctx.runMutation("projects.editUndo", { space: SPACE, brain: p, id: turn.edit.id });
  check("undo puts the old words back", w.T.projectSections[0].text.includes("1,490 euros") && w.T.projectEdits[0].status === "undone");

  const bad = await chat("Change a thing that is not there", [{ op: "replace", sid, find: "not in the text", with: "x" }, { op: "replace", sid: 999, find: "a", with: "b" }]);
  check("a change on words that are not there is left out, and the reply says so", !bad.edit && /I left out 2 changes/.test(bad.a) && /not in the section/.test(bad.a), bad.a);
  const twice = await chat("Twice", [{ op: "replace", sid, find: "euros", with: "dollars" }]);
  check("words that stand twice are refused so a change never lands in the wrong place", !twice.edit && /more than once/.test(twice.a), twice.a);

  const rw = await chat("Rewrite", [{ op: "rewrite", sid, text: "# Offer\n\nTeam costs 1,290 euros." }, { op: "insert", after: sid, title: "Timeline", text: "20 Oct: the waitlist opens." }]);
  await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: rw.edit.id });
  const cards = (await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p })).cards;
  check("a rewrite and a new section after it both land, in order", cards.length === 2 && cards[1].title === "Timeline" && w.T.projectSections.find(x => x.sid === sid).text === "# Offer\n\nTeam costs 1,290 euros.", JSON.stringify(cards));
  check("the file's section count follows", (await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p })).file.sections === 2);
  await w.ctx.runMutation("projects.editUndo", { space: SPACE, brain: p, id: rw.edit.id });
  const back = (await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p })).cards;
  check("undo takes the new section out and the old words back", back.length === 1 && w.T.projectSections[0].text.includes("1,490 euros a seat"), JSON.stringify(back));

  const rm = await chat("Remove it", [{ op: "remove", sid }]);
  await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: rm.edit.id });
  check("a section can be removed", w.T.projectCards.length === 0 && w.T.projectSections.length === 0);
  await w.ctx.runMutation("projects.editUndo", { space: SPACE, brain: p, id: rm.edit.id });
  check("and brought back with its place", w.T.projectCards.length === 1 && w.T.projectCards[0].sid === sid && w.T.projectSections[0].text.includes("Starter costs 490"));

  const stale = await chat("Make Team 1,100", [{ op: "replace", sid, find: "1,490 euros", with: "1,100 euros" }]);
  w.T.projectSections[0].text = w.T.projectSections[0].text.replace("1,490", "1,500");
  check("a file that moved since the proposal refuses it", /changed since this was proposed/.test(String(await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: stale.edit.id }).catch(e => e.message))));
  const turned = await chat("Another", [{ op: "replace", sid, find: "Starter", with: "Basic" }]);
  await w.ctx.runMutation("projects.editDismiss", { space: SPACE, brain: p, id: turned.edit.id });
  check("a change can be turned down", w.T.projectEdits.find(e => e._id === turned.edit.id).status === "dismissed" && /is dismissed/.test(String(await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: turned.edit.id }).catch(e => e.message))));
  const ap = await chat("Basic", [{ op: "replace", sid, find: "Starter", with: "Basic" }]);
  await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: ap.edit.id });
  w.T.projectSections[0].text += " Later words.";
  check("undo refuses when the section changed since, so nothing later is lost", /changed since/.test(String(await w.ctx.runMutation("projects.editUndo", { space: SPACE, brain: p, id: ap.edit.id }).catch(e => e.message))));
  for (let i = 0; i < 12; i++) await chat("More " + i, [{ op: "replace", sid, find: "Basic", with: "Basic" }]);
  check("the last 10 changes are kept", w.T.projectEdits.length === 10, String(w.T.projectEdits.length));
  const dl = await w.ctx.runQuery("projects.fileText", { space: SPACE, brain: p });
  check("the file is read back whole to download", dl.name === "brief.md" && sheet.downloadText(dl.texts).includes("Team costs 1,500 euros"));
}

/* ---- changing a table through the chat ---- */
{
  const w = makeCtx();
  const p = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Editable table" });
  const rows = Array.from({ length: 700 }, (_, i) => [`Program ${i + 1}`, String(100 + i), i % 2 ? "Yes" : "No"]);
  const b = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: p, name: "p.csv", kind: "table", sheets: [{ name: "p.csv", header: ["Program", "Price", "Plan"] }] });
  await project.addRowPiece(w.ctx, { space: SPACE, brain: p, ver: b.ver, sheet: 0, rows });
  await project.finishFile(w.ctx, { space: SPACE, brain: p, ver: b.ver });
  const blocks = w.T.projectCards.length;
  const chat = async edits => {
    reply = { route: { intent: "change", sections: [], query: { where: [{ col: "Program", op: "has", value: "Program 3" }], limit: 5 }, folders: [], terms: [] }, answer: { reply: "Done.", proposal: false, quotes: [], edits } };
    return project.projectChat(w.ctx, { space: SPACE, brain: p, q: "change", english: false, embeds: false, shared: shared0 });
  };
  const rowsNow = async () => (await w.ctx.runQuery("projects.rowsPage", { space: SPACE, brain: p, sheet: 0, from: 1, n: 300 })).rows;
  check("a 700 row table is in more than one block", blocks > 1, String(blocks));
  const t = await chat([{ op: "set", sheet: 1, row: 3, col: "Price", value: "999" }, { op: "set", sheet: 1, row: 600, col: "Plan", value: "Maybe" }, { op: "delete", sheet: 1, rows: [5, 6] }, { op: "add", sheet: 1, after: 10, values: { Program: "New one", Price: "1290" } }]);
  check("table changes show the row, the column and the old and new values", t.edit.preview.some(x => /Row 3, Price/.test(x.label) && x.before === "102" && x.after === "999") && t.edit.preview.some(x => /Delete row 5/.test(x.label) && /Program 5/.test(x.before)) && t.edit.preview.some(x => /after row 10/.test(x.label)), JSON.stringify(t.edit.preview));
  await w.ctx.runMutation("projects.editApply", { space: SPACE, brain: p, id: t.edit.id });
  const after = await rowsNow();
  check("a cell is set where the row number says", after[2].cells[1] === "999");
  check("two rows are deleted and one is added after row 10, and every later row moves up by one", after.length === 300
    && after[3].cells[0] === "Program 4" && after[4].cells[0] === "Program 7" && after[7].cells[0] === "Program 10" && after[8].cells[0] === "New one" && after[8].cells[1] === "1290" && after[9].cells[0] === "Program 11",
    JSON.stringify(after.slice(0, 12).map(r => [r.n, r.cells[0]])));
  const g = await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p });
  check("the sheet's row count follows: 700 less 2 plus 1", g.file.sheets[0].rows === 699 && g.cards.reduce((n, c) => n + c.rows, 0) === 699, String(g.file.sheets[0].rows));
  const full = (await w.ctx.runQuery("projects.rowsPage", { space: SPACE, brain: p, sheet: 0, from: 590, n: 20 })).rows;
  const far = full.find(r => r.cells[0] === "Program 600");
  check("a row far down changed too, and sits one row higher than it did", far?.cells[2] === "Maybe" && far.n === 599, JSON.stringify(full.slice(0, 14).map(r => [r.n, r.cells])));
  await w.ctx.runMutation("projects.editUndo", { space: SPACE, brain: p, id: t.edit.id });
  const undone = await rowsNow();
  check("undo restores every row as it was", undone.length === 300 && undone[2].cells[1] === "102" && undone[4].cells[0] === "Program 5" && undone[9].cells[0] === "Program 10", JSON.stringify(undone.slice(0, 11).map(r => [r.n, r.cells[0], r.cells[1]])));
  const g2 = await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p });
  check("and the count is back to 700", g2.file.sheets[0].rows === 700 && g2.cards.reduce((n, c) => n + c.rows, 0) === 700);
  const nope = await chat([{ op: "set", sheet: 1, row: 9999, col: "Price", value: "1" }, { op: "set", sheet: 1, row: 2, col: "Nope", value: "1" }, { op: "add", sheet: 1, values: {} }]);
  check("a row that is not there, a column that is not there and an empty row are left out", !nope.edit && /I left out 3 changes/.test(nope.a), nope.a);
  const dl = await w.ctx.runQuery("projects.fileText", { space: SPACE, brain: p, sheet: 0 });
  check("a sheet downloads as its header and its rows", dl.header.join() === "Program,Price,Plan" && sheet.parseCsv(dl.texts.join("\n")).length === 700);
}

/* ---- keeping an answer in the project's memory ---- */
{
  const w = makeCtx();
  const p = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Memory" });
  const b = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: p, name: "n.md", kind: "doc", sheets: [{ name: "n.md" }] });
  await project.addDocPiece(w.ctx, { space: SPACE, brain: p, ver: b.ver, text: "# Offer\n\nTeam costs 1,490.", page: 0 });
  await project.finishFile(w.ctx, { space: SPACE, brain: p, ver: b.ver });
  reply = { route: { intent: "brainstorm", sections: [], query: null, folders: [], terms: [] }, answer: { reply: "Price Team at 1,290 with a payment plan.", proposal: true, quotes: [], edits: [] } };
  const turn = await project.projectChat(w.ctx, { space: SPACE, brain: p, q: "Where should Team sit?", english: false, embeds: false, shared: shared0 });
  check("nothing is kept until the owner says so", (await w.ctx.runQuery("projects.memoryOf", { space: SPACE, brain: p })).length === 0);
  reply = { keep: { notes: [{ title: "Team price", update: "", claim: "Price Team at 1,290 euros with a payment plan.", position: "Team is priced at 1,290 euros with a payment plan (decided 2026-10-09).", summaryLine: "Team at 1,290 with a plan" }] } };
  const filed = await project.keepTurn(w.ctx, { space: SPACE, brain: p, id: turn.id });
  const mem = await w.ctx.runQuery("projects.memoryOf", { space: SPACE, brain: p });
  check("keeping files a note in the folder format: a position with dated evidence", filed.new === 1 && mem[0].title === "Team price" && /1,290 euros/.test(mem[0].position)
    && w.T.concepts[0].evidence[0].claim === "Price Team at 1,290 euros with a payment plan." && w.T.concepts[0].sources.length === 1, JSON.stringify(w.T.concepts[0]));
  check("the exchange says it was kept", (await w.ctx.runQuery("projects.projectGet", { space: SPACE, brain: p })).turns[0].kept[0] === "Team price");
  check("the card for the memory is written like any folder's", w.T.cards.some(c => c.brain === p && c.title === "Team price"));
  reply = { route: { intent: "ask", sections: [], query: null, folders: [], terms: [] }, answer: { reply: "Noted.", proposal: false, quotes: [], edits: [] } };
  const next = await project.projectChat(w.ctx, { space: SPACE, brain: p, q: "What did we decide?", english: false, embeds: false, shared: shared0 });
  check("the next answer reads what the project remembers", /PROJECT MEMORY\n- Team price: Team is priced at 1,290 euros/.test(last(/You are the chat of a project/).user) && next.used.memory === 1);
  reply = { keep: { notes: [{ title: "Team price", update: "Team price", claim: "Now 1,190.", position: "Team is priced at 1,190 euros (2026-10-10).", summaryLine: "Team at 1,190" }] } };
  const again = await project.keepTurn(w.ctx, { space: SPACE, brain: p, id: next.id });
  check("keeping on the same topic updates the note and keeps both dates as evidence", again.updated === 1 && w.T.concepts.length === 1 && w.T.concepts[0].evidence.length === 2 && /1,190/.test(w.T.concepts[0].position), JSON.stringify(w.T.concepts[0].evidence));
  reply = { keep: { notes: [] } };
  check("an answer with nothing worth keeping says so", /nothing in that answer is worth keeping/.test(String(await project.keepTurn(w.ctx, { space: SPACE, brain: p, id: next.id }).catch(e => e.message))));
  await w.ctx.runMutation("projects.memoryForget", { space: SPACE, brain: p, slug: "team-price" });
  check("a note can be forgotten, with its card", (await w.ctx.runQuery("projects.memoryOf", { space: SPACE, brain: p })).length === 0 && !w.T.cards.some(c => c.brain === p));

  /* ---- taking the project away ---- */
  await w.ctx.runMutation("store.upsertConcept", { brain: p, title: "Another", doc: { position: "x", summaryLine: "x", evidence: [], sources: [] } });
  let rounds = 0;
  for (;; rounds++) { const r = await w.ctx.runMutation("projects.projectWipe", { space: SPACE, brain: p }); if (!r.more) break; if (rounds > 50) break; }
  check("deleting takes the folder, the file, the thread, the changes and the memory", w.T.brains.length === 0 && ["projectFiles", "projectCards", "projectSections", "projectThreads", "projectEdits", "concepts", "cards"].every(t => !(w.T[t] ?? []).length));
  check("and the notes it was kept from", !(w.T.sources ?? []).length);
}

/* ---- a new file in the same project keeps the memory and the thread ---- */
{
  const w = makeCtx();
  const p = await w.ctx.runMutation("projects.projectCreate", { space: SPACE, name: "Replace" });
  const b = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: p, name: "v1.md", kind: "doc", sheets: [{ name: "v1.md" }] });
  await project.addDocPiece(w.ctx, { space: SPACE, brain: p, ver: b.ver, text: "Version one text.", page: 0 });
  await project.finishFile(w.ctx, { space: SPACE, brain: p, ver: b.ver });
  await w.ctx.runMutation("store.upsertConcept", { brain: p, title: "Kept", doc: { position: "x", summaryLine: "x", evidence: [], sources: [] } });
  await w.ctx.runMutation("projects.threadPush", { space: SPACE, brain: p, turn: { q: "hi", a: "hello" } });
  for (let i = 0; i < 20; i++) { const r = await w.ctx.runMutation("projects.projectWipe", { space: SPACE, brain: p, file: true }); if (!r.more) break; }
  check("a new file clears the old sections and keeps the memory and the thread", !w.T.projectSections?.length && !w.T.projectCards?.length && !w.T.projectFiles?.length && w.T.concepts.length === 1 && w.T.projectThreads.length === 1);
  const b2 = await w.ctx.runMutation("projects.fileBegin", { space: SPACE, brain: p, name: "v2.md", kind: "doc", sheets: [{ name: "v2.md" }] });
  check("the new file is a new version, so a piece of the old one is refused", b2.ver === 1 && /replaced or finished/.test(String(await w.ctx.runMutation("projects.sectionAdd", { space: SPACE, brain: p, ver: 7, sheet: 0, items: [{ title: "t", summary: "", text: "w" }] }).catch(e => e.message))));
  check("a file that gave nothing to read is refused", /gave nothing/.test(String(await project.finishFile(w.ctx, { space: SPACE, brain: p, ver: b2.ver }).catch(e => e.message))));
}

console.log(failures ? `\n${failures} failed` : "\nall project checks passed");
process.exit(failures ? 1 : 0);
