/**
 * Every route the app calls. Two rules hold here and nowhere else can enforce them:
 * the OpenRouter key never leaves this file's process, and no route touches a brain
 * or a model before gate() passes.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ask, json, cors, sha256, slug, randomHex, isOpen,
  readSpace, SPACE_NAME, HOME, spaceName, slugOfName, SPACE_RE, SPACES,
  MODEL, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS, CHUNK,
  canDrop,
} from "./lib";
import type { Who } from "./lib";
import { handleRpc, versionOk, PROTOCOLS, RATE_MAX, RATE_WINDOW_MS } from "./mcp";
import { dropCheck, dropRead, dropPlan, dropSettle, dropMerge, fetchPage } from "./drop";
import { DOC_STYLE, DOC_BODY } from "./doc";
import { assemble, fromModel, asText, mail, looksLikeMail, pageIds, hasBody, translatePage, langOf, DOC_TYPES } from "./onepager";
import type { DocType } from "./onepager";
import { planDossier, writeDossier, idOf, OPEN_READ, linkId } from "./words";
import { routeQuestion } from "./route";
import { loadSpace, withoutPersonal } from "./space";
import { remember, REPLY_RULES, MAX_CHARS, calledBrains } from "./personal";
import { listConflicts, settleConflict } from "./conflicts";
import { healthOf } from "./health";

const router = httpRouter();

/* ---------- the gate ---------- */

/**
 * Who is calling, and on whose key.
 *
 *   owner   a passphrase opened this workspace.
 *   demo    a visitor in the demo workspace: no passphrase, a daily
 *           allowance, the default model, and nothing that edits the brains'
 *           shape or sends mail.
 *   byok    a workspace a visitor made: every model call runs on the key
 *           their browser sends with it. It is used for that call and never
 *           written, logged or passed to a query or mutation.
 */
type Caller = Who & { demo: boolean; byok: boolean; key?: string; visitor: string | null; wsName: string };
const KEY_RE = /^sk-or-[A-Za-z0-9_-]{20,200}$/;
const owners = SPACES as readonly string[];

async function gate(ctx: any, body: any, opts: { ownerOnly?: boolean } = {}): Promise<Caller> {
  const who = body?.token
    ? await ctx.runQuery(internal.store.checkSession, { token: body.token })
    : null;
  /* A passphrase session, or a demo visitor. A session left from the member
     accounts and guest keys that were removed reads as locked. */
  if (!who || !["owner", "demo"].includes(who.kind ?? "owner")) throw new Response("locked", { status: 401 });
  const demo = who.kind === "demo";
  if (demo && opts.ownerOnly) throw new Error("the demo lets you ask, drop and explore. Make your own workspace to do this.");
  const ws = owners.includes(who.space) ? null : await ctx.runQuery(internal.store.workspaceOf, { slug: who.space });
  const byok = ws?.kind === "byok";
  const k = String(body?.key ?? "").trim();
  return { ...who, kind: "owner", demo, byok, visitor: demo ? who.visitor : null, wsName: ws?.name ?? spaceName(who.space),
    key: byok ? (KEY_RE.test(k) ? k : undefined) : ws?.kind === "demo" ? (process.env.DEMO_OPENROUTER_API_KEY || undefined) : undefined };
}

/** The key a model call runs on. A workspace on its own key never falls back to the owner's. */
function keyFor(who: Caller): string | undefined {
  if (who.byok && !who.key) throw new Error("this workspace runs on your own OpenRouter key. Add it in Settings, then try again.");
  return who.key;
}

/** The model: the default for a demo visitor, the one picked otherwise. */
const modelFor = (who: Caller, b: any) => who.demo ? undefined : modelName(b);

/**
 * What the demo may spend, shared by every visitor, over 30 days: 30 drops
 * and 300 questions. A drop counts once, when it starts; a question, a
 * one-pager the model writes and a settled conflict each count as one.
 * The steps inside a drop are capped too, so no call can go around the
 * drop count.
 */
const MONTH = 30 * 24 * 60 * 60 * 1000;
const DEMO_DROPS = Number(process.env.DEMO_MONTHLY_DROPS || 30);
const DEMO_ASKS = Number(process.env.DEMO_MONTHLY_ASKS || 300);
async function demoCount(ctx: any, who: Caller, what: "drop" | "ask" | "step") {
  if (!who.demo) return;
  const max = what === "drop" ? DEMO_DROPS : what === "ask" ? DEMO_ASKS : DEMO_DROPS * 60;
  const r = await ctx.runMutation(internal.store.mcpRate, { who: `demo:${what}s`, max, windowMs: MONTH });
  if (r.allowed) return;
  const back = Math.max(1, Math.ceil((r.retryAfter ?? 0) / 86400));
  throw new Error(what === "ask"
    ? `the demo has answered its ${DEMO_ASKS} questions for this month. More in ${back} day${back === 1 ? "" : "s"}, or make your own workspace to keep going.`
    : `the demo has used its ${DEMO_DROPS} drops for this month. More in ${back} day${back === 1 ? "" : "s"}, or make your own workspace to keep going.`);
}

/**
 * Which model answers. The deployment's key pays for every call, and the owner
 * may pick another model in the app; the default is the one this deployment
 * runs.
 */
function modelName(body: any): string | undefined {
  const m = String(body?.model ?? "").trim();
  if (!m || m === MODEL) return undefined;
  if (m.length > 80 || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(m)) {
    throw new Error(`"${m.slice(0, 40)}" is not a model id. They read vendor/model, like ${MODEL}.`);
  }
  return m;
}

const route = (path: string, fn: (ctx: any, req: Request, body: any) => Promise<any>) => {
  router.route({ path, method: "OPTIONS", handler: httpAction(async (_c, req) => new Response(null, { status: 204, headers: cors(req) })) });
  router.route({
    path, method: "POST",
    handler: httpAction(async (ctx, req) => {
      let body: any = {};
      try { body = await req.json(); } catch { /* empty body is fine */ }
      try {
        return json(req, await fn(ctx, req, body));
      } catch (e: any) {
        if (e instanceof Response) return json(req, { error: "locked" }, 401);
        return json(req, { error: String(e?.message ?? e).slice(0, 400) }, 400);
      }
    }),
  });
};

