/**
 * Every route the app calls. Two rules hold here and nowhere else can enforce them:
 * the OpenRouter key never leaves this file's process, and no route touches a brain
 * or a model before gate() passes.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ask, json, cors, sha256, slug, randomHex, isOpen, parseJson,
  readSpace, SPACE_NAME, HOME, spaceName, slugOfName, SPACE_RE, SPACES,
  MODEL, PROJECT_MODEL, CHUNK,
  canDrop,
} from "./lib";
import type { Who } from "./lib";
import { handleRpc, versionOk, PROTOCOLS, RATE_MAX, RATE_WINDOW_MS } from "./mcp";
import { dropCheck, dropRead, dropPlan, dropSettle, dropMerge, fetchPage } from "./drop";
import { DOC_STYLE, DOC_BODY } from "./doc";
import { assemble, fromModel, asText, mail, looksLikeMail, pageIds, hasBody, translatePage, langOf, DOC_TYPES } from "./onepager";
import type { DocType } from "./onepager";
import { planDossier, writeDossier, idOf, OPEN_READ, linkId, kindsOf } from "./words";
import { routeQuestion } from "./route";
import { loadSpace, withoutPersonal } from "./space";
import { remember, REPLY_RULES, MAX_CHARS, calledBrains, conceptDump, conceptRules, applyChange, fileVerbatim, plainReply } from "./personal";
import { listConflicts, settleConflict } from "./conflicts";
import { healthOf } from "./health";
/* Projects are off in the app for now; their routes stay for when they come back. */
import { buildPage, TEMPLATE_MAX } from "./projects";
import { rederive, tidyScan } from "./tidy";
import { resolveFeed, sweep, readFind } from "./scouts";
import { embed, nearest } from "./graph";
import {
  ahead, gaps, gapBlock, readGap, interviewStep, pausedLine, summary, notesText, readAnswers, readProfile,
  cleanAnswers, TEST, TEST_IDS, TWIN_RULES, PROFILE_RULES, NATURAL_GAP, RETEST_DAYS, JUDGE_RULES, pairsText, readScores, ownOf, interviewFull,
} from "./twin";
import type { Marks } from "./twin";

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
type Caller = Who & { demo: boolean; byok: boolean; key?: string; visitor: string | null; wsName: string;
  /* The models this workspace picked in Settings, or null for the defaults,
     and its languages: what the personal folder keeps, how answers come back. */
  models: { chat: string | null; project: string | null; reply?: string; voice?: string | null } };
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
  /* A workspace that is gone opens nothing: read as the owner's, it would run on the owner's key. */
  if (!owners.includes(who.space) && !ws) throw new Response("locked", { status: 401 });
  const byok = ws?.kind === "byok";
  const k = String(body?.key ?? "").trim();
  /* The demo always runs on the defaults. */
  const models = demo ? { chat: null, project: null, reply: "same", voice: null } : await ctx.runQuery(internal.store.modelsOf, { space: who.space });
  return { ...who, kind: "owner", demo, byok, models, visitor: demo ? who.visitor : null, wsName: ws?.name ?? spaceName(who.space),
    key: byok ? (KEY_RE.test(k) ? k : undefined) : ws?.kind === "demo" ? (process.env.DEMO_OPENROUTER_API_KEY || undefined) : undefined };
}

/** What the personal folder keeps: English, always, whatever language comes in. */
const storeLang = (_who: Caller): "en" => "en";

/** The key a model call runs on. A workspace on its own key never falls back to the owner's. */
function keyFor(who: Caller): string | undefined {
  if (who.byok && !who.key) throw new Error("this workspace runs on your own OpenRouter key. Add it in Settings, then try again.");
  return who.key;
}

/**
 * The model: the default for a demo visitor. Otherwise the one the workspace
 * picked in Settings, for the chat or for projects. A chat call that still
 * names a model, from an app open since before, keeps it.
 */
const modelFor = (who: Caller, b: any, use: "chat" | "project" = "chat") => {
  if (who.demo) return use === "project" ? PROJECT_MODEL : undefined;
  if (use === "project") return who.models?.project || PROJECT_MODEL;
  const chat = who.models?.chat;
  return modelName(b) ?? (chat && chat !== MODEL ? chat : undefined);
};

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
/* Pages and transcripts fetched for every workspace but the owner's, together, a day. */
const OTHERS_FETCH_DAY = Number(process.env.OTHERS_FETCH_DAY || 100);
/* Each read, plan, merge and settle is a step. A long source takes a dozen or
   so; the month's total stays near 20 a drop. */
const DEMO_STEPS = Number(process.env.DEMO_MONTHLY_STEPS || DEMO_DROPS * 20);
async function demoCount(ctx: any, who: Caller, what: "drop" | "ask" | "step") {
  if (!who.demo) return;
  const max = what === "drop" ? DEMO_DROPS : what === "ask" ? DEMO_ASKS : DEMO_STEPS;
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
const MODEL_ID = /^[a-z0-9~][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
function modelName(body: any): string | undefined {
  const m = String(body?.model ?? "").trim();
  if (!m || m === MODEL) return undefined;
  if (m.length > 80 || !MODEL_ID.test(m)) {
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

  /* Each guess is counted before it is checked, so a burst sent at once
     still gets 8 an hour. A right one clears the count. */
  const t = await ctx.runMutation(internal.store.takeAttempt, { space });
  if (t.locked || !t.salt) return { error: "too many attempts, wait an hour" };
  const good = await sha256(t.salt, pass) === t.hash;
  if (good) await ctx.runMutation(internal.store.noteAttempt, { ok: true, space });
  if (!good) return { error: b.name ? "no workspace has that name and passphrase" : "that is not it" };
  return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner", space }), space };
});

/**
 * The landing's one field. A passphrase opens the workspace it belongs to,
 * whichever that is; one that opens none sends the visitor to the demo.
 *
 * Each door keeps its own 8 tries an hour. This field is counted apart, so a
 * wrong guess here never locks a door: 10 tries an hour from one address and
 * 120 an hour from everyone, after which the list above still opens each
 * workspace on its own page.
 */
const ENTER_PER_ADDRESS = 10, ENTER_ALL = 120;
route("/api/enter", async (ctx, req, b) => {
  const pass = String(b.pass ?? "");
  if (pass.length < 8) return { demo: true };
  const from = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const hour = 60 * 60 * 1000;
  const mine = await ctx.runMutation(internal.store.mcpRate, { who: `enter:${from}`, max: ENTER_PER_ADDRESS, windowMs: hour });
  const all = mine.allowed ? await ctx.runMutation(internal.store.mcpRate, { who: "enter:all", max: ENTER_ALL, windowMs: hour }) : mine;
  if (!all.allowed) return { error: "too many tries here for now. Open your workspace from the list above, or try again in an hour." };
  for (const d of await ctx.runQuery(internal.store.doorsAll, {})) {
    if (await sha256(d.salt, pass) !== d.hash) continue;
    await ctx.runMutation(internal.store.noteAttempt, { ok: true, space: d.space });
    return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner", space: d.space }), space: d.space };
  }
  return { demo: true };
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
  const t = await ctx.runMutation(internal.store.takeAttempt, { space: who.space });
  if (!t.set) return { error: "this workspace has no passphrase to change" };
  if (t.locked || !t.salt) return { error: "too many attempts, wait an hour" };
  const good = await sha256(t.salt, cur) === t.hash;
  if (good) await ctx.runMutation(internal.store.noteAttempt, { ok: true, space: who.space });
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
  const s = { brains, sources, concepts: cards.map((c: any) => {
    /* Typed links only: "needs" makes the learning paths, the rest colour the map. */
    const kinds = kindsOf(c);
    return { brain: c.brain, slug: c.slug, n: c.n, title: c.title, summaryLine: c.summaryLine, updated: c.updated,
      ev: c.ev ?? 0, src: c.src ?? 0, links: (c.related ?? []).length, ...(kinds.length ? { kinds } : {}),
      ...(c.tag ? { tag: c.tag } : {}), ...(c.aliases?.length ? { aliases: c.aliases } : {}) };
  }) };
  const brand = await ctx.runQuery(internal.store.brandOf, { space: who.space });
  const full = await ctx.runQuery(internal.store.modeOf, { space: who.space });
  /* The models in use, and the defaults Settings offers to go back to. */
  const models = { chat: who.models.chat || MODEL, project: who.models.project || PROJECT_MODEL, chatDefault: MODEL, projectDefault: PROJECT_MODEL,
    reply: who.models.reply === "en" ? "en" : "same", voice: who.models.voice ?? null };
  return { ...s, model: models.chat, models, chunk: CHUNK,
           space: who.space, spaceName: who.wsName, demo: who.demo, byok: who.byok, brand, full };
});

/**
 * The models, picked in Settings for the whole workspace: one for the chat,
 * Drop and one-pagers, one for projects. null goes back to the default.
 */
route("/api/models", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const one = (k: "chat" | "project") => {
    if (!(k in b)) return undefined;
    const m = String(b[k] ?? "").trim();
    if (!m) return null;
    if (m.length > 80 || !MODEL_ID.test(m)) throw new Error(`"${m.slice(0, 40)}" is not a model id. They read vendor/model, like ${MODEL}.`);
    return m;
  };
  const chat = one("chat"), project = one("project");
  /* The languages: how answers come back, and the one the mic listens in. */
  const reply = "reply" in b ? (b.reply === "en" ? "en" : "same") : undefined;
  const voice = "voice" in b ? (b.voice ? String(b.voice) : null) : undefined;
  if (chat === undefined && project === undefined && !reply && voice === undefined) return { error: "say which model or language to change" };
  const r = await ctx.runMutation(internal.store.setModels, { space: who.space,
    ...(chat !== undefined ? { chat: chat === MODEL ? null : chat } : {}),
    ...(project !== undefined ? { project: project === PROJECT_MODEL ? null : project } : {}),
    ...(reply ? { reply } : {}), ...(voice !== undefined ? { voice } : {}) });
  return { chat: r.chat || MODEL, project: r.project || PROJECT_MODEL, reply: r.reply, voice: r.voice };
});

/**
 * The side panel: limited shows Chats and Folders, full adds Projects.
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
  if (!c) return { error: "that concept is not in this space" };
  /* What follows from it and a concept of another folder, derived. */
  const insights = await ctx.runQuery(internal.graph.insightsFor, { space: who.space, ids: [`${c.brain}/${c.slug}`] });
  if (c.tag !== "contact") return { concept: { ...c, kinds: kindsOf(c) }, insights };
  /* A person's file also names the people whose files link to them, and
     holds everything said about them word for word: gathered once from the
     chats still kept, then written as each message is filed. */
  const id = `${c.brain}/${c.slug}`;
  const linkedFrom = await ctx.runQuery(internal.store.contactsLinking, { space: who.space, id });
  if (!c.rawScan && !who.demo) { try { await ctx.runMutation(internal.store.rawFromChats, { space: who.space, id }); } catch { /* read what is there */ } }
  /* A file from before moments had rows of their own is split the first time it opens. */
  if (c.file?.legacy && !who.demo) { try { await ctx.runMutation(internal.store.splitContact, { space: who.space, id }); } catch { /* it reads whole as it is */ } }
  const raw = await ctx.runQuery(internal.store.rawOf, { space: who.space, id, n: 300 });
  /* Its pages: the years of its history and the months of its raw notes. */
  const pages = await ctx.runQuery(internal.store.personPages, { space: who.space, id });
  const { legacy: _old, ...file } = c.file ?? {};
  return { concept: { ...c, ...(c.file ? { file } : {}), kinds: kindsOf(c) }, insights, linkedFrom, raw, pages };
});

