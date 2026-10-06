/**
 * The interview: how a personal brain gets to know its owner.
 *
 * A personal brain files what its owner says. This makes it ask too. 335
 * questions in 17 chapters, after the Stanford study that built 1,000 agents
 * from 2-hour interviews and matched their people's answers 85% of the time:
 * life story first, then values, beliefs, decisions, work, voice and the rest.
 *
 * Two ways in, one structure: every answer is filed as notes, the same way
 * the chat files what its owner says.
 *   Interview  one quick question at a time, one follow-up when an answer is thin,
 *              a question the notes already answer skipped, and every 10
 *              answers 3 notes read back to be confirmed or corrected.
 *              "skip" passes a question; Stop pauses, and it resumes there.
 *   In passing the everyday chat asks one of the questions now and then,
 *              when the talk leaves room for it, chosen from the chapters
 *              the notes cover least.
 *
 * The twin test is apart: 10 questions answered once and never filed. The
 * twin answers them from the notes, the owner scores each 0 to 2, and a
 * retest 2 weeks later sets the owner's own ceiling. The twin profile is the
 * notes written as 7 parts. Both stay in the personal folder: nothing else
 * reads a personal brain.
 *
 * The questions are written for anyone. The model asks each in its own words,
 * fitted to what the notes say: "your first job" becomes "the bank".
 */

import { internal } from "./_generated/api";

export type Chapter = { key: string; title: string; questions: string[] };

