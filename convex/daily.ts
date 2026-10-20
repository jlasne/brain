/**
 * The daily log: an add-on of the personal folder.
 *
 * Once a day it asks about the day, one question at a time, in its own chat.
 * Each answer is filed as notes, the way the interview files one, so the
 * personal brain grows with every day told.
 *
 * Eight beats: situation, desire, conflict, change, result, then the day
 * around the work, the lesson and the why behind it. A vague answer gets one
 * follow-up asking for the figure, the name or the moment. The change and the
 * result, the two the day turns on, always get one question more that digs
 * into the answer: what led to it, what it cost, what comes of it. "skip" passes a
 * beat; Stop pauses it, and it resumes there. A new day starts over at the
 * first beat.
 *
 * It lives on the personal brain's interview row, under `daily`, and reads
 * nothing but that brain.
 */

import { internal } from "./_generated/api";
import { SHORT_STYLE } from "./style";
import { isSkip, isStop, isNudge, notesOf } from "./twin";

export type Beat = { id: string; label: string; hint: string };

export const BEATS: Beat[] = [
  { id: "situation", label: "Situation", hint: "where you were today and what you were doing" },
  { id: "desire", label: "Desire", hint: "what you wanted out of today, personal and concrete" },
  { id: "conflict", label: "Conflict", hint: "what got in the way, with a number" },
  { id: "change", label: "Change", hint: "the decision you took, the thing you did differently" },
  { id: "result", label: "Result", hint: "what is true tonight that was not true this morning, with numbers" },
  { id: "life", label: "The day", hint: "where you went, who you saw, what happened outside the work" },
  { id: "lesson", label: "Lesson", hint: "the one thing someone a month behind you could use tomorrow" },
  { id: "why", label: "Why", hint: "why you do it that way, or the belief behind something you said today" },
];
const BEAT = new Map(BEATS.map(b => [b.id, b]));
export const beatOf = (id: string) => BEAT.get(String(id));

/* Follow-ups on one beat, at most. */
export const MAX_FOLLOW = 1;
/* The beats the day turns on: each always gets one question more on its answer, and may still get the one for a vague answer. */
export const DIG_BEATS = ["change", "result"];
const followMax = (beat: string) => MAX_FOLLOW + (DIG_BEATS.includes(beat) ? 1 : 0);
/* Answers kept for the day: 8 beats, their follow-ups and the 2 digs, with room. */
export const SAID_MAX = 24;
/* The longest answer kept for the day. */
export const SAID_CHARS = 2000;

/* "a" answered, "s" skipped. */
export type DayMarks = Record<string, "a" | "s">;
export type DayPending = { beat: string; text: string; follow: number };
export type Said = { beat: string; q: string; a: string };
export type Daily = { on: boolean; day: string; marks: DayMarks; pending: DayPending | null; said: Said[]; opens?: number };

/** The day as it stands, or a fresh one when the last log was another day. */
export function dayOf(d: any, date: string): Daily {
  if (!d || d.day !== date) return { on: false, day: date, marks: {}, pending: null, said: [], opens: d?.opens ?? 0 };
  return { on: !!d.on, day: date, marks: { ...(d.marks ?? {}) }, pending: d.pending ?? null, said: Array.isArray(d.said) ? d.said : [], opens: d.opens ?? 0 };
}

/** The beats not answered or skipped today, in order. */
export const left = (marks: DayMarks, except = "") => BEATS.filter(b => !marks[b.id] && b.id !== except);
export const answered = (marks: DayMarks) => BEATS.filter(b => marks[b.id] === "a").length;

/** The daily log as the app shows it. */
export function dailyView(d: any, date: string) {
  const x = dayOf(d, date);
  const n = answered(x.marks);
  const next = x.pending ? beatOf(x.pending.beat) : left(x.marks)[0];
  return {
    on: x.on, day: x.day, answered: n, total: BEATS.length,
    seen: Object.keys(x.marks).length,
    beat: next ? { id: next.id, label: next.label } : null,
    beats: BEATS.map(b => ({ id: b.id, label: b.label, mark: x.marks[b.id] ?? null })),
  };
}

