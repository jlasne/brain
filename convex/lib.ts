/** Shared helpers. No model call and no brain read happens without passing the gate. */

/* The model every workspace answers, reads drops and writes one-pagers with,
   unless it picks another in Settings. */
export const MODEL = "z-ai/glm-5.3-flash";
/* What an OpenRouter model id reads like: vendor/model, with the tag some carry, such as ":free". */
export const MODEL_ID = /^[a-z0-9~][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export const SESSION_MS = 1000 * 60 * 60 * 12;   // 12 hours
export const MAX_ATTEMPTS = 8;                   // per hour, per door and address
export const ATTEMPT_WINDOW_MS = 1000 * 60 * 60;

export const today = () => new Date().toISOString().slice(0, 10);
/** A day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Where every model call, embedding and price check goes. */
export const OPENROUTER = "https://openrouter.ai/api/v1";

export const slug = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 48) || "item";

export async function sha256(salt: string, pass: string) {
  const buf = new TextEncoder().encode(salt + "\0" + pass);
  const out = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(out)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/*
 * A passphrase is kept as PBKDF2 over SHA-256, 600,000 rounds, written "p2$600000$<hex>", so a copy of the database costs a
 * guesser 600,000 hashes a guess. A hash from before is one SHA-256, and is written again the next time its passphrase opens
 * the door. A runtime without PBKDF2 keeps the old kind, so no door ever stops opening.
 */
export const PASS_ROUNDS = 600_000;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
async function pbkdf2(salt: string, pass: string, rounds: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: rounds }, key, 256));
}
export async function passHash(salt: string, pass: string): Promise<string> {
  try { return `p2$${PASS_ROUNDS}$${await pbkdf2(salt, pass, PASS_ROUNDS)}`; }
  catch { return await sha256(salt, pass); }
}
/** Two strings compared in a time that does not depend on where they differ. */
function same(x: string, y: string) {
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
export async function passMatches(salt: string, pass: string, stored: string): Promise<boolean> {
  const m = /^p2\$(\d+)\$([0-9a-f]+)$/.exec(stored);
  if (m) return same(await pbkdf2(salt, pass, Number(m[1])), m[2]);
  return same(await sha256(salt, pass), stored);
}
/** A hash of the old kind, to write again now that its passphrase is known. */
export const passIsOld = (stored: string) => !stored.startsWith("p2$");
/**
 * Two hex characters of a keyed hash of the passphrase, kept beside the slow hash. The landing's one field tries every door,
 * and this lets it run the slow hash on the 1 door in 256 whose mark matches. The key is PASS_PEPPER when the deployment sets it.
 */
export const passMark = async (pass: string) => (await sha256(process.env.PASS_PEPPER || "tasu-door", pass)).slice(0, 2);

export const randomHex = (bytes = 24) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(b => b.toString(16).padStart(2, "0")).join("");

/** Strip tracking, pull the video id, so the same source never lands twice. */
export function linkKey(link: string) {
  if (!link) return "";
  try {
    const u = new URL(link);
    const yt = link.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
    if (yt) return "yt:" + yt[1];
    return u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch { return link.trim().toLowerCase().slice(0, 200); }
}

export function sourceId(link: string, text: string) {
  const k = linkKey(link);
  if (k.startsWith("yt:")) return "yt-" + k.slice(3);
  if (k) return slug(k).slice(0, 40);
  /* A hash of the text, not the clock, so the same text dropped twice is
     caught as a repeat, and two texts that open alike stay two sources. */
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (slug(text.slice(0, 40)).slice(0, 30) || "text") + "-" + h.toString(36);
}


/* ---------- the two spaces ---------- */

/**
 * One deployment, two spaces that never see each other.
 *
 * A space owns its brains, its sources and its passphrase. A session belongs to
 * exactly one, and every brain read filters by it, so the Octopus passphrase
 * shows no Squidgy brain and the Squidgy passphrase shows no Octopus brain.
 *
 * Octopus is the space that existed before this split. Its rows carry no space
 * field, and absent reads as Octopus, so nothing already stored has to move.
 */
export const SPACES = ["octopus", "squidgy"] as const;
/* A workspace: the owner's two above, the demo, or one a visitor made. */
export type Space = string;
export const HOME: Space = "octopus";

/* What a workspace slug may look like: lower case, digits and dashes. */
export const SPACE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/**
 * Anything off the wire becomes a workspace slug. Empty reads as Octopus,
 * which is where every row written before workspaces belonged. A slug with
 * no workspace behind it holds nothing and opens nothing: its door has no
 * passphrase, so no session is ever made for it.
 */
export const readSpace = (v: unknown): Space => {
  const s = String(v ?? "").trim().toLowerCase();
  return SPACE_RE.test(s) ? s : HOME;
};

/**
 * Whether a brain is in a workspace: it lives there, or its owner shared it
 * there. A shared brain is one row seen from two workspaces, so a drop in
 * either one fills both. A viewer sees it but cannot change it: the demo,
 * which any visitor opens.
 */
export const inSpace = (b: any, space: string): boolean =>
  !!b && (readSpace(b.space) === space || (Array.isArray(b.shared) && b.shared.includes(space))
    || (Array.isArray(b.viewers) && b.viewers.includes(space)));

/** A brain a workspace may read and never change. */
export const isViewer = (b: any, space: string): boolean =>
  !!b && readSpace(b.space) !== space && Array.isArray(b.viewers) && b.viewers.includes(space);

/** A workspace slug from the name a person typed: "Acme Research" is acme-research. */
export const slugOfName = (name: string) => String(name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");

/**
 * Which config row holds a space's passphrase.
 *
 * Octopus keeps the original key, so the passphrase already set stays the one
 * that opens it. Each row carries its own attempt counter, so eight wrong
 * guesses at one door leave the other open.
 */
export const gateKey = (s: Space) => (s === HOME ? "gate" : `gate:${s}`);

/** What each space calls itself, wherever a reply names one. */
export const SPACE_NAME: Record<string, string> = { octopus: "Octopus", squidgy: "Squidgy", demo: "Demo" };
/** A workspace's name: the owner's two by name, any other from its slug. */
export const spaceName = (s: string) => SPACE_NAME[s] ?? String(s).split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/* ---------- who is calling, and what they may feed ---------- */

/* One kind of caller: the owner, by passphrase or by their connector address.
   Member accounts and guest keys were removed, so every session feeds every
   brain of its space. The account names the connector's holder, when there is one. */
export type Who = { kind: "owner"; account: string | null; space: Space };

/**
 * Feeding is the guarded act, because a source rewrites the positions inside: the owner of the session feeds every folder of its
 * workspace, and a folder another workspace only shares with it stays read only.
 */
export const canDrop = (b: any, who: Who) => !!b && who.kind === "owner" && !isViewer(b, who.space);

/* CORS: the app is served from your own domain, the API from convex.site */
const ORIGINS = [
  "https://tasu.ai",
  "https://www.tasu.ai",
  "https://brain.jeremylasne.com",
  "https://www.jeremylasne.com",
  "http://localhost:3000",
  "http://localhost:5173",
];
export function cors(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(req) },
  });

/**
 * How much the model is allowed to deliberate before writing.
 *
 * This model reasons by default, and reasoning tokens are output tokens
 * generated BEFORE any visible reply. Left alone it spent minutes thinking,
 * or spent the whole budget thinking and returned a truncated reply. Every
 * job here follows a fixed format, so deliberation buys nothing.
 *
 * If this model marks reasoning mandatory, "none" is rejected and the fallback
 * is a floor cap: { max_tokens: 1024 }.
 */
export const REASONING = { effort: "none" } as const;
/* For a model that refuses to answer with no thinking: a little, kept out of
   the reply, and this much more room in the budget, which thinking spends. */
export const THINK_LOW = { effort: "low", exclude: true } as const;
export const THINK_ROOM = 4000;
const MUST_THINK = /reasoning is mandatory|cannot be disabled|reasoning.{0,40}required/i;
/* The models seen to refuse, so the next call asks them right the first time. The default model is known to, so even a fresh
   server asks it right from its first call. */
const THINKERS = new Set<string>([MODEL]);

/**
 * What a model call is counted under: the folders' chat (a chat about one concept too), the personal brain's (its interview and people
 * too), a drop, the upkeep that runs after one or on its own (links, insights, topics, tidy, clashes), a one-pager, the voice, and the
 * assets (a chat that tags one, and a file read in).
 */
export const SPEND_KINDS = ["folders", "personal", "drops", "upkeep", "pager", "voice", "assets"] as const;
export type SpendKind = typeof SPEND_KINDS[number];

/**
 * What a refusal from the model host says, in words.
 *
 * It answers an error as JSON, and the raw payload used to land in front of the
 * person who dropped a source. The four cases below cover what actually
 * happened: a model retired, a key refused, credit gone, a rate limit.
 */
function modelError(status: number, body: string, model: string) {
  let msg = "";
  try { msg = String(JSON.parse(body)?.error?.message ?? ""); } catch {}
  if (!msg) msg = body.replace(/\s+/g, " ").slice(0, 200);

  /* A retired model comes back with its replacement named, so the picker can be
     pointed straight at it. */
  const moved = msg.match(/use this slug instead:\s*([A-Za-z0-9._\/:-]+)/i);
  if (moved) return `${model} is retired. Pick ${moved[1]} in the model list.`;

  /* The host's own reason follows, because 401 and 403 cover a revoked key, a
     spending cap reached and a blocked model, and each has a different fix. */
  if (status === 401 || status === 403) {
    return `the model key was refused (${status}${msg ? ": " + msg.slice(0, 160) : ""}). ` +
      "Check the key at openrouter.ai/keys, then set it again on the deployment.";
  }
  if (status === 402) return "that model key is out of credit at OpenRouter.";
  if (status === 429) return `${model} is rate limiting this key. Wait a minute, or pick a paid model.`;
  if (status >= 500) return `${model} is down at the host. Pick another model in the model list.`;
  return msg;
}

/* The one place a model gets called. MODEL above is the default, and opts.model
   is the caller naming another one on their own key. */
export async function ask(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { json?: boolean; maxTokens?: number; reasoning?: unknown; key?: string; model?: string; timeout?: number; temperature?: number;
          /* Told what the call used once the host has answered, so a caller counts its cost without handling the reply. */
          meter?: (usage: any) => void } = {},
) {
  /**
   * opts.key is a member's own key, sent with the request and used here only.
   * It must never be written to the database, logged, or passed into a query or
   * mutation, because Convex records function arguments. Without it the call
   * falls back to the deployment's key, which is the owner's own credit.
   */
  const key = opts.key || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("no model key: either sign in with your own, or set OPENROUTER_API_KEY");

  /**
   * The deadline.
   *
   * The browser gives a call 180 seconds. With nothing set here, a model that
   * goes quiet held the socket until the browser gave up: the caller read "try
   * a shorter source" while this side kept generating, and paying. Stopping at
   * 150 puts the failure on this side, where it can be named.
   */
  /* A whole number: a fraction makes the timer throw before the call starts. */
  const limit = Math.max(1000, Math.round(opts.timeout ?? 150000));
  const model = opts.model || MODEL;
  /* One deadline for the call and its one retry. */
  const signal = AbortSignal.timeout(limit);

  /* Thinking switched off is cheaper and quicker, so every call asks for it.
     A model that cannot answer without thinking, GLM 5.3 Flash among them,
     refuses the request outright, so it is asked again with a little thinking
     and room in the budget for it, and remembered. */
  const send = (thinks: boolean) => fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://brain.jeremylasne.com",
      "X-Title": "Octopus",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: (opts.maxTokens ?? 8000) + (thinks ? THINK_ROOM : 0),
      reasoning: thinks ? THINK_LOW : opts.reasoning ?? REASONING,
      /* Low for a step that must pick the same way each time it is asked. */
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal,
  });

  /* The deadline also covers reading the body. OpenRouter answers with its
     headers at once and writes the reply while it generates, so a long job
     timed out here, in the read, and surfaced as the platform's bare "The
     signal has been aborted" instead of the sentence above. */
  const late = () => new Error(
    `${model} was still writing after ${Math.round(limit / 1000)} seconds. ` +
    `The job was too big for one call.`);
  let d: any, answered = false;
  try {
    let r = await send(THINKERS.has(model));
    answered = true;
    if (!r.ok) {
      const body = await r.text();
      if (THINKERS.has(model) || !MUST_THINK.test(body)) throw new Error(modelError(r.status, body, model));
      THINKERS.add(model);
      answered = false;
      r = await send(true);
      answered = true;
      if (!r.ok) throw new Error(modelError(r.status, await r.text(), model));
    }
    d = await r.json();
  } catch (e: any) {
    const name = String(e?.name ?? "");
    if (name === "TimeoutError" || name === "AbortError") {
      throw answered ? late() : new Error(
        `${model} sent nothing for ${Math.round(limit / 1000)} seconds. ` +
        `Pick a faster model in the model list, or split the source.`);
    }
    /* A request that never reached the host: no answer came back at all. */
    if (!answered) throw new Error(`the model host was unreachable: ${String(e?.message ?? e).slice(0, 140)}`);
    throw e;
  }
  const choice = d?.choices?.[0];
  const text: string = choice?.message?.content ?? "";
  const finish: string = choice?.finish_reason ?? choice?.native_finish_reason ?? "";
  const usage = d?.usage ?? null;
  try { opts.meter?.(usage); } catch { /* counting never fails the call it counts */ }
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  if (!text) {
    throw new Error(
      `the model returned nothing (finish: ${finish || "unknown"}, ` +
      `reasoning tokens: ${reasoningTokens}). ` +
      (reasoningTokens > 0 ? "It spent the budget deliberating rather than answering." : ""));
  }
  return { text, usage, finish, reasoningTokens };
}

