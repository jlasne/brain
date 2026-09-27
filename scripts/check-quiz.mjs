/**
 * The quiz, one turn at a time, against a stand-in model.
 *
 * A turn grades the reply it carries and asks the next question in the same
 * call. This checks what each turn sends, what it reads back, and that the
 * round stops asking after its fifth question.
 *
 *     node scripts/check-quiz.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-quiz-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["quiz.ts", "lib.ts", "words.ts", "route.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
await esbuild.build({ entryPoints: [join(dir, "quiz.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { quizTurn, readQuiz, QUIZ_ROUND } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

const brains = [{ slug: "wealth", name: "Wealth", type: "subject", scope: "money" }];
const concepts = [
  { brain: "wealth", slug: "gold", n: 1, title: "Gold holds value", summaryLine: "Gold kept its value for 2000 years.",
    position: "Gold kept its purchasing power across 2000 years.", ev: 3,
    evidence: [{ date: "2026-01-01", author: "A", claim: "an ounce bought a toga in Rome and a suit today" }],
    data: ["2000 years"], conflicts: [] },
  { brain: "wealth", slug: "rates", n: 2, title: "Rates and bonds", summaryLine: "Bond prices fall when rates rise.",
    position: "A bond's price moves against interest rates.", ev: 1,
    evidence: [{ date: "2026-02-01", author: "B", claim: "a 1 point rise cut a 10 year bond by about 9 percent" }],
    data: ["about 9 percent"], conflicts: [] },
];

const real = globalThis.fetch;
const prompts = [];
/* The router's call comes first and cannot parse this reply, so the search
   falls back to word matching. Only the quiz's own prompt is kept. */
const reply = content => async (_u, opt) => {
  const p = JSON.parse(opt.body).messages[1].content;
  if (/run a quiz/.test(p)) prompts.push(p);
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};

/* ---- the first question ---- */
{
  globalThis.fetch = reply(JSON.stringify({ question: "Why did gold keep its value?", answer: "It kept purchasing power for 2000 years.",
    hint: "Think about Gold holds value.", concept: "Gold holds value" }));
  const r = await quizTurn(brains, concepts, { topic: "gold", number: 1 }, "k");
  const p = prompts.at(-1) ?? "";
  check("the first turn asks, and grades nothing", /NEXT QUESTION \(number 1 of 5\)/.test(p) && !/GRADE THE REPLY/.test(p), p.slice(0, 200));
  check("it reads the concept the topic names", /### Gold holds value/.test(p) && /toga in Rome/.test(p));
  check("its question, answer, hint and concept come back",
    r.next?.question === "Why did gold keep its value?" && /2000 years/.test(r.next.answer) && r.next.concept === "Gold holds value" && !r.verdict,
    JSON.stringify(r));
}

/* ---- a reply is graded, then the next question is asked ---- */
{
  globalThis.fetch = reply(JSON.stringify({ verdict: "partly", feedback: "You named the time span — the figure is 2000 years.",
    question: "What happens to a bond when rates rise?", answer: "Its price falls, about 9 percent for 1 point on a 10 year bond.",
    hint: "Look at Rates and bonds.", concept: "Rates and bonds" }));
  const r = await quizTurn(brains, concepts, {
    topic: "money", number: 2,
    asked: [{ question: "Why did gold keep its value?", concept: "Gold holds value" }],
    turn: { question: "Why did gold keep its value?", answer: "It kept purchasing power for 2000 years.", concept: "Gold holds value", reply: "it lasted a long time" },
  }, "k");
  const p = prompts.at(-1) ?? "";
  check("a reply is graded against its expected answer", /GRADE THE REPLY/.test(p) && /EXPECTED ANSWER: It kept purchasing power/.test(p)
    && /REPLY: it lasted a long time/.test(p), p.slice(0, 300));
  check("the questions asked already travel", /ASKED ALREADY\n- Why did gold keep its value\? \(Gold holds value\)/.test(p));
  check("and the next one is number 2", /number 2 of 5/.test(p));
  check("the verdict and feedback come back with the next question",
    r.verdict === "partly" && /2000 years/.test(r.feedback) && r.next?.concept === "Rates and bonds", JSON.stringify(r));
  check("an em-dash never reaches the screen", !/—/.test(r.feedback), r.feedback);
}

/* ---- the fifth answer ends the round ---- */
{
  globalThis.fetch = reply(JSON.stringify({ verdict: "right", feedback: "Yes. The price falls about 9 percent." }));
  /* The topic names gold; the question was on bonds. */
  const r = await quizTurn(brains, concepts, { topic: "gold", number: QUIZ_ROUND + 1,
    turn: { question: "Q", answer: "A", concept: "Rates and bonds", reply: "it falls" } }, "k");
  const p = prompts.at(-1) ?? "";
  check("the concept just asked opens first, whatever the topic, so its evidence is read",
    (p.match(/### ([^\n]+) in /) || [])[1] === "Rates and bonds" && /about 9 percent/.test(p), (p.match(/### [^\n]+/g) || []).join(" | "));
  check(`after question ${QUIZ_ROUND}, it grades and asks no more`, /GRADE THE REPLY/.test(p) && !/NEXT QUESTION/.test(p) && !r.next && r.verdict === "right",
    JSON.stringify(r));
}

/* ---- a topic that matches nothing still gets a question ---- */
{
  globalThis.fetch = reply(JSON.stringify({ question: "Q?", answer: "A.", hint: "H.", concept: "Gold holds value" }));
  await quizTurn(brains, concepts, { topic: "zzqx", number: 1 }, "k");
  const p = prompts.at(-1) ?? "";
  check("a topic that matches nothing opens the fullest concepts", /### Gold holds value/.test(p), p.slice(-400));
}

/* ---- a reply out of shape ---- */
{
  const bad = readQuiz('{"verdict":"excellent","feedback":""}', true, true);
  check("an unknown verdict reads as not yet", bad.verdict === "wrong", JSON.stringify(bad));
  check("with feedback that says so", /No feedback/.test(bad.feedback));
  check("and no question means the round has nothing to ask", bad.empty === true && !bad.next);
  const junk = readQuiz("not json at all", false, true);
  check("a reply that is not JSON asks nothing, and throws nothing", junk.empty === true);
  const empty = await quizTurn([], concepts, { topic: "gold" }, "k");
  check("with no brains, the turn is empty and calls no model", empty.empty === true);
}

globalThis.fetch = real;
console.log(failures ? `\n${failures} failed` : "\nthe quiz holds");
process.exit(failures ? 1 : 0);