export const CHAPTERS: Chapter[] = [
  { key: "A", title: "Life story", questions: [
    "In which city and year were you born?",
    "What is one thing you remember about the place you grew up?",
    "Who raised you?",
    "What did your parents do for work?",
    "What is your first memory?",
    "What did your childhood home look like, in one sentence?",
    "What were you known for as a kid?",
    "What did you want to be at age 10?",
    "What did you want to be at age 16?",
    "Which one event shaped you most before age 18?",
    "Who was your best friend growing up?",
    "What was your best subject at school? And your worst?",
    "What did you study, and why that?",
    "What is one thing your studies gave you?",
    "What was your first job?",
    "Why did you leave your first job?",
    "When did you decide to do the work you do today?",
    "If your life so far had 3 chapters, what would you call them?",
    "What turning point do you tell most often?",
    "What turning point do you rarely tell?",
    "Which year of your life would you relive?",
    "Which year would you skip?",
    "Which cities have you lived in?",
    "What is the biggest risk you have taken?",
    "What is your biggest failure so far?",
    "What is your biggest win so far, in a number?",
    "What did you believe at 18 that you now think is wrong?",
    "What would you call the next chapter of your life?",
  ] },
  { key: "B", title: "Identity", questions: [
    "Describe yourself in 3 words.",
    "How would your closest friend describe you, in 3 words?",
    "What would someone who dislikes you say about you?",
    "What do people get wrong about you at first?",
    "What part of you do only close people see?",
    "What are you proud of but rarely say?",
    "What is your main strength?",
    "What is your main weakness?",
    "What habit defines you?",
    "When do you feel most like yourself?",
    "When do you feel like an impostor?",
    "Which compliment hits you hardest?",
    "Which criticism hits you hardest?",
    "What do you want to be remembered for?",
    "Who do you want to resemble in 10 years?",
    "Who do you never want to become?",
    "What do you do differently from most people your age?",
    "Introvert or extrovert?",
    "When in the day do you have the most energy?",
    "How do you recharge?",
  ] },
  { key: "C", title: "Values", questions: [
    "What are your top 3 values?",
    "When did one of your values cost you something?",
    "What would you never do, even for 1 million euros?",
    "What would you do for 1 million euros that others refuse?",
    "What number would mean success to you?",
    "What does a free day look like for you?",
    "What makes someone a good person, in one sentence?",
    "When is lying acceptable to you?",
    "When is breaking a rule acceptable?",
    "Speed or quality: which wins for you?",
    "Money or time: which do you value more?",
    "Loyalty or truth?",
    "How do you treat people who cannot help you?",
    "Which injustice makes you angry?",
    "Which principle did you take from a book, a video or a person?",
    "Which rule do you follow that you made up yourself?",
    "Which value did you drop in the last 5 years?",
    "Which value are you building right now?",
  ] },
  { key: "D", title: "Beliefs", questions: [
    "What do you believe that most people disagree with?",
    "Is money mostly freedom, security or status for you?",
    "Do you work to live, or live to work?",
    "In 10 years, will AI make your work easier or replace it?",
    "Which job do you think disappears first?",
    "Do degrees still matter? Yes, no, or it depends?",
    "Which health habit do you believe in most?",
    "How much of your success is luck, in percent?",
    "Talent or work: which matters more, in percent?",
    "Social media: more good or more harm for you?",
    "City or countryside, for the long term?",
    "Which country will do best in the next 10 years?",
    "How much of a risk taker are you, from 1 to 10?",
    "What makes a life well lived, in one sentence?",
    "What do you think happens after death?",
    "Which belief of yours changed most in the last 2 years?",
    "Which belief would you defend in a public debate?",
    "Which belief do you hold but cannot prove?",
    "What would you bet will be true in 2030?",
    "Which expert do you trust most?",
    "Which popular idea is overrated?",
    "Which idea is underrated?",
  ] },
  { key: "E", title: "Decisions", questions: [
    "What was the last big decision you made?",
    "How long do you take for a 100 euro decision? A 10,000 euro one?",
    "Do you decide more with data, gut or advice?",
    "Who do you ask before a big decision?",
    "How do you choose when 2 options look equal?",
    "What makes you say no fast?",
    "What makes you say yes fast?",
    "How do you know it is time to quit a project?",
    "Which project did you quit? Was it right?",
    "Which project did you keep too long?",
    "What do you do with a decision you regret?",
    "Which decision rule would you give your younger self?",
    "10 tasks and 4 hours: how do you pick?",
    "What do you always do first in the morning?",
    "How do you pick which idea to work on?",
    "How sure do you need to be before you act, in percent?",
    "When did you go against everyone's advice?",
    "When did you follow advice and regret it?",
    "What do you check before a big purchase?",
    "What do you check before saying yes to a partner?",
  ] },
  { key: "F", title: "Work", questions: [
    "What do you do for work, in one sentence?",
    "Why would an investor care about your work, in one sentence?",
    "How does your work make money?",
    "Which project matters most to you right now?",
    "What time does your ideal work day start and end?",
    "What ruins a work day for you?",
    "Which task drains you most, and which gives you energy?",
    "What would you delegate tomorrow if you could?",
    "What would you never delegate?",
    "Where do your best work ideas come from?",
    "How do you test an idea before you build it?",
    "What is the top reason a project succeeds in your field?",
    "What is your main way of making money from your work?",
    "How do you set your prices?",
    "What do you look for in a partner or co-founder?",
    "What do you look for in a client?",
    "What is the first thing you say on a call with a new client?",
    "Which objection do you hear most?",
    "What is your best negotiation trick?",
    "How do you reach out to new people for work?",
    "What is the first line of your best outreach message?",
    "Which 3 tools do you use every day?",
    "Which number do you check first every morning?",
    "What is your income goal for the next 12 months?",
    "What would you do with 100,000 euros for your work?",
    "What mistake do beginners make in your field?",
    "What do outsiders get wrong about your industry?",
    "Which competitor do you respect?",
    "Which competitor do you think will fail?",
    "What do you do when a client goes silent?",
    "What do you do when a deal falls apart?",
    "What did your biggest deal teach you?",
    "When do you stop a project, sell it or keep it?",
    "When is a project done for you?",
  ] },
  { key: "G", title: "Voice and writing", questions: [
    "Do you share your work in public? Why?",
    "Who is your ideal reader or client, in one sentence?",
    "Which topic could you talk about for 2 hours?",
    "Which topics do you refuse to cover?",
    "How do you grab attention when you write or speak?",
    "How do you structure a post or a talk?",
    "What makes something worth publishing?",
    "Which writer or creator shapes your style most?",
    "What is your number one writing rule?",
    "Which words do you use often?",
    "Which words do you hate?",
    "Formal or casual in emails?",
    "How do you text friends: short and fast, or long?",
    "How does your LinkedIn voice differ from your X voice?",
    "Do you use emojis? Which ones?",
    "In which language do you think?",
    "When do you switch languages?",
    "How do you open a conversation with a stranger?",
    "How do you close a conversation?",
    "How do you say no politely, in one line?",
    "How do you give bad news, in one line?",
    "How do you thank someone, in one line?",
    "What is a sentence only you would write?",
    "Paste one message or post you wrote and like.",
    "Whose writing sounds nothing like you?",
    "What kind of jokes do you make?",
    "Do you have a catchphrase?",
    "What do you do with a negative comment online?",
  ] },
  { key: "H", title: "Knowledge", questions: [
    "Which 3 subjects do you know best?",
    "What is one thing you know that most people get wrong?",
    "Which book changed how you think most?",
    "Which video or podcast shaped you most?",
    "Who do you follow to learn?",
    "What did you learn this month?",
    "What do you want to learn next?",
    "Which skill took you longest to build?",
    "Which skill came easily?",
    "How do you learn a new subject?",
    "Where do you keep what you learn?",
    "Which topic do you not care about at all?",
    "Which topic do you pretend to know?",
    "What is your favorite idea, in one sentence?",
    "Which thinking framework do you use most?",
  ] },
  { key: "I", title: "Money", questions: [
    "How did your family talk about money when you were a kid?",
    "What is your first money memory?",
    "What is your saving rule?",
    "How do you invest, in one sentence?",
    "What split would you give a friend starting to invest today?",
    "Which asset do you believe in most for 10 years?",
    "Which asset do you avoid?",
    "How big a drop can you watch before you sell, in percent?",
    "What was your worst investment?",
    "What was your best investment? Luck or skill?",
    "Which economic signal do you watch most?",
    "What do you spend on without guilt?",
    "What do you refuse to spend on?",
    "What is \"enough\" money for you, in a number?",
    "What would you do the day you hit that number?",
  ] },
  { key: "J", title: "Health and routines", questions: [
    "What do you do in your first hour after waking?",
    "What do you do in your last hour before bed?",
    "How many hours do you sleep? What wakes you?",
    "How many times a week do you train, and what?",
    "Why did you choose your sport?",
    "What is your current training goal, in a number?",
    "What do you eat on a normal day?",
    "Which food do you love? Which do you hate?",
    "What do you drink: coffee, alcohol, neither?",
    "What does stress do to your body?",
    "Which routine broke recently?",
    "Which routine would you add with 1 more hour a day?",
    "What does a perfect weekend look like?",
    "What do you do on a rainy Sunday?",
  ] },
  { key: "K", title: "People", questions: [
    "Who are the 3 most important people in your life?",
    "How did you meet your closest friend?",
    "What makes you trust someone?",
    "What makes you stop trusting someone?",
    "How do you handle a fight with a friend?",
    "How do you handle a fight with a business partner?",
    "How do you apologize?",
    "How do you show care?",
    "How do you like others to show care to you?",
    "What kind of people drain you?",
    "What kind of people give you energy?",
    "Who do you admire?",
    "Who do you envy?",
    "How do you meet new people?",
    "How often do you see friends? Is it enough?",
    "What do friends come to you for?",
    "Whose advice do you ignore?",
    "How do you handle family expectations?",
    "What do you owe your parents?",
    "What kind of partner do you want, if any?",
    "What makes a good relationship, in one sentence?",
  ] },
  { key: "L", title: "Inner world", questions: [
    "What small daily thing makes you happy?",
    "What big life thing makes you happy?",
    "What makes you angry?",
    "What makes you sad?",
    "What do you fear most?",
    "What fear would you never admit in public?",
    "How do you calm down after a bad day?",
    "When did you last cry?",
    "When did you last laugh hard?",
    "Which moment of the week do you look forward to most?",
    "What do you do when you are bored?",
    "What do you do when you feel lonely?",
    "Which thought comes back to you most often?",
    "What do you think about before falling asleep?",
    "How do you get going on a low day?",
    "Is your inner voice kind, harsh or neutral?",
    "What would you tell yourself on your worst day?",
  ] },
  { key: "M", title: "Tastes", questions: [
    "Your top 3 books?",
    "Your top 3 films?",
    "Your top 3 artists?",
    "What do you listen to while working?",
    "Your favorite food, and your favorite restaurant?",
    "Your favorite place in the world?",
    "Where do you want to travel next?",
    "Do you plan trips or improvise?",
    "Which app on your phone could you not live without?",
    "Which design do you love? One example.",
    "Which brand do you trust most?",
    "Which brand do you avoid?",
    "How would you describe your style of clothes?",
    "Cats or dogs? Mountain or sea?",
    "Do you collect anything?",
    "Which hobby would you start with unlimited time?",
    "What is your guilty pleasure?",
    "Which trend do you hate?",
  ] },
  { key: "N", title: "Scenarios", questions: [
    "A partner with 2 million followers offers you 10% of a deal. Yes or no?",
    "A stranger offers 50,000 euros for 3 months of work. What do you ask first?",
    "Your income drops 40% in 1 month. What is your first move?",
    "A friend asks to borrow 5,000 euros. What do you say?",
    "A job offer at 120,000 euros a year in a big city. Do you take it?",
    "A post of yours goes viral with mostly hate comments. What do you do?",
    "A partner stops working without telling you. What do you do?",
    "1 free year, no money worries. What do you do first?",
    "You can live anywhere for 5 years. Where?",
    "Markets crash 30% tomorrow. Buy, sell or hold?",
    "Someone copies your work exactly. What do you do?",
    "A big client and a friend in need, same time. Which one?",
    "You must cut half your projects today. Which go first?",
    "A journalist asks if AI will replace jobs. Your answer in one sentence?",
    "You find a bug that costs users money. Nobody noticed. What do you do?",
    "A stranger emails for free advice. Do you reply?",
    "1 hour to a deadline, the work is 60% done. What do you do?",
    "Your parents disagree with a big life choice. What do you do?",
    "You can learn one skill instantly. Which one?",
    "One question to your future self at 40. What is it?",
    "You win 10 million euros. What is the first thing that changes?",
    "A brand pays you to promote a product you do not use. Your price?",
    "You can hire one person tomorrow. What role?",
    "A 5-minute talk to 500 people tomorrow. Your topic?",
    "Someone insults you in a meeting. What do you say?",
    "A friend talked behind your back. What do you do?",
    "You can delete one app from the world. Which one?",
    "Explain your job to your grandmother in one sentence.",
    "An AI tool can do 80% of your job. What do you do this week?",
    "You must stop working for 3 months. What happens to your projects?",
  ] },
  { key: "O", title: "Contradictions", questions: [
    "Where do you act against your own values?",
    "What do you say you want but keep avoiding?",
    "Which advice do you give but not follow?",
    "Which opinion of yours changes with your mood?",
    "When do you become a different person?",
    "Which topic makes you lose objectivity?",
    "What would surprise people who know you well?",
    "What do you do alone that you never do with people?",
    "Where are you inconsistent with money?",
    "Where are you inconsistent with health?",
    "What would your twin get wrong if it only read your posts?",
  ] },
  { key: "P", title: "Future", questions: [
    "Where do you want to be in 1 year, in a number?",
    "Where do you want to be in 5 years?",
    "Where do you want to be in 10 years?",
    "What would make your life a success at 80?",
    "What legacy do you want to leave?",
    "What do you want to build that does not exist yet?",
    "What would you do if you knew you could not fail?",
    "What are you waiting for?",
    "What will you stop doing in the next 12 months?",
    "What will you start doing in the next 12 months?",
    "Your ideal Tuesday in 2031: where are you, and what are you doing?",
    "What is your biggest open question about your life?",
  ] },
  { key: "Q", title: "Twin rules", questions: [
    "Which 3 tasks should your twin do for you first?",
    "Which task should your twin never do?",
    "When should your twin ask you before acting?",
    "How should your twin talk to strangers for you?",
    "Should your twin ever talk to your close friends?",
    "Which tone should your twin use by default?",
    "What should your twin say when it does not know your view?",
    "How should your twin flag a decision it is unsure about?",
    "Which of your mistakes should your twin fix, not copy?",
    "Which topics are off limits for your twin?",
    "How will you correct a bad twin answer?",
    "How often will you update your twin?",
  ] },
];