/**
 * One door per space. The passphrase decides which brains the session sees.
 *
 * The first call at a door with no passphrase sets it, which is how Octopus was
 * opened and how Squidgy opens. Run `npx convex run admin:setPass --prod` to
 * set one from a terminal instead, and the door is closed before it is public.
 */
route("/api/unlock", async (ctx, _req, b) => {
  /* A door by its slug, or a workspace by the name typed on the landing. */
  const space = b.name ? slugOfName(String(b.name)) : readSpace(b.space);
  if (!SPACE_RE.test(space)) return { error: "no workspace has that name" };
  const pass = String(b.pass ?? "");
  if (pass.length < 8) return { error: "use at least 8 characters" };

  const g = await ctx.runQuery(internal.store.gateState, { space });

  /* A door with no passphrase stays shut. Setting one over the web let the
     first visitor to arrive choose it, so only the terminal sets it now. */
  if (!g?.set) {
    return { error: b.name ? "no workspace has that name and passphrase"
      : `this door has no passphrase yet. Its owner sets one with: npx convex run admin:setPass "{space:'${space}',pass:'...'}" --prod` };
  }

  /* The count only holds inside its window. Checked alone, eight wrong
     guesses shut the door for good. */
  if ((g.attempts ?? 0) >= MAX_ATTEMPTS && Date.now() - (g.attemptWindow ?? 0) < ATTEMPT_WINDOW_MS) {
    return { error: "too many attempts, wait an hour" };
  }

  const good = await sha256(g.salt!, pass) === g.hash;
  await ctx.runMutation(internal.store.noteAttempt, { ok: good, space });
  if (!good) return { error: b.name ? "no workspace has that name and passphrase" : "that is not it" };
  return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner", space }), space };
});

/**
 * The demo: anyone opens it, and nobody holds a passphrase to it. The owner
 * makes it once (npx convex run admin:makeDemo --prod) and fills it with
 * admin:copyBrain. A visitor gets a session of their own, so their chats
 * stay theirs.
 */
route("/api/demo", async (ctx) => {
  const ws = await ctx.runQuery(internal.store.demoWorkspace, {});
  if (!ws) return { error: "the demo is not open yet" };
  const r = await ctx.runMutation(internal.store.mcpRate, { who: "demo:sessions", max: 2000, windowMs: 24 * 60 * 60 * 1000 });
  if (!r.allowed) return { error: "the demo is full for today. Create your own workspace with your own key." };
  return { token: await ctx.runMutation(internal.store.newSession, { kind: "demo", space: ws.slug }), space: ws.slug };
});

/**
 * A workspace of your own, on your own OpenRouter key.
 *
 * The key is checked once with OpenRouter, which costs nothing, and then
 * handed back to the browser. It is never stored here: the app sends it with
 * each call that needs a model.
 */
route("/api/workspace/create", async (ctx, _req, b) => {
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const pass = String(b.pass ?? ""), key = String(b.key ?? "").trim();
  const slugged = slugOfName(name);
  if (!name || slugged.length < 2) return { error: "give the workspace a name of 2 letters or more" };
  if (pass.length < 8) return { error: "use a passphrase of at least 8 characters" };
  if (!KEY_RE.test(key)) return { error: "that is not an OpenRouter key. It starts with sk-or-" };
  const r = await ctx.runMutation(internal.store.mcpRate, { who: "ws:create", max: 100, windowMs: 24 * 60 * 60 * 1000 });
  if (!r.allowed) return { error: "too many workspaces were made today. Try again tomorrow." };
  try {
    const ok = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key } });
    if (!ok.ok) return { error: "OpenRouter refused that key. Check it and try again." };
  } catch { return { error: "OpenRouter did not answer. Try again in a minute." }; }
  const salt = randomHex(16);
  const made = await ctx.runMutation(internal.store.createWorkspace,
    { slug: slugged, name, kind: "byok", salt, hash: await sha256(salt, pass) });
  if (made.error) return { error: made.error };
  return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner", space: slugged }), space: slugged, name };
});

/**
 * Change this workspace's passphrase, from Setup.
 *
 * The current one is asked for and counts against the same eight tries an
 * hour as the door does. Everyone else signed in here is signed out; the
 * session that changed it stays.
 */
route("/api/passphrase", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const cur = String(b.current ?? ""), next = String(b.next ?? "");
  if (next.length < 8) return { error: "use a new passphrase of at least 8 characters" };
  if (next === cur) return { error: "that is the passphrase you have now" };
  const g = await ctx.runQuery(internal.store.gateState, { space: who.space });
  if (!g?.set) return { error: "this workspace has no passphrase to change" };
  if ((g.attempts ?? 0) >= MAX_ATTEMPTS && Date.now() - (g.attemptWindow ?? 0) < ATTEMPT_WINDOW_MS) {
    return { error: "too many attempts, wait an hour" };
  }
  const good = await sha256(g.salt!, cur) === g.hash;
  await ctx.runMutation(internal.store.noteAttempt, { ok: good, space: who.space });
  if (!good) return { error: "that is not your current passphrase" };
  const salt = randomHex(16);
  await ctx.runMutation(internal.store.setGate, { salt, hash: await sha256(salt, next), space: who.space, replace: true });
  const ended = await ctx.runMutation(internal.store.endOtherSessions, { space: who.space, keep: String(b.token) });
  return { ok: true, ended };
});

/**
 * Share a brain: one brain, seen from two workspaces, so a drop in either one
 * fills both. Setup, for the owner of the brain's own workspace, one workspace
 * and one on or off at a time. The demo, open to anyone, only reads it. A
 * workspace the brain was shared into can leave it.
 */
route("/api/share", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (!owners.includes(who.space)) return { error: "sharing brains is not open for this workspace" };
  const slug = String(b.brain ?? "");
  if (slug && b.leave === true) await ctx.runMutation(internal.store.leaveBrain, { slug, space: who.space });
  else if (slug) await ctx.runMutation(internal.store.shareBrain,
    { slug, space: who.space, to: String(b.to ?? ""), on: b.on === true });
  return await ctx.runQuery(internal.store.shareState, { space: who.space });
});

