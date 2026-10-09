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
  MODEL, MODEL_ID, CHUNK,
  canDrop,
} from "./lib";
import type { Who } from "./lib";
import { handleRpc, versionOk, PROTOCOLS, RATE_MAX, RATE_WINDOW_MS } from "./mcp";
import { dropCheck, dropRead, dropPlan, dropSettle, dropMerge, fetchPage } from "./drop";
import { DOC_STYLE, DOC_BODY } from "./doc";
import { assemble, fromModel, asText, mail, looksLikeMail, pageIds, hasBody, translatePage, langOf, DOC_TYPES } from "./onepager";
import type { DocType } from "./onepager";
import { planDossier, writeDossier, idOf, OPEN_READ, linkId, kindsOf, dedupeOpen, tagsOf, taggedLine } from "./words";
import { routeQuestion } from "./route";
import { loadSpace, withoutPersonal, cardsFor } from "./space";
import { projectChat, addDocPiece, addRowPiece, finishFile, fileInstructions, readBlocks } from "./project";
import { colNames, downloadText, csvOf, parseCsv, madeName } from "./sheet";
import { remember, REPLY_RULES, MAX_CHARS, calledBrains, conceptDump, conceptRules, applyChange, fileVerbatim, plainReply, openByPerson, OPEN_RULES, readOpenUpdates, oneLine, personPeek } from "./personal";
import { listConflicts, settleConflict } from "./conflicts";
import { healthOf } from "./health";
import { rederive, tidyScan } from "./tidy";
import { embed, nearest } from "./graph";
import {
  ahead, gaps, gapBlock, readGap, interviewStep, pausedLine, summary, notesText, readTwin, readProfile,
  cleanAnswers, TWIN_RULES, PROFILE_RULES, NATURAL_GAP, JUDGE_RULES, pairsText, readScores, interviewFull, pickTest, testView, scorePct, questionOf, TEST_N, HISTORY_MAX,
  DEDUCE_MIN, DEDUCE_RULES, readQuestions, roundQs,
} from "./twin";
import type { RoundQ } from "./twin";
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
  models: { chat: string | null; reply?: string; voice?: string | null;
    /* Favourite models, when the workspace has them: the cheapest of them is the one in `chat`. */
    favs?: string[]; favAt?: number | null; favPrices?: { id: string; price: number }[] } };
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
  const models = demo ? { chat: null, reply: "same", voice: null } : await ctx.runQuery(internal.store.modelsOf, { space: who.space });
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
 * picked in Settings. A call that still names a model, from an app open since
 * before, keeps it.
 */
const modelFor = (who: Caller, b: any) => {
  if (who.demo) return undefined;
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
    /* Typed links only: "needs" says what to learn first and what follows. */
    const kinds = kindsOf(c);
    return { brain: c.brain, slug: c.slug, n: c.n, title: c.title, summaryLine: c.summaryLine, updated: c.updated,
      ev: c.ev ?? 0, src: c.src ?? 0, links: (c.related ?? []).length, ...(kinds.length ? { kinds } : {}),
      ...(c.tag ? { tag: c.tag } : {}), ...(c.aliases?.length ? { aliases: c.aliases } : {}),
      ...(c.tag === "contact" && c.open != null ? { open: c.open } : {}) };
  }) };
  const brand = await ctx.runQuery(internal.store.brandOf, { space: who.space });
  /* The projects: their own list, so no folder list, picker or count ever holds one. */
  const projects = who.demo ? [] : await ctx.runQuery(internal.projects.projectsOf, { space: who.space });
  /* The model in use, and the default Settings offers to go back to. */
  const models = { chat: who.models.chat || MODEL, chatDefault: MODEL,
    reply: who.models.reply === "en" ? "en" : "same", voice: who.models.voice ?? null,
    ...(who.models.favs?.length ? { favs: who.models.favs, favAt: who.models.favAt ?? null, favPrices: who.models.favPrices ?? [] } : {}) };
  return { ...s, projects, model: models.chat, models, chunk: CHUNK,
           space: who.space, spaceName: who.wsName, demo: who.demo, byok: who.byok, brand };
});

