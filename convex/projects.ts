/**
 * Projects: a chat that reads the folders you pick, and one page it keeps up
 * to date.
 *
 * A project names its folders, carries instructions in its owner's words,
 * and may hold an HTML template. Its page is built by the model from those
 * folders, in the template's layout when there is one, and only when its
 * owner presses Build: talking in its chat never rebuilds it. An answer added
 * to the page waits for the next Build. Each build is a version: the newest
 * 10 are kept. When a source lands in one of its folders the page is marked
 * out of date, and a project its owner set to rebuild does so on the
 * deployment's key. A workspace on its own key never rebuilds in the
 * background, since its key never reaches the server between calls.
 *
 * A personal folder never joins a project, and the demo has none.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ask, readSpace, SPACES, PROJECT_MODEL } from "./lib";
import { loadSpace } from "./space";
import { planDossier, writeDossier, idOf, OPEN_READ } from "./words";
import { routeQuestion } from "./route";

export const PROJECT_MAX = 20;
export const NAME_MAX = 60;
export const INSTR_MAX = 2000;
/* A template is read whole by every build, so it stays under 60 KB. */
export const TEMPLATE_MAX = 60_000;
export const VERSIONS_KEPT = 10;
const TURNS_KEPT = 40;
/* Answers waiting for the next Build. */
const PENDING_MAX = 10;
/* A rebuild started less than this ago is not started again by the next drop. */
const BUILD_GAP = 5 * 60 * 1000;

/* ---------------- the rows ---------------- */

async function projectIn(ctx: any, space: string, id: string) {
  const nid = typeof id === "string" ? ctx.db.normalizeId("projects", id) : null;
  const p = nid ? await ctx.db.get(nid) : null;
  return p && p.space === space ? p : null;
}
async function versionsOf(ctx: any, project: any) {
  return await ctx.db.query("pages").withIndex("by_project_v", (q: any) => q.eq("project", project)).order("desc").collect();
}
const head = (p: any, top?: any) => ({
  id: String(p._id), name: p.name, brains: p.brains, auto: p.auto, stale: !!p.stale, waiting: (p.pending ?? []).length,
  templateName: p.template ? (p.templateName || "template.html") : null,
  version: top?.v ?? 0, updated: p.updated, turns: (p.turns ?? []).length,
});

/** The projects of a space, newest first. */
export const list = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space);
    const rows = await ctx.db.query("projects").withIndex("by_space", q => q.eq("space", space)).collect();
    const out = [];
    for (const p of rows.sort((x, y) => y.updated - x.updated)) {
      const top = await ctx.db.query("pages").withIndex("by_project_v", q => q.eq("project", p._id)).order("desc").first();
      out.push(head(p, top));
    }
    return out;
  },
});

/** One project whole: its settings, its chat, and its versions by number. */
export const get = internalQuery({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return null;
    const vs = await versionsOf(ctx, p._id);
    return { ...head(p, vs[0]), instructions: p.instructions, template: p.template ?? null, turns: p.turns ?? [], pending: p.pending ?? [],
      versions: vs.map((x: any) => ({ v: x.v, why: x.why, at: x.at })), page: vs[0]?.html ?? null };
  },
});

/** One version of a project's page. */
export const page = internalQuery({
  args: { space: v.string(), id: v.string(), v: v.number() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return null;
    const row = await ctx.db.query("pages").withIndex("by_project_v", q => q.eq("project", p._id).eq("v", a.v)).unique();
    return row ? { v: row.v, html: row.html, why: row.why, at: row.at } : null;
  },
});