/** A folder's topics: its concepts that link to each other, named and summed up. */
route("/api/topics", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
  const brain = String(b.brain ?? "");
  if (!head.brains.some((x: any) => x.slug === brain && x.type !== "personal")) return { topics: [] };
  const topics: any[] = await ctx.runQuery(internal.graph.topicsOf, { brain });
  return { topics: topics.map(t => ({ title: t.title, summary: t.summary, members: t.members, updated: t.updated })) };
});

/** The open conflicts that are real contradictions, for Setup. */
route("/api/conflicts", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await listConflicts(ctx, who.space, modelFor(who, b), keyFor(who), { hints: b.hints === true && !who.demo });
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
/**
 * Merge into: a folder poured into another of this workspace. Both must be
 * this workspace's own, never personal, never one shared in from elsewhere.
 */
route("/api/brain/merge", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.store.mergeBrains, { from: String(b.from ?? ""), into: String(b.into ?? ""), space: who.space });
});

/**
 * A folder read for concepts held twice, titles not in English and concepts
 * with no position. Read only: the owner rules on each finding.
 */
route("/api/brain/tidy", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const r: any = await tidyScan(ctx, who, String(b.brain ?? ""), keyFor(who), modelFor(who, b));
  /* Kept on the folder, so the inbox offers each finding until it is decided. */
  if (!r.error) await ctx.runMutation(internal.store.findingsSet, { space: who.space, brain: r.brain,
    findings: { at: new Date().toISOString().slice(0, 10), same: r.same, english: r.english, blank: r.blank.slice(0, 40) } });
  return r;
});

/** Concepts of one folder holding one idea, joined into the first, its position written again. */
route("/api/concept/merge", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const into = String(b.into ?? "");
  const from = (Array.isArray(b.from) ? b.from : []).map(String);
  const r = await ctx.runMutation(internal.store.joinConcepts, { space: who.space, into, from });
  /* The joined evidence holds more than the kept position says. If the model
     fails, the join stands and the old position stays until the next drop. */
  let rewritten = false;
  try { rewritten = (await rederive(ctx, who, [into], keyFor(who), modelFor(who, b))).written.length > 0; } catch (_) {}
  return { ...r, rewritten };
});

route("/api/concept/rename", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.store.renameConcept, { space: who.space, id: String(b.id ?? ""), title: String(b.title ?? "") });
});

/**
 * Positions written again from the evidence each concept holds: one a drop
 * stored with no rewrite, or one Tidy found empty. Eight per request.
 */
route("/api/concept/rederive", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  await demoCount(ctx, who, "step");
  return await rederive(ctx, who, (Array.isArray(b.ids) ? b.ids : []).map(String), keyFor(who), modelFor(who, b));
});

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
/**
 * The transcript service is the owner's, so other workspaces get a few a
 * day each, and one allowance among them all, however many there are. An
 * error line when today's is used, else "".
 */
async function fetchAllowed(ctx: any, who: Caller): Promise<string> {
  if (owners.includes(who.space)) return "";
  const day = 24 * 60 * 60 * 1000;
  let r = await ctx.runMutation(internal.store.mcpRate, who.demo
    ? { who: "fetch:demo", max: DEMO_DROPS + 10, windowMs: MONTH }
    : { who: "fetch:" + who.space, max: 20, windowMs: day });
  if (r.allowed && !who.demo) r = await ctx.runMutation(internal.store.mcpRate, { who: "fetch:others", max: OTHERS_FETCH_DAY, windowMs: day });
  return r.allowed ? "" : "today's allowance of fetched pages and transcripts is used. Paste the text instead.";
}

route("/api/fetch", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const no = await fetchAllowed(ctx, who);
  if (no) return { error: no };
  return await fetchPage(ctx, String(b.url ?? ""));
});

/**
 * Scouts: the feeds a folder follows. "list" by default, "add" a feed to a
 * folder you can drop into (and read it once, keeping its 3 newest pieces),
 * "remove" one, or "check" every feed of the workspace now.
 */
