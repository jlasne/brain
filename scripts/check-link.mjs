/**
 * The background linking job, run end to end against a stand-in database and a
 * stand-in model.
 *
 *     node scripts/check-link.mjs
 *
 * It runs once, unwatched, over everything stored, so a mistake would do
 * nothing silently. This walks it: the free shortlist, the model's choices, the
 * links written, the next batch scheduled, the second space, a failed batch
 * skipped, and a second run adding nothing twice.
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-link-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["admin.ts", "lib.ts", "words.ts", "store.ts", "space.ts", "tidy.ts", "drop.ts", "graph.ts", "price.ts", "spend.ts", "sheet.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/server.ts"),
  "export const internalQuery = (x: any) => x; export const internalMutation = (x: any) => x; export const internalAction = (x: any) => x;\n");
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
await esbuild.build({ entryPoints: [join(dir, "admin.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")], platform: "node",
  outfile: join(dir, "bundle.mjs"), logLevel: "silent", nodePaths: [join(ROOT, "node_modules")] });
process.env.OPENROUTER_API_KEY = "test";
const admin = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "words.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")], platform: "node",
  outfile: join(dir, "words.mjs"), logLevel: "silent" });
const { cardOf } = await import(pathToFileURL(join(dir, "words.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

/* ---- the stand-in store ---- */
const K = (brain, slug, title, summaryLine, position, n) =>
  ({ brain, slug, n, title, summaryLine, position, data: [], evidence: [], sources: [], related: [] });
const DB = {
  brains: [{ slug: "acc", name: "Accountant", type: "subject", scope: "accounting", space: "squidgy" },
           { slug: "wealth", name: "Wealth", type: "subject", scope: "wealth", space: undefined }],
  concepts: [
    K("acc", "npv", "Net present value", "Discounted cash flows minus the investment.",
      "Net present value discounts each future cash flow at the discount rate and subtracts the initial investment.", 1),
    K("acc", "irr", "Internal rate of return", "The discount rate at which NPV is zero.",
      "The internal rate of return is the discount rate that sets net present value to zero.", 2),
    K("acc", "discount-rate", "Discount rate", "The rate that turns future cash flows into present value.",
      "The discount rate reflects the time value of money and project risk.", 3),
    K("acc", "gold", "Gold coins", "Coins held as a store of value.", "Gold coins keep purchasing power.", 4),
    K("wealth", "prudence", "Prudence", "Avoiding the loss that cannot be recovered.",
      "Prudence means avoiding ruin before seeking return. Risk and danger differ.", 1),
    K("wealth", "risk-and-danger", "Risk and danger", "Risk is volatility, danger is ruin.",
      "Risk and danger differ: prudence guards against danger, the unrecoverable loss.", 2),
  ],
  writes: [], scheduled: [],
};
const ctx = {
  runQuery: async (fn, a) => {
    /* Linking reads the slim copies, made the way the store makes them. */
    if (fn === "store.spaceHead") {
      return { brains: DB.brains.filter(b => (b.space ?? "octopus") === a.space), sources: [], ready: true };
    }
    if (fn === "store.cardsPage") {
      const all = DB.concepts.filter(c => c.brain === a.brain).map(cardOf), from = Number(a.cursor ?? 0);
      return { cards: all.slice(from, from + 500), done: from + 500 >= all.length, cursor: String(from + 500) };
    }
    throw new Error("unexpected query " + fn);
  },
  runMutation: async (fn, a) => {
    if (fn !== "store.addRelated") throw new Error("unexpected mutation " + fn);
    DB.writes.push(a);
    const c = DB.concepts.find(x => x.brain === a.brain && x.slug === a.slug);
    const before = new Set(c.related);
    c.related = [...new Set([...c.related, ...a.ids])].slice(0, 12);
    return { added: c.related.filter(x => !before.has(x)).length };
  },
  scheduler: { runAfter: async (_ms, fn, a) => { DB.scheduled.push({ fn, ...a }); } },
};

/* ---- the stand-in model: keeps every candidate whose title shares a word
   with the concept's own, except for gold, and fails once when told to ---- */