/**
 * The model, picked in Settings for the whole workspace: it answers, reads
 * Drop and writes one-pagers. null goes back to the default. A model picked
 * here, or the default, ends the daily choice among favourites, if there was one.
 */
route("/api/models", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const one = (k: "chat") => {
    if (!(k in b)) return undefined;
    const m = String(b[k] ?? "").trim();
    if (!m) return null;
    if (m.length > 80 || !MODEL_ID.test(m)) throw new Error(`"${m.slice(0, 40)}" is not a model id. They read vendor/model, like ${MODEL}.`);
    return m;
  };
  const chat = one("chat");
  /* The languages: how answers come back, and the one the mic listens in. */
  const reply = "reply" in b ? (b.reply === "en" ? "en" : "same") : undefined;
  const voice = "voice" in b ? (b.voice ? String(b.voice) : null) : undefined;
  if (chat === undefined && !reply && voice === undefined) return { error: "say which model or language to change" };
  const r = await ctx.runMutation(internal.store.setModels, { space: who.space,
    ...(chat !== undefined ? { chat: chat === MODEL ? null : chat, favs: null } : {}),
    ...(reply ? { reply } : {}), ...(voice !== undefined ? { voice } : {}) });
  return { chat: r.chat || MODEL, reply: r.reply, voice: r.voice, favs: r.favs ?? null };
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
  /* Projects load too: only the personal chat reads their memory, and withoutPersonal drops them for every other chat. */
  const every = await loadSpace(ctx, who.space, undefined, { personal: true, projects: true });
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  const mine = only ? every.brains.find((x: any) => x.slug === only && x.type === "personal") : null;
  if (mine) return await personalChat(ctx, who, b, mine, every);
  const { brains, cards: concepts, sources } = withoutPersonal(every);
  /* Folders ticked in the side panel: two or more travel as a list, and the
     question reads those alone. A personal brain never joins it. */
  const ticked = Array.isArray(b.brains) ? [...new Set(b.brains.map(String))].slice(0, 60) : [];
  const many = ticked.length > 1;
  const scoped = many ? brains.filter((x: any) => ticked.includes(x.slug))
    : only ? brains.filter((x: any) => x.slug === only) : brains;
  /* Folders tagged with @ in the message: the message named them, so they are read, and no other. */
  const tags = tagsOf(b.tags, brains);
  const pool = tags.length ? brains.filter((x: any) => tags.includes(x.slug)) : scoped;
  if (many && !tags.length && !pool.length) return { answer: "None of the ticked folders is here any more. Tick others, or ask them all." };
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
  const tagged = tags.length ? pool.map((x: any) => ({ slug: x.slug, name: x.name })) : [];
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
    { role: "system", content: `You are the user's own knowledge base, answering from what it holds. ${who.models?.reply === "en" ? "You answer in English, whatever language the question is written in." : "You answer in the language the question is written in."}` },
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
${tagged.length ? taggedLine(tagged, pick.opened) + "\n\n" : ""}STORED KNOWLEDGE
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
  let chat: string | undefined;
  if ("chat" in b) {
    try {
      const r = await ctx.runMutation(internal.store.chatTurn, { space: who.space, ...(who.visitor ? { owner: who.visitor } : {}),
        id: typeof b.chat === "string" ? b.chat : null, brain: many ? scoped.map((x: any) => x.slug).join(",") : only ?? "all",
        turn: { q: String(b.q ?? "").slice(0, 2000), a: text, level, sources: nSources, at: Date.now(), ...(tagged.length ? { tagged: tagged.map((x: any) => x.name) } : {}) } });
      chat = r.id;
    } catch { /* the answer still goes out */ }
  }
  return { answer: text, sources: nSources, level, ...(tagged.length ? { tagged: tagged.map((x: any) => x.name) } : {}), ...(chat ? { chat } : {}) };
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
  const reach = every.brains.filter((x: any) => x.type !== "personal" || x.slug === mine.slug);
  /* A folder or a project tagged with @ is called on purpose: the reply reads their notes and the folders tagged, and no other. */
  const tags = tagsOf(b.tags, reach.filter((x: any) => x.slug !== mine.slug));
  const pool = tags.length ? reach.filter((x: any) => x.slug === mine.slug || tags.includes(x.slug)) : reach;
  const others = pool.filter((x: any) => x.slug !== mine.slug);
  const tagged = tags.length ? others.map((x: any) => ({ slug: x.slug, name: x.name })) : [];
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
        `${tagged.length ? taggedLine(tagged, pick.opened, "THEY") + "\n\n" : ""}` +
        `WHAT THEIR NOTES AND BRAINS HOLD (entries "in ${mine.name}" are their own notes; every other entry comes from the brain it names)\n${pick.dossier}\n\n` +
        `${offer.length ? gapBlock(offer) + "\n\n" : ""}THEIR MESSAGE\n${q}` },
    ], { maxTokens: 1200, key: mKey, model: mName, timeout: Math.max(60000, 160000 - (Date.now() - t0)) });
    return text;
  })();
  const [said, filed] = await Promise.all([reply, filing]);
  const { text: gapless, asked } = readGap(said, offer);
  const answer = plainReply(gapless);
  /* A brain they tagged was called, whatever the reply says; the others are the ones the reply names. */
  const called = [...new Set([...tagged.map((x: any) => String(x.name)), ...calledBrains(answer, others)])];

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

