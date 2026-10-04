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
 *   Interview  one question at a time, a follow-up when an answer is thin,
 *              a question the notes already answer skipped, and every 10
 *              answers 3 notes read back to be confirmed or corrected.
 *              "skip" passes a question; Stop pauses, and it resumes there.
 *   In passing the everyday chat asks one of the questions now and then,
 *              when the talk leaves room for it, chosen from the chapters
 *              the notes cover least.
 *
 * The twin test is apart: 30 questions answered once and never filed. The
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
    "Tell me your life story from birth to today, in 10 minutes.",
    "Where were you born, and what did the place look like?",
    "Who raised you, and what did each person teach you?",
    "What did your parents do for work?",
    "What is your first memory?",
    "Describe your childhood home in detail.",
    "What were you known for as a kid?",
    "What did you want to be at age 10?",
    "What did you want to be at age 16?",
    "Which 3 events shaped you most before age 18?",
    "Who was your best friend growing up, and why?",
    "What were you good at in school? What were you bad at?",
    "Why did you choose your field of study?",
    "What did your studies give you? What did they waste?",
    "Describe your first job. What did you learn in the first 30 days?",
    "Why did you leave your first job?",
    "What was the exact moment you decided to do the work you do today?",
    "What are the 5 chapters of your life so far? Name each one.",
    "What is the turning point you tell most often?",
    "What turning point do you rarely tell?",
    "Which year of your life would you relive? Why?",
    "Which year would you skip?",
    "Where have you lived, and what did each place change in you?",
    "What is the biggest risk you have taken?",
    "What is the biggest failure you have lived through? What did it cost?",
    "What is your biggest win so far? Put a number on it.",
    "What did you believe at 18 that you now think is wrong?",
    "What will the next chapter of your life be called?",
  ] },
  { key: "B", title: "Identity", questions: [
    "Describe yourself in 3 words.",
    "How would your closest friend describe you in 3 words?",
    "How would someone who dislikes you describe you?",
    "What do people get wrong about you on first meeting?",
    "What part of you do you show only to close people?",
    "What are you proud of that you rarely say?",
    "What is your main strength? Give proof.",
    "What is your main weakness? Give proof.",
    "What habit defines you?",
    "What makes you feel most like yourself?",
    "When do you feel like an impostor?",
    "What compliment hits you hardest?",
    "What criticism hits you hardest?",
    "What do you want to be remembered for?",
    "Which person do you most want to resemble in 10 years?",
    "Which person do you never want to become?",
    "What do you do that most people your age do differently?",
    "Are you an introvert or an extrovert? Give a scene that proves it.",
    "What is your energy like at 7am, 2pm and 11pm?",
    "How do you recharge?",
  ] },
  { key: "C", title: "Values", questions: [
    "List your top 5 values, ranked.",
    "For each value, tell a moment where it cost you something.",
    "What would you never do, even for 1 million euros?",
    "What would you do for 1 million euros that others refuse?",
    "What does success mean to you, in numbers?",
    "What does freedom mean to you, in daily terms?",
    "How do you define a good person?",
    "When is lying acceptable to you?",
    "When is breaking a rule acceptable?",
    "What is more important: speed or quality? Give an example.",
    "What is more important: money or time? At what price would you swap?",
    "What is more important: loyalty or truth?",
    "How do you treat people who cannot help you?",
    "What injustice makes you angry?",
    "What principle did you adopt from a book, a video or a person?",
    "What rule do you follow that you invented yourself?",
    "What value did you have 5 years ago that you dropped?",
    "What value are you trying to build right now?",
  ] },
  { key: "D", title: "Beliefs", questions: [
    "What do you believe that most people disagree with?",
    "What do you believe about money?",
    "What do you believe about work?",
    "What do you believe about AI and the next 10 years?",
    "What do you believe about the future of jobs?",
    "What do you believe about education and degrees?",
    "What do you believe about health and the body?",
    "What do you believe about luck?",
    "What do you believe about talent versus work?",
    "What do you believe about social media?",
    "What do you believe about cities versus the countryside?",
    "What do you believe about your country? About the US? About Asia?",
    "What is your view on risk?",
    "What is the meaning of life, in your own words?",
    "What do you think happens after death?",
    "Which belief changed most in the last 2 years? What changed it?",
    "Which belief would you defend in a public debate?",
    "Which belief do you hold but cannot prove?",
    "What prediction are you ready to bet on for 2030?",
    "Which expert do you trust most? Why?",
    "Which popular idea do you think is overrated?",
    "Which idea do you think is underrated?",
  ] },
  { key: "E", title: "Decisions", questions: [
    "Walk me through the last big decision you made, step by step.",
    "How long do you take for a 100 euro decision? A 10,000 euro one?",
    "Do you decide with data, gut or advice? In what ratio?",
    "Who do you ask before a big decision?",
    "What is your process when 2 options look equal?",
    "What makes you say no fast?",
    "What makes you say yes fast?",
    "How do you know when to quit a project?",
    "Name a project you quit. Was it right?",
    "Name a project you kept too long. What signal did you miss?",
    "How do you handle a decision you regret?",
    "What decision rule would you give a younger you?",
    "How do you prioritize when you have 10 tasks and 4 hours?",
    "What do you always do first in the morning, and why?",
    "How do you pick which idea to work on?",
    "How much uncertainty can you accept before acting?",
    "Describe a decision where you went against everyone's advice.",
    "Describe a decision where you followed advice and it failed.",
    "What is your checklist before spending money?",
    "What is your checklist before saying yes to a partner?",
  ] },
  { key: "F", title: "Work", questions: [
    "Describe what you do for work to a 10-year-old.",
    "Describe it to an investor in 30 seconds.",
    "How does your work make money, in numbers?",
    "Which project matters most right now? Why that one?",
    "What does a perfect work day look like, hour by hour?",
    "What does a bad work day look like?",
    "What tasks drain you? What tasks energize you?",
    "What would you delegate tomorrow if you could?",
    "What would you never delegate?",
    "How do you find new ideas for your work?",
    "How do you test an idea before you build it?",
    "What makes a project succeed in your field? Rank the factors.",
    "What is your playbook for making money from your work?",
    "How do you price what you sell, or your time?",
    "How do you pick a partner or a co-founder?",
    "How do you work with partners or clients? What do you look for?",
    "What do you say on a first call with a new partner or client?",
    "What objection do you hear most? How do you answer it?",
    "How do you negotiate? Give a real example.",
    "How do you reach out to new people for work, step by step?",
    "What does a good outreach message look like? Write one now.",
    "What tools do you use daily? Why each one?",
    "What number do you check first every morning?",
    "What is your income goal for the next 12 months?",
    "What would you do with 100,000 euros for your work?",
    "What mistake do beginners make in your field?",
    "What do you know about your industry that outsiders miss?",
    "Which competitor do you respect? Why?",
    "Which competitor do you think will fail? Why?",
    "How do you handle a client or partner who goes silent?",
    "How do you handle a deal that falls apart?",
    "What did your biggest sale or deal teach you?",
    "How do you decide to sell, stop or keep a project?",
    "What does \"done\" mean to you on a project?",
  ] },
  { key: "G", title: "Voice and writing", questions: [
    "Do you share your work or make content in public? Why?",
    "Who is your ideal reader, viewer or client? Describe one person.",
    "What topics could you talk about for 2 hours without notes?",
    "What topics do you refuse to cover?",
    "How do you grab attention when you write or speak? Give 3 examples.",
    "How do you structure a talk, a post or a script?",
    "What makes something worth publishing?",
    "Which writers or creators shape your style? What do you take from each?",
    "What writing rules do you follow?",
    "Which words do you use often?",
    "Which words do you hate?",
    "How formal are you in email? Write a short email to a new partner.",
    "How do you text a friend? Write 3 messages as you would send them.",
    "How do you write on LinkedIn versus X?",
    "Do you use emojis? Which ones, and where?",
    "In which language do you think? Write? Dream?",
    "When do you switch between languages?",
    "How do you open a conversation with a stranger?",
    "How do you close a conversation?",
    "How do you say no politely? Write it.",
    "How do you give bad news? Write it.",
    "How do you thank someone? Write it.",
    "What is a sentence only you would write?",
    "Paste 5 messages or posts you wrote and like. Why these?",
    "Paste 3 texts by others that do not sound like you. Why?",
    "What jokes do you make? What humor do you hate?",
    "What is your catchphrase, if any?",
    "How do you react to a negative comment online?",
  ] },
  { key: "H", title: "Knowledge", questions: [
    "List the 10 domains you know best, ranked by depth.",
    "For each domain, what is one thing you know that most people get wrong?",
    "Which books changed how you think? One idea from each.",
    "Which videos or podcasts shaped you most?",
    "Who do you follow to learn? Why them?",
    "What did you learn this month?",
    "What do you want to learn next?",
    "What skill took you longest to build?",
    "What skill came easily?",
    "How do you learn a new subject? Describe your process.",
    "How do you store and organize what you learn?",
    "What topic do you know nothing about and do not care?",
    "What topic do you fake knowing?",
    "Explain your favorite concept in 3 sentences.",
    "What frameworks do you use to think?",
  ] },
  { key: "I", title: "Money", questions: [
    "What was your relationship with money as a kid?",
    "What is your first money memory?",
    "How do you save? What rule do you follow?",
    "How do you invest? Describe your strategy.",
    "What allocation would you give a friend starting today?",
    "What asset do you believe in most for 10 years?",
    "What asset do you avoid? Why?",
    "How much loss can you watch without selling?",
    "What was your worst investment? What did you learn?",
    "What was your best investment? Luck or skill?",
    "How do you read the economy? Which signals do you watch?",
    "What do you spend on without guilt?",
    "What do you refuse to spend on?",
    "What is \"enough\" money for you, in a number?",
    "What would you do the day you hit that number?",
  ] },
  { key: "J", title: "Health and routines", questions: [
    "Describe your morning routine, minute by minute.",
    "Describe your evening routine.",
    "How many hours do you sleep? What wakes you?",
    "How do you train? Give your weekly schedule.",
    "Why did you choose your sports or activities?",
    "What are your current training goals, in numbers?",
    "What do you eat on a normal day?",
    "What food do you love? What food do you hate?",
    "What do you drink? Coffee, alcohol, nothing?",
    "How do you handle stress physically?",
    "What routine broke recently? Why?",
    "What routine would you add with 1 more hour a day?",
    "What does a perfect weekend look like?",
    "How do you spend a rainy Sunday?",
  ] },
  { key: "K", title: "People", questions: [
    "Who are the 5 most important people in your life? One sentence each.",
    "How did you meet your closest friends?",
    "What makes you trust someone?",
    "What makes you stop trusting someone?",
    "How do you handle conflict with a friend?",
    "How do you handle conflict with a business partner?",
    "How do you apologize?",
    "How do you show care?",
    "How do you want others to show care to you?",
    "What type of people drain you?",
    "What type of people energize you?",
    "Who do you admire? Why?",
    "Who do you envy? What does that tell you?",
    "How do you meet new people?",
    "How often do you see friends? Is it enough?",
    "What advice do your friends come to you for?",
    "What advice from others do you ignore?",
    "How do you handle family expectations?",
    "What do you owe your parents?",
    "What kind of partner do you want, if any?",
    "What does a good relationship look like to you?",
  ] },
  { key: "L", title: "Inner world", questions: [
    "What makes you happy, in small daily things?",
    "What makes you happy in big life things?",
    "What makes you angry? How do you show it?",
    "What makes you sad?",
    "What do you fear most?",
    "What do you fear that you would never admit in public?",
    "How do you calm down after a bad day?",
    "When did you last cry? What triggered it?",
    "When did you last laugh hard?",
    "What moment of the week do you look forward to most?",
    "How do you handle boredom?",
    "How do you handle loneliness?",
    "What thought comes back to you most often?",
    "What do you think about before falling asleep?",
    "How do you motivate yourself on a low day?",
    "What is your inner voice like? Kind, harsh, neutral?",
    "What would you say to yourself on your worst day?",
  ] },
  { key: "M", title: "Tastes", questions: [
    "Your favorite books, top 5.",
    "Your favorite films, top 5.",
    "Your favorite music, top 5 artists.",
    "What do you listen to while working?",
    "Your favorite food and your favorite restaurant.",
    "Your favorite place in the world.",
    "Places you want to visit, top 5.",
    "How do you travel? Plan everything or improvise?",
    "Your favorite apps on your phone. Why each one?",
    "What design do you like? Give 3 examples.",
    "What brands do you trust?",
    "What brands do you avoid?",
    "What clothes do you wear? Describe your style.",
    "Cats or dogs? Mountain or sea? City or village?",
    "What do you collect, if anything?",
    "What hobby would you start with unlimited time?",
    "What is your guilty pleasure?",
    "What trend do you hate?",
  ] },
  { key: "N", title: "Scenarios", questions: [
    "A partner with 2 million followers offers a deal where you keep 10%. Do you accept?",
    "A stranger offers you 50,000 euros for 3 months of work. What do you ask first?",
    "Your main income drops 40% in 1 month. What are your first 3 actions?",
    "A friend asks to borrow 5,000 euros. What do you say?",
    "You get a job offer at 120,000 euros a year in a big city. Do you take it?",
    "Something you posted goes viral with mostly hate comments. What do you do?",
    "Your partner on a project stops working without telling you. What do you do?",
    "You have 1 free year and no money worries. What do you do, month by month?",
    "You can live anywhere for 5 years. Where, and why?",
    "Markets crash 30% tomorrow. What do you buy, sell, hold?",
    "Someone copies your work exactly. What do you do?",
    "Two meetings at the same time: one big client, one close friend in need. Which one?",
    "You must cut 50% of your projects today. Which ones go?",
    "A journalist asks your view on AI replacing jobs. What do you say in 3 sentences?",
    "You find a bug that costs your users money. Nobody noticed. What do you do?",
    "A cold email asks you for free advice. How do you reply?",
    "1 hour before a deadline, the work is 60% done. What do you do?",
    "Your parents disagree with a major life choice. How do you handle it?",
    "You can learn one skill instantly. Which one?",
    "You can ask your future self at 40 one question. What is it?",
    "You win 10 million euros. What changes? What stays?",
    "A brand wants you to promote a product you do not use. Your price to say yes?",
    "You can hire one person tomorrow. What role?",
    "You give a 5-minute talk to 500 people tomorrow. What topic?",
    "Someone insults you in a meeting. What do you say?",
    "You find out a friend talked behind your back. What do you do?",
    "You can delete one app from the world. Which one?",
    "Explain your job to your grandmother in 2 sentences.",
    "A new AI tool can do 80% of your job. What do you do this week?",
    "You get sick and must stop working for 3 months. What happens to your projects?",
  ] },
  { key: "O", title: "Contradictions", questions: [
    "Where do you act against your own values? Be honest.",
    "What do you say you want but avoid doing?",
    "What advice do you give that you do not follow?",
    "What opinion of yours changes with your mood?",
    "In which situations are you a different person?",
    "What topic makes you lose objectivity?",
    "What would surprise people who know you well?",
    "What do you do differently alone and with people?",
    "Where are you inconsistent with money?",
    "Where are you inconsistent with health?",
    "What would your twin get wrong about you if it only read your posts?",
  ] },
  { key: "P", title: "Future", questions: [
    "Where do you want to be in 1 year? In numbers.",
    "Where do you want to be in 5 years?",
    "Where do you want to be in 10 years?",
    "What would make you call your life a success at 80?",
    "What legacy do you want to leave?",
    "What do you want to build that does not exist yet?",
    "What would you do if you knew you could not fail?",
    "What are you waiting for? What is blocking it?",
    "What will you stop doing in the next 12 months?",
    "What will you start doing in the next 12 months?",
    "What does your ideal life look like on a random Tuesday in 2031?",
    "What is your biggest open question about your own life?",
  ] },
  { key: "Q", title: "Twin rules", questions: [
    "What tasks should your twin do for you first? List 10.",
    "What tasks should your twin never do?",
    "When should your twin ask you before acting?",
    "How should your twin talk to strangers on your behalf?",
    "How should your twin talk to close friends, if ever?",
    "What tone should your twin use by default?",
    "What should your twin say when it does not know your view?",
    "How should your twin flag a decision it is unsure about?",
    "Which of your mistakes should your twin correct, not copy?",
    "What topics are private and off limits for your twin?",
    "How will you reward a good twin answer, and correct a bad one?",
    "How often will you update your twin? Set a date.",
  ] },
];