route("/api/status", async (ctx) => {
  /* Which doors have a passphrase, and whether this deployment is personal. It
     names no account and no brain, so a visitor learns only what the landing
     needs to draw two doors. */
  const gates = await ctx.runQuery(internal.store.gatesSet, {});
  const demo = !!(await ctx.runQuery(internal.store.demoWorkspace, {}));
  /* The workspaces made for someone on this key are listed by name. A visitor's
     own workspace never is. */
  const hosted = await ctx.runQuery(internal.store.hostedList, {});
  /* Each listed workspace's logo, when its owner set one in Setup: a small
     image, so the row wears the workspace's own mark. */
  const logos: Record<string, string> = {};
  for (const s of [...owners, ...hosted.map((h: any) => h.slug)]) {
    const look = await ctx.runQuery(internal.store.brandOf, { space: s });
    if (look?.logo && String(look.logo).length <= 60000) logos[s] = look.logo;
  }
  return { gates, gateSet: !!gates.octopus, demo, hosted, logos };
});

route("/api/lock", async (ctx, _req, b) => {
  if (b?.token) await ctx.runMutation(internal.store.dropSession, { token: b.token });
  return { ok: true };
});

/**
 * The project's connector address.
 *
 * One per project: the address made inside Octopus reads and feeds Octopus,
 * the one made inside Squidgy reads and feeds Squidgy. Its holder account has
 * no password, so nothing signs in with it. Rotating replaces the token,
 * which kills whatever was pointed at the old one.
 */
route("/api/account/mcp", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  /* The connector runs some steps on the deployment's key, so it stays with
     the owner's workspaces for now. */
  if (!owners.includes(who.space)) return { error: "the Claude connector is not open for this workspace yet" };
  const account = await ctx.runMutation(internal.store.connectorHolder, { space: who.space, salt: randomHex(16) });
  if (b.forget) {
    await ctx.runMutation(internal.store.setMcpToken, { slug: account, token: null });
    return { has: false, token: "" };
  }
  if (b.make) {
    const token = randomHex(24);
    const r = await ctx.runMutation(internal.store.setMcpToken, { slug: account, token });
    return { has: true, token, made: r.made };
  }
  return await ctx.runQuery(internal.store.mcpState, { slug: account });
});

/**
 * The connector documentation.
 *
 * Gated because it is served, not published. A static page could be hidden by a
 * script and still hand its words to anyone who read the file. These words live
 * on the deployment, so an unsigned request gets the refusal instead.
 */
route("/api/doc", async (ctx, _req, b) => {
  await gate(ctx, b);
  return { style: DOC_STYLE, body: DOC_BODY };
});

/**
 * What the transcript service has cost, from both sides.
 *
 * The vendor's own count decides when to start pasting, because it is the one
 * the quota is measured against and it includes anything spent outside this
 * app. The local count answers a different question: the pace Octopus itself is
 * running at, over a window you choose.
 */
route("/api/usage", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (!owners.includes(who.space)) return { configured: false, mine: 0, hidden: true };
  const days = Math.min(Math.max(Number(b.days) || 30, 1), 365);
  const mine = await ctx.runQuery(internal.store.fetchCount, { days });

  const key = (process.env.SUPADATA_API_KEY ?? "").trim();
  if (!key) return { configured: false, mine };

  let plan: any = null, why = "";
  try {
    const r = await fetch("https://api.supadata.ai/v1/me", {
      headers: { "x-api-key": key, "Accept": "application/json" },
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      plan = { name: String(d?.plan ?? "unknown"),
               used: Number(d?.usedCredits ?? 0), max: Number(d?.maxCredits ?? 0) };
    } else {
      why = String(d?.message ?? d?.error ?? `HTTP ${r.status}`).slice(0, 140);
    }
  } catch (e: any) {
    why = String(e?.message ?? e).slice(0, 140);
  }
  return { configured: true, mode: (process.env.SUPADATA_MODE ?? "native").trim(), plan, why, mine };
});

/* ---------- reading ---------- */

route("/api/state", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* The slim copies are built once, in the background, the first time the app
     opens after they arrive: started before the lists are read, so a space
     too big to read whole still gets them. Until then the lists come from the
     concepts, a page at a time. */
  const { brains, cards, sources } = await loadSpace(ctx, who.space, async head => {
    if (!head.ready && ctx.scheduler) await ctx.scheduler.runAfter(0, internal.admin.buildCards, {});
  }, { personal: true });
  /* The app lists and counts concepts, so it gets their names and summary
     lines. The whole concept travels only for the export. */
  const s = { brains, sources, concepts: cards.map((c: any) => ({
    brain: c.brain, slug: c.slug, n: c.n, title: c.title, summaryLine: c.summaryLine, updated: c.updated,
    ev: c.ev ?? 0, src: c.src ?? 0, links: (c.related ?? []).length })) };
  const brand = await ctx.runQuery(internal.store.brandOf, { space: who.space });
  const full = await ctx.runQuery(internal.store.modeOf, { space: who.space });
  return { ...s, model: MODEL, chunk: CHUNK,
           space: who.space, spaceName: who.wsName, demo: who.demo, byok: who.byok, brand, full };
});

/**
 * The side panel: limited shows Chats and Projects, full adds every folder.
 * A workspace starts limited, and whoever opens it switches it in Settings.
 */
route("/api/mode", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (typeof b.full !== "boolean") return { error: "say full or limited" };
  return await ctx.runMutation(internal.store.setMode, { space: who.space, full: b.full });
});

/**
 * A workspace's own look: a logo and two colours, set in Setup. The demo keeps
 * Brain's. The logo arrives as a small image the browser drew from the file,
 * so only a PNG, JPEG or WebP data URL under 200 KB is taken.
 */
const HEX = /^#[0-9a-f]{6}$/i;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
route("/api/brand", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (b.reset === true) { await ctx.runMutation(internal.store.setBrand, { space: who.space, reset: true }); return { brand: null }; }
  const field = (k: string) => b[k] === undefined ? undefined : b[k] === null || b[k] === "" ? null : String(b[k]);
  const logo = field("logo"), accent = field("accent"), bg = field("bg");
  if (logo && (logo.length > 200_000 || !LOGO.test(logo))) return { error: "that logo did not come through. Try a PNG or a JPEG." };
  if (accent && !HEX.test(accent)) return { error: "the accent is not a colour" };
  if (bg && !HEX.test(bg)) return { error: "the page colour is not a colour" };
  const brand = await ctx.runMutation(internal.store.setBrand, { space: who.space, logo, accent: accent?.toLowerCase() ?? accent, bg: bg?.toLowerCase() ?? bg });
  return { brand };
});