/**
 * A personal brain's interview, and its twin test and profile, by action:
 *   state     where it stands, the test and the profile
 *   start     on, and the next question (or the first)
 *   stop      off, where it stands
 *   restart   every question asked again
 *   test      a round of 5 fresh messages to reply to, the open one when there is one; `fresh: true` starts another.
 *             Built from your notes and the people in them: a message you could receive, whose reply they imply and never state.
 *             One model call. The interview's bank asks what the notes cannot make
 *   check     your replies to the round, and the twin replies the same from the notes alone, with its reasons
 *   score     a model compares the twin's answers with yours, 0 to 2 each; the round goes into the history
 *   learn     your answers filed as notes, and the questions marked answered in the interview
 *   profile   the notes written as 7 parts, offered until the interview reaches 100%
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
    case "test": {
      const t = test as any, history = Array.isArray(t.history) ? t.history : [];
      if (t.round && b.fresh !== true) return view(row);
      /* The seed is what came before: the same history gives the same round, a new one a new round. */
      const seed = history.length * 7919 + Number(today.replace(/-/g, "")) + (b.fresh === true && t.round ? 1 : 0);
      /* A round put aside counts as asked, so the new one never repeats it. */
      const put = t.round ? roundQs(t.round) : [];
      const seen = t.round ? [{ items: put.map(x => ({ id: x.id })) }, ...history] : history;
      /* The items are messages you could receive, built from what you said: the notes imply the reply and never state it.
         One model call, only when a round opens. Too few notes, or no answer from the model, and the bank asks them. */
      const asked = [...put.map(x => x.q), ...history.flatMap((h: any) => (h.items ?? []).map((i: any) => String(i.q ?? "")))].filter(Boolean).slice(0, 40);
      const held = await wholeNotes(ctx, who.space, mine.slug);
      const own = held.filter((c: any) => c.tag !== "contact"), people = held.filter((c: any) => c.tag === "contact");
      let qs: RoundQ[] = [], note: string | null = own.length < DEDUCE_MIN ? "thin" : null;
      if (!note) {
        try {
          const { text } = await ask([
            { role: "system", content: "You write situations that test whether an AI twin could reply to a person's emails and messages from their notes. You reply with JSON only." },
            { role: "user", content: `${DEDUCE_RULES}\n\nTHEIR NOTES\n${notesText(own, 28000).text}${people.length ? `\n\nTHE PEOPLE THEY KNOW\n${notesText(people, 10000).text}` : ""}${asked.length ? `\n\nALREADY ASKED, never again\n${asked.map(q => `- ${q}`).join("\n")}` : ""}` },
          ], { json: true, maxTokens: 2000, key: keyFor(who), model: modelFor(who, b), timeout: 100000, temperature: 0.7 });
          qs = readQuestions(text, held.map((c: any) => String(c.title)), asked);
        } catch { /* the bank asks them */ }
        if (!qs.length) note = "failed";
      }
      for (const q of pickTest(row?.marks ?? {}, seen, seed)) { if (qs.length >= TEST_N) break; qs.push({ id: q.id, q: q.text }); }
      return view(await save({ test: { history, round: { at: today, qs, ...(note ? { note } : {}) } } }));
    }
    case "check": {
      const t = test as any, round = t.round;
      if (!round) return { error: "start a test first" };
      const qs = roundQs(round);
      const answers = cleanAnswers(b.answers, qs.map(x => x.id));
      if (Object.keys(answers).length < 3) return { error: `answer at least 3 of the ${TEST_N} questions first` };
      const notes = notesText(await wholeNotes(ctx, who.space, mine.slug));
      if (notes.used < 5) return { error: "your twin needs at least 5 notes to answer. Talk to it or run the interview first." };
      const ids = Object.keys(answers), asked = qs.filter(x => answers[x.id]);
      const { text, finish } = await ask([
        { role: "system", content: "You answer as one person would, from their own notes. You reply with JSON only." },
        { role: "user", content: `${TWIN_RULES}\n\nTHEIR NOTES\n${notes.text}\n\nQUESTIONS\n${asked.map(x => `${x.id}: ${x.q}`).join("\n")}` },
      ], { json: true, maxTokens: 3000, key: keyFor(who), model: modelFor(who, b), timeout: 150000, temperature: 0.3 });
      const { answers: twin, because } = readTwin(text, ids);
      if (Object.keys(twin).length < Math.min(3, ids.length)) return { error: finish === "length" ? "the answer ran out of room. Try again." : "your twin could not answer this time. Try again." };
      return view(await save({ test: { history: t.history ?? [], round: { ...round, qs, mine: answers, twin, because } } }));
    }
    case "score": {
      /* A model compares the two answers to each question: no one scores their own twin. */
      const t = test as any, round = t.round;
      if (!round?.mine || !round?.twin) return { error: "let your twin answer first" };
      const qs = roundQs(round), ids: string[] = qs.map(x => x.id).filter(id => round.mine[id]);
      const pairs = pairsText(qs, round.mine, round.twin);
      if (!pairs) return { error: "let your twin answer first" };
      const { text, finish } = await ask([
        { role: "system", content: "You compare two answers to the same question and score how well they match. You reply with JSON only." },
        { role: "user", content: `${JUDGE_RULES}\n\nQUESTIONS\n${pairs}` },
      ], { json: true, maxTokens: 1200, key: keyFor(who), model: modelFor(who, b), timeout: 120000, temperature: 0 });
      const scores = readScores(text, round.twin);
      if (!Object.keys(scores).length) return { error: finish === "length" ? "the comparison ran out of room. Try again." : "the answers could not be compared this time. Try again." };
      const entry = { at: today, pct: scorePct(scores), learned: false,
        items: qs.filter(x => round.mine[x.id]).map(x => ({ id: x.id, q: x.q, mine: round.mine[x.id], twin: round.twin[x.id] ?? "",
          ...(round.because?.[x.id] ? { because: round.because[x.id] } : {}), score: scores[x.id] ?? null })) };
      return view(await save({ test: { history: [entry, ...(t.history ?? [])].slice(0, HISTORY_MAX), round: null } }));
    }
    case "learn": {
      /* The answers just given go into the notes, the way an interview answer does, and count as answered. */
      const t = test as any, history: any[] = Array.isArray(t.history) ? t.history : [];
      const entry = history[0];
      if (!entry || entry.learned !== false) return { ...view(row), filed: { new: 0, updated: 0, titles: [], people: [] } };
      const items = (entry.items ?? []).filter((i: any) => i.mine);
      const mKey = keyFor(who), mName = modelFor(who, b);
      const text = items.map((i: any, n: number) => `${n + 1}. ${i.mine}`).join("\n");
      const context = `Each numbered answer below is the owner's own reply to the message or question with the same number. File what it shows: the decision, the numbers, the rule behind it, and how they write to that person.\n${items.map((i: any, n: number) => `${n + 1}. ${i.q}`).join("\n")}`;
      const run = (tm: number) => remember(ctx, { space: who.space, brain: mine.slug, cards, text, context, kind: "interview", date: today, lang: storeLang(who),
        model: async m => (await ask(m, { json: true, maxTokens: 4000, key: mKey, model: mName, timeout: tm })).text });
      const filed = await fileTwice(run);
      const marks: any = { ...(row?.marks ?? {}) };
      for (const i of items) if (questionOf(i.id)) marks[i.id] = "a";
      const next = [{ ...entry, learned: true }, ...history.slice(1)];
      return { ...view(await save({ marks, test: { history: next, round: t.round ?? null } })), filed };
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
 * What is still open in a personal brain, for every person at once.
 * "list" (the default): the people with an open line, the oldest first, each
 * line with its key. "send": the owner's comments on some lines, read in one
 * model call. A line is closed, dropped or reworded, and a follow-up or a
 * moment of the person's history may follow. Each comment is kept word for
 * word in that person's raw notes, dated.
 */
route("/api/personal/open", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const got = await personalOf(ctx, who.space, String(b.brain ?? ""));
  if (!got) return { error: "that is not a personal brain of this workspace" };
  const { mine, cards } = got;
  /* Each person's card carries how many lines are open, so the app counts them without reading a file.
     Cards made before that read it here, once: the ones that differ are written. */
  const list = async (held?: any[]) => {
    held = held ?? await wholeNotes(ctx, who.space, mine.slug);
    /* Lines that say the same thing are made one, in the file and in what is listed. */
    for (const c of held) {
      if (c.tag !== "contact" || !c.file?.open?.length) continue;
      const r = dedupeOpen(c.file.open, [c.title, ...(c.aliases ?? [])]);
      if (!r.merged) continue;
      try { await ctx.runMutation(internal.store.contactOpenMerge, { space: who.space, id: `${mine.slug}/${c.slug}` }); c.file = { ...c.file, open: r.open }; } catch { /* listed merged, saved next time */ }
    }
    const people = openByPerson(held, mine.slug);
    const n = new Map(people.map(p => [p.id.split("/")[1], p.items.length]));
    const stale = cards.filter((c: any) => c.tag === "contact" && (c.open ?? -1) !== (n.get(c.slug) ?? 0)).map((c: any) => ({ slug: c.slug, n: n.get(c.slug) ?? 0 }));
    for (let i = 0; i < stale.length; i += 200) await ctx.runMutation(internal.store.setOpenCounts, { brain: mine.slug, counts: stale.slice(i, i + 200) });
    for (const c of cards) if (c.tag === "contact") c.open = n.get(c.slug) ?? 0;
    return people;
  };
  if (b.action !== "send") return { people: await list() };

  const date = new Date().toISOString().slice(0, 10);
  const asked = (Array.isArray(b.updates) ? b.updates : []).slice(0, 25)
    .map((u: any) => ({ id: String(u?.id ?? ""), k: String(u?.k ?? ""), comment: oneLine(u?.comment, 500) }))
    .filter((u: any) => u.comment && u.k && u.id.split("/")[0] === mine.slug);
  if (!asked.length) return { error: "write a comment on at least one line first" };
  const held = await wholeNotes(ctx, who.space, mine.slug);
  const byId = new Map<string, any>(held.filter((c: any) => c.tag === "contact").map((c: any) => [`${mine.slug}/${c.slug}`, c]));
  const lines = asked.map((u: any) => {
    const c = byId.get(u.id), it = (c?.file?.open ?? []).find((x: any) => x.k === u.k && !x.done);
    return it ? { ...u, c, it } : null;
  }).filter(Boolean) as any[];
  if (!lines.length) return { error: "those lines are already gone", people: await list(held) };

  const groups = new Map<string, any[]>();
  for (const l of lines) (groups.get(l.id) || groups.set(l.id, []).get(l.id)!).push(l);
  /* The items are numbered 1, 2, 3 in the order told, so the model echoes a number and no key. */
  const order: any[] = [...groups.values()].flat();
  order.forEach((l, i) => { l.n = i + 1; });
  const text = [...groups].map(([, ls]) => {
    /* The person's other open lines, so a follow-up never repeats one. */
    const rest = (ls[0].c.file?.open ?? []).filter((x: any) => !x.done && !ls.some((l: any) => l.it.k === x.k)).map((x: any) => x.t);
    return `PERSON: ${ls[0].c.title}${ls[0].c.summaryLine ? `, ${ls[0].c.summaryLine}` : ""}\n` +
      ls.map((l: any) => `${l.n}. ITEM: ${l.it.t} (open since ${l.it.at ?? "?"}). COMMENT: "${l.comment}"`).join("\n") +
      (rest.length ? `\nALREADY OPEN, not commented: ${rest.slice(0, 15).join("; ")}` : "");
  }).join("\n\n");
  /* One more try when the first reply cannot be read, with the shape said again. */
  let decided: ReturnType<typeof readOpenUpdates> = [], finish = "";
  for (let attempt = 0; attempt < 2 && !decided.length; attempt++) {
    const r = await ask([
      { role: "system", content: "You keep the open items of a person's contacts up to date from what their owner says. You reply with JSON only." },
      { role: "user", content: `${OPEN_RULES}\n\nTODAY: ${date}\n\n${text}${attempt ? `\n\nYour last reply could not be read. Reply with only the JSON, {"items":[...]}, one entry per numbered item, 1 to ${order.length}.` : ""}` },
    ], { json: true, maxTokens: 3000, key: keyFor(who), model: modelFor(who, b), timeout: 90000, temperature: 0.2 });
    finish = r.finish;
    decided = readOpenUpdates(r.text, order.length);
    if (!decided.length) console.log(`open lines: no decision read, try ${attempt + 1}, finish ${r.finish}, ${String(r.text ?? "").length} characters`);
    if (finish === "length") break;
  }
  if (!decided.length) return { error: finish === "length" ? "the answer ran out of room. Send fewer lines." : "the comments could not be read this time. Try again." };

  const sum = { done: 0, dropped: 0, changed: 0, followed: 0, moments: 0, kept: 0 };
  /* The lines to send again: the ones the model passed over, and the ones that did not save. */
  const retry: { id: string; k: string }[] = order.filter((l: any) => !decided.some(d => d.n === l.n)).map((l: any) => ({ id: l.id, k: l.k }));
  for (const [id, ls] of groups) {
    const mine1 = ls.map((l: any) => ({ l, d: decided.find(d => d.n === l.n) })).filter((x: any) => x.d);
    if (!mine1.length) continue;
    const change: any = { open: [], events: [] };
    try {
      /* A line closes, goes or is reworded by its key, so the words need no matching. */
      for (const { l, d } of mine1) {
        const at = { space: who.space, id, part: "open", key: l.k };
        if (d.status === "done") { await ctx.runMutation(internal.store.contactPart, { ...at, done: true }); sum.done++; }
        else if (d.status === "drop") { await ctx.runMutation(internal.store.contactPart, at); sum.dropped++; }
        else if (d.text && d.text.toLowerCase() !== String(l.it.t).toLowerCase()) { await ctx.runMutation(internal.store.contactPart, { ...at, text: d.text }); sum.changed++; }
        else sum.kept++;
        for (const f of d.follow) if (change.open.length < 10) { change.open.push({ text: f }); sum.followed++; }
        if (d.moment && change.events.length < 20) { change.events.push(d.moment); sum.moments++; }
      }
      /* What follows, and the owner's own words, dated, in the person's notes. */
      const said = mine1.map(({ l }: any) => `Re "${l.it.t}": ${l.comment}`);
      change.claim = oneLine(said.join(" "), 600);
      await applyChange(ctx, { space: who.space, brain: mine.slug, c: ls[0].c, q: said.join("\n"), change, date });
    } catch { retry.push(...mine1.map(({ l }: any) => ({ id, k: l.k }))); }
  }
  return { ...sum, retry, people: await list() };
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
  const brain = String(b.id ?? b.into ?? (Array.isArray(b.ids) ? b.ids[0] : "") ?? "").split("/")[0];
  const got = await personalOf(ctx, who.space, brain);
  if (!got) return { error: "that is not a personal brain of this workspace" };
  /* Up to 20 cards of this brain, each as a short file, so a call on two of them is made by looking. */
  if (b.action === "peek") {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x: string) => x.split("/")[0] === brain).slice(0, 20);
    const cards = ids.length ? await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids }) : [];
    return { people: cards.filter((c: any) => c.tag === "contact").map(personPeek) };
  }
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