/* The test set: answered once, never filed, so it can measure the twin. */
export const TEST: string[] = [
  "On a scale of 1 to 10, how much do you trust the government?",
  "On a scale of 1 to 10, how risky are you with money?",
  "Would you rather earn 5,000 euros a month in a job or 3,000 in your own business?",
  "Pick one: speed, quality, price. Which do you drop first?",
  "Do you agree: \"Most people are good.\" 1 to 5.",
  "Do you agree: \"AI will create more jobs than it destroys.\" 1 to 5.",
  "Do you agree: \"Degrees still matter.\" 1 to 5.",
  "Do you agree: \"Social media does more harm than good.\" 1 to 5.",
  "Would you take a 50/50 bet: win 2,000 euros or lose 1,000?",
  "Would you take a 50/50 bet: win 20,000 euros or lose 10,000?",
  "100 euros today or 150 euros in 6 months?",
  "Paris, Dubai, Lisbon or New York for 5 years?",
  "Bitcoin, gold, stocks or real estate for 10 years? Rank them.",
  "Write a 2-line reply to a prospect who says \"not interested\".",
  "Write a tweet about your week.",
  "Write a 3-line pitch for your main project.",
  "A friend cancels dinner at the last minute. Reply by text.",
  "Your morning: what do you do in the first 30 minutes?",
  "What would you do with a free Saturday?",
  "Name a book you would give a 20-year-old.",
  "Rank: family, freedom, money, health, reputation.",
  "Do you prefer working alone or in a team? 1 to 5.",
  "A project is 80% done and boring. Finish or pivot?",
  "A client asks for a 30% discount. Your answer?",
  "Would you sell your main project for 3 times its yearly revenue?",
  "How many hours a week do you want to work in 5 years?",
  "What do you say when someone asks \"what do you do?\"",
  "Coffee or tea? Morning or night person?",
  "Your view in one sentence: is hard work overrated?",
  "Your view in one sentence: should everyone start a business?",
];

