/**
 * What a question sends, at every size.
 *
 * The answer used to read every concept of the first three brains, so a brain
 * listed fourth was never read and 1000 concepts sent about 524,000 tokens.
 * This builds a space of eleven brains and 1000 concepts, hides the answer in
 * the last brain, and checks the question finds it inside a fixed budget.
 *
 *     node scripts/check-ask.mjs
 */

import { mkdtempSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-ask-"));
copyFileSync(join(ROOT, "convex", "words.ts"), join(dir, "words.ts"));
await esbuild.build({ entryPoints: [join(dir, "words.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { dossierFor, indexFor, linkId, neighbours, linkCandidates, conceptSlug, legacySlug, findByTitle, keywords, scoreConcept, mergeEvidence, cardOf, planDossier, writeDossier, idOf, rankConcepts, FULL_CHARS, TITLE_CHARS } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

const TOPICS = ["pricing", "hiring", "retention", "cashflow", "branding", "outreach", "sleep", "training", "gold", "rates", "tax"];
const brains = TOPICS.map((t, i) => ({ slug: `b${i}`, name: `Brain ${t}`, type: i === 3 ? "person" : "subject", scope: `everything about ${t}` }));
const filler = "lorem ipsum dolor sit amet consectetur ".repeat(9);
const concepts = [];
for (let i = 0; i < 1000; i++) {
  const b = brains[i % brains.length], t = TOPICS[i % TOPICS.length];
  concepts.push({ brain: b.slug, slug: `c${i}`, title: `${t} idea ${i}`, summaryLine: `A line about ${t}.`,
    position: filler, data: ["12 percent", "3 years"],
    evidence: Array.from({ length: 7 }, () => ({ date: "2026-05-04", author: "Author", claim: filler.slice(0, 170) })),
    conflicts: [] });
}
/* The answer, in the last brain, which the old code never opened. */
concepts.push({ brain: "b10", slug: "depreciation", title: "Straight line depreciation", summaryLine: "Cost spread evenly.",
  position: "Straight line depreciation spreads an asset's cost evenly over its useful life.",
  data: ["a 10,000 asset over 5 years costs 2,000 a year"], evidence: [{ date: "2026-09-01", author: "Manual", claim: "cost minus residual, over life" }], conflicts: [] });

const tokens = s => Math.round(s.length / 4);

/* ---- a question about the last brain ---- */
{
  const r = dossierFor(brains, concepts, "how does straight line depreciation work?");
  check("the answer in the last of 11 brains is opened", r.opened.some(c => c.slug === "depreciation"), r.opened.slice(0, 3).map(c => c.slug).join(","));
  check("and opened first", r.opened[0]?.slug === "depreciation", r.opened[0]?.slug);
  check(`1001 concepts send under ${Math.round((FULL_CHARS + TITLE_CHARS) / 4000)}k tokens`, tokens(r.dossier) <= (FULL_CHARS + TITLE_CHARS + 2000) / 4,
    `${tokens(r.dossier)} tokens`);
  console.log(`       sends ${Math.round(tokens(r.dossier) / 1000)}k tokens, was about 524k`);
  check("the rest are named, then counted", r.named > 0 && r.left > 0 && /\.\.\.and \d+ more\./.test(r.dossier), `named ${r.named}, left ${r.left}`);
}

/* ---- a follow-up borrows the question before it ---- */
{
  const r = dossierFor(brains, concepts, "and over how many years?",
    [{ q: "how does straight line depreciation work?", a: "It spreads cost evenly." }]);
  check("a follow-up with no subject finds the same concept", r.opened[0]?.slug === "depreciation", r.opened[0]?.slug);
}

/* ---- one brain picked ---- */
{
  const r = dossierFor([brains[0]], concepts, "pricing");
  check("a picked brain reads only that brain", r.opened.every(c => c.brain === "b0"), [...new Set(r.opened.map(c => c.brain))].join(","));
}

/* ---- a question naming nothing held ---- */
{
  const r = dossierFor(brains, concepts, "what matters most?");
  check("a vague question still opens the fullest positions", r.opened.length > 0 && r.opened.length <= 30, String(r.opened.length));
}

/* ---- a small space sends everything, as before ---- */
{
  const small = concepts.filter(c => c.brain === "b10").slice(0, 5);
  const r = dossierFor([brains[10]], small, "tax");
  check("a small brain opens every concept", r.opened.length === 5 && r.left === 0 && r.named === 0, `${r.opened.length} opened`);
}

/* ---- the router's picks, and its English terms ---- */
{
  const fr = "comment fonctionne l amortissement lineaire ?";
  const alone = dossierFor(brains, concepts, fr);
  check("a French question alone misses the concept", !alone.opened.some(c => c.slug === "depreciation"));
  const withTerms = dossierFor(brains, concepts, fr, undefined, { terms: ["straight line depreciation", "useful life"] });
  check("the router's English terms find it", withTerms.opened[0]?.slug === "depreciation", withTerms.opened[0]?.slug);
  const withPick = dossierFor(brains, concepts, fr, undefined, { picked: ["b10/depreciation"] });
  check("a routed pick opens first", withPick.opened[0]?.slug === "depreciation" && withPick.picked === 1, withPick.opened[0]?.slug);
  const ghost = dossierFor(brains, concepts, "pricing", undefined, { picked: ["b99/nothing"] });
  check("a pick naming no concept is ignored", ghost.picked === 0 && ghost.opened.length > 0);
}

/* ---- the numbered title list ---- */
{
  const idx = indexFor(brains, concepts, "depreciation");
  check("the title list numbers every concept that fits", idx.ids.length === 1001 && idx.text.startsWith("1|"), `${idx.ids.length} of ${idx.total}`);
  check("the closest by wording come first", idx.ids[0] === "b10/depreciation", idx.ids[0]);
  check("under 80,000 characters", idx.text.length <= 80000, String(idx.text.length));
}

/* ---- links ---- */
{
  check("a drop's link reads as written", linkId("b10/straight-line-depreciation", "b0") === "b10/straight-line-depreciation");
  check("a starter link in prose reads as a concept of its brain",
    linkId("Prudence in `03-prudence.md`", "wealth") === "wealth/prudence", linkId("Prudence in `03-prudence.md`", "wealth"));
  check("a title with a brain reads as that brain's concept",
    linkId("b0/Price to earnings multiple", "b3") === "b0/price-to-earnings-multiple");

  const a = { brain: "k", slug: "npv", title: "Net present value", related: ["k/discount-rate"], evidence: [] };
  const b = { brain: "k", slug: "discount-rate", title: "Discount rate", related: [], evidence: [] };
  const c = { brain: "k", slug: "irr", title: "Internal rate of return", related: ["k/npv"], evidence: [] };
  const d = { brain: "k", slug: "gold", title: "Gold", related: [], evidence: [] };
  const n = neighbours([a], [a, b, c, d]).map(x => x.slug);
  check("links are followed both ways", n.includes("discount-rate") && n.includes("irr") && !n.includes("gold"), n.join(","));

  const kb = [{ slug: "k", name: "Finance", type: "subject", scope: "corporate finance" }];
  const r = dossierFor(kb, [a, b, c, d], "what is net present value?");
  const order = r.opened.map(x => x.slug);
  check("an answer opens what its concept links to, next", order[0] === "npv" && order.slice(1, 3).sort().join(",") === "discount-rate,irr", order.join(","));
  check("and leaves out what it does not link to", !order.includes("gold") || order.indexOf("gold") > 2, order.join(","));
}

/* ---- links found with no model ---- */
{
  const k = (slug, title, summaryLine, position, sources = ["manual"]) =>
    ({ brain: "acc", slug, title, summaryLine, position, data: [], evidence: [], sources, related: [] });
  const acc = [
    k("npv", "Net present value", "Discounted cash flows minus the investment.",
      "Net present value discounts each future cash flow at the discount rate and subtracts the initial investment. A positive NPV adds shareholder wealth."),
    k("irr", "Internal rate of return", "The discount rate at which NPV is zero.",
      "The internal rate of return is the discount rate that sets net present value to zero. Accept a project when IRR beats the cost of capital."),
    k("discount-rate", "Discount rate", "The rate that turns future cash flows into present value.",
      "The discount rate reflects the time value of money and project risk, usually the weighted average cost of capital."),
    k("wacc", "Weighted average cost of capital", "The blended cost of equity and debt.",
      "WACC weighs the cost of equity and the after-tax cost of debt by their market values. It is the default discount rate for projects of average risk."),
    k("depreciation", "Straight line depreciation", "Cost spread evenly over useful life.",
      "Straight line depreciation spreads an asset's cost minus residual value evenly over its useful life."),
    k("residual", "Residual value", "What an asset is worth at the end of its useful life.",
      "Residual value is deducted from cost before depreciation is spread over the useful life."),
    k("gold", "Gold as a hedge", "Gold holds purchasing power across decades.", "Gold has kept its purchasing power over centuries of currency debasement.",
      ["gold-letter"]),
  ];
  const cand = linkCandidates(acc, []);
  const ids = id => (cand.get("acc/" + id) ?? []).map(x => x.id.split("/")[1]);
  check("NPV finds IRR, the discount rate and WACC", ["irr", "discount-rate"].every(x => ids("npv").includes(x)), ids("npv").join(","));
  check("depreciation finds residual value", ids("depreciation")[0] === "residual", ids("depreciation").join(","));
  check("a concept naming another's title links to it", ids("wacc").includes("discount-rate"), ids("wacc").join(","));
  check("gold, on its own subject, links to nothing", ids("gold").length === 0, ids("gold").join(","));
  check("no concept links to itself", [...cand.entries()].every(([id, l]) => !l.some(x => x.id === id)));

  const t0 = performance.now();
  const big = linkCandidates(concepts.slice(0, 1001), []);
  const ms = performance.now() - t0;
  check("1001 concepts are compared in under 3 seconds", ms < 3000, `${Math.round(ms)} ms`);
  console.log(`       ${Math.round(ms)} ms for 1001 concepts, ${[...big.values()].reduce((n, l) => n + l.length, 0)} candidate links`);
}

{
  /* Long titles used to be cut at 48 characters, so ideas that open the same
     way landed on one concept and the second was lost. Real titles from a
     207-page drop. */
  const pairs = [
    ["Forward contract hedge for Ziggy receivables: detailed borrowing and investing steps",
     "Forward contract hedge for Ziggy receivables: detailed cost comparison"],
    ["Discount offer analysis for Ziggy Indonesia: comparison with money market hedge",
     "Discount offer analysis for Ziggy Indonesia: comparison with forward contract"],
    ["Hedging Strategies for Foreign Currency Exposure",
     "Hedging Strategies for Foreign Currency Exposure: money market hedge"],
  ];
  check("the old cut merged these titles", pairs.every(([a, b]) => legacySlug(a) === legacySlug(b)));
  check("each long title gets its own concept", pairs.every(([a, b]) => conceptSlug(a) !== conceptSlug(b)),
    pairs.map(([a, b]) => `${conceptSlug(a)} | ${conceptSlug(b)}`).join("; "));
  check("an id stays 48 characters or less", pairs.flat().every(t => conceptSlug(t).length <= 48));
  check("the same title always gives the same id", pairs.flat().every(t => conceptSlug(t) === conceptSlug(t.toUpperCase())));
  check("a short title keeps the id it had", ["Net present value", "Gold as a hedge", "x".repeat(48)]
    .every(t => conceptSlug(t) === legacySlug(t)));

  /* A concept stored under the old cut is still found by its exact title, and
     only by it. */
  const [a, b] = pairs[0];
  const stored = [{ brain: "acc", slug: legacySlug(a), title: a }];
  check("a stored long title is still found", findByTitle(stored, "acc", a) === stored[0]);
  check("its neighbour title is a new concept", findByTitle(stored, "acc", b) === undefined);
  check("a new long title is found by its new id",
    findByTitle([{ brain: "acc", slug: conceptSlug(b), title: b }], "acc", b)?.title === b);
  check("links written with a long title reach the right concept",
    linkId(b, "acc") === `acc/${conceptSlug(b)}` && linkId(a, "acc") !== linkId(b, "acc"));

  /* The app keeps its own copy to merge batches; both must agree. */
  const html = readFileSync(join(ROOT, "app", "chat.html"), "utf8");
  const src = html.match(/const conceptSlug = t => \{[\s\S]*?\n\};/);
  const client = src ? new Function(`${src[0]}; return conceptSlug;`)() : null;
  const titles = [...pairs.flat(), "Net present value", "Élan vital: a note on what the café économique argued in 1920"];
  check("the app and the server name concepts alike", !!client && titles.every(t => client(t) === conceptSlug(t)));
}

{
  /* Audit findings on the answer path, each checked so it stays fixed. */
  const k = (brain, slug, title, position, extra = {}) => ({ brain, slug, title, summaryLine: "", position,
    evidence: [], data: [], conflicts: [], related: [], ...extra });
  const pool = [{ slug: "acc", name: "Accountant", type: "subject", scope: "accounting and finance" }];
  const acc = [
    ...Array.from({ length: 12 }, (_, i) => k("acc", `gold${i}`, `Gold price driver ${i}`, "Gold rises when real rates fall.")),
    ...Array.from({ length: 3 }, (_, i) => k("acc", `dep${i}`, `Depreciation method ${i}`, "Depreciation spreads cost over useful life.")),
    k("acc", "usp", "Unique selling proposition", "A unique technique that sets the offer apart."),
    k("acc", "corp", "Corporate structure", "A holding company above operating companies."),
  ];

  /* A new subject after a follow-up leads with the new subject. */
  const r1 = dossierFor(pool, acc, "how does depreciation work?", [{ q: "what drives the gold price", a: "..." }]);
  check("a new question outweighs the one before it", r1.opened.slice(0, 3).every(c => c.slug.startsWith("dep")),
    r1.opened.slice(0, 4).map(c => c.slug).join(","));
  const r2 = dossierFor(pool, acc, "and the second one?", [{ q: "what drives the gold price", a: "..." }]);
  check("a bare follow-up still finds the subject before it", r2.opened[0]?.slug.startsWith("gold"), r2.opened[0]?.slug);

  /* Words match whole words, near enough, not pieces of other words. */
  check("'rate' does not match 'corporate'", scoreConcept(acc.at(-1), ["rate"]) === 0);
  check("'rates' matches 'rate'", scoreConcept(k("x", "r", "Interest rate", "The rate."), ["rates"]) >= 3);
  check("French folds its accents and drops its small words",
    keywords("Quelle est la méthode linéaire?").join(",") === "methode,lineaire", keywords("Quelle est la méthode linéaire?").join(","));
  check("a French question no longer reaches 'unique' through 'que'",
    scoreConcept(acc.find(c => c.slug === "usp"), keywords("qu'est-ce que c'est?")) === 0);

  /* The router read every title and picked none: nothing loose is opened. */
  const none = dossierFor(pool, acc, "how do I bake sourdough", undefined, { picked: [], terms: ["bread"], routed: true });
  check("a router's empty pick opens nothing unrelated", none.opened.length === 0 && /Nothing held bears/.test(none.dossier),
    none.opened.map(c => c.slug).join(","));
  const titled = dossierFor(pool, acc, "depreciation method", undefined, { picked: [], terms: [], routed: true });
  check("but a title that carries the question's words still opens", titled.opened.some(c => c.slug.startsWith("dep")));

  /* One huge concept is passed over, not the end of the list. */
  const huge = k("acc", "huge", "Depreciation giant", "x".repeat(59000));
  const small = k("acc", "small", "Depreciation note", "Short.");
  const r3 = dossierFor(pool, [k("acc", "first", "Depreciation first", "y".repeat(2000)), huge, small], "depreciation",
    undefined, { picked: ["acc/first", "acc/huge", "acc/small"], routed: true });
  check("a long concept does not stop later picks from opening", r3.opened.some(c => c.slug === "small"),
    r3.opened.map(c => c.slug).join(","));
  check("and no single concept sends more than 8,000 characters", r3.dossier.length < 3 * 8000 + 500, String(r3.dossier.length));

  /* Two evidence lists meet without a doubled entry, newest first. */
  const ev = mergeEvidence([{ date: "2026-03-01", claim: "b", source: "s2" }, { date: "2026-01-01", claim: "a", source: "s1" }],
                           [{ date: "2026-01-01", claim: "a", source: "s1" }, { date: "2026-02-01", claim: "c", source: "s3" }]);
  check("merged evidence keeps each entry once, newest first", ev.map(e => e.claim).join("") === "bca", ev.map(e => e.claim).join(""));
}

{
  /* The app ranks on slim copies and reads only the leaders whole. */
  const cards = concepts.map(cardOf);
  const plan = planDossier(brains, cards, "how does straight line depreciation work?");
  const lead = plan.lead.slice(0, 60).map(idOf);
  const whole = new Map(concepts.filter(c => lead.includes(idOf(c))).map(c => [idOf(c), c]));
  const r = writeDossier(brains, plan, whole);
  check("ranked on cards, the answer still opens first", r.opened[0]?.slug === "depreciation", r.opened[0]?.slug);
  check("and it opens whole, with its evidence", /cost minus residual/.test(r.dossier));
  check("only the leaders are read whole", whole.size <= 60, String(whole.size));
  const cardBytes = JSON.stringify(cards).length / cards.length, fullBytes = JSON.stringify(concepts).length / concepts.length;
  check("a card is a fraction of its concept", cardBytes < fullBytes / 2, `${Math.round(cardBytes)} vs ${Math.round(fullBytes)} bytes`);
  console.log(`       a card is ${Math.round(cardBytes)} bytes, its concept ${Math.round(fullBytes)}`);
}

{
  /* Cards carry an evidence count, not the list: ties still go to the fuller. */
  const thin = { brain: "x", slug: "thin", title: "Thin", evidence: [{}] }, full = { brain: "x", slug: "full", title: "Full", evidence: [{}, {}, {}] };
  const onCards = rankConcepts([thin, full].map(cardOf), []).map(r => r.c.slug).join(",");
  check("on cards, the fuller concept still leads a tie", onCards === "full,thin", onCards);
}

console.log(failures ? `\n${failures} failed` : "\nthe question finds its answer at any size");
process.exit(failures ? 1 : 0);
