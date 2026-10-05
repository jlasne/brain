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
import { sameTitle, idOf, fileText, FILE_SECTIONS } from "./words";

export type Note = { title: string; claim: string; position: string; summaryLine: string; update: string; orig?: string };
/* What the personal folder keeps: English whatever was written ("en"), or the language written in ("same"). */
export type Lang = "en" | "same";
/* A contact: one card per person, the whole of what was said about them. */
/* A person as the filer sends them: who, the summary rewritten, and only
   what this message adds to their file. */
export type Person = { name: string; update: string; also: string[]; claim: string; position: string; summaryLine: string; date: string;
  facts: any[]; events: any[]; links: any[]; open: any[]; orig?: string; raw?: string };
export type Filed = { new: number; updated: number; titles: string[]; people?: string[] };
/* "people" reads notes already held, for the people in them alone. */
/* "files" builds the files of people already held from their cards and mentions. */
export type Kind = "chat" | "import" | "interview" | "people" | "files";

/* A chat message files a few notes at most; an interview answer, a long
   story told aloud, files more; an import more again per piece. */
const MAX_NOTES: Record<Kind, number> = { chat: 3, interview: 6, import: 10, people: 0, files: 0 };
/* People are filed apart from notes, each on their own card. */
const MAX_PEOPLE: Record<Kind, number> = { chat: 6, interview: 6, import: 12, people: 12, files: 6 };
/* What one call reads: the message, the answer, and a piece of an import. */
export const MAX_CHARS: Record<Kind, number> = { chat: 4000, interview: 8000, import: 8000, people: 12000, files: 20000 };

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
export function filerPrompt(kind: Kind, text: string, context: string, opened: any[], others: any[], date: string, contacts: any[] = [], lang: Lang = "same") {
  const en = lang === "en";
  /* A contact named in the message is shown whole, so its card is rewritten
     from everything it holds; a note, from its opening. */
  const held = [
    ...opened.map(c => isContact(c)
      ? `- CONTACT "${c.title}"\n  SUMMARY: ${String(c.position || c.summaryLine || "").slice(0, 1500)}${c.file ? `\n  ${fileText(c, 3500).replace(/\n/g, "\n  ")}` : ""}`
      : `- "${c.title}": ${String(c.position || c.summaryLine || "").slice(0, 700)}` + (c.evidence?.[0]?.date ? ` (last said ${c.evidence[0].date})` : "")),
    ...others.filter(c => !isContact(c)).slice(0, 80).map(c => `- "${c.title}": ${String(c.summaryLine ?? "").slice(0, 160)}`),
  ].join("\n");
  const people = contacts.slice(0, 300).map(c => `- "${c.title}"${(c.aliases ?? []).length ? ` (also: ${c.aliases.join(", ")})` : ""}: ${String(c.summaryLine ?? "").slice(0, 120)}`).join("\n");
  const what = kind === "chat"
    ? "a message its owner just typed in a chat with their personal brain"
    : kind === "interview"
    ? "its owner's answer to a question their personal brain asked in an interview, to know them better"
    : kind === "people"
    ? "notes already in their personal brain, each with its date. File ONLY the people in them, as contacts, and no note"
    : kind === "files"
    ? "the cards of people already in their personal brain, each with every dated thing they said about the person. Build each person's whole file from their card and their mentions: summary, facts, history, links and what is open. File ONLY these people, each with \"update\" set to their title, and no note"
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
${en ? `- "claim": what they said, in one sentence, in English, first person kept ("I want to move to Lisbon"). When they wrote in another language, "orig" holds that sentence as they wrote it.`
  : `- "claim": what they said, in one sentence, in their own words and their language, first person kept ("I want to move to Lisbon").`}
- "position": the note as it stands after this, 1 to 4 sentences, written to them as "you" ("You want to move to Lisbon in 2027."). For an update, rewrite it from what it held plus this. When they changed their mind, state the new view and name the one it replaces with its date, e.g. "You now prefer X (${date}); you said Y on 2026-09-12."
- "summaryLine": the position in under 15 words, as "you" when it needs a subject.
${en ? `- Write every field in English, whatever language they write in: titles, claims, positions, summaries, facts and moments. Translate faithfully; names, places, numbers and quotes keep their meaning. No em-dashes.`
  : `- Keep their language. No em-dashes.`}

PEOPLE
Each person has a FILE that only grows: lasting facts, the history of what happened, the people they are linked to, and what is still open. Send only what THE MESSAGE adds. The server folds it into the file and never loses what the file held.
- Every person they mention gets a file of their own: anyone named or named by role, friends, family, colleagues, clients, public figures, "my mother", "my boss".
- One file per person. When the person is already under CONTACTS NOW (the same name, a first name, a nickname or the same role), set "update" to its exact title. Never make a second file for the same person.
- "name": the full name when known, else the first name, else the role ("Mother").
- "also": the other names or roles they use for this person ("Marc", "my co-founder").
${en ? `- "claim": what they said about this person, in one sentence, in English, with "orig" as they wrote it when that is not English.`
  : `- "claim": what they said about this person, in one sentence, in their own words and language.`}
- "summary": who the person is now, 3 to 6 sentences, written to them as "you": who they are to you, their work, where they live, what matters most about them now. Rewrite it from the file shown under HELD NOW plus this message.
- "summaryLine": who they are to you, under 15 words ("Your co-founder, now at Revolut in London").
- "facts": each lasting fact this message gives, one per entry: {"section","label","value"}. Sections: ${FILE_SECTIONS.map(x => x[0]).join(", ")}. identity: birthday, age, born in, lives in, nationality, languages, family status. contact: phone, email, address, social accounts. you: how you met, since when, how close, how often you see them. work: job, company, role, projects, money. tastes: likes, dislikes, character, habits, values, health. Keep every detail given: numbers, names, places. When the fact replaces an older one (they moved, changed job), add "replaces": true and "since": the date.
- "events": the moments of this person's story, one entry per moment: {"date","text","seen"}. "date" is the real date, YYYY-MM-DD, YYYY-MM or YYYY, worked out from TODAY ("yesterday", "last summer", "in 2019"). "text" tells the moment as an anecdote, with every detail given: what happened, where, who was there, what was said, how it went, 1 to 4 sentences as "you". "seen": true when you were with them or spoke with them that day.
- "links": the people linked to this person: {"name","rel"}, rel from this person's side ("his wife", "her boss", "his co-founder"). Each linked person also gets their own file.
- "open": promises and things to follow up: {"text","done"}. "done": true when this message closes one already open.
- Never repeat what the file already holds. An empty list is a correct answer.
- At most ${MAX_PEOPLE[kind]} people.${kind === "people" ? `
- "date": the date of the note it comes from.` : ""}${kind === "import" ? `
- "raw": every sentence of THE PASTED TEXT about this person, copied word for word in its language, nothing left out.` : ""}
${context ? `
${kind === "interview" ? "THE QUESTION IT ANSWERS" : "EARLIER IN THE CHAT"} (context only, never filed)
${context}
` : ""}
HELD NOW
${held || "(nothing yet)"}

CONTACTS NOW
${people || "(none yet)"}

TODAY: ${date}

${kind === "chat" ? "THE MESSAGE" : kind === "interview" ? "THE ANSWER" : kind === "people" ? "THE NOTES" : kind === "files" ? "THE CARDS" : "THE PASTED TEXT"}
${text}

Return: {"notes":[{"title":"","update":"","claim":"",${en ? '"orig":"",' : ""}"position":"","summaryLine":""}],"people":[{"name":"","update":"","also":[],"claim":"",${en ? '"orig":"",' : ""}"summary":"","summaryLine":"","facts":[{"section":"","label":"","value":""}],"events":[{"date":"","text":"","seen":false}],"links":[{"name":"","rel":""}],"open":[{"text":"","done":false}]${kind === "people" ? ',"date":""' : ""}${kind === "import" ? ',"raw":""' : ""}}]}` },
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
    orig: clean(x?.orig, 600),
    position: clean(x?.position, 1400),
    summaryLine: clean(x?.summaryLine, 200),
  })).filter((x: Note) => x.title.length >= 2 && x.claim.length >= 2)
    .map((x: Note) => ({ ...x, position: x.position || x.claim, summaryLine: x.summaryLine || x.claim.slice(0, 120) }))
    .slice(0, MAX_NOTES[kind]);
}

/** Whether a filer's reply holds a JSON object at all. */
export function readable(raw: string) {
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    const d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
    return !!d && typeof d === "object";
  } catch { return false; }
}

/**
 * Contacts the text names as a proper name: "Maxime arrived" names Maxime,
 * while "my mother nature walk" names no one. A capital is required, so a
 * common word that is also a role is never taken for the person.
 */
export function properlyNamed(contacts: any[], text: string) {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return namedIn(contacts, text, 12).filter(c => {
    const names = new Set<string>();
    for (const x of [c.title, ...(c.aliases ?? [])]) {
      const t = String(x ?? "").trim();
      if (/^\p{Lu}/u.test(t)) { names.add(t); const first = t.split(/\s+/)[0]; if (first.length >= 3) names.add(first); }
    }
    return [...names].some(n => new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, "u").test(text));
  });
}

/** The people out of the filer's reply, cleaned; anything malformed is dropped. */
export function readPeople(raw: string, kind: Kind): Person[] {
  let d: any;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { return []; }
  const clean = (t: any, n: number) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
  const list = (v: any, n: number) => (Array.isArray(v) ? v : []).filter((y: any) => y && typeof y === "object").slice(0, n);
  return (Array.isArray(d?.people) ? d.people : []).map((x: any) => ({
    name: clean(x?.name || x?.update, 80),
    update: clean(x?.update, 80),
    also: (Array.isArray(x?.also) ? x.also : []).map((t: any) => clean(t, 60)).filter((t: string) => t.length >= 2).slice(0, 8),
    claim: clean(x?.claim, 600),
    orig: clean(x?.orig, 600),
    raw: String(x?.raw ?? "").replace(/\s*—\s*/g, ", ").trim().slice(0, 8000),
    /* The summary goes where a card's text always went; an older reply's "position" still reads. */
    position: clean(x?.summary || x?.position, 3000),
    summaryLine: clean(x?.summaryLine, 160),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date ?? "")) ? String(x.date) : "",
    facts: list(x?.facts, 40), events: list(x?.events, 20), links: list(x?.links, 20), open: list(x?.open, 10),
  })).filter((x: Person) => x.name.length >= 2 && (x.claim.length >= 2 || x.facts.length || x.events.length))
    .map((x: Person) => ({ ...x, claim: x.claim || String(x.events[0]?.text ?? x.facts[0]?.value ?? "").slice(0, 600),
      position: x.position || x.claim, summaryLine: x.summaryLine || x.claim.slice(0, 120) }))
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
/* Their own words, beside a claim kept in English, when they wrote in another language. */
const inTheirWords = (x: { claim: string; orig?: string }) => x.orig && x.orig.toLowerCase() !== x.claim.toLowerCase() ? { orig: x.orig } : {};

export async function fileNotes(ctx: any, space: string, brain: string, held: any[], notes: Note[], kind: Kind, date: string, people: Person[] = [],
  missed: any[] = [], said = "", asked = ""): Promise<Filed> {
  const out: Filed = { new: 0, updated: 0, titles: [], people: [] };
  if (!notes.length && !people.length && !missed.length) return out;
  const sid = `${brain}-${kind}-${date}`;
  const author = kind === "import" ? "You (imported)" : "You";
  /* Building files from what is held adds no mention and no source. */
  const quiet = kind === "files";
  /* What was said about a person goes to their raw notes word for word: a
     message whole, or from a pasted text the sentences about them. Notes
     already held add none. */
  const raw = async (title: string, slug: string | undefined, p?: Person) => {
    const text = kind === "chat" || kind === "interview" ? said : kind === "import" ? (p?.raw || p?.orig || p?.claim || "") : "";
    if (!String(text).trim()) return;
    try {
      await ctx.runMutation(internal.store.rawAdd, { brain, title, ...(slug ? { slug } : {}), date, kind, text: String(text),
        ...(kind === "interview" && asked ? { asked } : {}) });
    } catch { /* the file is written; the raw note waits for the next mention */ }
  };
  if (!quiet) await ctx.runMutation(internal.store.writeSource, { space, doc: {
    sid, link: "", linkKey: sid,
    title: kind === "chat" ? `Chat, ${date}` : kind === "interview" ? `Interview, ${date}` : kind === "people" ? `People in your notes, ${date}` : `Imported memory, ${date}`,
    author, date, location: "", brains: [brain],
  } });
  for (const p of people) {
    const seen = contactFor(held, p);
    const title = seen?.title ?? p.name;
    const aliases = [...new Set([...(seen?.aliases ?? []), ...p.also, ...(p.name !== title ? [p.name] : [])]
      .map(String).filter(t => t && !sameTitle(t, title)))].slice(0, 12);
    await ctx.runMutation(internal.store.fileContact, {
      brain, title, ...(seen?.slug ? { slug: seen.slug } : {}), date,
      doc: { position: p.position, summaryLine: p.summaryLine, aliases,
             ...(quiet ? {} : { sources: [sid], evidence: [{ date: p.date || date, author, claim: p.claim, source: sid, ...inTheirWords(p) }] }) },
      add: { facts: p.facts, events: p.events, links: p.links, open: p.open },
    });
    out.people!.push(title);
    await raw(title, seen?.slug, p);
    /* A second mention in the same breath finds the card just made. */
    if (!seen) held = [...held, { brain, title, tag: CONTACT, aliases }];
  }
  /* Named but missed: the mention joins the card as said, the card unchanged. */
  for (const c of missed) {
    await ctx.runMutation(internal.store.upsertConcept, { brain, title: c.title, ...(c.slug ? { slug: c.slug } : {}),
      doc: { sources: [sid], evidence: [{ date, author, claim: String(said).replace(/\s+/g, " ").trim().slice(0, 400), source: sid }] } });
    out.people!.push(c.title);
    await raw(c.title, c.slug);
  }
  for (const n of notes) {
    const seen = held.find(c => sameTitle(c.title, n.update || n.title));
    /* A note never overwrites a person's card: what it says joins the card's evidence. */
    if (seen && isContact(seen)) {
      if (out.people!.some(t => sameTitle(t, seen.title))) continue;
      await ctx.runMutation(internal.store.upsertConcept, { brain, title: seen.title, ...(seen.slug ? { slug: seen.slug } : {}),
        doc: { sources: [sid], evidence: [{ date, author, claim: n.claim, source: sid }] } });
      out.people!.push(seen.title);
      await raw(seen.title, seen.slug);
      continue;
    }
    await ctx.runMutation(internal.store.upsertConcept, {
      brain, title: seen?.title ?? n.title, ...(seen?.slug ? { slug: seen.slug } : {}),
      doc: { position: n.position, summaryLine: n.summaryLine, sources: [sid],
             evidence: [{ date, author, claim: n.claim, source: sid, ...inTheirWords(n) }] },
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
  space: string; brain: string; cards: any[]; text: string; context?: string; kind: Kind; date: string; lang?: Lang;
  model: (messages: { role: "system" | "user" | "assistant"; content: string }[]) => Promise<string>;
}): Promise<Filed> {
  const text = String(o.text ?? "").slice(0, MAX_CHARS[o.kind]).trim();
  if (!text) return { new: 0, updated: 0, titles: [], people: [] };
  const held = o.cards.filter(c => c.brain === o.brain);
  const contacts = held.filter(isContact), plain = held.filter(c => !isContact(c));
  const context = String(o.context ?? "").slice(0, 1500);
  /* The nearest notes whole, and every contact the message names, whole. */
  const bulk = o.kind === "people" || o.kind === "files";
  const near = bulk ? [] : nearest(plain, text);
  const named = namedIn(contacts, `${text} ${context}`, bulk ? 24 : 8);
  const ids = [...near, ...named].map(idOf);
  const opened = ids.length ? await ctx.runQuery(internal.store.conceptsByIds, { space: o.space, ids }) : [];
  const others = plain.filter(c => !near.includes(c));
  const raw = await o.model(filerPrompt(o.kind, text, context, opened, others, o.date, contacts, o.lang ?? "same"));
  /* A reply that is not JSON, often one cut short, is a failure to retry,
     never "nothing to file". */
  if (!readable(raw)) throw new Error("the filer's reply could not be read");
  const people = readPeople(raw, o.kind);
  /* A person already held, named in the message and missed by the filer,
     still gets the mention on their card. */
  const missed = bulk ? [] : properlyNamed(contacts, text)
    .filter(c => !people.some(p => [p.update, p.name].some(t => t && (sameTitle(t, c.title) || (c.aliases ?? []).some((a: string) => sameTitle(a, t))))));
  return await fileNotes(ctx, o.space, o.brain, held, bulk ? [] : readNotes(raw, o.kind), o.kind, o.date, people, missed, text,
    o.kind === "interview" ? context.replace(/^The brain asked:\s*/, "") : "");
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

/* ---------- a chat about one concept ---------- */

const oneLine = (t: any, n: number) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const listOf = (v: any, n: number) => (Array.isArray(v) ? v : []).filter((y: any) => y && typeof y === "object").slice(0, n);

/**
 * One concept as its chat reads it: the card, every line of a person's file
 * with the key that takes it out, the evidence, and a person's raw notes.
 */
export function conceptDump(c: any, raw: any[]) {
  const name = (s: string) => FILE_SECTIONS.find(x => x[0] === s)?.[1] ?? s;
  const f = c.file ?? {};
  const ev = (c.evidence ?? []).slice().sort((x: any, y: any) => String(y.date ?? y.to ?? "").localeCompare(String(x.date ?? x.to ?? ""))).slice(0, 60)
    .map((e: any) => `- ${e.date ?? e.to ?? "?"}${e.author ? `, ${e.author}` : ""}: ${String(e.claim ?? "").slice(0, 500)}`);
  let said = "";
  for (const r of raw) {
    const line = `- ${r.date}${r.asked ? ` (asked: ${r.asked})` : ""}: ${String(r.text).slice(0, 1500)}`;
    if (said.length + line.length > 8000) break;
    said += line + "\n";
  }
  return [
    `TITLE: ${c.title}`,
    (c.aliases ?? []).length ? `ALSO CALLED: ${c.aliases.join(", ")}` : "",
    `LINE: ${c.summaryLine || "(none)"}`,
    `${c.tag === "contact" ? "SUMMARY" : "POSITION"}: ${c.position || "(none)"}`,
    (f.facts ?? []).length ? `FACTS\n${f.facts.map((x: any) => `- [fact:${x.k}] ${name(x.s)}, ${x.l}: ${x.v}${x.since ? ` (since ${x.since})` : ""}${x.until ? ` (until ${x.until}, no longer true)` : ""}`).join("\n")}` : "",
    (f.links ?? []).length ? `LINKED TO\n${f.links.map((x: any) => `- [link:${x.k}] ${x.n}${x.r ? ` (${x.r})` : ""}`).join("\n")}` : "",
    (f.open ?? []).length ? `OPEN ITEMS\n${f.open.map((x: any) => `- [open:${x.k}] ${x.t}${x.done ? ` (done ${x.done})` : ""}`).join("\n")}` : "",
    (f.events ?? []).length ? `HISTORY, NEWEST FIRST\n${f.events.slice(0, 150).map((x: any) => `- [event:${x.k}] ${x.d}${x.seen ? " (together)" : ""}: ${x.t}`).join("\n")}` : "",
    (c.data ?? []).length ? `FIGURES\n${c.data.map((x: any) => `- ${x}`).join("\n")}` : "",
    (c.conflicts ?? []).length ? `OPEN CLASHES\n${c.conflicts.map((x: any) => `- ${x.a ?? ""} (${x.aDate ?? "?"}) against ${x.b ?? ""} (${x.bDate ?? "?"})`).join("\n")}` : "",
    ev.length ? `EVIDENCE, NEWEST FIRST\n${ev.join("\n")}` : "",
    said ? `RAW NOTES, WORD FOR WORD, NEWEST FIRST\n${said}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 26000);
}

