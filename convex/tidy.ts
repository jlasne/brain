/**
 * Tidying a folder after the fact.
 *
 * Three faults left marks in folders filed before they were fixed: a rewrite
 * reply that skipped concepts stored them with no position, parts of a long
 * source planned side by side filed one idea under two titles, and a part read
 * in its own language came back with titles in it. A drop no longer does any
 * of this. These are the tools that repair what it left: write a position from
 * the evidence a concept holds, find the concepts holding one idea, and give a
 * title in another language its English one. Joining and renaming are store
 * writes; this file holds the two model calls.
 */

import { internal } from "./_generated/api";
import { ask, parseJson, canDrop } from "./lib";
import type { Who } from "./lib";
import { plainClaim, rewriteOf, lineOf } from "./drop";
import { loadSpace } from "./space";

export const REDERIVE_SYSTEM =
  "You maintain a knowledge base. You write in English. You reply with JSON only.";

export const REDERIVE_RULES =
`Write each concept's position from its WHOLE evidence list. Nothing new arrives: state the view the stored evidence supports.

RULES
- One view per position, a few lines, stating what holds.
- Write about the subject, never about the filing: no "the source", "this concept", "not covered by existing concepts".
- Where the evidence disagrees, say which view holds and why. Never delete a view.
- English, always. No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording.
- summaryLine is ONE line, under 18 words.

Reply with only JSON:
{"rewrites":[{"conceptId":"","position":"","summaryLine":""}]}`;

/* A concept's evidence as the model reads it, so one long concept cannot eat
   the whole request. */
const PACKET_CHARS = 6000;
/* Concepts per request. The app sends more as further requests. */
export const REDERIVE_MAX = 8;

/** The folders this caller may write to, by slug. */
async function writable(ctx: any, who: Who) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space: who.space });
  return new Map<string, any>(head.brains.filter((b: any) => canDrop(b, who) && b.type !== "personal" && b.type !== "project")
    .map((b: any) => [b.slug, b]));
}

/**
 * Positions written again from the evidence each concept already holds.
 *
 * For a concept left with no position, one whose position is a note about
 * the filing, and one that just took in a twin's evidence. One model call.
 */