/** A workspace's name and look before its passphrase: the page asking for it wears them. */
route("/api/brand/public", async (ctx, _req, b) => {
  const space = String(b.space ?? "").trim().toLowerCase();
  if (!SPACE_RE.test(space)) return { brand: null };
  const ws = owners.includes(space) ? null : await ctx.runQuery(internal.store.workspaceOf, { slug: space });
  if (!owners.includes(space) && !ws) return { brand: null };
  return { name: ws?.name ?? spaceName(space), brand: await ctx.runQuery(internal.store.brandOf, { space }) };
});

/** One concept whole, by its brain/slug id, for the brain viewer. */
route("/api/concept", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const [c] = await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids: [String(b.id ?? "")] });
  return c ? { concept: c } : { error: "that concept is not in this space" };
});

/** The open conflicts that are real contradictions, for Setup. */
route("/api/conflicts", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await listConflicts(ctx, who.space, modelFor(who, b), keyFor(who));
});

/** Settle one conflict: a side holds and the position is rewritten, or both hold. */
route("/api/conflicts/settle", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "ask");
  return await settleConflict(ctx, who.space, b, modelFor(who, b), keyFor(who));
});

/** One page of a brain's concepts whole, for the markdown export. The app
    asks again with `next` until it comes back empty. */
route("/api/export", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runQuery(internal.store.conceptsOfBrain,
    { space: who.space, brain: String(b.brain ?? ""), cursor: typeof b.cursor === "string" ? b.cursor : null });
});

route("/api/brain", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const name = String(b.name ?? "").trim();
  /* A personal brain holds whatever its owner says, so it needs no scope line. */
  const scope = String(b.scope ?? "").trim() || (b.type === "personal" ? "What I say in its chat, in my own words, dated." : "");
  if (!name || !scope) return { error: "a name and a scope line are both required" };
  const type = b.type === "person" || b.type === "personal" ? String(b.type) : "subject";
  const visibility = String(b.visibility ?? "closed");
  return { slug: await ctx.runMutation(internal.store.createBrain,
    { name, type, scope, visibility, space: who.space }) };
});

/** Rename a brain, and move its concepts, sources and candidates with it. */
route("/api/brain/rename", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.store.renameBrain, {
    slug: String(b.slug ?? ""), name: String(b.name ?? ""),
    scope: String(b.scope ?? ""), account: null, space: who.space });
});

/* ---------- drop ---------- */

/**
 * Read a page so a bare link is enough.
 *
 * Nothing fetched is stored. The text goes back to the caller, who reads it
 * once, and only the extraction ever reaches a brain.
 */
route("/api/fetch", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* The transcript service is the owner's, so other workspaces get a few a day. */
  if (!owners.includes(who.space)) {
    const r = await ctx.runMutation(internal.store.mcpRate, who.demo
      ? { who: "fetch:demo", max: DEMO_DROPS + 10, windowMs: MONTH }
      : { who: "fetch:" + who.space, max: 20, windowMs: 24 * 60 * 60 * 1000 });
    if (!r.allowed) return { error: "today's allowance of fetched pages and transcripts is used. Paste the text instead." };
  }
  return await fetchPage(ctx, String(b.url ?? ""));
});

/** R1.2 runs before anything expensive, so a repeat costs zero pasting. */
route("/api/drop/check", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* Every drop starts here, so this is where the demo counts one. */
  await demoCount(ctx, who, "drop");
  return await dropCheck(ctx, b, who.space);
});

/**
 * The extraction a stored source already gave up.
 *
 * Filing it into a second brain reuses it, so a source is read once in its life
 * however many brains end up holding it. That makes the second filing cost one
 * model call instead of three.
 */
route("/api/drop/again", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const ext = await ctx.runQuery(internal.store.noteBySid, { sid: String(b.sid ?? ""), space: who.space });
  if (!ext) {
    return { error: "no note was kept for that source, so it has to be read again. Paste it once more." };
  }
  return { ext };
});

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
route("/api/drop/read", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await dropRead(ctx, who, b, keyFor(who), modelFor(who, b));
});

/** R3. Summaries only, never whole brains, so this costs the same at any size. */
route("/api/drop/plan", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await dropPlan(ctx, who, b, keyFor(who), modelFor(who, b));
});

/** Parts planned in parallel can name one idea twice. This groups them. */
route("/api/drop/merge", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await dropMerge(ctx, who, b, keyFor(who), modelFor(who, b));
});

/** R5. Re-derive, never append, then write. One pass, before the receipt. */
route("/api/drop/settle", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await dropSettle(ctx, who, b, keyFor(who), modelFor(who, b));
});


/**
 * Link what a drop wrote, once, when its last part is stored. Linking each
 * part as it landed compared the whole space again for every part.
 */
route("/api/drop/link", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const sid = String(b.sid ?? "");
  if (!sid) return { error: "linking needs the source it follows" };
  /* Only brains this caller may feed, and only concepts that source fed: the
     ids come from the browser, so they are checked against both. */
  const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
  const mine = new Set(head.brains.filter((x: any) => canDrop(x, who)).map((x: any) => x.slug));
  const ids = [...new Set<string>((Array.isArray(b.ids) ? b.ids : []).map(String))]
    .filter(x => /^[a-z0-9-]+\/[a-z0-9-]+$/.test(x) && mine.has(x.split("/")[0])).slice(0, 5000);
  /* Linking runs later, on the deployment's key, so a workspace on its own
     key skips it rather than spend the owner's. */
  if (who.byok) return { linking: 0 };
  if (ids.length) await ctx.scheduler.runAfter(0, internal.admin.linkConcepts, { space: who.space, ids, sid });
  return { linking: ids.length };
});

/* ---------- ask ---------- */