/** The chunk size both sides use. Small enough that one extraction fits the reply budget. */
export const CHUNK = 18000;

/**
 * The slips a model makes inside otherwise good JSON, mended in one pass:
 * a quote mark inside a string left bare ("the "ultrasound money" thesis"),
 * a line break or tab inside a string, a comma before a closing bracket, text
 * after the last bracket, and a reply that stops before its brackets close.
 * A quote counts as closing a string only when what follows it could follow
 * a string: a comma, a colon, a closing bracket, or the end.
 */
export function repairJson(src: string): { text: string; cut: boolean } {
  let out = "", inStr = false, esc = false;
  const stack: string[] = [];
  const skip = (j: number) => { while (j < src.length && /\s/.test(src[j])) j++; return j; };
  /* After a closing quote comes a colon, a bracket, the end, or a comma and
     then another value. A comma followed by a plain word is prose. */
  const closes = (from: number) => {
    let j = skip(from);
    const n = src[j];
    if (n === undefined || n === "}" || n === "]" || n === ":") return true;
    if (n !== ",") return false;
    j = skip(j + 1);
    return src[j] === undefined || /["{\[\]}\-0-9]/.test(src[j]) || /^(true|false|null)\b/.test(src.slice(j, j + 6));
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      if (ch === '"') {
        if (closes(i + 1)) { out += ch; inStr = false; }
        else out += '\\"';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch === "{" ? "}" : "]"); out += ch; continue; }
    if (ch === "}" || ch === "]") {
      out = out.replace(/,\s*$/, "");
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
      out += ch;
      /* The outer value is closed: what follows is prose, not JSON. */
      if (!stack.length) return { text: out, cut: false };
      continue;
    }
    out += ch;
  }
  /* Cut short: close the string, drop a key left with no value, close each
     bracket, and say so, so a caller never keeps half a reply as whole. */
  if (inStr) { if (esc) out = out.slice(0, -1); out += '"'; }
  out = out.replace(/\s+$/, "");
  if (stack[stack.length - 1] === "}") out = out.replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, "$1");
  out = out.replace(/[,:]\s*$/, "");
  while (stack.length) out += stack.pop();
  return { text: out, cut: true };
}

