/**
 * A brain's health out of 10: variety, depth, freshness and conflicts, and
 * the one move that raises it most. No model is called, so it all runs here.
 *
 *     node scripts/check-health.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-health-"));
mkdirSync(join(dir, "_generated"));
for (const f of readdirSync(join(ROOT, "convex")).filter(f => f.endsWith(".ts"))) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
writeFileSync(join(dir, "_generated/server.ts"), "const f = (x) => x;\nexport const internalQuery = f, internalMutation = f, internalAction = f, httpAction = f, query = f, mutation = f, action = f;\n");
await esbuild.build({ entryPoints: [join(dir, "health.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { healthOf } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

const DAY = 86400000, NOW = Date.parse("2026-09-30T12:00:00Z");
const ago = d => new Date(NOW - d * DAY).toISOString().slice(0, 10);
const src = (brain, author, days) => ({ brains: [brain], author, stored: ago(days) });
/* Each concept with its own title and a position, so nothing reads as one to tidy. */
const TOPICS = ["gold", "rates", "yen", "oil", "bonds", "copper", "housing", "wages", "credit", "silver", "grain", "steel"];
const cards = (brain, k, deep) => Array.from({ length: k }, (_, i) => ({ brain, slug: "c" + i, title: `${TOPICS[i % 12]} cycle ${i}`,
  summaryLine: `The ${TOPICS[i % 12]} view holds.`, src: i < deep ? 2 : 1 }));
const SIX = ["Ann Lee", "Bo Chen", "Cy Park", "Di Roy", "Ed Moss", "Flo Ng"];

/* Wealth: six authors, half its concepts deep, fed today, calm.
   Crypto: one author, nothing deep, two weeks old, one open conflict.
   Charles Gave: a person, every concept deep, fed today, calm. */
const brains = [
  { slug: "wealth", name: "Wealth", type: "subject" },
  { slug: "crypto", name: "Crypto", type: "subject" },
  { slug: "gave", name: "Charles Gave", type: "person" },
];
const all = [...cards("wealth", 10, 5), ...cards("crypto", 10, 0), ...cards("gave", 10, 10)];
const sources = [...SIX.map(a => src("wealth", a, 0)), src("crypto", "coinacademy", 14), src("crypto", "coinacademy", 20),
  ...[0, 1, 2].map(d => src("gave", "unknown", d))];
const hs = Object.fromEntries(healthOf(brains, all, sources, new Map([["crypto", 1]]), NOW).map(h => [h.slug, h]));

/* ---- the best brain reads 10, the others against it ---- */
{
  check("the best brain reads 10 and says so", hs.gave.score === 10 && hs.gave.top && /best folder/.test(hs.gave.best), JSON.stringify(hs.gave));
  check("the others read against it", hs.wealth.score === 8.8 && hs.crypto.score === 3.8 && !hs.wealth.top,
    `${hs.wealth.score} ${hs.crypto.score}`);
  check("a person brain is not marked down for one voice", hs.gave.parts.variety.counted === false && /one voice/.test(hs.gave.parts.variety.say));
}

/* ---- each part against the best on it ---- */
{
  check("variety names the best subject", hs.wealth.parts.variety.pct === 100 && /6 named authors\. The most of any folder/.test(hs.wealth.parts.variety.say)
    && hs.crypto.parts.variety.pct === 17 && /1 named author\. Best: Wealth, 6/.test(hs.crypto.parts.variety.say), JSON.stringify(hs.crypto.parts.variety));
  check("depth compares with the deepest brain, a person included", hs.wealth.parts.depth.pct === 50
    && /50% of 10 concepts rest on 2\+ sources\. Best: Charles Gave, 100%/.test(hs.wealth.parts.depth.say), hs.wealth.parts.depth.say);
  check("freshness compares with the freshest", hs.crypto.parts.fresh.pct === 50 && /Last source 14 days ago\. Best: Wealth, today/.test(hs.crypto.parts.fresh.say),
    JSON.stringify(hs.crypto.parts.fresh));
  check("conflicts compare with the calmest", hs.crypto.parts.conflicts.pct === 50 && /1 open conflict in 10 concepts\. Best: Wealth, none open/.test(hs.crypto.parts.conflicts.say),
    JSON.stringify(hs.crypto.parts.conflicts));
}

