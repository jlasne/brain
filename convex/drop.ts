/**
 * The four steps of a drop, with no transport around them.
 *
 * Two callers run exactly this code: the app, through the /api/drop routes, and
 * a signed connector, through the MCP write tools. Keeping one copy is what
 * stops the two from drifting into different rules about what gets stored.
 *
 * Each function takes the caller (who), the payload (b), and the model key and
 * model name already resolved, because an MCP call carries no request body to
 * read them from. One model call per function: several inside one request run
 * past the response deadline.
 */

import { internal } from "./_generated/api";
import {
  ask, parseJson, today, slug, linkKey, sourceId, canDrop, CHUNK,
} from "./lib";
import type { Who } from "./lib";

/* ---------- the rules, named so two thinkers can share them ---------- */

/**
 * Every prompt below is exported.
 *
 * The app pays a model on OpenRouter to follow them. A connector hands them to
 * the client's own model instead, which costs this deployment nothing. Same
 * rules either way, and the writing side validates whatever comes back, so the
 * thinker can change without the brain's rules changing.
 */

export const READ_SYSTEM =
  "You extract source material. You write in English whatever language the source is in, " +
  "except inside quotes, which stay exact in the original. You reply with JSON only.";

export const READ_RULES =
`Extract everything worth keeping from this source. Cover EVERY topic present, whether or not it looks relevant. This is the only read, so nothing gets a second pass.

Keep ideas, numbers, names, dates, reasoning chains, exact quotes and historical comparisons. Drop repetition, advertising, small talk and filler.

Write every field in English, whatever language the source uses. The one exception is "quotes", where text stays exact in the original language, because a translated quote stops being evidence.

Reply with only JSON:
{"title":"","author":"","date":"YYYY-MM-DD or empty","topics":[{"topic":"","ideas":[""],"data":[""]}],"quotes":[{"text":"","speaker":""}],"thin":[""]}

"thin" holds claims made with no number or evidence behind them.`;

export const PLAN_SYSTEM =
  "You file sources into a knowledge base. You write in English. You reply with JSON only.";

export const PLAN_RULES =
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
 "conflicts":[{"concept":"","conceptId":"","brain":"","kind":"flip|caveat|drift","says":"","saysDate":"","stored":"","storedDate":"","why":""}]}`;

export const REWRITE_SYSTEM =
  "You maintain a knowledge base. You write in English. You reply with JSON only.";

/** What the planner is shown: every brain it may feed, and the source itself. */
export function planContext(pool: any[], concepts: any[], sources: any[], ext: any) {
  const summaries = pool.map((br: any) => {
    const cs = concepts.filter((c: any) => c.brain === br.slug).sort((x: any, y: any) => x.n - y.n);
    return `## ${br.name} [${br.type}] id=${br.slug}\nscope: ${br.scope}\n` +
      (cs.length ? cs.map((c: any) => `- id=${c.brain}/${c.slug} | ${c.title}: ${c.summaryLine || c.position || "no position yet"}`).join("\n")
                 : "- no concepts yet");
  }).join("\n\n");
  const recent = sources.slice(-40).map((s: any) => `${s.sid} | ${s.author || "?"} | ${s.title || ""}`).join("\n") || "none";

  return `
BRAINS AND THEIR CONCEPTS
${summaries}

EARLIER SOURCES
${recent}

THE NEW SOURCE
title: ${ext?.title ?? ""}
author: ${ext?.author ?? ""}
date: ${ext?.date ?? ""}
${(ext?.topics ?? []).map((t: any) => `### ${t.topic}\n${(t.ideas ?? []).join("\n")}\n${(t.data ?? []).join("\n")}`).join("\n\n").slice(0, 30000)}`;
}

