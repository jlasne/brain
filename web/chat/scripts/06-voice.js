/* 06-voice: talk as long as you want, written by Whisper: the mic records, a piece is cut at a pause about every 20 seconds, and each is written by Whisper large-v3 turbo through the server, in the order it was said. */

/* ============ voice, written by Whisper ============ */
/* How the voice is cut: a piece of at least 20 seconds ends at the next pause of half a second, and none runs past 28. A piece with
   less than a third of a second of speech in it is never sent, so a pause costs nothing. The mic stops by itself after 3 minutes
   with nothing said: a mic left on by mistake. */
const WHISPER_PIECE = 20000, WHISPER_LONGEST = 28000, WHISPER_PAUSE = 500, WHISPER_SPEECH = 300, WHISPER_IDLE = 180000;
/** How long a piece runs: a shorter one may be set in this tab, for the checks. */
function wPiece(){ try { const n = Number(sessionStorage.getItem("octopus.voice.piece")); return n >= 500 ? n : WHISPER_PIECE; } catch { return WHISPER_PIECE; } }

/** What writes the voice: Whisper, unless the workspace picked the browser, this is the demo, or this browser cannot record. */
function micEngine(){ return S.demo || S.models?.mic === "browser" || !recorderOK() ? "browser" : "whisper"; }
/** A server older than this page sends no voice choice, and has no Whisper: the mic says so rather than listen another way. */
const WHISPER_OLD = "The server is older than this page and cannot write voice with Whisper yet. Run convex deploy, then reload.";
function whisperOld(){ return !S.demo && !S.models?.mic; }
function recorderOK(){ return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder); }
/** The language Whisper is told, in two letters, or none to let it tell. */
function whisperLang(){ const v = voiceLang(); if (!v || v === "auto") return ""; const two = v.split("-")[0]; return two === "nb" ? "no" : two; }
/** What this browser records in: the first it can of these. Safari records mp4, Firefox ogg, the others webm. */
function recordType(){
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/aac"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
const typeFormat = t => /webm/.test(t) ? "webm" : /ogg/.test(t) ? "ogg" : /mp4|m4a/.test(t) ? "m4a" : /aac/.test(t) ? "aac" : /wav/.test(t) ? "wav" : "webm";
const blobBase64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => no(new Error("the voice could not be read")); r.readAsDataURL(blob); });

/**
 * Talk into a chat bar, written by Whisper. The strip over the bar shows how long, and its dot moves with the voice; the words come
 * in a piece at a time, in the order said. Done keeps all of it once the last piece is written; Cancel keeps nothing. No time limit.
 */
async function startWhisper(bar){
  const field = bar.field();
  endVoice();
  const v = { bar, whisper: true, before: field.value, kept: "", live: "", at: Date.now(), last: Date.now(), stopping: false, broke: "",
    pieces: [], shown: 0, level: 0, floor: 0.01, gone: false };
  /* A key typed into the box takes over: the mic stops, and the box stays as it is. */
  v.onType = e => { if (e.isTrusted && rec === v) endVoice(); };
  field.addEventListener("input", v.onType);
  rec = v; S.listening = true;
  bar.say(""); bar.paint(); paintStrip();
  /* The sound is measured on a context made on the tap itself: Safari keeps one made later silent. */
  try { const AC = window.AudioContext || window.webkitAudioContext; v.ac = new AC(); v.ac.resume?.(); } catch { v.ac = null; }
  try { v.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e){
    if (rec !== v) return;
    v.broke = /NotAllowed|Security/.test(e?.name) ? "Allow the microphone for this site, then tap the mic again."
      : /NotFound/.test(e?.name) ? "No microphone was found on this device." : "The microphone could not start. Tap the mic to try again.";
    finishVoice(v); return;
  }
  if (rec !== v){ v.stream.getTracks().forEach(t => t.stop()); try { v.ac?.close(); } catch {} return; }
  /* How loud it is now: to cut at a pause, to leave out a piece with no speech in it, and to move the dot. */
  try {
    v.an = v.ac.createAnalyser(); v.an.fftSize = 1024; v.buf = new Float32Array(v.an.fftSize);
    v.ac.createMediaStreamSource(v.stream).connect(v.an);
  } catch { v.an = null; }
  v.type = recordType();
  piece(v);
  v.tick = setInterval(() => whisperTick(v), 100);
}

/** A new piece starts recording before the one it follows stops, so no word falls between the two. */
function piece(v){
  const mr = new MediaRecorder(v.stream, v.type ? { mimeType: v.type } : undefined);
  /* With no way to hear how loud it is, every piece counts as speech. */
  const p = { n: v.pieces.length, chunks: [], at: Date.now(), speech: v.an ? 0 : WHISPER_SPEECH, mr, state: "rec", text: "" };
  v.pieces.push(p);
  mr.ondataavailable = e => { if (e.data?.size) p.chunks.push(e.data); };
  mr.onstop = () => sendPiece(v, p);
  mr.start(1000);
  v.cur = p;
}