route("/api/scouts", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (who.demo) return { error: "the demo follows no feeds" };
  const action = String(b.action ?? "list");
  const list = async () => await ctx.runQuery(internal.scouts.scoutsOf, { space: who.space });
  if (action === "add") {
    const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
    const brain = head.brains.find((x: any) => x.slug === String(b.brain ?? ""));
    if (!brain || brain.type === "personal" || !canDrop(brain, who)) return { error: "that folder is not one you can feed" };
    let got;
    try { got = await resolveFeed(String(b.url ?? "")); } catch (e: any) { return { error: String(e?.message ?? e) }; }
    const r = await ctx.runMutation(internal.scouts.scoutAdd, { space: who.space, brain: brain.slug, url: String(b.url).trim().slice(0, 500),
      feed: got.feed, name: got.name.slice(0, 120), kind: got.kind, d: new Date().toISOString().slice(0, 10) });
    if (r.error) return r;
    const found = await sweep(ctx, who.space, r.scout);
    return { scout: r.scout, found, scouts: await list() };
  }
  if (action === "remove") {
    const r = await ctx.runMutation(internal.scouts.scoutRemove, { space: who.space, id: String(b.id ?? "") });
    return r.error ? r : { scouts: await list() };
  }
  if (action === "check") {
    const all: any[] = await list();
    let at = 0, found = 0;
    const one = async () => { while (at < all.length) found += await sweep(ctx, who.space, all[at++]); };
    await Promise.all([one(), one(), one(), one(), one(), one()]);
    return { found, scouts: await list() };
  }
  return { scouts: await list() };
});

/**
 * What the scouts found. "list" the ones waiting on a call; "read" one
 * against its folder, once, on the workspace's key; "text" hands back what it
 * read, so dropping it fetches nothing again; "skip" and "dropped" close it.
 */
route("/api/finds", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  if (who.demo) return { finds: [] };
  const action = String(b.action ?? "list");
  if (action === "list") return { finds: await ctx.runQuery(internal.scouts.findsOf, { space: who.space }) };
  const f = await ctx.runQuery(internal.scouts.findGet, { space: who.space, id: String(b.id ?? "") });
  if (!f) return { error: "that find is gone" };
  if (action === "skip" || action === "dropped")
    return await ctx.runMutation(internal.scouts.findSet, { space: who.space, id: f.id, status: action === "skip" ? "skipped" : "dropped" });
  if (action === "text") return { link: f.link, title: f.title, author: f.author, date: f.date, text: f.text };
  if (action === "read") {
    if (f.status === "read") return { read: f.read };
    const no = await fetchAllowed(ctx, who);
    if (no) return { error: no };
    return await readFind(ctx, who.space, f, keyFor(who), modelFor(who, b));
  }
  return { error: "say list, read, text, skip or dropped" };
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
     key and the demo skip it rather than spend the owner's. */
  if (who.byok || who.demo) return { linking: 0 };
  if (ids.length) await ctx.scheduler.runAfter(0, internal.admin.linkConcepts, { space: who.space, ids, sid });
  return { linking: ids.length };
});

/* ---------- ask ---------- */

