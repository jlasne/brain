/**
 * Voice written by Whisper: what is sent to OpenRouter's transcription
 * endpoint, what comes back, what it costs, and what is refused before
 * anything is sent. The host is played by a fake that keeps every request.
 *
 *     node scripts/check-voice.mjs
 */

import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "octo-voice-"));
mkdirSync(join(dir, "_generated"));
for (const f of readdirSync(join(ROOT, "convex")).filter(f => f.endsWith(".ts"))) copyFileSync(join(ROOT, "convex", f), join(dir, f));
writeFileSync(join(dir, "_generated/api.ts"), "export const internal = {};\n");
writeFileSync(join(dir, "_generated/server.ts"), "const f = (x) => x;\nexport const internalQuery = f, internalMutation = f, internalAction = f, httpAction = f, query = f, mutation = f, action = f;\n");
await esbuild.build({ entryPoints: [join(dir, "voice.ts")], bundle: true, format: "esm", nodePaths: [join(ROOT, "node_modules")],
  platform: "node", outfile: join(dir, "bundle.mjs"), logLevel: "silent" });
const voice = await import(pathToFileURL(join(dir, "bundle.mjs")).href);

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};
const fails = async p => { try { await p; return ""; } catch (e) { return String(e.message); } };

/* The host: answers with `reply`, or with a status and a body. */
const sent = [];
let reply = { status: 200, body: { text: " Bonjour, je voudrais  réserver une table. ", usage: { cost: 0.00021 } } };
globalThis.fetch = async (url, opt) => {
  sent.push({ url: String(url), headers: opt.headers, body: JSON.parse(opt.body) });
  return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status });
};
process.env.OPENROUTER_API_KEY = "sk-or-deployment-key-000000000000";
const AUDIO = Buffer.from("fake opus bytes").toString("base64");

/* ---- one piece written ---- */
{
  const used = [];
  const r = await voice.transcribe({ audio: AUDIO, format: "webm", lang: "fr", seconds: 19.6, meter: u => used.push(u) });
  const s = sent.at(-1);
  check("a piece goes to OpenRouter's transcription endpoint, to Whisper large-v3 turbo, as base64 with its format and language",
    s.url === "https://openrouter.ai/api/v1/audio/transcriptions" && s.body.model === "openai/whisper-large-v3-turbo" && s.body.input_audio.data === AUDIO
    && s.body.input_audio.format === "webm" && s.body.language === "fr" && s.body.temperature === 0, JSON.stringify(s.body).slice(0, 200));
  check("on the deployment's key when the workspace has none of its own", s.headers.Authorization === "Bearer sk-or-deployment-key-000000000000");
  check("the words come back on one line, spaces tidied", r.text === "Bonjour, je voudrais réserver une table." && r.seconds === 19.6, JSON.stringify(r));
  check("its cost is the host's price when it gives one", used.length === 1 && used[0].cost === 0.00021, JSON.stringify(used));
}

/* ---- the key, the language, the format and the cost when no price comes back ---- */
{
  reply = { status: 200, body: { text: "Hello there." } };
  const used = [];
  await voice.transcribe({ audio: `data:audio/mp4;base64,${AUDIO}`, format: "mp4", lang: "", seconds: 36, key: "sk-or-own-key-11111111111111111111", meter: u => used.push(u) });
  const s = sent.at(-1);
  check("a workspace's own key is the one used", s.headers.Authorization === "Bearer sk-or-own-key-11111111111111111111");
  check("Safari's mp4 goes as m4a, a data URL is cut to its base64, and with no language Whisper is left to tell", s.body.input_audio.format === "m4a" && s.body.input_audio.data === AUDIO && !("language" in s.body), JSON.stringify(s.body).slice(0, 160));
  check("with no price from the host, the seconds sent are counted at $0.04 an hour", Math.abs(used[0].cost - 36 * 0.04 / 3600) < 1e-12, JSON.stringify(used));
  await voice.transcribe({ audio: AUDIO, format: "ogg", lang: "french", seconds: 999 });
  check("a language that is not two letters is left out, and a piece is counted at 60 seconds at most", !("language" in sent.at(-1).body) && sent.at(-1).body.input_audio.format === "ogg");
}

/* ---- what Whisper writes over a quiet piece is dropped ---- */
{
  for (const ghost of ["Sous-titres réalisés par la communauté d'Amara.org", "Thanks for watching!", "Sous-titrage ST' 501"]) {
    reply = { status: 200, body: { text: ghost } };
    check(`"${ghost}" is a known line over silence, and comes back as nothing`, (await voice.transcribe({ audio: AUDIO, format: "webm", seconds: 5 })).text === "");
  }
  reply = { status: 200, body: { text: "Merci beaucoup pour hier." } };
  check("a real thank-you stays", (await voice.transcribe({ audio: AUDIO, format: "webm", seconds: 5 })).text === "Merci beaucoup pour hier.");
}

/* ---- refused before anything is sent ---- */
{
  const n = sent.length;
  const empty = await fails(voice.transcribe({ audio: "", format: "webm", seconds: 1 }));
  const big = await fails(voice.transcribe({ audio: "A".repeat(4_000_001), format: "webm", seconds: 20 }));
  const odd = await fails(voice.transcribe({ audio: AUDIO, format: "avi", seconds: 20 }));
  check("an empty piece, one past 60 seconds of audio, and a format Whisper does not read are refused, with nothing sent",
    /empty/.test(empty) && /at most 60 seconds/.test(big) && /format Whisper does not read/.test(odd) && sent.length === n, JSON.stringify([empty, big, odd]));
  const key = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;
  check("with no key at all, it says so", /no model key/.test(await fails(voice.transcribe({ audio: AUDIO, format: "webm", seconds: 1 }))));
  process.env.OPENROUTER_API_KEY = key;
}

/* ---- the host's refusals, in words ---- */
{
  const says = async (status, body) => { reply = { status, body }; return await fails(voice.transcribe({ audio: AUDIO, format: "webm", seconds: 3 })); };
  check("a refused key says where to check it", /model key was refused for voice \(401: bad key\)\. Check the key at openrouter\.ai\/keys\./.test(await says(401, { error: { message: "bad key" } })));
  check("no credit says so", /out of credit/.test(await says(402, { error: { message: "x" } })));
  check("a rate limit says to wait", /rate limiting this key/.test(await says(429, "slow down")));
  check("a host that is down says to talk again or pick the browser", /down at the host just now\. Talk again in a minute, or pick Browser in Settings, Languages\./.test(await says(503, "busy")));
  globalThis.fetch = async () => { throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }); };
  check("a host that never answers is a sentence, not a stack", /took too long on this piece/.test(await fails(voice.transcribe({ audio: AUDIO, format: "webm", seconds: 3 }))));
}

console.log(failures ? `\n${failures} failed` : "\nthe voice is written");
process.exit(failures ? 1 : 0);
