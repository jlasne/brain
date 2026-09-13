/**
 * Every route the app calls. Two rules hold here and nowhere else can enforce them:
 * the OpenRouter key never leaves this file's process, and no route touches a brain
 * or a model before gate() passes.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ask, json, cors, sha256, slug, randomHex, isOpen, sealKey, openKey,
  MODEL, MAX_ATTEMPTS, CHUNK,
} from "./lib";
import type { Who } from "./lib";
import { handleRpc, PROTOCOLS, RATE_MAX, RATE_WINDOW_MS } from "./mcp";
import { dropCheck, dropRead, dropPlan, dropSettle, fetchPage } from "./drop";

const router = httpRouter();

/* ---------- the gate ---------- */

/** Who is calling. Three kinds, described on `Who` in lib.ts. */
async function gate(ctx: any, body: any): Promise<Who> {
  const who = body?.token
    ? await ctx.runQuery(internal.store.checkSession, { token: body.token })
    : null;
  if (!who) throw new Response("locked", { status: 401 });
  return who;
}

/**
 * Whose credit pays for a model call.
 *
 * The owner spends this deployment's key. Everyone else spends their own: the
 * one their browser just sent, or the one their account remembers.
 *
 * A plaintext key is read here and handed straight to ask(). It must never
 * reach runQuery, runMutation, or any table, because Convex records the
 * arguments of those calls. Only sealed ciphertext crosses that line.
 */
async function modelKey(ctx: any, who: Who, body: any): Promise<string | undefined> {
  if (who.kind === "owner") return undefined;

  const sent = String(body?.key ?? "").trim();
  if (sent) return sent;

  if (who.kind === "member" && who.account) {
    const sealed = await ctx.runQuery(internal.store.accountKey, { slug: who.account });
    if (sealed) return await openKey(sealed.cipher, sealed.iv);
  }
  throw new Error("this needs a model key. Paste yours, or save one on your account.");
}

/**
 * Which model answers.
 *
 * The default is the one this deployment runs. A caller spending their own key
 * names another, because the bill is theirs. An owner session spends this
 * deployment's key, so it stays on the default.
 */
