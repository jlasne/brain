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
const twin = await build("twin");
const words = await build("words");

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
  check("an import files up to 20 notes a piece", personal.readNotes(JSON.stringify({ notes: Array.from({ length: 24 }, (_, i) => ({ title: "T" + i, claim: "c" + i })) }), "import").length === 20);
}

/* ---- the prompt: only the owner's words, never a guess ---- */
{
  const m = personal.filerPrompt("chat", "I sleep 6 hours", "They said: hi\nThe brain replied: hello", [{ title: "Sleep", position: "Aims for 8 hours.", evidence: [{ date: "2026-09-12" }] }],
    [{ title: "Pricing", summaryLine: "20 euros" }], TODAY);
  const u = m[1].content;
  check("the filer is told to file only the owner's words, never a guess or a reply", /Never file a guess/.test(u) && /Never file what an assistant said/.test(u));
  check("words that make no sense, or the same word again and again, are a speech engine's mistake and file nothing", /repeat the same word or phrase again and again/.test(u) && /file nothing/.test(u));
  check("it sees the notes held now, the nearest whole with their last date", /"Sleep": Aims for 8 hours\. \(last said 2026-09-12\)/.test(u) && /"Pricing": 20 euros/.test(u));
  check("the chat before is context only", /context only, never filed/.test(u) && /TODAY: 2026-09-30/.test(u));
  check("a note is written to its owner as you, while the claim keeps their own words", /written to them as "you"/.test(u) && /first person kept/.test(u));
}

