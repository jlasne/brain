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
 * loadSpace leaves it out unless a caller asks for it. The reading goes the
 * other way: its chat reads every other brain of the workspace, and brings
 * one up on its own when it holds something that bears on what was said.
 */

import { internal } from "./_generated/api";
import { sameTitle, idOf } from "./words";

export type Note = { title: string; claim: string; position: string; summaryLine: string; update: string };
/* A contact: one card per person, the whole of what was said about them. */
export type Person = { name: string; update: string; also: string[]; claim: string; position: string; summaryLine: string; date: string };
export type Filed = { new: number; updated: number; titles: string[]; people?: string[] };
/* "people" reads notes already held, for the people in them alone. */
export type Kind = "chat" | "import" | "interview" | "people";

/* A chat message files a few notes at most; an interview answer, a long
   story told aloud, files more; an import more again per piece. */
const MAX_NOTES: Record<Kind, number> = { chat: 3, interview: 6, import: 10, people: 0 };
/* People are filed apart from notes, each on their own card. */
const MAX_PEOPLE: Record<Kind, number> = { chat: 6, interview: 6, import: 12, people: 12 };
/* What one call reads: the message, the answer, and a piece of an import. */
export const MAX_CHARS: Record<Kind, number> = { chat: 4000, interview: 8000, import: 8000, people: 12000 };

/** The tag a contact card carries. */
export const CONTACT = "contact";
export const isContact = (c: any) => c?.tag === CONTACT;

