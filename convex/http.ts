/**
 * Every route the app calls. Two rules hold here and nowhere else can enforce them:
 * the OpenRouter key never leaves this file's process, and no route touches a brain
 * or a model before gate() passes.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ask, parseJson, json, cors, sha256, today, slug,
  linkKey, sourceId, MODEL, MAX_ATTEMPTS, CHUNK,
} from "./lib";
import { handleRpc, PROTOCOLS, RATE_MAX, RATE_WINDOW_MS } from "./mcp";

const router = httpRouter();

/* ---------- the gate ---------- */

async function gate(ctx: any, body: any) {
  const ok = body?.token && await ctx.runQuery(internal.store.checkSession, { token: body.token });
  if (!ok) throw new Response("locked", { status: 401 });
  return true;
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
    return { token: await ctx.runMutation(internal.store.newSession, {}), created: true };
  }

  if ((g.attempts ?? 0) >= MAX_ATTEMPTS) return { error: "too many attempts, wait an hour" };

  const good = await sha256(g.salt!, pass) === g.hash;
  await ctx.runMutation(internal.store.noteAttempt, { ok: good });
  if (!good) return { error: "that is not it" };
  return { token: await ctx.runMutation(internal.store.newSession, {}) };
});

/** Leaks nothing: says only whether a passphrase has ever been set. */
route("/api/status", async (ctx) => {
  const g = await ctx.runQuery(internal.store.gateState, {});
  return { gateSet: !!g?.set };
});

route("/api/lock", async (ctx, _req, b) => {
  if (b?.token) await ctx.runMutation(internal.store.dropSession, { token: b.token });
  return { ok: true };
});

/* ---------- reading ---------- */

route("/api/state", async (ctx, _req, b) => {
  await gate(ctx, b);
  const s = await ctx.runQuery(internal.store.everything, {});
  return { ...s, model: MODEL, chunk: CHUNK };
});

route("/api/brain", async (ctx, _req, b) => {
  await gate(ctx, b);
  const name = String(b.name ?? "").trim(), scope = String(b.scope ?? "").trim();
  if (!name || !scope) return { error: "a name and a scope line are both required" };
  const type = b.type === "person" ? "person" : "subject";
  return { slug: await ctx.runMutation(internal.store.createBrain, { name, type, scope }) };
});

/* ---------- drop ---------- */

/** R1.2 runs before anything expensive, so a repeat costs zero pasting. */
route("/api/drop/check", async (ctx, _req, b) => {
  await gate(ctx, b);
  const link = String(b.link ?? "");
  const sid = sourceId(link, String(b.text ?? ""));
  const found = await ctx.runQuery(internal.store.findSource, { linkKey: linkKey(link), sid });
  return found
    ? { duplicate: true, sid: found.sid, date: found.date, brains: found.brains,
        title: found.title, author: found.author, link: found.link }
    : { duplicate: false, sid };
});

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
route("/api/drop/read", async (ctx, _req, b) => {
  await gate(ctx, b);
  const part = Number(b.part ?? 1), total = Number(b.total ?? 1);
  /* ONE model call per request. Several inside one request runs past the
     response deadline, and the caller sees a dead connection rather than an
     error, so the caller loops instead. Any size up to the ceiling is fine:
     the budget below, not the input size, was the original failure. */
  const chunk = String(b.chunk ?? "");
  if (!chunk) return { error: "that part was empty" };
  if (chunk.length > CHUNK * 4) {
    return { error: `that part is ${chunk.length} characters. Reload the page, which splits a source into ${CHUNK} character passes.` };
  }

  const { text, finish } = await ask([
    { role: "system", content: "You extract source material. You write in English whatever language the source is in, except inside quotes, which stay exact in the original. You reply with JSON only." },
    { role: "user", content:
`Extract everything worth keeping from this source. Cover EVERY topic present, whether or not it looks relevant. This is the only read, so nothing gets a second pass.

Keep ideas, numbers, names, dates, reasoning chains, exact quotes and historical comparisons. Drop repetition, advertising, small talk and filler.

Write every field in English, whatever language the source uses. The one exception is "quotes", where text stays exact in the original language, because a translated quote stops being evidence.

Reply with only JSON:
{"title":"","author":"","date":"YYYY-MM-DD or empty","topics":[{"topic":"","ideas":[""],"data":[""]}],"quotes":[{"text":"","speaker":""}],"thin":[""]}

"thin" holds claims made with no number or evidence behind them.

SOURCE${total > 1 ? ` (part ${part} of ${total})` : ""}:
${chunk}` },
  ], { json: true, maxTokens: 24000 });
  return { part: parseJson(text, finish) };
});

