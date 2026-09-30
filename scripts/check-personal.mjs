/**
 * The personal brain: what a message files, and who else may read it.
 *
 * The filer is given a fake model, so these run offline and cost nothing. The
 * writes go through the real store against an in-memory table store.
 *
 *     node scripts/check-personal.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-personal-"));
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
const store = await build("store");
const personal = await build("personal");
const space = await build("space");

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

/* ---- a table store, and a ctx that runs the store's functions by name ---- */
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
    async insert(t, doc) { const r = { _id: `id${++id}`, ...doc }; rows(t).push(r); return r._id; },
    async patch(_id, doc) { Object.assign(find(_id), doc); },
    async replace(_id, doc) { const r = find(_id); for (const k of Object.keys(r)) if (k !== "_id") delete r[k]; Object.assign(r, doc); },
    async delete(_id) { for (const t in T) T[t] = T[t].filter(r => r._id !== _id); },
  };
  const call = (name, args) => store[name.split(".")[1]].handler({ db }, args);
  return { T, ctx: { db, runQuery: call, runMutation: call } };
}

const TODAY = "2026-09-30";

/* ---- reading the filer's reply ---- */
{
  const raw = 'Here you go: {"notes":[{"title":"Moving abroad","update":"","claim":"I want to move to Lisbon — next year","position":"","summaryLine":""},' +
    '{"title":"x"},{"title":"Pricing","update":"Pricing plan","claim":"Charge 20 euros","position":"Charge 20 euros a month.","summaryLine":"20 euros a month"},' +
    '{"title":"A","claim":"b c"},{"title":"Fourth","claim":"one too many"}]}';
  const notes = personal.readNotes(raw, "chat");
  check("the filer's notes are read out of any prose around them, capped at 3 for a message", notes.length === 3, JSON.stringify(notes));
  check("a note with no claim is dropped", !notes.some(n => n.title === "x"));
  check("an update keeps the title of the note it updates", notes[1].title === "Pricing plan" && notes[1].update === "Pricing plan");
  check("an empty position falls back to the claim, and em-dashes go", notes[0].position === notes[0].claim && !/—/.test(notes[0].claim), JSON.stringify(notes[0]));
  check("a reply that is not JSON files nothing", personal.readNotes("I could not", "chat").length === 0);
  check("an import files up to 10 notes a piece", personal.readNotes(JSON.stringify({ notes: Array.from({ length: 14 }, (_, i) => ({ title: "T" + i, claim: "c" + i })) }), "import").length === 10);
}

/* ---- the prompt: only the owner's words, never a guess ---- */
{
  const m = personal.filerPrompt("chat", "I sleep 6 hours", "They said: hi\nThe brain replied: hello", [{ title: "Sleep", position: "Aims for 8 hours.", evidence: [{ date: "2026-09-12" }] }],
    [{ title: "Pricing", summaryLine: "20 euros" }], TODAY);
  const u = m[1].content;
  check("the filer is told to file only the owner's words, never a guess or a reply", /Never file a guess/.test(u) && /Never file what an assistant said/.test(u));
  check("it sees the notes held now, the nearest whole with their last date", /"Sleep": Aims for 8 hours\. \(last said 2026-09-12\)/.test(u) && /"Pricing": 20 euros/.test(u));
  check("the chat before is context only", /context only, never filed/.test(u) && /TODAY: 2026-09-30/.test(u));
  check("a note is written to its owner as you, while the claim keeps their own words", /written to them as "you"/.test(u) && /first person kept/.test(u));
}

/* ---- the reply: to you, and it reaches for your other brains ---- */
{
  const r = personal.REPLY_RULES;
  check("the reply talks to you, never about you", /Talk to them as "you"/.test(r) && /Never call them "the user", "the owner" or by their name/.test(r));
  check("it brings up another brain on its own, and names it", /Take the initiative with their other brains/.test(r) && /without being asked/.test(r) && /"your \{Name\} brain"/.test(r));
  const brains = [{ name: "Health", type: "subject" }, { name: "Content", type: "subject" }, { name: "Social", type: "subject" },
    { name: "Richard Detente", type: "person" }, { name: "Me", type: "personal" }];
  const called = personal.calledBrains("Noted. Your Health brain puts creatine at 3 to 5 g a day. Your Richard Detente brain calls compute scarce. Your Me brain agrees.", brains);
  check("the brains a reply called are the ones it names as your X brain, the personal one aside", JSON.stringify(called) === '["Health","Richard Detente"]', JSON.stringify(called));
  check("a subject named in passing is no call", personal.calledBrains("Your health comes first, and social time helps.", brains).length === 0);
}