route("/api/ask", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* Every brain in this space answers questions, whoever is asking. A personal
     brain answers in its own chat only, and no other chat reads it. */
  const every = await loadSpace(ctx, who.space, undefined, { personal: true });
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  const mine = only ? every.brains.find((x: any) => x.slug === only && x.type === "personal") : null;
  if (mine) return await personalChat(ctx, who, b, mine, every);
  const { brains, cards: concepts, sources } = withoutPersonal(every);
  /* Folders ticked in the side panel: two or more travel as a list, and the
     question reads those alone. A personal brain never joins it. */
  const ticked = Array.isArray(b.brains) ? [...new Set(b.brains.map(String))].slice(0, 60) : [];
  const many = ticked.length > 1;
  const pool = many ? brains.filter((x: any) => ticked.includes(x.slug))
    : only ? brains.filter((x: any) => x.slug === only) : brains;
  if (many && !pool.length) return { answer: "None of the ticked folders is here any more. Tick others, or ask them all." };
  if (!pool.length) return { answer: "No brains exist yet, so there is nothing to read. Create one, drop a few sources, then ask again." };

  /**
   * What the answer reads.
   *
   * It read every concept of the first three brains in list order: with
   * "All brains" and eleven brains, eight were never read, and a brain of 1000
   * concepts sent about 524,000 tokens. Now every brain in the space is
   * searched, the concepts that bear on the question open in full within a
   * budget, and the next ones are named by title so the answer knows what else
   * is held. A follow-up borrows the words of the question before it.
   */
  const mKey = keyFor(who), mName = modelFor(who, b);
  await demoCount(ctx, who, "ask");
  const t0 = Date.now();
  const route = await routeQuestion(pool, concepts, String(b.q ?? ""), b.history, mKey, mName);
  /* Ranked on the slim copies; only the concepts that lead are read whole. */
  const plan = planDossier(pool, concepts, String(b.q ?? ""), b.history, route);
  const whole = await ctx.runQuery(internal.store.conceptsByIds,
    { space: who.space, ids: plan.lead.slice(0, OPEN_READ).map(idOf) });
  const pick = writeDossier(pool, plan, new Map(whole.map((c: any) => [idOf(c), c])));
  const dossier = pick.dossier;
  const reading = pool.filter((x: any) => pick.opened.some((c: any) => c.brain === x.slug));
  const isPerson = reading.length === 1 && reading[0].type === "person";
  const nSources = new Set(sources.filter((s: any) => s.brains.some((x: string) => reading.some((c: any) => c.slug === x))).map((s: any) => s.sid)).size;

  /* Three levels: Normal answers, Educational teaches the answer, Learning
     leads the reader to it without giving it. Each changes the shape and the
     depth of the answer. None of
     them touches the evidence rules below, so a level can never buy a claim
     the brain does not hold. */
  /* Expert was removed. A browser still holding it asks at Normal. */
  const level = ["normal", "educational", "learning"].includes(String(b.level))
    ? String(b.level) : "normal";
  const learning = level === "learning";
  const SHAPE: Record<string, string> = {
    normal:
`LEVEL: NORMAL
- 3 to 6 sentences, one per line, unless the question asked for another shape.
- Assume the reader knows the field. Skip definitions.`,
    educational:
`LEVEL: EDUCATIONAL
- Assume no background at all.
- Define each term the first time it appears, in one clause.
- Build the mechanism in order, so each step rests on the one before it.
- Give ONE worked example carrying real numbers from the evidence.
- Close with one line naming the single thing worth remembering.
- 10 to 20 sentences, one per line. A blank line may separate two groups.`,
    learning:
`LEVEL: LEARNING
- The reader wants to reach the answer themselves. NEVER state the answer, the conclusion or the final number.
- First line: what the question really asks, in plain words, without answering it.
- Then 3 to 6 numbered steps in order, each resting on the one before. Each step is a question to think through or a small task to do.
- Under a step, give the inputs it needs from the stored knowledge: a definition, a figure, a rule. Never the result it leads to.
- Name the concept that holds each step by its title, in quotes, so the reader knows where to look.
- Last line: "Check yourself: " and one question whose answer shows they got there.
- When the question proposes an answer, say which steps it gets right and which step to revisit. Give the answer only when the question asks for it in so many words.`,
  };

  /**
   * The last few turns of this thread, so "what about the second one" means
   * something.
   *
   * They arrive from the browser and are never written down. They set what a
   * follow-up refers to, and nothing else: every claim in the answer still has
   * to come from the stored knowledge, which the rules below say plainly.
   */
  const history = (Array.isArray(b.history) ? b.history : []).slice(-4);
  const earlier = history.map((h: any) =>
    `Q: ${String(h.q ?? "").slice(0, 400)}\nA: ${String(h.a ?? "").slice(0, 1200)}`).join("\n\n");

  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds. You always answer in English." },
    { role: "user", content:
`Answer the question from the stored knowledge below.

${SHAPE[level]}

HOW TO WRITE THE ANSWER
- THE QUESTION'S OWN INSTRUCTION ABOUT SHAPE WINS. Asked for a list, give a list, one item per line starting with "- ". Asked for steps, number them. Asked for a table, give a table. The rules below apply to the words inside whatever shape was asked for.
- Otherwise: ONE SENTENCE PER LINE. End every sentence with a full stop, then a line break.
- A full stop, never a semicolon. Two ideas are two sentences on two lines.
${learning
  ? "- The FIRST SENTENCE says what the question asks, never its answer. Natural prose, addressed to the person asking."
  : "- The FIRST SENTENCE answers the question. Natural prose, addressed to the person asking."}
- Numbers, dates and findings go INSIDE the answer.
${isPerson
  ? "- This is a PERSON brain, so name that person throughout. Their view is the subject."
  : "- NEVER put a source's name in the answer text. Attribution belongs on the sources line only."}
- Newer evidence wins on the same question, and better data overrides that.
- Mention an open conflict only when it changes what the reader would do.
- No file paths anywhere.
${nSources > 0 && nSources < 10 ? `- This rests on ${nSources} source${nSources === 1 ? "" : "s"} only. Open by saying it is a small brain.` : ""}
- Then a blank line, then one line: "Sources: {author}, {date} - {author}, {date}" listing only sources you used. Omit that line if you used none.
- English, always. No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording. Say what holds rather than what does not.
- If the stored knowledge does not answer it, say so plainly in one sentence and name what kind of source would fill the gap. Never invent evidence.
${earlier ? `- The question may be a follow-up. Read it against the conversation below, so a pronoun or "the second one" points at the right thing.` : ""}
${earlier ? `
EARLIER IN THIS CONVERSATION
${earlier}

That is context for reading the question, never a source. Every claim in your answer comes from the stored knowledge below. A claim you made earlier that the stored knowledge does not carry is dropped, not repeated.
` : ""}
STORED KNOWLEDGE
The concepts that bear on this question are opened in full. Others are named under ALSO HELD. Answer from the opened ones, and name an ALSO HELD concept when it is where the answer would continue.
${dossier}

QUESTION: ${String(b.q ?? "")}` },
  ], { maxTokens: level === "normal" ? 2000 : learning ? 2400 : 3200, key: mKey, model: mName,
       /* The browser waits 3 minutes. The router's time comes out of the
          answer's, so the two never add up past it. */
       timeout: Math.max(60000, 165000 - (Date.now() - t0)) });

  /* The app keeps its conversations: a question sent with "chat" joins that
     chat, or starts one. A failed save is only a chat that does not list it. */
  let chat: string | undefined;
  if ("chat" in b) {
    try {
      const r = await ctx.runMutation(internal.store.chatTurn, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}),
        id: typeof b.chat === "string" ? b.chat : null, brain: many ? pool.map((x: any) => x.slug).join(",") : only ?? "all",
        turn: { q: String(b.q ?? "").slice(0, 2000), a: text, level, sources: nSources, at: Date.now() } });
      chat = r.id;
    } catch { /* the answer still goes out */ }
  }
  return { answer: text, sources: nSources, level, ...(chat ? { chat } : {}) };
});