/** Where a paused log stands, in one line. */
export function pausedLine(v: ReturnType<typeof dailyView>) {
  return `Paused at ${v.beat?.label ?? "the last beat"}, ${v.answered} of ${v.total} answered today. Tap Daily log to pick up where you left off.`;
}

export const DAILY_RULES =
`You ask a person about their day, once a day, for their personal brain. You talk to them as "you".

YOUR REPLY HAS TWO PARTS
- "ack": at most one short sentence on what they said, or "". Plain and warm. No praise words, no summary of their answer.
- "question": the ONE question you ask now. Never empty, never two questions. It is what they answer next.

THE BEATS
Ask them about today, in order. The change and the result are what the day leaves behind, so those two are worth pushing on.

HOW YOU ASK
- About today only. Build on what they said today, with their own words.
- Ask for figures by name: how many, how long, how much.
- One thing at a time, under 20 words.
- Ask about a meal only when they brought one up. Otherwise ask about the place, the people or the moving around.
- Fit it to their notes: their work, their city, their goal, the people they named. Never ask what today's answers or their notes already say.
- Write in the language of their message. Before they have written, use the language of their notes, or English when there are none.
- ${SHORT_STYLE} Simple wording.

FOLLOW UP, MOVE ON, OR ASK AGAIN
- FOLLOW-UPS LEFT says how many follow-ups this beat may still get.
- Follow up when the answer is vague: a mood, a summary or a range ("it went well", "a lot", "some progress") with no figure, no real name and no single moment. Ask for the missing piece of that same answer. Set "follow": true.
- When their message does not answer LAST QUESTION ASKED (a command such as "start", a question to you, another subject), reply to it in "ack" if needed and ask the same question again. Set "again": true.
- Otherwise move on: set "next" to the first beat under BEATS LEFT that today's answers do not already cover, put the beats today's answers already cover in "covered", and ask it.

Reply with only JSON: {"ack":"","question":"","follow":false,"again":false,"next":"","covered":[]}`;

export const DAILY_INTRO =
`FIRST TURN OF THE DAY
- "ack" is one short sentence: a few quick questions about today, "skip" passes one, and Stop pauses.
- "question" asks the first beat under BEATS LEFT.`;

export const DAILY_DIG =
`DIG DEEPER
- Their message answers one of the two beats the day turns on. Whatever it says, ask ONE more question on that same answer that goes deeper: what led to it, what it cost or changed, or what they will do with it tomorrow.
- Name a detail from their answer. Set "follow": true and "next": "".`;

export const DAILY_LAST =
`LAST TURN
- There is no beat left. "ack": thank them in one sentence. "question": say today is told and kept in their notes. "next": "".`;

/** The day's prompt, from what it holds and what was just said. */
export function dailyPrompt(o: {
  notes: { title: string; line: string }[]; said: Said[]; pending: DayPending | null; answer: string; skipped: boolean;
  followLeft: number; next: Beat[]; intro: boolean; date: string; english?: boolean; dig?: boolean;
}) {
  const extra = [o.intro ? DAILY_INTRO : "", o.dig ? DAILY_DIG : !o.next.length ? DAILY_LAST : ""].filter(Boolean).join("\n\n");
  const rules = o.english ? DAILY_RULES.replace(/- Write in the language of their message\.[^\n]*/, "- Write in English, whatever language they write in.") : DAILY_RULES;
  const said = o.skipped ? "(they skipped this question)" : o.answer ? o.answer : "(they just opened today's log)";
  return [
    { role: "system" as const, content: `${rules}${extra ? "\n\n" + extra : ""}` },
    { role: "user" as const, content:
`TODAY: ${o.date}

THEIR NOTES (who they are, newest first)
${o.notes.length ? o.notes.map(n => `- ${n.title}: ${n.line}`).join("\n") : "(nothing yet)"}

TODAY SO FAR
${o.said.length ? o.said.map(s => `${beatOf(s.beat)?.label ?? s.beat}. Asked: ${s.q}\nThey said: ${s.a}`).join("\n") : "(nothing yet)"}

LAST QUESTION ASKED
${o.pending?.text ? o.pending.text : "(none yet)"}

FOLLOW-UPS LEFT: ${o.followLeft}

THEIR MESSAGE
${said}

BEATS LEFT (in order)
${o.next.length ? o.next.map(b => `${b.id} | ${b.hint}`).join("\n") : "(none left)"}` },
  ];
}

