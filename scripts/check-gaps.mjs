/**
 * Blind spots: the GAP line an answer adds, the spots read from what is
 * stored, and the call that writes each one precisely, against a stand-in
 * model.
 *
 *     node scripts/check-gaps.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-gaps-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["gaps.ts", "lib.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
await esbuild.build({ entryPoints: [join(dir, "gaps.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { splitGap, spotsFrom, adviseSpots, GAP_RULE } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

/* ---- the GAP line comes off the answer ---- */
{
  const a = "Gold rose 12% in 2025.\nThe brains hold nothing on silver.\n\nSources: Gave, 2025-03-01\nGAP: silver's role as a hedge | FIND: A study of silver against inflation since 1970, by a commodities analyst, with data";
  const r = splitGap(a);
  check("the GAP line is cut from the answer, the sources line kept", r.answer.endsWith("Sources: Gave, 2025-03-01") && !/GAP/.test(r.answer), r.answer);
  check("and what it said is kept", r.gap === "silver's role as a hedge" && /^A study of silver/.test(r.find), JSON.stringify(r));
  const none = splitGap("Gold rose 12%.\n\nSources: Gave, 2025-03-01");
  check("an answer with no GAP line is left whole", none.gap === "" && none.answer === "Gold rose 12%.\n\nSources: Gave, 2025-03-01");
  const bold = splitGap("Nothing on it.\n**GAP:** crypto taxes in France | **FIND:** a French tax adviser's guide, see https://example.com/x");
  check("a bold GAP line is read too, and a link in it is cut", bold.gap === "crypto taxes in France" && !/https?:/.test(bold.find)
    && /tax adviser's guide/.test(bold.find), JSON.stringify(bold));
  const bare = splitGap("Nothing on it.\nGAP: crypto taxes in France");
  check("a GAP line with no FIND still counts", bare.gap === "crypto taxes in France" && bare.find === "" && bare.answer === "Nothing on it.");
  check("the rule forbids naming a source", /never names a title, a person, a channel, a website or a link/.test(GAP_RULE));
}

/* ---- spots from what is stored ---- */
const DAY = 86400000, NOW = Date.parse("2026-09-29T12:00:00Z");
const brains = [
  { slug: "crypto", name: "Crypto", type: "subject", scope: "Knowledge about crypto" },
  { slug: "sport", name: "Sport", type: "subject", scope: "Key concepts for any sport" },
  { slug: "gave", name: "Charles Gave", type: "person", scope: "Brain of Charles Gave" },
  { slug: "wealth", name: "Wealth", type: "subject", scope: "Where to place my capital" },
];
const cards = [
  ...Array.from({ length: 38 }, (_, i) => ({ brain: "crypto", title: "Crypto idea " + i, src: i < 30 ? 1 : 2 })),
  ...Array.from({ length: 4 }, (_, i) => ({ brain: "sport", title: "Sport idea " + i, src: 1 })),
  ...Array.from({ length: 12 }, (_, i) => ({ brain: "gave", title: "Gave idea " + i, src: 2 })),
  ...Array.from({ length: 46 }, (_, i) => ({ brain: "wealth", title: "Wealth idea " + i, src: 3 })),
];
const src = (brain, author, date) => ({ brains: [brain], author, date });
const sources = [
  src("crypto", "Coin Academy", "2026-05-01"), src("crypto", "Coin Academy", "2026-06-01"), src("crypto", "Coin Academy", "2026-07-01"),
  src("crypto", "Coin Academy", "2026-07-02"), src("crypto", "Coin Academy", "2026-08-01"), src("crypto", "Other", "2026-08-02"),
  src("sport", "Coach", "2026-01-01"),
  ...Array.from({ length: 6 }, (_, i) => src("gave", "Charles Gave", "2026-0" + (i + 1) + "-01")),
  ...Array.from({ length: 18 }, (_, i) => src("wealth", "Author " + (i % 9), "2026-0" + ((i % 9) + 1) + "-01")),
];
const gaps = [
  { _id: "g1", q: "What tax do I pay on crypto in France?", gap: "Crypto taxes in France", find: "A French tax adviser's guide", brains: ["crypto"], at: NOW - 2 * DAY },
  { _id: "g2", q: "How are crypto gains taxed here?", gap: "crypto taxes in France.", find: "", brains: ["crypto"], at: NOW - 1 * DAY },
  { _id: "g3", q: "Best silver hedge?", gap: "Silver as a hedge", find: "", brains: ["wealth"], at: NOW - 100 * DAY },
];
{
  const spots = spotsFrom(brains, cards, sources, gaps, NOW);
  const byId = Object.fromEntries(spots.map(s => [s.id, s]));
  check("questions come first, the same gap asked twice is one spot", spots[0].kind === "asked" && spots[0].gapIds.length === 2
    && spots[0].questions.length === 2 && /Asked 2 times, last on 2026-09-28/.test(spots[0].why), JSON.stringify(spots[0]));
  check("and keeps what to look for from whichever question said it", spots[0].find === "A French tax adviser's guide", spots[0].find);
  check("a question older than 90 days is dropped", !spots.some(s => (s.gapIds || []).includes("g3")));
  check("a brain of 1 source is a thin brain", byId["b-sport"]?.kind === "few" && /Sport rests on 1 source for 4 concepts/.test(byId["b-sport"].gap),
    JSON.stringify(byId["b-sport"]));
  check("a subject brain fed by one voice says so, with the numbers", byId["b-crypto"]?.kind === "one-voice"
    && /83% of Crypto comes from one voice, Coin Academy/.test(byId["b-crypto"].gap) && /5 of 6 from Coin Academy/.test(byId["b-crypto"].why)
    && /30 of 38 concepts on one source/.test(byId["b-crypto"].why), JSON.stringify(byId["b-crypto"]));
  check("a person brain is one voice by design, so only its size counts", !byId["b-gave"]);
  check("a brain fed by 18 sources from 9 authors has no blind spot", !byId["b-wealth"]);
  check("the thinnest brain ranks before the one-voice brain", spots.findIndex(s => s.id === "b-sport") < spots.findIndex(s => s.id === "b-crypto"));
  const old = spotsFrom([brains[3]], cards, sources.map(s => s.brains[0] === "wealth" ? { ...s, date: "2024-03-01" } : s), [], NOW);
  check("a brain whose newest source is over a year old is flagged", old[0]?.kind === "old" && /2024-03/.test(old[0].gap), JSON.stringify(old));
}

/* ---- one call writes each spot precisely ---- */
{
  const real = globalThis.fetch;
  const spots = spotsFrom(brains, cards, sources, gaps, NOW);
  let prompt = "";
  globalThis.fetch = async (_u, opt) => {
    prompt = JSON.parse(opt.body).messages[1].content;
    const content = JSON.stringify({ spots: [
      { id: "b-crypto", gap: "Crypto holds no view on regulation risk: 5 of 6 sources come from one channel.",
        find: "A skeptic's long-form analysis of stablecoin risk, by a central bank economist. See https://example.com" },
      { id: spots[0].id, gap: "How French tax treats crypto gains.", find: "A French tax adviser's written guide with 2026 rates." } ] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const r = await adviseSpots(spots, brains, cards, { key: "k" });
  const c = r.spots.find(s => s.id === "b-crypto"), q = r.spots[0], sport = r.spots.find(s => s.id === "b-sport");
  check("the call sees the data, the questions and the thinnest concepts", /DATA: Crypto: 38 concepts from 6 sources/.test(prompt)
    && /ASKED: "How are crypto gains taxed here\?"; "What tax do I pay on crypto in France\?"/.test(prompt) && /THINNEST CONCEPTS: Crypto idea 0/.test(prompt), prompt.slice(prompt.indexOf("ID:"), prompt.indexOf("ID:") + 900));
  check("and is told to describe a source, never name one", /Never name a title, a person, a channel, a publication, a website or a link/.test(prompt));
  check("each spot comes back precise", r.advised && /regulation risk/.test(c.gap) && /French tax/.test(q.gap), JSON.stringify(c));
  check("a link that slipped into the advice is cut", !/https?:/.test(c.find) && /skeptic's long-form analysis/.test(c.find), c.find);
  check("a spot the call left out keeps its first wording", /Sport rests on 1 source/.test(sport.gap));
  globalThis.fetch = async () => { throw new Error("down"); };
  const down = await adviseSpots(spots, brains, cards, { key: "k" });
  check("a failed call keeps the list as it was", !down.advised && down.spots.length === spots.length && down.spots[0].gap === spots[0].gap);
  globalThis.fetch = real;
}

console.log(failures ? `\n${failures} failed` : "\nthe blind spots hold");
process.exit(failures ? 1 : 0);