/* The test set: answered once, never filed, so it can measure the twin. */
export const TEST: string[] = [
  "On a scale of 1 to 10, how risky are you with money?",
  "Would you rather earn 5,000 euros a month in a job or 3,000 in your own business?",
  "Pick one: speed, quality, price. Which do you drop first?",
  "Do you agree: \"AI will create more jobs than it destroys.\" 1 to 5.",
  "100 euros today or 150 euros in 6 months?",
  "Paris, Dubai, Lisbon or New York for 5 years?",
  "Rank: family, freedom, money, health, reputation.",
  "A project is 80% done and boring. Finish or pivot?",
  "A friend cancels dinner at the last minute. Reply by text.",
  "Your morning: what do you do in the first 30 minutes?",
];

export type Question = { id: string; ch: string; text: string };
export const QUESTIONS: Question[] = CHAPTERS.flatMap(c => c.questions.map((text, i) => ({ id: `${c.key}${i + 1}`, ch: c.key, text })));
/* T, not Z: the first test had 30 questions under Z1 to Z30, and answers kept
   under those ids belong to questions that are gone. */
export const TEST_IDS = TEST.map((_, i) => `T${i + 1}`);
/** What a stored set holds under this test's own ids, nothing else. */
export function ownOf<T>(o: Record<string, T> | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of TEST_IDS) if (o && o[id] !== undefined) out[id] = o[id];
  return out;
}
const BY_ID = new Map(QUESTIONS.map(q => [q.id, q]));
export const questionOf = (id: string) => BY_ID.get(String(id));