/**
 * What the day's reply decided, held to what it may do: a follow-up only
 * while some are left, a next beat only from the ones shown, covered only
 * among those passed before it.
 */
export function readDayTurn(raw: string, o: { next: Beat[]; followLeft: number; dig?: string }) {
  let d: any = null;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { d = null; }
  if (!d || typeof d !== "object") d = {};
  const ids = o.next.map(x => x.id);
  const clean = (t: any) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, 600);
  let ack = clean(d.ack), question = clean(d.question);
  if (!question && /\?\s*$/.test(ack)) { question = ack; ack = ""; }
  if (ack.length > 220) ack = (ack.match(/^.{20,220}?[.!?](\s|$)/)?.[0] ?? ack.slice(0, 220)).trim();
  const again = d.again === true;
  let follow = !again && d.follow === true && o.followLeft > 0 && /\?/.test(question);
  /* A beat the day turns on is dug into once, whatever the reply decided: a reply that moved on asks the dig plainly. */
  if (o.dig && !again && !follow) return { ack, question: digBeat(o.dig), follow: true, again: false, next: "", covered: [] as string[], fallback: true };
  let next = !again && !follow && ids.includes(String(d.next)) ? String(d.next) : "";
  let covered = (Array.isArray(d.covered) ? d.covered.map(String) : []).filter((x: string) => ids.includes(x) && x !== next);
  if (!again && !follow && !next) next = ids.find(x => !covered.includes(x)) ?? "";
  if (next) covered = covered.filter((x: string) => ids.indexOf(x) < ids.indexOf(next));
  /* The next beat must be asked. A reply that names no beat, or a follow-up
     refused, asks about something else: the beat is asked plainly instead. */
  let fallback = false;
  if (next && (!/\?/.test(question) || String(d.next) !== next || (d.follow === true && !follow))) { question = askBeat(next); fallback = true; }
  if (again && !/\?/.test(question)) question = "";
  return { ack, question, follow, again, next, covered: [...new Set<string>(covered)], fallback };
}

/** A beat asked plainly, when the model gave no question. */
export function askBeat(id: string) {
  const asks: Record<string, string> = {
    situation: "Where were you today, and what were you working on?",
    desire: "What did you want out of today?",
    conflict: "What got in the way today, and by how much?",
    change: "What did you decide or do differently today?",
    result: "What is true tonight that was not this morning? Give me a number.",
    life: "Where did you go today, and who did you see?",
    lesson: "What is one thing someone a month behind you could use tomorrow?",
    why: "Why do you do it that way?",
  };
  return asks[id] ?? "What else happened today?";
}

/** The question that digs into a beat's answer, when the model gave none. */
export function digBeat(id: string) {
  const asks: Record<string, string> = {
    change: "What made you decide that, and what does it change for tomorrow?",
    result: "What made the difference there, and what will you do with it tomorrow?",
  };
  return asks[id] ?? "What led to that, and what comes of it?";
}

/**
 * One turn of the day. The answer is filed as notes with the question as its
 * context, and kept for the day. The reply is a follow-up when the answer
 * is vague, else the next beat today's answers do not cover. The two model
 * calls come in as functions, so the key never passes through here.
 */