/** R3. Summaries only, never whole brains, so this costs the same at any size. */
route("/api/drop/plan", async (ctx, _req, b) => {
  await gate(ctx, b);
  const { brains, concepts, sources } = await ctx.runQuery(internal.store.everything, {});
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  const pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  if (!pool.length) return { error: "no brain exists yet" };

  const summaries = pool.map((br: any) => {
    const cs = concepts.filter((c: any) => c.brain === br.slug).sort((x: any, y: any) => x.n - y.n);
    return `## ${br.name} [${br.type}] id=${br.slug}\nscope: ${br.scope}\n` +
      (cs.length ? cs.map((c: any) => `- id=${c.brain}/${c.slug} | ${c.title}: ${c.summaryLine || c.position || "no position yet"}`).join("\n")
                 : "- no concepts yet");
  }).join("\n\n");

  const ext = b.ext ?? {};
  const recent = sources.slice(-40).map((s: any) => `${s.sid} | ${s.author || "?"} | ${s.title || ""}`).join("\n") || "none";

  const { text, finish } = await ask([
    { role: "system", content: "You file sources into a knowledge base. You write in English. You reply with JSON only." },
    { role: "user", content:
`Decide where this source goes and what it changes. Use ONLY the brains listed.

RULES
- Propose every brain it belongs to. A subject brain holds the user's own position. A person brain holds one person's view.
- A concept belongs to a brain only if it fits that brain's scope line.
- "new" = ideas, numbers or reasoning the brains lack.
- "echo" = what this repeats, naming the earlier source.
- "conflict" = a claim contradicting a stored position. Rank each: "flip" if it would change the position, "caveat" if it only adds nuance.
- In a PERSON brain, a claim contradicting that same person's earlier view is drift, not conflict. Mark it kind "drift".
- Claims with no data behind them are thin. They never become concepts.
- "matched" = an EXISTING concept this source adds to. Copy its id exactly as listed below, in the form brain/slug. One entry per concept touched. "whatItAdds" says what this source contributes to it.
- "candidates" = a NEW concept this source argues for, one no listed concept covers. Give a short title, the brain slug it belongs in, and why.
- EVERY item in "new" MUST also be filed: under "matched" when a listed concept covers it, under "candidates" when none does. An idea belonging to no concept and needing no new one is thin, not new.
- So "matched" and "candidates" are both empty only when "new" is empty too.

Reply with only JSON:
{"brains":["id"],
 "matched":[{"conceptId":"","brain":"","whatItAdds":""}],
 "candidates":[{"title":"","brain":"","why":""}],
 "new":[""],
 "echo":[{"claim":"","repeatsSource":""}],
 "conflicts":[{"concept":"","conceptId":"","brain":"","kind":"flip|caveat|drift","says":"","saysDate":"","stored":"","storedDate":"","why":""}]}

BRAINS AND THEIR CONCEPTS
${summaries}

EARLIER SOURCES
${recent}

THE NEW SOURCE
title: ${ext.title ?? ""}
author: ${ext.author ?? ""}
date: ${ext.date ?? ""}
${(ext.topics ?? []).map((t: any) => `### ${t.topic}\n${(t.ideas ?? []).join("\n")}\n${(t.data ?? []).join("\n")}`).join("\n\n").slice(0, 30000)}` },
  ], { json: true, maxTokens: 16000 });

  return { plan: parseJson(text, finish) };
});

/** R5. Re-derive, never append, then write. One pass, before the receipt. */
route("/api/drop/settle", async (ctx, _req, b) => {
  await gate(ctx, b);
  const { brains, concepts } = await ctx.runQuery(internal.store.everything, {});
  const ext = b.ext ?? {}, plan = b.plan ?? {}, sid = String(b.sid ?? "");
  const choices: Record<string, string> = b.choices ?? {};
  const targets: string[] = (plan.brains ?? []).filter((x: string) => brains.some((y: any) => y.slug === x));
  if (!targets.length) return { error: "no brain matched" };

  const touched: any[] = [];
  for (const m of (plan.matched ?? [])) {
    const c = concepts.find((x: any) => `${x.brain}/${x.slug}` === m.conceptId || x.slug === slug(m.conceptId ?? ""));
    if (c) touched.push({ c, adds: m.whatItAdds, isNew: false });
  }
  for (const cand of (plan.candidates ?? [])) {
    const br = targets.includes(cand.brain) ? cand.brain : targets[0];
    const already = concepts.find((x: any) => x.brain === br && x.slug === slug(cand.title));
    if (already) { touched.push({ c: already, adds: cand.why, isNew: false }); continue; }
    const seeding = concepts.filter((x: any) => x.brain === br).length === 0;
    if (seeding) {
      touched.push({ c: { brain: br, slug: slug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: [] }, adds: cand.why, isNew: true });
    } else {
      const r = await ctx.runMutation(internal.store.bumpCandidate, { brain: br, title: cand.title, sid });
      if (r.promoted) touched.push({ c: { brain: br, slug: slug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: r.notes }, adds: "promoted after 3 mentions", isNew: true });
    }
  }

  /* A plan with findings but nothing filed would write a source row and rewrite
     no position: the knowledge would not land, and the receipt would read fine.
     Refuse and say so. */
  if (!touched.length && ((plan.new ?? []).length > 0 || (plan.candidates ?? []).length > 0)) {
    return { error:
      `the plan found ${(plan.new ?? []).length} new items and filed none of them into a concept, ` +
      `so nothing would be rewritten. Drop the source again.` };
  }

  let rewrites: any[] = [];
  if (touched.length) {
    const packet = touched.map(({ c, adds }) => {
      const br = brains.find((x: any) => x.slug === c.brain);
      const id = `${c.brain}/${c.slug}`;
      /* Each concept carries only its own decision, spelled out with the two
         claims it sits between. Sending every decision to every concept, keyed
         by a position number, gave the model nothing it could act on. */
      const mine = (plan.conflicts ?? []).filter((x: any) =>
        x.conceptId === id || slug(x.concept ?? "") === c.slug);
      const decisions = mine.map((x: any) => {
        const pick = choices[x.conceptId ?? ""] ?? choices[`${x.brain}/${x.concept}`]
          ?? choices[x.concept ?? ""] ?? choices[id] ?? "both";
        return `${pick.toUpperCase()} on: new claims "${x.says ?? ""}" (${x.saysDate || "undated"}) ` +
               `against stored "${x.stored ?? ""}" (${x.storedDate || "undated"})`;
      });
      return `### ${id}
brain: ${br?.name} [${br?.type}], scope: ${br?.scope}
concept: ${c.title}
CURRENT POSITION: ${c.position || "none yet"}
FULL EVIDENCE LIST (newest first):
${(c.evidence ?? []).map((e: any) => `- ${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join("\n") || "- none"}
THIS SOURCE ADDS: ${adds ?? ""}
MY DECISION: ${decisions.length ? decisions.join("\n") : "no contradiction here"}`;
    }).join("\n\n");

    const { text, finish } = await ask([
      { role: "system", content: "You maintain a knowledge base. You write in English. You reply with JSON only." },
      { role: "user", content:
`Rewrite each position below from its WHOLE evidence list, now carrying the new source. Re-derive, never append. A position that reads as a list of who said what has failed.

RULES
- One view per position, a few lines, stating what holds.
- Obey MY DECISION on every concept that carries one. It is the owner's ruling, so it outranks your own reading of the evidence.
- NEW means the position flips to the new claim, and the old view moves into evidence with its date.
- OLD means the stored position holds, and the new claim joins the evidence as a minority view.
- BOTH means the position holds and the clash goes into open conflicts, dated, with the reason.
- Never delete a view.
- English, always. No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording.
- summaryLine is ONE line, under 18 words.

Reply with only JSON:
{"rewrites":[{"conceptId":"","position":"","summaryLine":"","data":[""],"conflicts":[{"a":"","aDate":"","b":"","bDate":"","why":""}]}]}

CONCEPTS
${packet}

NEW SOURCE
author: ${ext.author || "unknown"} | date: ${ext.date || today()}
${(ext.topics ?? []).map((t: any) => `${t.topic}: ${(t.ideas ?? []).join("; ")} ${(t.data ?? []).join("; ")}`).join("\n").slice(0, 20000)}` },
    ], { json: true, maxTokens: 24000 });
    rewrites = parseJson(text, finish)?.rewrites ?? [];
  }

  for (const { c, adds } of touched) {
    const id = `${c.brain}/${c.slug}`;
    const rw = rewrites.find((r: any) => r.conceptId === id || r.conceptId === c.slug) ?? {};
    const ev = [{ date: ext.date || today(), author: ext.author || "unknown", claim: String(adds ?? "").slice(0, 240), source: sid }, ...(c.evidence ?? [])];
    await ctx.runMutation(internal.store.upsertConcept, {
      brain: c.brain, title: c.title,
      doc: {
        position: rw.position ?? c.position ?? "",
        summaryLine: rw.summaryLine ?? c.summaryLine ?? "",
        evidence: compress(ev),
        data: Array.isArray(rw.data) && rw.data.length ? rw.data.slice(0, 24) : (c.data ?? []),
        conflicts: Array.isArray(rw.conflicts) ? rw.conflicts.slice(0, 12) : (c.conflicts ?? []),
        sources: Array.from(new Set([...(c.sources ?? []), sid])),
      },
    });
  }

  await ctx.runMutation(internal.store.writeSource, { doc: {
    sid, link: String(b.link ?? ""), linkKey: linkKey(String(b.link ?? "")),
    title: ext.title ?? "", author: ext.author ?? "", date: ext.date || today(),
    location: String(b.location ?? "pasted, not kept"), brains: targets,
  }});
  await ctx.runMutation(internal.store.writeNote, { doc: {
    sid, title: ext.title ?? "", author: ext.author ?? "", date: ext.date || today(),
    topics: (ext.topics ?? []).slice(0, 40), quotes: (ext.quotes ?? []).slice(0, 40),
    thin: (ext.thin ?? []).slice(0, 30),
    connections: [...(plan.matched ?? []), ...(plan.candidates ?? [])],
    findings: { new: plan.new ?? [], echo: plan.echo ?? [], conflicts: plan.conflicts ?? [], choices },
  }});

  return { sid, brains: targets, positions: touched.length,
    counts: { new: (plan.new ?? []).length, echo: (plan.echo ?? []).length } };
});

/** R5.9. Keep 12, fold older agreeing entries into one dated line. */
function compress(ev: any[]) {
  const real = ev.filter(e => !e.rollup), roll = ev.find(e => e.rollup);
  if (real.length <= 12) return roll ? [...real, roll] : real;
  const keep = real.slice(0, 12), fold = real.slice(12);
  const years = fold.map(e => String(e.date ?? "").slice(0, 4)).filter(Boolean).sort();
  const n = fold.length + (roll?.count ?? 0);
  const from = roll?.from || years[0] || "", to = years[years.length - 1] || roll?.to || "";
  return [...keep, { rollup: true, count: n, from, to,
    claim: `${n} earlier source${n === 1 ? "" : "s"} agreed${from ? `, ${from} to ${to}` : ""}` }];
}

/* ---------- ask ---------- */

route("/api/ask", async (ctx, _req, b) => {
  await gate(ctx, b);
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
- 3 to 6 lines. One answer, no headings, no lists.
- Assume the reader knows the field. Skip definitions.`,
    educational:
`LEVEL: EDUCATIONAL
- Assume no background at all.
- Define each term the first time it appears, in one clause.
- Build the mechanism in order, so each step rests on the one before it.
- Give ONE worked example carrying real numbers from the evidence.
- Close with one line naming the single thing worth remembering.
- 10 to 20 lines. Short paragraphs. No headings.`,
    expert:
`LEVEL: EXPERT
- Write as a reviewer grading this knowledge base, not as a teacher. Define nothing.
- Open with the position in one or two lines.
- Then review the evidence behind it: how many sources, how recent, which claims carry numbers and which carry none.
- Name the thin spots. A position resting on one source, or on no data, gets said plainly.
- State every open conflict on this question, with both dates.
- Close with one line naming what evidence would change the position.
- 8 to 15 lines. Dense. Short paragraphs allowed.`,
  };

  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds. You always answer in English." },
    { role: "user", content:
`Answer the question from the stored knowledge below.

${SHAPE[level]}

HOW TO WRITE THE ANSWER
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
  ], { maxTokens: level === "normal" ? 2000 : 3200 });

  return { answer: text, sources: nSources, level };
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

router.route({
  path: "/mcp", method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: MCP_CORS })),
});

/* No server-initiated stream, so the spec's answer here is 405. */
router.route({
  path: "/mcp", method: "GET",
  handler: httpAction(async () => mcpJson({ error: "This endpoint answers POST only." }, 405)),
});

/* Stateless, so there is no session for a client to end. */
router.route({
  path: "/mcp", method: "DELETE",
  handler: httpAction(async () => new Response(null, { status: 405, headers: MCP_CORS })),
});

router.route({
  path: "/mcp", method: "POST",
  handler: httpAction(async (ctx, req) => {
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

    let msg: any;
    try { msg = await req.json(); }
    catch { return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }

    /* A batch is a list. Notifications drop out, so an all-notification batch
       gets 202 with no body, exactly as a lone notification does. */
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m: any) => handleRpc(ctx, m)))).filter(Boolean);
      return out.length ? mcpJson(out) : mcpJson(null, 202);
    }
    const reply = await handleRpc(ctx, msg);
    return reply ? mcpJson(reply) : mcpJson(null, 202);
  }),
});

export default router;
