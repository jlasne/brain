/**
 * A personal brain: a chat that files what its owner says.
 *
 * Each message is read once for what is worth keeping later: a fact, a plan,
 * a decision, an idea, a view, a feeling, something learned. It lands in the
 * personal brain as a note in the owner's own words, dated: a new concept, or
 * one it already holds, whose position is rewritten so a change of mind
 * replaces the old view and keeps the date of each. Only the owner's words
 * are filed. The brain's replies, and any guess about the owner, never are.
 *
 * A memory export pasted in (from ChatGPT, Claude or a notes file) is filed
 * the same way, a few thousand characters at a time.
 *
 * No other brain, no map, no digest and no connector reads a personal brain:
 * loadSpace leaves it out unless a caller asks for it.
 */

import { internal } from "./_generated/api";
import { sameTitle, idOf } from "./words";

export type Note = { title: string; claim: string; position: string; summaryLine: string; update: string };
export type Filed = { new: number; updated: number; titles: string[] };
export type Kind = "chat" | "import";

/* A chat message files a few notes at most; an import files more per piece. */
const MAX_NOTES: Record<Kind, number> = { chat: 3, import: 10 };
/* What one call reads: the message, and a piece of an import. */
export const MAX_CHARS: Record<Kind, number> = { chat: 4000, import: 8000 };

const words = (t: string) => new Set(String(t).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/).filter(w => w.length >= 4));

/**
 * The notes worth showing the filer whole: the ones that share the most words
 * with the message, then the newest. The rest go by title and summary line.
 */
export function nearest(cards: any[], text: string, n = 10): any[] {
  const want = words(text);
  const scored = cards.map(c => {
    const have = words(`${c.title} ${c.summaryLine ?? ""}`);
    let hit = 0;
    for (const w of want) if (have.has(w)) hit++;
    return { c, hit };
  });
  const top = scored.filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, n).map(x => x.c);
  /* The newest few too, where a follow-up with no shared word usually lands. */
  const recent = [...cards].sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
    .filter(c => !top.includes(c)).slice(0, 4);
  return [...top, ...recent];
}

/** The filer's instructions and input. */
export function filerPrompt(kind: Kind, text: string, context: string, opened: any[], others: any[], date: string) {
  const held = [
    ...opened.map(c => `- "${c.title}": ${String(c.position || c.summaryLine || "").slice(0, 700)}` +
      (c.evidence?.[0]?.date ? ` (last said ${c.evidence[0].date})` : "")),
    ...others.slice(0, 80).map(c => `- "${c.title}": ${String(c.summaryLine ?? "").slice(0, 160)}`),
  ].join("\n");
  const what = kind === "chat"
    ? "a message its owner just typed in a chat with their personal brain"
    : "a memory export or notes its owner pasted in, from another assistant or a notes file";
  return [
    { role: "system" as const, content: "You file notes into a person's own knowledge base. You return JSON only." },
    { role: "user" as const, content:
`Below is ${what}. File what is worth remembering later into their personal brain.

WHAT TO FILE
- Anything they state: facts about them or the world, plans, decisions, opinions, ideas, feelings, goals, preferences, things they learned, questions they are thinking about.
- Only their own words and meaning. Never file a guess or an inference about them ("seems risk-averse"). Never file what an assistant said.
- A plain request to look something up, a greeting or a thank-you files nothing: return {"notes": []}.
- At most ${MAX_NOTES[kind]} notes. One note per topic: group what belongs together.

HOW TO FILE
- Prefer an existing note on the same topic: set "update" to its exact title as listed under HELD NOW. Otherwise leave "update" empty and give a new short title (2 to 6 words, a topic, never a sentence).
- "claim": what they said, in one sentence, in their own words and their language, first person kept ("I want to move to Lisbon").
- "position": the note as it stands after this, 1 to 4 sentences. For an update, rewrite it from what it held plus this. When they changed their mind, state the new view and name the one it replaces with its date, e.g. "Now prefers X (${date}); said Y on 2026-09-12."
- "summaryLine": the position in under 15 words.
- Keep their language. No em-dashes.
${context ? `
EARLIER IN THE CHAT (context only, never filed)
${context}
` : ""}
HELD NOW
${held || "(nothing yet)"}

TODAY: ${date}

${kind === "chat" ? "THE MESSAGE" : "THE PASTED TEXT"}
${text}

Return: {"notes":[{"title":"","update":"","claim":"","position":"","summaryLine":""}]}` },
  ];
}

