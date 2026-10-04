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

/* ---- the interview: its questions ---- */
{
  check("335 questions in 17 chapters, and a test of 30 kept apart", twin.QUESTIONS.length === 335 && twin.CHAPTERS.length === 17 && twin.TEST.length === 30,
    `${twin.QUESTIONS.length} ${twin.CHAPTERS.length} ${twin.TEST.length}`);
  check("each question has its own id, from A1 to Q12", new Set(twin.QUESTIONS.map(q => q.id)).size === 335 && twin.QUESTIONS[0].id === "A1" && twin.QUESTIONS.at(-1).id === "Q12");
  check("written for anyone: no one person's bank, school, apps or creators", !twin.QUESTIONS.concat(twin.TEST.map(t => ({ text: t })))
    .some(q => /\b(the bank|engineering|a creator with|your best app|selling an app)\b/i.test(q.text)));
  check("no em-dash in any question", !twin.QUESTIONS.some(q => /—/.test(q.text)) && !twin.TEST.some(t => /—/.test(t)));
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
  check("the test keeps only its own questions' answers", JSON.stringify(twin.cleanAnswers({ Z1: "  7 ", Z31: "x", A1: "y", Z2: "" })) === '{"Z1":"7"}');
  check("a score is 0, 1 or 2, nothing else", JSON.stringify(twin.cleanScores({ Z1: 2, Z2: "1", Z3: 5, Z4: -1, Z5: 0 })) === '{"Z1":2,"Z2":1,"Z5":0}');
  check("a score is a share of the most it could reach", twin.scorePct({ Z1: 2, Z2: 1, Z3: 0, Z4: 2 }) === 63 && twin.scorePct({}) === null);
  const sm = twin.summary({ test: { mine: { Z1: "a" }, twinScore: { Z1: 2, Z2: 1 }, selfScore: { Z1: 2, Z2: 2 } } });
  check("the target is 85% of your own retest", sm.test.twinPct === 75 && sm.test.selfPct === 100 && sm.test.target === 85);
  check("the twin answers in their voice from the notes alone", /Use what the notes say or clearly imply/.test(twin.TWIN_RULES) && /first person/.test(twin.TWIN_RULES));
  check("its answers are read by question, em-dashes out", JSON.stringify(twin.readAnswers('{"answers":{"Z1":"7 — maybe","Z40":"x"}}')) === '{"Z1":"7, maybe"}');
  const parts = twin.readProfile(JSON.stringify({ parts: [{ title: "Voice", points: ["Short — direct"] }, { title: "Identity", points: ["Builder", ""] }, { title: "Other", points: ["x"] }] }));
  check("the profile comes back in its 7 parts' order, empty and unknown parts out", parts.map(p => p.title).join() === "Identity,Voice" && parts[1].points[0] === "Short, direct", JSON.stringify(parts));
  check("the profile names its 7 parts and says which chapters fill an empty one", /Identity, Values, Beliefs, Decision rules, Voice, Knowledge, Boundaries/.test(twin.PROFILE_RULES) && /Voice G/.test(twin.PROFILE_RULES));
  const nt = twin.notesText([{ title: "Old", position: "old", updated: "2026-01-01" }, { title: "New", position: "new", updated: "2026-10-01" }], 18);
  check("notes are read newest first, within a cap", nt.text === "- New: new" && nt.used === 1 && nt.total === 2, JSON.stringify(nt));
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe personal brain files what it should, for its owner only");
process.exit(failures ? 1 : 0);