/** The rules of a chat about one note or person of the personal folder. */
export function conceptRules(title: string, contact: boolean, english: boolean) {
  const what = contact ? "person" : "note";
  return `You are their personal brain, in a chat about ONE ${what} of their personal folder: "${title}". This chat is about it alone.

- Reply to them as "you", like a person who knows them, 1 to 4 short sentences, from what the ${what} below holds. Never use anything outside it.
- A message about another topic or another person: say in one sentence that this chat covers ${title} only and that their main chat takes the rest. It changes nothing.
- When the message tells something new about ${title}, corrects it, or asks to change or take out a part, write the change in "change". It is applied at once. Say in the reply what you changed, in a few words.
- A question, a greeting or a thank-you changes nothing: "change" is null.
- Never invent. Only what the message says.
- Every field of "change" is in English, whatever language they write in. "orig" keeps their sentence as written when it is not English.
- ${english ? "Write the reply in English." : "Write the reply in the language of their message."} No em-dashes. Under 30 words per sentence.

${contact ? `THE CHANGE, for this person. Send only what the message adds or corrects.
- "claim": what they said about this person, one sentence.
- "summary": the summary rewritten from what it held plus this, 3 to 6 sentences as "you". Empty when the summary still holds.
- "summaryLine": who they are to you, under 15 words. Empty when it still holds.
- "also": other names the message gives for this person.
- "facts": [{"section","label","value"}], sections: ${FILE_SECTIONS.map(x => x[0]).join(", ")}. A value that replaced an older one (they moved, changed job) adds "replaces": true and "since": the date.
- "events": [{"date","text","seen"}]: a moment, dated YYYY-MM-DD, YYYY-MM or YYYY from TODAY, told as an anecdote. "seen": true when you were together that day.
- "links": [{"name","rel"}], rel from this person's side.
- "open": [{"text","done"}]: a promise or a follow-up; "done": true closes one already open.
- "remove": [{"part","key"}]: a line of the file that is wrong or that they ask to take out, by the part and key in its brackets, e.g. {"part":"fact","key":"x1y2"}. A wrong fact is taken out and the right one sent in "facts".

Reply with only JSON: {"reply":"","change":null}
or {"reply":"","change":{"claim":"","orig":"","summary":"","summaryLine":"","also":[],"facts":[],"events":[],"links":[],"open":[],"remove":[]}}`
: `THE CHANGE, for this note.
- "claim": what they said, one sentence, first person kept.
- "position": the note as it stands after this, 1 to 4 sentences, as "you". When they changed their mind, state the new view and name the one it replaces with its date.
- "summaryLine": the note in under 15 words.

Reply with only JSON: {"reply":"","change":null}
or {"reply":"","change":{"claim":"","orig":"","position":"","summaryLine":""}}`}`;
}

