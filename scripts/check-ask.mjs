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

import { mkdtempSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-ask-"));
copyFileSync(join(ROOT, "convex", "words.ts"), join(dir, "words.ts"));
await esbuild.build({ entryPoints: [join(dir, "words.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { dossierFor, indexFor, linkId, neighbours, FULL_CHARS, TITLE_CHARS } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

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

console.log(failures ? `\n${failures} failed` : "\nthe question finds its answer at any size");
process.exit(failures ? 1 : 0);
