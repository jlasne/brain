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
await esbuild.build({ entryPoints: [join(dir, "health.ts")], bundle: true, format: "esm",
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
const cards = (brain, k, deep) => Array.from({ length: k }, (_, i) => ({ brain, slug: "c" + i, src: i < deep ? 2 : 1 }));
/* Seven named authors: a name needs two letters at least, like the drop asks. */
const SEVEN = ["Ann Lee", "Bo Chen", "Cy Park", "Di Roy", "Ed Moss", "Flo Ng", "Gus Hart"];
const one = (b, cs, ss, open = 0) => healthOf([b], cs, ss, new Map([[b.slug, open]]), NOW)[0];

/* ---- variety ---- */
{
  const b = { slug: "crypto", name: "Crypto", type: "subject" };
  const h = one(b, cards("crypto", 38, 0), [src("crypto", "coinacademy", 1), src("crypto", "coinacademy", 1)]);
  check("one author earns half a point of variety", h.parts.variety.got === 0.5 && /1 named author/.test(h.parts.variety.say), JSON.stringify(h.parts.variety));
  check("and a brain with no concept on two sources earns half a point of depth", h.parts.depth.got === 0.5 && /0 of 38 concepts/.test(h.parts.depth.say));
  check("the score adds the parts", h.score === 0.5 + 0.5 + 2 + 2, String(h.score));
  check("the best move is a second author, worth a point", h.best === "A source by a new named author: +1", h.best);

  const w = { slug: "wealth", name: "Wealth", type: "subject" };
  const ws = ["Charles Gave", "Charles Gave (transmitting Romain Métivet's analysis)", "Ray Dalio", "Théophile Eliet", "Hur (YouTuber)",
    "Institut des Libertés (Louis Vincent et Charles)", "Richard Detente, Les Financiers", "unknown", "Unknown (speaker 1 and speaker 2, transcript)",
    "Inconnu", "Unnamed TV cameraman"].map((a, i) => src("wealth", a, i));
  const hw = one(w, cards("wealth", 46, 24), ws);
  check("unknown and unnamed authors count for nothing, one person under two spellings once", hw.parts.variety.say === "6 named authors, 4 unsigned",
    hw.parts.variety.say);
  check("6 named authors earn 2.5", hw.parts.variety.got === 2.5);
  check("24 of 46 concepts on two sources earn 2.5 of depth", hw.parts.depth.got === 2.5 && /\(52%\)/.test(hw.parts.depth.say), hw.parts.depth.say);
  check("7 named authors earn the full 3", one(w, [], SEVEN.map(a => src("wealth", a, 1))).parts.variety.got === 3);
}

/* ---- a person brain counts its sources ---- */
{
  const p = { slug: "gave", name: "Charles Gave", type: "person" };
  const h = one(p, cards("gave", 12, 4), [1, 2, 3, 4].map(d => src("gave", "unknown", d)));
  check("a person brain is one voice by design, so its sources count", h.parts.variety.got === 1.5 && /4 sources by this person/.test(h.parts.variety.say),
    JSON.stringify(h.parts.variety));
  const big = one(p, cards("gave", 12, 12), Array.from({ length: 10 }, (_, i) => src("gave", "unknown", i)));
  check("10 sources earn the full 3", big.parts.variety.got === 3 && big.parts.depth.got === 3);
}

/* ---- freshness and conflicts ---- */
{
  const b = { slug: "sport", name: "Sport", type: "subject" };
  const f = d => one(b, cards("sport", 4, 0), [src("sport", "Coach", d)]).parts.fresh.got;
  check("freshness steps down with the days since the last source", f(3) === 2 && f(30) === 1.5 && f(100) === 1 && f(300) === 0.5 && f(400) === 0,
    [3, 30, 100, 300, 400].map(f).join(","));
  const none = one(b, [], []);
  check("an empty brain scores nothing it has not earned", none.parts.variety.got === 0 && none.parts.depth.got === 0 && none.parts.fresh.got === 0
    && none.parts.fresh.say === "No source yet" && none.score === 2, JSON.stringify(none));
  const c = n => one(b, cards("sport", 4, 0), [src("sport", "Coach", 1)], n).parts.conflicts.got;
  check("open conflicts cost points", c(0) === 2 && c(2) === 1.5 && c(4) === 1 && c(9) === 0.5, [0, 2, 4, 9].map(c).join(","));
  const stale = one(b, cards("sport", 4, 0), [src("sport", "Coach", 400)], 7);
  check("the biggest gain leads: fresh sources before settling, when both are open", stale.best === "Add a source this week: +2", stale.best);
  const calm = one(b, cards("sport", 4, 4), SEVEN.map(a => src("sport", a, 1)), 3);
  check("with the rest full, settling is the move", calm.best === "Settle the 3 open conflicts: +1", calm.best);
  const full = one(b, cards("sport", 4, 4), SEVEN.map(a => src("sport", a, 1)), 0);
  check("full marks say so", full.score === 10 && /Full marks/.test(full.best), JSON.stringify(full));
  const deep = one(b, cards("sport", 10, 3), SEVEN.map(a => src("sport", a, 1)), 0);
  check("depth says how many concepts need a second source", deep.best === "Back 1 concept with a second source: +1", deep.best);
}

console.log(failures ? `\n${failures} failed` : "\nthe health score holds");
process.exit(failures ? 1 : 0);