/* ---- the reply: to you, and it reaches for your other brains ---- */
{
  const r = personal.REPLY_RULES;
  check("the reply speaks as their twin, in the first person, and never about them", /You are their AI twin/.test(r) && /Speak as them, in the first person/.test(r)
    && /decide the way their decision rules and values decide/.test(r) && /Never call them "the user", "the owner" or by their name/.test(r));
  check("it brings up another brain on its own, and names it as its own", /Take the initiative with your other brains/.test(r) && /without being asked/.test(r) && /"my \{Name\} brain"/.test(r));
  check("it never invents, and says a lean is a lean", /Never invent a fact, a memory, a person or a view/.test(r) && /say it is a lean/.test(r));
  const brains = [{ name: "Health", type: "subject" }, { name: "Content", type: "subject" }, { name: "Social", type: "subject" },
    { name: "Richard Detente", type: "person" }, { name: "Me", type: "personal" }];
  const called = personal.calledBrains("Noted. My Health brain puts creatine at 3 to 5 g a day. My Richard Detente brain calls compute scarce. My Me brain agrees.", brains);
  check("the brains a reply called are the ones it names as your X brain, the personal one aside", JSON.stringify(called) === '["Health","Richard Detente"]', JSON.stringify(called));
  check("a subject named in passing is no call", personal.calledBrains("Your health comes first, and social time helps.", brains).length === 0);
  check("it answers straight away, with no line on where the answer comes from and no note's date", /Answer straight away/.test(r) && /no "Based on what you've told me"/.test(r)
    && !/Cite a note's date/.test(r) && !/replaces what you said on/.test(r));
  const P = personal.plainReply;
  const cases = [
    ["Based on what you've told me: you want to move to Porto in 2027.", "You want to move to Porto in 2027."],
    ["From your notes, you sleep 7 hours.", "You sleep 7 hours."],
    ["You prefer tea, you said on 2026-10-05.", "You prefer tea."],
    ["You prefer tea (noted 2026-10-05). Your Health brain says 3 cups a day is fine.", "You prefer tea. Your Health brain says 3 cups a day is fine."],
    ["On 2026-09-12, you said that you run on Sundays.", "You run on Sundays."],
    ["Your flight leaves on 2026-11-02.", "Your flight leaves on 2026-11-02."],
    ["As your twin, I'd take the offer.", "I'd take the offer."],
  ];
  const got = cases.map(([a]) => P(a));
  check("what slips through is taken out, and a date that is the answer stays", cases.every(([, want], i) => got[i] === want), JSON.stringify(got));
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

/* ---- the interview: its questions ---- */
{
  check("335 questions in 17 chapters", twin.QUESTIONS.length === 335 && twin.CHAPTERS.length === 17, `${twin.QUESTIONS.length} ${twin.CHAPTERS.length}`);
  check("each question has its own id, from A1 to Q12", new Set(twin.QUESTIONS.map(q => q.id)).size === 335 && twin.QUESTIONS[0].id === "A1" && twin.QUESTIONS.at(-1).id === "Q12");
  check("written for anyone: no one person's bank, school, apps or creators", !twin.QUESTIONS
    .some(q => /\b(the bank|engineering|a creator with|your best app|selling an app)\b/i.test(q.text)));
  check("no em-dash in any question", !twin.QUESTIONS.some(q => /—/.test(q.text)));
  const a = twin.ahead({});
  check("the interview opens on the life story, in order", a.length === twin.AHEAD && a[0].id === "A1" && a[1].id === "A2");
  check("questions answered, known or skipped are passed, and the one being answered too",
    twin.ahead({ A1: "a", A2: "k", A3: "s" }, 2, "A4").map(q => q.id).join() === "A5,A6");
  const cov = twin.coverage({ A1: "a", A2: "k", A3: "s", B1: "a" });
  check("coverage counts answered and known, never skipped", cov.covered === 3 && cov.seen === 4 && cov.pct === 1
    && cov.chapters[0].answered === 1 && cov.chapters[0].known === 1 && cov.chapters[0].skipped === 1, JSON.stringify(cov.chapters[0]));
  const g = twin.gaps({}, "I sleep 6 hours and my alarm wakes me at 5");
  check("a question in passing follows what was just said", g[0]?.text === "How many hours do you sleep? What wakes you?", g.map(q => q.text).join(" | "));
  check("three at most, each from its own chapter", g.length === 3 && new Set(g.map(q => q.ch)).size === 3);
  const marks = {}; for (const q of twin.QUESTIONS) if (q.ch !== "M") marks[q.id] = "a";
  check("with nothing said in common, the chapter covered least comes first", twin.gaps(marks, "hello there")[0]?.ch === "M");
  check("skip and stop are read alone, in English or French", twin.isSkip("skip") && twin.isSkip("Je passe.") && twin.isSkip(" next ")
    && !twin.isSkip("skip the part about my father, I was 12") && twin.isStop("stop") && twin.isStop("On arrête") && !twin.isStop("I stop smoking in 2019"));
}

/* ---- the interview: what a reply may decide ---- */
{
  const next = twin.ahead({}, 6);
  const t = (r, o = {}) => twin.readTurn(typeof r === "string" ? r : JSON.stringify(r), { next, followLeft: 2, check: false, ...o });
  check("a follow-up stays on the question", (x => x.follow && !x.next)(t({ reply: "Why?", follow: true })));
  check("no follow-up once two were asked: it moves on", (x => !x.follow && x.next === "A1")(t({ reply: "Why?", follow: true }, { followLeft: 0 })));
  check("the next question is one of those shown", (x => x.next === "A3")(t({ reply: "q", next: "A3", known: ["A1", "A2"] })));
  check("known means passed on the way: only those before it", JSON.stringify(t({ reply: "q", next: "A2", known: ["A1", "A3"] }).known) === '["A1"]');
  check("a question it was never shown is not taken: the first not known is", (x => x.next === "A2")(t({ reply: "q", next: "Z9", known: ["A1"] })));
  check("a message that is not an answer asks the same question again", (x => x.again && !x.next && !x.follow)(t({ reply: "You said Porto. So, where were you born?", again: true })));
  check("a reply that is not JSON asks the first question as written", (x => x.fallback && x.next === "A1" && x.question === next[0].text)(t("I could not")));
  check("a read-back turn asks no question of its own", (x => !x.next && !x.follow && x.question === "1. a 2. b 3. c Right?")(t({ question: "1. a 2. b 3. c Right?", next: "A2", follow: true }, { check: true })));
  check("em-dashes leave the reply", !/—/.test(t({ question: "Good — why?", follow: true }).question));
  check("the acknowledgement and the question are read apart", (x => x.ack === "Lyon, noted." && x.question === "Who raised you?" && x.next === "A3")(t({ ack: "Lyon, noted.", question: "Who raised you?", next: "A3" })));
  check("a reply with no question gets the bank's question: it never leaves them nothing to answer",
    (x => x.ack === "Nice to meet you. Let's start at the beginning." && x.question === next[0].text && x.next === "A1")(t({ ack: "Nice to meet you. Let's start at the beginning.", question: "", next: "A1" })));
  check("a question written in the acknowledgement is taken as the question", (x => x.ack === "" && x.question === "Where were you born?")(t({ ack: "Where were you born?", next: "A1" })));
  check("a line that asks nothing is dropped for the bank's question", (x => x.question === next[2].text && x.ack === "Lyon, noted.")(t({ ack: "Lyon, noted.", question: "Let's keep going.", next: "A3" })));
  check("so is another question than the one named: one turn never carries two",
    (x => x.question === next[3].text)(t({ question: "Describe yourself in three words", next: "A4" })));
  check("a question fitted to the person, or in their language, is kept", t({ question: "Qui t'a élevé à Lyon ?", next: "A3" }).question === "Qui t'a élevé à Lyon ?"
    && t({ question: "Describe your childhood home in a sentence", next: "A6" }).question === "Describe your childhood home in a sentence");
  check("a follow-up with no question written moves on instead", (x => !x.follow && x.next === "A1" && x.question === next[0].text)(t({ ack: "Interesting.", follow: true })));
  check("a nudge is read alone: start, go, ok, ask me; a yes is an answer", twin.isNudge("do start") && twin.isNudge("Let's go!") && twin.isNudge("ok") && twin.isNudge("vas-y")
    && !twin.isNudge("yes") && !twin.isNudge("I started in 2018") && !twin.isNudge("go to Lyon"));
  const p = twin.interviewPrompt({ notes: [{ title: "Lyon", line: "Born in Lyon" }], pending: null, answer: "", skipped: false, followLeft: 0, next, check: null, intro: true, date: "2026-10-04" });
  check("the first turn explains how it works, and sees the notes and the next questions", /FIRST TURN/.test(p[0].content) && /Lyon: Born in Lyon/.test(p[1].content)
    && /A1 \| In which city and year were you born\?/.test(p[1].content) && /\(they just opened the interview\)/.test(p[1].content));
  check("it is told to fit each question to what the notes say, one question a turn", /fitted to what their notes say/.test(p[0].content) && /the ONE question you ask now\. Never empty, never two questions/.test(p[0].content));
  const last = twin.interviewPrompt({ notes: [], pending: null, answer: "x", skipped: false, followLeft: 0, next: [], check: null, intro: false, date: "2026-10-04" });
  check("with no question left, it thanks them and points to the twin test", /LAST TURN/.test(last[0].content) && /twin test/.test(last[0].content));
  const gp = twin.readGap("Noted. Where did you grow up? [[G2]]", twin.gaps({}, "x"));
  check("a question asked in passing is read from its tag, and the tag leaves the reply", gp.text === "Noted. Where did you grow up?" && gp.asked?.id === twin.gaps({}, "x")[1].id, JSON.stringify(gp));
  check("a reply with no tag asked nothing", twin.readGap("Noted.", twin.gaps({}, "x")).asked === null);
  check("the everyday reply is offered the questions with their tags", /\[\[G2\]\]/.test(twin.gapBlock(twin.gaps({}, "x"))) && /G1: /.test(twin.gapBlock(twin.gaps({}, "x"))));
}

/* ---- the interview: turns, through the real store ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [
    { _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" },
    { _id: "b2", slug: "health", name: "Health", type: "subject", scope: "s", space: "acme" },
  ];
  const cards = [
    { brain: "me", slug: "lyon", title: "Born in Lyon", summaryLine: "You were born in Lyon in 1994.", updated: "2026-10-01" },
    { brain: "me", slug: "bank", title: "First job", summaryLine: "You started at a bank in 2017.", updated: "2026-10-02" },
    { brain: "me", slug: "porto", title: "Moving to Porto", summaryLine: "You want Porto in 2027.", updated: "2026-10-03" },
    { brain: "health", slug: "sleep", title: "Sleep", summaryLine: "8 hours", updated: "2026-10-03" },
  ];
  const files = [], prompts = [];
  const file = async (text, context) => { files.push({ text, context }); return { new: 1, updated: 0, titles: ["Note"] }; };
  const row = () => T.interviews?.[0] ?? null;
  const step = async (q, reply, opening = false) => twin.interviewStep(ctx, { space: "acme", brain: "me", cards, row: row(), q, opening, date: TODAY, file,
    model: async m => { prompts.push(m); return typeof reply === "string" ? reply : JSON.stringify(reply); } });

  await ctx.runMutation("store.interviewSet", { space: "acme", brain: "me", patch: { on: true } });
  const s1 = await step("", { reply: "One question at a time, say skip to pass. You were born in Lyon: who raised you there?", next: "A3", known: ["A1", "A2"] }, true);
  check("opening asks its first question and files nothing", s1.reply.startsWith("One question") && files.length === 0 && row().pending.id === "A3" && row().on === true);
  check("the questions the notes answer are marked known, never asked", row().marks.A1 === "k" && row().marks.A2 === "k");
  check("the model saw the person's notes, and nothing from their other folders", /Born in Lyon: You were born in Lyon/.test(prompts[0][1].content) && !/Sleep/.test(prompts[0][1].content));
  check("the first start explains how it works", /FIRST TURN/.test(prompts[0][0].content));

  const s2 = await step("My grandmother", { reply: "What did she teach you?", follow: true });
  check("an answer is filed with the question it answers as context", files[0]?.text === "My grandmother" && files[0].context === "The brain asked: " + s1.reply, JSON.stringify(files[0]));
  check("a one-word answer gets a follow-up, and the question stays open", row().pending.id === "A3" && row().pending.follow === 1 && !row().marks.A3 && s2.filed.new === 1);
  await step("Patience, she ran a bakery for 30 years", { reply: "Give me one example?", follow: true });
  check("one follow-up at most: a second is refused, the answer counts and the next question comes",
    row().marks.A3 === "a" && row().pending.id === "A4" && row().pending.follow === 0 && row().sinceCheck === 1);
  check("every question is kept light: one fact, choice, number or sentence, under 30 seconds", /under 30 seconds/.test(prompts.at(-1)[0].content)
    && /Never ask for a list of more than 3/.test(prompts.at(-1)[0].content) && twin.MAX_FOLLOW === 1);

  /* "do start" answers nothing: the question waiting is asked again, unchanged. */
  const callsBefore = prompts.length, filesBefore = files.length;
  const nd = await step("do start", { ack: "Let's go." });
  check("a nudge like \"do start\" files nothing, marks nothing, and asks the waiting question again with no model call",
    prompts.length === callsBefore && files.length === filesBefore && row().pending.id === "A4" && !row().marks.A4 && nd.reply === row().pending.text && nd.reply.length > 8, nd.reply);

  const n = files.length;
  await step("skip", { reply: "What was your first memory?", next: "A5" });
  check("skip passes the question and files nothing", row().marks.A4 === "s" && files.length === n && /\(they skipped this question\)/.test(prompts.at(-1)[1].content));

  const calls = prompts.length;
  const st = await step("stop", { reply: "never asked" });
  check("stop pauses where it stands, with no model call", row().on === false && prompts.length === calls && /^Paused at Life story, 4 of 28\./.test(st.reply), st.reply);
  check("the paused line says how complete the twin is", /Your twin is 1% complete/.test(st.reply), st.reply);

  await ctx.runMutation("store.interviewSet", { space: "acme", brain: "me", patch: { on: true, opens: 1 } });
  await step("", { reply: "Welcome back. What is your first memory?", next: "A5" }, true);
  check("back in the interview the waiting question comes first, and no intro again", /A5 \| What is your first memory\?/.test(prompts.at(-1)[1].content.split("NEXT QUESTIONS")[1])
    && /LAST QUESTION ASKED\n\(none yet\)/.test(prompts.at(-1)[1].content) && !/FIRST TURN/.test(prompts.at(-1)[0].content));

  await ctx.runMutation("store.interviewSet", { space: "acme", brain: "me", patch: { sinceCheck: 9 } });
  const rb = await step("The sea at Biarritz, I was 4", { reply: "Quick check. 1. You want Porto in 2027. 2. You started at a bank in 2017. 3. Born in Lyon in 1994. Right?", follow: true, next: "A6" });
  check("every 10 answers, 3 notes are read back in place of a question", /READ BACK/.test(prompts.at(-1)[0].content) && /CHECK\n1\. Moving to Porto/.test(prompts.at(-1)[1].content)
    && row().pending.kind === "check" && row().sinceCheck === 0 && row().marks.A5 === "a", JSON.stringify(row().pending));
  check("the newest notes are the ones read back", /1\. Moving to Porto[\s\S]*2\. First job[\s\S]*3\. Born in Lyon/.test(prompts.at(-1)[1].content));
  await step("No, the bank was in 2018", { reply: "Fixed. Describe your childhood home?", next: "A6" });
  check("a correction is filed with the read-back as its context, then the interview moves on", files.at(-1).context === "The brain asked: " + rb.reply
    && row().pending.id === "A6" && row().pending.kind === "q");

  const lazy = await step("A flat above the bakery", { ack: "A flat above the bakery, noted.", question: "", next: "A7" });
  check("a model reply with no question still ends on the question, from the bank", /\n\nWhat were you known for as a kid\?$/.test(lazy.reply) && row().pending.id === "A7"
    && row().pending.text === "What were you known for as a kid?", lazy.reply);
  await ctx.runMutation("store.interviewSet", { space: "acme", brain: "me", patch: { pending: { id: "A6", kind: "q", text: "Let's go.", follow: 0 }, marks: { ...row().marks, A6: undefined } } });
  const lost = await step("ok", { ack: "x" });
  check("a waiting question whose words were lost is asked as the bank words it", lost.reply === "What did your childhood home look like, in one sentence?", lost.reply);
  const bad = await step("A flat above the bakery", "not json at all");
  check("a reply that is not JSON still asks a real question", row().pending.id === "A7" && row().marks.A6 === "a" && bad.reply === "What were you known for as a kid?", bad.reply);

  const all = {}; for (const q of twin.QUESTIONS) all[q.id] = "a"; delete all.Q12;
  await ctx.runMutation("store.interviewSet", { space: "acme", brain: "me", patch: { marks: all, pending: { id: "Q12", kind: "q", text: "How often will you update your twin?", follow: 2 }, sinceCheck: 0 } });
  await step("Every Sunday", { reply: "Thank you. The twin test is next." });
  check("the last answer ends the interview", row().on === false && row().marks.Q12 === "a" && !row().pending && /LAST TURN/.test(prompts.at(-1)[0].content));
  const sm = twin.summary(row());
  check("the summary reads 100% with no chapter left", sm.pct === 100 && sm.chapter === null && sm.on === false, JSON.stringify(sm).slice(0, 200));

  let threw = "";
  try { await ctx.runMutation("store.interviewSet", { space: "acme", brain: "health", patch: { on: true } }); } catch (e) { threw = e.message; }
  check("an interview is kept for a personal brain only", /not a personal brain/.test(threw) && T.interviews.length === 1);
  try { threw = ""; await ctx.runMutation("store.interviewSet", { space: "other", brain: "me", patch: { on: true } }); } catch (e) { threw = e.message; }
  check("and only in its own workspace", /not a personal brain/.test(threw));
}

/* ---- an interview answer, filed ---- */
{
  const m = personal.filerPrompt("interview", "My grandmother, she ran a bakery", "The brain asked: Who raised you?", [], [], TODAY);
  check("an answer is filed with the question it answers, as context only", /THE QUESTION IT ANSWERS \(context only, never filed\)\nThe brain asked: Who raised you\?/.test(m[1].content)
    && /THE ANSWER\nMy grandmother/.test(m[1].content));
  check("a plain yes to a read-back files nothing, a correction updates the note", /A plain "yes" or "right" to notes read back files nothing/.test(m[1].content));
  check("an answer told aloud may file up to 6 notes", personal.readNotes(JSON.stringify({ notes: Array.from({ length: 9 }, (_, i) => ({ title: "T" + i, claim: "c" + i })) }), "interview").length === 6);
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const f = await personal.remember(ctx, { space: "acme", brain: "me", cards: [], text: "My grandmother", context: "The brain asked: Who raised you?", kind: "interview", date: TODAY,
    model: async () => JSON.stringify({ notes: [{ title: "Raised by grandmother", claim: "My grandmother raised me", position: "Your grandmother raised you.", summaryLine: "Raised by your grandmother" }] }) });
  const src = T.sources.find(x => x.sid === `me-interview-${TODAY}`);
  check("under the day's interview source, signed You", f.new === 1 && src?.title === `Interview, ${TODAY}` && src.author === "You" && T.concepts[0].evidence[0].author === "You", JSON.stringify(src));
}

/* ---- the twin test and the profile ---- */
{
  const ids = ["C1", "D2", "E3"];
  check("a round keeps only its own questions' answers", JSON.stringify(twin.cleanAnswers({ C1: "  7 ", D2: "", E3: "x", A1: "y", Z1: "old" }, ids)) === '{"C1":"7","E3":"x"}');
  check("a score is a share of the most it could reach", twin.scorePct({ C1: 2, D2: 1, E3: 0, F1: 2 }) === 63 && twin.scorePct({}) === null);
  const pr = twin.pairsText(["C1", "D2", "E3"].map(id => ({ id, q: twin.questionOf(id).text })), { C1: "7", D2: "the job", E3: "speed" }, { C1: "6", E3: "quality" });
  check("the comparison reads each question with both answers, only where both exist", pr.startsWith(`C1: ${twin.questionOf("C1").text}\nA: 7\nB: 6\n\nE3: ${twin.questionOf("E3").text}\nA: speed\nB: quality`) && !/D2/.test(pr), pr);
  check("it says what a match is: same, close or different, by substance and never wording", /2: same answer/.test(twin.JUDGE_RULES) && /1: close/.test(twin.JUDGE_RULES) && /0: different/.test(twin.JUDGE_RULES)
    && /never the wording/.test(twin.JUDGE_RULES));
  check("the same choice for another reason is only close", /same choice for another reason/.test(twin.JUDGE_RULES) && /same choice or view for the same reason/.test(twin.JUDGE_RULES));
  check("the scores it returns are kept for the pairs it was given, 0, 1 or 2 only",
    JSON.stringify(twin.readScores('Sure: {"scores":{"C1":2,"E3":"1","D2":2,"E9":2,"F1":7}}', { C1: "6", E3: "quality", F1: "x" })) === '{"C1":2,"E3":1}'
    && JSON.stringify(twin.readScores("no json", { C1: "a" })) === "{}");

  /* A round: 5 questions never asked in a test before, from chapters a twin can answer, one to a chapter. */
  const r1 = twin.pickTest({}, [], 1), again = twin.pickTest({}, [], 1), r2 = twin.pickTest({}, [], 2);
  check("a round is 5 questions, one to a chapter, from the chapters a twin can answer from who you are", r1.length === 5 && new Set(r1.map(q => q.ch)).size === 5
    && r1.every(q => "CDEGIJLMNOPQ".includes(q.ch)), JSON.stringify(r1.map(q => q.id)));
  check("the same history gives the same round, another seed another one", JSON.stringify(r1) === JSON.stringify(again) && JSON.stringify(r1.map(q => q.id)) !== JSON.stringify(r2.map(q => q.id)));
  const hist = [{ items: r1.map(q => ({ id: q.id })) }];
  const r3 = twin.pickTest({}, hist, 1);
  check("a question asked in a test is never asked again while the bank has others", r3.length === 5 && !r3.some(q => r1.some(x => x.id === q.id)), JSON.stringify(r3.map(q => q.id)));
  const mk = Object.fromEntries(twin.QUESTIONS.filter(q => q.ch === "C").slice(0, 19).map(q => [q.id, "a"]));
  const r4 = twin.pickTest(mk, [], 5);
  check("a question the interview has not covered comes before one it has", r4.filter(q => q.ch === "C").every(q => !mk[q.id]), JSON.stringify(r4.map(q => q.id)));
  const all = twin.QUESTIONS.map(q => ({ id: q.id }));
  const r5 = twin.pickTest({}, [{ items: all }, { items: all }], 3);
  check("a bank used up is asked again rather than leaving a round short", r5.length === 5);
  const row = { test: { round: { at: "2026-10-06", ids: ["C1", "D2"], mine: { C1: "a" }, twin: { C1: "b" } },
    history: [{ at: "2026-10-01", pct: 80, learned: true, items: [] }, { at: "2026-09-20", pct: 60, learned: false, items: [] }, { at: "2026-09-10", pct: 70, learned: true, items: [] }, { at: "2026-09-01", pct: null, items: [] }] } };
  const tv = twin.testView(row), sm = twin.summary(row);
  check("the app sees the open round's questions with your answers and the twin's, and the history", tv.round.questions.map(q => q.id).join() === "C1,D2" && tv.round.mine.C1 === "a" && tv.round.twin.C1 === "b" && tv.history.length === 4);
  check("the score is the latest test's, and the average of the last 3 scored", sm.test.count === 4 && sm.test.last.pct === 80 && sm.test.recent === 70 && sm.test.open === true, JSON.stringify(sm.test));
  check("with no test taken there is no score", twin.summary({}).test.last === null && twin.summary({}).test.count === 0 && twin.testView({}).round === null);
  check("a full interview has nothing left to ask", twin.interviewFull({ pct: 100, covered: 335, total: 335 }) && twin.interviewFull({ pct: 99, covered: 335, total: 335 })
    && !twin.interviewFull({ pct: 99, covered: 300, total: 335 }) && !twin.interviewFull(null));
  check("the twin answers in their voice from the notes alone, works the answer out, and says which notes it used",
    /Use what the notes say or clearly imply/.test(twin.TWIN_RULES) && /first person/.test(twin.TWIN_RULES) && /Work it out from the notes/.test(twin.TWIN_RULES) && /"because"/.test(twin.TWIN_RULES));
  const tw = twin.readTwin('{"answers":{"C1":"7 — maybe","T1":{"a":"I refuse — Sundays are free","because":"Your notes say you keep Sundays free."},"T9":"x","D2":{"a":""}}}', ["C1", "T1", "D2"]);
  check("its answers are read by question with their reasons, em-dashes out, and an empty one is no answer",
    JSON.stringify(tw) === '{"answers":{"C1":"7, maybe","T1":"I refuse, Sundays are free"},"because":{"T1":"Your notes say you keep Sundays free."}}', JSON.stringify(tw));
  check("a reply that is no JSON gives no answers", JSON.stringify(twin.readTwin("sorry", ["C1"])) === '{"answers":{},"because":{}}');
  const parts = twin.readProfile(JSON.stringify({ parts: [{ title: "Voice", points: ["Short — direct"] }, { title: "Identity", points: ["Builder", ""] }, { title: "Other", points: ["x"] }] }));
  check("the profile comes back in its 7 parts' order, empty and unknown parts out", parts.map(p => p.title).join() === "Identity,Voice" && parts[1].points[0] === "Short, direct", JSON.stringify(parts));
  check("the profile names its 7 parts and says which chapters fill an empty one", /Identity, Values, Beliefs, Decision rules, Voice, Knowledge, Boundaries/.test(twin.PROFILE_RULES) && /Voice G/.test(twin.PROFILE_RULES));
  const nt = twin.notesText([{ title: "Old", position: "old", updated: "2026-01-01" }, { title: "New", position: "new", updated: "2026-10-01" }], 18);
  check("notes are read newest first, within a cap", nt.text === "- New: new" && nt.used === 1 && nt.total === 2, JSON.stringify(nt));
}

/* ---- the twin test: questions built from the notes, to deduce rather than recall ---- */
{
  check("it asks for 5 deductions, built on named notes, never a fact a note states", /Write 5 questions/.test(twin.DEDUCE_RULES) && /never state/.test(twin.DEDUCE_RULES)
    && /"basis"/.test(twin.DEDUCE_RULES) && /Never a fact a note already states word for word/.test(twin.DEDUCE_RULES) && /never about another person/.test(twin.DEDUCE_RULES)
    && /No em-dashes/.test(twin.DEDUCE_RULES) && twin.DEDUCE_MIN === 6);
  const titles = ["Sundays are free", "Turned down the agency deal", "Cash buffer of 8 months", "Prefers shipping small"];
  const raw = JSON.stringify({ questions: [
    { q: "A client offers 20,000 euros for 3 weeks of work that needs your Sundays. Do you take it, and why?", basis: ["Sundays are free", "Cash buffer of 8 months"] },
    { q: "You can launch Friday with 3 of 5 features, or wait a month. Which, and why?", basis: ["prefers shipping small"] },
    { q: "Where were you born, and why does it matter to you?", basis: ["Nothing like this note"] },
    { q: "Tell me about your childhood home.", basis: ["Sundays are free"] },
    { q: "An agency asks you to join for a steady salary. What do you answer — and why?", basis: ["Turned down the agency"] },
    { q: "Too short?", basis: ["Sundays are free"] },
    { q: "A friend asks you to lend 5,000 euros from your buffer. Do you, and why?", basis: ["Cash buffer of 8 months"] },
    { q: "Your agency offer repeats a Sunday weekend job. Do you accept, and why?", basis: ["Sundays are free", "Sundays are free"] },
  ] });
  const qs = twin.readQuestions(raw, titles, ["A client offers 20,000 euros for 3 weeks of work that needs your Sundays. Do you take it?"]);
  check("a question stays when it rests on a real note, even loosely named, and reads as a question",
    qs.map(x => x.q.slice(0, 28)).join("|") === "You can launch Friday with 3|An agency asks you to join f|A friend asks you to lend 5,|Your agency offer repeats a ", JSON.stringify(qs));
  check("it drops one whose notes do not exist, one that is no question, one too short, and one asked before",
    !qs.some(x => /born|childhood|Too short|20,000/.test(x.q)));
  check("its notes are named by their own titles, once each, and the ids are T1, T2, T3, T4", JSON.stringify(qs.map(x => [x.id, x.basis])) ===
    '[["T1",["Prefers shipping small"]],["T2",["Turned down the agency deal"]],["T3",["Cash buffer of 8 months"]],["T4",["Sundays are free"]]]', JSON.stringify(qs));
  check("em-dashes are taken out of a question", !/—/.test(qs[1].q) && /answer, and why\?$/.test(qs[1].q), qs[1].q);
  const themes = ["holidays", "salary", "mentors", "deadlines", "contracts", "hiring", "travel", "pricing", "feedback"];
  check("a round holds 5 at most, and a reply that is no JSON holds none", twin.readQuestions(JSON.stringify({ questions: themes.map(t =>
    ({ q: `Facing a hard choice about ${t} this week, what do you do, and why?`, basis: ["Sundays are free"] })) }), titles).length === 5 && twin.readQuestions("no", titles).length === 0);

  check("an older round holds bank ids, and the bank has the words", JSON.stringify(twin.roundQs({ ids: ["C1", "Z9"] })) === JSON.stringify([{ id: "C1", q: twin.questionOf("C1").text }]));
  const built = { at: "2026-10-06", qs: [{ id: "T1", q: "Do you take it, and why?", basis: ["Sundays are free"] }, { id: "C1", q: twin.questionOf("C1").text }], note: "failed",
    mine: { T1: "No, Sundays are free" }, twin: { T1: "No" }, because: { T1: "Your notes say Sundays are free" } };
  check("a round keeps the text of what was built, and the notes it rests on", JSON.stringify(twin.roundQs(built)) === JSON.stringify([{ id: "T1", q: "Do you take it, and why?", basis: ["Sundays are free"] }, { id: "C1", q: twin.questionOf("C1").text }]));
  const v = twin.testView({ test: { round: built, history: [] } });
  check("the app sees each question's notes, the twin's reasons and why a round came from the bank",
    v.round.questions[0].basis[0] === "Sundays are free" && v.round.questions[1].basis.length === 0 && v.round.because.T1 === "Your notes say Sundays are free" && v.round.note === "failed", JSON.stringify(v.round));
}

/* ---- contacts: one card per person, the whole of what was said ---- */
{
  const marc = { brain: "me", slug: "marc", title: "Marc Dupont", tag: "contact", aliases: ["my co-founder"], summaryLine: "Your co-founder" };
  const mom = { brain: "me", slug: "mother", title: "Mother", tag: "contact", aliases: [], summaryLine: "Your mother" };
  check("a contact is found by its first name, a name it goes by, or its role", personal.namedIn([marc, mom], "Lunch with Marc today")[0] === marc
    && personal.namedIn([marc, mom], "my co-founder called")[0] === marc && personal.namedIn([marc, mom], "dîner chez ma mother")[0] === mom
    && personal.namedIn([marc, mom], "Marcel came by").length === 0);
  const m = personal.filerPrompt("chat", "Marc left Finary", "", [{ ...marc, position: "Your co-founder. ".repeat(100), evidence: [{ date: "2026-10-01" }] }], [], TODAY, [marc, mom]);
  const u = m[1].content;
  check("the filer is told every person gets one file, never two, and sends only what is new", /Every person they mention gets a file of their own/.test(u)
    && /Never make a second file for the same person/.test(u) && /Send only what THE MESSAGE adds/.test(u) && /never loses what the file held/.test(u));
  check("it is asked for facts by section, dated moments told as anecdotes, links and open items", /"facts": each lasting fact/.test(u) && /identity, contact, you, work, tastes, other/.test(u)
    && /"text" tells the moment as an anecdote, with every detail given/.test(u) && /worked out from TODAY/.test(u) && /"links": the people linked to this person/.test(u)
    && /"replaces": true/.test(u) && /"open": promises/.test(u));
  check("it sees every contact with the names they go by", /- "Marc Dupont" \(also: my co-founder\): Your co-founder/.test(u) && /- "Mother": Your mother/.test(u));
  check("and the summary of anyone named, whole", /- CONTACT "Marc Dupont"\n  SUMMARY: (Your co-founder\. ){50}/.test(u), u.slice(u.indexOf("CONTACT"), u.indexOf("CONTACT") + 80));
  const ppl = personal.readPeople(JSON.stringify({ people: [{ name: "Paul — Graham", claim: "Paul invests early", also: ["PG", ""], position: "", date: "2026-02-30x" }, { name: "x", claim: "y" }] }), "chat");
  check("people are read clean: em-dashes out, empty names dropped, a bad date ignored", ppl.length === 1 && ppl[0].name === "Paul, Graham" && JSON.stringify(ppl[0].also) === '["PG"]'
    && ppl[0].position === "Paul invests early" && ppl[0].date === "", JSON.stringify(ppl));

  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const prompts = [];
  const model = reply => async m => { prompts.push(m[1].content); return JSON.stringify(reply); };
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  const f1 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: TODAY,
    text: "Lunch with Marc today. He's raising 2M for his fintech in Lisbon. I owe him an intro to Paul.",
    model: model({ notes: [{ title: "Intros to make", claim: "I owe Marc an intro to Paul", position: "You owe Marc an intro to Paul.", summaryLine: "Intro Marc to Paul" }],
      people: [{ name: "Marc", also: ["my co-founder"], claim: "He's raising 2M for his fintech in Lisbon", position: "Your co-founder. Raising 2M euros for his fintech in Lisbon (2026-09-30). You owe him an intro to Paul.", summaryLine: "Your co-founder, raising 2M in Lisbon" },
               { name: "Paul", claim: "I owe Marc an intro to Paul", position: "You plan to introduce him to Marc (2026-09-30).", summaryLine: "Someone you will introduce to Marc" }] }) });
  const cards = () => T.concepts.filter(c => c.tag === "contact");
  check("each person gets a card tagged contact, with their other names", cards().length === 2 && cards().find(c => c.title === "Marc")?.aliases.includes("my co-founder")
    && JSON.stringify(f1.people) === '["Marc","Paul"]' && f1.new === 1, JSON.stringify({ f1, c: cards().map(c => c.title) }));
  check("a card holds the whole of what was said, and the mention dated, signed You", /Raising 2M euros/.test(cards()[0].position) && cards()[0].evidence[0].date === TODAY
    && cards()[0].evidence[0].author === "You");
  check("the list cards carry the tag, so the app can show People apart", (await load()).filter(c => c.tag === "contact").length === 2);

  const f2 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-04", text: "Marc D. left the fintech, he joins Revolut in London",
    model: model({ notes: [], people: [{ name: "Marc D.", update: "Marc", also: ["Marc D."], claim: "Marc left the fintech, he joins Revolut in London",
      position: "Your co-founder. Joins Revolut in London (2026-10-04); he ran a fintech in Lisbon until then. You owe him an intro to Paul.", summaryLine: "Your co-founder, now at Revolut in London" }] }) });
  const mc = cards().find(c => c.title === "Marc");
  check("a new fact updates the same card, never a second one", cards().length === 2 && /Revolut in London/.test(mc.position) && mc.evidence.length === 2
    && mc.evidence[0].date === "2026-10-04" && JSON.stringify(f2.people) === '["Marc"]', JSON.stringify(mc));
  check("the card keeps every name used for the person", mc.aliases.includes("Marc D.") && mc.aliases.includes("my co-founder"), JSON.stringify(mc.aliases));
  check("the filer saw Marc's card whole before writing to it", /- CONTACT "Marc"\n  SUMMARY: Your co-founder\. Raising 2M euros/.test(prompts[1]), prompts[1].slice(prompts[1].indexOf("HELD NOW"), prompts[1].indexOf("HELD NOW") + 300));

  const before = mc.position;
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-05", text: "Marc is tired lately",
    model: model({ notes: [{ title: "Marc", update: "Marc", claim: "Marc is tired lately", position: "Marc is tired.", summaryLine: "Tired" }] }) });
  const mc2 = cards().find(c => c.title === "Marc");
  check("a note never overwrites a person's card: what it says joins the card as a dated mention", mc2.position === before && mc2.evidence.length === 3 && mc2.evidence[0].claim === "Marc is tired lately");

  const f4 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "people", date: TODAY, text: "- Trip (2026-03-02): You went to Porto with Lea.",
    model: model({ notes: [{ title: "Should not", claim: "x" }], people: [{ name: "Lea", claim: "went to Porto with Lea", position: "A friend you went to Porto with (2026-03-02).", summaryLine: "A friend", date: "2026-03-02" }] }) });
  const lea = cards().find(c => c.title === "Lea");
  check("reading old notes files people only, dated by the note they came from", f4.new === 0 && lea?.evidence[0].date === "2026-03-02" && !T.concepts.some(c => c.title === "Should not")
    && T.sources.some(x => x.title === `People in your notes, ${TODAY}`), JSON.stringify({ f4, lea }));
}