export async function rederive(ctx: any, who: Who, ids: string[], key?: string, model?: string) {
  const mine = await writable(ctx, who);
  const want = [...new Set(ids.map(String))].filter(id => mine.has(id.split("/")[0])).slice(0, REDERIVE_MAX);
  if (!want.length) return { written: [] };
  const concepts: any[] = await ctx.runQuery(internal.store.conceptsByIds, { space: who.space, ids: want });
  const live = concepts.filter((c: any) => (c.evidence ?? []).length || c.position);
  if (!live.length) return { written: [] };

  const packet = live.map((c: any) => {
    const b = mine.get(c.brain);
    return `### ${c.brain}/${c.slug}
brain: ${b?.name} [${b?.type}], scope: ${b?.scope}
concept: ${c.title}
CURRENT POSITION: ${c.position || "none yet"}
FULL EVIDENCE LIST (newest first):
${(c.evidence ?? []).map((e: any) => `- ${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join("\n") || "- none"}
STORED DATA: ${(c.data ?? []).length ? c.data.join(" | ") : "none"}
OPEN CONFLICTS: ${(c.conflicts ?? []).length ? c.conflicts.map((x: any) => `${x.a ?? ""} (${x.aDate ?? "?"}) vs ${x.b ?? ""} (${x.bDate ?? "?"})`).join(" | ") : "none"}`.slice(0, PACKET_CHARS);
  }).join("\n\n");

  const { text, finish } = await ask([
    { role: "system", content: REDERIVE_SYSTEM },
    { role: "user", content: `${REDERIVE_RULES}\n\nCONCEPTS\n${packet}` },
  ], { json: true, maxTokens: 12000, key, model });
  const got = parseJson(text, finish)?.rewrites;
  const rewrites = Array.isArray(got) ? got.filter((r: any) => r && typeof r === "object") : [];

  const written: string[] = [];
  for (const c of live) {
    const rw = rewriteOf(rewrites, c);
    const position = plainClaim(rw.position);
    if (!position) continue;
    await ctx.runMutation(internal.store.upsertConcept, {
      brain: c.brain, title: c.title, slug: c.slug,
      doc: { position, summaryLine: plainClaim(rw.summaryLine) || lineOf(position) },
    });
    written.push(`${c.brain}/${c.slug}`);
  }
  return { written };
}

export const TIDY_RULES =
`Below is every concept of one folder, numbered, with the line it holds and how many evidence entries back it.

Find two things.

1. "same": groups of concepts holding the SAME idea: the same rule, method, claim or definition, worded differently or written in another language.
- Related ideas stay apart: a method and its limits, a rule and its exception, two steps of one process, a cause and its effect, a general idea and one example of it.
- When unsure, keep them apart. A missed group costs little; a wrong one loses an idea.
- Put the best title first: the clearest one in English, or the one with the most evidence when they read the same.

2. "english": concepts whose title is not in English, each with its title in English, short, in the style of the others. A title in English carrying a language tag such as "(French)" gets the tag removed.

Reply with only JSON, by concept number. Empty lists are a correct answer:
{"same":[[3,12],[7,9,21]],"english":[{"n":5,"title":""}]}`;

/* Concepts read in one tidy call. A larger folder is tidied on its newest. */
export const TIDY_MAX = 400;

/** A line that is a note about the filing rather than a view. */
const filler = (t: string) => !!t && (/^argued for\b/i.test(t) || plainClaim(t) !== t.replace(/\s+/g, " ").trim());

/** A concept card holding no position, or a note about its filing in place of one. */
export const needsPosition = (c: any) => !(c.summaryLine || c.lead) || filler(c.summaryLine || c.lead);

/**
 * What a folder holds twice, in another language, or with no position.
 *
 * Read only: it proposes, and the owner rules on each group before anything
 * is joined or renamed. One model call.
 */
export async function tidyScan(ctx: any, who: Who, brain: string, key?: string, model?: string) {
  const mine = await writable(ctx, who);
  if (!mine.has(brain)) return { error: "that folder is not one you can tidy" };
  const apart = new Set<string>(mine.get(brain)?.apart ?? []);
  const { cards } = await loadSpace(ctx, who.space);
  const all = cards.filter((c: any) => c.brain === brain).sort((a: any, b: any) => (b.n ?? 0) - (a.n ?? 0));
  const list = all.slice(0, TIDY_MAX);
  const card = (c: any) => ({ id: `${c.brain}/${c.slug}`, title: c.title, line: c.summaryLine || c.lead || "", ev: c.ev ?? 0 });
  const blank = list.filter(needsPosition).map(card);
  if (list.length < 2) return { brain, total: all.length, read: list.length, same: [], english: [], blank };

  const lines = list.map((c: any, i: number) =>
    `${i + 1}|${c.title}|${String(c.summaryLine || c.lead || "no position yet").slice(0, 160)}|${c.ev ?? 0}`).join("\n");
  const { text, finish } = await ask([
    { role: "system", content: "You tidy a knowledge base: you find concepts filed twice and titles not in English. You reply with JSON only." },
    { role: "user", content: `${TIDY_RULES}\n\nCONCEPTS (number|title|line|evidence)\n${lines}` },
  ], { json: true, maxTokens: 6000, timeout: 120000, key, model });
  const d = parseJson(String(text), finish) ?? {};

  const at = (n: any) => { const i = Number(n) - 1; return Number.isInteger(i) && i >= 0 && i < list.length ? i : -1; };
  const used = new Set<number>();
  const same: any[] = [];
  for (const g of Array.isArray(d.same) ? d.same : []) {
    const idx = (Array.isArray(g) ? g : []).map(at).filter((i: number) => i >= 0 && !used.has(i));
    const one = [...new Set<number>(idx)];
    if (one.length < 2) continue;
    /* A group you said to keep apart is never proposed again. */
    const ids = one.map(i => `${list[i].brain}/${list[i].slug}`);
    if (ids.every((x, k) => ids.slice(k + 1).every(y => apart.has([x, y].sort().join("|"))))) continue;
    one.forEach(i => used.add(i));
    same.push(one.map(i => card(list[i])));
  }
  /* A concept folded into a group's first needs no new title of its own. */
  const folded = new Set<string>(same.flatMap((g: any[]) => g.slice(1).map(c => c.id)));
  const english: any[] = [];
  for (const e of Array.isArray(d.english) ? d.english : []) {
    const i = at(e?.n);
    const title = String(e?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (i < 0 || title.length < 3 || title === list[i].title) continue;
    const c = card(list[i]);
    if (folded.has(c.id) || english.some(x => x.id === c.id)) continue;
    english.push({ ...c, to: title });
  }
  return { brain, total: all.length, read: list.length, same, english, blank };
}