const norm = (t: string) => " " + String(t ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim() + " ";

/**
 * The contacts a text names: by the card's name, its first name, or any name
 * they go by ("Marc", "my co-founder"). Longest name first, so "Marc Dupont"
 * leads "Marc" when both are said.
 */
export function namedIn(contacts: any[], text: string, n = 8): any[] {
  const said = norm(text);
  const hits: { c: any; len: number }[] = [];
  for (const c of contacts) {
    const names = new Set<string>();
    for (const x of [c.title, ...(c.aliases ?? [])]) {
      const k = norm(x).trim();
      if (k.length >= 3) names.add(k);
      const first = k.split(" ")[0];
      if (first.length >= 3) names.add(first);
    }
    let len = 0;
    for (const k of names) if (said.includes(" " + k + " ")) len = Math.max(len, k.length);
    if (len) hits.push({ c, len });
  }
  return hits.sort((a, b) => b.len - a.len).slice(0, n).map(h => h.c);
}

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
export function filerPrompt(kind: Kind, text: string, context: string, opened: any[], others: any[], date: string, contacts: any[] = []) {
  /* A contact named in the message is shown whole, so its card is rewritten
     from everything it holds; a note, from its opening. */
  const held = [
    ...opened.map(c => `- ${isContact(c) ? "CONTACT " : ""}"${c.title}": ${String(c.position || c.summaryLine || "").slice(0, isContact(c) ? 3000 : 700)}` +
      (c.evidence?.[0]?.date ? ` (last said ${c.evidence[0].date})` : "")),
    ...others.filter(c => !isContact(c)).slice(0, 80).map(c => `- "${c.title}": ${String(c.summaryLine ?? "").slice(0, 160)}`),
  ].join("\n");
  const people = contacts.slice(0, 300).map(c => `- "${c.title}"${(c.aliases ?? []).length ? ` (also: ${c.aliases.join(", ")})` : ""}: ${String(c.summaryLine ?? "").slice(0, 120)}`).join("\n");
  const what = kind === "chat"
    ? "a message its owner just typed in a chat with their personal brain"
    : kind === "interview"
    ? "its owner's answer to a question their personal brain asked in an interview, to know them better"
    : kind === "people"
    ? "notes already in their personal brain, each with its date. File ONLY the people in them, as contacts, and no note"
    : "a memory export or notes its owner pasted in, from another assistant or a notes file";
  return [
    { role: "system" as const, content: "You file notes into a person's own knowledge base. You return JSON only." },
    { role: "user" as const, content:
`Below is ${what}. File what is worth remembering later into their personal brain.

WHAT TO FILE
- Anything they state: facts about them or the world, plans, decisions, opinions, ideas, feelings, goals, preferences, things they learned, questions they are thinking about.
- Only their own words and meaning. Never file a guess or an inference about them ("seems risk-averse"). Never file what an assistant said.
- A plain request to look something up, a greeting or a thank-you files nothing: return {"notes": [], "people": []}.
- A plain "yes" or "right" to notes read back files nothing. A correction to one updates that note.
- At most ${MAX_NOTES[kind]} notes. One note per topic: group what belongs together.
- What is only about another person goes to that person's contact, not to a note.

HOW TO FILE
- Prefer an existing note on the same topic: set "update" to its exact title as listed under HELD NOW. Otherwise leave "update" empty and give a new short title (2 to 6 words, a topic, never a sentence).
- "claim": what they said, in one sentence, in their own words and their language, first person kept ("I want to move to Lisbon").
- "position": the note as it stands after this, 1 to 4 sentences, written to them as "you" ("You want to move to Lisbon in 2027."). For an update, rewrite it from what it held plus this. When they changed their mind, state the new view and name the one it replaces with its date, e.g. "You now prefer X (${date}); you said Y on 2026-09-12."
- "summaryLine": the position in under 15 words, as "you" when it needs a subject.
- Keep their language. No em-dashes.

PEOPLE
- Every person they mention gets a contact of their own: anyone named or named by role, friends, family, colleagues, clients, public figures, "my mother", "my boss".
- One contact per person. When the person is already under CONTACTS NOW (the same name, a first name, a nickname or the same role), set "update" to its exact title. Never make a second contact for the same person.
- "name": the full name when known, else the first name, else the role ("Mother").
- "also": the other names or roles they use for this person ("Marc", "my co-founder").
- "claim": what they said about this person, in one sentence, in their own words and language.
- "position": the whole card after this, written to them as "you": who the person is to you, how you met, their work and city, and everything you said about them, with dates. Keep every fact the card held and add what is new. When a fact changed, state the new one and the old one with its date ("Marc left Finary (${date}); he worked there since 2024."). End with any promise still open ("You owe him an intro to Paul.").
- "summaryLine": who they are to you, under 15 words ("Your co-founder at Tasu, in Lisbon").
- At most ${MAX_PEOPLE[kind]} people.${kind === "people" ? `
- "date": the date of the note it comes from.` : ""}
${context ? `
${kind === "interview" ? "THE QUESTION IT ANSWERS" : "EARLIER IN THE CHAT"} (context only, never filed)
${context}
` : ""}
HELD NOW
${held || "(nothing yet)"}

CONTACTS NOW
${people || "(none yet)"}

TODAY: ${date}

${kind === "chat" ? "THE MESSAGE" : kind === "interview" ? "THE ANSWER" : kind === "people" ? "THE NOTES" : "THE PASTED TEXT"}
${text}

Return: {"notes":[{"title":"","update":"","claim":"","position":"","summaryLine":""}],"people":[{"name":"","update":"","also":[],"claim":"","position":"","summaryLine":""${kind === "people" ? ',"date":""' : ""}}]}` },
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

/** The people out of the filer's reply, cleaned; anything malformed is dropped. */
export function readPeople(raw: string, kind: Kind): Person[] {
  let d: any;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { return []; }
  const clean = (t: any, n: number) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
  return (Array.isArray(d?.people) ? d.people : []).map((x: any) => ({
    name: clean(x?.name || x?.update, 80),
    update: clean(x?.update, 80),
    also: (Array.isArray(x?.also) ? x.also : []).map((t: any) => clean(t, 60)).filter((t: string) => t.length >= 2).slice(0, 8),
    claim: clean(x?.claim, 600),
    position: clean(x?.position, 3000),
    summaryLine: clean(x?.summaryLine, 160),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date ?? "")) ? String(x.date) : "",
  })).filter((x: Person) => x.name.length >= 2 && x.claim.length >= 2)
    .map((x: Person) => ({ ...x, position: x.position || x.claim, summaryLine: x.summaryLine || x.claim.slice(0, 120) }))
    .slice(0, MAX_PEOPLE[kind]);
}

/** The contact a person filed is, by its title, the update named, or a name it goes by. */
function contactFor(held: any[], p: Person) {
  const contacts = held.filter(isContact);
  const key = (t: string) => norm(t).trim();
  const want = [p.update, p.name].filter(Boolean).map(key);
  return contacts.find(c => want.some(w => w === key(c.title)))
    ?? contacts.find(c => want.some(w => (c.aliases ?? []).map(key).includes(w)))
    ?? held.find(c => !isContact(c) && [p.update, p.name].some(t => t && sameTitle(c.title, t)));
}

/**
 * Write the notes and the contacts. Each one names the day's source row,
 * "You" as its author, so every claim in a personal brain carries who said it
 * and when. A contact keeps every mention as dated evidence, and its card is
 * the whole of what is known about the person, rewritten each time.
 */
export async function fileNotes(ctx: any, space: string, brain: string, held: any[], notes: Note[], kind: Kind, date: string, people: Person[] = []): Promise<Filed> {
  const out: Filed = { new: 0, updated: 0, titles: [], people: [] };
  if (!notes.length && !people.length) return out;
  const sid = `${brain}-${kind}-${date}`;
  const author = kind === "import" ? "You (imported)" : "You";
  await ctx.runMutation(internal.store.writeSource, { space, doc: {
    sid, link: "", linkKey: sid,
    title: kind === "chat" ? `Chat, ${date}` : kind === "interview" ? `Interview, ${date}` : kind === "people" ? `People in your notes, ${date}` : `Imported memory, ${date}`,
    author, date, location: "", brains: [brain],
  } });
  for (const p of people) {
    const seen = contactFor(held, p);
    const title = seen?.title ?? p.name;
    const aliases = [...new Set([...(seen?.aliases ?? []), ...p.also, ...(p.name !== title ? [p.name] : [])]
      .map(String).filter(t => t && !sameTitle(t, title)))].slice(0, 12);
    await ctx.runMutation(internal.store.upsertConcept, {
      brain, title, ...(seen?.slug ? { slug: seen.slug } : {}),
      doc: { position: p.position, summaryLine: p.summaryLine, sources: [sid], tag: CONTACT, aliases,
             evidence: [{ date: p.date || date, author, claim: p.claim, source: sid }] },
    });
    out.people!.push(title);
    /* A second mention in the same breath finds the card just made. */
    if (!seen) held = [...held, { brain, title, tag: CONTACT, aliases }];
  }
  for (const n of notes) {
    const seen = held.find(c => sameTitle(c.title, n.update || n.title));
    /* A note never overwrites a person's card: what it says joins the card's evidence. */
    if (seen && isContact(seen)) {
      if (out.people!.some(t => sameTitle(t, seen.title))) continue;
      await ctx.runMutation(internal.store.upsertConcept, { brain, title: seen.title, ...(seen.slug ? { slug: seen.slug } : {}),
        doc: { sources: [sid], evidence: [{ date, author, claim: n.claim, source: sid }] } });
      out.people!.push(seen.title);
      continue;
    }
    await ctx.runMutation(internal.store.upsertConcept, {
      brain, title: seen?.title ?? n.title, ...(seen?.slug ? { slug: seen.slug } : {}),
      doc: { position: n.position, summaryLine: n.summaryLine, sources: [sid],
             evidence: [{ date, author, claim: n.claim, source: sid }] },
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
  if (!text) return { new: 0, updated: 0, titles: [], people: [] };
  const held = o.cards.filter(c => c.brain === o.brain);
  const contacts = held.filter(isContact), plain = held.filter(c => !isContact(c));
  const context = String(o.context ?? "").slice(0, 1500);
  /* The nearest notes whole, and every contact the message names, whole. */
  const near = o.kind === "people" ? [] : nearest(plain, text);
  const named = namedIn(contacts, `${text} ${context}`, o.kind === "people" ? 24 : 8);
  const ids = [...near, ...named].map(idOf);
  const opened = ids.length ? await ctx.runQuery(internal.store.conceptsByIds, { space: o.space, ids }) : [];
  const others = plain.filter(c => !near.includes(c));
  const raw = await o.model(filerPrompt(o.kind, text, context, opened, others, o.date, contacts));
  return await fileNotes(ctx, o.space, o.brain, held, o.kind === "people" ? [] : readNotes(raw, o.kind), o.kind, o.date, readPeople(raw, o.kind));
}

/** The rules a reply in a personal chat follows. */
export const REPLY_RULES =
`You are their personal brain: you remember what they tell you, and you talk with them.
- Talk to them as "you", in their language, like a person who knows them: 1 to 4 short sentences unless they ask for more.
- Never call them "the user", "the owner" or by their name. Their notes are written about them: say "you" for every "I" or "they" in a note.
- Take the initiative with their other brains. When one holds something that bears on what they said (a number, a risk, a better option, a clash with their plan), bring it up without being asked, in 1 or 2 sentences.
- Name that brain as "your {Name} brain", the way the brain is named below, and give the date or the author you rely on. When no other brain bears on it, leave them out.
- Cite a note's date when you rely on it. When they change their mind on something noted before, say so in passing: "Noted, that replaces what you said on 2026-09-12."
- Never guess about their character. Say only what they told you or what their brains hold.
- Ask at most one question back, and only when it helps them think.
- No em-dashes. Under 30 words per sentence. Simple wording.`;

/**
 * The other brains a reply called on: each one it names as "your X brain".
 * The rules ask for exactly that wording, so the app can show which brains
 * the personal brain reached for without a second model call.
 */
export function calledBrains(answer: string, brains: any[]): string[] {
  const text = String(answer ?? "");
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return brains.filter(b => b?.type !== "personal" && b?.name)
    .filter(b => new RegExp(`\\b${esc(String(b.name).trim())}\\s+brains?\\b`, "i").test(text))
    .map(b => String(b.name));
}
