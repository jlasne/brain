/**
 * A space as every list reads it: brains, a card per concept, sources.
 *
 * Cards come a brain at a time and a page at a time, so no single call
 * returns more than 4,000 of them, and the space as a whole has no ceiling
 * but the caller's memory. An action or an HTTP route calls this.
 */

import { internal } from "./_generated/api";

export async function loadSpace(ctx: any, space: string, onHead?: (head: any) => Promise<void>, opts: { personal?: boolean } = {}) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  /* A caller can act on the head first: the app starts the card build here,
     before the heavier read that follows. */
  if (onHead) await onHead(head);
  /* A personal brain holds what its owner said in its chat. Only the app's
     lists and that chat ask for it; every other reader never sees it. */
  const kept = opts.personal ? head : withoutPersonal(head);
  const cards: any[] = [];
  for (const b of kept.brains) {
    let cursor: string | null = null;
    for (;;) {
      const p: any = await ctx.runQuery(internal.store.cardsPage, { brain: b.slug, cursor, ready: head.ready });
      for (const c of p.cards) cards.push(c);
      if (p.done) break;
      cursor = p.cursor;
    }
  }
  return { brains: kept.brains, cards, sources: kept.sources, ready: head.ready };
}

/** A space as every reader but a personal chat sees it: no personal brain, its cards or its sources. */
export function withoutPersonal<T extends { brains: any[]; sources: any[]; cards?: any[] }>(s: T): T {
  const mine = new Set(s.brains.filter((b: any) => b.type === "personal").map((b: any) => b.slug));
  if (!mine.size) return s;
  return {
    ...s,
    brains: s.brains.filter((b: any) => !mine.has(b.slug)),
    ...(s.cards ? { cards: s.cards.filter((c: any) => !mine.has(c.brain)) } : {}),
    sources: s.sources.map((x: any) => ({ ...x, brains: (x.brains ?? []).filter((b: string) => !mine.has(b)) }))
      .filter((x: any) => x.brains.length),
  };
}
