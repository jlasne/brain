/**
 * The lab: a call between the twins of two workspaces, run by the admin.
 *
 * Turns run against an in-memory table store and a stand-in for the model, so
 * each rule is checked the way it runs: whose folder a twin reads, what it is
 * told, what a pause or a stop does to a turn still being written, and what
 * keeps the model key from being spent without end.
 *
 *     node scripts/check-lab.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-lab-"));
mkdirSync(join(dir, "_generated"));
for (const f of readdirSync(join(ROOT, "convex")).filter(f => /\.(ts|json)$/.test(f))) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
writeFileSync(join(dir, "_generated/server.ts"),
  "export const internalQuery = (d: any) => d;\nexport const internalMutation = (d: any) => d;\nexport const internalAction = (d: any) => d;\n");
writeFileSync(join(dir, "entry.ts"), 'export * as lab from "./lab";\nexport * as store from "./store";\n');
await esbuild.build({ entryPoints: [join(dir, "entry.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { lab, store } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

/* ---- the words ---- */

check("the lab is open to Octopus and PandAAAHH, and to nobody else",
  lab.inLab("octopus") && lab.inLab("pandaaahh") && !lab.inLab("squidgy") && !lab.inLab("demo") && !lab.inLab("") && !lab.inLab(undefined));
check("each side's other side is the other workspace", lab.otherSide("octopus") === "pandaaahh" && lab.otherSide("pandaaahh") === "octopus");

const side = (space, name, notes) => ({ space, name, profile: "", notes, people: "", used: 4 });
const octo = side("octopus", "Octopus", "- Pricing: I never discount below 20% margin.");
const panda = side("pandaaahh", "PandAAAHH", "- Launch: we ship in March.");
const first = lab.labPrompt({ me: octo, other: panda, topic: "Plan a launch", lines: [] });
check("the first turn names the goal, the speaker's own notes and says to open the call",
  /THE GOAL OF THE CALL: Plan a launch/.test(first) && /never discount below 20%/.test(first) && /Open the call\./.test(first) && /THE CALL SO FAR\nNothing yet\./.test(first), first);
check("a twin never reads the other side's notes", !/ship in March/.test(first));
const talk = lab.labPrompt({ me: panda, other: octo, topic: "Plan a launch",
  lines: [{ from: "octopus", text: "Hello from Octopus." }, { from: "pandaaahh", text: "Hi, PandAAAHH here." }, { from: "admin", text: "Talk price." }] });
check("each turn is labelled by who said it: the speaker as itself, the other twin, the admin",
  /OCTOPUS TWIN: Hello from Octopus\./.test(talk) && /PANDAAAHH TWIN \(you\): Hi, PandAAAHH here\./.test(talk) && /ADMIN: Talk price\./.test(talk), talk);
check("a line from the admin is answered first", /ADMIN spoke last\. Answer them first/.test(talk));
const long = lab.labPrompt({ me: octo, other: panda, topic: "x", lines: Array.from({ length: 30 }, (_, i) => ({ from: i % 2 ? "pandaaahh" : "octopus", text: `line ${i}` })) });
check("a twin reads the latest 16 turns, not the whole call", /line 29/.test(long) && /line 14/.test(long) && !/line 13\b/.test(long));

const turn = lab.readLabTurn('{"say":"We ship in March — and you?","because":"Launch note","done":false}', "PandAAAHH");
check("a turn is read from its JSON: the words, the note it leaned on, no em-dash", turn?.say === "We ship in March, and you?" && turn.because === "Launch note" && turn.done === false, JSON.stringify(turn));
check("a twin that says it is done sets the flag", lab.readLabTurn('{"say":"Agreed, bye.","done":true}')?.done === true);
check("plain words are a turn too, with the label the model put in front of them taken off",
  lab.readLabTurn("PandAAAHH twin: Hello there.", "PandAAAHH")?.say === "Hello there." && lab.readLabTurn("Twin - Hello there.")?.say === "Hello there.");
check("empty, or JSON with nothing to say, is no turn", lab.readLabTurn("") === null && lab.readLabTurn('{"say":"  "}') === null && lab.readLabTurn("{broken") === null);
check("a turn is cut to 900 characters", lab.readLabTurn(JSON.stringify({ say: "a ".repeat(800) }))?.say.length <= 900);
check("a twin that says again what it said is caught; a new thought is not",
  lab.echoes("We ship the product in March next year", ["We ship the product in March next year, yes"])
  && !lab.echoes("Let us talk about pricing and margins first", ["We ship the product in March next year"])
  && !lab.echoes("Yes", ["Yes"]));