export type Question = { id: string; ch: string; text: string };
export const QUESTIONS: Question[] = CHAPTERS.flatMap(c => c.questions.map((text, i) => ({ id: `${c.key}${i + 1}`, ch: c.key, text })));
export const TEST_IDS = TEST.map((_, i) => `Z${i + 1}`);
const BY_ID = new Map(QUESTIONS.map(q => [q.id, q]));
export const questionOf = (id: string) => BY_ID.get(String(id));

/* Answered, already known from the notes, or skipped. */
export type Mark = "a" | "k" | "s";
export type Marks = Record<string, Mark>;
export type Pending = { id: string; kind: "q" | "check" | "natural"; text: string; follow: number };

/* Follow-ups on one question, at most. */
export const MAX_FOLLOW = 2;
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

export const INTERVIEW_RULES =
`You interview a person for their personal brain, so it learns how they think, decide, speak and act. You talk to them as "you".

EACH TURN
- First, at most one short sentence on what they said. Plain and warm. No praise words, no summary of their answer.
- Then ask exactly ONE question. Never two in one turn.
- Write in the language of their answer. Before they have answered, use the language of their notes, or English when there are none.
- No em-dashes. Under 30 words per sentence. Simple words.

FOLLOW UP OR MOVE ON
- FOLLOW-UPS LEFT says how many follow-ups this question may still get.
- Follow up when the answer is thin: no story, no number, no reason, or one line on a big question. Pick the one that fits: "Why?", one concrete example, the number they would put on it, when it changed and what changed it, what would make them do the opposite, how they would say it to a friend in one sentence. Set "follow": true.
- Otherwise move on: set "next" to the id of the first question under NEXT QUESTIONS that their notes do not already answer, and list the ids you passed because the notes answer them in "known".
- Ask the next question in your own words, fitted to what their notes say about them: their work, their city, the people they named. Keep its meaning.
- When their message is not an answer (a question to you, another subject), reply to it in one or two sentences from their notes, then ask the same question again. Set "again": true.

Reply with only JSON: {"reply":"","follow":false,"again":false,"next":"","known":[]}`;