/**
 * A message in a personal brain's chat: filed, and answered.
 *
 * The two run side by side. The filer reads the owner's message alone and
 * files what is worth keeping, dated, in their words. The reply reads the
 * personal notes and every other brain, which is how a personal chat calls on
 * them; no other chat ever reads a personal brain. The reply never files.
 */
async function personalChat(ctx: any, who: Caller, b: any, mine: any, every: any) {
  const mKey = keyFor(who), mName = modelFor(who, b);
  const q = String(b.q ?? "").slice(0, MAX_CHARS.chat).trim();
  if (!q) return { error: "write something first" };
  await demoCount(ctx, who, "ask");
  const date = new Date().toISOString().slice(0, 10);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-4);
  const last = history.slice(-1).map((h: any) => `They said: ${String(h.q ?? "").slice(0, 500)}\nThe brain replied: ${String(h.a ?? "").slice(0, 600)}`).join("");
  /* This personal brain and every brain that is not personal: the reply may
     call on any of them without being asked. */
  const pool = every.brains.filter((x: any) => x.type !== "personal" || x.slug === mine.slug);
  const others = pool.filter((x: any) => x.slug !== mine.slug);
  const cards = every.cards.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  const t0 = Date.now();

  const filing = remember(ctx, { space: who.space, brain: mine.slug, cards: every.cards, text: q, context: last, kind: "chat", date,
    model: async m => (await ask(m, { json: true, maxTokens: 1800, key: mKey, model: mName, timeout: 120000 })).text })
    .catch(() => null);
  const reply = (async () => {
    const route = await routeQuestion(pool, cards, q, b.history, mKey, mName);
    const plan = planDossier(pool, cards, q, b.history, route);
    const whole = await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids: plan.lead.slice(0, OPEN_READ).map(idOf) });
    const pick = writeDossier(pool, plan, new Map(whole.map((c: any) => [idOf(c), c])));
    const earlier = history.map((h: any) => `They said: ${String(h.q ?? "").slice(0, 400)}\nYou replied: ${String(h.a ?? "").slice(0, 800)}`).join("\n\n");
    const { text } = await ask([
      { role: "system", content: REPLY_RULES },
      { role: "user", content: `TODAY: ${date}\n\n${earlier ? `EARLIER IN THIS CHAT\n${earlier}\n\n` : ""}` +
        `THEIR OTHER BRAINS, yours to call on: ${others.map((x: any) => `${x.name} (${x.type})`).join(", ") || "none yet"}\n\n` +
        `WHAT THEIR NOTES AND BRAINS HOLD (entries "in ${mine.name}" are their own notes; every other entry comes from the brain it names)\n${pick.dossier}\n\nTHEIR MESSAGE\n${q}` },
    ], { maxTokens: 1200, key: mKey, model: mName, timeout: Math.max(60000, 160000 - (Date.now() - t0)) });
    return text;
  })();
  const [answer, filed] = await Promise.all([reply, filing]);
  const called = calledBrains(answer, others);

  let chat: string | undefined;
  if ("chat" in b) {
    try {
      const r = await ctx.runMutation(internal.store.chatTurn, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}),
        id: typeof b.chat === "string" ? b.chat : null, brain: mine.slug,
        turn: { q: q.slice(0, 2000), a: answer, level: "normal", sources: 0, at: Date.now(), filed: filed ?? null, called } });
      chat = r.id;
    } catch { /* the reply still goes out */ }
  }
  return { answer, sources: 0, level: "normal", personal: true, filed: filed ?? { new: 0, updated: 0, titles: [], failed: true },
           called, ...(chat ? { chat } : {}) };
}

/**
 * A memory export or notes, pasted or dropped into a personal brain, one
 * piece of at most 8,000 characters per call. The app cuts a long one up.
 */
route("/api/personal/remember", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const every = await loadSpace(ctx, who.space, undefined, { personal: true });
  const mine = every.brains.find((x: any) => x.slug === String(b.brain ?? "") && x.type === "personal");
  if (!mine) return { error: "that is not a personal brain of this workspace" };
  const text = String(b.text ?? "").trim();
  if (!text) return { error: "there is nothing to remember in that" };
  if (text.length > MAX_CHARS.import) return { error: `send at most ${MAX_CHARS.import} characters at a time` };
  const mKey = keyFor(who), mName = modelFor(who, b);
  const filed = await remember(ctx, { space: who.space, brain: mine.slug, cards: every.cards, text, kind: "import",
    date: new Date().toISOString().slice(0, 10),
    model: async m => (await ask(m, { json: true, maxTokens: 4000, key: mKey, model: mName, timeout: 150000 })).text });
  return { filed };
});

/* ---------- chats ---------- */