/* ---------- projects ---------- */

/**
 * A project: one file or one table, a chat beside it, and a memory of its own.
 * Only the workspace's owner makes, fills, asks and changes one. A project is
 * never shared and no other chat reads it; the personal chat reads its memory.
 * The file is read in the browser and arrives a piece at a time, each piece
 * cut in sections with a contents line, so a file of any size goes in.
 */
route("/api/project/new", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const name = String(b.name ?? "");
  const slug = await ctx.runMutation(internal.projects.projectCreate, { space: who.space, name });
  /* From nothing: an empty document, page or table, for the chat to write by what the owner describes. */
  const make = String(b.make ?? "");
  if (make) {
    try {
      await ctx.runMutation(internal.projects.fileMake, { space: who.space, brain: slug, kind: make, name: madeName(name, make) });
    } catch (e) { await wipeProject(ctx, who.space, slug, false); throw e; }
  }
  return { slug };
});

route("/api/project/list", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return { projects: who.demo ? [] : await ctx.runQuery(internal.projects.projectsOf, { space: who.space }) };
});

route("/api/project/get", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runQuery(internal.projects.projectGet, { space: who.space, brain: String(b.brain ?? "") });
});

route("/api/project/rename", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.projects.projectRename, { space: who.space, brain: String(b.brain ?? ""), name: String(b.name ?? "") });
});