export const REWRITE_RULES =
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
{"rewrites":[{"conceptId":"","position":"","summaryLine":"","data":[""],"conflicts":[{"a":"","aDate":"","b":"","bDate":"","why":""}]}]}`;

/** The brains a caller may feed, and the ones the plan was pointed at. */
export async function feedable(ctx: any, who: Who, brain?: string) {
  const { brains: seen, concepts, sources } = await ctx.runQuery(internal.store.everything, {});
  const brains = seen.filter((x: any) => canDrop(x, who));
  const only = brain && brain !== "all" ? String(brain) : null;
  const pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  return { brains, concepts, sources, pool };
}

/** R1.2 runs before anything expensive, so a repeat costs zero pasting. */
export async function dropCheck(ctx: any, b: any) {
  const link = String(b.link ?? "");
  const sid = sourceId(link, String(b.text ?? ""));
  const found = await ctx.runQuery(internal.store.findSource, { linkKey: linkKey(link), sid });
  return found
    ? { duplicate: true, sid: found.sid, date: found.date, brains: found.brains,
        title: found.title, author: found.author, link: found.link }
    : { duplicate: false, sid };
}

/** R2. One pass over one chunk. The caller loops, the transcript is never stored. */
export async function dropRead(ctx: any, who: Who, b: any, key?: string, model?: string) {
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
    { role: "system", content: READ_SYSTEM },
    { role: "user", content:
`${READ_RULES}

SOURCE${total > 1 ? ` (part ${part} of ${total})` : ""}:
${chunk}` },
  ], { json: true, maxTokens: 24000, key, model });
  return { part: parseJson(text, finish) };
}

/** R3. Summaries only, never whole brains, so this costs the same at any size. */
export async function dropPlan(ctx: any, who: Who, b: any, key?: string, model?: string) {
  const { brains: seen, concepts, sources } = await ctx.runQuery(internal.store.everything, {});
  /* Only brains this caller may feed. Everyone reads more than they can write. */
  const brains = seen.filter((x: any) => canDrop(x, who));
  const only = b.brain && b.brain !== "all" ? String(b.brain) : null;
  const pool = only ? brains.filter((x: any) => x.slug === only) : brains;
  if (!pool.length) return { error: "no brain exists yet" };

  const ext = b.ext ?? {};

  const { text, finish } = await ask([
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content:
`${PLAN_RULES}
${planContext(pool, concepts, sources, ext)}` },
  ], { json: true, maxTokens: 16000, key, model });

  return { plan: parseJson(text, finish) };
}

/** R5. Re-derive, never append, then write. One pass, before the receipt. */
export async function dropSettle(ctx: any, who: Who, b: any, key?: string, model?: string) {
  const { brains: seen, concepts } = await ctx.runQuery(internal.store.everything, {});
  /* Re-checked here, because this is where the writing happens. */
  const brains = seen.filter((x: any) => canDrop(x, who));
  const ext = b.ext ?? {}, plan = b.plan ?? {}, sid = String(b.sid ?? "");
  const choices: Record<string, string> = b.choices ?? {};
  const targets: string[] = (plan.brains ?? []).filter((x: string) => brains.some((y: any) => y.slug === x));
  if (!targets.length) return { error: "no brain matched" };

  const touched: any[] = [];
  for (const m of (plan.matched ?? [])) {
    const c = concepts.find((x: any) => `${x.brain}/${x.slug}` === m.conceptId || x.slug === slug(m.conceptId ?? ""));
    if (c) touched.push({ c, adds: m.whatItAdds, isNew: false });
  }
  /* R5.5. A candidate is an idea the brain does not hold yet. Three separate
     sources make it a position, so a first mention is counted and kept, never
     thrown away. Two brains skip the wait: one that is still empty, and one
     where the owner picked the candidate on the card. */
  const counted: any[] = [];
  const promote: string[] = Array.isArray(b.promote) ? b.promote.map(String) : [];
  for (const cand of (plan.candidates ?? [])) {
    const br = targets.includes(cand.brain) ? cand.brain : targets[0];
    const already = concepts.find((x: any) => x.brain === br && x.slug === slug(cand.title));
    if (already) { touched.push({ c: already, adds: cand.why, isNew: false }); continue; }
    const seeding = concepts.filter((x: any) => x.brain === br).length === 0;
    const asked = promote.includes(cand.title) || promote.includes(`${br}/${slug(cand.title)}`);
    if (seeding || asked) {
      touched.push({ c: { brain: br, slug: slug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: [] }, adds: cand.why, isNew: true });
    } else {
      const r = await ctx.runMutation(internal.store.bumpCandidate, { brain: br, title: cand.title, sid });
      if (r.promoted) touched.push({ c: { brain: br, slug: slug(cand.title), title: cand.title, position: "", evidence: [], data: [], conflicts: [], sources: r.notes }, adds: "promoted after 3 mentions", isNew: true });
      else counted.push({ brain: br, title: cand.title, have: r.notes.length, need: 3 - r.notes.length });
    }
  }

  /* A plan with findings that lands nowhere would write a source row and rewrite
     no position: the knowledge would vanish, and the receipt would read fine.
     Refuse and say so. A counted candidate is not that case. It landed in the
     candidate list, and it says so on the receipt. */
  if (!touched.length && !counted.length && (plan.new ?? []).length > 0) {
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

    const job = `${REWRITE_RULES}

