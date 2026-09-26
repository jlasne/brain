/**
 * One page, in bullets.
 *
 * Three ways to build one: a brain, a group of brains, or a question. The first
 * two assemble from what is already stored and call no model, because a
 * position is the compressed form already. Only a question needs one call.
 *
 * The result is one shape, so the screen, the clipboard and the mail all render
 * the same page.
 */

import { ask, SPACE_NAME } from "./lib";
import type { Who, Space } from "./lib";

export type Pager = {
  title: string;
  line: string;
  sections: { head: string; bullets: string[] }[];
  foot: string;
};

/* One page holds about this much before it stops being one page. */
const ONE_BRAIN = 14;
const PER_BRAIN = 6;
const MAX_BRAINS = 6;

const stop = (s: string) => {
  const t = String(s ?? "").trim();
  return !t || /[.!?]$/.test(t) ? t : t + ".";
};

/** The first sentence, for a position written as several. */
const firstLine = (s: string) => {
  const t = String(s ?? "").trim();
  const cut = t.search(/[.!?]\s/);
  return cut > 0 ? t.slice(0, cut + 1) : t;
};

/**
 * What one concept says, in one bullet.
 *
 * The summary line is written to be exactly this, so it leads. A number from
 * the evidence follows it when there is one, because a bullet carrying a figure
 * survives the page and one carrying an adjective does not.
 */
function bulletOf(c: any): string {
  const said = stop(c.summaryLine || firstLine(c.position) || c.title);
  const data = (c.data ?? []).find((d: string) => /\d/.test(String(d)));
  const dates = (c.evidence ?? []).map((e: any) => String(e?.date ?? "")).filter(Boolean).sort();
  const last = dates.length ? dates[dates.length - 1] : String(c.updated ?? "");
  const tail = [data ? String(data).trim() : "", last].filter(Boolean).join(" · ");
  return tail ? `${said} (${tail})` : said;
}

/** The fullest first: most evidence, then most recently moved. */
const rank = (a: any, b: any) =>
  (b.evidence ?? []).length - (a.evidence ?? []).length ||
  String(b.updated ?? "").localeCompare(String(a.updated ?? ""));

/**
 * A page from what is stored. No model call, so it costs nothing and never
 * invents a line the brains do not hold.
 */
export function assemble(
  space: Space, brains: any[], concepts: any[], sources: any[], pick: string,
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

  const sections = brains.slice(0, one ? 1 : MAX_BRAINS).map(b => ({
    head: one ? "" : b.name,
    bullets: conceptsOf(b.slug).slice(0, one ? ONE_BRAIN : PER_BRAIN).map(bulletOf),
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

const BULLET_RULES = `Answer the question as a one page briefing, in bullets.

SHAPE
- At most 9 bullets. Each one starts with "- " on its own line.
- One idea per bullet, under 24 words.
- The FIRST bullet answers the question outright.
- Put the numbers, the dates and the findings inside the bullets.
- Order them so someone reading only the first three still has the answer.
- After the bullets, one blank line, then one line starting "Sources: " naming
  the authors and dates you used. Leave that line out if you used none.

WORDS
- English, always. No em-dashes. Under 30 words per sentence.
- Replace adjectives with data. No weasel words. Simple wording.
- Say what holds rather than what does not.
- Never invent evidence. If the stored knowledge does not answer it, say so in
  one bullet and name the kind of source that would fill the gap.`;

/** Everything the model may draw on, and nothing else. */
function dossier(brains: any[], concepts: any[]): string {
  return brains.flatMap(br =>
    concepts.filter((c: any) => c.brain === br.slug).sort(rank).map((c: any) =>
      `### ${c.title} in ${br.name}
POSITION: ${c.position || "none"}
EVIDENCE: ${(c.evidence ?? []).map((e: any) => `${e.date ?? "?"} ${e.author ?? "?"}: ${e.claim ?? ""}`).join(" | ") || "none"}
DATA: ${(c.data ?? []).join(" | ") || "none"}`)).join("\n\n")
    || "The chosen brains hold no positions yet.";
}

/** A page from a question. One model call, and the bullets come back parsed. */
export async function fromQuestion(
  space: Space, brains: any[], concepts: any[], sources: any[],
  q: string, key?: string, model?: string,
): Promise<Pager> {
  const today = new Date().toISOString().slice(0, 10);
  const slugs = brains.map(b => b.slug);
  const read = new Set(sources.filter((s: any) => (s.brains ?? []).some((x: string) => slugs.includes(x)))
                              .map((s: any) => s.sid)).size;

  const { text } = await ask([
    { role: "system", content: "You are the user's own knowledge base, answering from what it holds. You always answer in English." },
    { role: "user", content: `${BULLET_RULES}

STORED KNOWLEDGE
${dossier(brains, concepts)}

QUESTION: ${q}` },
  ], { maxTokens: 2000, key, model });

  const lines = String(text).split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => l.startsWith("- ")).map(l => l.slice(2).trim());
  const cited = lines.find(l => /^sources:/i.test(l)) ?? "";

  /* A model that ignored the shape still has an answer in it, so its prose
     becomes the bullets rather than an empty page. */
  const body = bullets.length ? bullets
    : lines.filter(l => !/^sources:/i.test(l)).slice(0, 9);

  return {
    title: q.length > 78 ? q.slice(0, 75).trimEnd() + "..." : q,
    line: `Asked of ${brains.length === 1 ? brains[0].name : `${brains.length} brains`} in ${SPACE_NAME[space]}.`,
    sections: [{ head: "", bullets: body }],
    foot: [cited.replace(/^sources:\s*/i, "Sources: "), `${read} source${read === 1 ? "" : "s"} read`, today]
      .filter(Boolean).join(" · "),
  };
}

/* ---------- rendering ---------- */

const esc = (s: string) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page as plain text, which is what a mail client with no HTML shows. */
export function asText(p: Pager): string {
  const out = [p.title, p.line, ""];
  for (const s of p.sections) {
    if (s.head) out.push(s.head.toUpperCase(), "");
    for (const b of s.bullets) out.push("- " + b);
    out.push("");
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
  const sections = p.sections.map(s => `
      ${s.head ? `<h2 style="margin:26px 0 8px;font:600 13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#93918a">${esc(s.head)}</h2>` : ""}
      <ul style="margin:0;padding-left:20px">
        ${s.bullets.map(b => `<li style="margin:0 0 9px;font:400 15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#3d3d3a">${esc(b)}</li>`).join("\n        ")}
      </ul>`).join("\n");

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