/** A project taken apart a batch at a time, until nothing is left. */
async function wipeProject(ctx: any, space: string, brain: string, file: boolean) {
  for (let i = 0; i < 500; i++) {
    const r = await ctx.runMutation(internal.projects.projectWipe, { space, brain, ...(file ? { file: true } : {}) });
    if (!r.more) return true;
  }
  return false;
}

route("/api/project/delete", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return (await wipeProject(ctx, who.space, String(b.brain ?? ""), false)) ? { ok: true }
    : { error: "that project is large: ask again to finish deleting it" };
});

/** A new file, or a new version of it: the old sections go, the memory and the thread stay. */
route("/api/project/begin", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const brain = String(b.brain ?? "");
  const kind = b.kind === "table" ? "table" : b.kind === "html" ? "html" : "doc";
  const sheets = kind === "table"
    ? (Array.isArray(b.sheets) ? b.sheets : []).slice(0, 40).map((s: any) => ({ name: String(s?.name ?? "").slice(0, 60),
        header: colNames((Array.isArray(s?.header) ? s.header : []).map((x: any) => String(x ?? "")).slice(0, 60)) }))
    : [{ name: String(b.name ?? "").slice(0, 60), header: [] }];
  if (!sheets.length) return { error: "the table has no sheet to read" };
  if (!(await wipeProject(ctx, who.space, brain, true))) return { error: "the old file is large: ask again to clear it" };
  /* What the old file alone wrote goes with it (its note and its topics); what the chat kept stays. */
  await ctx.runMutation(internal.projects.memoryForgetFile, { space: who.space, brain });
  return await ctx.runMutation(internal.projects.fileBegin, { space: who.space, brain, name: String(b.name ?? "file").slice(0, 200), kind, sheets });
});