/* Answered, already known from the notes, or skipped. */
export type Mark = "a" | "k" | "s";
export type Marks = Record<string, Mark>;
export type Pending = { id: string; kind: "q" | "check" | "natural"; text: string; follow: number };

/* Follow-ups on one question, at most: a quick interview asks once more, not twice. */
export const MAX_FOLLOW = 1;
/* Answers between two read-backs. */
export const CHECK_EVERY = 10;
/* Everyday chat turns between two questions asked in passing. */
export const NATURAL_GAP = 2;
/* Questions the model sees ahead, to skip the ones the notes answer. */
export const AHEAD = 6;

/** Each chapter's count of answered, known and skipped, and the whole as a share of questions covered. */
export function coverage(marks: Marks) {
  const m = marks ?? {};
  const chapters = CHAPTERS.map(c => {
    let answered = 0, known = 0, skipped = 0;
    c.questions.forEach((_, i) => {
      const s = m[`${c.key}${i + 1}`];
      if (s === "a") answered++; else if (s === "k") known++; else if (s === "s") skipped++;
    });
    return { key: c.key, title: c.title, total: c.questions.length, answered, known, skipped };
  });
  const covered = chapters.reduce((n, c) => n + c.answered + c.known, 0);
  const seen = chapters.reduce((n, c) => n + c.answered + c.known + c.skipped, 0);
  return { chapters, covered, seen, total: QUESTIONS.length, pct: Math.round(100 * covered / QUESTIONS.length) };
}

/** The next questions in order, past the ones answered, known or skipped. */
export function ahead(marks: Marks, n = AHEAD, except = ""): Question[] {
  const m = marks ?? {};
  const out: Question[] = [];
  for (const q of QUESTIONS) {
    if (m[q.id] || q.id === except) continue;
    out.push(q);
    if (out.length >= n) break;
  }
  return out;
}

const WORDS = (t: string) => new Set(String(t ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/).filter(w => w.length >= 4));

/**
 * Questions to ask in passing: from the chapters the notes cover least, the
 * ones sharing words with what was just said first, one per chapter.
 */
export function gaps(marks: Marks, text: string, n = 3): Question[] {
  const m = marks ?? {};
  const cov = new Map(coverage(m).chapters.map(c => [c.key, (c.answered + c.known + c.skipped) / c.total]));
  const said = WORDS(text);
  const scored = QUESTIONS.filter(q => !m[q.id]).map((q, i) => {
    let hit = 0;
    for (const w of WORDS(q.text)) if (said.has(w)) hit++;
    return { q, score: hit * 2 + (1 - (cov.get(q.ch) ?? 0)) - i / 100000 };
  }).sort((a, b) => b.score - a.score);
  const out: Question[] = [], chs = new Set<string>();
  for (const s of scored) {
    if (chs.has(s.q.ch)) continue;
    chs.add(s.q.ch); out.push(s.q);
    if (out.length >= n) break;
  }
  return out;
}