route("/api/ask", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* A chat opened on one concept reads that concept alone. */
  if (b.concept) return await conceptChat(ctx, who, b);
  /* Every brain in this space answers questions, whoever is asking. A personal
     brain answers in its own chat only, and no other chat reads it. */
  const every = await loadSpace(ctx, who.space, undefined, { personal: true });
  /* A project's chat reads the project's folders, with its instructions. */
  const proj = b.project ? await ctx.runQuery(internal.projects.get, { space: who.space, id: String(b.project) }) : null;
  if (b.project && !proj) return { error: "that project is gone" };
  const only = !proj && b.brain && b.brain !== "all" ? String(b.brain) : null;
  const mine = only ? every.brains.find((x: any) => x.slug === only && x.type === "personal") : null;
  if (mine) return await personalChat(ctx, who, b, mine, every);
  const { brains, cards: concepts, sources } = withoutPersonal(every);
  /* Folders ticked in the side panel: two or more travel as a list, and the
     question reads those alone. A personal brain never joins it. */
  const ticked = proj ? proj.brains : Array.isArray(b.brains) ? [...new Set(b.brains.map(String))].slice(0, 60) : [];
  const many = ticked.length > 1 || !!proj;
  const pool = many ? brains.filter((x: any) => ticked.includes(x.slug))
    : only ? brains.filter((x: any) => x.slug === only) : brains;
  if (proj && !pool.length) return { answer: "None of this project's folders is here any more. Pick others in its settings." };
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
  const mKey = keyFor(who), mName = modelFor(who, b, proj ? "project" : "chat");
  await demoCount(ctx, who, "ask");
  const t0 = Date.now();
  const route = await routeQuestion(pool, concepts, String(b.q ?? ""), b.history, mKey, mName);
  /* The concepts closest in meaning to the question. Embeddings run on the
     deployment's key, so a workspace on its own key and the demo go by words
     and the router alone. */
  let near: string[] = [];
  if (!who.byok && !who.demo) {
    try {
      const [vec] = await embed([String(b.q ?? "").slice(0, 1000)]);
      near = (await nearest(ctx, vec, pool.map((x: any) => x.slug), 8)).map(x => x.id);
    } catch (e: any) { console.log(`question embedding skipped: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  /* Ranked on the slim copies; only the concepts that lead are read whole. */
  const plan = planDossier(pool, concepts, String(b.q ?? ""), b.history, { ...route, near });
  const whole = await ctx.runQuery(internal.store.conceptsByIds,
    { space: who.space, ids: plan.lead.slice(0, OPEN_READ).map(idOf) });
  const pick = writeDossier(pool, plan, new Map(whole.map((c: any) => [idOf(c), c])));
  /* What follows from the opened concepts and the ones they link to across
     folders: derived, and said so. */
  const derived: any[] = pick.opened.length ? await ctx.runQuery(internal.graph.insightsFor, { space: who.space, ids: pick.opened.map(idOf) }) : [];
  const dossier = pick.dossier + (derived.length
    ? `\n\nWHAT FOLLOWS, Tasu's own conclusions from two linked concepts, never a source:\n` +
      derived.slice(0, 6).map((x: any) => `- ${x.title}: ${x.text}`).join("\n")
    : "");
  const reading = pool.filter((x: any) => pick.opened.some((c: any) => c.brain === x.slug));
  /* The map's heat: the concepts this question opened lead, six at most. A
     failed count costs the map one question, never the answer. */
  if (pick.opened.length) {
    try { await ctx.runMutation(internal.store.heatAdd, { space: who.space, ids: pick.opened.slice(0, 6).map(idOf), d: new Date().toISOString().slice(0, 10) }); }
    catch { /* the answer goes on */ }
  }
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
    { role: "system", content: `You are the user's own knowledge base, answering from what it holds. ${who.models?.reply === "en" ? "You answer in English, whatever language the question is written in." : "You answer in the language the question is written in."}` },
    { role: "user", content:
`Answer the question from the stored knowledge below.
${proj ? `
PROJECT: ${proj.name}
THE OWNER'S INSTRUCTIONS FOR THIS PROJECT (they set the focus and the form of the answer; they are never a source)
${String(proj.instructions || "none").slice(0, 2000)}
` : ""}
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
${who.models?.reply === "en" ? "- Write in English, whatever language the question is in. The sources line stays as it is."
  : "- Write in the language of the QUESTION: a question in French gets French, one in English gets English. The stored knowledge is in English; translate what you use, numbers and names kept as they are. The sources line stays as it is."}
- No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording. Say what holds rather than what does not.
- ALWAYS ANSWER WITH WHAT IS HELD, even when it is partial. Lead with the closest thing the stored knowledge says on the subject: how the term is used, what it sits beside, the method it belongs to, the related figures. A short partial answer beats a refusal.
- When the question asks what a named term, formula or rule is, and the stored knowledge uses it without spelling it out, give its textbook form on one line that starts "General knowledge, not from your sources:". Only that one line comes from outside, and never a figure, a date or a view.
- AT MOST ONE SENTENCE about what is missing, as the last line before the sources, naming the kind of source that would fill it. Never open with it, never list what is absent, never write that you cannot answer.
- Write about the subject, never about the knowledge base: no "the stored knowledge", "it only names", "it does hold", except in that one last sentence.
- Never invent evidence.
- A WHAT FOLLOWS line is a conclusion drawn from two concepts, not a source. Use one only when it answers the question, and say so: "Taken together, ...".
- LINKS say how concepts relate: "needs" names what must be understood first, "causes" what it drives. Follow them when the question asks why, how or in what order.
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
  /* Low temperature: the same question, on the same knowledge, reads the same. */
  ], { maxTokens: level === "normal" ? 2000 : learning ? 2400 : 3200, key: mKey, model: mName, temperature: 0.2,
       /* The browser waits 3 minutes. The router's time comes out of the
          answer's, so the two never add up past it. */
       timeout: Math.max(60000, 165000 - (Date.now() - t0)) });

  /* The app keeps its conversations: a question sent with "chat" joins that
     chat, or starts one. A failed save is only a chat that does not list it. */
  if (proj) {
    try {
      await ctx.runMutation(internal.projects.turn, { space: who.space, id: proj.id,
        turn: { q: String(b.q ?? "").slice(0, 2000), a: text, level, sources: nSources, at: Date.now() } });
    } catch { /* the answer still goes out */ }
    return { answer: text, sources: nSources, level, project: proj.id };
  }
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
/** Who the twin is: its profile, written to them as "you", for the twin to speak as "I". Empty before a profile is written. */
function twinOf(row: any): string {
  /* At 100% the notes and the contacts hold everything the profile would say, and a profile written earlier would only be stale. */
  if (interviewFull(summary(row))) return "";
  const parts = Array.isArray(row?.profile?.parts) ? row.profile.parts : [];
  if (!parts.length) return "";
  return `YOUR TWIN PROFILE: who you are, how you decide and how you speak. It is written to them as "you"; you speak it as "I".\n` +
    parts.map((p: any) => `${p.title}: ${(p.points ?? []).join(" ")}`).join("\n").slice(0, 6000) + "\n\n";
}

async function personalChat(ctx: any, who: Caller, b: any, mine: any, every: any) {
  const mKey = keyFor(who), mName = modelFor(who, b);
  if (!String(b.q ?? "").trim()) return { error: "write something first" };
  /* An interview under way takes the message as its answer. */
  const row = who.demo ? null : await ctx.runQuery(internal.store.interviewGet, { space: who.space, brain: mine.slug });
  if (row?.on) return await interviewTurn(ctx, who, b, mine, every.cards, row, false);
  const q = String(b.q ?? "").slice(0, MAX_CHARS.chat).trim();
  await demoCount(ctx, who, "ask");
  /* Now and then the chat asks one of the interview's questions in passing:
     every few messages, when they asked nothing, from the chapters the notes
     cover least. The reply tags the one it asked. */
  const marks: Marks = row?.marks ?? {};
  const offer = !who.demo && (row?.sinceAsk ?? NATURAL_GAP) >= NATURAL_GAP && !/\?\s*$/.test(q) ? gaps(marks, q, 3) : [];
  const date = new Date().toISOString().slice(0, 10);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-4);
  const last = history.slice(-1).map((h: any) => `They said: ${String(h.q ?? "").slice(0, 500)}\nThe brain replied: ${String(h.a ?? "").slice(0, 600)}`).join("");
  /* This personal brain and every brain that is not personal: the reply may
     call on any of them without being asked. */
  const pool = every.brains.filter((x: any) => x.type !== "personal" || x.slug === mine.slug);
  const others = pool.filter((x: any) => x.slug !== mine.slug);
  const cards = every.cards.filter((c: any) => pool.some((x: any) => x.slug === c.brain));
  const t0 = Date.now();

  const filing = fileTwice(t => remember(ctx, { space: who.space, brain: mine.slug, cards: every.cards, text: q, context: last, kind: "chat", date, lang: storeLang(who),
    model: async m => (await ask(m, { json: true, maxTokens: 4000, key: mKey, model: mName, timeout: t })).text }))
    .catch(() => null);
  const reply = (async () => {
    const route = await routeQuestion(pool, cards, q, b.history, mKey, mName);
    const plan = planDossier(pool, cards, q, b.history, route);
    const whole = await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids: plan.lead.slice(0, OPEN_READ).map(idOf) });
    const pick = writeDossier(pool, plan, new Map(whole.map((c: any) => [idOf(c), c])));
    const earlier = history.map((h: any) => `They said: ${String(h.q ?? "").slice(0, 400)}\nYou replied: ${String(h.a ?? "").slice(0, 800)}`).join("\n\n");
    const { text } = await ask([
      { role: "system", content: REPLY_RULES + (who.models?.reply === "en" ? "\n- Reply in English, whatever language they write in." : "") },
      { role: "user", content: `TODAY: ${date}\n\n${twinOf(row)}${earlier ? `EARLIER IN THIS CHAT\n${earlier}\n\n` : ""}` +
        `THEIR OTHER BRAINS, yours to call on: ${others.map((x: any) => `${x.name} (${x.type})`).join(", ") || "none yet"}\n\n` +
        `WHAT THEIR NOTES AND BRAINS HOLD (entries "in ${mine.name}" are their own notes; every other entry comes from the brain it names)\n${pick.dossier}\n\n` +
        `${offer.length ? gapBlock(offer) + "\n\n" : ""}THEIR MESSAGE\n${q}` },
    ], { maxTokens: 1200, key: mKey, model: mName, timeout: Math.max(60000, 160000 - (Date.now() - t0)) });
    return text;
  })();
  const [said, filed] = await Promise.all([reply, filing]);
  const { text: gapless, asked } = readGap(said, offer);
  const answer = plainReply(gapless);
  const called = calledBrains(answer, others);

  /* A question asked in passing counts as answered once the next message
     files something; one ignored is left to be asked again some day. */
  let interview: any = null;
  if (!who.demo) {
    try {
      const was = row?.pending?.kind === "natural" ? row.pending : null;
      const next: Marks = { ...marks };
      if (was && filed && (filed.new || filed.updated)) next[was.id] = "a";
      const saved = await ctx.runMutation(internal.store.interviewSet, { space: who.space, brain: mine.slug, patch: {
        marks: next, sinceAsk: asked ? 0 : (row?.sinceAsk ?? NATURAL_GAP) + 1,
        pending: asked ? { id: asked.id, kind: "natural", text: asked.text, follow: 0 } : null } });
      interview = summary(saved);
    } catch { /* the reply still goes out */ }
  }

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
           called, ...(interview ? { interview } : {}), ...(chat ? { chat } : {}) };
}

/**
 * A filing tried twice, a moment apart, inside one time budget. A busy model,
 * a cut reply or a dropped call costs one retry, not what the owner said.
 *
 * Two full tries in a row ran past the response deadline: a first try that
 * timed out at 90 seconds and a second one after it kept the request open
 * about 3 minutes, and the app saw "The server did not answer" three times
 * over on one interview answer. Now the second try runs only on the time the
 * first one left, and each try gets `first` at most.
 */
async function fileTwice<T>(run: (timeout: number) => Promise<T>, o: { budget?: number; first?: number } = {}): Promise<T> {
  const budget = o.budget ?? 120000, first = Math.min(o.first ?? 90000, budget), t0 = Date.now();
  try { return await run(first); }
  catch (e) {
    const left = budget - (Date.now() - t0) - 1500;
    if (left < 25000) throw e;
    await new Promise(ok => setTimeout(ok, 1500));
    return await run(Math.min(first, left));
  }
}

/* ---------- a chat about one concept ---------- */

/**
 * A chat opened on one concept. It reads that concept alone, and answers
 * from it. In the personal folder it also changes it: what the message adds
 * or corrects is written to the note or the person's file at once, dated,
 * in English, with the message kept word for word in a person's raw notes.
 */
async function conceptChat(ctx: any, who: Caller, b: any) {
  const id = String(b.concept ?? "");
  const q = String(b.q ?? "").slice(0, MAX_CHARS.chat).trim();
  if (!q) return { error: "write something first" };
  const home = await ctx.runQuery(internal.store.conceptHome, { space: who.space, id });
  if (!home) return { error: "that concept is not in this space" };
  const { concept: c, brain: folder } = home;
  const personal = folder.type === "personal";
  if (personal && who.demo) return { error: "that concept is not in this space" };
  const contact = personal && c.tag === "contact";
  const mKey = keyFor(who), mName = modelFor(who, b);
  await demoCount(ctx, who, "ask");
  const date = new Date().toISOString().slice(0, 10);
  const english = who.models?.reply === "en";
  const raw = contact ? (await ctx.runQuery(internal.store.rawOf, { space: who.space, id, n: 40 })).notes : [];
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6);
  const earlier = history.map((h: any) => `They said: ${String(h.q ?? "").slice(0, 400)}\nYou replied: ${String(h.a ?? "").slice(0, 800)}`).join("\n\n");
  const dump = conceptDump(c, raw);

  let answer = "", changed: any = null;
  if (personal) {
    const { text, finish } = await ask([
      { role: "system", content: "You keep a person's own notes and the files of the people they know. You reply with JSON only." },
      { role: "user", content: `${conceptRules(c.title, contact, english)}\n\nTODAY: ${date}\n\n` +
        `${earlier ? `EARLIER IN THIS CHAT\n${earlier}\n\n` : ""}THE ${contact ? "PERSON" : "NOTE"}\n${dump}\n\nTHEIR MESSAGE\n${q}` },
    ], { json: true, maxTokens: 4000, key: mKey, model: mName, timeout: 120000, temperature: 0.2 });
    const d = parseJson(String(text), finish);
    if (!d || typeof d !== "object") return { error: "the reply could not be read. Send it again." };
    answer = String(d.reply ?? "").replace(/\s*—\s*/g, ", ").trim();
    if (d.change && typeof d.change === "object")
      changed = await applyChange(ctx, { space: who.space, brain: folder.slug, c, q, change: d.change, date });
    if (!answer) answer = changed ? `Saved to ${c.title}.` : "Nothing to change there.";
  } else {
    const isPerson = folder.type === "person";
    const r = await ask([
      { role: "system", content: `You are the user's own knowledge base, in a chat about one concept. ${english ? "You answer in English, whatever language the question is written in." : "You answer in the language the question is written in."}` },
      { role: "user", content:
`Answer the question from this one concept alone: "${c.title}", in the folder ${folder.name}.

- The first sentence answers the question. One sentence per line, each ending with a full stop.
- 3 to 6 sentences, unless the question asks for another shape. A list asked for is a list.
- Numbers, dates and findings go inside the answer. Newer evidence wins on the same question.
${isPerson ? "- This is a PERSON folder: name that person throughout." : "- Never put a source's name in the answer text. Attribution belongs on the sources line only."}
- Only what the concept below holds. Never invent evidence.
- When the question goes beyond this concept, say in one sentence that this chat covers ${c.title} alone and that the main chat reads every folder.
- Then a blank line, then one line: "Sources: {author}, {date} - {author}, {date}" listing only the evidence you used. Omit it if you used none.
- No em-dashes. Under 30 words per sentence. Simple wording. No file paths.
${earlier ? `
EARLIER IN THIS CHAT (context only, never a source)
${earlier}
` : ""}
THE CONCEPT
${dump}

QUESTION: ${q}` },
    ], { maxTokens: 1600, key: mKey, model: mName, temperature: 0.2, timeout: 150000 });
    answer = r.text;
  }

  const nSources = new Set((c.evidence ?? []).map((e: any) => e.source).filter(Boolean)).size;
  let chat: string | undefined;
  if ("chat" in b) {
    try {
      const r = await ctx.runMutation(internal.store.chatTurn, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}),
        id: typeof b.chat === "string" ? b.chat : null, brain: folder.slug, concept: id, title: `About ${c.title}`,
        turn: { q: q.slice(0, 2000), a: answer, level: "normal", sources: personal ? 0 : nSources, at: Date.now(), concept: id,
                ...(changed ? { changed } : {}) } });
      chat = r.id;
    } catch { /* the answer still goes out */ }
  }
  return { answer, sources: personal ? 0 : nSources, level: "normal", concept: { id, title: c.title, brain: folder.slug, personal },
           changed, ...(chat ? { chat } : {}) };
}