/** A new project, or new settings for one. The route checks the folders first. */
export const save = internalMutation({
  args: { space: v.string(), id: v.optional(v.string()), name: v.string(), brains: v.array(v.string()), instructions: v.string(),
          template: v.optional(v.union(v.string(), v.null())), templateName: v.optional(v.string()), auto: v.boolean() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now();
    const name = a.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    if (!name) return { error: "a project needs a name" };
    if (!a.brains.length) return { error: "pick at least one folder for it to read" };
    const fields: any = { name, brains: a.brains.slice(0, 40), instructions: a.instructions.trim().slice(0, INSTR_MAX), auto: a.auto, updated: now };
    /* A template given replaces the one held; null removes it; absent keeps it. */
    if (a.template === null) { fields.template = undefined; fields.templateName = undefined; }
    else if (typeof a.template === "string") {
      if (a.template.length > TEMPLATE_MAX) return { error: `a template holds ${Math.round(TEMPLATE_MAX / 1000)} KB at most` };
      fields.template = a.template; fields.templateName = (a.templateName || "template.html").slice(0, 80);
    }
    if (a.id) {
      const p = await projectIn(ctx, space, a.id);
      if (!p) return { error: "that project is gone" };
      await ctx.db.patch(p._id, fields);
      return { id: String(p._id) };
    }
    const n = (await ctx.db.query("projects").withIndex("by_space", q => q.eq("space", space)).collect()).length;
    if (n >= PROJECT_MAX) return { error: `${PROJECT_MAX} projects is the most a workspace holds. Delete one first.` };
    const id = await ctx.db.insert("projects", { space, ...fields, turns: [], created: now });
    return { id: String(id) };
  },
});

/** A project and every version of its page. */
export const remove = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return { error: "that project is gone" };
    for (const x of await versionsOf(ctx, p._id)) await ctx.db.delete(x._id);
    await ctx.db.delete(p._id);
    return { ok: true };
  },
});

/** A question and its answer, added to the project's chat. */
export const turn = internalMutation({
  args: { space: v.string(), id: v.string(), turn: v.any() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return { error: "that project is gone" };
    await ctx.db.patch(p._id, { turns: [...(p.turns ?? []), a.turn].slice(-TURNS_KEPT), updated: Date.now() });
    return { ok: true };
  },
});

/**
 * An answer from the chat, put aside for the next Build, or taken back. Ten
 * wait at most; the page changes only when Build is pressed.
 */
export const queue = internalMutation({
  args: { space: v.string(), id: v.string(), q: v.string(), a: v.string(), remove: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return { error: "that project is gone" };
    const item = { q: a.q.slice(0, 2000), a: a.a.slice(0, 6000) };
    const rest = (p.pending ?? []).filter((x: any) => !(x.q === item.q && x.a === item.a));
    if (a.remove) { await ctx.db.patch(p._id, { pending: rest }); return { waiting: rest.length }; }
    if (rest.length >= PENDING_MAX) return { error: `${PENDING_MAX} answers already wait for the next Build. Build first.` };
    const next = [...rest, { ...item, at: Date.now() }];
    await ctx.db.patch(p._id, { pending: next });
    return { waiting: next.length };
  },
});

/** The project's chat, cleared. Its page stays. */
export const clear = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return { error: "that project is gone" };
    await ctx.db.patch(p._id, { turns: [] });
    return { ok: true };
  },
});

/** A new version of the page. Past the newest 10, the oldest go. */
export const addVersion = internalMutation({
  args: { space: v.string(), id: v.string(), html: v.string(), why: v.string(), took: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (!p) return { error: "that project is gone" };
    const vs = await versionsOf(ctx, p._id);
    const n = (vs[0]?.v ?? 0) + 1, at = Date.now();
    await ctx.db.insert("pages", { project: p._id, v: n, html: a.html, why: a.why.slice(0, 200), at });
    for (const old of vs.slice(VERSIONS_KEPT - 1)) await ctx.db.delete(old._id);
    /* The answers this build read are on the page now. One added while it ran waits for the next. */
    await ctx.db.patch(p._id, { stale: false, building: undefined, pending: (p.pending ?? []).slice(a.took ?? 0), updated: at });
    return { v: n, at };
  },
});

/**
 * A source landed in these folders: every project reading one is out of
 * date. With claim, returns the ones set to rebuild that are not already
 * building, and marks them building.
 */
