/**
 * The daily log: an add-on of the personal folder.
 *
 * Once a day it asks about the day, one question at a time, in its own chat.
 * Each answer is filed as notes, the way the interview files one, so the
 * personal brain grows with every day told. When the day is told, it writes
 * one 60-second video script from the day's answers, with a light read of the
 * notes for who they are.
 *
 * Eight beats, the first five being the five lines of the script:
 *   situation, desire, conflict, change, result,
 * then the day around the work, the lesson and the why behind it.
 * A vague answer gets one follow-up asking for the figure, the name or the
 * moment. "skip" passes a beat; Stop pauses it, and it resumes there. A new
 * day starts over at the first beat.
 *
 * A series line opens every script, when one is set: "Day {n} working towards
 * my first $10k a month. I'm Jeremy, I'm 25, currently in Ireland", with {n}
 * the day count from its Day 1. The script finishes that sentence with what
 * they were trying to do that day.
 *
 * It lives on the personal brain's interview row, under `daily`, and reads
 * nothing but that brain: the script stays in its chat.
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

/** Answered beats a script needs at least. */
export const READY_AT = 5;
/* Follow-ups on one beat, at most. */
export const MAX_FOLLOW = 1;
/* Answers kept for the day: 8 beats and their follow-ups, with room. */
export const SAID_MAX = 24;
/* The longest answer kept for the script. */
export const SAID_CHARS = 2000;

/* "a" answered, "s" skipped. */
export type DayMarks = Record<string, "a" | "s">;
export type DayPending = { beat: string; text: string; follow: number };
export type Said = { beat: string; q: string; a: string };
export type Series = { line: string; start: string };
export type Daily = {
  on: boolean; day: string; marks: DayMarks; pending: DayPending | null; said: Said[];
  script?: { at: string; text: string } | null; series?: Series | null; opens?: number;
};

/** The day as it stands, or a fresh one when the last log was another day. The series stays. */
export function dayOf(d: any, date: string): Daily {
  const series = d?.series?.line ? { line: String(d.series.line), start: String(d.series.start ?? "") } : null;
  if (!d || d.day !== date) return { on: false, day: date, marks: {}, pending: null, said: [], script: null, series, opens: d?.opens ?? 0 };
  return { on: !!d.on, day: date, marks: { ...(d.marks ?? {}) }, pending: d.pending ?? null, said: Array.isArray(d.said) ? d.said : [],
    script: d.script ?? null, series, opens: d.opens ?? 0 };
}

/** The beats not answered or skipped today, in order. */
export const left = (marks: DayMarks, except = "") => BEATS.filter(b => !marks[b.id] && b.id !== except);
export const answered = (marks: DayMarks) => BEATS.filter(b => marks[b.id] === "a").length;

/** Day 1 is the series' start: the day count of `date`, or null with no start. */
export function dayNumber(start: string, date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;
  const n = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
  return n >= 1 ? n : null;
}

/** The series line for today, with {n} as the day count, or "" with none set. */
export function openingOf(series: Series | null | undefined, date: string): string {
  const line = String(series?.line ?? "").replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "");
  if (!line) return "";
  const n = dayNumber(String(series?.start ?? ""), date);
  return line.replace(/\{n\}/gi, n === null ? "1" : String(n));
}

/** The series as it is kept: a line of 240 characters at most, and a real date or none. */
export function cleanSeries(raw: any): Series | null {
  const line = String(raw?.line ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!line) return null;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.start ?? "")) && !isNaN(Date.parse(String(raw.start))) ? String(raw.start) : "";
  return { line, start };
}

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
    ready: n >= READY_AT || (n > 0 && !left(x.marks).length),
    script: x.script ? { at: x.script.at } : null,
    series: x.series ?? null,
    dayNo: x.series ? dayNumber(x.series.start, date) : null,
  };
}

/** Where a paused log stands, in one line. */
export function pausedLine(v: ReturnType<typeof dailyView>) {
  return `Paused at ${v.beat?.label ?? "the last beat"}, ${v.answered} of ${v.total} answered today. Tap Daily log to pick up where you left off.`;
}