function modelName(who: Who, body: any): string | undefined {
  if (who.kind === "owner") return undefined;
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

/** First call ever sets the passphrase. Every call after checks it. */
route("/api/unlock", async (ctx, _req, b) => {
  const pass = String(b.pass ?? "");
  if (pass.length < 8) return { error: "use at least 8 characters" };

  const g = await ctx.runQuery(internal.store.gateState, {});

  if (!g?.set) {
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");
    await ctx.runMutation(internal.store.setGate, { salt, hash: await sha256(salt, pass) });
    return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner" }), created: true };
  }

  if ((g.attempts ?? 0) >= MAX_ATTEMPTS) return { error: "too many attempts, wait an hour" };

  const good = await sha256(g.salt!, pass) === g.hash;
  await ctx.runMutation(internal.store.noteAttempt, { ok: good });
  if (!good) return { error: "that is not it" };
  return { token: await ctx.runMutation(internal.store.newSession, { kind: "owner" }) };
});

/** Leaks nothing: says only whether a passphrase has ever been set. */
/**
 * A name and a model key. The key is hashed to find or open the account, and
 * only that hash is kept. The key itself stays in the browser and pays for that
 * person's own calls.
 */
/**
 * A name and a password. An unused name opens an account, a taken one has to
 * match. Only a salted hash of the password is stored.
 *
 * The reply says whether this account already remembers a model key, so the
 * app knows whether to ask for one.
 */
route("/api/login", async (ctx, _req, b) => {
  const name = String(b.name ?? "").trim();
  const pass = String(b.password ?? "");
  if (name.length < 2) return { error: "give a name of at least 2 characters" };
  if (pass.length < 8) return { error: "use a password of at least 8 characters" };
  const s = slug(name);

  const acc = await ctx.runQuery(internal.store.findAccount, { slug: s });
  if (!acc) {
    const salt = randomHex(16);
    await ctx.runMutation(internal.store.createAccount,
      { name, slug: s, salt, passHash: await sha256(salt, pass) });
    return {
      token: await ctx.runMutation(internal.store.newSession, { account: s, kind: "member" }),
      name, account: s, created: true, hasKey: false, keyHint: "",
    };
  }
  /* An account from the earlier scheme has no password yet, so it cannot be
     opened this way. Saying so beats a wrong "that is not it". */
  if (!acc.passHash) {
    return { error: `"${acc.name}" was made before passwords. Pick another name.` };
  }
  if (await sha256(acc.salt, pass) !== acc.passHash) {
    return { error: "that name and password do not match" };
  }
  await ctx.runMutation(internal.store.touchAccount, { slug: s });
  return {
    token: await ctx.runMutation(internal.store.newSession, { account: s, kind: "member" }),
    name: acc.name, account: s,
    hasKey: !!acc.keyCipher, keyHint: acc.keyHint ?? "",
  };
});

/**
 * No account. A key, used for this tab and remembered nowhere. A guest asks
 * questions and feeds nothing, so there is no brain to own and nothing to
 * protect with a password.
 */
route("/api/guest", async (ctx, _req, b) => {
  const key = String(b.key ?? "").trim();
  if (key.length < 16) return { error: "that does not look like an API key" };
  return {
    token: await ctx.runMutation(internal.store.newSession, { kind: "guest" }),
    guest: true,
  };
});

/**
 * Remember a member's key, or forget it. The key is sealed here, so only
 * ciphertext reaches the database.
 */
route("/api/account/key", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  if (who.kind !== "member" || !who.account) {
    return { error: "only a signed-in account can remember a key" };
  }
  if (b.forget) {
    await ctx.runMutation(internal.store.setAccountKey, { slug: who.account });
    return { saved: false };
  }
  const key = String(b.key ?? "").trim();
  if (key.length < 16) return { error: "that does not look like an API key" };
  const sealed = await sealKey(key);
  await ctx.runMutation(internal.store.setAccountKey,
    { slug: who.account, cipher: sealed.cipher, iv: sealed.iv, hint: sealed.hint });
  return { saved: true, keyHint: sealed.hint };
});

route("/api/status", async (ctx) => {
  const g = await ctx.runQuery(internal.store.gateState, {});
  return { gateSet: !!g?.set };
});

route("/api/lock", async (ctx, _req, b) => {
  if (b?.token) await ctx.runMutation(internal.store.dropSession, { token: b.token });
  return { ok: true };
});

/**
 * The personal connector address.
 *
 * The token is shown once per call and never leaves this route, so a browser
 * that asks for it is the only place it appears. Rotating replaces it, which
 * kills whatever was pointed at the old one.
 */
route("/api/account/mcp", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  if (who.kind !== "member" || !who.account) {
    return { error: "a connector address belongs to an account. Sign in first." };
  }
  if (b.forget) {
    await ctx.runMutation(internal.store.setMcpToken, { slug: who.account, token: null });
    return { has: false, token: "" };
  }
  if (b.make) {
    const token = randomHex(24);
    const r = await ctx.runMutation(internal.store.setMcpToken, { slug: who.account, token });
    return { has: true, token, made: r.made };
  }
  return await ctx.runQuery(internal.store.mcpState, { slug: who.account });
});

/* ---------- reading ---------- */

route("/api/state", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const s = await ctx.runQuery(internal.store.everything, {});
  /* Whether this account remembers a key, and the last 4 of it, so the app can
     say which one it would spend. The key itself stays sealed. */
  let hasKey = false, keyHint = "";
  if (who.kind === "member" && who.account) {
    const sealed = await ctx.runQuery(internal.store.accountKey, { slug: who.account });
    if (sealed) { hasKey = true; keyHint = sealed.hint; }
  }
  return { ...s, model: MODEL, chunk: CHUNK,
           account: who.account, kind: who.kind, owner: who.kind === "owner",
           hasKey, keyHint };
});