/** One piece of the file: words of a document, or rows of a sheet. A document's piece costs a model call a section. */
route("/api/project/part", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const brain = String(b.brain ?? ""), ver = Number(b.ver);
  if (Array.isArray(b.rows)) {
    const rows = b.rows.slice(0, 5000).map((r: any) => (Array.isArray(r) ? r : []).slice(0, 60).map((c: any) => String(c ?? "").slice(0, 2000)));
    return await addRowPiece(ctx, { space: who.space, brain, ver, sheet: Math.max(0, Number(b.sheet) || 0), rows });
  }
  const text = String(b.text ?? "").slice(0, 400000);
  if (!text.trim()) return { sections: 0, chars: 0 };
  return await addDocPiece(ctx, { space: who.space, brain, ver, text, page: Math.max(0, Number(b.page) || 0), key: keyFor(who), model: modelFor(who, b) });
});

route("/api/project/finish", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await finishFile(ctx, { space: who.space, brain: String(b.brain ?? ""), ver: Number(b.ver), about: true, key: keyFor(who), model: modelFor(who, b) });
});

/** The owner's instructions, typed or read from a file in the browser: one model call writes them as notes in the project's memory, and the chat follows them. */
route("/api/project/instructions", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await fileInstructions(ctx, { space: who.space, brain: String(b.brain ?? ""), name: String(b.name ?? ""), text: String(b.text ?? ""), key: keyFor(who), model: modelFor(who, b) });
});