export async function dailyStep(ctx: any, o: {
  space: string; brain: string; cards: any[]; row: any; q: string; opening: boolean; date: string; english?: boolean;
  model: (messages: { role: "system" | "user"; content: string }[]) => Promise<string>;
  file: (text: string, context: string) => Promise<any>;
}) {
  const save = (daily: Daily) => ctx.runMutation(internal.store.interviewSet, { space: o.space, brain: o.brain, patch: { daily } });
  const none = { new: 0, updated: 0, titles: [] as string[] };
  const day = dayOf(o.row?.daily, o.date);
  const { q, opening } = o;
  if (!opening && isStop(q)) {
    const saved = { ...day, on: false };
    await save(saved);
    return { reply: pausedLine(dailyView(saved, o.date)), filed: none, daily: saved };
  }
  const pending = opening ? (day.pending && !day.marks[day.pending.beat] ? day.pending : null) : day.pending;
  /* Opened again once the day is told: nothing left to ask, so no model call. */
  if (opening && !pending && !left(day.marks).length) {
    const saved = { ...day, on: false };
    await save(saved);
    const n = answered(day.marks);
    return { reply: `Today is told: ${n} of ${BEATS.length} answered, and kept in your notes. Come back tomorrow.`, filed: none, daily: saved };
  }
  /* Back in the log, the question left waiting is asked again as it stands. */
  if (opening && pending) {
    const saved = { ...day, on: true, opens: (day.opens ?? 0) + 1 };
    await save(saved);
    return { reply: `Back to today.\n\n${pending.text}`, filed: none, daily: saved };
  }
  if (!opening && pending && isNudge(q)) {
    const saved = { ...day, on: true };
    await save(saved);
    return { reply: pending.text, filed: none, daily: saved };
  }
  const marks: DayMarks = { ...day.marks };
  const skip = !opening && isSkip(q);
  if (pending && skip) marks[pending.beat] = "s";
  const isAnswer = !!pending && !skip && !!q && !opening;
  const followLeft = isAnswer ? Math.max(0, followMax(pending!.beat) - (pending!.follow ?? 0)) : 0;
  /* The first answer to a beat the day turns on is dug into. */
  const dig = isAnswer && DIG_BEATS.includes(pending!.beat) && !(pending!.follow ?? 0) ? pending!.beat : "";
  const next = left(marks, isAnswer ? pending!.beat : "");
  const held = o.cards.filter((c: any) => c.brain === o.brain);

  const filing = isAnswer ? o.file(q, `The brain asked: ${pending!.text}`).catch(() => null) : Promise.resolve(none);
  const asking = o.model(dailyPrompt({ notes: notesOf(held, 60), said: day.said, pending, answer: opening ? "" : q, skipped: skip,
    followLeft, next, intro: opening && !day.opens, date: o.date, english: o.english, dig: !!dig })).catch(() => "");
  const [raw, got] = await Promise.all([asking, filing]);
  const filed = got ?? { ...none, failed: true };
  const turn = readDayTurn(raw, { next, followLeft, dig });

  /* Kept for the day: an answer, never a message that answered nothing. */
  const said = isAnswer && !turn.again ? [...day.said, { beat: pending!.beat, q: pending!.text.slice(0, 400), a: q.slice(0, SAID_CHARS) }].slice(-SAID_MAX) : day.said;
  let question = turn.question;
  if (turn.again && !question) question = pending?.text || (next[0] ? askBeat(next[0].id) : "");
  if (isAnswer && !turn.follow && !turn.again) marks[pending!.beat] = "a";
  for (const k of turn.covered) marks[k] = "a";
  const rest = left(marks);
  let nextPending: DayPending | null = null;
  if (turn.follow && pending) nextPending = { ...pending, text: question.slice(0, 600), follow: (pending.follow ?? 0) + 1 };
  else if (turn.again && pending) nextPending = { ...pending, text: question.slice(0, 600) };
  else if (turn.next && rest.some(b => b.id === turn.next)) nextPending = { beat: turn.next, text: question.slice(0, 600), follow: 0 };
  else if (rest.length) { question = askBeat(rest[0].id); nextPending = { beat: rest[0].id, text: question, follow: 0 }; }
  if (!nextPending) question = "That's the day. It is kept in your notes.";
  const reply = [turn.ack, question].filter(Boolean).join("\n\n");
  const saved: Daily = { ...day, on: !!nextPending, marks, pending: nextPending, said, opens: (day.opens ?? 0) + (opening ? 1 : 0) };
  await save(saved);
  return { reply, filed, daily: saved };
}