/** Every tenth of a second: how loud, whether it is a pause, and whether the piece ends here. */
function whisperTick(v){
  if (rec !== v){ clearInterval(v.tick); return; }
  const now = Date.now(), p = v.cur;
  /* A context the browser keeps paused cannot hear: every piece is then sent, and pieces end on time alone. */
  if (v.an && v.ac?.state !== "running" && now - v.at > 1500){ v.an = null; v.last = now; for (const x of v.pieces) if (x.state === "rec") x.speech = WHISPER_SPEECH; }
  if (v.an){
    v.an.getFloatTimeDomainData(v.buf);
    let sum = 0; for (const x of v.buf) sum += x * x;
    const rms = Math.sqrt(sum / v.buf.length);
    /* The room's own noise, followed slowly: speech stands well above it. */
    v.floor = rms < v.floor ? rms : v.floor * 0.995 + rms * 0.005;
    v.level = Math.min(1, rms * 8);
    if (rms > Math.max(0.01, v.floor * 3)){ v.last = now; if (p) p.speech += 100; }
  }
  if (!v.stopping && p){
    const long = now - p.at, quiet = now - v.last;
    if ((long >= wPiece() && quiet >= WHISPER_PAUSE) || long >= Math.max(WHISPER_LONGEST, wPiece() + 8000)) cutPiece(v);
  }
  /* A mic left on stops after 3 minutes with nothing said; with no way to hear, it runs until Done. */
  if (!v.stopping && v.an && now - v.last > WHISPER_IDLE) stopVoice();
  paintStrip();
}
/** The piece being recorded ends; another starts, unless this is the last. */
function cutPiece(v, last){
  const p = v.cur; if (!p) return;
  if (last) v.cur = null; else piece(v);
  p.seconds = (Date.now() - p.at) / 1000;
  try { p.mr.stop(); } catch { sendPiece(v, p); }
}

/** A piece ended: sent to Whisper, unless no word was said in it. A host that fails is asked twice more. */
async function sendPiece(v, p){
  if (p.state !== "rec") return;
  p.state = "sending"; p.seconds = p.seconds ?? (Date.now() - p.at) / 1000;
  if (v.gone){ p.state = "done"; return; }
  if (p.speech < WHISPER_SPEECH || !p.chunks.length){ p.state = "done"; return showPieces(v); }
  try {
    const blob = new Blob(p.chunks, { type: p.mr.mimeType || v.type || "audio/webm" });
    const audio = await blobBase64(blob);
    for (let i = 0; i < 3; i++){
      if (v.gone) return;
      try {
        const r = await api("/api/voice", { audio, format: typeFormat(blob.type), lang: whisperLang(), seconds: Math.round(p.seconds * 10) / 10 });
        p.text = String(r.text || "").trim(); p.failed = ""; break;
      } catch (e){
        p.failed = /unreadable/.test(e.message) ? WHISPER_OLD : e.message;
        if (/older than this page|refused|out of credit|demo|format/.test(p.failed)) break;
        await new Promise(ok => setTimeout(ok, 700 * (i + 1)));
      }
    }
  } catch (e){ p.failed = e.message; }
  p.state = "done";
  showPieces(v);
}

/** The pieces written so far join the box in the order said; once Done was tapped and the last is in, the mic ends. */
function showPieces(v){
  if (v.gone) return;
  while (v.shown < v.pieces.length && v.pieces[v.shown].state === "done"){
    const p = v.pieces[v.shown++];
    if (p.text) v.kept = [v.kept, p.text].filter(Boolean).join(" ");
  }
  writeVoice(v);
  if (v.stopping && v.shown === v.pieces.length && !v.cur) endWhisper(v);
  else paintStrip();
}
/** Done, and every piece is in: what failed or was never heard is said, the rest stays in the box. */
function endWhisper(v){
  const lost = v.pieces.filter(p => p.failed);
  if (lost.length) v.broke = lost.length === 1 ? `${Math.max(1, Math.round(lost[0].seconds))} seconds could not be written: ${lost[0].failed}`
    : `${lost.length} pieces could not be written: ${lost[0].failed}`;
  else if (!v.kept.trim() && v.pieces.every(p => p.speech < WHISPER_SPEECH)) v.broke = "Nothing was heard. Check the microphone, then tap the mic again.";
  finishVoice(v);
}
/** Done with Whisper: the last piece ends and is written; if the host never answers, what came back is kept after 2 minutes. */
function stopWhisper(v){
  if (v.stopping) return;
  v.stopping = true;
  if (v.cur) cutPiece(v, true);
  else showPieces(v);
  v.end = setTimeout(() => {
    if (rec !== v) return;
    for (const p of v.pieces) if (p.state !== "done"){ p.state = "done"; p.failed = p.failed || "Whisper took too long."; }
    showPieces(v);
  }, 120000);
  paintStrip();
}
/** The mic is let go: the recorder, the microphone and the sound it was measured with. */
function dropWhisper(v){
  v.gone = true;
  try { if (v.cur && v.cur.mr.state !== "inactive") v.cur.mr.stop(); } catch { /* it had stopped */ }
  v.stream?.getTracks().forEach(t => t.stop());
  try { v.ac?.close(); } catch { /* closed already */ }
}
/** How many pieces are still being written. */
const writing = v => v.pieces.filter(p => p.state !== "done").length;