/** A message in a project's chat: read what it needs, answered, kept in the thread. */
route("/api/project/chat", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const mKey = keyFor(who), mName = modelFor(who, b);
  /* The owner's other folders: none personal, none a project. Their cards load only if the router wants them. */
  const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
  const shared = withoutPersonal(head);
  return { turn: await projectChat(ctx, { space: who.space, brain: String(b.brain ?? ""), q: String(b.q ?? ""), key: mKey, model: mName,
    english: who.models?.reply === "en", embeds: !who.byok && !who.demo, note: true, tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 12) : [],
    shared: { brains: shared.brains, cards: (slugs: string[]) => cardsFor(ctx, slugs, head.ready) } }) };
});

route("/api/project/forget", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  return await ctx.runMutation(internal.projects.memoryForget, { space: who.space, brain: String(b.brain ?? ""), slug: String(b.slug ?? "") });
});

/** Sections of a document, from a position on, for the page to show as it scrolls. */
route("/api/project/doc", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return { sections: await ctx.runQuery(internal.projects.docPage, { space: who.space, brain: String(b.brain ?? ""),
    from: Number.isFinite(Number(b.from)) ? Number(b.from) : -1, n: Number(b.n) || 3, ...(b.sid != null ? { sid: Number(b.sid) } : {}) }) };
});