route("/api/brain", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  const name = String(b.name ?? "").trim(), scope = String(b.scope ?? "").trim();
  if (!name || !scope) return { error: "a name and a scope line are both required" };
  const type = b.type === "person" ? "person" : "subject";
  if (who.kind === "guest") return { error: "creating a brain needs an account" };
  const visibility = String(b.visibility ?? "closed");
  return { slug: await ctx.runMutation(internal.store.createBrain,
    { name, type, scope, visibility, ...(who.account ? { owner: who.account } : {}) }) };
});

/** Rename a brain, and move its concepts, sources and candidates with it. */
route("/api/brain/rename", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  if (who.kind === "guest") return { error: "renaming a brain needs an account" };
  return await ctx.runMutation(internal.store.renameBrain, {
    slug: String(b.slug ?? ""), name: String(b.name ?? ""),
    scope: String(b.scope ?? ""), account: who.account ?? null });
});

/* Hide a brain from the public endpoints, or show it again. */
route("/api/brain/visibility", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await ctx.runMutation(internal.store.setVisibility,
    { slug: String(b.slug ?? ""), visibility: String(b.visibility ?? "ask"), account: who.account });
});

/* ---------- drop ---------- */

/**
 * Read a page so a bare link is enough.
 *
 * Nothing fetched is stored. The text goes back to the caller, who reads it
 * once, and only the extraction ever reaches a brain.
 */
route("/api/fetch", async (ctx, _req, b) => {
  await gate(ctx, b);
  return await fetchPage(String(b.url ?? ""));
});

/** R1.2 runs before anything expensive, so a repeat costs zero pasting. */
route("/api/drop/check", async (ctx, _req, b) => {
  await gate(ctx, b);
  return await dropCheck(ctx, b);
});

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
route("/api/drop/read", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await dropRead(ctx, who, b, await modelKey(ctx, who, b), modelName(who, b));
});

/** R3. Summaries only, never whole brains, so this costs the same at any size. */
route("/api/drop/plan", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await dropPlan(ctx, who, b, await modelKey(ctx, who, b), modelName(who, b));
});

/** R5. Re-derive, never append, then write. One pass, before the receipt. */
route("/api/drop/settle", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  return await dropSettle(ctx, who, b, await modelKey(ctx, who, b), modelName(who, b));
});


/* ---------- ask ---------- */