/* ---- a table store ---- */

function makeDb() {
  const T = {};
  let id = 0;
  const rows = t => (T[t] ??= []);
  const query = t => {
    const conds = [];
    let desc = false;
    const api = {
      withIndex(_n, fn) { const q = { eq(f, v) { conds.push([f, v]); return q; } }; if (fn) fn(q); return api; },
      order(d) { desc = d === "desc"; return api; },
      async collect() { const all = rows(t).filter(r => conds.every(([f, v]) => r[f] === v)); return desc ? all.slice().reverse() : all; },
      async first() { return (await api.collect())[0] ?? null; },
      async take(n) { return (await api.collect()).slice(0, n); },
      async unique() { const all = await api.collect(); if (all.length > 1) throw new Error(`unique() found ${all.length} rows in ${t}`); return all[0] ?? null; },
      async paginate({ numItems, cursor }) {
        const all = await api.collect(), from = cursor ? Number(cursor) : 0;
        return { page: all.slice(from, from + numItems), isDone: from + numItems >= all.length, continueCursor: String(from + numItems) };
      },
    };
    return api;
  };
  const find = _id => Object.values(T).flat().find(r => r._id === _id);
  return { T, db: {
    query,
    async get(_id) { return find(_id) ?? null; },
    normalizeId(t, _id) { return rows(t).some(r => r._id === _id) ? _id : null; },
    async insert(t, doc) { const r = { _id: `${t}${++id}`, ...doc }; rows(t).push(r); return r._id; },
    async patch(_id, doc) { const r = find(_id); for (const [k, v] of Object.entries(doc)) { if (v === undefined) delete r[k]; else r[k] = v; } },
    async delete(_id) { for (const t in T) T[t] = T[t].filter(r => r._id !== _id); },
  } };
}

const note = (brain, slug, title, position, extra = {}) => ({ _id: `c-${brain}-${slug}`, brain, slug, n: 1, title, position, summaryLine: position, evidence: [], sources: [], related: [], data: [], conflicts: [], updated: "2026-10-01", ...extra });
function world() {
  const { T, db } = makeDb();
  T.brains = [
    { _id: "b1", slug: "me", name: "Me", type: "personal", scope: "s" },
    { _id: "b2", slug: "pa-me", name: "Me", type: "personal", scope: "s", space: "pandaaahh" },
    { _id: "b3", slug: "wealth", name: "Wealth", type: "subject", scope: "s" },
  ];
  T.concepts = [
    note("me", "pricing", "Pricing", "I never discount below 20% margin."), note("me", "tone", "Tone", "Short, direct, no filler."),
    note("me", "hiring", "Hiring", "Slow to hire, fast to fire."), note("me", "travel", "Travel", "Porto in 2027."),
    note("me", "marc", "Marc Dupont", "Client.", { tag: "contact", file: { open: [{ k: "k1", t: "Send Marc the contract", at: "2026-09-01" }, { k: "k2", t: "Old", at: "2026-08-01", done: true }] } }),
    note("pa-me", "launch", "Launch", "We ship in March."), note("pa-me", "stack", "Stack", "Convex and Vercel."),
    note("pa-me", "team", "Team", "Two people."), note("pa-me", "funds", "Funding", "Bootstrapped."),
    note("wealth", "gold", "Gold", "Gold holds."),
  ];
  T.interviews = [{ _id: "i1", space: "octopus", brain: "me", marks: {}, profile: { parts: [{ title: "Voice", points: ["Direct and brief."] }] }, updated: 1 }];
  return { T, db };
}

/* ---- a call, and the model that speaks in it ---- */

const mods = { lab, store };
const handler = ref => { const [m, f] = String(ref).split("."); return mods[m][f].handler; };
function rig() {
  const w = world(), scheduled = [];
  const ctx = { db: w.db, scheduler: { runAfter: async (ms, ref, args) => { scheduled.push({ ms, ref: String(ref), args }); } } };
  const actx = { ...ctx, runQuery: (ref, a) => handler(ref)(ctx, a), runMutation: (ref, a) => handler(ref)(ctx, a) };
  return { ...w, ctx, actx, scheduled, run: (fn, a) => lab[fn].handler(ctx, a) };
}

