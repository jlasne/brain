/**
 * Voice: a piece of speech written as text by Whisper large-v3 turbo, through
 * OpenRouter's transcription endpoint, on the same key as the chat. The app
 * records the voice and sends it about 20 seconds at a time, cut at a pause, so
 * each piece stays well inside the host's time for one transcription, no word is
 * cut in two, and a talk can run as long as the person wants.
 */

import { OPENROUTER } from "./lib";

export const VOICE_MODEL = "openai/whisper-large-v3-turbo";
/* What OpenRouter charges for it: $0.04 an hour of audio. Counted from the seconds sent when the host reply carries no price. */
export const VOICE_USD_PER_SECOND = 0.04 / 3600;
/* The longest piece taken: the app cuts at 20 to 28 seconds, so this leaves room. */
export const VOICE_MAX_SECONDS = 60;
/* A piece's audio, base64: 60 seconds of compressed speech is well under this. */
const VOICE_MAX_CHARS = 4_000_000;
/* What browsers record, as the endpoint names it: Chrome and Edge record webm, Firefox ogg, Safari mp4, read as m4a. */
const FORMATS: Record<string, string> = { webm: "webm", ogg: "ogg", mp4: "m4a", m4a: "m4a", aac: "aac", wav: "wav", mp3: "mp3", flac: "flac" };
/* The languages Whisper is told, by their two letters: the mic's languages in Settings. None means it works the language out. */
const LANG_RE = /^[a-z]{2}$/;

/* Lines Whisper is known to write over a quiet piece, from the subtitles it learned on: never words anyone said into the mic. */
const GHOSTS = [/sous-titr(es|age)[^.\n]*(amara|st'? ?501|communaut)/i, /amara\.org/i, /thanks? for watching/i, /merci d'avoir regard/i, /subtitles? by/i];

/** What the host's refusal says, in words, with what to do. */
function voiceError(status: number, body: string) {
  let msg = "";
  try { msg = String(JSON.parse(body)?.error?.message ?? ""); } catch {}
  if (!msg) msg = body.replace(/\s+/g, " ").slice(0, 160);
  if (status === 401 || status === 403) return `the model key was refused for voice (${status}${msg ? ": " + msg.slice(0, 120) : ""}). Check the key at openrouter.ai/keys.`;
  if (status === 402) return "the model key is out of credit at OpenRouter, so the voice could not be written.";
  if (status === 429) return "Whisper is rate limiting this key. Wait a few seconds and talk again.";
  if (status >= 500) return "Whisper is down at the host just now. Talk again in a minute, or pick Browser in Settings, Languages.";
  return msg || `the voice could not be written (${status})`;
}

/**
 * One piece of speech, written. `seconds` is how long the piece lasts, as the app measured it: the cost when the host gives none.
 * The key is used for this call only, as for every model call.
 */
export async function transcribe(o: { audio: string; format: string; lang?: string; seconds: number; key?: string; meter?: (u: any) => void }) {
  const key = o.key || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("no model key: either sign in with your own, or set OPENROUTER_API_KEY");
  const data = String(o.audio ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!data) throw new Error("the piece of speech is empty");
  if (data.length > VOICE_MAX_CHARS) throw new Error(`a piece of speech is at most ${VOICE_MAX_SECONDS} seconds`);
  const format = FORMATS[String(o.format ?? "").toLowerCase()];
  if (!format) throw new Error("the voice came in a format Whisper does not read: webm, ogg, m4a, aac, wav, mp3 or flac");
  const lang = LANG_RE.test(String(o.lang ?? "")) ? String(o.lang) : "";
  const seconds = Math.max(0, Math.min(VOICE_MAX_SECONDS, Number(o.seconds) || 0));
  const r = await fetch(`${OPENROUTER}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://brain.jeremylasne.com", "X-Title": "Octopus" },
    body: JSON.stringify({ model: VOICE_MODEL, input_audio: { data, format }, ...(lang ? { language: lang } : {}), temperature: 0 }),
    signal: AbortSignal.timeout(75000),
  }).catch((e: any) => { throw new Error(/abort|timeout/i.test(String(e?.name ?? e)) ? "Whisper took too long on this piece. Talk again." : "Whisper could not be reached. Check the connection and talk again."); });
  if (!r.ok) throw new Error(voiceError(r.status, await r.text()));
  const d: any = await r.json().catch(() => ({}));
  /* Paid by the second: the host's price when it gives one, else the seconds sent. */
  const cost = typeof d?.usage?.cost === "number" && Number.isFinite(d.usage.cost) ? d.usage.cost : seconds * VOICE_USD_PER_SECOND;
  o.meter?.({ cost, prompt_tokens: 0, completion_tokens: 0 });
  let text = String(d?.text ?? "").replace(/\s+/g, " ").trim();
  if (GHOSTS.some(g => g.test(text))) text = "";
  return { text, seconds };
}
