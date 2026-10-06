/**
 * The one-pager, built from a fixed set of positions.
 *
 * Assembling a page calls no model, so the whole thing runs here: the ranking,
 * the caps that keep it to one page, the bullet a position turns into, and the
 * mail body. The question path runs against a stand-in model.
 *
 *     node scripts/check-pager.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-pager-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["onepager.ts", "lib.ts", "words.ts", "route.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
await esbuild.build({ entryPoints: [join(dir, "onepager.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { assemble, fromModel, asText, asHtml, looksLikeMail, bulletText, addedLine, parseDoc, translatePage, langOf } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

const concept = (brain, n, title, summary, evidence, data, updated) => ({
  brain, slug: title.toLowerCase().replace(/\W+/g, "-"), n, title,
  position: `${summary} It holds because the evidence says so.`,
  summaryLine: summary, evidence, data, conflicts: [], sources: [], related: [], updated,
});
const ev = (date, author, claim) => ({ date, author, claim });

const brains = [
  { slug: "content", name: "Content", type: "subject", scope: "brand and content for business" },
  { slug: "gave", name: "Charles Gave", type: "person", scope: "what Gave holds" },
];
const concepts = [
  concept("content", 1, "Thin idea", "One source says so", [ev("2026-01-02", "A", "x")], [], "2026-01-02"),
  concept("content", 2, "Fat idea", "Three sources agree",
    [ev("2026-03-01", "A", "x"), ev("2026-05-04", "B", "y"), ev("2026-08-09", "C", "z")],
    ["retention rose 31 percent"], "2026-08-09"),
  concept("gave", 1, "Gave on rates", "Rates decide the multiple", [ev("2026-04-04", "Gave", "x")], [], "2026-04-04"),
];
const sources = [
  { sid: "s1", brains: ["content"] }, { sid: "s2", brains: ["content"] },
  { sid: "s3", brains: ["content", "gave"] },
];

/* ---- one brain ---- */
{
  const p = assemble("octopus", [brains[0]], concepts, sources, "content");
  check("one brain is titled by its name", p.title === "Content", p.title);
  check("and carries its scope line", p.line === "brand and content for business", p.line);
  check("one brain needs no section heading", p.sections[0].head === "", `"${p.sections[0].head}"`);
  const [b0, b1] = p.sections[0].bullets;
  check("the fullest position leads", b0.k === "Fat idea" && b0.say.startsWith("Three sources agree"), JSON.stringify(b0));
  check("a bullet names its concept, then says it", b1.k === "Thin idea" && b1.say.startsWith("One source says so"), JSON.stringify(b1));
  check("a bullet carries no source, author or date",
    p.sections[0].bullets.every(b => !/2026-|\(|·/.test(b.k + b.say)), JSON.stringify(p.sections[0].bullets));
  const long = assemble("octopus", [brains[0]], [concept("content", 1, "Long", "word ".repeat(80).trim(), [], [], "2026-01-01")], [], "content");
  const say = long.sections[0].bullets[0].say;
  check("what it says stays within two lines", say.length <= 184 && say.endsWith("..."), `${say.length}: ${say.slice(-20)}`);
  check("the foot counts what was read", /3 sources read/.test(p.foot), p.foot);
  check("and how much of the brain is shown", /2 of 2 positions/.test(p.foot), p.foot);
}

/* ---- what a bullet says adds to its name ---- */
{
  /* Real titles from a brain, whose summary lines restated them. */
  const ai = addedLine({ title: "AI compute constrained by energy density, not total supply",
    summaryLine: "AI compute limited by energy density and physical security; consumption 1-2% world.",
    position: "AI compute is limited by energy density, not total energy supply. Data centres need 100 MW on one site, which few grids deliver. AI consumes 1-2% of world electricity." });
  check("a sentence that restates the title is left out", !/limited by energy density/i.test(ai), ai);
  check("the sentences that add facts are kept", /100 MW/.test(ai) && /1-2%/.test(ai), ai);
  const vol = addedLine({ title: "Volatility is not risk; danger is probability of zero",
    summaryLine: "Volatility is not danger; danger is probability of zero.",
    position: "Volatility is not risk. The danger is the probability of going to zero. A 40% drawdown is survivable; a margin call that wipes the account is not." });
  check("a summary that only repeats the title never shows", !/probability of zero/i.test(vol) && /40% drawdown/.test(vol), vol);
  const two = addedLine({ title: "Gold", summaryLine: "",
    position: "Gold kept its purchasing power for 2000 years. Gold kept its purchasing power across two millennia. Central banks bought 1037 tonnes in 2023." });
  check("the second sentence says something the first did not", !/two millennia/.test(two) && /1037 tonnes/.test(two), two);
  const bare = addedLine({ title: "Offer first", summaryLine: "Offer first.", position: "Offer first." });
  check("a concept with nothing to add shows its name alone", bare === "", bare);
}

/* ---- a group ---- */
{
  const p = assemble("octopus", brains, concepts, sources, "all");
  check("a group is titled by its space", p.title === "Octopus", p.title);
  check("and counted in its line", p.line === "2 brains, 3 positions.", p.line);
  check("each brain gets a heading", p.sections.map(s => s.head).join(",") === "Content,Charles Gave",
    p.sections.map(s => s.head).join(","));
  const people = assemble("octopus", [brains[1]], concepts, sources, "person");
  check("one brain in a group still reads as that brain", people.title === "Charles Gave", people.title);
}

/* ---- the caps that keep it to one page ---- */
{
  const many = [];
  for (let i = 0; i < 40; i++) many.push(concept("content", i, `Idea ${i}`, `Line ${i}`, [ev("2026-01-01", "A", "x")], [], "2026-01-01"));
  const one = assemble("octopus", [brains[0]], many, sources, "content");
  check("one brain stops at 14 bullets", one.sections[0].bullets.length === 14, String(one.sections[0].bullets.length));
  check("and says how many it left out", /14 of 40 positions/.test(one.foot), one.foot);
  const grouped = assemble("octopus", brains, many, sources, "all");
  check("a brain inside a group stops at 6", grouped.sections[0].bullets.length === 6, String(grouped.sections[0].bullets.length));
}

/* ---- an empty brain ---- */
{
  const p = assemble("octopus", [{ slug: "new", name: "New", type: "subject", scope: "nothing yet" }], [], [], "new");
  check("a brain with no positions makes no section", p.sections.length === 0, JSON.stringify(p.sections));
}

/* ---- what goes in the mail ---- */
{
  const p = assemble("octopus", [brains[0]], concepts, sources, "content");
  const text = asText(p);
  check("the text carries every bullet", p.sections[0].bullets.every(b => text.includes(bulletText(b))));
  check("as the concept, then what it says", text.includes("- Fat idea: Three sources agree"), text);
  const html = asHtml(p, "Octopus");
  check("the html carries every bullet", p.sections[0].bullets.every(b => html.includes(`${b.k}</strong><br>${b.say}`)));
  check("the html names the space", html.includes(">Octopus<"));
  const nasty = assemble("octopus",
    [{ slug: "x", name: "<script>alert(1)</script>", type: "subject", scope: "s" }],
    [concept("x", 1, "T", "A line", [ev("2026-01-01", "A", "x")], [], "2026-01-01")], [], "x");
  check("a title with markup in it is escaped",
    asHtml(nasty, "Octopus").includes("&lt;script&gt;") && !asHtml(nasty, "Octopus").includes("<script>alert"));
}

/* ---- a question ---- */
{
  const real = globalThis.fetch;
  const said = [];
  globalThis.fetch = async (_u, opt) => {
    const body = JSON.parse(opt.body);
    const sys = body.messages[0].content;
    said.push(body.messages[1].content);
    const content = /route questions/.test(sys)
      ? JSON.stringify({ picks: [1], terms: ["retention"] })
      : ["- **Retention lift**: Retention rose 31 percent across three sources.",
         "- Named face: A named face compounds distribution, per Gave 2026-04-04.",
         "",
         "Sources: A (2026-03-01), B (2026-05-04)"].join("\n");
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const p = await fromModel("octopus", brains, concepts, sources, { q: "What lifts retention?", kind: "summary" }, "k");
  globalThis.fetch = real;
  const bs = p.sections[0].bullets;
  check("a question's bullets name a concept, then say it",
    bs[0].k === "Retention lift" && bs[0].say === "Retention rose 31 percent across three sources.", JSON.stringify(bs[0]));
  check("the sources line stays off the page", bs.length === 2 && !asText(p).includes("Sources:"), asText(p));
  check("the rules ask for no sources in the bullets", /No sources, no authors, no dates/.test(said.at(-1)));
  check("its foot counts positions and sources read", /^\d+ of 3 positions · 3 sources read · \d{4}-\d\d-\d\d$/.test(p.foot), p.foot);
}

/* ---- documents: a quiz, a deep dive, use cases, or a type described ---- */
{
  const real = globalThis.fetch;
  let prompt = "";
  const reply = content => async (_u, opt) => {
    prompt = JSON.parse(opt.body).messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  globalThis.fetch = reply([
    "## Questions",
    "1. Why did retention rise 31 percent when three sources agreed?",
    "2. What does a **named face** add that a logo cannot?",
    "",
    "## Answers",
    "1. The first two seconds decide the watch.",
    "2. Distribution that compounds with every post.",
  ].join("\n"));
  const quiz = await fromModel("octopus", [brains[0]], concepts, sources, { kind: "custom", doc: "quiz", pick: "content" }, "k");
  check("a quiz asks for reasoning, answers apart", /Ask for reasoning, not recall/.test(prompt) && /"## Answers"/.test(prompt));
  check("in a document's format, never the summary's bullets", /No "Core concept: what it says" bullets/.test(prompt) && !/Core concept: the question/.test(prompt));
  check("with no question it reads the fullest positions", /Three sources agree/.test(prompt));
  check("its questions come back numbered, with no bullets", quiz.sections[0].head === "Questions" && quiz.sections[0].bullets.length === 0
    && quiz.sections[0].blocks[0].ol.length === 2 && /31 percent.*\?$/.test(quiz.sections[0].blocks[0].ol[0]), JSON.stringify(quiz.sections[0]));
  check("the answers follow under their own heading", quiz.sections[1]?.head === "Answers" && quiz.sections[1].blocks[0].ol.length === 2,
    JSON.stringify(quiz.sections[1]));
  check("the quiz is titled as one", quiz.title === "Quiz: Content" && /^2 questions on Content/.test(quiz.line), `${quiz.title} | ${quiz.line}`);
  const qText = asText(quiz), qHtml = asHtml(quiz, "Octopus");
  check("as text it numbers the questions and drops the bold marks", /QUESTIONS\n\n1\. Why did/.test(qText) && /2\. What does a named face add/.test(qText), qText);
  check("as mail it keeps them numbered and the bold as bold", /<ol[^>]*><li[^>]*>Why did/.test(qHtml) && /<strong[^>]*>named face<\/strong>/.test(qHtml));

  globalThis.fetch = reply([
    "## The short answer",
    "Retention rose 31 percent. The first two seconds decide it \u2014 three sources agree.",
    "",
    "## How it works",
    "A viewer decides in two seconds.",
    "The hook carries that decision.",
    "",
    "## The evidence",
    "- 2026-03-01: retention up 31 percent",
    "- 2026-04-02: three sources agree",
  ].join("\n"));
  const deep = await fromModel("octopus", [brains[0]], concepts, sources,
    { kind: "custom", doc: "deepdive", note: "For a new client", pick: "content" }, "k");
  check("a deep dive asks for the whole mechanism, in sections", /"## How it works"/.test(prompt) && /500 to 800 words/.test(prompt));
  check("with the owner's instruction on top of its shape", /OWNER'S INSTRUCTION\nFor a new client\nIt sets the angle/.test(prompt));
  check("it comes back as sections of paragraphs and lists", deep.sections.map(x => x.head).join("|") === "The short answer|How it works|The evidence"
    && deep.sections[1].blocks.length === 1 && /two seconds\. The hook/.test(deep.sections[1].blocks[0].p) && deep.sections[2].blocks[0].ul.length === 2,
    JSON.stringify(deep.sections));
  check("an em-dash never reaches the page", !/\u2014/.test(JSON.stringify(deep.sections)));
  check("and it is titled and headed by its type", deep.title === "Deep dive: Content" && deep.line === "From Content. Written to: For a new client",
    `${deep.title} | ${deep.line}`);

  globalThis.fetch = reply("## Launch week\nA creator with 4,000 followers.\n\n**What to do**\n1. Build the offer first.\n2. Launch to email.\n\n**Expected result:** sold out twice.");
  const uses = await fromModel("octopus", [brains[0]], concepts, sources, { kind: "custom", doc: "usecase", pick: "content" }, "k");
  check("use cases ask for situations, steps and results", /3 to 5 cases/.test(prompt) && /\*\*Expected result:\*\*/.test(prompt));
  check("each case is a section with its steps numbered", uses.sections[0].head === "Launch week" && uses.sections[0].blocks[2].ol.length === 2
    && uses.title === "Use cases: Content" && /^1 case from Content\./.test(uses.line), JSON.stringify(uses));

  globalThis.fetch = reply("## Before the meeting\n- Name the 3 risks a client asks about first.\n- Book the review within 30 days.");
  const custom = await fromModel("octopus", brains, concepts, sources,
    { kind: "custom", doc: "other", note: "A checklist for a client meeting", pick: "all" }, "k");
  check("another type is written to the owner's description", /OWNER'S DESCRIPTION\nA checklist for a client meeting/.test(prompt));
  check("and heads the page", custom.line === "Written to: A checklist for a client meeting" && custom.title === "Octopus", `${custom.title} | ${custom.line}`);
  check("in the form it asked for", custom.sections[0].blocks[0].ul[1] === "Book the review within 30 days.", JSON.stringify(custom.sections));

  globalThis.fetch = reply("- Retention: rose 31 percent.\n- Hook: two seconds decide.");
  const summary = await fromModel("octopus", [brains[0]], concepts, sources, { q: "why did retention rise", kind: "summary", pick: "content" }, "k");
  check("a summary keeps its bullets, and only a summary", summary.sections[0].bullets[0].k === "Retention" && !summary.sections[0].blocks
    && /Core concept: what it says/.test(prompt), JSON.stringify(summary.sections));
  globalThis.fetch = real;
}

/* ---- a page in the language picked, English by default ---- */
{
  const real = globalThis.fetch;
  const prompts = [];
  /* A translation returns each string marked, so the test can see which ones travelled. */
  globalThis.fetch = async (_u, opt) => {
    const m = JSON.parse(opt.body).messages, p = m[1].content;
    prompts.push({ system: m[0].content, p });
    const content = /^Translate each string/.test(p)
      ? JSON.stringify({ t: JSON.parse(p.slice(p.lastIndexOf("\n\n") + 2)).map(x => "FR:" + x) })
      : "## Questions\n1. Pourquoi la rétention a-t-elle monté de 31 % ?\n\n## Réponses\n1. Les deux premières secondes décident.";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const fr = await fromModel("octopus", [brains[0]], concepts, sources, { kind: "custom", doc: "quiz", pick: "content", lang: "French" }, "k");
  const writing = prompts.find(x => /Ask for reasoning/.test(x.p));
  check("a page in French is written in French, its headings too", /Write in French, always\./.test(writing?.p || "")
    && /headings named above are translated too/.test(writing?.p || "") && /answer in French/.test(writing?.system || ""));
  check("a quiz's answers fold, whatever their heading says", fr.sections[1]?.head === "Réponses" && fr.sections[1]?.fold === true && !fr.sections[0].fold,
    JSON.stringify(fr.sections.map(x => [x.head, x.fold])));
  check("its title, line and foot follow in one small call, the body untouched", /^FR:Quiz: Content/.test(fr.title) && /^FR:/.test(fr.line)
    && /^FR:/.test(fr.foot) && /^Pourquoi/.test(fr.sections[0].blocks[0].ol[0]), `${fr.title} | ${fr.foot}`);

  const page = assemble("octopus", [brains[0]], concepts, sources, "content");
  const whole = await translatePage(page, "French", undefined, "k");
  const b0 = whole.sections[0].bullets[0];
  check("a summary laid out for free is translated whole, bullet by bullet", /^FR:/.test(whole.title) && /^FR:/.test(b0.k) && /^FR:/.test(b0.say)
    && whole.sections[0].bullets.length === page.sections[0].bullets.length, JSON.stringify(b0));
  const odd = await translatePage(page, "French", "chrome", "k", undefined, 42500.5);
  check("a time limit with a fraction still makes the call", /^FR:/.test(odd.title) && !odd.untranslated, odd.title);
  const n = prompts.length;
  const en = await translatePage(page, "English", undefined, "k");
  check("English calls no model", en === page && prompts.length === n);
  check("a language not offered reads as English", langOf("Klingon") === "English" && langOf("French") === "French");

  /* A long page goes in slices of 20, side by side, and comes back in order. */
  const long = { title: "T", line: "L", foot: "F",
    sections: [{ head: "H", bullets: Array.from({ length: 45 }, (_, i) => ({ k: "k" + i, say: "s" + i })) }] };
  const m = prompts.length;
  const lt = await translatePage(long, "French", undefined, "k");
  const sliced = prompts.slice(m).map(x => JSON.parse(x.p.slice(x.p.lastIndexOf("\n\n") + 2)).length);
  check("a long page goes in slices of 20 and keeps its order", sliced.length === 5 && Math.max(...sliced) === 20
    && lt.sections[0].bullets[44].say === "FR:s44" && lt.sections[0].bullets[0].k === "FR:k0" && lt.foot === "FR:F" && !lt.untranslated,
    JSON.stringify(sliced));

  /* A slice that fails once is asked again. */
  let calls = 0;
  globalThis.fetch = async (_u, opt) => {
    calls++;
    const p = JSON.parse(opt.body).messages[1].content;
    const content = calls === 1 ? "not json"
      : JSON.stringify({ t: JSON.parse(p.slice(p.lastIndexOf("\n\n") + 2)).map(x => "FR:" + x) });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const again = await translatePage(page, "French", undefined, "k");
  check("a slice that fails once is asked a second time", calls === 2 && /^FR:/.test(again.title) && !again.untranslated, `${calls} calls`);

  /* One that fails twice leaves the whole page in English, and says so. */
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"t":["one"]}' } }] }), { status: 200 }); };
  const bad = await translatePage(page, "French", undefined, "k");
  check("a translation that does not match leaves the page in English, whole, marked", bad.untranslated === true && calls === 2
    && bad.title === page.title && JSON.stringify(bad.sections) === JSON.stringify(page.sections), `${calls} calls`);
  check("an English page carries no mark", !("untranslated" in page) && !("untranslated" in whole));
  globalThis.fetch = real;
}

/* ---- the address ---- */
{
  check("a real address passes", looksLikeMail("hey@jeremylasne.com"));
  check("a bare word does not", !looksLikeMail("jeremy"));
  check("a missing domain does not", !looksLikeMail("jeremy@"));
  check("a space inside does not", !looksLikeMail("a b@c.com"));
}

console.log(failures ? `\n${failures} failed` : `\nthe page holds`);
process.exit(failures ? 1 : 0);