const real = globalThis.fetch;
process.env.OPENROUTER_API_KEY = "sk-test";
let said = [], reply = null, onModel = null;
globalThis.fetch = async (_u, opt) => {
  const body = JSON.parse(opt.body);
  said.push(body);
  if (onModel) await onModel();
  const r = typeof reply === "function" ? reply(said.length) : reply;
  if (r instanceof Response) return r;
  return new Response(JSON.stringify({ choices: [{ message: { content: r } }] }), { status: 200 });
};
const asked = () => said[said.length - 1]?.messages?.[1]?.content ?? "";
const twin = (text, because = "a note", done = false) => JSON.stringify({ say: text, because, done });

{
  const R = rig();
  const call = await R.run("make", { topic: "", starter: "pandaaahh" });
  check("a call is made idle, with the default goal when none is given", call.status === "idle" && call.topic === lab.LAB_TOPIC && call.turns === 0 && call.starter === "pandaaahh", JSON.stringify(call));
  const bad = await R.run("make", { topic: "Plan a launch with a very long goal ".repeat(20), starter: "somebody" });
  check("a goal is cut short, and a starter that is not on the lab becomes Octopus", bad.topic.length <= 300 && bad.title.length <= 56 && bad.starter === "octopus", JSON.stringify(bad));

  const c = await R.run("make", { topic: "Plan a launch", starter: "octopus" });
  check("a step on a call that was never started does nothing", (await lab.labStep(R.actx, c.id, 0)).skipped === true && said.length === 0);

  const going = await R.run("control", { id: c.id, action: "go" });
  check("go starts it for 10 turns, and asks for the first turn at once",
    going.status === "running" && going.until === 10 && R.scheduled.at(-1).ref === "lab.step" && R.scheduled.at(-1).ms === 0 && R.scheduled.at(-1).args.gen === 1, JSON.stringify([going, R.scheduled]));
  check("a second go while it runs changes nothing", (await R.run("control", { id: c.id, action: "go" })).status === "running" && R.scheduled.length === 1);

  reply = twin("Hi, Octopus here. I price at 20% margin or more.", "Pricing note");
  const r1 = await lab.labStep(R.actx, c.id, 1);
  const t1 = R.T.labTurns[0];
  check("the opening twin is the one that was set to open, and its turn is kept with what it leaned on",
    r1.kept && t1.from === "octopus" && /20% margin/.test(t1.text) && t1.because === "Pricing note", JSON.stringify([r1, t1]));
  check("it asked for the next turn, 3 seconds on", R.scheduled.at(-1).ref === "lab.step" && R.scheduled.at(-1).ms === 3000 && R.scheduled.at(-1).args.gen === 1, JSON.stringify(R.scheduled.at(-1)));
  check("it was told to open the call, from its own folder: notes, a person, its profile, and nothing of the other folder",
    /Open the call\./.test(asked()) && /Porto in 2027/.test(asked()) && /Marc Dupont/.test(asked()) && /Direct and brief\./.test(asked()) && !/ship in March|Convex and Vercel/.test(asked()) && !/Gold holds/.test(asked()), asked().slice(0, 600));
  check("the rules and the JSON ask go as the system line", said.at(-1).messages[0].content === lab.LAB_RULES && said.at(-1).response_format?.type === "json_object");

  reply = twin("Nice. We ship in March. What would you add to that?", "Launch note");
  await lab.labStep(R.actx, c.id, 1);
  const second = asked();
  check("the second twin is the other workspace, reading its own folder and what the first one said",
    R.T.labTurns[1].from === "pandaaahh" && /Convex and Vercel/.test(second) && /OCTOPUS TWIN: Hi, Octopus here/.test(second) && !/Porto in 2027|Marc Dupont/.test(second), second.slice(0, 700));
  check("what a twin leaned on stays out of what the other reads", !/Pricing note/.test(second));

  const said1 = await R.run("say", { id: c.id, text: "  Talk about the price now.  " });
  check("an admin line joins the call, with its own number", said1.from === "admin" && said1.n === 3 && R.T.labTurns[2].text === "Talk about the price now.", JSON.stringify(said1));
  reply = twin("Price: 20% margin floor, no discount below.", "Pricing");
  await lab.labStep(R.actx, c.id, 1);
  check("the next twin answers the admin first: it is Octopus's turn, and it reads the line", R.T.labTurns[3].from === "octopus" && /ADMIN: Talk about the price now\./.test(asked()) && /ADMIN spoke last/.test(asked()), asked().slice(-500));
  check("an admin line does not take a twin's turn", R.T.labs.find(l => l._id === c.id).turns === 3);

  const poll = await R.run("read", { id: c.id, after: 2 });
  check("a poll carries only the turns after the one it holds", poll.turnRows.map(t => t.n).join() === "3,4" && poll.turns === 3 && poll.status === "running", JSON.stringify(poll.turnRows));
  check("the admin sees what each twin leaned on", poll.turnRows[1].because === "Pricing");

  /* a pause while a turn is being written */
  const before = R.T.labTurns.length, asks = R.scheduled.length;
  onModel = async () => { await R.run("control", { id: c.id, action: "pause" }); };
  reply = twin("This arrives after the pause.");
  const late = await lab.labStep(R.actx, c.id, 1);
  onModel = null;
  const paused = R.T.labs.find(l => l._id === c.id);
  check("a turn still being written when the admin pauses is dropped, and nothing is asked next",
    late.kept === false && R.T.labTurns.length === before && paused.status === "paused" && paused.note === "Paused by you." && R.scheduled.length === asks, JSON.stringify([late, paused.status, paused.note]));
  const stale = await lab.labStep(R.actx, c.id, 1);
  check("a turn already scheduled for the old run does nothing", stale.skipped === true);

  const again = await R.run("control", { id: c.id, action: "go" });
  check("go on after a pause starts a new run from the turns so far", again.status === "running" && again.until === 13 && again.note === null, JSON.stringify(again));
  const stopped = await R.run("control", { id: c.id, action: "stop" });
  check("stop ends it for good", stopped.status === "ended" && stopped.note === "Stopped by you.");
  check("an ended call neither goes on nor takes an admin line",
    /is over/.test(await R.run("control", { id: c.id, action: "go" }).then(() => "", e => e.message)) && /is over/.test(await R.run("say", { id: c.id, text: "x" }).then(() => "", e => e.message)));
  check("a turn for it never lands", (await lab.labStep(R.actx, c.id, 2)).skipped === true);

  const gone = await R.run("remove", { id: c.id });
  check("a deleted call takes its turns with it", gone.ok && !R.T.labs.some(l => l._id === c.id) && !R.T.labTurns.some(t => t.lab === c.id));
  check("reading a call that is gone says nothing", (await R.run("read", { id: c.id })) === null);
}

