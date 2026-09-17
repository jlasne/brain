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
for (const f of ["mcp.ts", "drop.ts", "lib.ts"]) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"),
  "export const internal = new Proxy({}, { get: (_t, m) => " +
  "new Proxy({}, { get: (_t2, f) => `${String(m)}.${String(f)}` }) });\n");
await esbuild.build({ entryPoints: [join(dir, "mcp.ts")], bundle: true, format: "esm",
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const { handleRpc } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

const DB = {
  brains: [
    { slug:"content", name:"Content", type:"subject", scope:"How a brand publishes content and turns attention into buyers", owner:"octopus" },
    { slug:"health",  name:"Health",  type:"subject", scope:"sleep, recovery and training load", owner:"octopus" },
    { slug:"other",   name:"Other",   type:"subject", scope:"someone else's brain", owner:"someoneelse" },
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
};

const ctx = {
  runQuery: async (fn, a) => {
    if (fn === "store.everything") return { brains: DB.brains, concepts: DB.concepts, sources: DB.sources };
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
    if (fn === "store.bumpCandidate") {
      const k = a.brain + "/" + a.title;
      const notes = Array.from(new Set([...(DB.candidates.get(k) ?? []), a.sid]));
      DB.candidates.set(k, notes);
      return notes.length >= 3 ? { promoted:true, notes } : { promoted:false, notes };
    }
    if (fn === "store.createBrain") {
      const sl = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (DB.brains.some(b => b.slug === sl)) throw new Error("a brain with that name exists");
      DB.brains.push({ slug: sl, name: a.name, type: a.type, scope: a.scope, owner: a.owner,
                       visibility: a.visibility });
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
  check("anonymous sees 6 read tools", an.length === 6 && !an.includes("drop_store"), an.join(","));
  check("signed sees 12 tools", sn.length === 12 && sn.includes("drop_store"), sn.join(","));
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
  check("no key means the old behaviour", ytAgain.includes("transcript panel"), ytAgain.slice(0,80));
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
  check("the new brain belongs to the caller", DB.brains.at(-1).owner === "octopus");
  check("the new brain is closed by default", DB.brains.at(-1).visibility === "closed");
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
const EXT = { title:"Hooks that hold", author:"C", date:"2026-09-10",
  topics:[{ topic:"Hooks", ideas:["First 2 seconds decide the watch"], data:["retention 42% at 3s"] }], quotes:[], thin:[] };
let draft = "";
{
  const t = await call("drop_source", { extraction: EXT, link:"https://example.com/hooks", brain:"content" }, ME);
  draft = (t.match(/DRAFT (\w+)/) ?? [])[1] ?? "";
  check("drop_source returns a draft", !!draft, t.slice(0,120));
  check("drop_source hands over the filing rules", t.includes("Reply with only JSON") && t.includes("BRAINS AND THEIR CONCEPTS"));
  check("drop_source lists only feedable brains", t.includes("id=content") && !t.includes("id=other"));
}

/* ---- step 2, with a bad concept id first ---- */
{
  const bad = await call("drop_plan", { draft, plan:{ brains:["content"], matched:[{conceptId:"content/nope",whatItAdds:"x"}] } }, ME);
  check("a made-up concept id is caught", bad.includes("do not exist"), bad.slice(0,120));
}
const PLAN = {
  brains:["content"],
  matched:[{ conceptId:"content/personal-brand", brain:"content", whatItAdds:"retention data behind the first 2 seconds" }],
  candidates:[{ title:"Hook writing for short video", brain:"content", why:"no concept covers hooks" }],
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
  check("the counted candidate is not in the job", !job.includes("Hook writing for short video"));
}

/* ---- step 4 ---- */
{
  const before = DB.writes.length;
  const r = await call("drop_store", { draft, rewrites:[
    { conceptId:"content/personal-brand", position:"Hooks decide the watch. A named face still compounds distribution.",
      summaryLine:"Hooks decide the first 2 seconds.", data:["retention 42% at 3s"], conflicts:[] } ] }, ME);
  check("the receipt says it stored", r.startsWith("STORED"), r.slice(0,120));
  check("one position was rewritten", r.includes("Positions rewritten: 1"), r.slice(0,200));
  check("the counted candidate is reported", r.includes("counted at 1 of 3"), r.slice(0,300));
  const kinds = DB.writes.slice(before).map(w => w.kind);
  check("a concept, a source and a note were written", kinds.join(",") === "concept,source,note", kinds.join(","));
  const c = DB.writes.slice(before).find(w => w.kind === "concept");
  check("the rewrite landed on the position", c.doc.position.startsWith("Hooks decide the watch"), c.doc.position);
  check("the draft is gone", !DB.drafts.has(draft));
}

/* ---- another account cannot touch this draft ---- */
{
  const t = await call("drop_prepare", { draft:"whatever" }, { account:"someoneelse", name:"Someone" });
  check("a stranger's draft id finds nothing", t.includes("is gone"));
}

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} passed`);
process.exit(fail ? 1 : 0);