/* ---- a person is never lost: an unread reply is retried, a known name is caught ---- */
{
  const max = { brain: "me", slug: "maxime", title: "Maxime", tag: "contact", aliases: ["Max"], summaryLine: "Your friend" };
  check("a contact named with a capital is caught, a role word in lower case is not", personal.properlyNamed([max], "today Maxime arrived")[0] === max
    && personal.properlyNamed([max], "Max is here").length === 1 && personal.properlyNamed([{ ...max, title: "Mother", aliases: [] }], "my mother nature walk").length === 0
    && personal.properlyNamed([max], "maximum effort").length === 0);
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  let threw = "";
  try { await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: TODAY, text: "Maxime arrived", model: async () => '{"notes":[{"title":"Max' }); }
  catch (e) { threw = e.message; }
  check("a reply cut short is a failure to retry, never \"nothing to file\"", /could not be read/.test(threw) && !(T.concepts ?? []).length, threw);
  const f = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-04", text: "today 04th october Maxime arrived, we spend a week together",
    model: async () => JSON.stringify({ notes: [], people: [{ name: "Maxime", claim: "Maxime arrived, we spend a week together", position: "Arrived on 2026-10-04 to spend a week with you.", summaryLine: "Spending a week with you from 4 Oct" }] }) });
  check("the message from your screen makes Maxime's card", JSON.stringify(f.people) === '["Maxime"]' && T.concepts.find(c => c.title === "Maxime")?.tag === "contact", JSON.stringify(f));
  const f2 = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-05", text: "Cooked dinner with Maxime tonight",
    model: async () => JSON.stringify({ notes: [{ title: "Cooking", claim: "Cooked dinner tonight", position: "You cooked dinner.", summaryLine: "Cooked" }], people: [] }) });
  const mx = T.concepts.find(c => c.title === "Maxime");
  check("a known person the filer missed still gets the mention, dated, the card kept", JSON.stringify(f2.people) === '["Maxime"]' && mx.evidence.length === 2
    && mx.evidence[0].claim === "Cooked dinner with Maxime tonight" && mx.evidence[0].date === "2026-10-05" && /Arrived on 2026-10-04/.test(mx.position), JSON.stringify(mx.evidence));
}