/* ---- one step at a time ---- */
{
  const R = rig();
  const c = await R.run("make", { topic: "Step test", starter: "octopus" });
  await R.run("control", { id: c.id, action: "step" });
  reply = twin("One turn only, and I mean it.");
  const r = await lab.labStep(R.actx, c.id, 1);
  const l = R.T.labs[0];
  check("a step lets one turn through, then waits, and asks for no more", r.kept && l.status === "paused" && l.turns === 1 && /1 turns so far/.test(l.note) && R.scheduled.length === 1, JSON.stringify(l));
}

/* ---- a call ends, waits or fails by what happens ---- */
{
  const R = rig();
  const c = await R.run("make", { topic: "End test", starter: "octopus" });
  await R.run("control", { id: c.id, action: "go" });
  reply = twin("We have agreed. Thank you.", "Done", true);
  await lab.labStep(R.actx, c.id, 1);
  check("a twin that says it is done ends the call, and says who", R.T.labs[0].status === "ended" && /Octopus's twin says the call is done/.test(R.T.labs[0].note) && R.scheduled.length === 1);
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Echo test", starter: "octopus" });
  await R.run("control", { id: c.id, action: "go" });
  reply = twin("We ship the product in March next year for sure");
  await lab.labStep(R.actx, c.id, 1);
  reply = twin("Sounds good, tell me more about your plans.");
  await lab.labStep(R.actx, c.id, 1);
  reply = twin("We ship the product in March next year for sure");
  await lab.labStep(R.actx, c.id, 1);
  const l = R.T.labs[0];
  check("a twin that repeats itself pauses the call, and says to steer it", l.status === "paused" && /repeating itself/.test(l.note) && R.T.labTurns.length === 3 && R.scheduled.length === 3, JSON.stringify([l.status, l.note]));
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Cap test", starter: "octopus" });
  R.T.labs[0].turns = 59;
  await R.run("control", { id: c.id, action: "go" });
  check("a run is never longer than the 60 turns a call holds", R.T.labs[0].until === 60, String(R.T.labs[0].until));
  reply = twin("The sixtieth turn of this long call, all alone.");
  await lab.labStep(R.actx, c.id, 1);
  check("the 60th turn ends the call", R.T.labs[0].status === "ended" && /60 turns/.test(R.T.labs[0].note));
  const c2 = await R.run("make", { topic: "Full", starter: "octopus" });
  R.T.labs[1].turns = 60;
  check("a full call cannot start again", /60 turns at most/.test(await R.run("control", { id: c2.id, action: "go" }).then(() => "", e => e.message)));
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Fail test", starter: "octopus" });
  await R.run("control", { id: c.id, action: "go" });
  reply = new Response(JSON.stringify({ error: { message: "no credit" } }), { status: 402 });
  const r = await lab.labStep(R.actx, c.id, 1);
  const l = R.T.labs[0];
  check("a model that fails pauses the call with the reason, and nothing is asked next", r.failed && l.status === "paused" && /out of credit/.test(l.error) && R.scheduled.length === 1, JSON.stringify(l));
  const back = await R.run("control", { id: c.id, action: "go" });
  check("go clears the reason and tries again", back.status === "running" && back.error === null);
  reply = "no json at all {";
  const odd = await lab.labStep(R.actx, c.id, 2);
  check("a reply with no readable turn pauses it too, rather than keeping nothing", odd.empty && R.T.labs[0].status === "paused" && /nothing readable/.test(R.T.labs[0].error));
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Thin test", starter: "pandaaahh" });
  R.T.concepts = R.T.concepts.filter(x => !(x.brain === "pa-me" && x.slug !== "launch"));
  await R.run("control", { id: c.id, action: "go" });
  const n = said.length;
  const r = await lab.labStep(R.actx, c.id, 1);
  check("a folder with fewer than 3 notes cannot speak: the call waits and names it, and no model is asked",
    r.thin && said.length === n && R.T.labs[0].status === "paused" && /PandAAAHH's personal folder holds too few notes/.test(R.T.labs[0].error), JSON.stringify(R.T.labs[0]));
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Day test", starter: "octopus" });
  R.T.mcpHits = [{ _id: "h1", who: "lab:turns", windowStart: Date.now(), count: lab.LAB_DAY }];
  await R.run("control", { id: c.id, action: "go" });
  const n = said.length;
  const r = await lab.labStep(R.actx, c.id, 1);
  check("the day's 300 turns across the lab are a ceiling: past it the call waits, and no model is asked",
    r.limited && said.length === n && /300 turns for today/.test(R.T.labs[0].error), JSON.stringify(R.T.labs[0]));
}
{
  const R = rig();
  const c = await R.run("make", { topic: "Stall test", starter: "octopus" });
  await R.run("control", { id: c.id, action: "go" });
  R.T.labs[0].updated = Date.now() - 5 * 60 * 1000;
  const woke = await R.run("control", { id: c.id, action: "go" });
  check("a call running with no turn for 2 minutes is woken by go, under a new run", woke.status === "running" && R.T.labs[0].gen === 2 && R.scheduled.at(-1).args.gen === 2, JSON.stringify(R.scheduled.at(-1)));
}

/* ---- the folders, as the panel shows them ---- */
{
  const R = rig();
  const o = await lab.folderOf(R.actx, "octopus"), p = await lab.folderOf(R.actx, "pandaaahh");
  check("a folder is counted for the panel: notes, people, open lines, a profile, the newest titles",
    o.name === "Octopus" && o.notes === 4 && o.people === 1 && o.open === 1 && o.profile === true && o.newest.length === 4 && p.name === "PandAAAHH" && p.notes === 4 && p.people === 0 && p.open === 0 && p.profile === false, JSON.stringify([o, p]));
  R.T.brains = R.T.brains.filter(b => b.slug !== "pa-me");
  const none = await lab.folderOf(R.actx, "pandaaahh");
  check("a workspace with no personal folder says so, with zeros", none.brain === null && none.notes === 0 && none.newest.length === 0);
  const calls = await R.run("list", {});
  check("no call yet, nothing listed", calls.length === 0);
}

globalThis.fetch = real; delete process.env.OPENROUTER_API_KEY;
console.log(failures ? `\n${failures} failed` : "\nthe lab runs");
process.exit(failures ? 1 : 0);
