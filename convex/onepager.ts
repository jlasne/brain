/**
 * One page: a summary in bullets, or a document of a chosen type.
 *
 * A summary of a brain or a group assembles from what is already stored and
 * calls no model, because a position is the compressed form already. A
 * summary of a question, and every document, take one call.
 *
 * A document is a quiz, a deep dive, use cases, or a type the owner describes.
 * It is written as sections of paragraphs and lists, never as bullets: the
 * bullet shape belongs to the summary alone.
 *
 * The result is one shape, so the screen, the clipboard and the mail all render
 * the same page.
 */

import { ask, SPACE_NAME } from "./lib";
import type { Who, Space } from "./lib";
import { planDossier, writeDossier, keywords, idOf, OPEN_READ } from "./words";
import { routeQuestion } from "./route";

/* A bullet names its concept, then says it in one or two lines. */
export type Bullet = { k: string; say: string };

/* A document's body: a paragraph, a list, or a numbered list. **bold** may
   mark a label or a figure inside the text. */
export type Block = { p: string } | { ul: string[] } | { ol: string[] };

/* A summary section holds bullets; a document section holds blocks. */
export type Section = { head: string; bullets: Bullet[]; blocks?: Block[] };

export type Pager = {
  title: string;
  line: string;
  sections: Section[];
  foot: string;
};