/* ---------- the interview ---------- */

/**
 * One turn of a personal brain's interview, with the chat it lands in. The
 * turn itself, what it files, asks and marks, is interviewStep's.
 */
async function interviewTurn(ctx: any, who: Caller, b: any, mine: any, cards: any[], row: any, opening: boolean) {
  const mKey = keyFor(who), mName = modelFor(who, b);
  const q = opening ? "" : String(b.q ?? "").slice(0, MAX_CHARS.interview).trim();
  const date = new Date().toISOString().slice(0, 10);
  const step = await interviewStep(ctx, { space: who.space, brain: mine.slug, cards, row, q, opening, date, english: who.models?.reply === "en",
    model: async m => (await ask(m, { json: true, maxTokens: 900, key: mKey, model: mName, timeout: 90000, temperature: 0.4 })).text,
    /* A filing that fails is tried once more: an answer lost costs the owner a retype. */
    file: async (text, context) => {
      const run = (t: number) => remember(ctx, { space: who.space, brain: mine.slug, cards, text, context, kind: "interview", date, lang: storeLang(who),
        model: async m => (await ask(m, { json: true, maxTokens: 4000, key: mKey, model: mName, timeout: t })).text });
      return await fileTwice(run);
    } });
  let chat: string | undefined;
  if ("chat" in b) {
    try {
      const r = await ctx.runMutation(internal.store.chatTurn, { space: who.space, id: typeof b.chat === "string" ? b.chat : null, brain: mine.slug,
        turn: { q: q.slice(0, 2000), a: step.reply, level: "normal", sources: 0, at: Date.now(), filed: step.filed ?? null, called: [],
                interview: true, ...(opening ? { title: "Interview" } : {}) } });
      chat = r.id;
    } catch { /* the reply still goes out */ }
  }
  return { answer: step.reply, sources: 0, level: "normal", personal: true, filed: step.filed, called: [],
           interview: summary(step.saved), ...(chat ? { chat } : {}) };
}

/** A personal brain of this workspace with its cards alone: what the interview reads. */
async function personalOf(ctx: any, space: string, slug: string) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  const mine = head.brains.find((x: any) => x.slug === slug && x.type === "personal");
  if (!mine) return null;
  const cards: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: any = await ctx.runQuery(internal.store.cardsPage, { brain: mine.slug, cursor, ready: head.ready });
    cards.push(...p.cards);
    if (p.done) break;
    cursor = p.cursor;
  }
  return { mine, cards };
}

/** Every note of a personal brain whole, for the twin and the profile. */
async function wholeNotes(ctx: any, space: string, brain: string) {
  const out: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: any = await ctx.runQuery(internal.store.conceptsOfBrain, { space, brain, cursor });
    out.push(...p.concepts);
    if (!p.next) break;
    cursor = p.next;
  }
  return out;
}

/** The twin test as the app shows it: the questions, both rounds, the twin's answers and the scores. */
function testView(row: any) {
  const t = row?.test ?? {};
  const from = t.mineAt ? new Date(Date.parse(t.mineAt) + RETEST_DAYS * 86400000).toISOString().slice(0, 10) : null;
  return { questions: TEST.map((text, i) => ({ id: TEST_IDS[i], text })), mine: ownOf(t.mine), again: ownOf(t.again), twin: ownOf(t.twin),
           twinScore: ownOf(t.twinScore), selfScore: ownOf(t.selfScore), mineAt: t.mineAt ?? null, againAt: t.againAt ?? null,
           twinAt: t.twinAt ?? null, retestFrom: from };
}

/**
 * A personal brain's interview, and its twin test and profile, by action:
 *   state     where it stands, the test and the profile
 *   start     on, and the next question (or the first)
 *   stop      paused where it stands
 *   restart   every question unasked again; the notes stay
 *   answers   the owner's test answers, round 1 or the retest; never filed
 *   twin      the twin answers the test from the notes alone
 *   score     0 to 2 per question, by a model comparing the two answers: the twin against round 1, or with `kind: "self"` round 2 against round 1
 *   profile   the notes written as 7 parts
 * Only the owner, and only their personal brain: nothing else reads it.
 */
