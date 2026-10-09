/**
 * A space as every list reads it: brains, a card per concept, sources.
 *
 * Cards come a brain at a time and a page at a time, so no single call
 * returns more than 4,000 of them, and the space as a whole has no ceiling
 * but the caller's memory. An action or an HTTP route calls this.
 */

import { internal } from "./_generated/api";

export async function loadSpace(ctx: any, space: string, onHead?: (head: any) => Promise<void>, opts: { personal?: boolean; projects?: boolean } = {}) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space, ...(opts.projects ? { projects: true } : {}) });
  /* A caller can act on the head first: the app starts the card build here,
     before the heavier read that follows. */
  if (onHead) await onHead(head);
  /* A personal brain holds what its owner said in its chat. Only the app's
     lists and that chat ask for it; every other reader never sees it. */
  const kept = opts.personal ? head : withoutPersonal(head);
  return { brains: kept.brains, cards: await cardsFor(ctx, kept.brains.map((b: any) => b.slug), head.ready), sources: kept.sources, ready: head.ready };
}

/** The cards of some brains, a brain at a time and a page at a time. */
export async function cardsFor(ctx: any, slugs: string[], ready: boolean) {
  const cards: any[] = [];
  for (const brain of slugs) {
    let cursor: string | null = null;
    for (;;) {
      const p: any = await ctx.runQuery(internal.store.cardsPage, { brain, cursor, ready });
      for (const c of p.cards) cards.push(c);
      if (p.done) break;
      cursor = p.cursor;
    }
  }
  return cards;
}

/**
 * A space as every reader but a personal chat sees it: no personal brain, no
 * project, and none of their cards or sources. A project keeps what its owner
 * decided, so only its own chat and the personal chat read it.
 */
export function withoutPersonal<T extends { brains: any[]; sources: any[]; cards?: any[] }>(s: T): T {
  const mine = new Set(s.brains.filter((b: any) => b.type === "personal" || b.type === "project").map((b: any) => b.slug));
  if (!mine.size) return s;
  return {
    ...s,
    brains: s.brains.filter((b: any) => !mine.has(b.slug)),
    ...(s.cards ? { cards: s.cards.filter((c: any) => !mine.has(c.brain)) } : {}),
    sources: s.sources.map((x: any) => ({ ...x, brains: (x.brains ?? []).filter((b: string) => !mine.has(b)) }))
      .filter((x: any) => x.brains.length),
  };
}