export const markStale = internalMutation({
  args: { space: v.string(), brains: v.array(v.string()), claim: v.boolean() },
  handler: async (ctx, a) => {
    const space = readSpace(a.space), now = Date.now(), fed = new Set(a.brains), go: string[] = [];
    for (const p of await ctx.db.query("projects").withIndex("by_space", q => q.eq("space", space)).collect()) {
      if (!p.brains.some((b: string) => fed.has(b))) continue;
      const due = a.claim && p.auto && !(p.building && now - p.building < BUILD_GAP);
      await ctx.db.patch(p._id, { stale: true, ...(due ? { building: now } : {}) });
      if (due) go.push(String(p._id));
    }
    return go;
  },
});

/** A background build that failed lets the next drop try again. */
export const buildFailed = internalMutation({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const p = await projectIn(ctx, readSpace(a.space), a.id);
    if (p) await ctx.db.patch(p._id, { building: undefined });
  },
});

/* ---------------- the page ---------------- */

const PAGE_RULES = `HOW TO WRITE THE PAGE
- Return ONE complete HTML document, from <!doctype html> to </html>. Nothing before it, nothing after it, no code fences.
- Everything inline: styles in one <style> block. No external stylesheet, font or image, except Google Fonts. Pictures are inline SVG.
- No script and no form: scripts never run where the page is shown. Use <details> for anything that folds. A template's scripts are left out.
- Every claim comes from the stored knowledge below. Never invent a figure, a quote, an author or a date.
- Name the author and the date of what you state, the way the evidence gives them.
- Numbers, dates and findings carry the page. Data over adjectives.
- English unless the instructions ask for another language. No em-dashes. Under 30 words per sentence. No weasel words. Simple wording.
- It reads well on a phone as well as a laptop.`;

/** Model output to a page: the document alone, fences and chatter cut. */
export function cleanHtml(text: string) {
  let t = String(text ?? "").trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  /* A page never moves its reader somewhere else on its own. */
  t = t.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf("</html>");
  if (end > 0) t = t.slice(0, end + 7);
  return t;
}

/**
 * A new version of a project's page, built from its folders, its
 * instructions, its template and the version before it. A note is something
 * to add or change, from the chat.
 */
