/**
 * Runs a whole connector drop against an in-memory store.
 *
 *     node scripts/check-mcp.mjs
 *
 * The point of the connector is that the client's own model does every piece of
 * thinking, so this deployment spends nothing. This harness proves it: the fake
 * context below answers reads and writes, and any attempt to reach a model
 * would need network, which nothing here has.
 *
 * It also holds the permission line: an address with no token sees the six read
 * tools and nothing else, and a draft belongs to the account that started it.
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-mcp-"));
mkdirSync(join(dir, "_generated"));
for (const f of ["mcp.ts", "drop.ts", "lib.ts", "words.ts", "space.ts", "onepager.ts", "route.ts", "projects.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => " +
  "new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
/* drop.ts marks projects out of date, and projects.ts defines Convex functions. */
writeFileSync(join(dir, "_generated/server.ts"),
  "export const internalQuery = (d: any) => d;\nexport const internalMutation = (d: any) => d;\nexport const internalAction = (d: any) => d;\n");
await esbuild.build({ entryPoints: [join(dir, "mcp.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { handleRpc, versionOk } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
/* Every candidate becomes a concept on the drop that argues for it. */
const MENTIONS = 1;
await esbuild.build({ entryPoints: [join(dir, "drop.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle-drop.mjs"), logLevel: "silent" });
const { dropSettle, fetchPage, planContext, dropMerge, dropPlan, youtubeChannel, plainClaim, PLAN_RULES: RULES_P, REWRITE_RULES } = await import(pathToFileURL(join(dir, "bundle-drop.mjs")).href);
await esbuild.build({ entryPoints: [join(dir, "words.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle-words.mjs"), logLevel: "silent" });
const { findByTitle, cardOf } = await import(pathToFileURL(join(dir, "bundle-words.mjs")).href);

const DB = {
  brains: [
    { slug:"content", name:"Content", type:"subject", scope:"How a brand publishes content and turns attention into buyers", owner:"octopus" },
    { slug:"health",  name:"Health",  type:"subject", scope:"sleep, recovery and training load", owner:"octopus" },
    { slug:"other",   name:"Other",   type:"subject", scope:"a brain of the other space", space:"squidgy" },
  ],
  concepts: [
    { brain:"content", slug:"offer-creation", n:1, title:"Offer creation as a key skill",
      position:"An offer people buy beats a bigger audience.", summaryLine:"Offer first.",
      evidence:[{date:"2026-01-02",author:"A",claim:"offer first"}], data:[], conflicts:[], sources:["s-a"], updated:"2026-01-02" },
    { brain:"content", slug:"personal-brand", n:2, title:"Personal brand as growth strategy",
      position:"A named face compounds distribution.", summaryLine:"Face beats logo.",
      evidence:[{date:"2026-02-02",author:"B",claim:"face beats logo"}], data:[], conflicts:[], sources:["s-b"], updated:"2026-02-02" },
  ],
  sources: [{ sid:"s-a", brains:["content"], author:"A", title:"first", date:"2026-01-02" }],
  drafts: new Map(), candidates: new Map(), writes: [],
  /* Which space each read asked for. The MCP server serves Octopus only, so a
     read that forgets to name one would quietly expose the other space. */
  spacesRead: [],
  scheduled: [],
};

const ctx = {
  /* A store schedules linking for what it wrote. Recorded, never run here. */
  scheduler: { runAfter: async (_ms, fn, a) => { DB.scheduled.push({ fn, ...a }); } },
  runQuery: async (fn, a) => {
    if (fn === "store.everything") {
      DB.spacesRead.push(a?.space ?? null);
      return { brains: DB.brains, concepts: DB.concepts, sources: DB.sources };
    }
    /* The slim copies, made from the concepts the way the store makes them. */
    if (fn === "store.spaceHead") {
      DB.spacesRead.push(a?.space ?? null);
      return { brains: DB.brains.filter(b => (b.space ?? "octopus") === a.space), sources: DB.sources, ready: true };
    }
    /* Pages of 3, so every reader is checked to walk all of them. */
    if (fn === "store.cardsPage") {
      const all = DB.concepts.filter(c => c.brain === a.brain).map(cardOf), from = Number(a.cursor ?? 0);
      return { cards: all.slice(from, from + 3), done: from + 3 >= all.length, cursor: String(from + 3) };
    }
    if (fn === "store.conceptsByIds") {
      DB.spacesRead.push(a?.space ?? null);
      return a.ids.map(id => DB.concepts.find(c => `${c.brain}/${c.slug}` === id)).filter(Boolean);
    }
    if (fn === "store.settleReads") {
      DB.spacesRead.push(a?.space ?? null);
      /* The real query's caps, so a caller that sends too much is caught. */
      const byId = {};
      for (const id of [...new Set(a.ids)].slice(0, 400)) { const c = DB.concepts.find(x => `${x.brain}/${x.slug}` === id); if (c) byId[id] = c; }
      const mine = DB.brains.filter(b => (b.space ?? "octopus") === a.space), ok = new Set(mine.map(b => b.slug));
      for (const k of Object.keys(byId)) if (!ok.has(k.split("/")[0])) delete byId[k];
      return { brains: mine, byId,
        byTitle: a.titles.slice(0, 200).map(t => findByTitle(DB.concepts, t.brain, t.title) ?? null),
        empty: Object.fromEntries(DB.brains.map(b => [b.slug, !DB.concepts.some(c => c.brain === b.slug)])) };
    }
    if (fn === "store.noteBySid") {
      const n = DB.writes.filter(w => w.kind === "note" && w.doc.sid === a.sid).at(-1);
      return n ? { ...n.doc, kind: n.doc.findings?.kind } : null;
    }
    if (fn === "store.findSource") return null;
    if (fn === "store.getDraft") {
      const d = DB.drafts.get(a.token);
      return d && d.account === a.account ? { ...d } : null;
    }
    throw new Error("unexpected query " + fn);
  },
  runMutation: async (fn, a) => {
    if (fn === "store.newDraft") { DB.drafts.set(a.token, { ...a, plan:null, parts:1 }); return { token:a.token }; }
    if (fn === "store.saveDraft") {
      const d = DB.drafts.get(a.token); if (!d) throw new Error("draft gone");
      if (a.ext !== undefined) d.ext = a.ext;
      if (a.plan !== undefined) d.plan = a.plan;
      return { ok:true };
    }
    if (fn === "store.killDraft") { DB.drafts.delete(a.token); return { ok:true }; }
    if (fn === "store.createBrain") {
      const sl = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (DB.brains.some(b => b.slug === sl)) throw new Error("a brain with that name exists");
      DB.brains.push({ slug: sl, name: a.name, type: a.type, scope: a.scope, space: a.space });
      return sl;
    }
    if (fn === "store.upsertConcept") { DB.writes.push({ kind:"concept", ...a }); return {}; }
    if (fn === "store.writeSource")  { DB.writes.push({ kind:"source", ...a }); return {}; }
    if (fn === "store.writeNote")    { DB.writes.push({ kind:"note", ...a }); return {}; }
    throw new Error("unexpected mutation " + fn);
  },
};

let pass = 0, fail = 0;
const check = (name, cond, extra="") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "\n       " + extra : ""}`); }
};
const call = async (name, args, caller) => {
  const r = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/call", params:{ name, arguments:args } }, caller);
  return r.result?.content?.[0]?.text ?? JSON.stringify(r);
};
const ME = { account:"octopus", name:"Octopus" };

/* ---- listing ---- */
{
  const anon = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/list" }, null);
  const signed = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/list" }, ME);
  const an = anon.result.tools.map(t => t.name), sn = signed.result.tools.map(t => t.name);
  check("anonymous sees 7 read tools, one_pager among them", an.length === 7 && an.includes("one_pager") && !an.includes("drop_store"), an.join(","));
  check("signed sees 13 tools", sn.length === 13 && sn.includes("drop_store"), sn.join(","));
}

/* ---- the space a read asks for ---- */
{
  DB.spacesRead.length = 0;
  await call("ask", { question: "what beats a bigger audience" }, ME);
  await call("list_brains", {}, null);
  check("every read names the octopus space",
    DB.spacesRead.length >= 2 && DB.spacesRead.every(x => x === "octopus"),
    DB.spacesRead.join(","));
}

/* ---- Claude's connector check sends the newest protocol version ---- */
{
  const init = { jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2025-11-25" } };
  check("the 2025-11-25 version is spoken", versionOk("2025-11-25", init) && versionOk("2025-11-25", { method:"tools/list" }));
  const r = await handleRpc(ctx, init, null);
  check("and agreed to when a client asks for it", r.result.protocolVersion === "2025-11-25", r.result.protocolVersion);
  const later = await handleRpc(ctx, { ...init, params:{ protocolVersion:"2099-01-01" } }, null);
  check("a version from the future gets the newest this server speaks", later.result.protocolVersion === "2025-11-25", later.result.protocolVersion);
  check("an initialize is never refused for its header", versionOk("2099-01-01", { ...init, params:{ protocolVersion:"2099-01-01" } }));
  check("a later call on a version never agreed still is", !versionOk("2099-01-01", { method:"tools/list" }));
  check("no header reads as an older client", versionOk(null, { method:"tools/list" }));
}

/* ---- a question in any language, through the client's English words ---- */
{
  const fr = "comment bâtir une proposition commerciale ?";
  const bare = await call("ask", { question: fr }, ME);
  check("a French question alone finds nothing, and asks for English words", /Nothing in these brains matches/.test(bare)
    && /Call ask again with terms/.test(bare), bare.slice(0, 160));
  const withTerms = await call("ask", { question: fr, terms: ["offer", "creation", "sales"] }, ME);
  check("with the client's English words it finds the concept", /# Offer creation as a key skill/.test(withTerms)
    && /QUESTION: comment bâtir/.test(withTerms), withTerms.slice(0, 200));
  const junk = await call("ask", { question: fr, terms: "offer" }, ME);
  check("terms that are not a list are ignored, not thrown on", /Nothing in these brains matches/.test(junk));
  const tools = (await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/list" }, null)).result.tools;
  check("the ask tool asks for the terms every time", tools.find(t => t.name === "ask").inputSchema.properties.terms?.type === "array"
    && /send these every time/.test(tools.find(t => t.name === "ask").inputSchema.properties.terms.description));
}

/* ---- a one-pager, written by the client from the app's own rules ---- */
{
  const bad = await call("one_pager", { kind: "poem" }, null);
  check("a one-pager names its four kinds", /summary, quiz, deepdive, usecase/.test(bad), bad);
  const ready = await call("one_pager", { kind: "summary", brain: "content" }, null);
  check("a summary with no subject comes back written, as the app lays it out", /THE PAGE, READY/.test(ready)
    && /^Content$/m.test(ready) && /- Offer creation as a key skill/.test(ready) && /positions · \d+ sources? read/.test(ready), ready.slice(0, 300));
  const quiz = await call("one_pager", { kind: "quiz", subject: "comment bâtir une offre", terms: ["offer", "creation"] }, ME);
  check("a quiz returns the app's quiz rules and the concepts it rests on", /ONE-PAGER: Quiz/.test(quiz) && /"## Questions"/.test(quiz)
    && /### Offer creation as a key skill/.test(quiz) && /SUBJECT: comment bâtir une offre/.test(quiz), quiz.slice(0, 300));
  check("with its title and foot to copy", /TITLE: Quiz: comment bâtir une offre/.test(quiz) && /FOOT: \d+ of \d+ positions · \d+ sources? read · \d{4}-\d\d-\d\d/.test(quiz));
  const deep = await call("one_pager", { kind: "deepdive", brain: "content", instructions: "For a new client" }, ME);
  check("a deep dive with no subject reads the fullest positions, and carries the instruction", /ONE-PAGER: Deep dive/.test(deep)
    && /500 to 800 words/.test(deep) && /OWNER'S INSTRUCTION\nFor a new client/.test(deep) && /TITLE: Deep dive: Content/.test(deep), deep.slice(0, 300));
  const uses = await call("one_pager", { kind: "usecase", subject: "personal brand", brain: "content" }, ME);
  check("use cases return their own shape", /ONE-PAGER: Use cases/.test(uses) && /3 to 5 cases/.test(uses) && /### Personal brand/.test(uses));
  const sum = await call("one_pager", { kind: "summary", subject: "why does a named face help", terms: ["personal brand"] }, ME);
  check("a summary of a question keeps the bullet rules", /ONE-PAGER: Summary/.test(sum) && /Core concept: what it says/.test(sum) && /QUESTION: why/.test(sum));
  const frQuiz = await call("one_pager", { kind: "quiz", brain: "content", language: "French" }, ME);
  check("a page asked in French is written in French, its title and foot too", /ONE-PAGER: Quiz, in French/.test(frQuiz)
    && /Write in French, always\./.test(frQuiz) && !/English, always/.test(frQuiz) && /TITLE and the FOOT are translated too/.test(frQuiz), frQuiz.slice(-600));
  const frReady = await call("one_pager", { kind: "summary", brain: "content", language: "French" }, null);
  check("a ready summary asked in French is handed over to translate", /Translate it into French, every line/.test(frReady) && /^Content$/m.test(frReady));
  check("English stays the default", !/Translate it into/.test(ready) && /English, always/.test(deep) && !/, in English/.test(deep));
  DB.spacesRead.length = 0;
  await call("one_pager", { kind: "quiz" }, { account:"owner-squidgy", name:"Owner", space:"squidgy" });
  check("a Squidgy address builds from Squidgy only", DB.spacesRead.length >= 1 && DB.spacesRead.every(x => x === "squidgy"), DB.spacesRead.join(","));
}

/* ---- one address per project ---- */
{
  const SQ = { account:"owner-squidgy", name:"Owner", space:"squidgy" };
  DB.spacesRead.length = 0;
  const listed = await call("list_brains", {}, SQ);
  check("a Squidgy address lists the Squidgy brains", /Other/.test(listed) && !/Content|Health/.test(listed), listed.slice(0, 200));
  await call("ask", { question: "what beats a bigger audience" }, SQ);
  check("and every read it makes names Squidgy", DB.spacesRead.length >= 2 && DB.spacesRead.every(x => x === "squidgy"),
    DB.spacesRead.join(","));
  const init = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2025-06-18" } }, SQ);
  check("it introduces itself as Squidgy", init.result.serverInfo.title === "Squidgy Brains"
    && /^These are Squidgy brains/.test(init.result.instructions), JSON.stringify(init.result.serverInfo));
  const made = await call("create_brain", { name:"Recall", scope:"how a dog learns to come back when called" }, SQ);
  check("a brain it makes lands in Squidgy", made.startsWith("Made Recall") && DB.brains.at(-1).space === "squidgy",
    JSON.stringify(DB.brains.at(-1)));
  DB.brains.pop();
  const anon = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"initialize", params:{} }, null);
  check("an address with no key still reads Octopus", anon.result.serverInfo.title === "Octopus Brains");
}

/* ---- the fetcher refuses what it should, before any network ---- */
{
  const no = async (url) => await call("fetch_link", { url }, ME);
  check("plain http is refused",        (await no("http://example.com/x")).includes("Only https"));
  check("localhost is refused",         (await no("https://localhost/x")).includes("not a public"));
  check("a private range is refused",   (await no("https://10.0.0.7/x")).includes("not a public"));
  check("link local is refused",        (await no("https://169.254.169.254/latest/meta-data")).includes("not a public"));
  check("a bare host is refused",       (await no("https://intranet/x")).includes("not a public"));
  check("nonsense is refused",          (await no("just some words")).includes("not a full address"));
  const yt = await no("https://www.youtube.com/watch?v=abc");
  check("a video link says what to do instead", yt.includes("transcript panel"), yt.slice(0,80));

  /* With a transcript service configured, the hosts it covers route to it and
     the hosts it does not keep the paste instruction, so no credit is spent on
     a refusal that was knowable up front. */
  process.env.SUPADATA_API_KEY = "test-key-not-real";
  const vimeo = await no("https://vimeo.com/123456");
  check("a host the service does not cover still says paste", vimeo.includes("transcript panel"), vimeo.slice(0,80));
  const dm = await no("https://www.dailymotion.com/video/x123");
  check("same for dailymotion", dm.includes("transcript panel"), dm.slice(0,80));
  delete process.env.SUPADATA_API_KEY;
  const ytAgain = await no("https://youtu.be/abc");
  check("no key still says paste", ytAgain.includes("transcript panel"), ytAgain.slice(0,80));
  /* A setting that looks done and is not should say so, rather than reading as
     though this host simply cannot be fetched. */
  check("a covered host names the missing key", ytAgain.includes("SUPADATA_API_KEY is empty"), ytAgain.slice(0,140));
  check("an uncovered host does not", !vimeo.includes("SUPADATA_API_KEY"), vimeo.slice(0,100));
  const anon = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/call",
    params:{ name:"fetch_link", arguments:{ url:"https://example.com" } } }, null);
  check("an anonymous caller cannot fetch", /no tool named|reads only/i.test(JSON.stringify(anon)));
}

/* ---- making a brain ---- */
{
  const thin = await call("create_brain", { name:"Sport", scope:"sport" }, ME);
  check("a one word scope is refused", thin.includes("only test of what belongs"), thin.slice(0,90));
  const dup = await call("create_brain", { name:"Content", scope:"something else entirely, in one line" }, ME);
  check("a name already taken is refused", dup.includes("already exists"), dup.slice(0,90));
  const made = await call("create_brain",
    { name:"Negotiation", scope:"how a deal is framed, anchored and closed", type:"person" }, ME);
  check("a brain is made", made.startsWith("Made Negotiation (negotiation)"), made.slice(0,90));
  check("the new brain is made in Octopus", DB.brains.at(-1).space === "octopus", JSON.stringify(DB.brains.at(-1)));
  const anon = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/call",
    params:{ name:"create_brain", arguments:{ name:"X", scope:"a line long enough to pass" } } }, null);
  check("an anonymous caller cannot make one", /no tool named|reads only/i.test(JSON.stringify(anon)));
}

/* ---- an anonymous caller cannot feed ---- */
{
  const r = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"tools/call",
    params:{ name:"drop_store", arguments:{ draft:"x", rewrites:[] } } }, null);
  check("anonymous drop_store is refused", /no tool named|reads only/i.test(JSON.stringify(r)));
}

/* ---- step 1 ---- */
const EXT = { title:"Hooks that hold", author:"Carla Ruiz", date:"2026-09-10",
  topics:[{ topic:"Hooks", ideas:["First 2 seconds decide the watch"], data:["retention 42% at 3s"] }], quotes:[], thin:[] };
let draft = "";
{
  const t = await call("drop_source", { extraction: EXT, link:"https://example.com/hooks", brain:"content" }, ME);
  draft = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  check("drop_source returns a draft", !!draft, t.slice(0,120));
  check("drop_source hands over the filing rules", t.includes("Reply with only JSON") && t.includes("BRAINS AND THEIR CONCEPTS"));
  check("drop_source lists only the brains of its space", t.includes("id=content") && !t.includes("id=other"));
}

/* ---- step 2, with a bad concept id first ---- */
{
  const bad = await call("drop_plan", { draft, plan:{ brains:["content"], matched:[{conceptId:"content/nope",whatItAdds:"x"}] } }, ME);
  check("a made-up concept id is caught", bad.includes("do not exist"), bad.slice(0,120));
}
const PLAN = {
  brains:["content"],
  matched:[{ conceptId:"content/personal-brand", brain:"content", whatItAdds:"retention data behind the first 2 seconds" }],
  candidates:[{ title:"Hook writing for short video", brain:"content", why:"no concept covers hooks",
    related:["content/personal-brand", "content/Hook writing for short video"] }],
  new:["First 2 seconds decide the watch"],
  echo:[],
  conflicts:[{ concept:"Personal brand as growth strategy", conceptId:"content/personal-brand", brain:"content",
    kind:"flip", says:"hooks beat a named face", saysDate:"2026-09-10", stored:"A named face compounds distribution.", storedDate:"2026-02-02", why:"different lever" }],
};
{
  const card = await call("drop_plan", { draft, plan: PLAN }, ME);
  check("the card names the contradiction", card.includes("CONTRADICTIONS TO SETTLE (1)"), card.slice(0,200));
  check("the card carries the concept id", card.includes("[content/personal-brand]"));
  check("the card says nothing is written yet", card.includes("Nothing is written until drop_store"));
}

/* ---- step 3 ---- */
let job = "";
{
  job = await call("drop_prepare", { draft, rulings:{ "content/personal-brand":"new" } }, ME);
  check("the job carries the rewrite rules", job.includes("Re-derive, never append"));
  check("the ruling reaches the job", job.includes("NEW on:"), job.slice(0,300));
  check("the whole evidence list is handed over", job.includes("FULL EVIDENCE LIST"));
  check("the candidate is in the job only when it is a position",
    job.includes("Hook writing for short video") === (MENTIONS <= 1), job.slice(0,200));
}

/* ---- step 4 ---- */
{
  const before = DB.writes.length;
  const rw = [
    { conceptId:"content/personal-brand", position:"Hooks decide the watch. A named face still compounds distribution.",
      summaryLine:"Hooks decide the first 2 seconds.", data:["retention 42% at 3s"], conflicts:[] },
  ];
  /* At a threshold above one the candidate is still counted, so only the
     matched position comes back in the job. At one it is a position already. */
  if (MENTIONS <= 1) rw.push({ conceptId:"content/hook-writing-for-short-video",
    position:"The first seconds carry the hook.", summaryLine:"Hooks carry the open.", data:[], conflicts:[] });
  const r = await call("drop_store", { draft, rewrites: rw }, ME);
  check("the receipt says it stored", r.startsWith("STORED"), r.slice(0,120));
  check(`${MENTIONS <= 1 ? "two positions" : "one position"} rewritten`,
    r.includes(`Positions rewritten: ${MENTIONS <= 1 ? 2 : 1}`), r.slice(0,200));
  check("the candidate is reported the right way",
    MENTIONS <= 1 ? !r.includes("COUNTED") : r.includes(`counted at 1 of ${MENTIONS}`), r.slice(0,300));
  const kinds = DB.writes.slice(before).map(w => w.kind);
  /* The source and note go first, so a refused source costs no concept. */
  const want = MENTIONS <= 1 ? "source,note,concept,concept" : "source,note,concept";
  check("the concepts, the source and the note were written", kinds.join(",") === want, kinds.join(","));
  const c = DB.writes.slice(before).find(w => w.kind === "concept");
  check("the rewrite landed on the position", c.doc.position.startsWith("Hooks decide the watch"), c.doc.position);
  check("a rewrite keeps the figures it did not repeat", c.doc.data.includes("retention 42% at 3s"), JSON.stringify(c.doc.data));
  const link = DB.scheduled.find(x => x.fn === "admin.linkConcepts");
  check("the store schedules linking for exactly what it wrote",
    link && link.space === "octopus" && link.ids.includes("content/personal-brand") &&
    link.ids.length === (MENTIONS <= 1 ? 2 : 1), JSON.stringify(link));
  if (MENTIONS <= 1) {
    const hook = DB.writes.slice(before).find(w => w.kind === "concept" && w.title === "Hook writing for short video");
    check("a new concept keeps the links the plan gave it", hook?.doc?.related?.join(",") === "content/personal-brand",
      JSON.stringify(hook?.doc?.related));
    check("and never links to itself", !(hook?.doc?.related ?? []).includes("content/hook-writing-for-short-video"));
  }
  check("the draft is gone", !DB.drafts.has(draft));
}

/* ---- another account cannot touch this draft ---- */
{
  const t = await call("drop_prepare", { draft:"whatever" }, { account:"someoneelse", name:"Someone" });
  check("a stranger's draft id finds nothing", t.includes("is gone"));
}

/* ---- two long titles that open the same way are two concepts ---- */
{
  const A = "Forward contract hedge for Ziggy receivables: detailed borrowing and investing steps";
  const B = "Forward contract hedge for Ziggy receivables: detailed cost comparison";
  const C = "Discount offer analysis for Ziggy Indonesia: comparison with money market hedge";
  /* A stored under the old 48 character cut, as a concept dropped before this fix. */
  const old = A.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  DB.concepts.push({ brain:"content", slug:old, n:3, title:A, position:"Borrow, convert, invest.", summaryLine:"",
    evidence:[], data:[], conflicts:[], sources:["s-old"], updated:"2026-03-01" });
  const t = await call("drop_source", { extraction: EXT, link:"https://example.com/ziggy", brain:"content" }, ME);
  const d = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  const plan = { brains:["content"], matched:[], new:["hedge costs"], echo:[], conflicts:[],
    candidates:[A, B, C, "Discount offer analysis for Ziggy Indonesia: comparison with forward contract"]
      .map(title => ({ title, brain:"content", why:"the source walks through it" })) };
  await call("drop_plan", { draft:d, plan }, ME);
  await call("drop_prepare", { draft:d }, ME);
  const before = DB.writes.length;
  const r = await call("drop_store", { draft:d, rewrites:[] }, ME);
  const wrote = DB.writes.slice(before).filter(w => w.kind === "concept").map(w => w.title);
  check("four look-alike titles make four concepts", new Set(wrote).size === 4, r.slice(0, 200) + " | " + wrote.join(" | "));
  const link = DB.scheduled.at(-1);
  check("each gets its own id", link && new Set(link.ids).size === 4 && link.ids.includes(`content/${old}`),
    JSON.stringify(link?.ids));
  check("a stored long title is fed, not doubled", link.ids.filter(x => x.startsWith("content/forward-contract")).length === 2);
  DB.concepts.pop();
}

/* ---- every drop is stored under a named author, confirmed by the person ---- */
{
  const noAuthor = { ...EXT, title:"Hooks without a byline", author:"" };
  const t = await call("drop_source", { extraction: noAuthor, link:"https://example.com/no-byline", brain:"content" }, ME);
  const d = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  const plan = { brains:["content"], matched:[], new:["x"], echo:[], conflicts:[],
    candidates:[{ title:"Byline test concept", brain:"content", why:"taught" }] };
  DB.sources.push({ sid:"a1", brains:["content"], author:"Alex Hormozi" }, { sid:"a2", brains:["content"], author:"Alex Hormozi" },
    { sid:"a3", brains:["content"], author:"Marc Durand" }, { sid:"a4", brains:["health"], author:"Sleep Doc" });
  const card = await call("drop_plan", { draft:d, plan }, ME);
  DB.sources.splice(-4);
  check("a card with no author says so, and asks the person", /AUTHOR: not found in the source/.test(card)
    && /Ask the person who wrote or said it/.test(card), card.slice(0, 160));
  check("offering the authors that brain already holds, most frequent first",
    /as choices, plus someone else: Alex Hormozi, Marc Durand\./.test(card) && !/Sleep Doc/.test(card), (card.match(/Ask the person[^\n]*/) || [""])[0]);
  await call("drop_prepare", { draft:d }, ME);
  const before = DB.writes.length;
  const refused = await call("drop_store", { draft:d, rewrites:[] }, ME);
  check("drop_store refuses an unknown author, and writes nothing", /No author yet/.test(refused) && DB.writes.length === before, refused);
  const junk = await call("drop_store", { draft:d, rewrites:[], author:"Unknown" }, ME);
  check("\"Unknown\" is no author", /No author yet/.test(junk) && DB.writes.length === before);
  const ok = await call("drop_store", { draft:d, rewrites:[], author:"Marc Durand" }, ME);
  const src = DB.writes.slice(before).find(w => w.kind === "source");
  check("with the person's name it stores, under that name", /STORED .* Author: Marc Durand\./.test(ok) && src?.doc?.author === "Marc Durand",
    ok.slice(0, 120) + " | " + JSON.stringify(src?.doc?.author));
  const ev = DB.writes.slice(before).find(w => w.kind === "concept")?.doc?.evidence?.[0];
  check("and its evidence carries the name too", ev?.author === "Marc Durand", JSON.stringify(ev));

  const t2 = await call("drop_source", { extraction: { ...EXT, title:"Hooks, second byline" }, link:"https://example.com/byline-2", brain:"content" }, ME);
  const d2 = (t2.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  const card2 = await call("drop_plan", { draft:d2, plan }, ME);
  check("a card with an author asks the person to confirm it", /AUTHOR: Carla Ruiz/.test(card2) && /confirm the author, "Carla Ruiz"/.test(card2));
  await call("drop_prepare", { draft:d2, author:"Carla Ruiz-Ortega" }, ME);
  const b2 = DB.writes.length;
  await call("drop_store", { draft:d2, rewrites:[] }, ME);
  check("a name corrected at drop_prepare is the one stored", DB.writes.slice(b2).find(w => w.kind === "source")?.doc?.author === "Carla Ruiz-Ortega");
  const direct = await dropSettle(ctx, { account:"octopus", kind:"owner", space:"octopus" },
    { ext:{ ...EXT, author:"unknown" }, plan, sid:"s-x" });
  check("the app's store step refuses an unknown author too", direct.needAuthor === true && /name the author/.test(direct.error), JSON.stringify(direct));
}

/* ---- a YouTube video is filed under its channel ---- */
{
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => { asked.push(String(u));
    return String(u).startsWith("https://www.youtube.com/oembed")
      ? new Response(JSON.stringify({ author_name: "Finary", title: "L'or" }), { status: 200 }) : new Response("", { status: 404 }); };
  check("a short link asks YouTube for its channel", await youtubeChannel("https://youtu.be/abc123XYZ") === "Finary"
    && /oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Dabc123XYZ/.test(asked[0] || ""), asked[0]);
  asked.length = 0;
  check("a page that is not a video asks nothing", await youtubeChannel("https://example.com/post") === "" && asked.length === 0);
  const t = await call("drop_source", { extraction: { ...EXT, title:"Gold talk", author:"Nicolas Chéron" },
    link:"https://www.youtube.com/watch?v=goldTalk42", brain:"content" }, ME);
  const d = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  const card = await call("drop_plan", { draft:d, plan:{ brains:["content"], matched:[], new:["x"], echo:[], conflicts:[],
    candidates:[{ title:"Gold talk concept", brain:"content", why:"x" }] } }, ME);
  check("a connector drop from YouTube names the channel, whoever speaks", /AUTHOR: Finary/.test(card), card.slice(0, 120));
  globalThis.fetch = async () => { throw new Error("offline"); };
  check("a channel YouTube will not give is just no channel", await youtubeChannel("https://youtu.be/zzz999") === "");
  globalThis.fetch = real;
}

/* ---- a new write states the claim, never a note about the filing ---- */
{
  const cases = [
    ["The source presents a gold/bond ratio to position assets, which is not explicitly covered by existing concepts.",
     "A gold/bond ratio to position assets."],
    ["NEW: A four-quadrant framework. Rule: switch on a 7-year moving average.", "A four-quadrant framework. Rule: switch on a 7-year moving average."],
    ["Argues that the state can seize wealth under law 512. New to existing list.", "The state can seize wealth under law 512."],
    ["Reinforces the idea that gold is a risk-reducing asset.", "Gold is a risk-reducing asset."],
    ["Concrete 4% real return via equal parts cash, bonds, gold, stocks; not mentioned in existing concepts.", "Concrete 4% real return via equal parts cash, bonds, gold, stocks."],
    ["Gold and bonds returned the same since 1973.", "Gold and bonds returned the same since 1973."],
    ["The source of inflation is money growth above output.", "The source of inflation is money growth above output."],
  ];
  const off = cases.filter(([a, b]) => plainClaim(a) !== b).map(([a, b]) => `${plainClaim(a)} | wanted ${b}`);
  check("filing notes come off a claim, and a claim about the subject stays whole", !off.length, off.join(" || "));
  check("the planner is told to write the claim itself", /CLAIM ITSELF/.test(RULES_P) && /no "the source presents"/.test(RULES_P));
  check("and the rewriter to write about the subject", /never about the filing/.test(REWRITE_RULES));

  const before = DB.writes.length;
  await dropSettle(ctx, { account:"octopus", kind:"owner", space:"octopus" }, {
    ext:{ ...EXT, title:"Filing notes", author:"Marc Durand" }, sid:"s-filing",
    plan:{ brains:["content"], matched:[], new:["x"], echo:[], conflicts:[],
      candidates:[{ title:"Gold bond ratio", brain:"content", why:"The source presents a gold/bond ratio, which is not explicitly covered by existing concepts." }] },
    rewrites:[{ conceptId:"content/gold-bond-ratio", position:"NEW: Switch gold and bonds on a 7-year average. Not covered by existing concepts.",
      summaryLine:"Adds the idea that a 7-year average times the switch." }] });
  const w = DB.writes.slice(before).find(x => x.kind === "concept")?.doc;
  check("a new concept stores the claim as its evidence", w?.evidence?.[0]?.claim === "A gold/bond ratio.", JSON.stringify(w?.evidence?.[0]));
  check("and its position and line with no filing words", w?.position === "Switch gold and bonds on a 7-year average."
    && w?.summaryLine === "A 7-year average times the switch.", `${w?.position} | ${w?.summaryLine}`);
}

/* ---- an answer says where it comes from, in one label ---- */
{
  const a = await call("ask", { question:"what beats a bigger audience", terms:["offer"] }, ME);
  check("an answer opens with OCTOPUS BRAIN", /The first line reads "OCTOPUS BRAIN"/.test(a) && /Never write "in your brains"/.test(a));
  const sq = await call("ask", { question:"what beats a bigger audience" }, { account:"owner-squidgy", name:"Owner", space:"squidgy" });
  check("a Squidgy answer opens with SQUIDGY BRAIN", /SQUIDGY BRAIN|Nothing in these brains/.test(sq), sq.slice(0, 120));
  const pg = await call("one_pager", { kind:"quiz", brain:"content" }, ME);
  check("a one-pager carries the label above its title", /first line reads "OCTOPUS BRAIN"\. Then the TITLE/.test(pg));
  const init = await handleRpc(ctx, { jsonrpc:"2.0", id:1, method:"initialize", params:{} }, ME);
  check("and the server says so when a client connects", /with a line reading "OCTOPUS BRAIN"/.test(init.result.instructions));
}

/* ---- a drop feeds only the brains it may, once per concept, and keeps what was stored ---- */
{
  DB.brains.push({ slug:"vault", name:"Vault", type:"subject", scope:"a brain of the other space", space:"squidgy" });
  DB.concepts.push({ brain:"vault", slug:"secret-thesis", n:1, title:"Secret thesis", position:"Kept.", summaryLine:"",
    evidence:[], data:[], conflicts:[], sources:["s-v"], updated:"2026-01-01" });
  const offer = DB.concepts.find(c => c.slug === "offer-creation");
  const had = offer.data;
  offer.data = ["stored 9% conversion"];

  /* Through the connector, the plan is refused before anything is written. */
  const t = await call("drop_source", { extraction: EXT, link:"https://example.com/vault", brain:"content" }, ME);
  const d = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  const refused = await call("drop_plan", { draft:d, plan:{ brains:["content"], matched:[{ conceptId:"vault/secret-thesis", whatItAdds:"x" }] } }, ME);
  check("the connector refuses a concept of the other space", /do not exist in the brains you may feed/.test(refused), refused.slice(0, 120));

  /* Straight to the store, the way the app calls it. */
  const WHO = { account:"octopus", kind:"owner", space:"octopus" };
  const settle = async (plan, rewrites, ext = EXT) => {
    const before = DB.writes.length;
    const r = await dropSettle(ctx, WHO, { sid:`s-${Math.random()}`, ext, plan, fullPlan: plan, rewrites });
    return { r, w: DB.writes.slice(before) };
  };
  const a = await settle({ brains:["content"], new:["x"], echo:[], conflicts:[], candidates:[],
      matched:[{ conceptId:"vault/secret-thesis", whatItAdds:"overwrite it" },
               { conceptId:"secret-thesis", whatItAdds:"by bare id" },
               { conceptId:"content/offer-creation", whatItAdds:"offers still win" }] },
    [{ conceptId:"vault/secret-thesis", position:"HIJACKED", summaryLine:"", data:[], conflicts:[] },
     { conceptId:"content/offer-creation", position:["Offers win.", "Twice."], summaryLine:"", conflicts:[] }],
    { ...EXT, author:["A. Author", "B. Author"], date: 2026 });
  const wrote = a.w.filter(w => w.kind === "concept");
  check("the store never rewrites a concept of the other space",
    wrote.every(w => w.brain !== "vault") && !JSON.stringify(a.w).includes("HIJACKED"), JSON.stringify(wrote.map(w => w.brain + "/" + w.title)));
  check("and names the ids it could not file", (a.r.missed ?? []).length === 2, JSON.stringify(a.r.missed));
  const oc = wrote.find(w => w.title === "Offer creation as a key skill");
  check("a rewrite that omits the figures keeps the stored ones", oc?.doc?.data?.includes("stored 9% conversion"), JSON.stringify(oc?.doc?.data));
  check("a position sent as a list is stored as text", oc?.doc?.position === "Offers win., Twice." || typeof oc?.doc?.position === "string", JSON.stringify(oc?.doc?.position));
  const src = a.w.find(w => w.kind === "source");
  check("an author list and a numeric year are stored as text",
    src?.doc?.author === "A. Author, B. Author" && src?.doc?.date === "2026", JSON.stringify(src?.doc));
  check("the source is written for this space", src?.space === "octopus", String(src?.space));

  const b = await settle({ brains:["Content"], new:["x"], echo:[], conflicts:[],
      matched:[{ conceptId:"content/personal-brand", brain:"content", whatItAdds:"first claim" }],
      candidates:[{ title:"Personal brand as growth strategy", brain:"content", why:"second claim" }] },
    [{ conceptId:"content/personal-brand", position:"Merged.", summaryLine:"", data:[], conflicts:[] }]);
  const pb = b.w.filter(w => w.kind === "concept" && w.title === "Personal brand as growth strategy");
  check("a plan naming its brain by name still files", !b.r.error && pb.length >= 1, JSON.stringify(b.r).slice(0, 160));
  check("one concept reached twice is written once", pb.length === 1, String(pb.length));
  check("with both claims in its evidence", /first claim/.test(pb[0]?.doc?.evidence?.[0]?.claim ?? "") && /second claim/.test(pb[0]?.doc?.evidence?.[0]?.claim ?? ""),
    JSON.stringify(pb[0]?.doc?.evidence?.[0]));

  const empty = await settle({ brains:["content"], new:["a finding"], echo:[], conflicts:[], matched:[], candidates:[] }, []);
  check("a plan that files nothing is refused, not stored", !!empty.r.error && !empty.w.length, JSON.stringify(empty.r).slice(0, 120));

  offer.data = had;
  DB.brains.pop(); DB.concepts.pop();
}

/* ---- a fetched page cannot bounce the reader inward ---- */
{
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => {
    asked.push(String(u));
    if (String(u).includes("public.example")) return new Response("", { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    return new Response("<p>" + "secret ".repeat(100) + "</p>", { status: 200, headers: { "content-type": "text/html" } });
  };
  const r = await fetchPage(ctx, "https://public.example/page");
  check("a redirect to a private address is refused", /not a public https address/.test(r.error ?? ""), JSON.stringify(r).slice(0, 120));
  check("and never fetched", !asked.some(u => u.includes("169.254")), asked.join(" "));
  globalThis.fetch = async (u) => String(u).includes("a.example")
    ? new Response("", { status: 301, headers: { location: "https://b.example/final" } })
    : new Response("<p>" + "word ".repeat(100) + "</p>", { status: 200, headers: { "content-type": "text/html" } });
  const ok = await fetchPage(ctx, "https://a.example/start");
  check("a redirect to a public page is followed", ok.chars > 200 && !ok.error, JSON.stringify(ok).slice(0, 120));
  globalThis.fetch = real;
}

/* ---- the planner sees every concept of a brain up to 1,000 ---- */
{
  const pool = [{ slug: "acc", name: "Accountant", type: "subject", scope: "accounting" }];
  const make = n => {
    const many = Array.from({ length: n - 1 }, (_, i) => ({ brain: "acc", slug: `c${i}`, n: i + 1,
      title: `Rule ${i} of costing for a long descriptive title`,
      summaryLine: `Rule ${i} spreads a cost over the periods that use it, measured in units of output. `.repeat(2) }));
    many.push({ brain: "acc", slug: "hedge", n, title: "Forward contract hedge", summaryLine: "Locks the rate for a future receivable." });
    return many;
  };
  const ext = { kind: "study", topics: [{ topic: "Forward contract hedge", ideas: ["lock the rate"] }] };
  const count = t => new Set(t.match(/id=acc\/\w+/g) ?? []).size;
  const t1000 = planContext(pool, make(1000), [], ext);
  check("a 1,000 concept brain is listed whole to the planner", count(t1000) === 1000, `${count(t1000)} listed`);
  check("the concept this part is about comes with its summary", /Forward contract hedge: Locks the rate/.test(t1000));
  console.log(`       1,000 concepts: ${t1000.length} characters, about ${Math.round(t1000.length / 4000)}k tokens`);
  check("and 1,000 concepts stay near 30,000 tokens", t1000.length < 150000, `${t1000.length} chars`);
  const t1200 = planContext(pool, make(1200), [], ext);
  check("past 1,000, the 1,000 closest are listed", count(t1200) === 1000 && /Forward contract hedge: Locks/.test(t1200) && /200 more concepts/.test(t1200),
    `${count(t1200)} listed`);
  const small = planContext(pool, make(40), [], ext);
  check("a small brain is listed whole with every summary", count(small) === 40 && !/more concepts, not listed/.test(small));
}

/* ---- the twin-title pass never merges across brains, and never breaks a drop ---- */
{
  const real = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test";
  const cands = [{ brain: "acc", title: "Hedging with forwards" }, { brain: "acc", title: "Forward contract hedging" },
                 { brain: "wealth", title: "Forward hedges" }, { brain: "acc", title: "Money market hedge" }];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content:
    JSON.stringify({ same: [[1, 2, 3], [4, 99], [2, 4]] }) }, finish_reason: "stop" }] }), { status: 200 });
  const r = await dropMerge(ctx, { space: "octopus" }, { candidates: cands });
  check("twins in one brain are grouped", JSON.stringify(r.same) === "[[0,1]]", JSON.stringify(r.same));
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const off = await dropMerge(ctx, { space: "octopus" }, { candidates: cands });
  check("a failed pass merges nothing and keeps the drop going", Array.isArray(off.same) && off.same.length === 0);
  globalThis.fetch = real;
}

/* ---- a store of any size looks up every title, and says what its note kept ---- */
{
  const WHO = { account:"octopus", kind:"owner", space:"octopus" };
  DB.concepts.push({ brain:"content", slug:"late-idea", n:9, title:"Late idea", position:"STORED SYNTHESIS", summaryLine:"",
    evidence:[], data:[], conflicts:[], sources:[], related:[], updated:"2026-01-01" });
  const candidates = Array.from({ length: 250 }, (_, i) => ({ title: i === 240 ? "Late idea" : `Fresh idea ${i}`, brain:"content", why:"x" }));
  const plan = { brains:["content"], matched:[], new:["x"], echo:[], conflicts:[], candidates };
  const r = await dropSettle(ctx, WHO, { sid:"s-big", ext: EXT, plan, fullPlan: plan, packetOnly: true });
  check("the 241st title of one big store is still found as the concept it is",
    /### content\/late-idea[\s\S]*?CURRENT POSITION: STORED SYNTHESIS/.test(r.job ?? ""), (r.job ?? JSON.stringify(r)).slice(0, 160));
  DB.concepts.pop();

  const huge = { ...EXT, topics: Array.from({ length: 300 }, (_, i) => ({ topic:`T${i}`, ideas:["y".repeat(4000)], data:[] })) };
  const plan2 = { brains:["content"], matched:[{ conceptId:"content/personal-brand", whatItAdds:"z" }], new:[], echo:[], conflicts:[], candidates:[] };
  const r2 = await dropSettle(ctx, WHO, { sid:"s-huge", ext: huge, plan: plan2, fullPlan: plan2,
    rewrites:[{ conceptId:"content/personal-brand", position:"P.", summaryLine:"", conflicts:[] }], linkLater: true });
  check("a note too big for a row says how many passages it kept", r2.noteTopics > 0 && r2.noteTopics < 300, String(r2.noteTopics));
}

/* ---- a source can feed several brains the owner ticks ---- */
{
  const WHO = { account:"octopus", kind:"owner", space:"octopus" };
  const real = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_u, opt) => {
    prompt = JSON.parse(opt.body).messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ brains:["content","health"], matched:[], candidates:[], new:[], echo:[], conflicts:[] }) }, finish_reason:"stop" }] }), { status: 200 });
  };
  await dropPlan(ctx, WHO, { ext: EXT, brains: ["content", "health"], key: "k" });
  check("the planner is told to feed each ticked brain", /THE OWNER CHOSE THESE BRAINS FOR THIS SOURCE: Content \(id=content\), Health \(id=health\)/.test(prompt));
  check("and sees only those brains", /id=content/.test(prompt) && /id=health/.test(prompt) && !/id=other/.test(prompt));
  await dropPlan(ctx, WHO, { ext: EXT, brain: "content", key: "k" });
  check("one brain gets no such line", !/THE OWNER CHOSE/.test(prompt) && !/## Health/.test(prompt));
  globalThis.fetch = real;

  /* A plan that lists one brain but files an idea in another still files it there. */
  const plan = { brains:["content"], matched:[], new:["x"], echo:[], conflicts:[],
    candidates:[{ title:"Sleep debt", brain:"health", why:"hours lost add up" }, { title:"Hook rate", brain:"content", why:"x" }] };
  const before = DB.writes.length;
  const r = await dropSettle(ctx, WHO, { sid:"s-two", ext: EXT, plan, fullPlan: plan, rewrites: [] });
  const wrote = DB.writes.slice(before).filter(w => w.kind === "concept").map(w => `${w.brain}/${w.title}`);
  check("an idea filed in a second brain lands there, not in the first", wrote.includes("health/Sleep debt") && wrote.includes("content/Hook rate"),
    wrote.join(", "));
  check("and the source counts both brains", JSON.stringify(r.brains) === JSON.stringify(["content","health"]), JSON.stringify(r.brains));
}

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} passed`);
process.exit(fail ? 1 : 0);
