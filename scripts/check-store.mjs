/**
 * The database rules, run against an in-memory table store.
 *
 * store.ts holds every write. These are the rules that keep a space to itself,
 * keep a source to its owner, and keep a concept whole when two writes meet:
 * the ones the audit found open, checked so they stay shut.
 *
 *     node scripts/check-store.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-store-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["store.ts", "lib.ts", "words.ts", "admin.ts", "space.ts", "digest.ts", "onepager.ts", "route.ts", "conflicts.ts", "drop.ts", "tidy.ts", "graph.ts", "price.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
/* A query or mutation is its definition, so a test can call its handler. */
writeFileSync(join(dir, "_generated/server.ts"),
  "export const internalQuery = (d: any) => d;\nexport const internalMutation = (d: any) => d;\nexport const internalAction = (d: any) => d;\n");
await esbuild.build({ entryPoints: [join(dir, "store.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const store = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "admin.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "admin.mjs"), logLevel: "silent" });
const admin = await import(pathToFileURL(join(dir, "admin.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "price.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "price.mjs"), logLevel: "silent" });
const price = await import(pathToFileURL(join(dir, "price.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "digest.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "digest.mjs"), logLevel: "silent" });
const digest = await import(pathToFileURL(join(dir, "digest.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "conflicts.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "conflicts.mjs"), logLevel: "silent" });
const conflicts = await import(pathToFileURL(join(dir, "conflicts.mjs")).href);


await esbuild.build({ entryPoints: [join(dir, "lib.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "lib.mjs"), logLevel: "silent" });
const lib = await import(pathToFileURL(join(dir, "lib.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

/* ---- a table store with the index reads store.ts uses ---- */
function makeDb() {
  const T = {};
  let id = 0;
  const rows = t => (T[t] ??= []);
  const query = t => {
    let conds = [];
    const api = {
      withIndex(_name, fn) {
        const q = { eq(f, v) { conds.push([f, v]); return q; }, gte(f, v) { conds.push([f, v, "gte"]); return q; } };
        if (fn) fn(q);
        return api;
      },
      order(dir) { api._desc = dir === "desc"; return api; },
      async collect() {
        const all = rows(t).filter(r => conds.every(([f, v, op]) => op === "gte" ? r[f] >= v : r[f] === v));
        return api._desc ? all.slice().reverse() : all;
      },
      async first() { return (await api.collect())[0] ?? null; },
      async take(n) { return (await api.collect()).slice(0, n); },
      async paginate({ numItems, cursor }) {
        const all = await api.collect(), from = cursor ? Number(cursor) : 0;
        const page = all.slice(from, from + numItems);
        return { page, isDone: from + numItems >= all.length, continueCursor: String(from + numItems) };
      },
      async unique() {
        const all = await api.collect();
        if (all.length > 1) throw new Error(`unique() found ${all.length} rows in ${t}`);
        return all[0] ?? null;
      },
    };
    return api;
  };
  const find = _id => Object.values(T).flat().find(r => r._id === _id);
  return {
    T,
    db: {
      query,
      async get(_id) { return find(_id) ?? null; },
      normalizeId(t, _id) { return rows(t).some(r => r._id === _id) ? _id : null; },
      async insert(t, doc) { const r = { _id: `id${++id}`, ...doc }; rows(t).push(r); return r._id; },
      async patch(_id, doc) { Object.assign(find(_id), doc); },
      async replace(_id, doc) { const r = find(_id); for (const k of Object.keys(r)) if (k !== "_id") delete r[k]; Object.assign(r, doc); },
      async delete(_id) { for (const t in T) T[t] = T[t].filter(r => r._id !== _id); },
    },
  };
}
const run = (fn, ctx, args) => fn.handler(ctx, args);
const throws = async p => { try { await p; return ""; } catch (e) { return String(e.message); } };

function seed() {
  const { T, db } = makeDb();
  T.brains = [
    { _id: "b1", slug: "wealth", name: "Wealth", type: "subject", scope: "s", space: undefined },
    { _id: "b2", slug: "dogs", name: "Dogs", type: "subject", scope: "s", space: "squidgy" },
  ];
  T.concepts = [
    { _id: "c1", brain: "wealth", slug: "gold", n: 1, title: "Gold", position: "Gold holds.", summaryLine: "",
      evidence: [{ date: "2026-01-01", author: "A", claim: "gold kept value", source: "s-a" }],
      data: ["2000 years"], conflicts: [], sources: ["s-a"], related: ["wealth/silver"], updated: "2026-01-01" },
    { _id: "c2", brain: "wealth", slug: "silver", n: 2, title: "Silver", position: "", summaryLine: "",
      evidence: [], data: [], conflicts: [], sources: [], related: ["wealth/gold"], updated: "2026-01-01" },
  ];
  T.sources = [
    { _id: "s1", sid: "yt-abc", link: "https://youtu.be/abc", linkKey: "yt:abc", title: "Octo video", author: "A",
      date: "2026-01-01", location: "", brains: ["wealth"], stored: "2026-01-01" },
    { _id: "s2", sid: "squidgy-yt-xyz", link: "https://youtu.be/xyz", linkKey: "yt:xyz", title: "Dog video", author: "B",
      date: "2026-01-02", location: "", brains: ["dogs"], stored: "2026-01-02" },
  ];
  T.notes = [
    { _id: "n2", sid: "squidgy-yt-xyz", title: "Dog video", author: "B", date: "2026-01-02",
      topics: [{ topic: "private" }], quotes: [], thin: [], connections: [], findings: { kind: "study" }, written: "x" },
  ];
  return { T, ctx: { db } };
}

/* ---- sources stay in their space ---- */
{
  const { T, ctx } = seed();
  const fromOcto = await run(store.findSource, ctx, { linkKey: "yt:xyz", sid: "yt-xyz", space: "octopus" });
  check("Octopus never sees a source Squidgy holds", fromOcto === null, JSON.stringify(fromOcto));
  const fromSq = await run(store.findSource, ctx, { linkKey: "yt:xyz", sid: "squidgy-yt-xyz", space: "squidgy" });
  check("Squidgy still finds its own", fromSq?.sid === "squidgy-yt-xyz");
  check("a Squidgy note is not readable from Octopus",
    (await run(store.noteBySid, ctx, { sid: "squidgy-yt-xyz", space: "octopus" })) === null);
  const own = await run(store.noteBySid, ctx, { sid: "squidgy-yt-xyz", space: "squidgy" });
  check("and comes back with its kind in Squidgy", own?.kind === "study", JSON.stringify(own));

  const err = await throws(run(store.writeSource, ctx, { space: "octopus",
    doc: { sid: "squidgy-yt-xyz", link: "https://evil.example", linkKey: "", title: "X", author: "", date: "", location: "", brains: ["wealth"] } }));
  check("a source of the other space is never rewritten", /another space/.test(err) && T.sources[1].title === "Dog video", err);
  const noteErr = await throws(run(store.writeNote, ctx, { space: "octopus",
    doc: { sid: "squidgy-yt-xyz", title: "X", author: "", date: "", topics: [], quotes: [], thin: [], connections: [], findings: {} } }));
  check("nor its note", /another space/.test(noteErr) && T.notes[0].title === "Dog video", noteErr);

  await run(store.writeSource, ctx, { space: "octopus",
    doc: { sid: "t-1", link: "javascript:alert(1)", linkKey: "", title: "T", author: "", date: "", location: "", brains: ["wealth"] } });
  check("a link that is not http or https is stored empty", T.sources.at(-1).link === "", T.sources.at(-1).link);
}

/* ---- brains change only in their own space ---- */
{
  const { T, ctx } = seed();
  const r = await throws(run(store.renameBrain, ctx, { slug: "wealth", name: "Stolen", account: null, space: "squidgy" }));
  check("Squidgy cannot rename an Octopus brain", /no such brain/.test(r) && T.brains[0].name === "Wealth", r);

  await run(store.renameBrain, ctx, { slug: "wealth", name: "Money", account: null, space: "octopus" });
  check("a rename carries the concepts", T.concepts.every(c => c.brain === "money"));
  check("and every link into the brain", T.concepts[0].related[0] === "money/silver" && T.concepts[1].related[0] === "money/gold",
    JSON.stringify(T.concepts.map(c => c.related)));
  check("and its sources", T.sources[0].brains[0] === "money");
}

/* ---- two writes to one concept keep both ---- */
{
  const { T, ctx } = seed();
  /* Batch A and batch B both read gold as seeded, then write. */
  const base = T.concepts[0];
  const write = (claim, sid, link, fig) => run(store.upsertConcept, ctx, { brain: "wealth", title: "Gold", slug: "gold", doc: {
    position: "Gold holds. " + claim, summaryLine: "",
    evidence: [{ date: "2026-02-01", author: "B", claim, source: sid }, ...base.evidence],
    data: [fig, ...base.data], conflicts: [], sources: [...base.sources, sid], related: [...base.related, link] } });
  await write("central banks buy", "s-b", "wealth/bonds", "1037 tonnes");
  await write("miners cut output", "s-c", "wealth/oil", "3% less");
  const gold = T.concepts[0];
  check("a second write keeps the first one's evidence",
    ["central banks buy", "miners cut output", "gold kept value"].every(c => gold.evidence.some(e => e.claim === c)),
    JSON.stringify(gold.evidence.map(e => e.claim)));
  check("and its sources", ["s-a", "s-b", "s-c"].every(s => gold.sources.includes(s)), JSON.stringify(gold.sources));
  check("and its links", ["wealth/silver", "wealth/bonds", "wealth/oil"].every(l => gold.related.includes(l)), JSON.stringify(gold.related));
  check("and its figures", ["1037 tonnes", "3% less", "2000 years"].every(d => gold.data.includes(d)), JSON.stringify(gold.data));
  check("an entry is never doubled", gold.evidence.filter(e => e.claim === "gold kept value").length === 1);
  check("still one row", T.concepts.filter(c => c.slug === "gold").length === 1);

  /* A stored concept whose id is not its title's still gets updated, not doubled. */
  T.concepts.push({ _id: "c9", brain: "wealth", slug: "fx", n: 3, title: "Currency hedging", position: "", summaryLine: "",
    evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "x" });
  await run(store.upsertConcept, ctx, { brain: "wealth", title: "Currency hedging", slug: "fx", doc: { position: "Hedge." } });
  check("a concept with its own id is updated in place", T.concepts.filter(c => c.title === "Currency hedging").length === 1
    && T.concepts.find(c => c.slug === "fx").position === "Hedge.");
  await run(store.upsertConcept, ctx, { brain: "wealth", title: "Platinum", doc: { position: "New." } });
  check("a new concept takes the next number", T.concepts.find(c => c.title === "Platinum")?.n === 4,
    String(T.concepts.find(c => c.title === "Platinum")?.n));
}

/* ---- everything reads one space ---- */
{
  const { ctx } = seed();
  const oc = await run(store.everything, ctx, { space: "octopus" });
  const sq = await run(store.everything, ctx, { space: "squidgy" });
  check("each space reads only its brains, concepts and sources",
    oc.brains.length === 1 && oc.concepts.length === 2 && oc.sources.length === 1 &&
    sq.brains.length === 1 && sq.concepts.length === 0 && sq.sources.length === 1);
  const head = await run(store.spaceHead, ctx, { space: "squidgy" });
  check("a space's head names only its own brains and sources", head.brains.length === 1 && head.brains[0].slug === "dogs" && head.sources.length === 1);
}

/* ---- the slim copies follow every write ---- */
{
  const { T, ctx } = seed();
  const cardFor = slug => (T.cards ?? []).find(c => c.slug === slug);
  /* The space the way loadSpace reads it: the head, then each brain's pages. */
  const space = async sp => {
    const head = await run(store.spaceHead, ctx, { space: sp });
    const cards = [];
    for (const b of head.brains) {
      let cursor = null;
      for (;;) { const p = await run(store.cardsPage, ctx, { brain: b.slug, cursor, ready: head.ready }); cards.push(...p.cards); if (p.done) break; cursor = p.cursor; }
    }
    return { ...head, cards };
  };
  const before = await space("octopus");
  check("before the build, cards are made from the concepts", !before.ready && before.cards.length === 2 && before.cards[0].title === "Gold");
  check("and never carry the evidence", before.cards.every(c => !("evidence" in c) && !("position" in c)));

  /* The build, the way the background job runs it. */
  check("a build is claimed once", (await run(store.claimCardBuild, ctx, {})) === true && (await run(store.claimCardBuild, ctx, {})) === false);
  let cursor = null;
  for (;;) { const r = await run(store.cardsBatch, ctx, { cursor }); if (r.done) break; cursor = r.cursor; }
  await run(store.markCardsReady, ctx, {});
  const after = await space("octopus");
  check("after the build, every concept has one card", after.ready && T.cards.length === 2 && after.cards.length === 2);
  check("a finished build is never claimed again", (await run(store.claimCardBuild, ctx, {})) === false);

  await run(store.upsertConcept, ctx, { brain: "wealth", title: "Gold", slug: "gold", doc: { summaryLine: "Gold holds its value.", position: "Gold held its value for 2,000 years." } });
  check("a rewrite updates the card", cardFor("gold").summaryLine === "Gold holds its value." && /2,000 years/.test(cardFor("gold").lead));
  await run(store.upsertConcept, ctx, { brain: "wealth", title: "Copper", doc: { position: "Copper tracks industry." } });
  check("a new concept gets a card", cardFor(T.concepts.find(c => c.title === "Copper").slug)?.title === "Copper");
  await run(store.addRelated, ctx, { brain: "wealth", slug: "silver", ids: ["wealth/copper"] });
  check("a new link reaches the card", cardFor("silver").related.includes("wealth/copper"), JSON.stringify(cardFor("silver")?.related));
  await run(store.renameBrain, ctx, { slug: "wealth", name: "Money", account: null, space: "octopus" });
  check("a rename moves the cards and their links", T.cards.every(c => c.brain === "money") && cardFor("silver").related.includes("money/copper"),
    JSON.stringify(T.cards.map(c => c.brain + ":" + c.related.join("|"))));
  check("one card per concept, always", T.cards.length === T.concepts.length);

  /* Whole concepts are read by id, inside the space only. */
  const got = await run(store.conceptsByIds, ctx, { space: "octopus", ids: ["money/gold", "dogs/anything", "nope"] });
  check("a concept is read whole by its id", got.length === 1 && got[0].evidence?.length >= 1);
  const other = await run(store.conceptsByIds, ctx, { space: "squidgy", ids: ["money/gold"] });
  check("never from the other space", other.length === 0);

  /* A store batch reads what it names, and finds a title the brain holds. */
  const r = await run(store.settleReads, ctx, { space: "octopus", ids: ["money/gold", "dogs/x"],
    titles: [{ brain: "money", title: "Silver" }, { brain: "money", title: "Platinum" }, { brain: "dogs", title: "Gold" }] });
  check("a store batch reads the concepts it names", !!r.byId["money/gold"] && !r.byId["dogs/x"]);
  check("and finds a title the brain already holds", r.byTitle[0]?.slug === "silver" && r.byTitle[1] === null && r.byTitle[2] === null,
    JSON.stringify(r.byTitle.map(x => x?.slug ?? null)));
  check("and knows which brains are empty", r.empty.money === false, JSON.stringify(r.empty));
}

/* ---- no code writes a concept without its card ---- */
{
  const { readdirSync, readFileSync } = await import("node:fs");
  const missing = [];
  for (const f of readdirSync(join(ROOT, "convex")).filter(f => f.endsWith(".ts"))) {
    const lines = readFileSync(join(ROOT, "convex", f), "latin1").split("\n");
    lines.forEach((l, i) => {
      /* An insert or a delete of a concept, or a patch inside a loop over
         concepts, is followed within four lines by syncCard. */
      const conceptLoop = lines.slice(Math.max(0, i - 3), i).some(x => /query\("concepts"\)/.test(x));
      const write = /insert\("concepts"/.test(l) || (conceptLoop && /ctx\.db\.(patch|delete)\(c\._id/.test(l)) ||
        /ctx\.db\.patch\(seen\._id/.test(l) && lines.slice(Math.max(0, i - 12), i).some(x => /"concepts"|byTitle\(ctx, "concepts"/.test(x)) ||
        /await ctx\.db\.patch\(c\._id, \{ related: next \}\)/.test(l);
      if (write && !lines.slice(i, i + 14).some(x => /syncCard\(/.test(x))) missing.push(`${f}:${i + 1}`);
    });
  }
  check("every concept write updates its card", missing.length === 0, missing.join(", "));
}

/* ---- a drop's report says what it opened and what it fed ---- */
{
  const { T, ctx } = seed();
  T.sources.push({ _id: "s9", sid: "doc-x", link: "", linkKey: "", title: "Accounting manual", author: "", date: "2026-09-26",
    location: "", brains: ["wealth"], stored: "2026-09-26" });
  T.notes.push({ _id: "n9", sid: "doc-x", title: "Accounting manual", author: "", date: "", topics: Array.from({ length: 228 }, () => ({})),
    quotes: [], thin: [], connections: [], findings: { kind: "study", new: [1, 2, 3], echo: [1], conflicts: [] }, written: "x" });
  /* Gold existed before and was fed; Hedging was opened by this document. */
  T.concepts[0].sources.push("doc-x");
  T.concepts[0].evidence.unshift({ date: "2026-09-26", claim: "fed", source: "doc-x" });
  T.concepts.push({ _id: "c7", brain: "wealth", slug: "hedging", n: 3, title: "Hedging", position: "", summaryLine: "",
    evidence: [{ date: "2026-09-26", claim: "opened", source: "doc-x" }], data: [], conflicts: [], sources: ["doc-x"], related: [], updated: "x" });
  const r = await run(admin.dropReport, ctx, { title: "accounting" });
  check("the report finds the drop by title", r.source?.sid === "doc-x", JSON.stringify(r).slice(0, 120));
  check("and says how it was read", r.read.kind === "study" && r.read.passages === 228, JSON.stringify(r.read));
  check("and what it opened and what it fed", r.filed.opened === 1 && r.filed.fed === 1 && r.filed.concepts === 2, JSON.stringify(r.filed));
}

/* ---- the export reads a brain of any size, a page at a time ---- */
{
  const { T, ctx } = seed();
  for (let i = 0; i < 230; i++) T.concepts.push({ _id: `x${i}`, brain: "wealth", slug: `c-${i}`, n: i + 3, title: `C ${i}`,
    position: "", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "x" });
  const got = []; let cursor = null, pages = 0;
  do {
    const r = await run(store.conceptsOfBrain, ctx, { space: "octopus", brain: "wealth", cursor });
    got.push(...r.concepts); cursor = r.next; pages++;
  } while (cursor && pages < 10);
  check("the export pages through every concept of a brain", got.length === 232 && pages === 3, `${got.length} in ${pages}`);
  const other = await run(store.conceptsOfBrain, ctx, { space: "octopus", brain: "dogs" });
  check("and reads nothing of the other space", other.concepts.length === 0 && other.next === null, JSON.stringify(other));
}

/* ---- one connector address per project ---- */
{
  const { T, ctx } = seed();
  T.accounts = [];
  const octo = await run(store.connectorHolder, ctx, { space: "octopus", salt: "s" });
  const sq = await run(store.connectorHolder, ctx, { space: "squidgy", salt: "s" });
  check("each project gets its own holder", octo === "owner" && sq === "owner-squidgy" && T.accounts.length === 2,
    `${octo} ${sq} ${T.accounts.length}`);
  check("asking again makes no second one", await run(store.connectorHolder, ctx, { space: "squidgy", salt: "s" }) === "owner-squidgy"
    && T.accounts.length === 2);
  T.accounts[0].mcpToken = "o".repeat(48); T.accounts[1].mcpToken = "q".repeat(48);
  const a = await run(store.accountByMcpToken, ctx, { token: "o".repeat(48) });
  const b = await run(store.accountByMcpToken, ctx, { token: "q".repeat(48) });
  check("an address resolves to its holder, in the shape the MCP server reads",
    a?.account === "owner" && a.space === "octopus" && b?.account === "owner-squidgy" && b.space === "squidgy",
    JSON.stringify([a, b]));
  T.accounts.push({ _id: "m1", slug: "maya", name: "Maya", salt: "s", mcpToken: "m".repeat(48) });
  check("a member's address from before owner only opens nothing",
    (await run(store.accountByMcpToken, ctx, { token: "m".repeat(48) })) === null);

  /* A deployment whose Octopus address sat on its only account keeps it. */
  const old = seed();
  old.T.accounts = [{ _id: "j1", slug: "jeremy", name: "Jeremy", salt: "s", mcpToken: "j".repeat(48) }];
  check("the Octopus address made before stays on its account",
    await run(store.connectorHolder, old.ctx, { space: "octopus", salt: "s" }) === "jeremy"
    && (await run(store.accountByMcpToken, old.ctx, { token: "j".repeat(48) }))?.account === "jeremy");
  await run(store.connectorHolder, old.ctx, { space: "squidgy", salt: "s" });
  check("and keeps working once Squidgy has one too",
    (await run(store.accountByMcpToken, old.ctx, { token: "j".repeat(48) }))?.space === "octopus");
}

/* ---- open conflicts: checked once, the real ones settled from Setup ---- */
{
  const { T, ctx } = seed();
  T.concepts[0].conflicts = [
    { a: "Gold holds its value", aDate: "2026-01-01", b: "Gold lost 20% since January 2025", bDate: "2026-09-23", why: "one says it holds, one says it fell" },
    { a: "Gold is antifragile", aDate: "", b: "Bitcoin is antifragile too", bDate: "2026", why: "extends it to more assets" },
  ];
  T.brains.push({ _id: "b9", slug: "dogs2", name: "Dogs two", type: "subject", scope: "s", space: "squidgy" });
  T.concepts.push({ _id: "c9", brain: "dogs2", slug: "walks", n: 1, title: "Walks", position: "", summaryLine: "", evidence: [], data: [],
    conflicts: [{ a: "one walk", b: "two walks", why: "x" }], sources: [], related: [], updated: "x" });
  const actx = { runQuery: (ref, a) => run(store[String(ref).split(".")[1]], ctx, a),
                 runMutation: (ref, a) => run(store[String(ref).split(".")[1]], ctx, a) };
  const real = globalThis.fetch;
  let calls = 0, reply = '{"real":[true,false]}';
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 }); };
  process.env.OPENROUTER_API_KEY = "sk-test";

  const first = await conflicts.listConflicts(actx, "octopus");
  check("only the real contradiction is offered, the addition is counted apart",
    first.conflicts.length === 1 && /lost 20%/.test(first.conflicts[0].b) && first.others === 1, JSON.stringify(first));
  check("a conflict of the other space is never listed", !JSON.stringify(first).includes("two walks"));
  check("each clash is marked once, on the concept", T.concepts[0].conflicts[0].real === true && T.concepts[0].conflicts[1].real === false);
  const again = await conflicts.listConflicts(actx, "octopus");
  check("so a second look calls no model", calls === 1 && again.conflicts.length === 1, `${calls} calls`);

  reply = '{"hints":[{"pick":"b","why":"The later claim, September 2026, with a number"}]}';
  const hinted = await conflicts.listConflicts(actx, "octopus", undefined, undefined, { hints: true });
  check("asked for them, each clash gets a suggested ruling and its reason, kept on the concept", calls === 2 && hinted.conflicts[0].hint?.pick === "b"
    && T.concepts[0].conflicts[0].hint?.why === "The later claim, September 2026, with a number", JSON.stringify(hinted.conflicts[0]));
  const hintedAgain = await conflicts.listConflicts(actx, "octopus", undefined, undefined, { hints: true });
  check("so the next look asks no model for it", calls === 2 && hintedAgain.conflicts[0].hint?.pick === "b", `${calls} calls`);
  check("with no model answer, the dates suggest one: the later claim holds, or both",
    conflicts.ruleHint({ a: "x", aDate: "2025-01-01", b: "y", bDate: "2026-01-01" }).pick === "b" && conflicts.ruleHint({ a: "x", aDate: "", b: "y", bDate: "" }).pick === "both");

  reply = '{"position":"NEW: Gold lost 20% since January 2025, a correction. An earlier view held that gold keeps its value (2026-01-01).","summaryLine":"Gold fell 20% since January 2025, a correction."}';
  const c0 = first.conflicts[0];
  const r = await conflicts.settleConflict(actx, "octopus", { id: c0.id, a: c0.a, b: c0.b, pick: "b" });
  check("a side that holds rewrites the position around it", r.ok && /^Gold lost 20%/.test(T.concepts[0].position)
    && T.concepts[0].summaryLine === "Gold fell 20% since January 2025, a correction.", JSON.stringify(r).slice(0, 200));
  check("and the clash leaves the list, the other one stays", T.concepts[0].conflicts.length === 1 && /Bitcoin/.test(T.concepts[0].conflicts[0].b));
  check("the card follows", (T.cards ?? []).find(x => x.cid === "c1")?.summaryLine === "Gold fell 20% since January 2025, a correction.",
    JSON.stringify((T.cards ?? []).find(x => x.cid === "c1")));
  const twice = await conflicts.settleConflict(actx, "octopus", { id: c0.id, a: c0.a, b: c0.b, pick: "a" });
  check("a clash settled already says so", /already settled/.test(twice.error || ""), JSON.stringify(twice));

  const before = calls, pos = T.concepts[0].position;
  const c1 = T.concepts[0].conflicts[0];
  const both = await run(store.settleConflict, ctx, { space: "octopus", id: "wealth/gold", a: c1.a, b: c1.b });
  const bothHold = await conflicts.settleConflict(actx, "octopus", { id: "wealth/gold", a: "x", b: "y", pick: "both" });
  check("both hold clears it and leaves the position, with no model call", both.ok && T.concepts[0].conflicts.length === 0
    && T.concepts[0].position === pos && calls === before && bothHold.ok === false, JSON.stringify([both, bothHold]));
  const cross = await conflicts.settleConflict(actx, "octopus", { id: "dogs2/walks", a: "one walk", b: "two walks", pick: "both" });
  check("a conflict of the other space is never settled", cross.ok === false && T.concepts.find(c => c._id === "c9").conflicts.length === 1);
  globalThis.fetch = real; delete process.env.OPENROUTER_API_KEY;
}

/* ---- the weekly digest: every space, what changed, no model ---- */
{
  const { T, ctx } = seed();
  const day = 86400000, now = Date.now(), iso = ms => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now), old = iso(now - 30 * day);
  /* Gold is old and was fed this week by one source; Silver was left alone;
     Hedging is new; a Squidgy concept is new too, with a conflict. */
  T.sources.push({ _id: "s7", sid: "wk-1", link: "", linkKey: "", title: "Rates report", author: "C", date: today,
    location: "", brains: ["wealth"], stored: today });
  Object.assign(T.concepts[0], { _creationTime: now - 40 * day, updated: today,
    evidence: [...T.concepts[0].evidence, { date: today, claim: "held again", source: "wk-1" }, { date: today, claim: "and again", source: "wk-1" }] });
  Object.assign(T.concepts[1], { _creationTime: now - 40 * day, updated: old });
  T.concepts.push({ _id: "c8", _creationTime: now - day, brain: "wealth", slug: "hedging", n: 3, title: "Hedging", position: "Hedge the tail.",
    summaryLine: "A hedge caps a 20 percent loss.", evidence: [], data: [], conflicts: [], sources: ["wk-1"], related: [], updated: today });
  T.concepts.push({ _id: "c9", _creationTime: now - day, brain: "dogs", slug: "walks", n: 1, title: "Walks", position: "",
    summaryLine: "Two walks a day.", evidence: [], data: [], conflicts: [{ a: "one walk", aDate: "2026-01-01", b: "two walks", bDate: "2026-09-01", why: "age" }],
    sources: [], related: [], updated: today });
  const actx = { runQuery: (ref, args) => run(store[String(ref).split(".")[1]], ctx, args) };

  const dry = await run(digest.send, actx, { dry: true });
  if (process.env.SHOW_DIGEST) console.log(dry.text);
  check("the digest reads every space", /OCTOPUS: 1 NEW CONCEPT/.test(dry.text) && /SQUIDGY: 1 NEW CONCEPT/.test(dry.text), dry.text);
  check("a concept fed again says how much evidence the week added", /Gold \(Wealth\)[\s\S]*\+2 pieces of evidence/.test(dry.text), dry.text);
  check("a concept left alone stays out", !/Silver/.test(dry.text));
  check("the week's sources and open conflicts are listed", /Rates report/.test(dry.text) && /one walk \(2026-01-01\) against two walks/.test(dry.text));
  check("the title counts the week", /^Your week: 2 new concepts, 1 fed again/.test(dry.text), dry.text.split("\n")[0]);

  const real = globalThis.fetch;
  let mailed = null;
  globalThis.fetch = async (u, opt) => { mailed = { u: String(u), body: JSON.parse(opt.body) }; return Response.json({ id: "m1" }); };
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.DIGEST_TO;
  const noTo = await run(digest.send, actx, {});
  check("with no DIGEST_TO it says how to set it, and sends nothing", !noTo.sent && /DIGEST_TO/.test(noTo.why) && !mailed, JSON.stringify(noTo));
  process.env.DIGEST_TO = "owner@example.com";
  const sent = await run(digest.send, actx, {});
  check("with DIGEST_TO the digest is mailed there", sent.sent && mailed?.body.to[0] === "owner@example.com" && /Your week/.test(mailed.body.subject),
    JSON.stringify(sent));

  for (const c of T.concepts) c.updated = old;
  T.sources = T.sources.filter(s => s.sid !== "wk-1");
  mailed = null;
  const quiet = await run(digest.send, actx, {});
  check("a week with nothing new sends nothing", !quiet.sent && /nothing new/.test(quiet.why) && !mailed, JSON.stringify(quiet));
  globalThis.fetch = real;
  delete process.env.DIGEST_TO; delete process.env.RESEND_API_KEY;
}

/* ---- chats: saved per space, 20 kept, 30 days, 5 pins ---- */
{
  const { T, ctx } = seed();
  const turn = q => ({ q, a: "An answer.", level: "normal", sources: 3, at: Date.now() });
  const first = await run(store.chatTurn, ctx, { space: "octopus", id: null, brain: "wealth", turn: turn("Is gold a hedge against inflation over twenty years, and what does the evidence say about the 1980 to 2001 stretch?") });
  const again = await run(store.chatTurn, ctx, { space: "octopus", id: first.id, brain: "wealth", turn: turn("And since 2001?") });
  const row = T.chats.find(c => c._id === first.id);
  check("a first question starts a chat, titled by it in 80 characters or less", first.created && row.title.length <= 80 && /^Is gold a hedge/.test(row.title)
    && /\.\.\.$/.test(row.title), row.title);
  check("the next one joins it", !again.created && again.id === first.id && row.turns.length === 2 && row.turns[1].q === "And since 2001?");
  const other = await run(store.chatTurn, ctx, { space: "squidgy", id: first.id, brain: "dogs", turn: turn("Walks?") });
  check("a chat of another space is never written to: a new one starts in its own", other.created && other.id !== first.id
    && T.chats.find(c => c._id === other.id).space === "squidgy" && row.turns.length === 2);
  check("and the other space never reads it", (await run(store.chatGet, ctx, { space: "squidgy", id: first.id })) === null
    && (await run(store.chatGet, ctx, { space: "octopus", id: first.id })).turns.length === 2);

  for (let i = 0; i < 64; i++) await run(store.chatTurn, ctx, { space: "octopus", id: first.id, brain: "wealth", turn: turn("q" + i) });
  check("a chat keeps its last 60 turns", row.turns.length === 60 && row.turns[59].q === "q63");

  /* 24 more chats: only the newest 20 unpinned stay, a pinned one stays too. */
  await run(store.chatEdit, ctx, { space: "octopus", id: first.id, pinned: true });
  for (let i = 0; i < 24; i++) { await run(store.chatTurn, ctx, { space: "octopus", id: null, brain: "all", turn: turn("chat " + i) }); }
  const list = await run(store.chatList, ctx, { space: "octopus" });
  check("the newest 20 unpinned chats stay, and the pinned one on top", list.length === 21 && list[0].id === first.id && list[0].pinned
    && list.filter(c => !c.pinned).length === 20 && !list.some(c => c.title === "chat 0") && list.some(c => c.title === "chat 23"), list.map(c => c.title).join("|"));
  const old = T.chats.find(c => c.title === "chat 5");
  old.updated = Date.now() - 31 * 86400000;
  T.chats.find(c => c._id === first.id).updated = Date.now() - 90 * 86400000;
  const later = await run(store.chatList, ctx, { space: "octopus" });
  check("an unpinned chat goes 30 days after its last question; a pinned one stays", !later.some(c => c.title === "chat 5") && later.some(c => c.id === first.id),
    later.map(c => c.title).join("|"));

  const ids = later.filter(c => !c.pinned).map(c => c.id);
  for (const id of ids.slice(0, 4)) check("pinning up to 5 works", (await run(store.chatEdit, ctx, { space: "octopus", id, pinned: true })).ok === true);
  const sixth = await run(store.chatEdit, ctx, { space: "octopus", id: ids[4], pinned: true });
  check("a sixth pin is refused with the reason", /5 chats are pinned already/.test(sixth.error || ""), JSON.stringify(sixth));
  check("rename sets a name, an empty one is refused", (await run(store.chatEdit, ctx, { space: "octopus", id: ids[4], title: "  Gold notes  " })).ok
    && T.chats.find(c => c._id === ids[4]).title === "Gold notes" && /needs a name/.test((await run(store.chatEdit, ctx, { space: "octopus", id: ids[4], title: " " })).error));
  check("another space cannot rename or delete it", /gone/.test((await run(store.chatEdit, ctx, { space: "squidgy", id: ids[4], remove: true })).error)
    && T.chats.some(c => c._id === ids[4]));
  check("delete removes it", (await run(store.chatEdit, ctx, { space: "octopus", id: ids[4], remove: true })).removed && !T.chats.some(c => c._id === ids[4]));
}

/* ---- workspaces: the demo, and ones visitors make ---- */
{
  const { T, ctx } = seed();
  const made = await run(store.createWorkspace, ctx, { slug: "acme-research", name: "Acme Research", kind: "byok", salt: "s", hash: "h" });
  check("a workspace is made with its passphrase", made.ok && T.workspaces[0].slug === "acme-research" && T.workspaces[0].kind === "byok"
    && T.config.some(r => r.key === "gate:acme-research" && r.hash === "h"), JSON.stringify(made));
  check("a taken name is refused, and so are the owner's two", /taken/.test((await run(store.createWorkspace, ctx, { slug: "acme-research", name: "x", kind: "byok" })).error)
    && /taken/.test((await run(store.createWorkspace, ctx, { slug: "octopus", name: "x", kind: "byok" })).error)
    && /taken/.test((await run(store.createWorkspace, ctx, { slug: "-bad", name: "x", kind: "byok" })).error));

  const demo = await run(admin.makeDemo, ctx, {});
  check("the owner opens the demo from the terminal", demo.slug === "demo" && demo.made && (await run(store.demoWorkspace, ctx, {}))?.slug === "demo");
  T.config.push({ _id: "gOld", key: "gate:demo", salt: "s", hash: "h" });
  const again = await run(admin.makeDemo, ctx, {});
  check("running it again makes nothing new, and the demo keeps no passphrase", !again.made && T.workspaces.filter(w => w.kind === "demo").length === 1
    && !T.config.some(r => r.key === "gate:demo"));

  const token = await run(store.newSession, ctx, { kind: "demo", space: "demo" });
  const who = await run(store.checkSession, ctx, { token });
  check("a demo visitor gets a session of their own", who.kind === "demo" && who.space === "demo" && /^[0-9a-f]{16}$/.test(who.visitor || ""), JSON.stringify(who));

  /* A brain named like one in another workspace gets a slug of its own. */
  const own = await run(store.createBrain, ctx, { name: "Wealth", type: "subject", scope: "s", space: "acme-research" });
  check("a brain name taken in another workspace gets its own slug, and says nothing of the other", own === "wealth-acme-research",
    own);
  check("the same name twice in one workspace is refused", /exists/.test(await throws(run(store.createBrain, ctx, { name: "Wealth", type: "subject", scope: "s", space: "octopus" }))));

  /* A source filed in two workspaces shows each only its own brains. */
  T.sources[0].brains.push("wealth-acme-research");
  const head = await run(store.spaceHead, ctx, { space: "acme-research" });
  check("a shared source lists only this workspace's brains", head.sources.length === 1 && JSON.stringify(head.sources[0].brains) === '["wealth-acme-research"]',
    JSON.stringify(head.sources));

  /* Copying a brain into the demo brings its concepts, cards and sources;
     making the demo with a list copies them in one call, never twice. */
  const once = await run(admin.makeDemo, ctx, { copy: ["wealth"] });
  const twice = await run(admin.makeDemo, ctx, { copy: ["wealth"] });
  check("the demo fills itself from a list of brains, each once", once.copied[0]?.slug === "wealth-demo" && /already/.test(twice.copied[0]?.skipped || "")
    && T.brains.filter(b => b.space === "demo").length === 1, JSON.stringify([once.copied, twice.copied]));
  const copy = { slug: "wealth-demo", concepts: once.copied[0].concepts };
  const cs = T.concepts.filter(c => c.brain === copy.slug);
  check("a brain copies into the demo with its concepts, links and sources", copy.slug === "wealth-demo" && copy.concepts === 2
    && cs.find(c => c.slug === "gold").related[0] === "wealth-demo/silver" && T.brains.find(b => b.slug === "wealth-demo").space === "demo"
    && T.sources[0].brains.includes("wealth-demo") && T.cards.some(c => c.brain === "wealth-demo"), JSON.stringify(copy));
  check("the original stays where it was", T.concepts.filter(c => c.brain === "wealth").length === 2 && T.brains.find(b => b.slug === "wealth").space === undefined);

  /* Demo chats are each visitor's own. */
  const turn = q => ({ q, a: "A.", level: "normal", sources: 1, at: Date.now() });
  const mine = await run(store.chatTurn, ctx, { space: "demo", id: null, brain: "all", turn: turn("mine"), owner: "v1" });
  await run(store.chatTurn, ctx, { space: "demo", id: null, brain: "all", turn: turn("theirs"), owner: "v2" });
  const l1 = await run(store.chatList, ctx, { space: "demo", owner: "v1" });
  check("a demo visitor lists only their own chats", l1.length === 1 && l1[0].title === "mine", JSON.stringify(l1));
  check("and cannot open, join or delete another's", (await run(store.chatGet, ctx, { space: "demo", id: mine.id, owner: "v2" })) === null
    && (await run(store.chatTurn, ctx, { space: "demo", id: mine.id, brain: "all", turn: turn("x"), owner: "v2" })).created
    && /gone/.test((await run(store.chatEdit, ctx, { space: "demo", id: mine.id, remove: true, owner: "v2" })).error));
}

/* ---- a workspace's look ---- */
{
  const { T, ctx } = seed();
  check("a workspace with no look of its own wears the default", (await run(store.brandOf, ctx, { space: "acme" })) === null);
  const logo = "data:image/png;base64,iVBORw0KGgo=";
  const set = await run(store.setBrand, ctx, { space: "acme", logo, accent: "#ff6600" });
  check("a logo and an accent are kept", set.logo === logo && set.accent === "#ff6600" && set.bg === null, JSON.stringify(set));
  const bg = await run(store.setBrand, ctx, { space: "acme", bg: "#fff7ee" });
  check("a field left out stays as it was", bg.logo === logo && bg.accent === "#ff6600" && bg.bg === "#fff7ee", JSON.stringify(bg));
  const cleared = await run(store.setBrand, ctx, { space: "acme", logo: null });
  check("a null clears one field", cleared.logo === null && cleared.accent === "#ff6600" && !("logo" in T.brands[0]), JSON.stringify(T.brands[0]));
  check("each workspace keeps its own", (await run(store.brandOf, ctx, { space: "squidgy" })) === null && T.brands.length === 1);
  await run(store.setBrand, ctx, { space: "acme", reset: true });
  check("reset takes the workspace back to the default", (await run(store.brandOf, ctx, { space: "acme" })) === null && T.brands.length === 0);
}

/* ---- a passphrase guess is counted before it is checked ---- */
{
  const { T, ctx } = seed();
  await run(admin.makeWorkspace, ctx, { name: "Lockbox", pass: "ABC12345" });
  const takes = [];
  for (let i = 0; i < 9; i++) takes.push(await run(store.takeAttempt, ctx, { space: "lockbox" }));
  check("a door hands out 8 guesses an hour, counted as they are taken", takes.slice(0, 8).every(t => !t.locked && t.salt) && takes[8].locked && !takes[8].salt,
    JSON.stringify(takes.map(t => t.locked)));
  const row = T.config.find(r => r.key && r.hash && r.attempts >= 8);
  row.attemptWindow = Date.now() - 2 * 60 * 60 * 1000;
  const later = await run(store.takeAttempt, ctx, { space: "lockbox" });
  check("an hour on, the door opens to guesses again", !later.locked && later.salt && row.attempts === 1, JSON.stringify({ later: later.locked, n: row.attempts }));
  await run(store.noteAttempt, ctx, { ok: true, space: "lockbox" });
  check("and a right passphrase clears the count", row.attempts === 0);
  check("a door with no passphrase gives nothing to guess at", (await run(store.takeAttempt, ctx, { space: "nobody" })).set === false);
}

/* ---- old sealed member keys are forgotten ---- */
{
  const { T, ctx } = seed();
  T.accounts = [{ _id: "a1", name: "Old", slug: "old", salt: "s", keyCipher: "c", keyIv: "i", keyHash: "h", keyHint: "sk-or-…abcd", keySavedAt: "2026-09-20", created: "x", lastSeen: "x" },
                { _id: "a2", name: "Clean", slug: "clean", salt: "s", created: "x", lastSeen: "x" }];
  const r = await run(admin.forgetOldKeys, ctx, {});
  check("forgetOldKeys clears every sealed key field, and touches no clean account", r.cleared === 1
    && !["keyCipher", "keyIv", "keyHash", "keyHint", "keySavedAt"].some(k => T.accounts[0][k] !== undefined) && T.accounts[0].name === "Old", JSON.stringify(T.accounts[0]));
}

/* ---- a shared brain: one brain, seen from two workspaces ---- */
{
  const { T, ctx } = seed();
  T.brains.push({ _id: "b3", slug: "me", name: "Me", type: "personal", scope: "s", space: undefined });
  T.workspaces = [{ _id: "w1", slug: "demo", name: "Demo", kind: "demo" }];
  const names = async sp => (await run(store.spaceHead, ctx, { space: sp })).brains.map(b => b.slug).sort().join(",");
  const share = (slug, to, on = true, space = "octopus") => run(store.shareBrain, ctx, { slug, space, to, on });
  check("before sharing, each workspace sees only its own brains", (await names("octopus")) === "me,wealth" && (await names("squidgy")) === "dogs");

  const shared = await share("wealth", "squidgy");
  check("the owner shares a brain with another workspace", JSON.stringify(shared.shared) === '["squidgy"]' && shared.viewers.length === 0);
  check("both workspaces now list it, and the other brains stay apart", (await names("octopus")) === "me,wealth" && (await names("squidgy")) === "dogs,wealth");
  check("sharing it twice changes nothing", JSON.stringify((await share("wealth", "squidgy")).shared) === '["squidgy"]');

  const there = await run(store.conceptsByIds, ctx, { space: "squidgy", ids: ["wealth/gold", "me/anything"] });
  check("Squidgy reads its concepts whole, and never the personal brain's", there.length === 1 && there[0].slug === "gold", JSON.stringify(there.map(c => c.slug)));
  check("a source filed in it is found from both, so a repeat is caught in either",
    (await run(store.findSource, ctx, { linkKey: "yt:abc", sid: "yt-abc", space: "squidgy" }))?.sid === "yt-abc"
    && (await run(store.findSource, ctx, { linkKey: "yt:abc", sid: "yt-abc", space: "octopus" }))?.sid === "yt-abc");
  check("and Octopus still never sees what Squidgy keeps to itself", (await run(store.findSource, ctx, { linkKey: "yt:xyz", sid: "yt-xyz", space: "octopus" })) === null);

  /* A drop in Squidgy lands in the one brain, so Octopus has it at once. */
  await run(store.writeSource, ctx, { space: "squidgy",
    doc: { sid: "squidgy-yt-new", link: "https://youtu.be/new", linkKey: "yt:new", title: "From Squidgy", author: "C", date: "2026-02-01", location: "", brains: ["wealth"] } });
  await run(store.upsertConcept, ctx, { brain: "wealth", title: "Oil", doc: { position: "Oil.", summaryLine: "Oil", sources: ["squidgy-yt-new"],
    evidence: [{ date: "2026-02-01", author: "C", claim: "oil", source: "squidgy-yt-new" }] } });
  check("a source dropped in Squidgy into a shared brain shows in Octopus", (await run(store.spaceHead, ctx, { space: "octopus" })).sources.some(x => x.sid === "squidgy-yt-new"));
  check("and its concept is there to read", (await run(store.conceptsByIds, ctx, { space: "octopus", ids: ["wealth/oil"] })).length === 1);
  const feeder = space => ({ kind: "owner", account: null, space });
  check("the other workspace may feed a brain it was given", lib.canDrop(T.brains[0], feeder("squidgy")) && lib.canDrop(T.brains[0], feeder("octopus")));

  /* Who may change what. */
  check("only the workspace a brain lives in shares it", /does not live in this workspace/.test(await throws(share("wealth", "octopus", true, "squidgy"))));
  check("a personal brain is never shared", /never shared/.test(await throws(share("me", "squidgy"))));
  check("only a workspace of the owner's, or the demo, takes a brain", /cannot be shared/.test(await throws(share("wealth", "acme")))
    && /cannot be shared/.test(await throws(share("wealth", "octopus"))));
  check("a workspace that was given a brain cannot rename it", /no such brain/.test(await throws(run(store.renameBrain, ctx, { slug: "wealth", name: "Money", account: null, space: "squidgy" }))));
  check("a brain with that name in view cannot be made again", /exists/.test(await throws(run(store.createBrain, ctx, { name: "Wealth", type: "subject", scope: "s", space: "squidgy" }))));

  const st = await run(store.shareState, ctx, { space: "octopus" });
  check("the targets are the other workspace to edit and the demo to read", JSON.stringify(st.targets.map(t => `${t.slug}:${t.mode}`)) === '["squidgy:edit","demo:read"]', JSON.stringify(st.targets));
  check("Share brain lists the brains that live here, the personal one left out", st.brains.map(b => b.slug).join(",") === "wealth" && JSON.stringify(st.brains[0].to) === '["squidgy"]', JSON.stringify(st.brains));
  const sq = await run(store.shareState, ctx, { space: "squidgy" });
  check("and the other side lists what it was given, and where from", sq.joined.length === 1 && sq.joined[0].slug === "wealth" && sq.joined[0].fromName === "Octopus" && !sq.joined[0].readOnly, JSON.stringify(sq.joined));
  check("Squidgy can offer the demo and Octopus too", JSON.stringify(sq.targets.map(t => t.slug)) === '["octopus","demo"]');

  /* Leaving, and unsharing. */
  check("a workspace cannot leave a brain of its own", /not shared with this workspace/.test(await throws(run(store.leaveBrain, ctx, { slug: "dogs", space: "squidgy" }))));
  await run(store.leaveBrain, ctx, { slug: "wealth", space: "squidgy" });
  check("a workspace can leave a brain it was given, and the brain stays where it lives", (await names("squidgy")) === "dogs" && (await names("octopus")) === "me,wealth");
  await share("wealth", "squidgy");
  await share("wealth", "squidgy", false);
  check("the owner can stop sharing", (await names("squidgy")) === "dogs");

  /* The demo reads and never changes. */
  const toDemo = await share("wealth", "demo");
  check("the demo is given a brain to read, not to feed", JSON.stringify(toDemo.viewers) === '["demo"]' && toDemo.shared.length === 0, JSON.stringify(toDemo));
  check("it lists the brain", (await names("demo")).includes("wealth"));
  check("and the demo's visitors cannot feed it, while the owner's workspace still can", !lib.canDrop(T.brains[0], feeder("demo")) && lib.canDrop(T.brains[0], feeder("octopus")) && lib.canDrop(T.brains[1], feeder("squidgy")));
  T.concepts[0].conflicts = [{ a: "x", aDate: "2026-01-01", b: "y", bDate: "2026-01-02", why: "w" }];
  const viewPage = await run(store.conflictsPage, ctx, { space: "demo", brain: "wealth", cursor: null });
  check("a visitor never sees its open clashes", viewPage.items.length === 0, JSON.stringify(viewPage));
  check("nor rules on one", /read only/.test((await run(store.settleConflict, ctx, { space: "demo", id: "wealth/gold", a: "x", b: "y", position: "p" })).why || ""));
  check("while its owner still does", (await run(store.conflictsPage, ctx, { space: "octopus", brain: "wealth", cursor: null })).items.length === 1
    && (await run(store.settleConflict, ctx, { space: "octopus", id: "wealth/gold", a: "x", b: "y" })).ok === true);
  const dm = await run(store.shareState, ctx, { space: "demo" });
  check("the demo lists it as read only, with a way out", dm.joined.length === 1 && dm.joined[0].readOnly === true);
  await share("wealth", "demo", false);
  check("and the owner takes it back", !(await names("demo")).includes("wealth"));

  await share("wealth", "squidgy");
  await share("wealth", "demo");
  await run(admin.moveBrain, ctx, { slug: "wealth", space: "squidgy" });
  const moved = T.brains.find(b => b.slug === "wealth");
  check("a brain moved to another workspace leaves the ones it was shared with", moved.shared.length === 0 && moved.viewers.length === 0);
}

/* ---- a workspace for someone, on the deployment's own key ---- */
{
  const { T, ctx } = seed();
  const made = await run(admin.makeWorkspace, ctx, { name: "PandAAAHH", pass: "ABC12345" });
  check("a workspace is made by its name, and opens from the landing by that name", made.slug === "pandaaahh" && made.name === "PandAAAHH" && made.opens === "/chat?w=pandaaahh", JSON.stringify(made));
  check("it is hosted: not a visitor's own key, not the demo, so the deployment's key pays", T.workspaces.some(w => w.slug === "pandaaahh" && w.kind === "hosted"));
  const g = await run(store.gateState, ctx, { space: "pandaaahh" });
  check("its door holds the passphrase, hashed with its own salt, and nothing readable", g.set && g.hash === await lib.sha256(g.salt, "ABC12345") && !JSON.stringify(T.config).includes("ABC12345"));
  check("it starts empty", (await run(store.spaceHead, ctx, { space: "pandaaahh" })).brains.length === 0);
  await run(store.createWorkspace, ctx, { slug: "visitor-co", name: "Visitor Co", kind: "byok" });
  const listedHosted = await run(store.hostedList, ctx, {});
  check("the landing lists it by name, and never a workspace a visitor made", JSON.stringify(listedHosted) === '[{"slug":"pandaaahh","name":"PandAAAHH"}]', JSON.stringify(listedHosted));
  check("a passphrase under 8 characters is refused", /at least 8/.test(await throws(run(admin.makeWorkspace, ctx, { name: "Short", pass: "ABC123" }))));
  check("so is a name already taken, or one of the owner's two", /taken/.test(await throws(run(admin.makeWorkspace, ctx, { name: "pandaaahh", pass: "ABC12345" })))
    && /taken/.test(await throws(run(admin.makeWorkspace, ctx, { name: "Squidgy", pass: "ABC12345" }))));
  check("and a name with no letters is refused", /2 letters/.test(await throws(run(admin.makeWorkspace, ctx, { name: "!", pass: "ABC12345" }))));

  /* The owner can give it a brain to feed, from Share brain. */
  const targets = (await run(store.shareState, ctx, { space: "octopus" })).targets.map(t => `${t.slug}:${t.mode}:${t.name}`);
  check("Share brain offers it, to edit, by its name", targets.includes("pandaaahh:edit:PandAAAHH"), JSON.stringify(targets));
  const shared = await run(store.shareBrain, ctx, { slug: "wealth", space: "octopus", to: "pandaaahh", on: true });
  check("a brain shared with it can be fed from there", JSON.stringify(shared.shared) === '["pandaaahh"]' && lib.canDrop(T.brains[0], { kind: "owner", account: null, space: "pandaaahh" }));
  check("a workspace a visitor made is still never offered a brain", /cannot be shared/.test(await throws(run(store.shareBrain, ctx, { slug: "wealth", space: "octopus", to: "acme", on: true }))));
}

/* ---- the passphrase changes, and the other sessions end ---- */
{
  const { T, ctx } = seed();
  const mine = await run(store.newSession, ctx, { kind: "owner", space: "squidgy" });
  const other = await run(store.newSession, ctx, { kind: "owner", space: "squidgy" });
  const elsewhere = await run(store.newSession, ctx, { kind: "owner", space: "octopus" });
  const ended = await run(store.endOtherSessions, ctx, { space: "squidgy", keep: mine });
  check("changing the passphrase signs the others out of that workspace and keeps the one who changed it",
    ended === 1 && !!(await run(store.checkSession, ctx, { token: mine })) && (await run(store.checkSession, ctx, { token: other })) === null,
    String(ended));
  check("and leaves the other workspace alone", !!(await run(store.checkSession, ctx, { token: elsewhere })));
  await run(store.setGate, ctx, { salt: "s1", hash: "h1", space: "squidgy" });
  check("a passphrase is replaced only when asked to", /already set/.test(await throws(run(store.setGate, ctx, { salt: "s2", hash: "h2", space: "squidgy" }))));
  await run(store.setGate, ctx, { salt: "s2", hash: "h2", space: "squidgy", replace: true });
  const g = await run(store.gateState, ctx, { space: "squidgy" });
  check("the new one holds, with the attempt count back to zero", g.hash === "h2" && g.salt === "s2" && g.attempts === 0, JSON.stringify(g));
}

/* ---- the model and the languages are picked per workspace ---- */
{
  const { ctx } = seed();
  check("a workspace starts on the default model, kept in English, answered as asked", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":null,"reply":"same","voice":null}');
  await run(store.setModels, ctx, { space: "octopus", chat: "openai/gpt-5" });
  check("a model picked is kept", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":"openai/gpt-5","reply":"same","voice":null}');
  check("another workspace keeps its own", JSON.stringify(await run(store.modelsOf, ctx, { space: "squidgy" })) === '{"chat":null,"reply":"same","voice":null}');
  await run(store.setModels, ctx, { space: "octopus", reply: "en", voice: "fr-FR" });
  check("the answer and voice languages are saved apart, and the model stays", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":"openai/gpt-5","reply":"en","voice":"fr-FR"}');
  await run(store.setModels, ctx, { space: "octopus", chat: null, voice: "xx-YY" });
  check("an unknown voice goes back to the browser's, and a model change leaves the reply alone", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":null,"reply":"en","voice":null}');
  /* A row written when projects had a model of their own keeps working, and loses that field on the next save. */
  const old = seed();
  old.T.models = [{ _id: "m1", space: "octopus", chat: "x/y", project: "z/old", reply: "en", updated: 1 }];
  check("a row from before, with a project model, still reads", JSON.stringify(await run(store.modelsOf, old.ctx, { space: "octopus" })) === '{"chat":"x/y","reply":"en","voice":null}');
  await run(store.setModels, old.ctx, { space: "octopus", voice: "fr-FR" });
  check("and the old field goes on its next save", old.T.models[0].project === undefined && old.T.models[0].chat === "x/y");
}

/* ---- the model of every workspace on the deployment's key, set at once ---- */
{
  const { T, ctx } = seed();
  await run(admin.makeWorkspace, ctx, { name: "PandAAAHH", pass: "ABC12345" });
  T.workspaces.push({ _id: "wd", slug: "demo", name: "Demo", kind: "demo", created: "2026-01-01" }, { _id: "wb", slug: "acme", name: "Acme", kind: "byok", created: "2026-01-01" });
  await run(store.setModels, ctx, { space: "octopus", chat: "z-ai/glm-5.3", reply: "en", voice: "fr-FR" });
  const pick = () => Object.fromEntries(["octopus", "squidgy", "pandaaahh", "demo", "acme"].map(s => [s, T.models?.find(m => m.space === s)?.chat ?? null]));
  const DS = "deepseek/deepseek-v4.1-flash";

  const dry = await run(admin.setModel, ctx, { model: DS, dry: true });
  check("a dry run lists the three workspaces on the deployment's key, what each runs on, and writes nothing",
    dry.dry && JSON.stringify(dry.spaces.map(x => [x.space, x.name, x.was, x.now])) === JSON.stringify([["octopus", "octopus", "z-ai/glm-5.3", DS], ["squidgy", "squidgy", null, DS], ["pandaaahh", "PandAAAHH", null, DS]])
    && JSON.stringify(pick()) === JSON.stringify({ octopus: "z-ai/glm-5.3", squidgy: null, pandaaahh: null, demo: null, acme: null }), JSON.stringify([dry, pick()]));

  const set = await run(admin.setModel, ctx, { model: DS });
  check("set, the three run on that model", JSON.stringify(pick()) === JSON.stringify({ octopus: DS, squidgy: DS, pandaaahh: DS, demo: null, acme: null }) && !set.dry, JSON.stringify(pick()));
  check("the demo and a visitor's own-key workspace are left on the default", !T.models.some(m => m.space === "demo" || m.space === "acme"));
  check("what a workspace chose for its languages is kept", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === `{"chat":"${DS}","reply":"en","voice":"fr-FR"}`, JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })));
  check("and each reads it back as its model", (await run(store.modelsOf, ctx, { space: "pandaaahh" })).chat === DS && (await run(store.modelsOf, ctx, { space: "squidgy" })).chat === DS);

  const some = await run(admin.setModel, ctx, { model: "z-ai/glm-5.3", spaces: ["PandAAAHH"] });
  check("a name given by its title picks just that workspace", JSON.stringify(some.spaces.map(x => x.space)) === '["pandaaahh"]' && pick().pandaaahh === "z-ai/glm-5.3" && pick().octopus === DS && pick().squidgy === DS, JSON.stringify(pick()));

  await run(admin.setModel, ctx, { model: "z-ai/glm-5.3-flash" });
  check("the default model is kept as no pick, the way Settings keeps it", JSON.stringify(pick()) === JSON.stringify({ octopus: null, squidgy: null, pandaaahh: null, demo: null, acme: null }) && T.models.every(m => !("chat" in m) || m.chat === undefined), JSON.stringify(T.models));
  await run(admin.setModel, ctx, { model: DS });
  const back = await run(admin.setModel, ctx, { model: null });
  check("null takes them all back to the default", back.model === null && JSON.stringify(pick()) === JSON.stringify({ octopus: null, squidgy: null, pandaaahh: null, demo: null, acme: null }));

  check("something that is not a model id is refused, and nothing changes",
    /not a model id/.test(await throws(run(admin.setModel, ctx, { model: "deepseek flash" }))) && /not a model id/.test(await throws(run(admin.setModel, ctx, { model: "x".repeat(90) + "/y" }))) && pick().octopus === null);
  check("a workspace that is not on the deployment's key is refused by name, and the ones that are are listed",
    /demo is not on this deployment's key\. They are: octopus, squidgy, pandaaahh/.test(await throws(run(admin.setModel, ctx, { model: DS, spaces: ["demo"] }))) && pick().octopus === null);
}

/* ---- what a model costs, and which favourite costs least ---- */
{
  /* A provider whose price is the same read and written, so its price at any mix is that number. */
  const ep = (p, o = {}) => ({ provider_name: o.name ?? "p" + p, pricing: { prompt: String(p / 1e6), completion: String(p / 1e6) },
    supported_parameters: o.json === false ? ["max_tokens"] : ["response_format", "max_tokens"], uptime_last_30m: "up" in o ? o.up : 100 });
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  check("a provider's price is 4 tokens read for 1 written, in dollars per million",
    near(price.blend({ pricing: { prompt: "0.0000001", completion: "0.0000005" } }), 0.18) && near(price.blend({ pricing: { prompt: "0.00000015", completion: "0.0000005" } }), 0.22));
  check("a price that is missing, not a number or negative is no price",
    price.blend({}) === null && price.blend({ pricing: { prompt: "x", completion: "1" } }) === null && price.blend({ pricing: { prompt: "-0.000001", completion: "0.000001" } }) === null);

  const three = price.expectedPrice([ep(0.1), ep(0.2), ep(0.4)]);
  check("a model's price is the average over its providers, each weighted by the inverse square of its price", Math.abs(three.price - 17.5 / 131.25) < 1e-6 && three.providers === 3, JSON.stringify(three));
  check("a provider that cannot take JSON is left out", near(price.expectedPrice([ep(0.1), ep(0.2), ep(0.4), ep(0.01, { json: false })]).price, three.price));
  check("so is one that is down: under 95% of the last 30 minutes", near(price.expectedPrice([ep(0.1), ep(0.2), ep(0.4), ep(0.01, { up: 80 })]).price, three.price));
  check("a provider with no uptime figure counts as up", near(price.expectedPrice([ep(0.1), ep(0.2), ep(0.4), ep(0.1, { up: null })]).providers, 4));
  check("when every provider is down, those that take JSON stand in", near(price.expectedPrice([ep(0.1, { up: 10 }), ep(0.1, { up: 20 })]).price, 0.1));
  check("a model none of whose providers takes JSON has no price", price.expectedPrice([ep(0.1, { json: false })]) === null && price.expectedPrice([]) === null && price.expectedPrice(undefined) === null);
  check("a free provider gives a price near zero, never a break", Number.isFinite(price.expectedPrice([ep(0)]).price) && price.expectedPrice([ep(0), ep(0.1)]).price < 0.001);

  const A = "a/cheap", B = "b/dear";
  check("the cheapest favourite runs, from another model or none", price.choose("x/other", [{ id: B, price: 0.18 }, { id: A, price: 0.12 }]) === A && price.choose(null, [{ id: B, price: 0.18 }, { id: A, price: 0.12 }]) === A);
  check("the one running stays unless another is at least 10% cheaper", price.choose(B, [{ id: A, price: 0.17 }, { id: B, price: 0.18 }]) === B && price.choose(B, [{ id: A, price: 0.15 }, { id: B, price: 0.18 }]) === A);
  check("and the cheapest stays", price.choose(A, [{ id: A, price: 0.12 }, { id: B, price: 0.18 }]) === A);
  check("equal prices keep the list's order, and no price keeps nothing", price.choose(null, [{ id: B, price: 0.1 }, { id: A, price: 0.1 }]) === B && price.choose(A, []) === null);

  /* the read, against a stand-in for OpenRouter's list of providers */
  const real = globalThis.fetch;
  const seen = [];
  const lists = {};
  globalThis.fetch = async (u) => {
    seen.push(String(u));
    const id = decodeURIComponent(String(u).replace("https://openrouter.ai/api/v1/models/", "").replace(/\/endpoints$/, ""));
    if (id === "boom/down") throw new Error("socket closed");
    if (id === "boom/five") return new Response("no", { status: 500 });
    if (!(id in lists)) return new Response('{"error":{"code":404}}', { status: 404 });
    return Response.json({ data: { id, endpoints: lists[id] } });
  };
  lists["deepseek/deepseek-v4-flash-0731"] = [ep(0.08)];
  lists["~deepseek/deepseek-v4-flash-latest"] = [];
  const r1 = await price.readPrice("deepseek/deepseek-v4-flash-0731");
  check("a model is read from OpenRouter's public list of its providers, at its own address", near(r1.price, 0.08) && r1.providers === 1
    && seen[0] === "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints", JSON.stringify([r1, seen]));
  check("a model OpenRouter does not know is missing", (await price.readPrice("no/such")).missing === true);
  check("an alias with no provider of its own has no price, and says why", /lists no provider/.test((await price.readPrice("~deepseek/deepseek-v4-flash-latest")).error));
  check("a refusal or a failed request is an error, never a price", (await price.readPrice("boom/five")).error === "OpenRouter answered 500" && /socket closed/.test((await price.readPrice("boom/down")).error));

  /* the command and the daily check, on workspaces that run on the deployment's key */
  const DS = "deepseek/deepseek-v4-flash-0731", GLM = "z-ai/glm-5.3-flash";
  const set = (ds, glm) => { lists[DS] = [ep(ds), ep(ds)]; lists[GLM] = [ep(glm)]; };
  const world = async () => {
    const w = seed();
    await run(admin.makeWorkspace, w.ctx, { name: "PandAAAHH", pass: "ABC12345" });
    w.T.workspaces.push({ _id: "wd", slug: "demo", name: "Demo", kind: "demo", created: "2026-01-01" }, { _id: "wb", slug: "acme", name: "Acme", kind: "byok", created: "2026-01-01" });
    await run(store.setModels, w.ctx, { space: "octopus", chat: "deepseek/deepseek-v4.1-flash", reply: "en", voice: "fr-FR" });
    const mods = { admin, store };
    const hand = ref => { const [m, f] = String(ref).split("."); return mods[m][f].handler; };
    const actx = { runQuery: (ref, a) => hand(ref)(w.ctx, a), runMutation: (ref, a) => hand(ref)(w.ctx, a) };
    const row = sp => w.T.models?.find(m => m.space === sp);
    const on = () => Object.fromEntries(["octopus", "squidgy", "pandaaahh", "demo", "acme"].map(x => [x, row(x)?.chat ?? null]));
    return { ...w, actx, row, on, cmd: a => admin.setFavourites.handler(actx, a), daily: () => admin.pickCheapest.handler(actx, {}) };
  };
  {
    set(0.08, 0.12);
    const W = await world();
    const before = JSON.stringify(W.T.models);
    const dry = await W.cmd({ models: [DS, GLM], dry: true });
    check("a dry run prices the favourites and says what would run, writing nothing",
      dry.dry && JSON.stringify(dry.models.map(x => [x.id, x.price])) === JSON.stringify([[DS, 0.08], [GLM, 0.12]]) && dry.spaces.length === 3 && dry.spaces.every(x => x.now === DS && x.switched)
      && JSON.stringify(W.T.models) === before, JSON.stringify(dry));

    const done = await W.cmd({ models: [DS, GLM] });
    const o = W.row("octopus");
    check("the command gives the list to the three workspaces on the deployment's key, the cheapest running",
      JSON.stringify(W.on()) === JSON.stringify({ octopus: DS, squidgy: DS, pandaaahh: DS, demo: null, acme: null }) && JSON.stringify(o.favs) === JSON.stringify([DS, GLM])
      && done.spaces.map(x => x.space).join() === "octopus,squidgy,pandaaahh", JSON.stringify([W.on(), done]));
    check("with the day it was priced and each price, and the languages a workspace chose kept",
      typeof o.favAt === "number" && JSON.stringify(o.favPrices) === JSON.stringify([{ id: DS, price: 0.08 }, { id: GLM, price: 0.12 }]) && o.reply === "en" && o.voice === "fr-FR", JSON.stringify(o));
    check("the demo and a visitor's own-key workspace get no list", !W.row("demo") && !W.row("acme"));
    check("the workspace reads its favourites back, and a workspace without any reads none",
      JSON.stringify((await run(store.modelsOf, W.ctx, { space: "squidgy" })).favs) === JSON.stringify([DS, GLM]) && !("favs" in (await run(store.modelsOf, W.ctx, { space: "demo" }))));

    /* the daily check, as prices move */
    let fetched = seen.length;
    set(0.115, 0.12);
    let d = await W.daily();
    check("the daily check prices the list again and records it", seen.length > fetched && JSON.stringify(W.row("squidgy").favPrices) === JSON.stringify([{ id: DS, price: 0.115 }, { id: GLM, price: 0.12 }]) && d.spaces.every(x => !x.switched));
    set(0.13, 0.12);
    d = await W.daily();
    check("a favourite within 10% of the one running changes nothing", JSON.stringify(W.on()) === JSON.stringify({ octopus: DS, squidgy: DS, pandaaahh: DS, demo: null, acme: null }) && d.spaces.every(x => !x.switched), JSON.stringify(d));
    set(0.2, 0.12);
    d = await W.daily();
    check("another at least 10% cheaper takes over, and the default model is kept as no pick, the way Settings keeps it",
      d.spaces.every(x => x.switched) && JSON.stringify(W.on()) === JSON.stringify({ octopus: null, squidgy: null, pandaaahh: null, demo: null, acme: null }) && JSON.stringify(W.row("octopus").favs) === JSON.stringify([DS, GLM]), JSON.stringify(W.on()));
    check("the workspace then runs on it", (await run(store.modelsOf, W.ctx, { space: "octopus" })).chat === null && (await run(store.modelsOf, W.ctx, { space: "octopus" })).favs.length === 2);

    /* a bad read never moves a workspace */
    set(0.05, 0.12);
    const at = W.row("octopus").favAt;
    const keep = lists[GLM]; delete lists[GLM];          // the one running (the default) is not found today
    d = await W.daily();
    check("when the favourite running cannot be priced, the workspace stays as it is and nothing is written", d.spaces.every(x => !x.switched && /stays/.test(x.why)) && W.row("octopus").chat === undefined && W.row("octopus").favAt === at, JSON.stringify(d));
    lists[GLM] = keep;
    d = await W.daily();
    check("and the next day it chooses again", d.spaces.every(x => x.switched) && JSON.stringify(W.on()) === JSON.stringify({ octopus: DS, squidgy: DS, pandaaahh: DS, demo: null, acme: null }));

    /* ending it */
    await run(store.setModels, W.ctx, { space: "squidgy", chat: "x/picked", favs: null });
    check("a model picked by hand stays, and ends the daily choice for that workspace", W.row("squidgy").chat === "x/picked" && !W.row("squidgy").favs && !W.row("squidgy").favAt && !W.row("squidgy").favPrices && !!W.row("octopus").favs);
    set(0.5, 0.12);
    await W.daily();
    check("the daily check leaves it alone", W.row("squidgy").chat === "x/picked" && W.row("octopus").chat === undefined);
    const late = await W.actx.runMutation("admin.favsApply", { space: "squidgy", favs: [DS, GLM], chat: DS, favAt: 1, favPrices: [{ id: DS, price: 0.1 }], stillOn: true });
    check("a check that priced for some seconds does not undo a model picked meanwhile: it writes only while the list stands",
      late.skipped === true && W.row("squidgy").chat === "x/picked" && !W.row("squidgy").favs, JSON.stringify(late));
    await W.actx.runMutation("admin.favsApply", { space: "squidgy", favs: [DS, GLM], chat: DS });
    check("while the command, which gives a list, writes it", W.row("squidgy").chat === DS && W.row("squidgy").favs.length === 2);
    await run(store.setModels, W.ctx, { space: "squidgy", chat: "x/picked", favs: null });
    const one = await run(admin.setModel, W.ctx, { model: "y/one", spaces: ["PandAAAHH"] });
    check("setModel ends the list too, and says so", one.spaces[0].favsEnded === true && !W.row("pandaaahh").favs && W.row("pandaaahh").chat === "y/one", JSON.stringify(one));
    const stop = await W.cmd({ models: null });
    check("models: null ends the daily choice and leaves each model running", JSON.stringify(stop.stopped) === '["octopus"]' && !W.row("octopus").favs && W.row("octopus").chat === undefined && W.row("squidgy").chat === "x/picked", JSON.stringify(stop));
    fetched = seen.length;
    await W.daily();
    check("with no list anywhere, the daily check reads nothing from OpenRouter", seen.length === fetched);
  }

  /* what the command refuses, before it writes anything */
  {
    set(0.08, 0.12);
    const W = await world();
    const before = JSON.stringify(W.T.models);
    const no = async a => await throws(W.cmd(a));
    check("a model OpenRouter does not know is refused by name, and nothing is written", /OpenRouter has no model called nope\/x\. Nothing was changed/.test(await no({ models: [DS, "nope/x"] })) && JSON.stringify(W.T.models) === before);
    check("a price that cannot be read is refused, with why", /could not price boom\/five \(OpenRouter answered 500\)/.test(await no({ models: [DS, "boom/five"] })) && JSON.stringify(W.T.models) === before);
    check("an alias with no providers of its own is refused: it has no price to compare", /could not price ~deepseek\/deepseek-v4-flash-latest/.test(await no({ models: [DS, "~deepseek/deepseek-v4-flash-latest"] })));
    check("one model is no choice, and more than 8 is too many", /at least 2 models/.test(await no({ models: [DS] })) && /at least 2 models/.test(await no({ models: [DS, DS] })) && /8 models at most/.test(await no({ models: Array.from({ length: 9 }, (_, i) => `v/m${i}`) })));
    check("a text that is not a model id is refused", /is not a model id/.test(await no({ models: [DS, "not a model"] })));
    const some = await W.cmd({ models: [DS, GLM], spaces: ["PandAAAHH", "squidgy"] });
    check("a few workspaces can be named, by slug or by name", some.spaces.map(x => x.space).join() === "squidgy,pandaaahh" && !W.row("octopus")?.favs && !!W.row("squidgy").favs);
    check("a workspace that is not on the deployment's key is refused, with the ones that are", /demo is not on this deployment's key\. They are: octopus, squidgy, pandaaahh/.test(await no({ models: [DS, GLM], spaces: ["demo"] })));
  }
  globalThis.fetch = real;
}

/* ---- one folder merged into another ---- */
{
  const { T, ctx } = seed();
  T.brains.push({ _id: "b3", slug: "gold", name: "Gold", type: "subject", scope: "s", space: undefined },
                { _id: "b4", slug: "me", name: "Me", type: "personal", scope: "", space: undefined });
  T.concepts.push(
    { _id: "c3", brain: "gold", slug: "gold", n: 1, title: "Gold", position: "Gold holds in crises.", summaryLine: "",
      evidence: [{ date: "2026-02-01", author: "B", claim: "gold rose in 2008", source: "s-b" }], data: [], conflicts: [], sources: ["s-b"], related: ["wealth/gold"], updated: "2026-02-01" },
    { _id: "c4", brain: "gold", slug: "bullion-vaults", n: 2, title: "Bullion vaults", position: "", summaryLine: "",
      evidence: [], data: [], conflicts: [], sources: [], related: ["gold/gold"], updated: "2026-02-01" });
  T.concepts[1].related = ["wealth/gold", "gold/bullion-vaults"];
  for (const c of T.concepts) await store.syncCard(ctx, c._id);
  T.sources.push({ _id: "s3", sid: "s-b", link: "", linkKey: "", title: "Gold talk", author: "B", date: "2026-02-01", location: "", brains: ["gold", "wealth"], stored: "x" });
  T.candidates = [{ _id: "k1", brain: "gold", slug: "coins", title: "Coins", notes: ["n1"], count: 1, updated: "x" }];
  T.chats = [{ _id: "h1", space: "octopus", title: "q", brain: "gold,wealth", pinned: false, turns: [], created: 1, updated: 1 }];
  const dry = await run(store.mergeBrains, ctx, { from: "gold", into: "wealth", space: "octopus", dry: true });
  check("a dry merge counts and writes nothing", dry.moved === 1 && dry.joined === 1 && !dry.merged && T.brains.some(b => b.slug === "gold"), JSON.stringify(dry));
  check("a personal folder never merges", /personal/.test(await throws(run(store.mergeBrains, ctx, { from: "me", into: "wealth", space: "octopus" }))));
  check("nor one from another workspace", /no folder/.test(await throws(run(store.mergeBrains, ctx, { from: "dogs", into: "wealth", space: "octopus" }))));
  const r = await run(store.mergeBrains, ctx, { from: "gold", into: "wealth", space: "octopus" });
  const gold = T.concepts.filter(c => c.brain === "wealth" && c.title === "Gold");
  check("a concept the target holds by title joins its twin, evidence and sources added", gold.length === 1 && gold[0].evidence.length === 2
    && gold[0].sources.includes("s-b") && gold[0].position === "Gold holds.", JSON.stringify(gold.map(c => c.evidence.length)));
  const vault = T.concepts.find(c => c.title === "Bullion vaults");
  check("the rest moves in, numbered after the target's newest", vault.brain === "wealth" && vault.n === 3 && JSON.stringify(vault.related) === '["wealth/gold"]', JSON.stringify(vault));
  check("links into the old folder follow", JSON.stringify(T.concepts[1].related) === '["wealth/gold","wealth/bullion-vaults"]', JSON.stringify(T.concepts[1].related));
  check("and a concept joined to its twin never links to itself", !gold[0].related.includes("wealth/gold"), JSON.stringify(gold[0].related));
  check("sources, candidates and chats follow", JSON.stringify(T.sources.find(x => x.sid === "s-b").brains) === '["wealth"]'
    && T.candidates[0].brain === "wealth" && T.chats[0].brain === "wealth", JSON.stringify({ s: T.sources.find(x => x.sid === "s-b").brains, c: T.candidates[0].brain, h: T.chats[0].brain }));
  check("the old folder goes, with no card left behind", !T.brains.some(b => b.slug === "gold") && !T.cards.some(c => c.brain === "gold") && r.merged, JSON.stringify(r));
}

/* ---- concepts of one folder joined, and a title changed in place ---- */
{
  const { T, ctx } = seed();
  T.brains.push({ _id: "b5", slug: "crypto", name: "Crypto", type: "subject", scope: "s", space: undefined },
                { _id: "b6", slug: "pals", name: "Pals", type: "subject", scope: "s", space: "squidgy", shared: ["octopus"] },
                { _id: "b7", slug: "showcase", name: "Showcase", type: "subject", scope: "s", space: "squidgy", viewers: ["octopus"] });
  const mk = (id, brain, slug, title, ev, related = []) => ({ _id: id, brain, slug, n: Number(id.slice(1)), title, position: title + " holds.", summaryLine: "",
    evidence: ev.map(([date, claim, source]) => ({ date, author: "A", claim, source })), data: [], conflicts: [], sources: ev.map(e => e[2]), related, updated: "x" });
  T.concepts.push(
    mk("k1", "crypto", "bitcoin-price", "Bitcoin price", [["2026-09-01", "supply sets it", "s1"]], ["crypto/prix-du-bitcoin"]),
    mk("k2", "crypto", "prix-du-bitcoin", "Prix du Bitcoin", [["2026-09-02", "demand sets it", "s2"]], ["crypto/bitcoin-price", "crypto/halving"]),
    mk("k3", "crypto", "halving", "Halving", [["2026-09-03", "supply halves", "s3"]], ["crypto/prix-du-bitcoin"]),
    mk("k4", "pals", "walks", "Walks", [["2026-09-04", "one a day", "s4"]]),
    mk("k5", "pals", "daily-walks", "Daily walks", [["2026-09-05", "two a day", "s5"]]),
    mk("k6", "showcase", "a", "A", []), mk("k7", "showcase", "b", "B", []));
  for (const c of T.concepts) await store.syncCard(ctx, c._id);
  const r = await run(store.joinConcepts, ctx, { space: "octopus", into: "crypto/bitcoin-price", from: ["crypto/prix-du-bitcoin"] });
  const kept = T.concepts.find(c => c._id === "k1");
  check("a twin folds into the kept concept, evidence and sources joined", r.joined === 1 && kept.evidence.length === 2
    && kept.sources.join() === "s1,s2" && !T.concepts.some(c => c._id === "k2") && !T.cards.some(c => c.slug === "prix-du-bitcoin"), JSON.stringify(r));
  check("its links join too, never to itself", JSON.stringify(kept.related) === '["crypto/halving"]', JSON.stringify(kept.related));
  check("links that named the folded one now name the kept one", JSON.stringify(T.concepts.find(c => c._id === "k3").related) === '["crypto/bitcoin-price"]');
  check("concepts of two folders never join", /one folder/.test(await throws(run(store.joinConcepts, ctx, { space: "octopus", into: "crypto/halving", from: ["wealth/gold"] }))));
  check("a folder shared in can be tidied from both workspaces",
    (await run(store.joinConcepts, ctx, { space: "octopus", into: "pals/walks", from: ["pals/daily-walks"] })).joined === 1);
  check("a folder only viewed never", /not in this workspace/.test(await throws(run(store.joinConcepts, ctx, { space: "octopus", into: "showcase/a", from: ["showcase/b"] }))));
  check("nor one of another workspace", /not in this workspace/.test(await throws(run(store.joinConcepts, ctx, { space: "squidgy", into: "crypto/halving", from: [] }))));

  await run(store.renameConcept, ctx, { space: "octopus", id: "crypto/halving", title: "  Bitcoin   halving " });
  const h = T.concepts.find(c => c._id === "k3");
  check("a title changes in place, its id kept", h.title === "Bitcoin halving" && h.slug === "halving" && T.cards.find(c => c.cid === "k3").title === "Bitcoin halving");
  check("a title another concept holds is refused", /merge the two/.test(await throws(run(store.renameConcept, ctx, { space: "octopus", id: "crypto/halving", title: "Bitcoin price" }))));
}

/* ---- the landing's one field reads every live door ---- */
{
  const { T, ctx } = seed();
  await run(store.setGate, ctx, { salt: "s1", hash: "h1", space: "octopus" });
  await run(store.setGate, ctx, { salt: "s2", hash: "h2", space: "squidgy" });
  await run(store.createWorkspace, ctx, { slug: "acme", name: "Acme", kind: "byok", salt: "s3", hash: "h3" });
  /* A door left behind by a workspace that is gone. */
  T.config.push({ _id: "orphan", key: "gate:gone", salt: "s4", hash: "h4" });
  const doors = await run(store.doorsAll, ctx, {});
  check("the landing reads every door with a passphrase, the owner's two first", doors.map(d => d.space).join(",") === "octopus,squidgy,acme", JSON.stringify(doors.map(d => d.space)));
  check("and never the door of a workspace that is gone", !doors.some(d => d.space === "gone"));
}

/* ---- a model that cannot answer without thinking is asked again, with a little ---- */
{
  const real = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "sk-test";
  const sent = [];
  globalThis.fetch = async (_u, opt) => {
    const b = JSON.parse(opt.body); sent.push(b);
    if (b.model === "z-ai/glm-5.3-flash" && b.reasoning?.effort === "none")
      return new Response(JSON.stringify({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }), { status: 200 });
  };
  const r = await lib.ask([{ role: "user", content: "x" }], { json: true, maxTokens: 1200, model: "z-ai/glm-5.3-flash" });
  check("a model that refuses to think none answers on the second ask", r.text === '{"ok":true}' && sent.length === 2, JSON.stringify(sent.map(b => b.reasoning)));
  check("with a little thinking, kept out of the reply, and room for it", sent[1].reasoning.effort === "low" && sent[1].reasoning.exclude === true
    && sent[1].max_tokens === 1200 + lib.THINK_ROOM, JSON.stringify(sent[1]));
  await lib.ask([{ role: "user", content: "y" }], { model: "z-ai/glm-5.3-flash" });
  check("and the next call asks it right the first time", sent.length === 3 && sent[2].reasoning.effort === "low");
  await lib.ask([{ role: "user", content: "z" }], { model: "deepseek/deepseek-v4-flash-0731" });
  check("a model that can skip thinking still skips it", sent[3].reasoning.effort === "none");
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Provider returned error" } }), { status: 400 });
  check("any other refusal is reported, not retried", /./.test(await throws(lib.ask([{ role: "user", content: "w" }], { model: "openai/gpt-x" }))));
  globalThis.fetch = real; delete process.env.OPENROUTER_API_KEY;
}

/* ---- an audit: the day it ran, the sources then, and the pairs kept apart ---- */
{
  const { T, db } = makeDb();
  T.brains = [{ _id: "b1", slug: "content", name: "Content", type: "subject", scope: "c", space: "octopus" }];
  T.sources = [{ _id: "s1", sid: "a", brains: ["content"] }, { _id: "s2", sid: "b", brains: ["content", "x"] }, { _id: "s3", sid: "c", brains: ["x"] }];
  const r = await run(store.auditMark, { db }, { space: "octopus", brain: "content" });
  check("an audit keeps its day and the sources the folder held", r.audit.sources === 2 && /^\d{4}-\d{2}-\d{2}$/.test(r.audit.at) && T.brains[0].audit.sources === 2);
  await run(store.auditMark, { db }, { space: "octopus", brain: "content", apart: ["content/b", "content/a"] });
  await run(store.auditMark, { db }, { space: "octopus", brain: "content", apart: ["content/a", "content/b"] });
  check("a pair kept apart is kept once, whichever way round", JSON.stringify(T.brains[0].apart) === '["content/a|content/b"]', JSON.stringify(T.brains[0].apart));
  check("another workspace's folder is never stamped", /not in this workspace/.test(await throws(run(store.auditMark, { db }, { space: "squidgy", brain: "content" }))));
}

/* ---- error reports: counted, and held to a few an hour ---- */
{
  const { T, db } = makeDb();
  const send = (space, owner) => run(store.feedbackLog, { db }, { space, ...(owner ? { owner } : {}), error: "The server did not answer." });
  const five = []; for (let i = 0; i < 6; i++) five.push((await send("octopus")).ok);
  check("5 reports an hour from one sender, the 6th refused", JSON.stringify(five) === "[true,true,true,true,true,false]", JSON.stringify(five));
  check("another workspace keeps its own count", (await send("squidgy")).ok);
  const visitors = []; for (let i = 0; i < 25; i++) visitors.push((await send("demo", "v" + i)).ok);
  check("the demo stops at 20 an hour, whoever sends", visitors.filter(Boolean).length === 20, String(visitors.filter(Boolean).length));
  T.feedback.push({ _id: "old", space: "octopus", error: "x", at: Date.now() - 8 * 86400000 });
  await send("octopus");
  check("reports past a week are cleared", !T.feedback.some(r => r._id === "old"));
}

/* ---- a reply that is JSON with a slip in it is mended, not lost ---- */
{
  const read = (t, f = "stop") => { try { return lib.parseJson(t, f); } catch (e) { return { error: e.message }; } };
  const q = read('{"title":"The "ultrasound money" thesis","topics":[]}');
  check("a quote mark left bare inside a string is mended", q.title === 'The "ultrasound money" thesis' && Array.isArray(q.topics), JSON.stringify(q));
  const c = read('{"t":"He called it "digital gold", a store of value","n":1}');
  check("even when a comma and plain words follow it", c.t === 'He called it "digital gold", a store of value' && c.n === 1, JSON.stringify(c));
  const nl = read('{"quote":"line one\nline two\tend"}');
  check("a line break or a tab inside a string is mended", nl.quote === "line one\nline two\tend", JSON.stringify(nl));
  const tc = read('{"a":[1,2,],"b":{"c":3,},}');
  check("a comma before a closing bracket is dropped", JSON.stringify(tc) === '{"a":[1,2],"b":{"c":3}}', JSON.stringify(tc));
  const cut = read('{"title":"Crypto","topics":[{"topic":"Layer 2s","ideas":["Fees fell 90%","Rollups w');
  check("a reply that stops before its end is never kept half: it is read again in halves", /stopped before it ended/.test(cut.error || ""), JSON.stringify(cut));
  const key = read('{"title":"X","topics":[],"kind":');
  check("so is one cut on a key with no value", /stopped before it ended/.test(key.error || ""), JSON.stringify(key));
  check("a mended reply that closed on its own is kept", lib.repairJson('{"a":"x","b":[1,2,]} trailing').cut === false
    && lib.repairJson('{"a":["x"').cut === true);
  const after = read('Here it is: {"a":1,"b":"x"} Hope this helps {');
  check("prose after the closing bracket is left out", JSON.stringify(after) === '{"a":1,"b":"x"}', JSON.stringify(after));
  const good = read('{"a":"say \\"hi\\"","b":[1,{"c":null}]}');
  check("good JSON reads as it is", good.a === 'say "hi"' && good.b[1].c === null, JSON.stringify(good));
  check("a reply cut by the token budget still says so", /cut off by the token budget/.test(read('{"a":', "length").error || ""));
  check("prose with no JSON still fails, and says what came back", /held no JSON/.test(read("I could not read this source.").error || ""));
}

/* ---- what an audit found stays on the folder until it is decided ---- */
{
  const { T, ctx } = seed();
  await run(store.findingsSet, ctx, { space: "octopus", brain: "wealth", findings: { at: "2026-10-06", same: [], english: [{ id: "wealth/gold", to: "Gold" }, { id: "wealth/silver", to: "Silver" }], blank: [] } });
  await run(store.findingsSet, ctx, { space: "octopus", brain: "dogs", findings: { english: [{ id: "x" }] } });
  const r = await run(store.findingsDrop, ctx, { space: "octopus", brain: "wealth", kind: "english", id: "wealth/gold" });
  const wealth = T.brains.find(b => b.slug === "wealth"), dogs = T.brains.find(b => b.slug === "dogs");
  check("an audit's findings are kept on its folder, and one ruled out leaves for good, in its own workspace only",
    r.ok && JSON.stringify(wealth.findings.english) === '[{"id":"wealth/silver","to":"Silver"}]' && !dogs.findings, JSON.stringify([wealth.findings, dogs.findings]));
}

/* ---- the command that makes doubled open lines one ---- */
{
  const { T, ctx } = seed();
  const file = open => ({ v: 1, facts: [], events: [], links: [], seen: "", open });
  T.brains.push({ _id: "bme", slug: "me", name: "Me", type: "personal", scope: "", space: "octopus" });
  T.concepts.push(
    { _id: "m1", brain: "me", slug: "marc", n: 1, title: "Marc Dupont", tag: "contact", position: "", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01",
      file: file([{ k: "a", t: "Send Marc the contract", at: "2026-09-01" }, { k: "b", t: "Book the venue", at: "2026-09-05" }, { k: "c", t: "Send the contract to Marc, by Friday", at: "2026-09-20" }, { k: "d", t: "Send the contract", at: "2026-08-01", done: "2026-08-02" }]) },
    { _id: "m2", brain: "me", slug: "paul", n: 2, title: "Paul", tag: "contact", position: "", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01",
      file: file([{ k: "e", t: "Pay Paul's invoice", at: "2026-10-01" }]) },
    { _id: "m3", brain: "me", slug: "note", n: 3, title: "A note", position: "x", summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [], updated: "2026-10-01" });
  T.cards = [{ _id: "k1", cid: "m1", brain: "me", slug: "marc" }, { _id: "k2", cid: "m2", brain: "me", slug: "paul" }];
  const get = slug => T.concepts.find(c => c.brain === "me" && c.slug === slug);
  const dry = await run(admin.dedupeOpenPage, ctx, { brain: "me", cursor: null, dry: true });
  check("a dry run counts the doubled lines and writes nothing", dry.merged === 1 && dry.people === 2 && dry.lines === 3 && get("marc").file.open.length === 4, JSON.stringify(dry));
  const done = await run(admin.dedupeOpenPage, ctx, { brain: "me", cursor: null });
  const marc = get("marc").file.open;
  check("the command makes them one: the oldest line stays with the newest wording, a closed line is left, other people and notes are untouched",
    done.merged === 1 && done.people === 2 && done.lines === 3 && marc.length === 3 && marc[0].k === "a" && marc[0].t === "Send the contract to Marc, by Friday" && marc[0].at === "2026-09-01"
    && marc.some(x => x.k === "d" && x.done) && get("paul").file.open.length === 1 && !get("note").file, JSON.stringify({ done, marc }));
  check("each card carries the count of what is open", T.cards.find(c => c.slug === "marc")?.open === 2 && T.cards.find(c => c.slug === "paul")?.open === 1, JSON.stringify(T.cards));
  check("run again, nothing is left to merge", (await run(admin.dedupeOpenPage, ctx, { brain: "me", cursor: null })).merged === 0);
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe store holds");
process.exit(failures ? 1 : 0);