let failNext = false;
globalThis.fetch = async (_u, opt) => {
  if (failNext) { failNext = false; return new Response("upstream down", { status: 503 }); }
  const job = JSON.parse(opt.body).messages[1].content;
  const links = {};
  for (const block of job.split(/\n(?=### )/).filter(b => b.startsWith("### "))) {
    const n = block.match(/^### (\d+)/)[1];
    const cands = [...block.matchAll(/^\s+(\d+)\) ([^[]+)\[/gm)].map(m => ({ k: Number(m[1]), title: m[2].trim() }));
    links[n] = /Gold/.test(block.split("\n")[0]) ? [] : cands.filter(c => !/Gold/.test(c.title)).map(c => c.k);
  }
  return Response.json({ choices: [{ message: { content: JSON.stringify({ links }) }, finish_reason: "stop" }] });
};

/* Runs the scheduled steps the way the platform would, one after another. */
const drain = async () => {
  let guard = 0;
  while (DB.scheduled.length && guard++ < 500) {
    const { fn, ...args } = DB.scheduled.shift();
    await admin[fn.split(".")[1]].handler(ctx, args);
  }
};
const quiet = console.log; const logs = [];
const hush = () => { console.log = (...a) => logs.push(a.join(" ")); };
const talk = () => { console.log = quiet; };

/* ---- preview ---- */
{
  const p = await admin.linkPreview.handler(ctx, {});
  const sq = p.find(x => x.space === "squidgy"), oc = p.find(x => x.space === "octopus");
  check("the preview counts what it would check, per space", sq.concepts === 4 && sq.toCheck >= 2 && oc.concepts === 2,
    JSON.stringify(p.map(x => [x.space, x.concepts, x.toCheck])));
  check("the preview writes nothing", DB.writes.length === 0);
}

/* ---- a full run ---- */
{
  const r = await admin.linkAll.handler(ctx, {});
  check("linkAll starts in the background and says how to follow it", /background/.test(r) && DB.scheduled.length === 1, r);
  hush(); await drain(); talk();
  const npv = DB.concepts.find(c => c.slug === "npv"), gold = DB.concepts.find(c => c.slug === "gold");
  const prudence = DB.concepts.find(c => c.slug === "prudence");
  check("NPV is linked to IRR and the discount rate", ["acc/irr", "acc/discount-rate"].every(x => npv.related.includes(x)), npv.related.join(","));
  check("gold stays unlinked", gold.related.length === 0, gold.related.join(","));
  check("the second space is linked too", prudence.related.includes("wealth/risk-and-danger"), prudence.related.join(","));
  check("the run says when it is finished", logs.some(l => /linking finished/.test(l)), logs.join(" | "));
}

/* ---- a second run adds nothing twice ---- */
{
  const before = DB.writes.length;
  await admin.linkAll.handler(ctx, {});
  hush(); await drain(); talk();
  check("a second run sends only concepts with new candidates, and adds nothing twice",
    DB.writes.length === before, `${DB.writes.length - before} new writes`);
}

/* ---- a failed batch is skipped, the run goes on ---- */
{
  DB.concepts.find(c => c.slug === "prudence").related = [];
  DB.concepts.find(c => c.slug === "risk-and-danger").related = [];
  DB.concepts.find(c => c.slug === "npv").related = [];
  failNext = true; logs.length = 0;
  await admin.linkAll.handler(ctx, {});
  hush(); await drain(); talk();
  check("a failed batch is logged", logs.some(l => /failed/.test(l)), logs.join(" | "));
  /* Octopus runs first, so the failure lands on its batch and Squidgy follows. */
  check("the failed batch is skipped", DB.concepts.find(c => c.slug === "prudence").related.length === 0);
  check("and the next space still runs", DB.concepts.find(c => c.slug === "npv").related.length > 0);
  check("running again picks up what the failure skipped", await (async () => {
    await admin.linkAll.handler(ctx, {}); hush(); await drain(); talk();
    return DB.concepts.find(c => c.slug === "prudence").related.length > 0;
  })());
}

/* ---- a drop links only what it wrote, against the whole space ---- */
{
  for (const c of DB.concepts) c.related = [];
  const writes = DB.writes.length;
  hush(); await admin.linkConcepts.handler(ctx, { space: "squidgy", ids: ["acc/npv"] }); talk();
  const touched = new Set(DB.writes.slice(writes).map(w => `${w.brain}/${w.slug}`));
  check("a drop's linking writes only the concepts it was given", [...touched].join(",") === "acc/npv", [...touched].join(","));
  check("shortlisted against the whole space", DB.concepts.find(c => c.slug === "npv").related.length >= 2,
    DB.concepts.find(c => c.slug === "npv").related.join(","));
  check("and leaves the rest as they were", DB.concepts.filter(c => c.slug !== "npv").every(c => !c.related.length));
}

/* ---- a long run reaches every concept ---- */
{
  /* 120 concepts in pairs. Batches used to be walked by number over a list
     rebuilt each step: concepts linked in batch 1 left it, the rest slid
     forward, and half were never sent. */
  const saved = DB.concepts.slice(), brains = DB.brains.slice();
  DB.brains.push({ slug: "big", name: "Big", type: "subject", scope: "many", space: undefined });
  for (let i = 0; i < 60; i++) {
    const w = `zq${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}word`;
    DB.concepts.push(K("big", `a${i}`, `Alpha ${w}`, `About ${w}.`, `${w} explains the alpha case in full.`, 100 + i));
    DB.concepts.push(K("big", `b${i}`, `Beta ${w}`, `More on ${w}.`, `${w} explains the beta case in full.`, 200 + i));
  }
  await admin.linkAll.handler(ctx, {});
  hush(); await drain(); talk();
  const big = DB.concepts.filter(c => c.brain === "big");
  const bare = big.filter(c => !c.related.length);
  check("a run over 120 concepts reaches every one", bare.length === 0, `${bare.length} never linked: ${bare.slice(0, 5).map(c => c.slug).join(",")}`);
  DB.concepts.splice(0, DB.concepts.length, ...saved);
  DB.brains.splice(0, DB.brains.length, ...brains);
}

/* ---- a drop's linking is kept to what its source fed ---- */
{
  for (const c of DB.concepts) c.related = [];
  DB.concepts.find(c => c.slug === "npv").sources = ["s-drop"];
  const writes = DB.writes.length;
  hush(); await admin.linkConcepts.handler(ctx, { space: "squidgy", ids: ["acc/npv", "acc/irr"], sid: "s-drop" }); talk();
  const touched = new Set(DB.writes.slice(writes).map(w => `${w.brain}/${w.slug}`));
  check("ids the source never fed are left alone", touched.has("acc/npv") && !touched.has("acc/irr"), [...touched].join(","));
  DB.concepts.find(c => c.slug === "npv").sources = [];
}

/* ---- a drop's linking reaches everything it wrote, whatever the number ---- */
{
  const saved = DB.concepts.slice(), brains = DB.brains.slice();
  DB.brains.push({ slug: "huge", name: "Huge", type: "subject", scope: "many", space: undefined });
  const ids = [];
  for (let i = 0; i < 700; i++) {
    const w = `zz${i.toString(36)}term`;
    DB.concepts.push(K("huge", `a${i}`, `Alpha ${w}`, `About ${w}.`, `${w} explains the alpha case in full.`, i + 1));
    DB.concepts.push(K("huge", `b${i}`, `Beta ${w}`, `More on ${w}.`, `${w} explains the beta case in full.`, 1000 + i));
    ids.push(`huge/a${i}`, `huge/b${i}`);
  }
  const t0 = performance.now();
  hush(); await admin.linkConcepts.handler(ctx, { space: "octopus", ids }); await drain(); talk();
  const ms = performance.now() - t0;
  const bare = DB.concepts.filter(c => c.brain === "huge" && !c.related.length);
  check("a drop of 1,400 concepts links every one", bare.length === 0, `${bare.length} never linked`);
  check("a long link run hands the rest to fresh runs", logs.some(l => /handed on/.test(l)), logs.slice(-3).join(" | "));
  console.log(`       1,400 concepts linked in ${Math.round(ms)} ms of local work`);
  DB.concepts.splice(0, DB.concepts.length, ...saved);
  DB.brains.splice(0, DB.brains.length, ...brains);
}

/* ---- one drop grows the graph: meaning, kinds, what follows, topics ---- */
{
  const G = {
    brains: [{ slug: "fin", name: "Finance", type: "subject", scope: "corporate finance" },
             { slug: "macro", name: "Macro", type: "subject", scope: "the economy" }],
    concepts: [
      { ...K("fin", "npv", "Net present value", "Discounted cash flows minus the investment.", "NPV discounts each cash flow at the discount rate.", 1), _id: "c1" },
      { ...K("fin", "discount-rate", "Discount rate", "The rate that turns future cash flows into present value.", "The discount rate reflects the time value of money.", 2), _id: "c2", related: ["fin/wacc"] },
      { ...K("fin", "wacc", "Weighted average cost of capital", "The blend of debt and equity costs.", "WACC is the usual discount rate for a firm.", 3), _id: "c3", related: ["fin/discount-rate"] },
      { ...K("macro", "policy", "Central bank policy", "Sets the cost of money for the whole economy.", "Policy moves the price of credit.", 1), _id: "c4" },
    ],
    vectors: [], insights: [], topics: [], embedded: [], asked: [],
  };
  const ctx2 = {
    runQuery: async (fn, a) => {
      if (fn === "store.spaceHead") return { brains: G.brains, sources: [], ready: true };
      if (fn === "store.cardsPage") { const all = G.concepts.filter(c => c.brain === a.brain).map(cardOf); return { cards: all, done: true, cursor: "x" }; }
      if (fn === "store.conceptsByIds") return a.ids.map(id => G.concepts.find(c => `${c.brain}/${c.slug}` === id)).filter(Boolean);
      if (fn === "graph.vectorOwners") return a.ids.map(id => ({ "v-policy": "macro/policy", "v-dr": "fin/discount-rate" })[id] ?? null);
      if (fn === "graph.topicsOf") return G.topics.filter(t => t.brain === a.brain);
      throw new Error("unexpected query " + fn);
    },
    runMutation: async (fn, a) => {
      if (fn === "graph.putVectors") { G.vectors.push(...a.items); return; }
      if (fn === "graph.putInsights") { G.insights.push(...a.items); return a.items.length; }
      if (fn === "graph.setTopics") { G.topics = G.topics.filter(t => t.brain !== a.brain).concat(a.topics.map(t => ({ ...t, brain: a.brain }))); return; }
      if (fn === "store.addRelated") {
        const c = G.concepts.find(x => x.brain === a.brain && x.slug === a.slug);
        const before = new Set(c.related); c.related = [...new Set([...c.related, ...a.ids])];
        c.kinds = [...(c.kinds ?? []).filter(k => !(a.kinds ?? []).some(n => n.to === k.to)), ...(a.kinds ?? [])];
        return { added: c.related.filter(x => !before.has(x)).length };
      }
      throw new Error("unexpected mutation " + fn);
    },
    /* The meaning search: Net present value sits close to central bank policy,
       which shares none of its words. */
    vectorSearch: async (_t, _i, q) => q.vector[0] === 1 ? [{ _id: "v-policy", _score: 0.91 }, { _id: "v-dr", _score: 0.88 }] : [],
    scheduler: { runAfter: async () => {} },
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, opt) => {
    const body = JSON.parse(opt.body);
    if (String(u).endsWith("/embeddings")) {
      G.embedded.push(body);
      return Response.json({ data: body.input.map((t, index) => { const e = new Array(1024).fill(0); e[0] = /Net present value/.test(t) ? 1 : 0; e[1] = 1; return { index, embedding: e }; }) });
    }
    const sys = body.messages[0].content, job = body.messages[1].content;
    G.asked.push(sys);
    if (/connect the concepts/.test(sys)) {
      const links = {};
      for (const block of job.split(/\n(?=### )/).filter(b => b.startsWith("### "))) {
        const n = block.match(/^### (\d+)/)[1];
        links[n] = [...block.matchAll(/^\s+(\d+)\) ([^[]+)\[/gm)].map(m => ({ c: Number(m[1]), t: /Discount rate/.test(m[2]) ? "needs" : /policy/i.test(m[2]) ? "causes" : "related" }));
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({ links }) }, finish_reason: "stop" }] });
    }
    if (/draw conclusions/.test(sys)) return Response.json({ choices: [{ message: { content: JSON.stringify({ insights: [{ n: 1, title: "Policy moves every NPV", text: "A rate change by the central bank shifts the discount rate, so every project's NPV moves with it." }] }) }, finish_reason: "stop" }] });
    if (/name the themes/.test(sys)) return Response.json({ choices: [{ message: { content: JSON.stringify({ topics: [{ n: 1, title: "Discounting cash flows", summary: "How future cash is valued today." }] }) }, finish_reason: "stop" }] });
    return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  };
  hush(); await admin.linkConcepts.handler(ctx2, { space: "octopus", ids: ["fin/npv"] }); talk();
  globalThis.fetch = real;
  const npv = G.concepts.find(c => c.slug === "npv");
  check("a drop embeds what it wrote, on the multilingual model", G.embedded.length === 1 && G.embedded[0].model === "baai/bge-m3"
    && G.vectors.length === 1 && G.vectors[0].cid === "c1", JSON.stringify(G.embedded.map(e => e.input)));
  check("a concept close in meaning joins the shortlist, though it shares no word", npv.related.includes("macro/policy"), npv.related.join(","));
  check("each link says what it is", JSON.stringify((npv.kinds ?? []).map(k => `${k.to}:${k.type}`).sort()) === '["fin/discount-rate:needs","macro/policy:causes"]',
    JSON.stringify(npv.kinds));
  check("what follows from a link across two folders is written, and marked derived by where it lives",
    G.insights.length === 1 && G.insights[0].a === "fin/npv" && G.insights[0].b === "macro/policy" && /central bank/.test(G.insights[0].text), JSON.stringify(G.insights));
  check("the folder's topics follow the links: three concepts that link to each other, named",
    G.topics.length === 1 && G.topics[0].title === "Discounting cash flows" && G.topics[0].members.length === 3 && G.topics[0].brain === "fin", JSON.stringify(G.topics));
  check("a folder whose links make no group of three gets no topic", !G.topics.some(t => t.brain === "macro"));
}

console.log(failures ? `\n${failures} failed` : "\nlinking holds");
process.exit(failures ? 1 : 0);
