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
  linkKey, sourceId, MODEL, MAX_ATTEMPTS,
} from "./lib";

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
  return { ...s, model: MODEL };
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
    ? { duplicate: true, sid: found.sid, date: found.date, brains: found.brains }
    : { duplicate: false, sid };
});

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
route("/api/drop/read", async (ctx, _req, b) => {
  await gate(ctx, b);
  const part = Number(b.part ?? 1), total = Number(b.total ?? 1);
  const { text } = await ask([
    { role: "system", content: "You extract source material. You reply with JSON only." },
    { role: "user", content:
`Extract everything worth keeping from this source. Cover EVERY topic present, whether or not it looks relevant. This is the only read, so nothing gets a second pass.

Keep ideas, numbers, names, dates, reasoning chains, exact quotes and historical comparisons. Drop repetition, advertising, small talk and filler.

Reply with only JSON:
{"title":"","author":"","date":"YYYY-MM-DD or empty","topics":[{"topic":"","ideas":[""],"data":[""]}],"quotes":[{"text":"","speaker":""}],"thin":[""]}

"thin" holds claims made with no number or evidence behind them.

SOURCE${total > 1 ? ` (part ${part} of ${total})` : ""}:
${String(b.chunk ?? "")}` },
  ], { json: true, maxTokens: 8000 });
  return { part: parseJson(text) };
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

  const { text } = await ask([
    { role: "system", content: "You file sources into a knowledge base. You reply with JSON only." },
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
${(ext.topics ?? []).map((t: any) => `### ${t.topic}\n${(t.ideas ?? []).join("\n")}\n${(t.data ?? []).join("\n")}`).join("\n\n").slice(0, 34000)}` },
  ], { json: true, maxTokens: 6000 });

  return { plan: parseJson(text) };
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

  let rewrites: any[] = [];
  if (touched.length) {
    const packet = touched.map(({ c, adds }) => {
      const br = brains.find((x: any) => x.slug === c.brain);
      return `### ${c.brain}/${c.slug}
brain: ${br?.name} [${br?.type}], scope: ${br?.scope}
concept: ${c.title}
CURRENT POSITION: ${c.position || "none yet"}
FULL EVIDENCE LIST (newest first):
${(c.evidence ?? []).map((e: any) => `- ${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join("\n") || "- none"}
THIS SOURCE ADDS: ${adds ?? ""}
DECISIONS: ${Object.entries(choices).map(([k, v]) => `${k}=${v}`).join(", ") || "keep both"}`;
    }).join("\n\n");

    const { text } = await ask([
      { role: "system", content: "You maintain a knowledge base. You reply with JSON only." },
      { role: "user", content:
`Rewrite each position below from its WHOLE evidence list, now carrying the new source. Re-derive, never append. A position that reads as a list of who said what has failed.

RULES
- One view per position, a few lines, stating what holds.
- "new" means the position flips and the old view moves into evidence with its date.
- "old" means the new claim stays a minority view and the position holds.
- "both" means the position holds and the clash goes into open conflicts, dated, with the reason.
- Never delete a view.
- No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording.
- summaryLine is ONE line, under 18 words.

Reply with only JSON:
{"rewrites":[{"conceptId":"","position":"","summaryLine":"","data":[""],"conflicts":[{"a":"","aDate":"","b":"","bDate":"","why":""}]}]}

CONCEPTS
${packet}

NEW SOURCE
author: ${ext.author || "unknown"} | date: ${ext.date || today()}
${(ext.topics ?? []).map((t: any) => `${t.topic}: ${(t.ideas ?? []).join("; ")} ${(t.data ?? []).join("; ")}`).join("\n").slice(0, 20000)}` },
    ], { json: true, maxTokens: 8000 });
    rewrites = parseJson(text)?.rewrites ?? [];
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

  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds." },
    { role: "user", content:
`Answer the question from the stored knowledge below.

HOW TO WRITE THE ANSWER
- The FIRST SENTENCE answers the question. Natural prose, addressed to the person asking.
- Numbers, dates and findings go INSIDE the answer.
${isPerson
  ? "- This is a PERSON brain, so name that person throughout. Their view is the subject."
  : "- NEVER put a source's name in the answer text. Attribution belongs on the sources line only."}
- Newer evidence wins on the same question, and better data overrides that.
- Mention an open conflict only when it changes what the reader would do.
- No file paths anywhere.
${nSources > 0 && nSources < 10 ? `- This rests on ${nSources} source${nSources === 1 ? "" : "s"} only. Open by saying it is a small brain.` : ""}
- Then a blank line, then exactly one final line: "Sources: {author}, {date} - {author}, {date}" listing only sources you used. Omit that line if you used none.
- No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording. Say what holds rather than what does not.
- If the stored knowledge does not answer it, say so plainly in one sentence and name what kind of source would fill the gap. Never invent evidence.

STORED KNOWLEDGE
${dossier}

QUESTION: ${String(b.q ?? "")}` },
  ], { maxTokens: 2000 });

  return { answer: text, sources: nSources };
});

export default router;
