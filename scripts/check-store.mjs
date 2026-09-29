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
for (const f of ["store.ts", "lib.ts", "words.ts", "admin.ts", "space.ts", "digest.ts", "onepager.ts", "route.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
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
        const q = { eq(f, v) { conds.push([f, v]); return q; } };
        if (fn) fn(q);
        return api;
      },
      order(dir) { api._desc = dir === "desc"; return api; },
      async collect() {
        const all = rows(t).filter(r => conds.every(([f, v]) => r[f] === v));
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
      async insert(t, doc) { const r = { _id: `id${++id}`, ...doc }; rows(t).push(r); return r._id; },
      async patch(_id, doc) { Object.assign(find(_id), doc); },
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

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nthe store holds");
process.exit(failures ? 1 : 0);