export const CHECK_RULES =
`READ BACK, THIS TURN ONLY
- In place of a question, read back the 3 notes under CHECK, one short line each, as "you", and ask whether each is right. They correct what is off.
- Set "follow": false, "again": false, "next": "", "known": [].`;

export const INTRO_RULE =
`FIRST TURN
- Open with one sentence: one question at a time, stories and numbers help most, "skip" passes a question, and Stop pauses it any time.`;

export const LAST_RULE =
`LAST TURN
- There is no question left. Thank them in one sentence and say the twin test is next, in the personal folder. "next": "".`;

/** The interview's prompt, from what it holds and what was just said. */
export function interviewPrompt(o: {
  notes: { title: string; line: string }[]; pending: Pending | null; answer: string; skipped: boolean;
  followLeft: number; next: Question[]; check: { title: string; line: string }[] | null; intro: boolean; date: string;
}) {
  const extra = [o.check ? CHECK_RULES : "", o.intro ? INTRO_RULE : "", !o.next.length && !o.check ? LAST_RULE : ""].filter(Boolean).join("\n\n");
  const said = o.skipped ? "(they skipped this question)" : o.answer ? o.answer : "(they just opened the interview)";
  return [
    { role: "system" as const, content: `${INTERVIEW_RULES}${extra ? "\n\n" + extra : ""}` },
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

/**
 * What the interview reply decided, held to what it may do: a follow-up only
 * while some are left, a next question only from the ones shown, and known
 * only among those passed before it. A reply that is not JSON asks the first
 * question as written.
 */
export function readTurn(raw: string, o: { next: Question[]; followLeft: number; check: boolean }) {
  let d: any = null;
  try {
    const s = String(raw ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    d = JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  } catch { d = null; }
  const ids = o.next.map(q => q.id);
  const clean = (t: any) => String(t ?? "").replace(/\s*—\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, 1200);
  const reply = clean(d?.reply);
  if (!d || !reply) {
    const first = o.next[0];
    return { reply: o.check ? "" : first?.text ?? "", follow: false, again: false, next: o.check ? "" : first?.id ?? "", known: [] as string[], fallback: true };
  }
  if (o.check) return { reply, follow: false, again: false, next: "", known: [] as string[], fallback: false };
  const again = d.again === true;
  const follow = !again && d.follow === true && o.followLeft > 0;
  let next = !again && !follow && ids.includes(String(d.next)) ? String(d.next) : "";
  let known = (Array.isArray(d.known) ? d.known.map(String) : []).filter((x: string) => ids.includes(x) && x !== next);
  /* Moving on with no question named: the first one not passed as known. */
  if (!again && !follow && !next) next = ids.find(x => !known.includes(x)) ?? "";
  /* Known means passed on the way: only the ones before the question asked. */
  if (next) known = known.filter((x: string) => ids.indexOf(x) < ids.indexOf(next));
  return { reply, follow, again, next, known: [...new Set<string>(known)], fallback: false };
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

Reply with only JSON: {"answers":{"Z1":"","Z2":""}}`;

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

/** The interview as the app shows it. */
export function summary(row: any) {
  const marks: Marks = row?.marks ?? {};
  const cov = coverage(marks);
  const next = ahead(marks, 1, "")[0];
  const at = next ? CHAPTERS.find(c => c.key === next.ch)! : null;
  const t = row?.test ?? {};
  const twin = scorePct(t.twinScore), self = scorePct(t.selfScore);
  return {
    on: !!row?.on,
    pct: cov.pct, covered: cov.covered, seen: cov.seen, total: cov.total,
    chapter: at ? { key: at.key, title: at.title, total: at.questions.length,
      at: cov.chapters.find(c => c.key === at.key)!.answered + cov.chapters.find(c => c.key === at.key)!.known + cov.chapters.find(c => c.key === at.key)!.skipped } : null,
    chapters: cov.chapters,
    pending: row?.pending?.kind ?? null,
    test: {
      mine: !!t.mine && Object.keys(t.mine).length > 0, mineAt: t.mineAt ?? null,
      again: !!t.again && Object.keys(t.again).length > 0, againAt: t.againAt ?? null,
      twin: !!t.twin && Object.keys(t.twin).length > 0, twinAt: t.twinAt ?? null,
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
  space: string; brain: string; cards: any[]; row: any; q: string; opening: boolean; date: string;
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
  const skip = !opening && isSkip(q);
  const answering = pending?.kind === "q" ? pending : null;
  if (answering && skip) marks[answering.id] = "s";
  const answered = !!answering && !skip && !!q;
  const held = o.cards.filter((c: any) => c.brain === o.brain);
  const check = answered && (row?.sinceCheck ?? 0) + 1 >= CHECK_EVERY && held.length >= 3 ? notesOf(held, 3) : null;
  const followLeft = answered && !check ? Math.max(0, MAX_FOLLOW - (answering!.follow ?? 0)) : 0;
  const next = ahead(marks, AHEAD, answered ? answering!.id : "");

  const filing = q && !skip ? o.file(q, pending?.text ? `The brain asked: ${pending.text}` : "").catch(() => null) : Promise.resolve(none);
  const asking = o.model(interviewPrompt({ notes: notesOf(held, 150), pending, answer: q, skipped: skip, followLeft, next, check,
    intro: opening && !row?.opens, date: o.date })).catch(() => "");
  const [raw, got] = await Promise.all([asking, filing]);
  const filed = got ?? { ...none, failed: true };
  const turn = readTurn(raw, { next, followLeft, check: !!check });
  const reply = turn.reply || (check
    ? `Quick check on what I filed:\n${check.map((n, i) => `${i + 1}. ${n.title}: ${n.line}`).join("\n")}\nIs each one right? Correct anything that is off.`
    : next[0]?.text ?? "That was the last question. The twin test is next, in your personal folder.");

  let sinceCheck = row?.sinceCheck ?? 0;
  if (answered && !turn.follow && !turn.again) { marks[answering!.id] = "a"; sinceCheck++; }
  for (const k of turn.known) marks[k] = "k";
  const text = reply.slice(0, 1200);
  let nextPending: Pending | null = null;
  if (check) { nextPending = { id: "", kind: "check", text, follow: 0 }; sinceCheck = 0; }
  else if (turn.follow && answering) nextPending = { ...answering, text, follow: (answering.follow ?? 0) + 1 };
  else if (turn.again && pending) nextPending = { ...pending, text };
  else if (turn.next) nextPending = { id: turn.next, kind: "q", text, follow: 0 };
  const on = !!nextPending || ahead(marks, 1).length > 0;
  const saved = await save({ on, marks, pending: nextPending, sinceCheck });
  return { reply, filed, saved };
}