/** "skip", "pass" or "next", in English or French, alone. */
export const isSkip = (t: string) => /^\s*(skip|pass|next|passe|je passe|suivant|suivante|joker)\s*[.!]?\s*$/i.test(String(t ?? ""));
/** "stop", "pause" or "enough", alone. */
export const isStop = (t: string) => /^\s*(stop|pause|enough|that'?s all|arr[eê]te|on arr[eê]te|stop interview)\s*[.!]?\s*$/i.test(String(t ?? ""));
/** A nudge to get going, not an answer: "start", "go", "ok", "ask me", alone. A "yes" can answer a question, so it is no nudge. */
export const isNudge = (t: string) => /^\s*(do |so |ok,? |okay,? )?(ok|okay|go|go on|go ahead|start|begin|let'?s go|let'?s start|ready|i'?m ready|continue|ask|ask me|next question|vas[- ]y|on y va|c'?est parti|commence|go ahead and ask)\s*[.!]*\s*$/i.test(String(t ?? ""));

export const INTERVIEW_RULES =
`You interview a person for their personal brain, so it learns how they think, decide, speak and act. You talk to them as "you".

YOUR REPLY HAS TWO PARTS
- "ack": at most one short sentence on what they said, or "". Plain and warm. No praise words, no summary of their answer.
- "question": the ONE question you ask now. Never empty, never two questions. It is what they answer next.

KEEP IT LIGHT
- Every question must take under 30 seconds to answer: one fact, one choice, one name, one number or one sentence.
- Ask the smallest concrete part of a broad question: "Tell me about your childhood" becomes "Which city did you grow up in?".
- Offer 2 or 3 options when it makes answering easier: "Coffee, tea or neither?".
- Never ask for a list of more than 3, a long story, a routine minute by minute, or a text to write.
- Keep the question under 20 words.
- Write in the language of their message. Before they have written, use the language of their notes, or English when there are none.
- No em-dashes. Under 30 words per sentence. Simple words.

FOLLOW UP, MOVE ON, OR ASK AGAIN
- FOLLOW-UPS LEFT says how many follow-ups this question may still get.
- Follow up only when the answer is a word or two and a short reason or a number would make it useful: "Why?", "Since when?", "What number would you put on it?" or "One example?". Set "follow": true.
- When their message does not answer LAST QUESTION ASKED (a command such as "start" or "go", a question to you, another subject), reply to it in "ack" if needed and ask the same question again. Set "again": true.
- Otherwise move on: set "next" to the id of the first question under NEXT QUESTIONS that their notes do not already answer, put the ids you passed because the notes answer them in "known", and ask it in "question", in your own words, fitted to what their notes say about them: their work, their city, the people they named. Keep its meaning, and keep it light.

Reply with only JSON: {"ack":"","question":"","follow":false,"again":false,"next":"","known":[]}`;

export const CHECK_RULES =
`READ BACK, THIS TURN ONLY
- In "question", read back the 3 notes under CHECK, one short line each, as "you", and ask whether each is right. They correct what is off.
- Set "follow": false, "again": false, "next": "", "known": [].`;

export const INTRO_RULE =
`FIRST TURN
- "ack" is one short sentence: quick questions, one at a time, a short answer is fine, "skip" passes one, and Stop pauses it any time.
- "question" is the first question you pick from NEXT QUESTIONS.`;

export const LAST_RULE =
`LAST TURN
- There is no question left. "ack": thank them in one sentence. "question": say the twin test is next, in the personal folder. "next": "".`;

/** The interview's prompt, from what it holds and what was just said. */
export function interviewPrompt(o: {
  notes: { title: string; line: string }[]; pending: Pending | null; answer: string; skipped: boolean;
  followLeft: number; next: Question[]; check: { title: string; line: string }[] | null; intro: boolean; date: string; english?: boolean;
}) {
  const extra = [o.check ? CHECK_RULES : "", o.intro ? INTRO_RULE : "", !o.next.length && !o.check ? LAST_RULE : ""].filter(Boolean).join("\n\n");
  /* Answers set to English: the interview asks in English, whatever language comes back. */
  const rules = o.english ? INTERVIEW_RULES.replace(/- Write in the language of their message\.[^\n]*/, "- Write in English, whatever language they write in.") : INTERVIEW_RULES;
  const said = o.skipped ? "(they skipped this question)" : o.answer ? o.answer : "(they just opened the interview)";
  return [
    { role: "system" as const, content: `${rules}${extra ? "\n\n" + extra : ""}` },
    { role: "user" as const, content:
`TODAY: ${o.date}

THEIR NOTES (what their brain holds about them, newest first)
${o.notes.length ? o.notes.map(n => `- ${n.title}: ${n.line}`).join("\n") : "(nothing yet)"}

LAST QUESTION ASKED
${o.pending?.text ? o.pending.text : "(none yet)"}

FOLLOW-UPS LEFT: ${o.followLeft}

THEIR MESSAGE
${said}
${o.check ? `\nCHECK\n${o.check.map((n, i) => `${i + 1}. ${n.title}: ${n.line}`).join("\n")}\n` : ""}
NEXT QUESTIONS (in order)
${o.next.length ? o.next.map(q => `${q.id} | ${q.text}`).join("\n") : "(none left)"}` },
  ];
}

/** A line that asks something: a question mark, or the question's own words. */
function asks(line: string, bank: string) {
  if (!line) return false;
  /* A question mark asks, in any language, fitted to the person or not. */
  if (/\?/.test(line)) return true;
  /* A line without one, such as "Describe yourself in 3 words.", asks only
     when it keeps the bank question's own words. */
  const want = WORDS(bank), have = WORDS(line);
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  return want.size > 0 && hit / want.size >= 0.5;
}

/**
 * What the interview reply decided, held to what it may do: a follow-up only
 * while some are left, a next question only from the ones shown, and known
 * only among those passed before it. The question is read apart from the
 * acknowledgement, so a reply can never leave them with nothing to answer:
 * an empty one is filled by the server from the question itself.
 */
export function readTurn(raw: string, o: { next: Question[]; followLeft: number; check: boolean }) {
  let d: any = null;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { d = null; }
  if (!d || typeof d !== "object") d = {};
  const ids = o.next.map(q => q.id);
  const clean = (t: any) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, 900);
  let ack = clean(d.ack), question = clean(d.question) || clean(d.reply);
  /* A question written into the acknowledgement is the question. */
  if (!question && /\?\s*$/.test(ack)) { question = ack; ack = ""; }
  /* The acknowledgement stays one short sentence. */
  if (ack.length > 220) ack = (ack.match(/^.{20,220}?[.!?](\s|$)/)?.[0] ?? ack.slice(0, 220)).trim();
  let fallback = !question;
  if (o.check) {
    if (question && !/\?/.test(question)) question += " Is each one right?";
    return { ack, question, follow: false, again: false, next: "", known: [] as string[], fallback };
  }
  const again = d.again === true;
  /* A follow-up needs a question to ask: with none, the interview moves on. */
  const follow = !again && d.follow === true && o.followLeft > 0 && /\?/.test(question);
  let next = !again && !follow && ids.includes(String(d.next)) ? String(d.next) : "";
  let known = (Array.isArray(d.known) ? d.known.map(String) : []).filter((x: string) => ids.includes(x) && x !== next);
  /* Moving on with no question named: the first one not passed as known. */
  if (!again && !follow && !next) next = ids.find(x => !known.includes(x)) ?? "";
  /* Known means passed on the way: only the ones before the question asked. */
  if (next) known = known.filter((x: string) => ids.indexOf(x) < ids.indexOf(next));
  /* The next question must be asked: a line that neither asks nor reads as
     the question named ("Let's start at the beginning.", or another question
     than the one named) is dropped, and the question is asked as the bank
     words it, so one turn never carries two. */
  const bankQ = next ? o.next.find(q => q.id === next)?.text ?? "" : "";
  if (next && !asks(question, bankQ)) { question = bankQ; fallback = true; }
  /* Asked again with nothing asked: the server asks the waiting question. */
  if (again && !/\?/.test(question)) question = "";
  return { ack, question, follow, again, next, known: [...new Set<string>(known)], fallback };
}

