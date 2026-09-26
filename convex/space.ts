/**
 * A space as every list reads it: brains, a card per concept, sources.
 *
 * Cards come a brain at a time and a page at a time, so no single call
 * returns more than 4,000 of them, and the space as a whole has no ceiling
 * but the caller's memory. An action or an HTTP route calls this.
 */

import { internal } from "./_generated/api";

export async function loadSpace(ctx: any, space: string, onHead?: (head: any) => Promise<void>) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  /* A caller can act on the head first: the app starts the card build here,
     before the heavier read that follows. */
  if (onHead) await onHead(head);
  const cards: any[] = [];
  for (const b of head.brains) {
    let cursor: string | null = null;
    for (;;) {
      const p: any = await ctx.runQuery(internal.store.cardsPage, { brain: b.slug, cursor, ready: head.ready });
      for (const c of p.cards) cards.push(c);
      if (p.done) break;
      cursor = p.cursor;
    }
  }
  return { brains: head.brains, cards, sources: head.sources, ready: head.ready };
}