/**
 * What a chat about one personal concept changes, written at once: a
 * person's wrong lines out, what the message adds folded into their file,
 * the summary rewritten when it moved, and the message kept word for word;
 * a note's position rewritten. Each change is a dated mention signed You.
 */
export async function applyChange(ctx: any, o: { space: string; brain: string; c: any; q: string; change: any; date: string }) {
  const { c, change: x, date, brain } = o, id = `${brain}/${c.slug}`;
  const sid = `${brain}-chat-${date}`, author = "You";
  const claim = oneLine(x.claim, 600) || oneLine(o.q, 400), orig = oneLine(x.orig, 600);
  const evidence = [{ date, author, claim, source: sid, ...(orig && orig.toLowerCase() !== claim.toLowerCase() ? { orig } : {}) }];
  await ctx.runMutation(internal.store.writeSource, { space: o.space, doc: {
    sid, link: "", linkKey: sid, title: `Chat, ${date}`, author, date, location: "", brains: [brain] } });
  if (isContact(c)) {
    let removed = 0;
    for (const r of listOf(x.remove, 20)) {
      const part = String(r.part ?? ""), key = String(r.key ?? "");
      if (!["fact", "event", "link", "open"].includes(part) || !key) continue;
      try { await ctx.runMutation(internal.store.contactPart, { space: o.space, id, part, key }); removed++; } catch { /* already gone */ }
    }
    const add = { facts: listOf(x.facts, 40), events: listOf(x.events, 20), links: listOf(x.links, 20), open: listOf(x.open, 10) };
    const summary = oneLine(x.summary || x.position, 3000), line = oneLine(x.summaryLine, 160);
    const also = (Array.isArray(x.also) ? x.also : []).map((t: any) => oneLine(t, 60)).filter((t: string) => t.length >= 2);
    const aliases = [...new Set([...(c.aliases ?? []), ...also])].filter(t => !sameTitle(t, c.title)).slice(0, 12);
    await ctx.runMutation(internal.store.fileContact, { brain, title: c.title, slug: c.slug, date,
      doc: { ...(summary ? { position: summary } : {}), ...(line ? { summaryLine: line } : {}), ...(also.length ? { aliases } : {}),
             sources: [sid], evidence }, add });
    try { await ctx.runMutation(internal.store.rawAdd, { brain, title: c.title, slug: c.slug, date, kind: "chat", text: o.q }); }
    catch { /* the file is written */ }
    return { title: c.title, summary: !!summary, added: add.facts.length + add.events.length + add.links.length + add.open.length, removed };
  }
  const position = oneLine(x.position, 3000), line = oneLine(x.summaryLine, 160);
  await ctx.runMutation(internal.store.upsertConcept, { brain, title: c.title, slug: c.slug,
    doc: { ...(position ? { position } : {}), ...(line ? { summaryLine: line } : {}), sources: [sid], evidence } });
  return { title: c.title, summary: !!position, added: 0, removed: 0 };
}
