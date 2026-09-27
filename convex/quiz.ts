/**
 * A quiz in the chat: one question at a time, from what the brains hold.
 *
 * Each turn is one model call. The first asks a question on the topic. Every
 * turn after it grades the reply against the expected answer and the concept
 * it came from, then asks the next question, in the same call. A round is 5
 * questions. The browser keeps the score, the hint and the expected answer,
 * so "hint" and "stop" cost no call at all.
 */

import { ask, parseJson } from "./lib";
import { planDossier, writeDossier, idOf, OPEN_READ } from "./words";
import { routeQuestion } from "./route";

export const QUIZ_ROUND = 5;

export type QuizAsk = { question: string; answer: string; hint: string; concept: string };
export type QuizReply = {
  verdict?: "right" | "partly" | "wrong";
  feedback?: string;
  next?: QuizAsk;
  empty?: boolean;
};
export type QuizOpts = {
  topic: string;
  /* The questions already asked this round, so the next one moves on. */
  asked?: { question?: string; concept?: string }[];
  /* The question just answered, with its expected answer and the reply. */
  turn?: { question?: string; answer?: string; concept?: string; reply?: string };
  /* 1 for the first question of the round. */
  number?: number;
};

const ASK_RULES = `NEXT QUESTION
- One question, answered from ONE opened concept in 1 to 3 sentences.
- Ask for a reason, a mechanism, a figure the evidence carries, or how it applies to a case. Question 1 is recall; the last one asks to apply.
- It can never be answered yes or no, and its own wording never holds the answer.
- Pick a concept that is not in ASKED ALREADY while another opened concept bears on the topic. Otherwise take a new angle on one already asked.
- "answer": the expected answer in 1 to 2 sentences, with its numbers.
- "hint": one clue that points the way without giving the answer. It names the concept to think about.
- "concept": the concept's title, exactly as written after ###.`;

const GRADE_RULES = `GRADE THE REPLY
- Compare the REPLY with the EXPECTED ANSWER and with the concept's evidence.
- "right": the core idea is there, and any key number is close. Wording, spelling and language never count.
- "partly": the direction is right, and a key part or number is missing or off.
- "wrong": the core idea is missing, or the reply says it does not know.
- "feedback": 1 to 3 sentences, spoken to the person. First what holds in the reply, then the full answer with its numbers. No praise words.`;

const STYLE = "English, always. No em-dashes. Under 30 words per sentence. Numbers over adjectives. Every fact comes from the stored knowledge below, never from general knowledge.";

const clip = (s: unknown, n: number) =>
  String(s ?? "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);

/** The prompt for one turn: grade, ask, or both. */
export function quizPrompt(dossier: string, o: QuizOpts, last: boolean): string {
  const grading = !!o.turn?.question;
  const asking = !last;
  const n = Math.max(1, Math.min(QUIZ_ROUND, Number(o.number) || 1));
  const asked = (o.asked ?? []).slice(-QUIZ_ROUND * 2)
    .map(a => `- ${clip(a.question, 200)} (${clip(a.concept, 80)})`).join("\n");
  const shape = [
    grading ? `"verdict":"right|partly|wrong","feedback":"..."` : "",
    asking ? `"question":"...","answer":"...","hint":"...","concept":"..."` : "",
  ].filter(Boolean).join(",");
  return `You run a quiz on the reader's own knowledge base, one question at a time.

${grading ? GRADE_RULES : ""}
${grading && asking ? "\n" : ""}${asking ? ASK_RULES.replace("NEXT QUESTION", `NEXT QUESTION (number ${n} of ${QUIZ_ROUND})`) : ""}

${STYLE}

Reply with only JSON: {${shape}}

TOPIC: ${clip(o.topic, 300) || "anything the brains hold"}
${asked ? `\nASKED ALREADY\n${asked}\n` : ""}${grading ? `
QUESTION ASKED: ${clip(o.turn!.question, 400)}
FROM CONCEPT: ${clip(o.turn!.concept, 120)}
EXPECTED ANSWER: ${clip(o.turn!.answer, 600)}
REPLY: ${clip(o.turn!.reply, 1200) || "(no reply)"}
` : ""}
STORED KNOWLEDGE
${dossier}`;
}

/** The model's reply, held to its shape. A field it left out stays out. */
export function readQuiz(text: string, grading: boolean, asking: boolean): QuizReply {
  let j: any;
  try { j = parseJson(text); } catch { j = {}; }
  const out: QuizReply = {};
  if (grading) {
    const v = String(j.verdict ?? "").toLowerCase().trim();
    out.verdict = v === "right" || v === "partly" ? v : "wrong";
    out.feedback = clip(j.feedback, 600) || "No feedback came back for this one.";
  }
  if (asking) {
    const question = clip(j.question, 400);
    if (question) {
      out.next = { question, answer: clip(j.answer, 600), hint: clip(j.hint, 300) || "Think about which concept this topic rests on.",
                   concept: clip(j.concept, 120) };
    } else {
      out.empty = true;
    }
  }
  return out;
}

/**
 * One turn. The search is the one a question in the chat runs, on the topic.
 * The concept just asked about opens first, so its grade reads its evidence.
 * With a topic that matches nothing, the fullest concepts lead.
 */
export async function quizTurn(
  brains: any[], concepts: any[], o: QuizOpts,
  key?: string, model?: string, load?: (ids: string[]) => Promise<any[]>,
): Promise<QuizReply> {
  const slugs = new Set(brains.map(b => b.slug));
  const inPool = concepts.filter((c: any) => slugs.has(c.brain));
  if (!inPool.length) return { empty: true };
  const topic = clip(o.topic, 300);
  const grading = !!o.turn?.question;
  const last = grading && (Number(o.number) || 1) > QUIZ_ROUND;

  const t0 = Date.now();
  const route = await routeQuestion(brains, concepts, topic, undefined, key, model);
  const plan: any = planDossier(brains, concepts, topic, undefined, route);
  if (!plan.lead.length) {
    const ranked = [...inPool].sort((a: any, b: any) => (b.ev ?? b.evidence?.length ?? 0) - (a.ev ?? a.evidence?.length ?? 0));
    plan.lead = ranked.slice(0, 30);
    plan.ranked = ranked.map((c: any) => ({ c, score: 0 }));
  }
  const was = grading ? inPool.find((c: any) => c.title === clip(o.turn!.concept, 120)) : null;
  if (was) plan.lead = [was, ...plan.lead.filter((c: any) => idOf(c) !== idOf(was))];

  const whole = load ? await load(plan.lead.slice(0, OPEN_READ).map(idOf)) : concepts;
  const found = writeDossier(brains, plan, new Map(whole.map((c: any) => [idOf(c), c])));

  const { text } = await ask([
    { role: "system", content: "You are the reader's own knowledge base, quizzing them on what it holds. You always answer in English." },
    { role: "user", content: quizPrompt(found.dossier, o, last) },
  ], { json: true, maxTokens: 1500, key, model,
       timeout: Math.max(60000, 150000 - (Date.now() - t0)) });
  return readQuiz(text, grading, !last);
}
