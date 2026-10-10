/**
 * What model calls cost, counted where they run and kept month by month: a project's own row (with an optional monthly cap), or a row a
 * kind of work outside the projects (the chats, drops, upkeep, one-pagers). Every model call can report its usage (ask's `meter`), so
 * a caller wraps its work once and nothing is missed.
 */

import { internal } from "./_generated/api";
import type { SpendKind } from "./lib";
import { splitKey } from "./sheet";

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

/** Dollars as a person reads them: cents from a cent up, more places below. */
const dollars = (n: number) => n >= 0.1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4);

/**
 * A workspace's projects may be given a monthly cap. Before a message, a file read in, a resource or a Brief asks a model anything,
 * the month's cost so far is read, and a cap that is reached stops it with a sentence that says where to change it.
 */
export async function guardBudget(ctx: any, space: string) {
  const b: { cap: number | null; usd: number } = await ctx.runQuery(internal.projects.budgetState, { space });
  if (b.cap != null && b.usd >= b.cap) throw new Error(`The projects have used this month's budget: $${dollars(b.usd)} of $${b.cap.toFixed(2)}. Raise the cap in Settings, or wait for the 1st.`);
}

/**
 * Runs what asks a model outside a project and adds what it cost to the month's row for its kind: tokens always, dollars as the model host
 * reported them. Added whether the work finished or failed, since a call that answered was paid for, and recording never fails the work.
 * The demo is not counted.
 */
export async function withChatSpend<T>(ctx: any, o: { space: string; kind: SpendKind; skip?: boolean }, run: (tally: (u: any) => void) => Promise<T>): Promise<T> {
  const s = newSpent();
  try { return await run(u => meter(s, u)); }
  finally {
    if ((s.calls || s.reused) && !o.skip) {
      try { await ctx.runMutation(internal.projects.chatSpendAdd, { space: o.space, kind: o.kind, usd: s.usd, priced: s.priced, calls: s.calls, tokensIn: s.in, tokensOut: s.out, cached: s.cached, ...(s.reused ? { reused: s.reused } : {}) }); }
      catch (e: any) { console.log(`the cost of a chat message was not recorded: ${String(e?.message ?? e).slice(0, 140)}`); }
    }
  }
}

/**
 * Runs what asks a model for a project, once the cap allows it, and adds what it cost to the project's row for the month: tokens always,
 * dollars as the model host reported them. It is added whether the run finished or failed, since a call that answered was paid for, and
 * recording never fails what it records.
 */
export async function withSpend<T>(ctx: any, o: { space: string; brain: string }, run: (tally: (u: any) => void) => Promise<T>): Promise<T> {
  await guardBudget(ctx, o.space);
  const s = newSpent();
  try { return await run(u => meter(s, u)); }
  finally {
    if (s.calls) {
      try { await ctx.runMutation(internal.projects.spendAdd, { space: o.space, brain: splitKey(o.brain).base, usd: s.usd, priced: s.priced, calls: s.calls, tokensIn: s.in, tokensOut: s.out, cached: s.cached }); }
      catch (e: any) { console.log(`the cost of a call was not recorded: ${String(e?.message ?? e).slice(0, 140)}`); }
    }
  }
}