/**
 * Read JSON out of a reply tolerantly: whole body, fenced block, or first brace
 * to last. A reply cut off by the token budget cannot parse, and that is the
 * common failure, so the caller passes `finish` to get a message worth reading.
 */
export function parseJson(text: string, finish?: string): any {
  if (finish === "length") {
    throw new Error(
      "the reply was cut off by the token budget, so the extraction is incomplete. " +
      "Split the source into smaller parts and drop each one.");
  }
  const starts = [text.indexOf("{"), text.indexOf("[")].filter(i => i >= 0);
  const tries = [
    text,
    text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    starts.length
      ? text.slice(Math.min(...starts), Math.max(text.lastIndexOf("}"), text.lastIndexOf("]")) + 1)
      : undefined,
  ].filter(Boolean) as string[];
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  /* A reply that is JSON with a slip in it: mended, then read once more. One
     that stopped before its end is refused, so the part is read again rather
     than kept half: what it left out would be lost with no word said. */
  if (starts.length) {
    const fixed = repairJson(text.slice(Math.min(...starts)));
    let d: any;
    try { d = JSON.parse(fixed.text); } catch { /* fall through */ }
    if (d !== undefined && fixed.cut) {
      throw new Error("the reply stopped before it ended, so part of it is missing. The part is asked again, in halves when it can be split.");
    }
    if (d !== undefined) return d;
  }
  throw new Error(
    `the reply held no JSON (finish: ${finish || "unknown"}, ${text.length} chars). ` +
    `It began: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
}