/** The chats, pinned first then newest. Old ones are cleared as this runs. */
route("/api/chats", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return { chats: await ctx.runMutation(internal.store.chatList, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}) }) };
});

/** One chat whole, to reopen it. */
route("/api/chats/get", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const c = await ctx.runQuery(internal.store.chatGet, { space: who.space, id: String(b.id ?? ""), ...(who.visitor ? { owner: who.visitor } : {}) });
  return c ? { chat: c } : { error: "that chat is gone" };
});

/** Rename, pin, unpin or delete a chat. */
route("/api/chats/edit", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runMutation(internal.store.chatEdit, { space: who.space, id: String(b.id ?? ""), ...(who.visitor ? { owner: who.visitor } : {}),
    ...(typeof b.title === "string" ? { title: b.title } : {}),
    ...(typeof b.pinned === "boolean" ? { pinned: b.pinned } : {}),
    ...(b.remove === true ? { remove: true } : {}) });
});

/* ---------- health and the map ---------- */

/** Open conflicts per brain, and the concepts holding one. No model call:
    a clash the check has not read yet counts as open. */
async function openConflicts(ctx: any, space: string, brains: any[]) {
  const open = new Map<string, number>(), conflicted: string[] = [];
  for (const br of brains) {
    let cursor: string | null = null;
    for (;;) {
      const p: any = await ctx.runQuery(internal.store.conflictsPage, { space, brain: br.slug, cursor });
      for (const c of p.items) {
        const n = (c.conflicts ?? []).filter((x: any) => x?.real !== false).length;
        if (!n) continue;
        open.set(c.brain, (open.get(c.brain) ?? 0) + n);
        conflicted.push(c.id);
      }
      if (!p.next) break;
      cursor = p.next;
    }
  }
  return { open, conflicted };
}

/** Each brain's health out of 10, and the concepts with an open conflict. */
route("/api/health", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const { brains, cards, sources } = await loadSpace(ctx, who.space);
  const { open, conflicted } = await openConflicts(ctx, who.space, brains);
  return { health: healthOf(brains, cards, sources, open), conflicted };
});

/** The links between concepts of different brains, each pair once, for the map. */
route("/api/map", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const { cards } = await loadSpace(ctx, who.space);
  const known = new Set(cards.map((c: any) => `${c.brain}/${c.slug}`));
  const seen = new Set<string>(), links: [string, string][] = [];
  for (const c of cards) {
    const from = `${c.brain}/${c.slug}`;
    for (const r of c.related ?? []) {
      const to = linkId(String(r), c.brain);
      if (!known.has(to) || to.split("/")[0] === c.brain) continue;
      const key = [from, to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key); links.push([from, to]);
    }
  }
  return { links };
});

/* ---------- one page ---------- */

/**
 * A brain, a group, or a question, as bullets on one page.
 *
 * A brain and a group assemble from stored positions and call no model, so they
 * are instant and free. A question costs one call.
 *
 * `mail` sends the page as well as returning it. What gets sent is always what
 * this route just built, never a body handed in, so a signed-in session cannot
 * post arbitrary mail from this address.
 */
route("/api/onepager", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const { brains: all, cards: concepts, sources } = await loadSpace(ctx, who.space);
  if (!all.length) return { error: "no brain exists yet, so there is nothing to put on a page" };
  const load = async (ids: string[]) => await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids });

  /* One of: a brain slug, "person", "subject", or "all". */
  const pick = String(b.pick ?? "all").trim();
  const brains =
    pick === "person" || pick === "subject" ? all.filter((x: any) => (x.type === "person" ? "person" : "subject") === pick)
    : pick && pick !== "all" ? all.filter((x: any) => x.slug === pick)
    : all;
  if (!brains.length) {
    return { error: pick === "person" || pick === "subject"
      ? `no ${pick} brain exists yet`
      : `no brain called "${pick.slice(0, 40)}"` };
  }

  /* The address is checked before anything is built, so a typo costs nothing,
     least of all a model call on a question. */
  const to = String(b.mail ?? "").trim();
  if (to && !looksLikeMail(to)) return { error: `"${to.slice(0, 60)}" is not an address` };
  /* Mail goes out from the owner's domain, so only the owner's workspaces send it. */
  if (to && !owners.includes(who.space)) return { error: "mail is off in this workspace. Copy or print the page instead." };

  const q = String(b.q ?? "").trim();
  /* Summary lays out the positions in bullets, free, or answers a question.
     Custom writes a document of the type picked, in one model call. A quiz
     asked the old way, as its own kind, is a custom quiz. */
  const oldQuiz = b.kind === "quiz";
  const kind = b.kind === "custom" || oldQuiz ? "custom" : "summary";
  const doc: DocType = oldQuiz ? "quiz" : DOC_TYPES.includes(b.doc) ? b.doc : "other";
  const note = String(b.note ?? "").trim().slice(0, 600);
  if (kind === "custom" && doc === "other" && !note) return { error: "describe the document you want" };
  /* English by default. A page the model writes is written in the language
     picked; a summary laid out from the stored positions is translated. */
  const lang = langOf(b.lang);
  if (q || kind !== "summary" || lang !== "English") await demoCount(ctx, who, "ask");
  const page = q || kind !== "summary"
    ? await fromModel(who.space, brains, concepts, sources, { q, kind, doc, note, pick, lang },
                      keyFor(who), modelFor(who, b), load)
    : await translatePage(assemble(who.space, brains, concepts, sources, pick,
               new Map((await load(pageIds(brains, concepts))).map((c: any) => [idOf(c), c]))), lang, undefined, lang === "English" ? undefined : keyFor(who), modelFor(who, b));

  if (!hasBody(page)) {
    return { error: "those brains hold no positions yet, so the page would be empty" };
  }

  /* The language the page came back in, and why it is English when another
     one was asked for, so the app never shows the wrong one without saying so. */
  const said = { lang: page.untranslated ? "English" : lang,
    ...(page.untranslated ? { warning: `The ${lang} translation did not come back after two tries, so this page is in English. Build it again to retry.` } : {}) };
  if (!to) return { page, text: asText(page), ...said };
  /* A page that built and failed to send is still a page. It comes back with the
     reason, so a question already paid for is not thrown away with the mail. */
  /* Thirty mails a day per space, so this address cannot be used to spam. */
  const quota = await ctx.runMutation(internal.store.mcpRate,
    { who: "mail:" + who.space, max: 30, windowMs: 24 * 60 * 60 * 1000 });
  if (!quota.allowed) {
    return { page, text: asText(page), sent: false, to, ...said,
             mailError: `30 pages were mailed today. Mail opens again in ${Math.ceil(quota.retryAfter / 3600)} hours.` };
  }
  try {
    const sent = await mail(to, page, who.space);
    return { page, text: asText(page), sent: true, to, id: sent.id, ...said };
  } catch (e: any) {
    return { page, text: asText(page), sent: false, to, ...said, mailError: String(e?.message ?? e).slice(0, 300) };
  }
});