route("/api/ask", async (ctx, _req, b) => {
  const who = await gate(ctx, b);
  /* Every brain answers questions, whoever is asking. */
  const { brains, concepts, sources } = await ctx.runQuery(internal.store.everything, {});
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  const pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  if (!pool.length) return { answer: "No brains exist yet, so there is nothing to read. Create one, drop a few sources, then ask again." };

  const chosen = pool.slice(0, 3);
  const isPerson = chosen.length === 1 && chosen[0].type === "person";
  const used = new Set<string>();
  const dossier = chosen.flatMap((br: any) =>
    concepts.filter((c: any) => c.brain === br.slug).map((c: any) => {
      (c.sources ?? []).forEach((s: string) => used.add(s));
      return `### ${c.title} in ${br.name} [${br.type}]
POSITION: ${c.position || "none"}
EVIDENCE: ${(c.evidence ?? []).map((e: any) => `${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join(" | ") || "none"}
DATA: ${(c.data ?? []).join(" | ") || "none"}
OPEN CONFLICTS: ${(c.conflicts ?? []).map((x: any) => `${x.a} (${x.aDate}) vs ${x.b} (${x.bDate}), because ${x.why}`).join(" | ") || "none"}`;
    })).join("\n\n") || "The chosen brains hold no concepts yet.";

  const nSources = new Set(sources.filter((s: any) => s.brains.some((x: string) => chosen.some((c: any) => c.slug === x))).map((s: any) => s.sid)).size;

  /* Three levels. Each changes the shape and the depth of the answer. None of
     them touches the evidence rules below, so a level can never buy a claim
     the brain does not hold. */
  const level = ["normal", "educational", "expert"].includes(String(b.level))
    ? String(b.level) : "normal";
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
    expert:
`LEVEL: EXPERT
- Write as a reviewer grading this knowledge base, not as a teacher. Define nothing.
- Open with the position in one or two lines.
- Then review the evidence behind it: how many sources, how recent, which claims carry numbers and which carry none.
- Name the thin spots. A position resting on one source, or on no data, gets said plainly.
- State every open conflict on this question, with both dates.
- Close with one line naming what evidence would change the position.
- 8 to 15 sentences, one per line. A blank line may separate two groups.`,
  };

  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds. You always answer in English." },
    { role: "user", content:
`Answer the question from the stored knowledge below.

${SHAPE[level]}

HOW TO WRITE THE ANSWER
- THE QUESTION'S OWN INSTRUCTION ABOUT SHAPE WINS. Asked for a list, give a list, one item per line starting with "- ". Asked for steps, number them. Asked for a table, give a table. The rules below apply to the words inside whatever shape was asked for.
- Otherwise: ONE SENTENCE PER LINE. End every sentence with a full stop, then a line break.
- A full stop, never a semicolon. Two ideas are two sentences on two lines.
- The FIRST SENTENCE answers the question. Natural prose, addressed to the person asking.
- Numbers, dates and findings go INSIDE the answer.
${isPerson
  ? "- This is a PERSON brain, so name that person throughout. Their view is the subject."
  : "- NEVER put a source's name in the answer text. Attribution belongs on the sources line only."}
- Newer evidence wins on the same question, and better data overrides that.
- Mention an open conflict only when it changes what the reader would do. At the EXPERT level, state every open conflict regardless.
- No file paths anywhere.
${nSources > 0 && nSources < 10 ? `- This rests on ${nSources} source${nSources === 1 ? "" : "s"} only. Open by saying it is a small brain.` : ""}
- Then a blank line, then exactly one final line: "Sources: {author}, {date} - {author}, {date}" listing only sources you used. Omit that line if you used none.
- English, always. No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording. Say what holds rather than what does not.
- If the stored knowledge does not answer it, say so plainly in one sentence and name what kind of source would fill the gap. Never invent evidence.

STORED KNOWLEDGE
${dossier}

QUESTION: ${String(b.q ?? "")}` },
  ], { maxTokens: level === "normal" ? 2000 : 3200, key: await modelKey(ctx, who, b), model: modelName(who, b) });

  return { answer: text, sources: nSources, level };
});

/* ---------- the public read the /brains page uses ---------- */

/**
 * Same exposure as the MCP server, in one JSON document, so a static page can
 * render the brains without a passphrase. Private brains never appear.
 */
router.route({
  path: "/api/public/brains", method: "GET",
  handler: httpAction(async (ctx, req) => {
    const { brains, concepts, sources } = await ctx.runQuery(internal.store.everything, {});
    return new Response(JSON.stringify({
      brains: brains.map((b: any) => ({
        slug: b.slug, name: b.name, type: b.type, scope: b.scope,
        open: isOpen(b),
        concepts: concepts.filter((c: any) => c.brain === b.slug).length,
        sources: sources.filter((s: any) => (s.brains ?? []).includes(b.slug)).length,
      })),
      concepts: concepts.map((c: any) => ({
        brain: c.brain, slug: c.slug, n: c.n, title: c.title,
        summaryLine: c.summaryLine, position: c.position,
        sources: (c.sources ?? []).length, updated: c.updated,
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
    /* An unsupported protocol version is a 400 under the spec. An absent header
       means an older client, which the spec says to read as 2025-03-26. */
    const ver = req.headers.get("MCP-Protocol-Version");
    if (ver && !PROTOCOLS.includes(ver)) {
      return mcpJson({ jsonrpc: "2.0", id: null,
        error: { code: -32000, message: `Unsupported MCP-Protocol-Version: ${ver}. This server speaks ${PROTOCOLS.join(", ")}.` } }, 400);
    }

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

    /* A batch is a list. Notifications drop out, so an all-notification batch
       gets 202 with no body, exactly as a lone notification does. */
    if (Array.isArray(msg)) {
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