route("/api/interview", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const got = await personalOf(ctx, who.space, String(b.brain ?? ""));
  if (!got) return { error: "that is not a personal brain of this workspace" };
  const { mine, cards } = got;
  const row = await ctx.runQuery(internal.store.interviewGet, { space: who.space, brain: mine.slug });
  const save = (patch: any) => ctx.runMutation(internal.store.interviewSet, { space: who.space, brain: mine.slug, patch });
  const today = new Date().toISOString().slice(0, 10);
  const test = { ...(row?.test ?? {}) };
  const view = (r: any) => ({ interview: summary(r), test: testView(r), profile: r?.profile ?? null });
  switch (String(b.action ?? "state")) {
    case "state": return view(row);
    case "start": {
      if (!ahead(row?.marks ?? {}, 1).length && row) return { error: "every question is answered or skipped. Start over to go again." };
      const r = await save({ on: true });
      /* The first start explains how it works: the count goes up after it. */
      const out = await interviewTurn(ctx, who, b, mine, cards, { ...r, opens: row?.opens ?? 0 }, true);
      await save({ opens: (row?.opens ?? 0) + 1 });
      return out;
    }
    case "stop": {
      const r = await save({ on: false });
      return { ...view(r), answer: pausedLine(summary(r)) };
    }
    case "restart": return view(await save({ on: false, marks: {}, pending: null, sinceCheck: 0, sinceAsk: 0 }));
    case "answers": {
      const round = Number(b.round) === 2 ? 2 : 1;
      const answers = cleanAnswers(b.answers);
      if (Object.keys(answers).length < 5) return { error: "answer at least 5 of the 10 questions first" };
      /* New answers make the old scores against them meaningless. */
      if (round === 1) Object.assign(test, { mine: answers, mineAt: today, twinScore: {}, selfScore: {} });
      else Object.assign(test, { again: answers, againAt: today, selfScore: {} });
      return view(await save({ test }));
    }
    case "twin": {
      const notes = notesText(await wholeNotes(ctx, who.space, mine.slug));
      if (notes.used < 5) return { error: "your twin needs at least 5 notes to answer. Talk to it or run the interview first." };
      const { text, finish } = await ask([
        { role: "system", content: "You answer as one person would, from their own notes. You reply with JSON only." },
        { role: "user", content: `${TWIN_RULES}\n\nTHEIR NOTES\n${notes.text}\n\nQUESTIONS\n${TEST.map((t, i) => `${TEST_IDS[i]}: ${t}`).join("\n")}` },
      ], { json: true, maxTokens: 4000, key: keyFor(who), model: modelFor(who, b), timeout: 150000, temperature: 0.3 });
      const twin = readAnswers(text);
      if (Object.keys(twin).length < 5) return { error: finish === "length" ? "the answer ran out of room. Try again." : "your twin could not answer this time. Try again." };
      Object.assign(test, { twin, twinAt: today, twinScore: {} });
      return view(await save({ test }));
    }
    case "score": {
      /* A model compares the two answers to each question: no one scores their own twin. */
      const self = b.kind === "self";
      const left = ownOf<string>(test.mine), right = ownOf<string>(self ? test.again : test.twin);
      const pairs = pairsText(left, right);
      if (!pairs) return { error: self ? "answer the test again first" : "let your twin answer first" };
      const { text, finish } = await ask([
        { role: "system", content: "You compare two answers to the same question and score how well they match. You reply with JSON only." },
        { role: "user", content: `${JUDGE_RULES}\n\nQUESTIONS\n${pairs}` },
      ], { json: true, maxTokens: 1500, key: keyFor(who), model: modelFor(who, b), timeout: 120000, temperature: 0 });
      const scores = readScores(text, right);
      if (!Object.keys(scores).length) return { error: finish === "length" ? "the comparison ran out of room. Try again." : "the answers could not be compared this time. Try again." };
      Object.assign(test, self ? { selfScore: scores } : { twinScore: scores });
      return view(await save({ test }));
    }
    case "profile": {
      const notes = notesText(await wholeNotes(ctx, who.space, mine.slug));
      if (notes.used < 5) return { error: "the profile needs at least 5 notes. Talk to it or run the interview first." };
      const { text, finish } = await ask([
        { role: "system", content: "You write a person's profile from their own notes. You reply with JSON only." },
        { role: "user", content: `${PROFILE_RULES}\n\nTHEIR NOTES\n${notes.text}` },
      ], { json: true, maxTokens: 4000, key: keyFor(who), model: modelFor(who, b), timeout: 150000, temperature: 0.3 });
      const parts = readProfile(text);
      if (parts.length < 3) return { error: finish === "length" ? "the profile ran out of room. Try again." : "the profile could not be written this time. Try again." };
      return view(await save({ profile: { parts, at: today, notes: notes.used } }));
    }
    default: return { error: "that is not something the interview does" };
  }
});

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
  /* A chat message that was not filed, sent again from its reply, is filed
     as the message it was; anything else is a memory brought in. */
  const kind = b.kind === "chat" ? "chat" : "import";
  if (!text) return { error: "there is nothing to remember in that" };
  if (text.length > MAX_CHARS[kind]) return { error: `send at most ${MAX_CHARS[kind]} characters at a time` };
  const date = new Date().toISOString().slice(0, 10);
  /* What two filings of an import still left out, kept as written: no model call. */
  if (b.verbatim === true && kind === "import")
    return { filed: await fileVerbatim(ctx, who.space, mine.slug, text.split("\n"), date) };
  const mKey = keyFor(who), mName = modelFor(who, b);
  /* "gaps": the passages a first filing of this import left out, filed again. */
  const filed = await fileTwice(t => remember(ctx, { space: who.space, brain: mine.slug, cards: every.cards, text, kind, lang: storeLang(who),
    date, gaps: kind === "import" && b.gaps === true,
    model: async m => (await ask(m, { json: true, maxTokens: kind === "chat" ? 4000 : 6000, key: mKey, model: mName, timeout: t })).text }),
    { budget: 160000, first: 120000 });
  return { filed };
});

/**
 * The people in a personal brain's notes, filed as contacts, 20 notes a call.
 * The app calls it again with `at` until `next` is null. Each person's card
 * is joined, never doubled, so running it twice only adds what is new.
 */
route("/api/personal/people", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const got = await personalOf(ctx, who.space, String(b.brain ?? ""));
  if (!got) return { error: "that is not a personal brain of this workspace" };
  const whole = await wholeNotes(ctx, who.space, got.mine.slug);
  const mKey = keyFor(who), mName = modelFor(who, b);
  const date = new Date().toISOString().slice(0, 10);
  /* Second phase: the people held with no file yet get one, built from their
     card and every dated mention, 5 people a call. */
  if (b.phase === "files") {
    const bare = whole.filter((c: any) => c.tag === "contact" && !c.file).sort((x: any, y: any) => (x.n ?? 0) - (y.n ?? 0));
    const part = bare.slice(0, 5);
    if (!part.length) return { filed: { new: 0, updated: 0, titles: [], people: [] }, next: null, left: 0 };
    const text = part.map((c: any) => `- CONTACT "${c.title}"${(c.aliases ?? []).length ? ` (also: ${c.aliases.join(", ")})` : ""}\n  CARD: ${String(c.position || c.summaryLine || "").replace(/\s+/g, " ").slice(0, 2500)}\n  WHAT YOU SAID ABOUT THEM:\n` +
      (c.evidence ?? []).slice(0, 60).map((e: any) => `  - ${e.date ?? "?"}: ${String(e.claim ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")).join("\n\n");
    const filed = await fileTwice(t => remember(ctx, { space: who.space, brain: got.mine.slug, cards: got.cards, text, kind: "files", date, lang: storeLang(who),
      model: async m => (await ask(m, { json: true, maxTokens: 12000, key: mKey, model: mName, timeout: t })).text }),
      { budget: 160000, first: 150000 });
    /* A person the model passed over gets an empty file, so the run moves on. */
    for (const c of part) if (!(filed.people ?? []).some(t => t === c.title))
      await ctx.runMutation(internal.store.fileContact, { brain: got.mine.slug, title: c.title, slug: c.slug, date, doc: {}, add: {} });
    return { filed, next: bare.length > part.length ? 0 : null, left: Math.max(0, bare.length - part.length), total: bare.length };
  }
  const all = whole.filter((c: any) => c.tag !== "contact").sort((x: any, y: any) => (x.n ?? 0) - (y.n ?? 0));
  const at = Math.max(0, Math.floor(Number(b.at) || 0)), part = all.slice(at, at + 20);
  const next = at + 20 < all.length ? at + 20 : null;
  if (!part.length) return { filed: { new: 0, updated: 0, titles: [], people: [] }, next: null, read: all.length, total: all.length };
  const text = part.map((c: any) => `- ${c.title} (${c.evidence?.[0]?.date || c.updated || "?"}): ${String(c.position || c.summaryLine || "").replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
  const filed = await remember(ctx, { space: who.space, brain: got.mine.slug, cards: got.cards, text, kind: "people", date, lang: storeLang(who),
    model: async m => (await ask(m, { json: true, maxTokens: 8000, key: mKey, model: mName, timeout: 150000 })).text });
  return { filed, next, read: Math.min(at + 20, all.length), total: all.length };
});

/**
 * An audit run on a folder this workspace holds: "done" stamps the day and
 * the sources it held, so the inbox counts what was dropped since; "apart"
 * keeps two or more concepts or people apart for good.
 */
route("/api/brain/audit", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
  const brain = head.brains.find((x: any) => x.slug === String(b.brain ?? ""));
  if (!brain || !(brain.type === "personal" ? brain.space === who.space || (!brain.space && who.space === HOME) : canDrop(brain, who)))
    return { error: "that folder is not one you can audit" };
  if (b.action === "apart") {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x: string) => x.startsWith(brain.slug + "/"));
    if (ids.length < 2) return { error: "name two concepts to keep apart" };
    return await ctx.runMutation(internal.store.auditMark, { space: who.space, brain: brain.slug, apart: ids });
  }
  /* A finding you ruled out: a title kept as it is, a position left empty. */
  if (b.action === "dismiss") {
    const kind = String(b.kind ?? "");
    if (!["english", "blank"].includes(kind)) return { error: "say english or blank" };
    return await ctx.runMutation(internal.store.findingsDrop, { space: who.space, brain: brain.slug, kind, id: String(b.id ?? "") });
  }
  return await ctx.runMutation(internal.store.auditMark, { space: who.space, brain: brain.slug });
});