export const DAILY_RULES =
`You ask a person about their day, once a day, for their personal brain and for one 60-second video about this day. You talk to them as "you".

YOUR REPLY HAS TWO PARTS
- "ack": at most one short sentence on what they said, or "". Plain and warm. No praise words, no summary of their answer.
- "question": the ONE question you ask now. Never empty, never two questions. It is what they answer next.

THE BEATS
The first five are the five lines of the video, so ask them about today, as the script needs them. A day with no change and no result makes a video like every other, so those two are worth pushing on.

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
- "ack" is one short sentence: a few quick questions about today, "skip" passes one, Stop pauses, and the video script comes at the end.
- "question" asks the first beat under BEATS LEFT.`;

export const DAILY_LAST =
`LAST TURN
- There is no beat left. "ack": thank them in one sentence. "question": say today's video script is ready to write: tap Write the script. "next": "".`;

/** The day's prompt, from what it holds and what was just said. */
export function dailyPrompt(o: {
  notes: { title: string; line: string }[]; said: Said[]; pending: DayPending | null; answer: string; skipped: boolean;
  followLeft: number; next: Beat[]; intro: boolean; date: string; english?: boolean;
}) {
  const extra = [o.intro ? DAILY_INTRO : "", !o.next.length ? DAILY_LAST : ""].filter(Boolean).join("\n\n");
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
export function readDayTurn(raw: string, o: { next: Beat[]; followLeft: number }) {
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
  const follow = !again && d.follow === true && o.followLeft > 0 && /\?/.test(question);
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

/**
 * One turn of the day. The answer is filed as notes with the question as its
 * context, and kept for the script. The reply is a follow-up when the answer
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
    return { reply: day.script ? `Today is told, and its script is written. Tap Write the script to write it again.`
      : `Today is told: ${n} of ${BEATS.length} answered. Tap Write the script for your 60-second video.`, filed: none, daily: saved };
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
  const followLeft = isAnswer ? Math.max(0, MAX_FOLLOW - (pending!.follow ?? 0)) : 0;
  const next = left(marks, isAnswer ? pending!.beat : "");
  const held = o.cards.filter((c: any) => c.brain === o.brain);

  const filing = isAnswer ? o.file(q, `The brain asked: ${pending!.text}`).catch(() => null) : Promise.resolve(none);
  const asking = o.model(dailyPrompt({ notes: notesOf(held, 60), said: day.said, pending, answer: opening ? "" : q, skipped: skip,
    followLeft, next, intro: opening && !day.opens, date: o.date, english: o.english })).catch(() => "");
  const [raw, got] = await Promise.all([asking, filing]);
  const filed = got ?? { ...none, failed: true };
  const turn = readDayTurn(raw, { next, followLeft });

  /* Kept for the script: an answer, never a message that answered nothing. */
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
  if (!nextPending) question = "That's the day. Tap Write the script for your 60-second video.";
  const reply = [turn.ack, question].filter(Boolean).join("\n\n");
  const saved: Daily = { ...day, on: !!nextPending, marks, pending: nextPending, said, opens: (day.opens ?? 0) + (opening ? 1 : 0) };
  await save(saved);
  return { reply, filed, daily: saved };
}

/* ---------- the script ---------- */

export const SCRIPT_RULES =
`You write a 60-second talking-to-camera video script about one person's day, from their own answers. They speak it in the first person.

THE STORY IN 5 LINES
1. Situation: where they are today and what they are trying to do.
2. Desire: what they want, personal and concrete.
3. Conflict: what blocks it, with a number.
4. Change: the decision or the turning point.
5. Result: the new reality, with numbers.
Each line is 1 to 3 spoken sentences. 120 to 160 words spoken in all.

THE EDIT
- 0 to 4s: 8 fast cuts of 0.5s, moments of the day they named (places, people, moving around). Ends on them looking at camera.
- 4 to 56s: talking to camera, jump cuts only.
- 56 to 60s: 4 cuts of 1s from the day. Ends on them at camera.
- Music low under the voice. It drops out on the Change line, then returns.
- One sound effect on each key number.

RULES
- The story is today's answers. Their notes give background: who they are and their goal, for one line at most.
- Every fact comes from today's answers or their notes. A missing number is written [X] and named under Missing.
- ${SHORT_STYLE} One sentence per line. Numbers in place of adjectives. No vague words: very, really, a lot, quite, some. Simple spoken words. Say what happened and what they do.
- Write in the language of today's answers.

OPENING
- When an OPENING LINE is given, the server puts it first under Situation. Give in "trying" how that sentence ends for today, as "trying to ..." in under 12 words, from today's answers. Then Situation goes on with 0 to 2 sentences that never repeat the opening.
- With no OPENING LINE, "trying" is "" and Situation is yours to write.

THE SCRIPT, in this order, each label in bold on its own line
tl;dr: one sentence on the story.
**Intro (0 to 4s)**: the 8 cuts, one per line.
**Situation**, **Desire**, **Conflict**, **Change**, **Result**: the spoken lines.
**Outro (56 to 60s)**: the 4 cuts, one per line.
**Sound**: the sound design in 2 to 4 lines.
**Missing**: each [X] and the question that fills it, or "Nothing".

Reply with only JSON: {"trying":"","script":""}`;

/** The script's prompt: today's answers, the notes nearest to them, the newest notes, and the opening. */
export function scriptPrompt(o: { said: Said[]; near: any[]; notes: { title: string; line: string }[]; opening: string; date: string }) {
  return [
    { role: "system" as const, content: SCRIPT_RULES },
    { role: "user" as const, content:
`TODAY: ${o.date}

OPENING LINE
${o.opening ? `${o.opening}, trying to ...` : "(none)"}

TODAY'S ANSWERS
${o.said.map(s => `${beatOf(s.beat)?.label ?? s.beat}. Asked: ${s.q}\nThey said: ${s.a}`).join("\n")}

THEIR NOTES NEAREST TO TODAY
${o.near.length ? o.near.map((c: any) => `- ${c.title}: ${String(c.position || c.summaryLine || "").slice(0, 500)}`).join("\n") : "(none)"}

WHO THEY ARE (their newest notes)
${o.notes.length ? o.notes.map(n => `- ${n.title}: ${n.line}`).join("\n") : "(nothing yet)"}` },
  ];
}

/** The model's script, with the opening put first under Situation. */
export function readScript(raw: string, opening: string): string {
  let d: any = null;
  try { const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s); } catch { d = null; }
  const script = String(d && typeof d === "object" ? d.script ?? "" : raw ?? "").replace(/\s*—\s*/g, ", ").replace(/\r/g, "").trim();
  if (!script) return "";
  if (!opening) return script;
  let trying = String(d?.trying ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "");
  if (trying && !/^trying\b/i.test(trying)) trying = `trying to ${trying.replace(/^to\s+/i, "")}`;
  return withOpening(script, `${opening}${trying ? `, ${trying}` : ""}.`);
}

/**
 * The opening as the first line under Situation. A line the model wrote that
 * already opens the same way is replaced; with no Situation label, the
 * opening leads the script.
 */
export function withOpening(script: string, line: string): string {
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();
  const head = key(line).split(" ").slice(0, 4).join(" ");
  const lines = script.split("\n");
  const at = lines.findIndex(l => /^[\s*#>_-]*situation\b/i.test(l));
  if (at < 0) return `**Situation**\n${line}\n\n${script}`;
  /* A label with the line on it, "**Situation**: I'm ...", keeps the label alone. */
  const label = lines[at].match(/^([\s*#>_-]*situation[\s*_]*(?:\([^)]*\))?[\s*_]*:?[\s*_]*)(.*)$/i);
  const after = label?.[2]?.trim() ?? "";
  const rest = lines.slice(at + 1);
  const body = after ? [after, ...rest] : rest;
  /* The model's own opening, when it wrote one anyway, gives way. */
  const first = body.findIndex(l => l.trim());
  if (first >= 0 && head && key(body[first]).startsWith(head)) body.splice(first, 1);
  const labelText = (label?.[1] ?? lines[at]).replace(/:?\s*$/, "").trimEnd();
  return [...lines.slice(0, at), labelText, line, ...body].join("\n");
}