export const DOC_TYPES = ["quiz", "deepdive", "usecase", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TITLE: Record<DocType, string> = { quiz: "Quiz", deepdive: "Deep dive", usecase: "Use cases", other: "" };

/** Whether a page holds anything to read. */
export const hasBody = (p: Pager) => p.sections.some(s => s.bullets.length || (s.blocks ?? []).length);

/* Two lines of a page, about. */
const SAY_MAX = 180;

/* One page holds about this much before it stops being one page. */
const ONE_BRAIN = 14;
const PER_BRAIN = 6;
const MAX_BRAINS = 6;

const stop = (s: string) => {
  const t = String(s ?? "").trim();
  return !t || /[.!?]$/.test(t) ? t : t + ".";
};


/** At most two lines, cut at a word. */
const clamp = (s: string) => {
  const t = String(s ?? "").trim();
  if (t.length <= SAY_MAX) return t;
  const cut = t.slice(0, SAY_MAX).replace(/\s+\S*$/, "");
  return cut.replace(/[,;:]$/, "") + "...";
};

/* A word's stem, near enough: "decorrelate" and "decorrelation" match. */
const stems = (s: string) => keywords(s).map(w => w.slice(0, 5));

/**
 * What a concept adds to its own name, in a line or two.
 *
 * The summary line often restates the title, so every clause of the position
 * and the summary is weighed by the words it adds that the title, and the
 * clauses already taken, do not hold. A clause with a figure weighs more. The
 * best two are kept in the order they were written; a clause that adds too
 * little is left out rather than repeated.
 */
export function addedLine(c: any): string {
  const seen = new Set(stems(String(c.title ?? "")));
  const units = [String(c.position ?? ""), String(c.summaryLine ?? "")]
    .flatMap(t => t.split(/(?<=[.!?])\s+|;\s*/))
    .map(u => u.trim().replace(/[.!?;,:\s]+$/, ""))
    .filter(u => u.length > 8);
  const scored = units.map((u, i) => {
    const w = [...new Set(stems(u))];
    const fresh = w.filter(x => !seen.has(x));
    const figure = /\d/.test(u);
    return { u, i, w, fresh: fresh.length, share: w.length ? fresh.length / w.length : 0, figure };
  }).filter(x => x.fresh >= (x.figure ? 2 : 3) && x.share >= 0.5)
    .sort((a, b) => (b.fresh + (b.figure ? 2 : 0)) - (a.fresh + (a.figure ? 2 : 0)) || a.i - b.i);

  const kept: typeof scored = [];
  let size = 0;
  for (const x of scored) {
    if (kept.length === 2) break;
    /* Weighed again against what is already kept, so the second clause
       says something the first did not. */
    const fresh = x.w.filter(y => !seen.has(y)).length;
    if (fresh < (x.figure ? 2 : 3) || fresh / x.w.length < 0.5) continue;
    if (kept.length && size + x.u.length > SAY_MAX) continue;
    kept.push(x); size += x.u.length + 2;
    for (const y of x.w) seen.add(y);
  }
  const cap = (u: string) => u.charAt(0).toUpperCase() + u.slice(1);
  return clamp(kept.sort((a, b) => a.i - b.i).map(x => stop(cap(x.u))).join(" "));
}

/**
 * One concept, as one bullet: its name, then what it adds in a line or two.
 * Sources and dates stay out of the bullet; the foot of the page counts them once.
 */
function bulletOf(c: any): Bullet {
  return { k: String(c.title ?? "").trim(), say: addedLine(c) };
}

/** A bullet as one line of plain text. */
export const bulletText = (b: Bullet | string) =>
  typeof b === "string" ? b : b.k && b.say ? `${b.k}: ${b.say}` : b.k || b.say;

/** The fullest first: most evidence, then most recently moved. A card carries
    the count, a whole concept the list. */
const evOf = (c: any) => c.ev ?? (c.evidence ?? []).length;
const rank = (a: any, b: any) =>
  evOf(b) - evOf(a) || String(b.updated ?? "").localeCompare(String(a.updated ?? ""));

/** With no question, the fullest positions lead a page, the way a summary ranks them. */
export function fullestPlan(inPool: any[]) {
  const ranked = [...inPool].sort(rank);
  return { lead: ranked.slice(0, 30), ranked: ranked.map(c => ({ c, score: 0 })), inPool, hits: [] as any[], picked: [] as any[], linked: [] as any[] };
}

/** Which concepts a page shows, brain by brain: the same choice everywhere. */
function layout(brains: any[], concepts: any[]) {
  const conceptsOf = (slug: string) => concepts.filter((c: any) => c.brain === slug).sort(rank);
  const one = brains.length === 1;
  /* Empty brains leave before the cut, and the fullest lead, so six sections
     are six brains that hold something. */
  const holding = one ? brains : brains.filter(b => conceptsOf(b.slug).length)
    .sort((x, y) => conceptsOf(y.slug).length - conceptsOf(x.slug).length);
  return holding.slice(0, one ? 1 : MAX_BRAINS).map(b => ({
    b, shown: conceptsOf(b.slug).slice(0, one ? ONE_BRAIN : PER_BRAIN) }));
}

/** The ids a page will show, so a caller reads just those whole. */
export const pageIds = (brains: any[], concepts: any[]) =>
  layout(brains, concepts).flatMap(x => x.shown.map(idOf));

/**
 * A page from what is stored. No model call, so it costs nothing and never
 * invents a line the brains do not hold.
 */
export function assemble(
  space: Space, brains: any[], concepts: any[], sources: any[], pick: string, full?: Map<string, any>,
): Pager {
  const today = new Date().toISOString().slice(0, 10);
  const conceptsOf = (slug: string) => concepts.filter((c: any) => c.brain === slug).sort(rank);
  const sourceCount = (slugs: string[]) =>
    new Set(sources.filter((s: any) => (s.brains ?? []).some((x: string) => slugs.includes(x)))
                   .map((s: any) => s.sid)).size;

  const one = brains.length === 1;
  const slugs = brains.map(b => b.slug);
  const read = sourceCount(slugs);
  const ideas = brains.reduce((n, b) => n + conceptsOf(b.slug).length, 0);

  const sections = layout(brains, concepts).map(({ b, shown }) => ({
    head: one ? "" : b.name,
    bullets: shown.map((c: any) => bulletOf(full?.get(idOf(c)) ?? c)),
  })).filter(s => s.bullets.length);

  const title = one ? brains[0].name
    : pick === "person" ? "People"
    : pick === "subject" ? "Subjects"
    : SPACE_NAME[space];
  const line = one ? String(brains[0].scope ?? "")
    : `${brains.length} brains, ${ideas} positions.`;

  const shown = sections.reduce((n, s) => n + s.bullets.length, 0);
  const foot = [
    `${shown} of ${ideas} position${ideas === 1 ? "" : "s"}`,
    `${read} source${read === 1 ? "" : "s"} read`,
    today,
  ].join(" · ");

  return { title, line, sections, foot };
}

/* ---------- a question ---------- */

export const BULLET_RULES = `Answer the question as a one page briefing, in bullets.

SHAPE
- At most 9 bullets. Each one is a single line:
  - Core concept: what it says
- The core concept is 2 to 6 words, with no colon inside it.
- What it says fits in one or two lines: under 30 words.
- What it says ADDS to the core concept: a number, a cause, a consequence or
  an example. It never restates the core concept in other words.
- The FIRST bullet answers the question outright.
- Put the numbers and the findings in what it says.
- Order them so someone reading only the first three still has the answer.
- Write only the bullets. No sources, no authors, no dates, no closing line.

WORDS
- English, always. No em-dashes. Under 30 words per sentence.
- Replace adjectives with data. No weasel words. Simple wording.
- Say what holds rather than what does not.
- Never invent evidence. If the stored knowledge does not answer it, say so in
  one bullet and name the kind of source that would fill the gap.`;

const WORDS = `WORDS
- English, always. No em-dashes. Under 30 words per sentence.
- Replace adjectives with data. No weasel words. Simple wording.
- Say what holds rather than what does not.
- Use only the stored knowledge below. Never invent a fact or a figure.`;

/* How every document is written down, whatever its type. */
const DOC_FORMAT = `FORMAT
- Plain text with light markup and nothing else.
- "## " starts a section heading of 2 to 6 words.
- A paragraph is 2 to 4 sentences, with a blank line after it.
- "- " starts a list item and "1. " a numbered one, one line each.
- **bold** marks a label or a key figure, at most once per paragraph.
- No tables. No "Core concept: what it says" bullets. No sources, no authors, no closing line.`;

const DOC_RULES: Record<Exclude<DocType, "other">, string> = {
  quiz: `Write a quiz that tests how well someone understands the stored knowledge below.

SHAPE
- "## Questions", then 8 numbered questions, from the basics to the hardest.
- Ask for reasoning, not recall: why, how, what happens if, which one and why.
- Put inside each question the figures the reader needs to work it out.
- Then "## Answers", then 8 numbered answers in the same order: 1 or 2 sentences each, with the number or the reason.`,

  deepdive: `Write a deep dive on the subject from the stored knowledge below: the whole mechanism, told in order.

SHAPE, 500 to 800 words
- "## The short answer": 2 or 3 sentences that answer outright.
- "## How it works": the mechanism in order, each paragraph resting on the one before.
- "## The evidence": the figures and findings, each with its date. A list fits here.
- "## Where sources disagree": only when the knowledge holds an open conflict. Both sides, with their dates.
- "## What it means": what to do or to watch, in 2 to 4 sentences.`,

  usecase: `Write the use cases of the stored knowledge below: concrete situations where it applies.

SHAPE, 3 to 5 cases
- Each case opens with "## " and names the situation in 3 to 8 words.
- Then one paragraph: who faces it and what is at stake, with a number.
- Then "**What to do**" on its own line, then 2 to 5 numbered steps.
- Then one paragraph opening with "**Expected result:**" and the figures the evidence gives.
- Then one paragraph opening with "**Watch out:**" and the limit or the risk, in one sentence.`,
};

/** The rules for one document: its type's shape, or the owner's description. */
export function docRules(doc: DocType, note: string): string {
  const own = doc === "other"
    ? `Write the document the owner describes, from the stored knowledge below.

OWNER'S DESCRIPTION
${note}

SHAPE
- The description decides the kind of document, its sections, its length, its tone and its audience.
- Pick the form that fits it: sections, paragraphs, numbered steps, lists.
- If the stored knowledge falls short of the description, say so in one paragraph.`
    : DOC_RULES[doc] + (note ? `

OWNER'S INSTRUCTION
${note}
It sets the angle, the audience or the tone. The shape above stays.` : "");
  return `${own}

${DOC_FORMAT}

${WORDS}`;
}

/** A document's text, read into sections of paragraphs and lists. */
export function parseDoc(text: string): Section[] {
  const tidy = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();
  const sections: Section[] = [];
  let cur: Section | null = null;
  const here = () => cur ?? (cur = { head: "", bullets: [], blocks: [] }, sections.push(cur), cur);
  let para: string[] = [];
  const flush = () => { if (para.length) { here().blocks!.push({ p: tidy(para.join(" ")) }); para = []; } };
  for (const raw of String(text).split("\n")) {
    const l = raw.trim();
    if (!l || /^```/.test(l)) { flush(); continue; }
    if (/^(\*\*)?sources?\b/i.test(l)) continue;
    const h = l.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      flush();
      cur = { head: tidy(h[1].replace(/\*\*/g, "")), bullets: [], blocks: [] };
      sections.push(cur);
      continue;
    }
    const item = l.match(/^(?:([-*\u2022])|\d+[.)])\s+(.+)$/);
    if (item) {
      flush();
      const kind = item[1] ? "ul" : "ol";
      const blocks = here().blocks!;
      const last: any = blocks[blocks.length - 1];
      if (last && last[kind]) last[kind].push(tidy(item[2]));
      else blocks.push(kind === "ul" ? { ul: [tidy(item[2])] } : { ol: [tidy(item[2])] });
      continue;
    }
    para.push(l);
  }
  flush();
  return sections.filter(x => (x.blocks ?? []).length);
}

export type PageKind = "summary" | "custom";

/** A page from a question. One model call, and the bullets come back parsed. */
export async function fromQuestion(
  space: Space, brains: any[], concepts: any[], sources: any[],
  q: string, key?: string, model?: string, load?: (ids: string[]) => Promise<any[]>,
): Promise<Pager> {
  return fromModel(space, brains, concepts, sources, { q, kind: "summary" }, key, model, load);
}

/**
 * A page the model writes: a summary of a question in bullets, or a document
 * of the type picked. With a question, it reads what bears on the question;
 * without one, the fullest positions of the brains picked.
 */
export async function fromModel(
  space: Space, brains: any[], concepts: any[], sources: any[],
  opts: { q?: string; kind: PageKind; doc?: DocType; note?: string; pick?: string },
  key?: string, model?: string, load?: (ids: string[]) => Promise<any[]>,
): Promise<Pager> {
  const today = new Date().toISOString().slice(0, 10);
  const q = String(opts.q ?? "").trim(), kind = opts.kind, note = String(opts.note ?? "").trim();
  const doc: DocType = DOC_TYPES.includes(opts.doc as DocType) ? opts.doc as DocType : "other";
  const slugs = brains.map(b => b.slug);
  const read = new Set(sources.filter((s: any) => (s.brains ?? []).some((x: string) => slugs.includes(x)))
                              .map((s: any) => s.sid)).size;
  const inPool = concepts.filter((c: any) => slugs.includes(c.brain));

  /* The same search a question in the chat runs, so a page asked of every
     brain reads what bears on it rather than all of it. With no question, the
     fullest positions lead, the way a summary page ranks them. */
  const t0 = Date.now();
  let plan: any;
  if (q) {
    const route = await routeQuestion(brains, concepts, q, undefined, key, model);
    plan = planDossier(brains, concepts, q, undefined, route);
  } else {
    plan = fullestPlan(inPool);
  }
  const whole = load ? await load(plan.lead.slice(0, OPEN_READ).map(idOf)) : concepts;
  const found = writeDossier(brains, plan, new Map(whole.map((c: any) => [idOf(c), c])));

  const rules = kind === "custom" ? docRules(doc, note) : BULLET_RULES;
  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds. You always answer in English." },
    { role: "user", content: `${rules}

STORED KNOWLEDGE
${found.dossier}
${q ? `\n${kind === "summary" ? "QUESTION" : "SUBJECT"}: ${q}` : ""}` },
  ], { maxTokens: kind === "summary" ? 2000 : doc === "quiz" ? 2600 : 3200, key, model,
       /* Router, answer and mail stay inside the browser's 3 minutes. */
       timeout: Math.max(60000, 145000 - (Date.now() - t0)) });

  let sections: Pager["sections"];
  if (kind === "custom") {
    sections = parseDoc(text);
  } else {
    /* A line naming sources is dropped: the foot counts them once. */
    const lines = String(text).split("\n").map(l => l.trim()).filter(l => l && !/^(\*\*)?sources?\b/i.test(l));
    const b = lines.filter(l => /^([-*•]|\d+[.)]) /.test(l)).map(l => l.replace(/^([-*•]|\d+[.)]) /, "").trim());
    /* A model that ignored the shape still has an answer in it, so its prose
       becomes the bullets rather than an empty page. */
    sections = [{ head: "", bullets: (b.length ? b : lines).slice(0, 9).map(splitBullet) }];
  }

  const one = brains.length === 1;
  const scope = one ? brains[0].name
    : opts.pick === "person" ? "People" : opts.pick === "subject" ? "Subjects" : SPACE_NAME[space];
  const where = one ? brains[0].name : `${brains.length} brains`;
  const cap = (t: string) => t.length > 78 ? t.slice(0, 75).trimEnd() + "..." : t;
  const subject = cap(q || scope);
  const title = kind === "custom" && DOC_TITLE[doc] ? `${DOC_TITLE[doc]}: ${subject}` : subject;
  const count = (head: RegExp) => (sections.find(x => head.test(x.head))?.blocks ?? [])
    .reduce((n, x: any) => n + (x.ol?.length ?? x.ul?.length ?? 0), 0);
  const written = note ? ` Written to: ${note.length > 110 ? note.slice(0, 107).trimEnd() + "..." : note}` : "";
  const line = kind === "summary" ? `Asked of ${where} in ${SPACE_NAME[space]}.`
    : doc === "quiz" ? `${count(/question/i)} questions on ${where}. The answers follow.${written}`
    : doc === "deepdive" ? `From ${where}.${written}`
    : doc === "usecase" ? `${sections.length} case${sections.length === 1 ? "" : "s"} from ${where}.${written}`
    : `Written to: ${note.length > 110 ? note.slice(0, 107).trimEnd() + "..." : note}`;

  return {
    title, line, sections,
    foot: [
      `${found.opened.length} of ${inPool.length} position${inPool.length === 1 ? "" : "s"}`,
      `${read} source${read === 1 ? "" : "s"} read`,
      today,
    ].join(" · "),
  };
}

/** "Core concept: what it says", with the markdown a model adds taken off. */
function splitBullet(line: string): Bullet {
  const t = line.replace(/\*\*/g, "").replace(/^["']|["']$/g, "").trim();
  const at = t.indexOf(": ");
  /* A name is short. A colon deep in a sentence is part of what it says. */
  if (at > 0 && at <= 60) return { k: t.slice(0, at).trim(), say: clamp(stop(t.slice(at + 2))) };
  return { k: "", say: clamp(stop(t)) };
}

/* ---------- rendering ---------- */

const esc = (s: string) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The concept in bold on its line, what it says beneath it. */
const bulletHtml = (b: Bullet | string) => {
  if (typeof b === "string") return esc(b);
  const say = b.say ? esc(b.say) : "";
  return b.k ? `<strong style="font-weight:600;color:#141413">${esc(b.k)}</strong>${say ? `<br>${say}` : ""}` : say;
};

/* **bold** inside a document's text: kept as bold in HTML, dropped in plain text. */
const boldHtml = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:#141413">$1</strong>');
const plain = (t: string) => String(t ?? "").replace(/\*\*([^*]+)\*\*/g, "$1");

/** The page as plain text, which is what a mail client with no HTML shows. */
export function asText(p: Pager): string {
  const out = [p.title, p.line, ""];
  for (const s of p.sections) {
    if (s.head) out.push(s.head.toUpperCase(), "");
    for (const b of s.bullets) out.push("- " + bulletText(b));
    for (const x of s.blocks ?? []) {
      if ("p" in x) out.push(plain(x.p), "");
      else if ("ul" in x) { for (const i of x.ul) out.push("- " + plain(i)); out.push(""); }
      else { x.ol.forEach((i, n) => out.push(`${n + 1}. ${plain(i)}`)); out.push(""); }
    }
    if (!(s.blocks ?? []).length) out.push("");
  }
  out.push(p.foot);
  return out.join("\n");
}

/**
 * The page as mail.
 *
 * Inline styles and a table free layout, because a mail client strips a
 * stylesheet and ignores most of what a browser honours. It reads as plain text
 * where even that is stripped.
 */
export function asHtml(p: Pager, from: string): string {
  const font = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
  const li = (t: string) => `<li style="margin:0 0 8px;font:400 15px/1.55 ${font};color:#3d3d3a">${boldHtml(t)}</li>`;
  const blocks = (bs: Block[]) => bs.map(x =>
    "p" in x ? `<p style="margin:0 0 12px;font:400 15px/1.6 ${font};color:#3d3d3a">${boldHtml(x.p)}</p>`
    : "ul" in x ? `<ul style="margin:0 0 12px;padding-left:20px">${x.ul.map(li).join("")}</ul>`
    : `<ol style="margin:0 0 12px;padding-left:22px">${x.ol.map(li).join("")}</ol>`).join("\n      ");
  const sections = p.sections.map(s => `
      ${s.head ? `<h2 style="margin:26px 0 8px;font:600 13px/1.4 ${font};letter-spacing:.06em;text-transform:uppercase;color:#93918a">${esc(s.head)}</h2>` : ""}
      ${(s.blocks ?? []).length ? blocks(s.blocks!) : `<ul style="margin:0;padding-left:20px">
        ${s.bullets.map(b => `<li style="margin:0 0 11px;font:400 15px/1.55 ${font};color:#3d3d3a">${bulletHtml(b)}</li>`).join("\n        ")}
      </ul>`}`).join("\n");

  return `<!doctype html>
<html><body style="margin:0;padding:28px 18px;background:#faf9f5">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e2d9;border-radius:14px;padding:30px 32px">
    <div style="font:500 11px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:#bf5a3c">${esc(from)}</div>
    <h1 style="margin:8px 0 0;font:600 25px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#141413">${esc(p.title)}</h1>
    <p style="margin:9px 0 22px;font:400 15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6e6e68">${esc(p.line)}</p>
${sections}
    <p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #e5e2d9;font:400 12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#93918a">${esc(p.foot)}</p>
  </div>
</body></html>`;
}

/* ---------- sending ---------- */

/** An address, loosely. The mail service is the real check. */
export const looksLikeMail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s ?? "").trim());

/**
 * Send the page.
 *
 * The body is always what this deployment just built, never something handed in
 * by the caller, so a signed-in session cannot use this as an open mailer.
 */
export async function mail(to: string, p: Pager, space: Space): Promise<{ sent: true; id: string }> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "mailing needs RESEND_API_KEY on this deployment. Set it with --prod, because a key " +
      "set without that flag lands on the dev deployment while the live site reads production.");
  }
  /* MAIL_FROM wins. The fallback is the address this deployment sends from, so
     a MAIL_FROM set on dev instead of prod still sends from the verified domain. */
  const address = (process.env.MAIL_FROM || "hello@kaught.app").trim();
  const name = SPACE_NAME[space];

  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${name} <${address}>`,
        to: [to],
        subject: p.title,
        html: asHtml(p, name),
        text: asText(p),
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) {
    const why = e?.name === "TimeoutError" || e?.name === "AbortError"
      ? "it did not answer within 20 seconds" : String(e?.message ?? e).slice(0, 140);
    throw new Error(`the mail service did not answer: ${why}`);
  }

  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const said = String(d?.message ?? d?.error?.message ?? `HTTP ${r.status}`).slice(0, 200);
    /* The one failure worth naming, because it looks like a code problem and is
       a DNS one. */
    if (/domain|verify/i.test(said)) {
      throw new Error(`${said}. Verify ${address.split("@")[1]} in Resend, then send again.`);
    }
    throw new Error(said);
  }
  return { sent: true, id: String(d?.id ?? "") };
}