/* ---- filing: a new note, then a change of mind on it ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [
    { _id: "b1", slug: "me", name: "Me", type: "personal", scope: "s", space: "acme" },
    { _id: "b2", slug: "health", name: "Health", type: "subject", scope: "s", space: "acme" },
  ];
  T.concepts = [{ _id: "c0", brain: "health", slug: "sleep", n: 1, title: "Sleep", position: "8 hours.", summaryLine: "8 hours", evidence: [], data: [],
    conflicts: [], sources: ["s-1"], related: [], updated: "2026-09-01" }];
  T.sources = [{ _id: "s0", sid: "s-1", link: "https://a.b/c", linkKey: "a.b/c", title: "A talk", author: "Dr A", date: "2026-09-01", location: "", brains: ["health"], stored: "2026-09-01" }];
  const prompts = [];
  const model = reply => async m => { prompts.push(m[1].content); return JSON.stringify(reply); };
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;

  const f1 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), text: "I want to move to Lisbon next year", kind: "chat", date: TODAY,
    model: model({ notes: [{ title: "Moving abroad", update: "", claim: "I want to move to Lisbon next year", position: "Wants to move to Lisbon in 2027.", summaryLine: "Lisbon in 2027" }] }) });
  const c1 = T.concepts.find(c => c.brain === "me");
  check("a message files a new dated note in the owner's words", f1.new === 1 && f1.updated === 0 && c1?.title === "Moving abroad"
    && c1.evidence[0].author === "You" && c1.evidence[0].date === TODAY && c1.evidence[0].claim === "I want to move to Lisbon next year", JSON.stringify({ f1, c1 }));
  const src = T.sources.find(s => s.sid === `me-chat-${TODAY}`);
  check("under one source per day, signed You, in the personal brain only", src?.author === "You" && JSON.stringify(src.brains) === '["me"]' && c1.sources.includes(src.sid),
    JSON.stringify(src));

  const f2 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), text: "Actually Porto, not Lisbon", kind: "chat", date: "2026-10-02",
    model: model({ notes: [{ title: "Moving to Porto", update: "Moving abroad", claim: "Actually Porto, not Lisbon",
      position: "Now wants Porto (2026-10-02); said Lisbon on 2026-09-30.", summaryLine: "Porto now, Lisbon before" }] }) });
  const c2 = T.concepts.filter(c => c.brain === "me");
  check("a change of mind updates the same note: new position, both claims dated", f2.updated === 1 && f2.new === 0 && c2.length === 1
    && /Porto/.test(c2[0].position) && c2[0].evidence.length === 2 && c2[0].evidence[0].date === "2026-10-02", JSON.stringify(c2));
  check("the filer saw the note it was about to update, whole", /"Moving abroad": Wants to move to Lisbon in 2027\./.test(prompts[1]), prompts[1].slice(-600));

  const before = T.sources.length;
  const f3 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), text: "thanks!", kind: "chat", date: TODAY, model: model({ notes: [] }) });
  check("a thank-you files nothing and writes no source", f3.new === 0 && f3.updated === 0 && T.sources.length === before);

  /* Nobody else reads it. */
  const others = await space.loadSpace(ctx, "acme");
  check("every other reader loads the space without the personal brain, its notes or its sources",
    !others.brains.some(b => b.slug === "me") && !others.cards.some(c => c.brain === "me") && !others.sources.some(s => s.brains.includes("me"))
    && others.brains.some(b => b.slug === "health") && others.cards.some(c => c.brain === "health"), JSON.stringify({ b: others.brains.map(b => b.slug), s: others.sources.map(s => s.sid) }));
  const app = await space.loadSpace(ctx, "acme", undefined, { personal: true });
  check("the app's own lists still show it", app.brains.some(b => b.slug === "me") && app.cards.some(c => c.brain === "me"));
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe personal brain files what it should, for its owner only");
process.exit(failures ? 1 : 0);