/* ---- the best move closes the widest gap ---- */
{
  check("Wealth's widest gap is depth", hs.wealth.best === "Back more concepts with a second source: 50% here, 100% in Charles Gave.", hs.wealth.best);
  check("an open conflict comes first: it can be settled today", hs.crypto.best === "Settle the 1 open conflict.", hs.crypto.best);
  const calm = Object.fromEntries(healthOf(brains, all, sources, new Map([["wealth", 3]]), NOW).map(h => [h.slug, h]));
  check("an open conflict lowers the score, and settling can be the move", calm.wealth.score < hs.wealth.score && calm.wealth.open === 3,
    `${calm.wealth.score}`);
}

/* ---- tidiness: twins, titles not in English, empty positions ---- */
{
  const b = [{ slug: "w", name: "W", type: "subject" }, { slug: "x", name: "X", type: "subject" }];
  const messy = [...cards("w", 6, 3),
    { brain: "w", slug: "t1", title: "Four quadrants framework for market regimes", summaryLine: "Four quadrants guide picks.", src: 1 },
    { brain: "w", slug: "t2", title: "The four quadrants of market regimes", summaryLine: "Four squares map assets.", src: 1 },
    { brain: "w", slug: "f1", title: "Prix du Bitcoin (French)", summaryLine: "Le prix monte.", src: 1 },
    { brain: "w", slug: "e1", title: "Bitcoin transaction fees", summaryLine: "", lead: "", src: 1 }];
  const ss = [src("w", "Ann Lee", 1), src("x", "Ann Lee", 1)];
  const hx = Object.fromEntries(healthOf(b, [...messy, ...cards("x", 10, 5)], ss, new Map(), NOW).map(h => [h.slug, h]));
  check("tidiness counts near twin titles, titles not in English and empty positions",
    hx.w.parts.tidy.say === "3 things to tidy: 1 pair of titles near twins, 1 title not in English, 1 concept with no position", hx.w.parts.tidy.say);
  check("it lowers the score against a tidy brain", hx.w.parts.tidy.pct < 100 && hx.x.parts.tidy.pct === 100 && hx.x.parts.tidy.say === "Nothing to tidy");
  check("and with no conflict open, tidying is the move", hx.w.best === "Tidy it: 1 pair of titles near twins, 1 title not in English, 1 concept with no position.", hx.w.best);
  check("distinct titles that share a word are not twins", hx.x.parts.tidy.pct === 100);
}

/* ---- authors ---- */
{
  const b = [{ slug: "w", name: "W", type: "subject" }];
  const ss = ["Charles Gave", "Charles Gave (transmitting Romain Métivet's analysis)", "Ray Dalio", "unknown",
    "Unknown (speaker 1 and speaker 2, transcript)", "Inconnu", "Unnamed TV cameraman"].map(a => src("w", a, 1));
  const [h] = healthOf(b, cards("w", 4, 2), ss, new Map(), NOW);
  check("unknown and unnamed authors count for nothing, one person under two spellings once", h.parts.variety.say.startsWith("2 named authors, 4 unsigned"),
    h.parts.variety.say);
  check("a lone brain is its own best, and reads 10", h.score === 10 && h.top);
}

/* ---- empty ---- */
{
  const b = [{ slug: "e", name: "Empty", type: "subject" }, { slug: "f", name: "Fed", type: "subject" }];
  const hs2 = Object.fromEntries(healthOf(b, cards("f", 3, 1), [src("f", "Ann Lee", 2)], new Map(), NOW).map(h => [h.slug, h]));
  check("an empty brain reads 0 and asks for a first source", hs2.e.score === 0 && /first source/.test(hs2.e.best) && hs2.f.score === 10, JSON.stringify(hs2.e));
  check("an empty space scores nothing", healthOf([], [], [], new Map(), NOW).length === 0);
}

console.log(failures ? `\n${failures} failed` : "\nthe health score holds");
process.exit(failures ? 1 : 0);