/** Rows of a sheet, from a row on, for the grid. */
route("/api/project/rows", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runQuery(internal.projects.rowsPage, { space: who.space, brain: String(b.brain ?? ""),
    sheet: Math.max(0, Number(b.sheet) || 0), from: Math.max(1, Number(b.from) || 1), n: Number(b.n) || 100 });
});

/** A change the chat proposed: applied, put back, or turned down. */
route("/api/project/edit", async (ctx, _req, b) => {
  const who = await gate(ctx, b, { ownerOnly: true });
  const fn = b.action === "apply" ? internal.projects.editApply : b.action === "undo" ? internal.projects.editUndo
    : b.action === "dismiss" ? internal.projects.editDismiss : null;
  if (!fn) return { error: "apply, undo or dismiss" };
  return await ctx.runMutation(fn, { space: who.space, brain: String(b.brain ?? ""), id: String(b.id ?? "") });
});

/** The file as it stands, as text: a document in Markdown, a sheet as CSV. */
route("/api/project/download", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const brain = String(b.brain ?? "");
  const meta = await ctx.runQuery(internal.projects.fileMeta, { space: who.space, brain });
  if (!meta) return { error: "this project has no file yet" };
  if (meta.kind === "doc") return { name: meta.name, kind: "doc", sheet: "", text: downloadText(await readBlocks(ctx, { space: who.space, brain })) };
  /* A page is code: its lines are kept as they are. */
  if (meta.kind === "html") return { name: meta.name, kind: "html", sheet: "", text: (await readBlocks(ctx, { space: who.space, brain })).join("\n\n").trim() + "\n" };
  const si = Math.max(0, Math.min(meta.sheets.length - 1, Number(b.sheet) || 0));
  const rows = (await readBlocks(ctx, { space: who.space, brain, sheet: si })).flatMap((t: string) => parseCsv(t));
  return { name: meta.name, kind: "table", sheet: meta.sheets[si].name, text: csvOf([meta.sheets[si].header, ...rows]) + "\n" };
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

/* ---------- health ---------- */

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
