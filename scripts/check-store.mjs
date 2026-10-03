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
for (const f of ["store.ts", "lib.ts", "words.ts", "admin.ts", "space.ts", "digest.ts", "onepager.ts", "route.ts", "conflicts.ts", "drop.ts", "projects.ts", "tidy.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
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
await esbuild.build({ entryPoints: [join(dir, "digest.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "digest.mjs"), logLevel: "silent" });
const digest = await import(pathToFileURL(join(dir, "digest.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "conflicts.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "conflicts.mjs"), logLevel: "silent" });
const conflicts = await import(pathToFileURL(join(dir, "conflicts.mjs")).href);

await esbuild.build({ entryPoints: [join(dir, "projects.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "projects.mjs"), logLevel: "silent" });
const projects = await import(pathToFileURL(join(dir, "projects.mjs")).href);

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

/* ---- a workspace's side panel: limited until switched ---- */
{
  const { T, ctx } = seed();
  check("a workspace starts limited", (await run(store.modeOf, ctx, { space: "acme" })) === false);
  await run(store.setMode, ctx, { space: "acme", full: true });
  check("full is kept, for that workspace alone", (await run(store.modeOf, ctx, { space: "acme" })) === true
    && (await run(store.modeOf, ctx, { space: "octopus" })) === false);
  await run(store.setMode, ctx, { space: "acme", full: false });
  check("and limited again, on the same row", (await run(store.modeOf, ctx, { space: "acme" })) === false && T.modes.length === 1);
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

/* ---- projects: kept to their workspace, ten versions, out of date when a source lands ---- */
{
  const { T, ctx } = seed();
  const base = { space: "octopus", name: "Gold thesis", brains: ["wealth"], instructions: "Where my sources stand on gold.", auto: true };
  check("a project needs a name and a folder", /needs a name/.test((await run(projects.save, ctx, { ...base, name: "  " })).error || "")
    && /at least one folder/.test((await run(projects.save, ctx, { ...base, brains: [] })).error || ""));
  check("a template past 60 KB is refused", /60 KB/.test((await run(projects.save, ctx, { ...base, template: "<p>" + "x".repeat(61000) })).error || ""));
  const made = await run(projects.save, ctx, { ...base, template: "<html><body><h1>{{title}}</h1></body></html>", templateName: "gold.html" });
  check("a project is made with its template", !!made.id && T.projects[0].templateName === "gold.html" && T.projects[0].turns.length === 0, JSON.stringify(made));
  check("another workspace never reads it", (await run(projects.get, ctx, { space: "squidgy", id: made.id })) === null);
  check("nor deletes it", /gone/.test((await run(projects.remove, ctx, { space: "squidgy", id: made.id })).error || "") && T.projects.length === 1);
  await run(projects.save, ctx, { ...base, id: made.id, name: "Gold" });
  check("new settings keep the template when none is sent", T.projects[0].name === "Gold" && /title/.test(T.projects[0].template));
  await run(projects.save, ctx, { ...base, id: made.id, template: null });
  check("and drop it when asked", T.projects[0].template === undefined);

  for (let i = 0; i < 12; i++) await run(projects.addVersion, ctx, { space: "octopus", id: made.id, html: `<html>v${i + 1}</html>`, why: "Rebuilt" });
  const one = await run(projects.get, ctx, { space: "octopus", id: made.id });
  check("the newest 10 versions are kept, the newest on top", one.versions.length === 10 && one.version === 12 && one.versions[0].v === 12
    && one.versions[9].v === 3 && one.page === "<html>v12</html>", JSON.stringify(one.versions.map(x => x.v)));
  check("an old version opens by its number", (await run(projects.page, ctx, { space: "octopus", id: made.id, v: 5 }))?.html === "<html>v5</html>");

  for (let i = 0; i < 45; i++) await run(projects.turn, ctx, { space: "octopus", id: made.id, turn: { q: "q" + i, a: "a" } });
  check("its chat keeps the last 40 turns", T.projects[0].turns.length === 40 && T.projects[0].turns[0].q === "q5");
  await run(projects.clear, ctx, { space: "octopus", id: made.id });
  check("and clears, leaving the page", T.projects[0].turns.length === 0 && T.pages.length === 10);

  const other = await run(projects.save, ctx, { ...base, name: "Dogs", brains: ["dogs"], auto: false });
  const quiet = await run(projects.markStale, ctx, { space: "octopus", brains: ["wealth"], claim: false });
  check("a source landing marks the projects reading that folder out of date", T.projects[0].stale === true && !T.projects[1].stale && !quiet.length
    && T.projects[0].building === undefined, JSON.stringify(quiet));
  const due = await run(projects.markStale, ctx, { space: "octopus", brains: ["wealth", "dogs"], claim: true });
  check("the ones set to rebuild are started once", JSON.stringify(due) === JSON.stringify([made.id]) && !!T.projects[0].building && T.projects[1].stale === true);
  check("and a second drop minutes later does not start another", (await run(projects.markStale, ctx, { space: "octopus", brains: ["wealth"], claim: true })).length === 0);
  check("a source in another workspace marks none of these", (await run(projects.markStale, ctx, { space: "squidgy", brains: ["wealth"], claim: true })).length === 0);
  await run(projects.addVersion, ctx, { space: "octopus", id: made.id, html: "<html>v13</html>", why: "A source landed" });
  check("a new version clears the mark", T.projects[0].stale === false && T.projects[0].building === undefined);

  for (let i = 0; i < 18; i++) await run(projects.save, ctx, { ...base, name: "P" + i });
  check("20 projects is the most a workspace holds", /20 projects/.test((await run(projects.save, ctx, { ...base, name: "One more" })).error || ""));
  await run(projects.remove, ctx, { space: "octopus", id: made.id });
  check("deleting a project deletes its pages", !T.projects.some(p => p._id === made.id) && !T.pages.some(p => p.project === made.id));
  check("the page comes back as the document alone", projects.cleanHtml("Here it is:\n```html\n<!doctype html><html><body>x</body></html>\n```") === "<!doctype html><html><body>x</body></html>");
  void other;
}

/* ---- answers wait for Build; models are picked per workspace ---- */
{
  const { T, ctx } = seed();
  const made = await run(projects.save, ctx, { space: "octopus", name: "Gold", brains: ["wealth"], instructions: "", auto: false });
  check("a project's page builds only on demand unless its owner turns that on", T.projects[0].auto === false);
  await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "Sell?", a: "Two signals." });
  await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "Sell?", a: "Two signals." });
  await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "Hold?", a: "Yes." });
  check("an added answer waits once, however often it is added", T.projects[0].pending.map(x => x.q).join(",") === "Sell?,Hold?" && !T.pages?.length);
  check("another workspace cannot add to it", /gone/.test((await run(projects.queue, ctx, { space: "squidgy", id: made.id, q: "x", a: "y" })).error || ""));
  await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "Hold?", a: "Yes.", remove: true });
  check("and it can be taken back", T.projects[0].pending.map(x => x.q).join(",") === "Sell?");
  for (let i = 0; i < 9; i++) await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "q" + i, a: "a" });
  check("10 answers wait at most", /10 answers/.test((await run(projects.queue, ctx, { space: "octopus", id: made.id, q: "one more", a: "a" })).error || ""));
  const got = await run(projects.get, ctx, { space: "octopus", id: made.id });
  check("the project says what waits", got.waiting === 10 && got.pending.length === 10);
  await run(projects.addVersion, ctx, { space: "octopus", id: made.id, html: "<html>v1</html>", why: "Built", took: 8 });
  check("a build clears what it read, and keeps an answer added while it ran", T.projects[0].pending.map(x => x.q).join(",") === "q7,q8", JSON.stringify(T.projects[0].pending.map(x => x.q)));

  check("a workspace starts on the default models", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":null,"project":null}');
  await run(store.setModels, ctx, { space: "octopus", project: "z-ai/glm-5.3" });
  const one = await run(store.modelsOf, ctx, { space: "octopus" });
  check("a project model picked leaves the chat model alone", one.project === "z-ai/glm-5.3" && one.chat === null, JSON.stringify(one));
  await run(store.setModels, ctx, { space: "octopus", chat: "openai/gpt-5" });
  check("and the other way round", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":"openai/gpt-5","project":"z-ai/glm-5.3"}');
  check("another workspace keeps its own", JSON.stringify(await run(store.modelsOf, ctx, { space: "squidgy" })) === '{"chat":null,"project":null}');
  await run(store.setModels, ctx, { space: "octopus", project: null });
  check("null goes back to the default", JSON.stringify(await run(store.modelsOf, ctx, { space: "octopus" })) === '{"chat":"openai/gpt-5","project":null}');
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

/* ---- every one-pager is kept, by owner, the newest 50 ---- */
{
  const { T, ctx } = seed();
  const page = { title: "Deep dive: Wealth", sections: [] };
  const one = await run(store.pagerSave, ctx, { space: "octopus", page, text: "x", ask: { pick: "wealth" } });
  check("a one-pager built is kept by its title", one.title === "Deep dive: Wealth" && T.onepagers.length === 1);
  check("it opens again whole", (await run(store.pagerGet, ctx, { space: "octopus", id: one.id }))?.page?.title === "Deep dive: Wealth");
  check("never from another workspace", (await run(store.pagerGet, ctx, { space: "squidgy", id: one.id })) === null
    && /gone/.test((await run(store.pagerRemove, ctx, { space: "squidgy", id: one.id })).error || ""));
  await run(store.pagerSave, ctx, { space: "demo", owner: "v1", page: { title: "Mine" }, text: "x", ask: {} });
  await run(store.pagerSave, ctx, { space: "demo", owner: "v2", page: { title: "Theirs" }, text: "x", ask: {} });
  const v1 = await run(store.pagerList, ctx, { space: "demo", owner: "v1" });
  check("a demo visitor lists only their own", v1.map(x => x.title).join(",") === "Mine", JSON.stringify(v1));
  for (let i = 0; i < 52; i++) await run(store.pagerSave, ctx, { space: "octopus", page: { title: "P" + i }, text: "x", ask: {} });
  const kept = await run(store.pagerList, ctx, { space: "octopus" });
  check("the newest 50 stay", kept.length === 50 && kept[0].title === "P51" && !kept.some(x => x.title === "Deep dive: Wealth"), String(kept.length));
  await run(store.pagerRemove, ctx, { space: "octopus", id: kept[0].id });
  check("and one can be deleted", (await run(store.pagerList, ctx, { space: "octopus" })).length === 49);
}

/* ---- a rebuild runs on the deployment's key only ---- */
{
  const landed = async (who, ws) => {
    const { T, ctx } = seed();
    const sched = [];
    const actx = { ...ctx, scheduler: { runAfter: async (_ms, fn, args) => { sched.push([fn, args]); } },
      runMutation: (fn, args) => run(projects[String(fn).split(".")[1]], ctx, args),
      runQuery: async () => ws };
    const space = who.space;
    await run(projects.save, ctx, { space, name: "Gold", brains: ["wealth"], instructions: "", auto: true });
    await projects.sourceLanded(actx, who, ["wealth"], { rebuild: true });
    return { sched, stale: !!T.projects[0].stale, building: !!T.projects[0].building };
  };
  const own = await landed({ space: "octopus" }, null);
  check("in the owner's workspace a landed source starts the rebuild", own.sched.length === 1 && own.sched[0][0] === "projects.rebuild" && own.stale, JSON.stringify(own));
  const byok = await landed({ space: "acme", byok: true }, { kind: "byok" });
  check("on a visitor's own key it only marks the page out of date", !byok.sched.length && byok.stale && !byok.building, JSON.stringify(byok));
  const sneaky = await landed({ space: "acme" }, { kind: "byok" });
  check("even when the caller does not say whose key it runs on", !sneaky.sched.length && sneaky.stale, JSON.stringify(sneaky));
  const demo = await landed({ space: "demo", demo: true }, { kind: "demo" });
  check("and the demo, which has no projects, marks nothing", !demo.sched.length && !demo.stale, JSON.stringify(demo));
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe store holds");
process.exit(failures ? 1 : 0);
