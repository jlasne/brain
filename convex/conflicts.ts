/**
 * Open conflicts, settled after the drop that raised them.
 *
 * A drop records a clash when its card is left on "keep both". Some of those
 * are real: two claims that cannot both hold. Others only add a detail, a
 * number or a case, and were filed as clashes anyway: 8 of the first 15. One
 * small check reads each clash once and marks it, and the mark is stored, so
 * only real ones are offered for a ruling and none is checked twice.
 *
 * A ruling rewrites the position around the side that holds, keeps the other
 * as one dated sentence, and takes the clash off the list. "Both hold" only
 * takes it off.
 */

import { internal } from "./_generated/api";
import { ask, parseJson } from "./lib";
import { plainClaim } from "./drop";

const CHECK_RULES = `Each item below is two claims a knowledge base recorded as clashing.

Mark an item true only when both claims cannot be true at the same time, so a reader has to choose one.
Mark it false when one claim adds a detail, a number, a case or a risk to the other, when they speak of different things, or when they say the same thing in other words.

Reply with only JSON, one answer per item, in order: {"real":[true,false]}`;

const REWRITE = (position: string, held: string, heldDate: string, other: string, otherDate: string) =>
`Rewrite this position after the owner's ruling on a contradiction.

POSITION
${position || "none yet"}

THE OWNER RULED THAT THIS HOLDS
"${held}" (${heldDate || "undated"})

OVER THIS
"${other}" (${otherDate || "undated"})

RULES
- The position states the view that holds, with its numbers, in a few lines.
- The other view stays as one sentence with its date, as a minority view.
- Keep everything else the position says that the ruling does not touch.
- summaryLine is one line, under 18 words.
- English. No em-dashes. Under 30 words per sentence. Numbers over adjectives. Never mention sources, filing or concepts.

Reply with only JSON: {"position":"","summaryLine":""}`;

export type Clash = { id: string; brain: string; title: string; a: string; aDate: string; b: string; bDate: string; why: string; real?: boolean };

/** Every open conflict of a space, each marked real or not, the unmarked ones checked once. */
export async function listConflicts(ctx: any, space: string, model?: string, key?: string): Promise<{ conflicts: Clash[]; others: number }> {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  const all: Clash[] = [];
  for (const br of head.brains) {
    let cursor: string | null = null;
    for (;;) {
      const p: any = await ctx.runQuery(internal.store.conflictsPage, { space, brain: br.slug, cursor });
      for (const c of p.items) for (const x of c.conflicts ?? []) {
        all.push({ id: c.id, brain: c.brain, title: c.title, a: String(x?.a ?? ""), aDate: String(x?.aDate ?? ""),
                   b: String(x?.b ?? ""), bDate: String(x?.bDate ?? ""), why: String(x?.why ?? ""),
                   ...(typeof x?.real === "boolean" ? { real: x.real } : {}) });
      }
      if (!p.next) break;
      cursor = p.next;
    }
  }

  /* The unmarked ones, 40 to a check. A check that fails marks nothing and
     shows them all, so a ruling is never hidden by a failure. */
  const open = all.filter(c => c.real === undefined);
  for (let i = 0; i < open.length; i += 40) {
    const part = open.slice(i, i + 40);
    try {
      const { text } = await ask([
        { role: "system", content: "You judge whether two claims contradict. You reply with JSON only." },
        { role: "user", content: `${CHECK_RULES}\n\n` + part.map((c, k) =>
          `${k + 1}. A: "${c.a.slice(0, 300)}" | B: "${c.b.slice(0, 300)}" | recorded because: ${c.why.slice(0, 200)}`).join("\n") },
      ], { json: true, maxTokens: 600, timeout: 60000, model, key });
      const real = parseJson(text)?.real;
      if (!Array.isArray(real) || real.length !== part.length) continue;
      part.forEach((c, k) => { c.real = real[k] === true; });
      await ctx.runMutation(internal.store.flagConflicts,
        { space, flags: part.map(c => ({ id: c.id, a: c.a, b: c.b, real: !!c.real })) });
    } catch { /* shown unmarked, below */ }
  }

  const shown = all.filter(c => c.real !== false);
  return { conflicts: shown, others: all.length - shown.length };
}

/** Settle one: "a" or "b" holds, and the position is rewritten; "both" only clears it. */
export async function settleConflict(ctx: any, space: string, b: any, model?: string, key?: string) {
  const id = String(b.id ?? ""), a = String(b.a ?? ""), bb = String(b.b ?? ""), pick = String(b.pick ?? "");
  if (!["a", "b", "both"].includes(pick)) return { error: "pick a, b or both" };
  if (pick === "both") return await ctx.runMutation(internal.store.settleConflict, { space, id, a, b: bb });

  const [c] = await ctx.runQuery(internal.store.conceptsByIds, { space, ids: [id] });
  if (!c) return { error: "that concept is not in this space" };
  const x = (c.conflicts ?? []).find((y: any) => String(y?.a ?? "") === a && String(y?.b ?? "") === bb);
  if (!x) return { error: "that conflict is already settled" };
  const [held, heldDate, other, otherDate] = pick === "a"
    ? [a, String(x.aDate ?? ""), bb, String(x.bDate ?? "")]
    : [bb, String(x.bDate ?? ""), a, String(x.aDate ?? "")];
  const { text } = await ask([
    { role: "system", content: "You maintain a knowledge base. You write in English. You reply with JSON only." },
    { role: "user", content: REWRITE(String(c.position ?? ""), held, heldDate, other, otherDate) },
  ], { json: true, maxTokens: 1200, timeout: 90000, model, key });
  const out = parseJson(text) ?? {};
  const position = plainClaim(out.position), summaryLine = plainClaim(out.summaryLine);
  if (!position) return { error: "the rewrite came back empty, so nothing changed. Try again." };
  const r = await ctx.runMutation(internal.store.settleConflict, { space, id, a, b: bb, position, summaryLine });
  return { ...r, position, summaryLine };
}