/* ---------- the public read the /brains page uses ---------- */

/**
 * Same exposure as the MCP server, in one JSON document, so a static page can
 * render the brains without a passphrase. Private brains never appear.
 */
router.route({
  path: "/api/public/brains", method: "GET",
  handler: httpAction(async (ctx, req) => {
    /* Octopus only. Squidgy sits behind its own passphrase and is published
       nowhere, so no unsigned route reads it. */
    const { brains, cards: concepts, sources } = await loadSpace(ctx, HOME);
    return new Response(JSON.stringify({
      brains: brains.map((b: any) => ({
        slug: b.slug, name: b.name, type: b.type, scope: b.scope,
        open: isOpen(b),
        concepts: concepts.filter((c: any) => c.brain === b.slug).length,
        sources: sources.filter((s: any) => (s.brains ?? []).includes(b.slug)).length,
      })),
      concepts: concepts.map((c: any) => ({
        brain: c.brain, slug: c.slug, n: c.n, title: c.title,
        summaryLine: c.summaryLine, position: c.lead,
        sources: c.src, updated: c.updated,
      })),
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  }),
});
router.route({
  path: "/api/public/brains", method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS",
  }})),
});

/* ---------- the public MCP endpoint ---------- */

/**
 * Read-only, unauthenticated, and deliberately so. It calls no model, so it
 * spends no credit, and it exposes no write, so no visitor can move a position.
 * The gate above still guards everything the app itself does.
 */
const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

const mcpJson = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(status === 202 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 202 ? {} : { "Content-Type": "application/json" }), ...MCP_CORS, ...extra },
  });

const mcpOptions = httpAction(async () => new Response(null, { status: 204, headers: MCP_CORS }));
/* No server-initiated stream, so the spec's answer to a GET is 405. */
const mcpGet = httpAction(async () => mcpJson({ error: "This endpoint answers POST only." }, 405));
/* Stateless, so there is no session for a client to end. */
const mcpDelete = httpAction(async () => new Response(null, { status: 405, headers: MCP_CORS }));

const mcpPost = httpAction(async (ctx, req) => {
    const who = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const gateOk = await ctx.runMutation(internal.store.mcpRate,
      { who, max: RATE_MAX, windowMs: RATE_WINDOW_MS });
    if (!gateOk.allowed) {
      return mcpJson({ jsonrpc: "2.0", id: null,
        error: { code: -32000, message: `Rate limit reached. ${RATE_MAX} calls per 10 minutes. Try again in ${gateOk.retryAfter} seconds.` } },
        429, { "Retry-After": String(gateOk.retryAfter) });
    }

    /* The token rides in the address, because a connector stores a URL and
       nothing else. No token is an anonymous reader, which is the default and
       needs no account. An unknown token is also just a reader: saying which
       tokens exist would be a way to hunt for one. */
    const sent = new URL(req.url).searchParams.get("k") ?? "";
    const caller = sent
      ? await ctx.runQuery(internal.store.accountByMcpToken, { token: sent })
      : null;

    let msg: any;
    try { msg = await req.json(); }
    catch { return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }

    /* An unsupported protocol version is a 400 under the spec, once a version
       has been agreed. An absent header means an older client, which the spec
       says to read as 2025-03-26. */
    const ver = req.headers.get("MCP-Protocol-Version");
    if (!versionOk(ver, msg)) {
      return mcpJson({ jsonrpc: "2.0", id: null,
        error: { code: -32000, message: `Unsupported MCP-Protocol-Version: ${ver}. This server speaks ${PROTOCOLS.join(", ")}.` } }, 400);
    }

    /* A batch is a list. Notifications drop out, so an all-notification batch
       gets 202 with no body, exactly as a lone notification does. */
    if (Array.isArray(msg)) {
      /* Each call in a batch counts, and a batch holds ten at most. */
      if (msg.length > 10) {
        return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "A batch holds 10 calls at most." } }, 400);
      }
      for (let i = 1; i < msg.length; i++) {
        const more = await ctx.runMutation(internal.store.mcpRate, { who, max: RATE_MAX, windowMs: RATE_WINDOW_MS });
        if (!more.allowed) {
          return mcpJson({ jsonrpc: "2.0", id: null,
            error: { code: -32000, message: `Rate limit reached. ${RATE_MAX} calls per 10 minutes. Try again in ${more.retryAfter} seconds.` } },
            429, { "Retry-After": String(more.retryAfter) });
        }
      }
      const out = (await Promise.all(msg.map((m: any) => handleRpc(ctx, m, caller)))).filter(Boolean);
      return out.length ? mcpJson(out) : mcpJson(null, 202);
    }
    const reply = await handleRpc(ctx, msg, caller);
    return reply ? mcpJson(reply) : mcpJson(null, 202);
});

/**
 * One handler on several addresses, so a client can be pointed at /mcp or at a
 * pinned version and reach the same server.
 *
 * A `pathPrefix` of "/mcp/" alongside the exact "/mcp" route registered without
 * error and then matched nothing: every path under it answered 404 on the live
 * deployment. Exact paths are what this router honours here, so the labels are
 * listed. Adding another is one entry in this array.
 */
const MCP_PATHS = ["/mcp", "/mcp/v0", "/mcp/v1"];

for (const [method, handler] of [
  ["OPTIONS", mcpOptions], ["GET", mcpGet], ["DELETE", mcpDelete], ["POST", mcpPost],
] as const) {
  for (const path of MCP_PATHS) router.route({ path, method, handler });
}

export default router;
