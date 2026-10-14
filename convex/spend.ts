/**
 * What model calls cost, counted where they run and kept month by month: one row a kind of work (the chats, the assets, drops, upkeep,
 * one-pagers, voice) a workspace a month. Every model call can report its usage (ask's `meter`), so a caller wraps its work once and
 * nothing is missed.
 */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { readSpace, SPEND_KINDS } from "./lib";
import type { SpendKind } from "./lib";

/** What a message cost, from the usage each model call reports. */
export type Spent = { in: number; out: number; cached: number; usd: number; known: boolean; calls: number; priced: number; reused: number };
export const newSpent = (): Spent => ({ in: 0, out: 0, cached: 0, usd: 0, known: false, calls: 0, priced: 0, reused: 0 });
/** The usage of one call, added. `{ reused: 1 }` counts an answer given again from the cache, for no call. */
export function meter(s: Spent, u: any) {
  if (!u) return;
  if (u.reused){ s.reused += Number(u.reused) || 0; return; }
  s.calls++;
  s.in += Number(u.prompt_tokens) || 0;
  s.out += Number(u.completion_tokens) || 0;
  s.cached += Number(u.prompt_tokens_details?.cached_tokens) || 0;
  if (typeof u.cost === "number" && Number.isFinite(u.cost)) { s.usd += u.cost; s.known = true; s.priced++; }
}

/**
 * Runs what asks a model and adds what it cost to the month's row for its kind: tokens always, dollars as the model host reported
 * them. Added whether the work finished or failed, since a call that answered was paid for, and recording never fails the work.
 * The demo is not counted.
 */
export async function withChatSpend<T>(ctx: any, o: { space: string; kind: SpendKind; skip?: boolean }, run: (tally: (u: any) => void) => Promise<T>): Promise<T> {
  const s = newSpent();
  try { return await run(u => meter(s, u)); }
  finally {
    if ((s.calls || s.reused) && !o.skip) {
      try { await ctx.runMutation(internal.spend.chatSpendAdd, { space: o.space, kind: o.kind, usd: s.usd, priced: s.priced, calls: s.calls, tokensIn: s.in, tokensOut: s.out, cached: s.cached, ...(s.reused ? { reused: s.reused } : {}) }); }
      catch (e: any) { console.log(`the cost of a call was not recorded: ${String(e?.message ?? e).slice(0, 140)}`); }
    }
  }
}

/** The month a cost belongs to, UTC: "2026-10". */
export const monthOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 7);
/** The month before a month. */
const monthBefore = (m: string) => { const [y, n] = m.split("-").map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };
const monthRows = async (ctx: any, space: string, month: string): Promise<any[]> =>
  await ctx.db.query("chatSpend").withIndex("by_space_month", (q: any) => q.eq("space", readSpace(space)).eq("month", month)).collect();

/** What one piece of work cost, added to the month's row for its kind. */
export const chatSpendAdd = internalMutation({
  args: { space: v.string(), kind: v.string(), usd: v.number(), priced: v.number(), calls: v.number(), tokensIn: v.number(), tokensOut: v.number(), cached: v.number(),
          reused: v.optional(v.number()) },
  handler: async (ctx, a) => {
    if (!(SPEND_KINDS as readonly string[]).includes(a.kind)) throw new Error(`a cost is counted as one of ${SPEND_KINDS.join(", ")}`);
    const space = readSpace(a.space), month = monthOf();
    const row = (await monthRows(ctx, space, month)).find((r: any) => r.kind === a.kind);
    const add = { usd: a.usd, priced: a.priced, calls: a.calls, tokensIn: a.tokensIn, tokensOut: a.tokensOut, cached: a.cached };
    const reused = a.reused ?? 0;
    if (row) await ctx.db.patch(row._id, { usd: row.usd + add.usd, priced: row.priced + add.priced, calls: row.calls + add.calls, tokensIn: row.tokensIn + add.tokensIn, tokensOut: row.tokensOut + add.tokensOut, cached: row.cached + add.cached,
      ...(reused ? { reused: (row.reused ?? 0) + reused } : {}), at: Date.now() });
    else await ctx.db.insert("chatSpend", { space, month, kind: a.kind, ...add, ...(reused ? { reused } : {}), at: Date.now() });
    return { ok: true };
  },
});

/** What the workspace cost this month, kind by kind, and in all the month before: what Settings shows. */
export const spendOf = internalQuery({
  args: { space: v.string() },
  handler: async (ctx, a) => {
    const month = monthOf(), before = monthBefore(month);
    const chats = (await monthRows(ctx, a.space, month))
      .map((r: any) => ({ kind: r.kind as string, usd: r.usd as number, calls: r.calls as number, priced: r.priced as number, tokensIn: r.tokensIn as number, tokensOut: r.tokensOut as number, cached: r.cached as number,
        ...(r.reused ? { reused: r.reused as number } : {}) }));
    const sum = (k: string) => chats.reduce((n: number, r: any) => n + (r[k] ?? 0), 0);
    return { month, usd: sum("usd"), calls: sum("calls"), chats, last: { month: before, usd: (await monthRows(ctx, a.space, before)).reduce((n: number, r: any) => n + r.usd, 0) } };
  },
});