/** One page of a person: the moments of a year, or the raw notes of a month. */
route("/api/personal/page", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const year = /^\d{4}$/.test(String(b.year ?? "")) ? String(b.year) : undefined;
  const month = /^\d{4}-\d{2}$/.test(String(b.month ?? "")) ? String(b.month) : undefined;
  if (!year && !month) return { error: "pick a year or a month" };
  return await ctx.runQuery(internal.store.personPage, { space: who.space, id: String(b.id ?? ""), ...(year ? { year } : { month }) });
});

export const MERGE_RULES =
`Below are the cards of one person, filed under different names, and every dated thing their owner said about them. Write one card.

- "position": the person's summary, 3 to 6 sentences, written to the owner as "you": who the person is to you, how you met, their work and city, what matters most about them now. Their full history and facts stay in their file; this is the summary on top of it. When two facts disagree, state the newer one.
- "summaryLine": who they are to you, under 15 words.
- Only what the cards and the mentions say. Write in the language asked below. No em-dashes. Under 30 words per sentence.

Reply with only JSON: {"position":"","summaryLine":""}`;

/**
 * A person's card in a personal brain, by action: "edit" sets its name,
 * other names, card and line by hand; "merge" folds other cards of the same
 * person into it, then writes the joined card again as one.
 */
route("/api/personal/contact", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const brain = String(b.id ?? b.into ?? "").split("/")[0];
  const got = await personalOf(ctx, who.space, brain);
  if (!got) return { error: "that is not a personal brain of this workspace" };
  if (b.action === "edit") {
    return await ctx.runMutation(internal.store.contactEdit, { space: who.space, id: String(b.id ?? ""),
      ...(typeof b.title === "string" ? { title: b.title } : {}),
      ...(Array.isArray(b.aliases) ? { aliases: b.aliases.map(String).slice(0, 20) } : {}),
      ...(typeof b.position === "string" ? { position: b.position } : {}),
      ...(typeof b.summaryLine === "string" ? { summaryLine: b.summaryLine } : {}) });
  }
  if (b.action === "part") {
    return await ctx.runMutation(internal.store.contactPart, { space: who.space, id: String(b.id ?? ""), part: String(b.part ?? ""),
      key: String(b.key ?? ""), ...(typeof b.done === "boolean" ? { done: b.done } : {}) });
  }
  if (b.action === "merge") {
    const into = String(b.into ?? ""), from = (Array.isArray(b.from) ? b.from : []).map(String).filter((x: string) => x.split("/")[0] === brain).slice(0, 10);
    if (!from.length) return { error: "pick the card to merge into this one" };
    const before = await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids: [into, ...from] });
    const r = await ctx.runMutation(internal.store.contactMerge, { space: who.space, into, from });
    if (!r.joined) return { error: "those cards could not be merged" };
    /* The two texts sit side by side until the joined card is written as one. */
    let rewritten = false;
    try {
      const cards = before.map((c: any) => `CARD "${c.title}"${(c.aliases ?? []).length ? ` (also: ${c.aliases.join(", ")})` : ""}\n${String(c.position || c.summaryLine || "").slice(0, 3000)}`).join("\n\n");
      const said = before.flatMap((c: any) => (c.evidence ?? []).map((e: any) => `- ${e.date ?? "?"}: ${String(e.claim ?? "").slice(0, 300)}`)).slice(0, 80).join("\n");
      const { text, finish } = await ask([
        { role: "system", content: "You keep a person's own contact cards. You reply with JSON only." },
        { role: "user", content: `${MERGE_RULES}\nLANGUAGE: English.\n\n${cards}\n\nWHAT THEY SAID, DATED\n${said || "(nothing)"}` },
      ], { json: true, maxTokens: 3000, key: keyFor(who), model: modelFor(who, b), timeout: 90000, temperature: 0.2 });
      const d = parseJson(String(text), finish) ?? {};
      const position = String(d.position ?? "").replace(/\s*—\s*/g, ", ").trim();
      const line = String(d.summaryLine ?? "").replace(/\s*—\s*/g, ", ").trim().slice(0, 200);
      if (position.length > 20) {
        await ctx.runMutation(internal.store.contactEdit, { space: who.space, id: into, position, ...(line ? { summaryLine: line } : {}) });
        rewritten = true;
      }
    } catch { /* the joined card keeps both texts */ }
    return { into, joined: r.joined, rewritten };
  }
  return { error: "that is not something a contact does" };
});

/* ---------- error reports ---------- */

/**
 * Send feedback: an error the app could not get past, mailed to the
 * deployment's owner when the person asks. It carries the error, where it
 * happened, the workspace and the message behind it. A personal message of
 * another workspace keeps its words to itself. The address is FEEDBACK_TO,
 * else DIGEST_TO, in this deployment's environment, never in the code and
 * never sent to the app.
 */
route("/api/feedback", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const flat = (t: any, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const error = flat(b.error, 600);
  if (!error) return { error: "there is no error to send" };
  const to = String(process.env.FEEDBACK_TO || process.env.DIGEST_TO || "").trim();
  if (!to) return { error: "feedback has no address on this deployment yet: run npx convex env set FEEDBACK_TO you@example.com --prod" };
  const ok = await ctx.runMutation(internal.store.feedbackLog, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}), error });
  if (!ok.ok) return { error: "that is 5 reports this hour. The ones sent already reached us." };
  const where = flat(b.where, 40) || "the app";
  const said = b.personal && !owners.includes(who.space) ? "(a personal message: its words stay private)" : flat(b.q, 1500);
  const at = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const page = {
    title: `Tasu error: ${error.slice(0, 70)}`,
    line: `${who.wsName}, ${where}, ${at}`,
    sections: [{ head: "", bullets: [
      { k: "Error", say: error },
      { k: "Where", say: where },
      { k: "Workspace", say: `${who.wsName} (${who.space})${who.demo ? ", the demo" : who.byok ? ", on its own key" : ""}` },
      ...(said ? [{ k: "Message", say: said }] : []),
      ...(b.chat ? [{ k: "Chat", say: flat(b.chat, 60) }] : []),
      { k: "Model", say: who.models?.chat || MODEL },
      ...(b.agent ? [{ k: "Browser", say: flat(b.agent, 240) }] : []),
    ] }],
    foot: "Sent with Send feedback, from the app.",
  };
  await mail(to, page, who.space);
  return { sent: true };
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