/** The questions offered in passing, for the everyday reply. */
export function gapBlock(list: Question[]) {
  if (!list.length) return "";
  return `GAP QUESTIONS (optional)
Their brain does not know these about them yet. If they asked you nothing and the talk leaves room, you may end your reply with ONE of them, in your own words, so it follows from what they said. It counts as your one question back. Put its tag at the very end, like [[G2]]. When none fits, ask none and add no tag.
${list.map((q, i) => `G${i + 1}: ${q.text}`).join("\n")}`;
}

/** The reply without its tag, and the question the tag names. */
export function readGap(answer: string, list: Question[]) {
  const s = String(answer ?? "");
  const m = s.match(/\[\[\s*G(\d)\s*\]\]/i);
  const text = s.replace(/\s*\[\[\s*G\d\s*\]\]\s*/gi, " ").replace(/[ \t]+\n/g, "\n").trim();
  const q = m ? list[Number(m[1]) - 1] : undefined;
  return { text, asked: q ?? null };
}

/* ---------- the twin test and the profile ---------- */

export const TWIN_RULES =
`Below are a person's own notes, filed from what they said. Answer each question as they would: their choice, their numbers, their voice, in the first person. Keep it short: the number or the choice asked for, or one or two sentences. Use what the notes say or clearly imply. Where they say nothing, give the answer most consistent with them.

Reply with only JSON: {"answers":{"T1":"","T2":""}}`;

export const JUDGE_RULES =
`Below are questions a person answered themselves (A), and the answer their AI twin gave from their notes (B). Score how well B matches A.

SCORE
- 2: same answer. The same choice, or a number within 1 point on a scale of 10 or 5, or the same top 2 in a ranking, or a reply of the same tone and move.
- 1: close. The same direction with a different degree, or a ranking sharing its first item, or a reply with the same intent in another tone.
- 0: different. The opposite choice, a number 3 or more points apart, or a reply that says something they would not.
Judge the substance, never the wording. When A is vague, B may be as vague.

Reply with only JSON, one score per question id: {"scores":{"T1":2,"T2":0}}`;

/** The pairs the judge reads: each question with both answers, only where both exist. */
export function pairsText(a: Record<string, string>, b: Record<string, string>): string {
  return TEST.map((q, i) => ({ id: TEST_IDS[i], q })).filter(x => a[x.id] && b[x.id])
    .map(x => `${x.id}: ${x.q}\nA: ${String(a[x.id]).slice(0, 600)}\nB: ${String(b[x.id]).slice(0, 600)}`).join("\n\n");
}

/** The judge's scores, only for the pairs it was given, and only 0, 1 or 2. */
export function readScores(raw: string, given: Record<string, any>): Record<string, number> {
  let d: any;
  try { const s = String(raw ?? ""), x = s.indexOf("{"), y = s.lastIndexOf("}"); d = JSON.parse(x >= 0 && y > x ? s.slice(x, y + 1) : s); }
  catch { return {}; }
  const out: Record<string, number> = {};
  for (const id of TEST_IDS) {
    if (!given[id]) continue;
    const n = Number(d?.scores?.[id]);
    if (n === 0 || n === 1 || n === 2) out[id] = n;
  }
  return out;
}