CONCEPTS
${packet}

NEW SOURCE
author: ${ext.author || "unknown"} | date: ${ext.date || today()}
${(ext.topics ?? []).map((t: any) => `${t.topic}: ${(t.ideas ?? []).join("; ")} ${(t.data ?? []).join("; ")}`).join("\n").slice(0, 20000)}`;

    /* Three ways to get the rewrites.
       - handed in: the caller's own model already did this work, so no model
         call is made here and this deployment spends nothing.
       - asked for: the caller wants the job, not the answer, so it gets the
         whole prompt back and nothing is written yet.
       - neither: the app's own path, paying a model on the caller's key. */
    if (Array.isArray(b.rewrites)) {
      rewrites = b.rewrites;
    } else if (b.packetOnly) {
      return { job, counted, positions: touched.length,
               concepts: touched.map(({ c }: any) => `${c.brain}/${c.slug}`) };
    } else {
      const { text, finish } = await ask([
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: job },
      ], { json: true, maxTokens: 24000, key, model });
      rewrites = parseJson(text, finish)?.rewrites ?? [];
    }
  } else if (b.packetOnly) {
    /* Nothing to rewrite, so there is no job. Storing it is one more call. */
    return { job: "", counted, positions: 0, concepts: [] };
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
    ...(who.account ? { by: who.account } : {}),
  }});
  await ctx.runMutation(internal.store.writeNote, { doc: {
    sid, title: ext.title ?? "", author: ext.author ?? "", date: ext.date || today(),
    topics: (ext.topics ?? []).slice(0, 40), quotes: (ext.quotes ?? []).slice(0, 40),
    thin: (ext.thin ?? []).slice(0, 30),
    connections: [...(plan.matched ?? []), ...(plan.candidates ?? [])],
    findings: { new: plan.new ?? [], echo: plan.echo ?? [], conflicts: plan.conflicts ?? [], choices },
  }});

  return { sid, brains: targets, positions: touched.length, counted,
    counts: { new: (plan.new ?? []).length, echo: (plan.echo ?? []).length } };
}

/** R5.9. Keep 12, fold older agreeing entries into one dated line. */
export function compress(ev: any[]) {
  const real = ev.filter(e => !e.rollup), roll = ev.find(e => e.rollup);
  if (real.length <= 12) return roll ? [...real, roll] : real;
  const keep = real.slice(0, 12), fold = real.slice(12);
  const years = fold.map(e => String(e.date ?? "").slice(0, 4)).filter(Boolean).sort();
  const n = fold.length + (roll?.count ?? 0);
  const from = roll?.from || years[0] || "", to = years[years.length - 1] || roll?.to || "";
  return [...keep, { rollup: true, count: n, from, to,
    claim: `${n} earlier source${n === 1 ? "" : "s"} agreed${from ? `, ${from} to ${to}` : ""}` }];
}