/** The notes out of the filer's reply, cleaned; anything malformed is dropped. */
export function readNotes(raw: string, kind: Kind): Note[] {
  let d: any;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { return []; }
  const clean = (t: any, n: number) => String(t ?? "").replace(/—/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
  return (Array.isArray(d?.notes) ? d.notes : []).map((x: any) => ({
    title: clean(x?.update || x?.title, 90),
    update: clean(x?.update, 90),
    claim: clean(x?.claim, 600),
    position: clean(x?.position, 1400),
    summaryLine: clean(x?.summaryLine, 200),
  })).filter((x: Note) => x.title.length >= 2 && x.claim.length >= 2)
    .map((x: Note) => ({ ...x, position: x.position || x.claim, summaryLine: x.summaryLine || x.claim.slice(0, 120) }))
    .slice(0, MAX_NOTES[kind]);
}

/**
 * Write the notes. Each one names the day's source row, "You" as its author,
 * so every claim in a personal brain carries who said it and when.
 */
export async function fileNotes(ctx: any, space: string, brain: string, held: any[], notes: Note[], kind: Kind, date: string): Promise<Filed> {
  const out: Filed = { new: 0, updated: 0, titles: [] };
  if (!notes.length) return out;
  const sid = `${brain}-${kind === "chat" ? "chat" : "import"}-${date}`;
  await ctx.runMutation(internal.store.writeSource, { space, doc: {
    sid, link: "", linkKey: sid, title: kind === "chat" ? `Chat, ${date}` : `Imported memory, ${date}`,
    author: kind === "chat" ? "You" : "You (imported)", date, location: "", brains: [brain],
  } });
  for (const n of notes) {
    const seen = held.find(c => sameTitle(c.title, n.update || n.title));
    await ctx.runMutation(internal.store.upsertConcept, {
      brain, title: seen?.title ?? n.title, ...(seen?.slug ? { slug: seen.slug } : {}),
      doc: { position: n.position, summaryLine: n.summaryLine, sources: [sid],
             evidence: [{ date, author: kind === "chat" ? "You" : "You (imported)", claim: n.claim, source: sid }] },
    });
    if (seen) out.updated++; else out.new++;
    out.titles.push(seen?.title ?? n.title);
  }
  return out;
}

/**
 * Read one message or one piece of an import, and file it. The model call
 * comes in as a function, so the key it runs on never passes through here.
 */
export async function remember(ctx: any, o: {
  space: string; brain: string; cards: any[]; text: string; context?: string; kind: Kind; date: string;
  model: (messages: { role: "system" | "user" | "assistant"; content: string }[]) => Promise<string>;
}): Promise<Filed> {
  const text = String(o.text ?? "").slice(0, MAX_CHARS[o.kind]).trim();
  if (!text) return { new: 0, updated: 0, titles: [] };
  const held = o.cards.filter(c => c.brain === o.brain);
  const near = nearest(held, text);
  const opened = near.length
    ? await ctx.runQuery(internal.store.conceptsByIds, { space: o.space, ids: near.map(idOf) })
    : [];
  const others = held.filter(c => !near.includes(c));
  const raw = await o.model(filerPrompt(o.kind, text, String(o.context ?? "").slice(0, 1500), opened, others, o.date));
  return await fileNotes(ctx, o.space, o.brain, held, readNotes(raw, o.kind), o.kind, o.date);
}

/** The rules a reply in a personal chat follows. */
export const REPLY_RULES =
`You are the user's personal brain: you remember what they tell you and you talk with them.
- Reply in their language, like a person who knows them: 1 to 4 short sentences unless they ask for more.
- Use what their notes and their other brains hold when it helps, and cite a note's date when you rely on it.
- When they change their mind on something noted before, acknowledge it in passing: "Noted, that replaces what you said on 2026-09-12."
- Never guess about their character. Say only what they told you or what their brains hold.
- Ask at most one question back, and only when it helps them think.
- No em-dashes. Under 30 words per sentence. Simple wording.`;
