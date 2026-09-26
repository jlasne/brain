/**
 * The one-pager, built from a fixed set of positions.
 *
 * Assembling a page calls no model, so the whole thing runs here: the ranking,
 * the caps that keep it to one page, the bullet a position turns into, and the
 * mail body. Only the question path needs a model, and that one is not run.
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
for (const f of ["onepager.ts", "lib.ts", "words.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
await esbuild.build({ entryPoints: [join(dir, "onepager.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { assemble, asText, asHtml, looksLikeMail } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

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
  check("the fullest position leads", /Three sources agree/.test(p.sections[0].bullets[0]), p.sections[0].bullets[0]);
  check("a bullet carries its number", /31 percent/.test(p.sections[0].bullets[0]), p.sections[0].bullets[0]);
  check("and the date of its newest evidence", /2026-08-09/.test(p.sections[0].bullets[0]), p.sections[0].bullets[0]);
  check("a bullet with no number still ends in a stop", /so\.$|so\. \(/.test(p.sections[0].bullets[1]), p.sections[0].bullets[1]);
  check("the foot counts what was read", /3 sources read/.test(p.foot), p.foot);
  check("and how much of the brain is shown", /2 of 2 positions/.test(p.foot), p.foot);
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
  check("the text carries every bullet", p.sections[0].bullets.every(b => text.includes(b)));
  const html = asHtml(p, "Octopus");
  check("the html carries every bullet", p.sections[0].bullets.every(b => html.includes(b.replace(/&/g, "&amp;"))));
  check("the html names the space", html.includes(">Octopus<"));
  const nasty = assemble("octopus",
    [{ slug: "x", name: "<script>alert(1)</script>", type: "subject", scope: "s" }],
    [concept("x", 1, "T", "A line", [ev("2026-01-01", "A", "x")], [], "2026-01-01")], [], "x");
  check("a title with markup in it is escaped",
    asHtml(nasty, "Octopus").includes("&lt;script&gt;") && !asHtml(nasty, "Octopus").includes("<script>alert"));
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