export const PROFILE_PARTS = [
  { title: "Identity", from: "A, B" }, { title: "Values", from: "C" }, { title: "Beliefs", from: "D" },
  { title: "Decision rules", from: "E, N" }, { title: "Voice", from: "G" }, { title: "Knowledge", from: "H, F" },
  { title: "Boundaries", from: "Q, O" },
];

export const PROFILE_RULES =
`Below are a person's own notes, filed from what they said. Write their twin profile: how they think, decide, speak and act, so an assistant can act as they would.

Seven parts, in this order: ${PROFILE_PARTS.map(p => p.title).join(", ")}.
- 3 to 7 short points a part, written to them as "you". Numbers and dates where the notes give them.
- Only what the notes say. A part the notes do not cover gets one point: "Nothing yet. The interview asks it in chapters X." with its chapters: ${PROFILE_PARTS.map(p => `${p.title} ${p.from}`).join("; ")}.
- Voice: how they write and talk, the words they use, their tone. Boundaries: what they refuse, and what stays private.
- In the language of most notes. No em-dashes. Under 30 words per sentence.

Reply with only JSON: {"parts":[{"title":"Identity","points":[""]}]}`;

/** A person's notes as the twin and the profile read them, newest first, capped. */
export function notesText(concepts: any[], max = 60000) {
  const lines = [...concepts]
    .sort((a, b) => String(b.updated ?? b.evidence?.[0]?.date ?? "").localeCompare(String(a.updated ?? a.evidence?.[0]?.date ?? "")))
    .map(c => `- ${c.title}: ${String(c.position || c.summaryLine || "").replace(/\s+/g, " ").slice(0, 600)}`);
  let out = "", n = 0;
  for (const l of lines) { if (out.length + l.length > max) break; out += l + "\n"; n++; }
  return { text: out.trim(), used: n, total: lines.length };
}

/** The twin's answers out of its reply, one per test question it answered. */
export function readAnswers(raw: string): Record<string, string> {
  let d: any;
  try { const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s); }
  catch { return {}; }
  const out: Record<string, string> = {};
  for (const id of TEST_IDS) {
    const t = String(d?.answers?.[id] ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();
    if (t) out[id] = t.slice(0, 600);
  }
  return out;
}

/** The profile's parts out of its reply, in the order they are asked for. */
export function readProfile(raw: string) {
  let d: any;
  try { const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s); }
  catch { return []; }
  const got = Array.isArray(d?.parts) ? d.parts : [];
  return PROFILE_PARTS.map(p => {
    const hit = got.find((x: any) => String(x?.title ?? "").trim().toLowerCase() === p.title.toLowerCase());
    const points = (Array.isArray(hit?.points) ? hit.points : []).map((t: any) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim())
      .filter(Boolean).slice(0, 8).map((t: string) => t.slice(0, 400));
    return { title: p.title, points };
  }).filter(p => p.points.length);
}

/** Answers given in the app, kept to the test's questions and a sane length. */
export function cleanAnswers(a: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of TEST_IDS) {
    const t = String(a?.[id] ?? "").replace(/\s+/g, " ").trim();
    if (t) out[id] = t.slice(0, 600);
  }
  return out;
}

/** Scores of 0, 1 or 2 per question, nothing else. */
export function cleanScores(a: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of TEST_IDS) {
    const n = Number(a?.[id]);
    if (n === 0 || n === 1 || n === 2) out[id] = n;
  }
  return out;
}

/** A set of scores as a share of the most it could reach, or null when none is scored. */
export function scorePct(scores: Record<string, number> | undefined) {
  const v = Object.values(scores ?? {}).filter(n => n === 0 || n === 1 || n === 2);
  return v.length ? Math.round(100 * v.reduce((s, n) => s + n, 0) / (2 * v.length)) : null;
}

/* The retest waits this long after the first answers. */
export const RETEST_DAYS = 14;

/** Every question answered or known: the interview has nothing left to ask, and the notes and contacts hold what the profile would say. */
export const interviewFull = (s: any) => !!s && (s.pct >= 100 || (s.total > 0 && s.covered >= s.total));

/** The interview as the app shows it. */
export function summary(row: any) {
  const marks: Marks = row?.marks ?? {};
  const cov = coverage(marks);
  const next = ahead(marks, 1, "")[0];
  const at = next ? CHAPTERS.find(c => c.key === next.ch)! : null;
  const t = row?.test ?? {};
  const twin = scorePct(ownOf(t.twinScore)), self = scorePct(ownOf(t.selfScore));
  return {
    on: !!row?.on,
    pct: cov.pct, covered: cov.covered, seen: cov.seen, total: cov.total,
    chapter: at ? { key: at.key, title: at.title, total: at.questions.length,
      at: cov.chapters.find(c => c.key === at.key)!.answered + cov.chapters.find(c => c.key === at.key)!.known + cov.chapters.find(c => c.key === at.key)!.skipped } : null,
    chapters: cov.chapters,
    pending: row?.pending?.kind ?? null,
    test: {
      mine: Object.keys(ownOf(t.mine)).length > 0, mineAt: t.mineAt ?? null,
      again: Object.keys(ownOf(t.again)).length > 0, againAt: t.againAt ?? null,
      twin: Object.keys(ownOf(t.twin)).length > 0, twinAt: t.twinAt ?? null,
      twinPct: twin, selfPct: self, target: self != null ? Math.round(self * 0.85) : 85,
    },
    profile: row?.profile?.at ? { at: row.profile.at } : null,
  };
}

/* ---------- one turn ---------- */