export async function buildPage(ctx: any, space: string, id: string,
                                opts: { note?: string; why: string; key?: string; model?: string; timeout?: number }) {
  const p = await ctx.runQuery(internal.projects.get, { space, id });
  if (!p) throw new Error("that project is gone");
  /* Read again at every build: a folder unshared since, or made personal, drops out. */
  const every = await loadSpace(ctx, space);
  const pool = every.brains.filter((b: any) => p.brains.includes(b.slug) && b.type !== "personal");
  if (!pool.length) throw new Error("none of this project's folders is here any more. Pick others in its settings.");
  const cards = every.cards.filter((c: any) => pool.some((b: any) => b.slug === c.brain));
  if (!cards.length) throw new Error("its folders hold nothing yet. Drop a source into one of them first.");

  /* What waits for this Build: answers added from the chat, and any note. */
  const waiting = (p.pending ?? []).map((x: any, i: number) => `${i + 1}. The owner asked: ${x.q}\nThe answer, from the same folders: ${x.a}`).join("\n\n");
  const note = [waiting && `ADD THESE ANSWERS FROM THE CHAT, each where it fits, under a clear heading:\n${waiting}`, opts.note].filter(Boolean).join("\n\n");
  const q = `${p.name}. ${p.instructions}${note ? ` ${note}` : ""}`.slice(0, 3000);
  const t0 = Date.now(), limit = opts.timeout ?? 170000;
  const routed = await routeQuestion(pool, cards, q, [], opts.key, opts.model);
  const plan = planDossier(pool, cards, q, [], routed);
  /* A page covers its folders: after what the instructions point at, the
     fullest concepts fill the rest of the budget. */
  const rest = [...cards].sort((x: any, y: any) => (y.src || 0) - (x.src || 0)).filter((c: any) => !plan.lead.includes(c));
  plan.lead = [...plan.lead, ...rest];
  const whole = await ctx.runQuery(internal.store.conceptsByIds, { space, ids: plan.lead.slice(0, OPEN_READ).map(idOf) });
  const { dossier } = writeDossier(pool, plan, new Map(whole.map((c: any) => [idOf(c), c])));
  const sources = every.sources.filter((s: any) => (s.brains ?? []).some((b: string) => pool.some((x: any) => x.slug === b)));
  const before = String(p.page ?? "").slice(0, 60_000);
  const today = new Date().toISOString().slice(0, 10);

  const { text } = await ask([
    { role: "system", content: "You build and keep up to date one HTML page from the user's own knowledge base. You return the HTML document and nothing else." },
    { role: "user", content:
`PROJECT: ${p.name}
TODAY: ${today}
FOLDERS IT READS: ${pool.map((b: any) => `${b.name} (${b.type})`).join(", ")}
SOURCES IN THEM: ${sources.length}

INSTRUCTIONS FROM THE OWNER (what the page keeps up to date, and how)
${p.instructions || "Keep one clear page on what these folders hold: the main positions, who holds them, and what changed most recently."}

${p.template ? `TEMPLATE (the owner's layout: keep its structure, styles and scripts, and fill its content from the stored knowledge. Follow its comments and placeholders.)
${p.template}
` : `NO TEMPLATE: design a clean page. A title, one line on what it covers, then sections that follow the instructions. A footer: "Built from ${pool.length} folder${pool.length === 1 ? "" : "s"} on ${today}".`}

${before ? `THE PAGE AS IT STANDS (keep what it holds unless newer evidence or the note changes it; add what is new)
${before}
` : ""}
${note ? `WHAT TO ADD OR CHANGE NOW
${note.slice(0, 40000)}
` : ""}
${PAGE_RULES}

STORED KNOWLEDGE
${dossier}` },
  ], { maxTokens: 14000, key: opts.key, model: opts.model, timeout: Math.max(60000, limit - (Date.now() - t0)) });

  const html = cleanHtml(text);
  if (!/<html[\s>]/i.test(html) || html.length < 200) throw new Error("the page did not come back whole. Build it again.");
  if (html.length > 400_000) throw new Error("the page came back over 400 KB. Ask for a shorter one in the instructions.");
  const r = await ctx.runMutation(internal.projects.addVersion, { space, id, html, why: opts.why, took: (p.pending ?? []).length });
  if (r.error) throw new Error(r.error);
  return { v: r.v, at: r.at, html };
}

/** A rebuild after a source landed, on the deployment's key. */
export const rebuild = internalAction({
  args: { space: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    try {
      /* The project model the workspace picked in Settings, or the default. */
      const picked = await ctx.runQuery(internal.store.modelsOf, { space: a.space });
      await buildPage(ctx, a.space, a.id, { why: "A source landed", timeout: 300000, model: picked?.project || PROJECT_MODEL });
    }
    catch (e: any) {
      console.log(`project rebuild failed: ${String(e?.message ?? e).slice(0, 200)}`);
      await ctx.runMutation(internal.projects.buildFailed, { space: a.space, id: a.id });
    }
  },
});

/**
 * A drop wrote into these folders. Projects reading one go out of date, and
 * the ones set to rebuild start, on the deployment's key only: a workspace on
 * its own key and the demo mark them and stop there.
 */
export async function sourceLanded(ctx: any, who: any, brains: string[], opts: { rebuild: boolean }) {
  if (!brains.length || who.demo) return;
  try {
    /* Checked against the workspace itself too, whoever the caller says it is. */
    const ws = (SPACES as readonly string[]).includes(who.space) ? null : await ctx.runQuery(internal.store.workspaceOf, { slug: who.space });
    const ownKey = who.byok || ws?.kind === "byok" || ws?.kind === "demo";
    const claim = opts.rebuild && !ownKey && !!ctx.scheduler;
    const due: string[] = await ctx.runMutation(internal.projects.markStale, { space: who.space, brains: [...new Set(brains)].slice(0, 100), claim });
    for (const id of due) await ctx.scheduler.runAfter(0, internal.projects.rebuild, { space: who.space, id });
  } catch { /* a project left unmarked never stops a drop */ }
}