/* ---- a person's card, edited and merged by hand ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" },
    { _id: "b2", slug: "health", name: "Health", type: "subject", scope: "s", space: "acme" }];
  const card = (slug, title, extra = {}) => ({ _id: "c-" + slug, brain: "me", slug, n: 1, title, position: `${title}'s card.`, summaryLine: title, tag: "contact", aliases: [],
    evidence: [{ date: "2026-10-0" + (slug.length % 9), author: "You", claim: `about ${title}`, source: "s" }], data: [], conflicts: [], sources: ["s-" + slug], related: [], updated: "2026-10-01", ...extra });
  T.concepts = [card("paul", "Paul"), card("paul-martin", "Paul Martin", { aliases: ["PM"] }), card("marc", "Marc"),
    { _id: "n1", brain: "me", slug: "trip", n: 2, title: "Trip", position: "x", summaryLine: "x", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01" },
    { _id: "h1", brain: "health", slug: "sleep", n: 1, title: "Sleep", tag: "contact", position: "x", summaryLine: "x", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01" }];
  const run = (name, args) => store[name].handler({ db: ctx.db }, args);
  await run("contactEdit", { space: "acme", id: "me/marc", title: "Marc Dupont", aliases: ["my co-founder", " ", "Marc Dupont"], summaryLine: "Your co-founder", position: "Your co-founder since 2024." });
  const m = T.concepts.find(c => c.slug === "marc");
  check("an edit renames a person in place, the old name kept as another name", m.title === "Marc Dupont" && JSON.stringify(m.aliases) === '["my co-founder","Marc"]'
    && m.position === "Your co-founder since 2024." && m.summaryLine === "Your co-founder" && m.evidence.length === 1, JSON.stringify(m));
  let threw = "";
  try { await run("contactEdit", { space: "acme", id: "me/marc", title: "Paul" }); } catch (e) { threw = e.message; }
  check("a name another card holds is refused: merge the two instead", /already has a card: merge the two instead/.test(threw), threw);
  for (const [id, sp] of [["me/trip", "acme"], ["health/sleep", "acme"], ["me/paul", "other"]]) {
    threw = ""; try { await run("contactEdit", { space: sp, id, title: "X Y" }); } catch (e) { threw = e.message; }
    check(`only a contact of your own personal folder is edited (${id} in ${sp})`, /not in your personal folder/.test(threw), threw);
  }
  const r = await run("contactMerge", { space: "acme", into: "me/paul-martin", from: ["me/paul", "me/paul-martin", "me/nope"] });
  const pm = T.concepts.find(c => c.slug === "paul-martin");
  check("a merge folds the other card in: its mentions, sources and names join, and it goes", r.joined === 1 && !T.concepts.some(c => c.slug === "paul")
    && pm.evidence.length === 2 && pm.sources.includes("s-paul") && JSON.stringify(pm.aliases) === '["PM","Paul"]', JSON.stringify(pm));
  check("both cards' text is kept side by side until written again as one", pm.position === "Paul Martin's card.\n\nPaul's card.", JSON.stringify(pm.position));
  check("the list cards follow: the folded card's card is gone", !(T.cards ?? []).some(c => c.slug === "paul") && (T.cards ?? []).find(c => c.slug === "paul-martin")?.aliases?.includes("Paul"));
}

/* ---- a person's file: a summary on top, then everything, and it only grows ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const prompts = [];
  const model = reply => async m => { prompts.push(m[1].content); return JSON.stringify(reply); };
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-04",
    text: "Today Maxime arrived from Lyon, we spend a week together. His number is 06 12 34 56 78. He still works at Airbus, his girlfriend Clara joins Friday.",
    model: model({ notes: [], people: [
      { name: "Maxime", claim: "Maxime arrived from Lyon, we spend a week together", summary: "Your friend from Lyon, an engineer at Airbus, staying with you this week.", summaryLine: "Your friend from Lyon, at Airbus",
        facts: [{ section: "contact", label: "Phone", value: "06 12 34 56 78" }, { section: "work", label: "Company", value: "Airbus" }, { section: "identity", label: "Lives in", value: "Lyon" }],
        events: [{ date: "2026-10-04", text: "Maxime arrived from Lyon to spend a week with you.", seen: true }],
        links: [{ name: "Clara", rel: "his girlfriend" }], open: [{ text: "Pick up Clara on Friday" }] },
      { name: "Clara", claim: "his girlfriend Clara joins Friday", summary: "Maxime's girlfriend.", summaryLine: "Maxime's girlfriend",
        events: [{ date: "2026-10-09", text: "Clara joins you and Maxime." }], links: [{ name: "Maxime", rel: "her boyfriend" }] }] }) });
  const mx = () => T.concepts.find(c => c.title === "Maxime");
  /* A person read whole: the file with its moments, as every reader gets it. */
  const whole = async slug => (await store.conceptsByIds.handler({ db: ctx.db }, { space: "acme", ids: [`me/${slug}`] }))[0];
  const mxw = () => whole("maxime");
  const f = (await mxw()).file;
  check("the summary sits on top, the file underneath", mx().position === "Your friend from Lyon, an engineer at Airbus, staying with you this week." && f.v === 1);
  check("contact details, work and identity are kept as facts by section", f.facts.map(x => `${x.s}:${x.l}:${x.v}`).join("|") === "contact:Phone:06 12 34 56 78|work:Company:Airbus|identity:Lives in:Lyon", JSON.stringify(f.facts));
  check("the moment is dated, and the day you were together is the last time seen", f.events[0].d === "2026-10-04" && f.seen === "2026-10-04"
    && (await load()).find(c => c.title === "Maxime").seen === "2026-10-04", JSON.stringify(f.events));
  check("the people linked to him, and what is open", f.links[0].n === "Clara" && f.links[0].r === "his girlfriend" && f.open[0].t === "Pick up Clara on Friday");
  check("each linked person gets a file of their own", T.concepts.find(c => c.title === "Clara")?.file?.links[0]?.n === "Maxime");

  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-06",
    text: "Yesterday Maxime told me he quits Airbus for a startup in Paris, we had sushi at Kinugawa. I picked up Clara.",
    model: model({ notes: [], people: [{ name: "Maxime", update: "Maxime", claim: "Maxime quits Airbus for a startup in Paris", summary: "Your friend from Lyon, leaving Airbus for a startup in Paris.", summaryLine: "Your friend, off to a Paris startup",
      facts: [{ section: "work", label: "Company", value: "A startup in Paris", replaces: true, since: "2026-10-05" }, { section: "work", label: "Company", value: "A startup in Paris" }],
      events: [{ date: "2026-10-05", text: "Over sushi at Kinugawa, Maxime told you he quits Airbus for a startup in Paris.", seen: true },
               { date: "2026-10-04", text: "Maxime arrived from Lyon to spend a week with you.", seen: true }],
      open: [{ text: "Pick up Clara on Friday", done: true }] }] }) });
  const g = (await mxw()).file;
  check("each moment is a row of its own, and the file keeps none: a person grows without a size limit",
    !("events" in mx().file) && T.moments.filter(r => r.slug === "maxime").length === 2 && mx().file.n === 2, JSON.stringify(mx().file));
  check("a changed fact keeps the old one, closed on the day it changed", g.facts.filter(x => x.l === "Company").map(x => `${x.v}${x.until ? " until " + x.until : ""}`).join("|") === "Airbus until 2026-10-05|A startup in Paris",
    JSON.stringify(g.facts));
  check("a new moment joins the history, newest first, and a moment told twice stays once", g.events.length === 2 && g.events[0].d === "2026-10-05" && /Kinugawa/.test(g.events[0].t) && g.seen === "2026-10-05");
  check("a promise kept is marked done, never deleted", g.open.length === 1 && g.open[0].done === "2026-10-06");
  check("facts given before stay: phone and city are still there", g.facts.some(x => x.l === "Phone") && g.facts.some(x => x.l === "Lives in" && !x.until));
  check("the filer saw Maxime's whole file before adding to it", /- CONTACT "Maxime"\n  SUMMARY: Your friend from Lyon[\s\S]*Contact details, Phone: 06 12 34 56 78[\s\S]*LINKED TO: Clara \(his girlfriend\)[\s\S]*STILL OPEN: Pick up Clara on Friday[\s\S]*LAST SEEN: 2026-10-04[\s\S]*HISTORY, NEWEST FIRST\n  - 2026-10-04 \(together\): Maxime arrived/.test(prompts[1]),
    prompts[1].slice(prompts[1].indexOf('CONTACT "Maxime"'), prompts[1].indexOf('CONTACT "Maxime"') + 600));

  const merged = words.mergeFile({ facts: [{ k: "a", s: "work", l: "Company", v: "Airbus", at: "2026-01-01" }], events: [{ k: "e", d: "2025", t: "Met in Lyon", at: "2026-01-01" }] },
    { facts: [{ s: "work", l: "Company", v: "Airbus", at: "2026-02-01" }, { s: "nonsense", l: "Shoe size", v: "44" }], events: [{ d: "2025", t: "met in lyon" }, { d: "bad", t: "Called him" }] }, "2026-10-06");
  check("two files merge without doubles; an unknown section goes to Other, a bad date to the day told",
    merged.facts.length === 2 && merged.facts[1].s === "other" && merged.events.length === 2 && merged.events.some(x => x.d === "2026-10-06" && x.t === "Called him"), JSON.stringify(merged));
  check("the dossier an answer reads carries the person's file", /THE PERSON'S FILE\nFACTS/.test(words.fileText(await mxw(), 4000) ? `THE PERSON'S FILE\n${words.fileText(await mxw(), 4000)}` : ""));

  /* Building files for people held before files existed: no new mention, no new source. */
  T.concepts.push({ _id: "old1", brain: "me", slug: "lea", n: 9, title: "Lea", tag: "contact", position: "A friend you went to Porto with.", summaryLine: "A friend",
    evidence: [{ date: "2026-03-02", author: "You", claim: "Went to Porto with Lea", source: "s" }], data: [], conflicts: [], sources: ["s"], related: [], updated: "2026-03-02" });
  const before = { ev: 1, src: T.sources.length };
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "files", date: "2026-10-06", text: '- CONTACT "Lea"\n  CARD: A friend you went to Porto with.',
    model: model({ notes: [{ title: "Not filed", claim: "x" }], people: [{ name: "Lea", update: "Lea", claim: "Went to Porto with Lea", summary: "A friend you travelled to Porto with in March 2026.",
      events: [{ date: "2026-03-02", text: "You went to Porto with Lea.", seen: true }] }] }) });
  const lea = { ...T.concepts.find(c => c.title === "Lea"), file: (await whole("lea")).file };
  check("building a file from an old card adds the history, and no mention or source", lea.file?.events[0]?.d === "2026-03-02" && lea.evidence.length === before.ev
    && T.sources.length === before.src && !T.concepts.some(c => c.title === "Not filed"), JSON.stringify({ lea, src: T.sources.length }));
  check("files are asked for only for people held, by their title", /File ONLY these people, each with \\"update\\" set to their title/.test(prompts.at(-1)) || /File ONLY these people/.test(prompts.at(-1)));

  /* By hand: a wrong line taken out, a promise reopened. */
  const run = (name, args) => store[name].handler({ db: ctx.db }, args);
  const ev = (await mxw()).file.events.find(x => /Kinugawa/.test(x.t));
  await run("contactPart", { space: "acme", id: "me/maxime", part: "event", key: ev.k });
  check("one wrong moment can be taken out, and the last time seen follows", (await mxw()).file.events.length === 1 && mx().file.seen === "2026-10-04");
  await run("contactPart", { space: "acme", id: "me/maxime", part: "open", key: mx().file.open[0].k, done: false });
  check("a promise can be opened again", !("done" in mx().file.open[0]));
  const linking = await store.contactsLinking.handler({ db: ctx.db }, { space: "acme", id: "me/clara" });
  check("a file knows who links to it", linking.length === 1 && linking[0].title === "Maxime" && linking[0].rel === "his girlfriend", JSON.stringify(linking));
}

/* ---- languages: written in any, kept in English, answered as set ---- */
{
  const en = personal.filerPrompt("chat", "Maxime est arrivé aujourd'hui", "", [], [], TODAY, [], "en")[1].content;
  const same = personal.filerPrompt("chat", "Maxime est arrivé aujourd'hui", "", [], [], TODAY, [], "same")[1].content;
  check("kept in English, every field is written in English whatever the language written in", /Write every field in English, whatever language they write in/.test(en)
    && /"claim": what they said, in one sentence, in English/.test(en) && /"orig" holds that sentence as they wrote it/.test(en) && /"orig":""/.test(en));
  check("kept as written, the filer keeps their language", /Keep their language/.test(same) && !/"orig"/.test(same) && !/Write every field in English/.test(same));
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: TODAY, lang: "en", text: "Je veux courir un marathon en 2027. Maxime est arrivé.",
    model: async () => JSON.stringify({ notes: [{ title: "Marathon", claim: "I want to run a marathon in 2027", orig: "Je veux courir un marathon en 2027", position: "You want to run a marathon in 2027.", summaryLine: "A marathon in 2027" }],
      people: [{ name: "Maxime", claim: "Maxime arrived", orig: "Maxime est arrivé", summary: "A friend who arrived today." }] }) });
  const mar = T.concepts.find(c => c.title === "Marathon"), mx = T.concepts.find(c => c.title === "Maxime");
  check("the note is kept in English, with their own words beside it", mar.evidence[0].claim === "I want to run a marathon in 2027" && mar.evidence[0].orig === "Je veux courir un marathon en 2027");
  check("and so is a person's mention", mx.evidence[0].claim === "Maxime arrived" && mx.evidence[0].orig === "Maxime est arrivé");
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: TODAY, lang: "en", text: "I sleep 7 hours",
    model: async () => JSON.stringify({ notes: [{ title: "Sleep", claim: "I sleep 7 hours", orig: "I sleep 7 hours", position: "You sleep 7 hours." }] }) });
  check("words already in English keep no copy beside them", !("orig" in T.concepts.find(c => c.title === "Sleep").evidence[0]));
  const ask = twin.interviewPrompt({ notes: [], pending: null, answer: "Lyon", skipped: false, followLeft: 1, next: twin.ahead({}, 2), check: null, intro: false, date: TODAY, english: true })[0].content;
  check("answers set to English: the interview asks in English", /Write in English, whatever language they write in/.test(ask) && !/Write in the language of their message/.test(ask));
}

/* ---- a person's raw notes: everything said about them, word for word ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" },
    { _id: "b2", slug: "health", name: "Health", type: "subject", scope: "s", space: "acme" }];
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  const said = "Aujourd'hui Maxime est arrivé de Lyon.\nOn passe la semaine ensemble.";
  const max = async (o = {}) => personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-04", lang: "en", text: said,
    model: async () => JSON.stringify({ notes: [], people: [{ name: "Maxime", claim: "Maxime arrived from Lyon", orig: "Maxime est arrivé de Lyon", summary: "A friend from Lyon." }] }), ...o });
  await max();
  const rows = () => T.rawNotes ?? [];
  check("a message about a person is kept whole in their raw notes, as typed, in its language",
    rows().length === 1 && rows()[0].text === said && rows()[0].kind === "chat" && rows()[0].date === "2026-10-04" && rows()[0].slug === "maxime", JSON.stringify(rows()));
  await max();
  check("the same words on the same day are kept once, so a retry adds nothing", rows().length === 1);
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-05", text: "Cooked with Maxime tonight",
    model: async () => JSON.stringify({ notes: [{ title: "Cooking", claim: "Cooked tonight", position: "You cooked.", summaryLine: "Cooked" }], people: [] }) });
  check("a person the filer missed still gets the message in their raw notes", rows().length === 2 && rows()[1].text === "Cooked with Maxime tonight");
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "interview", date: "2026-10-05", context: "The brain asked: Who is your oldest friend?",
    text: "Maxime, since school", model: async () => JSON.stringify({ notes: [], people: [{ name: "Maxime", update: "Maxime", claim: "Maxime is your oldest friend, since school" }] }) });
  check("an interview answer keeps the question it answered", rows()[2]?.kind === "interview" && rows()[2].asked === "Who is your oldest friend?" && rows()[2].text === "Maxime, since school",
    JSON.stringify(rows()[2]));
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "import", date: "2026-10-05", text: "Notes: I like tea. Lea lives in Porto and paints. I run.",
    model: async () => JSON.stringify({ notes: [], people: [{ name: "Lea", claim: "Lea lives in Porto", raw: "Lea lives in Porto and paints." }] }) });
  check("a pasted import keeps the sentences about that person, word for word", rows().find(r => r.slug === "lea")?.text === "Lea lives in Porto and paints.");
  const n = rows().length;
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "files", date: "2026-10-06", text: '- CONTACT "Lea"\n  CARD: Lives in Porto.',
    model: async () => JSON.stringify({ notes: [], people: [{ name: "Lea", update: "Lea", claim: "Lea lives in Porto", events: [{ date: "2026-03", text: "You met Lea in Porto." }] }] }) });
  check("building a file from what is held adds no raw note", rows().length === n);
  const got = await store.rawOf.handler({ db: ctx.db }, { space: "acme", id: "me/maxime" });
  check("a person's raw notes read newest first, with their count", got.total === 3 && got.notes[0].text === "Maxime, since school" && got.notes[2].text === said, JSON.stringify(got));
  const other = await store.rawOf.handler({ db: ctx.db }, { space: "other", id: "me/maxime" });
  check("another workspace reads none of them", other.total === 0 && !other.notes.length);

  /* The chats still kept give the raw notes of people filed before raw notes existed. */
  T.concepts.push({ _id: "cp", brain: "me", slug: "paul", n: 7, title: "Paul", tag: "contact", aliases: ["Polo"], position: "x", summaryLine: "x",
    evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-09-20" });
  const at = d => Date.parse(d + "T10:00:00Z");
  T.chats = [
    { _id: "ch1", space: "acme", brain: "me", title: "x", pinned: false, created: at("2026-09-20"), updated: at("2026-09-21"), turns: [
      { q: "Paul called me about the flat", a: "Noted.", at: at("2026-09-20"), filed: { people: ["Paul"] } },
      { q: "", a: "Thanks.\nWho is your oldest friend?", at: at("2026-09-21"), interview: true },
      { q: "Polo, since 1998", a: "Noted.", at: at("2026-09-21"), interview: true, filed: { people: ["Polo"] } },
      { q: "I like tea", a: "Noted.", at: at("2026-09-21"), filed: { people: [] } }] },
    { _id: "ch2", space: "acme", brain: "health", title: "y", pinned: false, created: at("2026-09-20"), updated: at("2026-09-20"),
      turns: [{ q: "Paul sleeps badly", a: "x", at: at("2026-09-20"), filed: { people: ["Paul"] } }] }];
  const added = await store.rawFromChats.handler({ db: ctx.db }, { space: "acme", id: "me/paul" });
  const pr = rows().filter(r => r.slug === "paul");
  check("a person's raw notes are gathered once from the personal chats still kept", added === 2 && pr.length === 2 && pr[0].text === "Paul called me about the flat"
    && pr[0].date === "2026-09-20" && pr[1].asked === "Who is your oldest friend?" && pr[1].kind === "interview", JSON.stringify(pr));
  check("and only once", await store.rawFromChats.handler({ db: ctx.db }, { space: "acme", id: "me/paul" }) === 0);
  T.concepts.push({ _id: "cpm", brain: "me", slug: "paul-martin", n: 8, title: "Paul Martin", tag: "contact", aliases: [], position: "y", summaryLine: "y",
    evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-09-20" });
  await store.contactMerge.handler({ db: ctx.db }, { space: "acme", into: "me/paul-martin", from: ["me/paul"] });
  check("a merge carries the raw notes to the card kept", rows().filter(r => r.slug === "paul-martin").length === 2 && !rows().some(r => r.slug === "paul"));
}

/* ---- a chat about one person or one note changes it at once ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "chat", date: "2026-10-04", text: "Maxime from Lyon works at Airbus, his number is 06 12",
    model: async () => JSON.stringify({ notes: [], people: [{ name: "Maxime", claim: "Maxime works at Airbus", summary: "Your friend from Lyon, at Airbus.",
      facts: [{ section: "contact", label: "Phone", value: "06 12" }, { section: "work", label: "Company", value: "Airbus" }],
      events: [{ date: "2026-10-04", text: "Maxime told you about Airbus.", seen: true }] }] }) });
  const c = (await store.conceptsByIds.handler({ db: ctx.db }, { space: "acme", ids: ["me/maxime"] }))[0];
  const dump = personal.conceptDump(c, [{ date: "2026-10-04", kind: "chat", text: "Maxime from Lyon works at Airbus" }]);
  const phone = c.file.facts.find(x => x.l === "Phone"), job = c.file.facts.find(x => x.l === "Company");
  check("the chat reads the whole file, each line with the key that takes it out, and the raw notes",
    dump.includes(`[fact:${phone.k}] Contact details, Phone: 06 12`) && dump.includes(`[event:${c.file.events[0].k}] 2026-10-04 (together)`) && /RAW NOTES, WORD FOR WORD/.test(dump), dump);
  const rules = personal.conceptRules("Maxime", true, true);
  check("its rules keep it on that one person, and let it add, correct and take out",
    /This chat is about it alone/.test(rules) && /their main chat takes the rest/.test(rules) && /"remove"/.test(rules) && /Write the reply in English/.test(rules) && /Every field of "change" is in English/.test(rules));
  check("a note's rules rewrite the note", /"position": the note as it stands after this/.test(personal.conceptRules("Marathon", false, false)) && /language of their message/.test(personal.conceptRules("Marathon", false, false)));
  const said = "Il ne travaille plus chez Airbus, il est chez Mistral depuis septembre";
  const ch = await personal.applyChange(ctx, { space: "acme", brain: "me", c, q: said, date: "2026-10-07",
    change: { claim: "He left Airbus and works at Mistral since September", orig: said, summary: "Your friend from Lyon, now at Mistral.", summaryLine: "Your friend, at Mistral",
      facts: [{ section: "work", label: "Company", value: "Mistral", since: "2026-09" }], remove: [{ part: "fact", key: job.k }, { part: "fact", key: "nope" }, { part: "bad", key: "x" }] } });
  const m = T.concepts.find(x => x.title === "Maxime");
  check("a correction takes the wrong line out and writes the right one", !m.file.facts.some(x => x.v === "Airbus") && m.file.facts.some(x => x.l === "Company" && x.v === "Mistral")
    && m.file.facts.some(x => x.l === "Phone") && ch.removed === 1 && ch.added === 1 && ch.summary, JSON.stringify({ ch, facts: m.file.facts }));
  check("the summary is rewritten, and the message is a dated mention in English, their words beside it",
    m.position === "Your friend from Lyon, now at Mistral." && m.summaryLine === "Your friend, at Mistral" && m.evidence[0].date === "2026-10-07" && m.evidence[0].orig === said
    && T.sources.some(x => x.sid === "me-chat-2026-10-07" && x.author === "You"), JSON.stringify(m.evidence[0]));
  check("and the message joins their raw notes, word for word", (T.rawNotes ?? []).some(r => r.slug === "maxime" && r.text === said && r.date === "2026-10-07"));
  T.concepts.push({ _id: "nm", brain: "me", slug: "marathon", n: 5, title: "Marathon", position: "You want to run a marathon in 2027.", summaryLine: "A marathon in 2027",
    evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01" });
  const note = T.concepts.find(x => x.slug === "marathon");
  const ch2 = await personal.applyChange(ctx, { space: "acme", brain: "me", c: note, q: "make it 2028", date: "2026-10-07",
    change: { claim: "I now aim for 2028", position: "You now aim for a marathon in 2028 (2026-10-07); you said 2027 before.", summaryLine: "A marathon in 2028" } });
  const n2 = T.concepts.find(x => x.slug === "marathon");
  check("a note is rewritten from the chat about it, the change dated", /2028/.test(n2.position) && n2.summaryLine === "A marathon in 2028" && n2.evidence.length === 1
    && n2.evidence[0].claim === "I now aim for 2028" && ch2.summary && !T.concepts.some(x => x.title === "make it 2028"), JSON.stringify(n2));
}

/* ---- an imported memory is filed like a drop: everything, and what is left kept as written ---- */
{
  const imp = personal.filerPrompt("import", "I run 10 km on Sundays.", "", [], [], TODAY, [], "en")[1].content;
  check("an import files everything: every fact, number, date and name, up to 20 notes a piece", /EVERYTHING IN IT IS FILED/.test(imp) && /At most 20 notes/.test(imp));
  const gap = personal.filerPrompt("import", "Kinugawa every Friday.", "", [], [], TODAY, [], "en", true)[1].content;
  check("a second filing is told it holds what the first one left out", /WHAT A FIRST FILING OF THIS TEXT LEFT OUT/.test(gap) && !/LEFT OUT/.test(imp));
  const chat = personal.filerPrompt("chat", "hi", "", [], [], TODAY)[1].content;
  check("a chat message keeps its own rules", !/EVERYTHING IN IT IS FILED/.test(chat) && /At most 3 notes/.test(chat));

  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  const load = async () => (await space.loadSpace(ctx, "acme", undefined, { personal: true })).cards;
  const f = await personal.remember(ctx, { space: "acme", brain: "me", cards: await load(), kind: "import", date: TODAY, lang: "en",
    text: "I run 10 km on Sundays. Maxime lives in Lyon.",
    model: async () => JSON.stringify({ notes: [{ title: "Running", claim: "I run 10 km on Sundays", position: "You run 10 km every Sunday." }],
      people: [{ name: "Maxime", claim: "Maxime lives in Lyon", facts: [{ section: "identity", label: "Lives in", value: "Lyon" }] }] }) });
  check("a filing says what it kept, notes and people alike, so the app can check it", /10 km/.test(f.kept || "") && /Lives in Lyon/.test(f.kept || "") && /Maxime/.test(f.kept || ""), f.kept);
  const v = await personal.fileVerbatim(ctx, "acme", "me", ["I eat sushi at Kinugawa every Friday.", " ", "My sister is 31."], TODAY);
  const note = T.concepts.find(c => c.title === `Imported details, ${TODAY}`);
  check("what two filings left out is kept word for word, one dated mention a sentence", v.new === 1 && note?.evidence.length === 2
    && note.evidence.some(e => e.claim === "I eat sushi at Kinugawa every Friday." && e.author === "You (imported)") && /Kinugawa every Friday/.test(note.position)
    && T.sources.some(x => x.sid === `me-import-${TODAY}`), JSON.stringify(note));
  const v2 = await personal.fileVerbatim(ctx, "acme", "me", ["I fly to Tokyo in May 2027."], TODAY);
  const again = T.concepts.find(c => c.title === `Imported details, ${TODAY}`);
  check("a second one the same day joins that note, and loses nothing", v2.updated === 1 && again.evidence.length === 3
    && /Kinugawa/.test(again.position) && /Tokyo in May 2027/.test(again.position), JSON.stringify(again.position));
}

/* ---- a person is a folder: pages by year and month, an old file split once ---- */
{
  const { T, ctx } = makeCtx();
  T.brains = [{ _id: "b1", slug: "me", name: "Me", type: "personal", scope: "", space: "acme" }];
  /* A file from before moments had rows: its history sits inside it. */
  T.concepts = [{ _id: "c1", brain: "me", slug: "marc", n: 1, title: "Marc", tag: "contact", aliases: [], position: "Your co-founder.", summaryLine: "Co-founder",
    evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01",
    file: { v: 1, seen: "2025-06-02", facts: [{ k: "f1", s: "work", l: "Company", v: "Revolut", at: "2026-01-01" }], links: [], open: [],
      events: [{ k: "e1", d: "2025-06-02", t: "Dinner in Lisbon: he talked about leaving his job.", seen: true, at: "2025-06-02" },
               { k: "e2", d: "2024-03", t: "You met at Station F.", at: "2024-03-01" }] } }];
  T.rawNotes = [{ _id: "r1", brain: "me", slug: "marc", date: "2026-09-30", kind: "chat", text: "Marc called", at: 2 },
                { _id: "r2", brain: "me", slug: "marc", date: "2026-08-12", kind: "chat", text: "Marc moved", at: 1 }];
  const read = async () => (await store.conceptsByIds.handler({ db: ctx.db }, { space: "acme", ids: ["me/marc"] }))[0];
  const before = await read();
  check("an old file still reads whole before it is split", before.file.events.length === 2 && before.file.legacy === true);
  const pages = await store.personPages.handler({ db: ctx.db }, { space: "acme", id: "me/marc" });
  check("a person's pages: the years of their history and the months of their raw notes, each counted",
    JSON.stringify(pages) === '{"years":[{"y":"2025","n":1},{"y":"2024","n":1}],"months":[{"m":"2026-09","n":1},{"m":"2026-08","n":1}]}', JSON.stringify(pages));
  await store.splitContact.handler({ db: ctx.db }, { space: "acme", id: "me/marc" });
  check("opened once, the old file is split: its moments become rows, nothing lost", !("events" in T.concepts[0].file) && T.moments.length === 2
    && T.concepts[0].file.n === 2 && T.concepts[0].file.seen === "2025-06-02" && (await read()).file.events[0].t.startsWith("Dinner in Lisbon"));
  const y = await store.personPage.handler({ db: ctx.db }, { space: "acme", id: "me/marc", year: "2024" });
  const m = await store.personPage.handler({ db: ctx.db }, { space: "acme", id: "me/marc", month: "2026-08" });
  check("a page is one year of history, or one month of raw notes", y.moments.length === 1 && y.moments[0].t === "You met at Station F." && m.raw.length === 1 && m.raw[0].text === "Marc moved");
  const other = await store.personPage.handler({ db: ctx.db }, { space: "other", id: "me/marc", year: "2024" });
  check("another workspace reads no page", other.moments.length === 0);
  const text = words.fileText(await read(), 3500, "Is he still thinking of leaving his job?");
  check("the filer reads the moments that bear on the message first, whatever their age", /HISTORY THAT BEARS ON THIS\n- 2025-06-02 \(together\): Dinner in Lisbon/.test(text)
    && /MORE HISTORY, NEWEST FIRST\n- 2024-03: You met at Station F/.test(text), text);
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe personal brain files what it should, for its owner only");
process.exit(failures ? 1 : 0);