/** Where a paused interview stands, in one line. */
export function pausedLine(s: any) {
  const at = s.chapter ? ` at ${s.chapter.title}, ${s.chapter.at} of ${s.chapter.total}` : "";
  return `Paused${at}. Your twin is ${s.pct}% complete. Tap Interview to pick up where you left off.`;
}

/** A personal brain's notes, newest first, as the interview reads them. */
export const notesOf = (held: any[], n: number) => [...held]
  .sort((x, y) => String(y.updated ?? "").localeCompare(String(x.updated ?? "")))
  .slice(0, n).map((c: any) => ({ title: String(c.title), line: String(c.summaryLine || c.lead || "").slice(0, 160) }));

/**
 * One turn of the interview. The answer is filed as notes, with the question
 * it answers as their context, the same way the chat files a message. The
 * reply is a follow-up when the answer is thin, the next question the notes
 * do not already answer, or, every 10 answers, 3 notes read back to be
 * confirmed or corrected. "skip" passes the question and "stop" pauses the
 * interview where it stands. The two model calls come in as functions, so
 * the key they run on never passes through here.
 */
export async function interviewStep(ctx: any, o: {
  space: string; brain: string; cards: any[]; row: any; q: string; opening: boolean; date: string; english?: boolean;
  model: (messages: { role: "system" | "user"; content: string }[]) => Promise<string>;
  file: (text: string, context: string) => Promise<any>;
}) {
  const save = (patch: any) => ctx.runMutation(internal.store.interviewSet, { space: o.space, brain: o.brain, patch });
  const { row, q, opening } = o;
  const none = { new: 0, updated: 0, titles: [] as string[] };
  if (!opening && isStop(q)) {
    const saved = await save({ on: false });
    return { reply: pausedLine(summary(saved)), filed: none, saved };
  }
  const marks: Marks = { ...(row?.marks ?? {}) };
  /* Back in the interview, the question left waiting comes first again: it
     was never marked. A read-back left waiting is let go. */
  const pending: Pending | null = !opening && (row?.pending?.kind === "q" || row?.pending?.kind === "check") ? row.pending : null;
  /* The question as it was asked, or as the bank words it when that was lost. */
  const bank = pending?.kind === "q" ? questionOf(pending.id)?.text ?? "" : "";
  const waiting = pending?.kind === "q" ? (/\?/.test(pending.text ?? "") || pending.text === bank ? pending.text : bank) : "";

  /* "start", "go", "ok": nothing to file and nothing answered. The question
     waiting is asked again as it stands, with no model call. */
  if (!opening && pending?.kind === "q" && isNudge(q) && waiting) {
    const saved = await save({ on: true, pending: { ...pending, text: waiting } });
    return { reply: waiting, filed: none, saved };
  }

  const skip = !opening && isSkip(q);
  const answering = pending?.kind === "q" ? pending : null;
  if (answering && skip) marks[answering.id] = "s";
  const answered = !!answering && !skip && !!q;
  const held = o.cards.filter((c: any) => c.brain === o.brain);
  const check = answered && (row?.sinceCheck ?? 0) + 1 >= CHECK_EVERY && held.length >= 3 ? notesOf(held, 3) : null;
  const followLeft = answered && !check ? Math.max(0, MAX_FOLLOW - (answering!.follow ?? 0)) : 0;
  const next = ahead(marks, AHEAD, answered ? answering!.id : "");
  const asked = pending?.kind === "q" ? waiting : pending?.text ?? "";

  const filing = q && !skip && !isNudge(q) ? o.file(q, asked ? `The brain asked: ${asked}` : "").catch(() => null) : Promise.resolve(none);
  const asking = o.model(interviewPrompt({ notes: notesOf(held, 150), pending: pending ? { ...pending, text: asked } : null, answer: q,
    skipped: skip, followLeft, next, check, intro: opening && !row?.opens, date: o.date, english: o.english })).catch(() => "");
  const [raw, got] = await Promise.all([asking, filing]);
  const filed = got ?? { ...none, failed: true };
  const turn = readTurn(raw, { next, followLeft, check: !!check });

  /* What they answer next: never left empty. */
  let question = turn.question;
  if (check && !question) question = `Quick check on what I filed:\n${check.map((n, i) => `${i + 1}. ${n.title}: ${n.line}`).join("\n")}\nIs each one right? Correct anything that is off.`;
  if (turn.again && !question) question = asked || next[0]?.text || "";
  if (!question && !next.length) question = "That was the last question. The twin test is next, in your personal folder.";
  const reply = [turn.ack, question].filter(Boolean).join("\n\n");

  let sinceCheck = row?.sinceCheck ?? 0;
  if (answered && !turn.follow && !turn.again) { marks[answering!.id] = "a"; sinceCheck++; }
  for (const k of turn.known) marks[k] = "k";
  const text = question.slice(0, 1200);
  let nextPending: Pending | null = null;
  if (check) { nextPending = { id: "", kind: "check", text, follow: 0 }; sinceCheck = 0; }
  else if (turn.follow && answering) nextPending = { ...answering, text, follow: (answering.follow ?? 0) + 1 };
  else if (turn.again && pending) nextPending = { ...pending, text };
  else if (turn.next) nextPending = { id: turn.next, kind: "q", text, follow: 0 };
  const on = !!nextPending || ahead(marks, 1).length > 0;
  const saved = await save({ on, marks, pending: nextPending, sinceCheck });
  return { reply, filed, saved };
}