/* ---------- projects ---------- */

/**
 * What Projects lists: the projects, newest first, and every one-pager kept.
 * The demo has no projects; each visitor sees the one-pagers they built.
 */
route("/api/projects", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const pagers = await ctx.runQuery(internal.store.pagerList, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}) });
  if (who.demo) return { projects: [], pagers, demo: true };
  return { projects: await ctx.runQuery(internal.projects.list, { space: who.space }), pagers };
});

/** A kept one-pager, to open again. */
route("/api/onepagers/get", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const p = await ctx.runQuery(internal.store.pagerGet, { space: who.space, id: String(b.id ?? ""), ...(who.visitor ? { owner: who.visitor } : {}) });
  return p ? { pager: p } : { error: "that one-pager is gone" };
});

/** A kept one-pager, deleted. */
route("/api/onepagers/remove", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runMutation(internal.store.pagerRemove, { space: who.space, id: String(b.id ?? ""), ...(who.visitor ? { owner: who.visitor } : {}) });
});

/** One project whole: settings, chat, versions, and its newest page. */
route("/api/projects/get", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const p = await ctx.runQuery(internal.projects.get, { space: who.space, id: String(b.id ?? "") });
  return p ? { project: p } : { error: "that project is gone" };
});

/** One version of a project's page. */
route("/api/projects/page", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const p = await ctx.runQuery(internal.projects.page, { space: who.space, id: String(b.id ?? ""), v: Number(b.v) || 0 });
  return p ? { page: p } : { error: "that version is gone" };
});

/**
 * A new project, or new settings for one. Its folders must be ones this
 * workspace reads, and never a personal one.
 */
route("/api/projects/save", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const { brains } = withoutPersonal(await ctx.runQuery(internal.store.spaceHead, { space: who.space }));
  const here = new Set(brains.map((x: any) => x.slug));
  const picked = [...new Set<string>((Array.isArray(b.brains) ? b.brains : []).map(String))].filter(x => here.has(x));
  let template: string | null | undefined;
  if (b.template === null) template = null;
  else if (typeof b.template === "string") {
    if (b.template.length > TEMPLATE_MAX) return { error: `a template holds ${Math.round(TEMPLATE_MAX / 1000)} KB at most` };
    if (!/<[a-z!]/i.test(b.template)) return { error: "that template is not HTML" };
    template = b.template;
  }
  return await ctx.runMutation(internal.projects.save, { space: who.space, ...(b.id ? { id: String(b.id) } : {}),
    name: String(b.name ?? ""), brains: picked, instructions: String(b.instructions ?? ""), auto: b.auto === true,
    ...(template !== undefined ? { template } : {}),
    ...(typeof b.templateName === "string" ? { templateName: b.templateName.replace(/[^\w .()-]/g, "").slice(0, 80) } : {}) });
});

/** A project and its pages, deleted. */
route("/api/projects/remove", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.projects.remove, { space: who.space, id: String(b.id ?? "") });
});

/** The project's chat, cleared. Its page stays. */
route("/api/projects/clear", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.projects.clear, { space: who.space, id: String(b.id ?? "") });
});

/** An answer from the chat, held for the next Build, or taken back. Nothing is built here. */
route("/api/projects/queue", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const q = String(b.q ?? "").trim(), a = String(b.a ?? "").trim();
  if (!q || !a) return { error: "an answer to add needs its question and its answer" };
  return await ctx.runMutation(internal.projects.queue, { space: who.space, id: String(b.id ?? ""), q, a, remove: b.remove === true });
});

/**
 * Build: the next version of the page, from the folders as they stand and
 * the answers that wait for it. The only way a page changes from the app.
 */
route("/api/projects/build", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const id = String(b.id ?? "");
  const p = await ctx.runQuery(internal.projects.get, { space: who.space, id });
  if (!p) return { error: "that project is gone" };
  const n = (p.pending ?? []).length;
  const r = await buildPage(ctx, who.space, id, {
    why: n ? `Built with ${n} answer${n === 1 ? "" : "s"} added` : "Built",
    key: keyFor(who), model: modelFor(who, b, "project") });
  return { v: r.v, at: r.at, html: r.html };
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
/** Every link between two concepts, inside a folder and across folders, for the map. */
route("/api/map", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const { cards } = await loadSpace(ctx, who.space);
  const known = new Set(cards.map((c: any) => `${c.brain}/${c.slug}`));
  const seen = new Map<string, number>(), links: [string, string, string][] = [];
  for (const c of cards) {
    const from = `${c.brain}/${c.slug}`;
    const kinds = new Map(kindsOf(c).map(k => [k.to, k.type]));
    for (const r of c.related ?? []) {
      const to = linkId(String(r), c.brain);
      if (!known.has(to) || to === from) continue;
      const key = [from, to].sort().join("|"), type = kinds.get(to) ?? "related";
      /* One line per pair: the reading that says the most wins. */
      const at = seen.get(key);
      if (at !== undefined) { if (links[at][2] === "related" && type !== "related") links[at] = [from, to, type]; continue; }
      seen.set(key, links.length); links.push([from, to, type]);
    }
  }
  /* The heat: questions per concept in the last 90 days, for the concepts
     the map shows. A personal brain is never among them. */
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const all: Record<string, number> = await ctx.runQuery(internal.store.heatOf, { space: who.space, since });
  const heat: Record<string, number> = {};
  for (const id of Object.keys(all)) if (known.has(id)) heat[id] = all[id];
  return { links, heat };
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

  /* "all", or a list of brain slugs and groups ("person", "subject"),
     joined by commas: one folder, several, or a whole group. */
  const pick = String(b.pick ?? "all").trim() || "all";
  const parts = pick.split(",").map(x => x.trim()).filter(Boolean).slice(0, 200);
  const brains = parts.includes("all") ? all
    : all.filter((x: any) => parts.includes(x.slug) || parts.includes(x.type === "person" ? "person" : "subject"));
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
  /* Every page built is kept, and listed under Projects by its title. A page
     built again only to be mailed is the one kept already. A failed save is
     only a page the list does not show. */
  let saved: string | undefined;
  if (b.keep !== false) {
    try {
      const ask = { pick, q, kind, ...(kind === "custom" ? { doc } : {}), ...(note ? { note } : {}), ...(lang !== "English" ? { lang } : {}) };
      saved = (await ctx.runMutation(internal.store.pagerSave, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}),
        page, text: asText(page), ask })).id;
    } catch { /* the page still goes out */ }
  }
  const keptAs = saved ? { saved } : {};

  /* The language the page came back in, and why it is English when another
     one was asked for, so the app never shows the wrong one without saying so. */
  const said = { lang: page.untranslated ? "English" : lang,
    ...(page.untranslated ? { warning: `The ${lang} translation did not come back after two tries, so this page is in English. Build it again to retry.` } : {}) };
  if (!to) return { page, text: asText(page), ...said, ...keptAs };
  /* A page that built and failed to send is still a page. It comes back with the
     reason, so a question already paid for is not thrown away with the mail. */
  /* Thirty mails a day per space, so this address cannot be used to spam. */
  const quota = await ctx.runMutation(internal.store.mcpRate,
    { who: "mail:" + who.space, max: 30, windowMs: 24 * 60 * 60 * 1000 });
  if (!quota.allowed) {
    return { page, text: asText(page), sent: false, to, ...said, ...keptAs,
             mailError: `30 pages were mailed today. Mail opens again in ${Math.ceil(quota.retryAfter / 3600)} hours.` };
  }
  try {
    const sent = await mail(to, page, who.space);
    return { page, text: asText(page), sent: true, to, id: sent.id, ...said, ...keptAs };
  } catch (e: any) {
    return { page, text: asText(page), sent: false, to, ...said, ...keptAs, mailError: String(e?.message ?? e).slice(0, 300) };
  }
});

/* ---------- the public read the /brains page uses ---------- */

/**
 * Same exposure as the MCP server, in one JSON document, so a static page can
 * render the brains without a passphrase. Every Octopus brain is published
 * here; a personal brain never is.
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
