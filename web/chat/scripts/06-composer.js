/* 06-composer.js: The chat bar: a chat about one concept, @ a folder, the field, and the mic. */

/* ============ a chat about one concept ============ */

/** The folder ticked for a chat about one of its concepts. */
function setScopeFor(slug){ if (isPersonal(slug)){ S.picks = []; S.scope = slug; S.into = []; } else setPicks([slug]); }
/** A concept by its id, as a chat about it names it. */
function aboutOf(id, title){
  const card = S.concepts.find(x => `${x.brain}/${x.slug}` === id), brain = String(id).split("/")[0];
  return { id, title: card?.title || String(title || "").replace(/^About /, "") || id, brain, personal: isPersonal(brain) };
}
/** A new chat that reads one concept alone. In the personal folder, what you tell it changes it. */
function chatAbout(cn){
  newChat();
  S.concept = cn;
  setScopeFor(cn.brain);
  render(); $("input").focus();
}
/** The chip over the field: which concept, and the × that leaves it. */
function paintAbout(about){
  const line = $("aboutLine"); if (!line) return;
  line.hidden = !about;
  if (!about){ line.innerHTML = ""; delete line.dataset.id; return; }
  if (line.dataset.id === about.id) return;
  line.dataset.id = about.id; line.innerHTML = "";
  const x = el("button","ab-x","\u00d7"); x.type = "button"; x.id = "aboutX";
  x.title = "Leave it: a new chat on every folder"; x.setAttribute("aria-label", `Leave the chat about ${about.title}`);
  x.addEventListener("mousedown", e => e.preventDefault());
  x.onclick = () => { newChat(); $("input").focus(); };
  line.append(el("span","ab-k", about.personal ? "Editing" : "About"), el("b",null, about.title), x);
}

/* ============ @ a folder ============
   Typing @ in a message bar lists the folders that chat may read, and a pick writes the folder's name into the message.
   The message goes out with the slugs of the folders it names: the chat reads those, and no other. */
const MAX_TAGS = 4;   // the most folders one message names, as the server holds it
let atMenu = null, atList = [], atAt = 0, atBox = null;
function closeAt(){ atMenu?.remove(); atMenu = null; atList = []; atAt = 0; atBox = null; }
document.addEventListener("pointerdown", e => { if (atMenu && !atMenu.contains(e.target) && e.target !== atBox) closeAt(); }, true);

/** What a chat may be told to read: the folders, and outside the personal chat the assets as well. */
function tagChoices(personal){
  const folders = S.brains.filter(b => b.type !== "personal").map(b => ({ slug: b.slug, name: b.name, tag: "" }));
  /* A category asks all its folders: "@All Wealth". */
  const groups = groupNames().map(g => ({ slug: "group:" + g, name: "All " + g, tag: "category" }));
  /* The assets, beside the folders: a tag reads one, and a chat may propose a change to it. */
  const assets = S.demo || personal ? [] : (S.assets || []).filter(a => a.status === "ready").map(a => ({ slug: "asset:" + a.id, name: a.name, tag: pjNoun(a.kind) }));
  return [...folders, ...groups, ...assets];
}
/** The slugs a message names with @, each once. The longest names are read first, so "@Pricing review" is not taken for "@Pricing". */
function tagsIn(text, choices){
  let rest = String(text ?? ""); const out = [];
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const c of [...choices].sort((a, b) => b.name.length - a.name.length)){
    for (const word of new Set([c.name, c.slug])){
      const re = new RegExp(`(^|[\\s(\\[{"'])@${esc(word)}(?=$|[\\s.,;:!?)\\]}"'])`, "giu");
      if (re.test(rest)){ if (!out.includes(c.slug)) out.push(c.slug); rest = rest.replace(re, "$1 "); }
    }
  }
  return out.slice(0, MAX_TAGS);
}
/** Where each tag sits in a text, as [from, to, kind]: "folder", "group" or "asset". The longest names win, as in tagsIn. */
function tagSpans(text, choices){
  const t = String(text ?? ""), out = [];
  if (!t.includes("@")) return out;
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const c of [...choices].sort((a, b) => b.name.length - a.name.length)){
    const kind = c.slug.startsWith("group:") ? "group" : c.slug.startsWith("asset:") ? "asset" : "folder";
    for (const word of new Set(kind === "folder" ? [c.name, c.slug] : [c.name])){
      const re = new RegExp(`(^|[\\s(\\[{"'])(@${esc(word)})(?=$|[\\s.,;:!?)\\]}"'])`, "giu");
      let m;
      while ((m = re.exec(t))){
        const from = m.index + m[1].length, to = from + m[2].length;
        if (!out.some(x => from < x[1] && to > x[0])) out.push([from, to, kind]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** A text into an element, each tag in it shaded by what it names. */
function paintTags(box, text, choices){
  box.textContent = "";
  let at = 0;
  for (const [from, to, kind] of tagSpans(text, choices)){
    if (from > at) box.append(text.slice(at, from));
    box.append(el("mark", "tag-hl hl-" + kind, text.slice(from, to)));
    at = to;
  }
  box.append(text.slice(at));
}
/**
 * The tags in a message bar shaded as they are typed: a layer under the bar,
 * set in the same type and padding, holds the text with each tag marked, and
 * the bar's own text sits on top of it. It follows the bar's scroll and size.
 */
function attachTagShade(ta, choices){
  const layer = el("div","tag-layer"); layer.setAttribute("aria-hidden","true");
  ta.before(layer);
  ta.classList.add("tag-shaded");
  const copy = ["fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft",
    "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","textIndent","wordSpacing","tabSize"];
  const paint = () => {
    const list = choices(), text = ta.value;
    const any = !!list.length && tagSpans(text, list).length > 0;
    layer.hidden = !any;
    if (!any) return;
    const cs = window.getComputedStyle(ta);
    for (const k of copy) layer.style[k] = cs[k];
    layer.style.left = ta.offsetLeft + "px"; layer.style.top = ta.offsetTop + "px";
    layer.style.width = ta.offsetWidth + "px"; layer.style.height = ta.offsetHeight + "px";
    paintTags(layer, text + "\n", list);
    layer.scrollTop = ta.scrollTop;
  };
  for (const ev of ["input","scroll","focus","blur","keyup"]) ta.addEventListener(ev, paint);
  new ResizeObserver(paint).observe(ta);
  ta.shadeTags = paint;
  return paint;
}
/**
 * A message bar that lists folders when @ is typed. `choices` is read at each keystroke, and returns nothing where this bar
 * takes no tag. Arrows move, Enter or Tab picks, Escape closes.
 */
function attachMentions(ta, choices){
  const plain = t => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  /* The word being typed after an @ at the caret, or nothing. */
  const word = () => {
    if (ta.selectionStart !== ta.selectionEnd) return null;
    const pos = ta.selectionStart, m = /(^|[\s(])@([^@\n]{0,40})$/u.exec(ta.value.slice(0, pos));
    return m ? { from: pos - m[2].length - 1, to: pos, q: plain(m[2]) } : null;
  };
  const choose = c => {
    const w = word(); if (!w){ closeAt(); return; }
    ta.setRangeText(`@${c.name} `, w.from, w.to, "end");
    closeAt(); ta.focus(); ta.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const paint = () => {
    if (!ta.isConnected){ if (atBox === ta) closeAt(); return; }
    const w = word(), all = w ? choices() : [];
    if (!w || !all.length){ if (atBox === ta) closeAt(); return; }
    const named = tagsIn(ta.value, all);
    if (named.length >= MAX_TAGS){ closeAt(); return; }
    const left = all.filter(c => !named.includes(c.slug));
    const first = left.filter(c => plain(c.name).startsWith(w.q));
    const list = [...first, ...left.filter(c => !first.includes(c) && plain(c.name).includes(w.q))].slice(0, 8);
    if (!list.length){ closeAt(); return; }
    if (atBox !== ta) atAt = 0;
    atBox = ta; atList = list; atAt = Math.min(atAt, list.length - 1);
    if (!atMenu){ atMenu = el("div","pick-menu at-menu"); atMenu.setAttribute("role","listbox"); document.body.append(atMenu); }
    atMenu.innerHTML = "";
    list.forEach((c, i) => {
      const b = el("button","pk-row" + (i === atAt ? " on" : "")); b.type = "button"; b.setAttribute("role","option");
      b.append(el("span","pk-nm",c.name)); if (c.tag) b.append(el("span","pk-ct",c.tag));
      /* A press keeps the focus in the field, so the caret stays where the word is. */
      b.onmousedown = e => e.preventDefault();
      b.onclick = () => choose(c);
      atMenu.append(b);
    });
    const r = ta.getBoundingClientRect();
    atMenu.style.left = Math.max(8, Math.min(r.left, innerWidth - 328)) + "px";
    atMenu.style.width = Math.min(320, innerWidth - 16) + "px";
    atMenu.style.bottom = (innerHeight - r.top + 8) + "px";
  };
  ta.addEventListener("input", () => { atAt = 0; paint(); });
  ta.addEventListener("click", paint);
  ta.addEventListener("keyup", e => { if (["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) paint(); });
  ta.addEventListener("blur", () => setTimeout(() => { if (atBox === ta && document.activeElement !== ta) closeAt(); }, 150));
  /* First in line: a key that picks a folder never reaches the bar's own Enter, which sends. */
  ta.addEventListener("keydown", e => {
    if (!atMenu || atBox !== ta || e.isComposing) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      stop(); atAt = (atAt + (e.key === "ArrowDown" ? 1 : atList.length - 1)) % atList.length; paint();
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){
      stop(); choose(atList[atAt]);
    } else if (e.key === "Escape"){ stop(); closeAt(); }
  });
}
/* The main bar: asking, in a folder's chat, in all of them or in the personal one. Not a drop, a chat about one concept or an interview. */
attachMentions($("input"), () => S.mode === "ask" && !S.concept && !S.iv[S.scope]?.on && !dailyToday(S.scope)?.on ? tagChoices(isPersonal(S.scope)) : []);
attachTagShade($("input"), () => S.mode === "ask" && !S.concept && !S.iv[S.scope]?.on && !dailyToday(S.scope)?.on ? tagChoices(isPersonal(S.scope)) : []);

/* ============ input ============ */
function sizeBox(){ const t=$("input"); t.style.height="auto"; t.style.height=Math.min(t.scrollHeight,210)+"px"; }
$("input").addEventListener("input", () => { S.voiceHint = ""; sizeBox(); renderComposer(); });
$("srcInput").addEventListener("input", renderComposer);
$("srcInput").addEventListener("keydown", e => {
  if (e.key === "Enter"){ e.preventDefault(); if (!$("send").disabled) go(); }
});
$("input").addEventListener("keydown", e => {
  if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); if(!$("send").disabled) go(); }
});
$("send").onclick = go;

/* ============ voice ============ */
/* Talk instead of typing. Whisper writes it (06-voice), as long as you talk, in
   any language, unless the workspace picked the browser in Settings. The
   browser's own speech service is free and needs no key: Safari on iPhone, iPad
   and Mac, Chrome and Edge, and the demo listens with it. Where a browser has
   none, the mic says how to dictate with the system's own. */
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
/* The languages the mic offers: code, chip, name. Whisper is told the first two letters, or none with Detect. */
const VOICE_LANGS = [["en-US", "EN", "English"], ["fr-FR", "FR", "French"], ["es-ES", "ES", "Spanish"],
  ["de-DE", "DE", "German"], ["it-IT", "IT", "Italian"], ["pt-PT", "PT", "Portuguese"], ["nl-NL", "NL", "Dutch"], ["pl-PL", "PL", "Polish"],
  ["sv-SE", "SV", "Swedish"], ["da-DK", "DA", "Danish"], ["nb-NO", "NO", "Norwegian"], ["fi-FI", "FI", "Finnish"], ["cs-CZ", "CS", "Czech"],
  ["ro-RO", "RO", "Romanian"], ["el-GR", "EL", "Greek"], ["ru-RU", "RU", "Russian"], ["uk-UA", "UK", "Ukrainian"], ["tr-TR", "TR", "Turkish"],
  ["ar-SA", "AR", "Arabic"], ["he-IL", "HE", "Hebrew"], ["hi-IN", "HI", "Hindi"], ["ja-JP", "JA", "Japanese"], ["ko-KR", "KO", "Korean"],
  ["zh-CN", "ZH", "Chinese"], ["id-ID", "ID", "Indonesian"], ["vi-VN", "VI", "Vietnamese"], ["th-TH", "TH", "Thai"]];
/* var, not let: the shell paints once before this line is reached, and reads them. */
var rec = null, voiceStrip = null;
/* Chrome on Android listens badly in one long run: it hands back every partial of a phrase as a result of its own,
   "my", "my god", "my god is small", and joined they read "mymy godmy god is small". It listens one phrase at a time instead. */
const ANDROID = /Android/i.test(navigator.userAgent);
/* The mic stops after this long with nothing new heard, and a message is never longer than this. */
const VOICE_QUIET = 10000, VOICE_MAX = 120000;
/**
 * What was heard, from the results of one run. A result that is only the start of the one after it is a partial of
 * it and counts for nothing; a word or a short phrase said over and over, 4 times or more, keeps one.
 */
function heard(results){
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();
  const said = [...results].map(x => String(x?.[0]?.transcript ?? "").trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < said.length; i++){
    const next = said[i + 1];
    if (next !== undefined && norm(next).startsWith(norm(said[i]))) continue;
    out.push(said[i]);
  }
  return out.join(" ").replace(/(?<![\p{L}\p{N}])((?:\p{L}+\s+){0,5}\p{L}+)(?:\s+\1(?![\p{L}\p{N}])){3,}/giu, "$1");
}
function systemDictation(){
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/.test(ua)) return "Tap the mic on your keyboard to talk.";
  if (/Mac/.test(ua)) return "No voice input in this browser. Press Fn twice to dictate, or open it in Safari or Chrome.";
  if (/Windows/.test(ua)) return "No voice input in this browser. Press Windows + H to dictate, or open it in Chrome or Edge.";
  return "No voice input in this browser. Open it in Chrome or Safari.";
}
/**
 * The chat bars a mic can be tapped in: where its words go, and how each bar shows what the mic is doing. One mic listens at a
 * time, in the bar it was tapped in, and it stops when that bar goes off screen.
 */
var mainBar = {
  field: () => $("input"),
  host: () => $("input").closest(".box"),
  grew: () => { sizeBox(); renderComposer(); },
  paint: () => { renderMic(); renderComposer(); },
  say: t => { S.voiceHint = t; renderComposer(); },
};
function listeningIn(bar){ return !!S.listening && rec?.bar === bar; }
function renderMic(){
  const m = $("micBtn"), on = listeningIn(mainBar);
  m.classList.toggle("on", on);
  m.setAttribute("aria-pressed", on ? "true" : "false");
  m.setAttribute("aria-label", on ? "Stop talking" : "Talk");
}
/**
 * Talk into a chat bar. While the mic is on, a strip over the bar shows how long it has listened, with Cancel (the box goes back
 * to what was typed) and Done (the last words are waited for, then kept). Each run of the speech service is a fresh one: Android
 * hears one phrase a run, the others run until they stop by themselves, and a run that ends is followed by the next while the mic
 * is on, so a pause never loses what came before. It stops after 10 seconds of quiet or 2 minutes in all, and typing stops it.
 */
function startVoice(bar = mainBar){
  if (micEngine() === "whisper"){
    if (whisperOld()){ bar.say(WHISPER_OLD); bar.field().focus(); return; }
    return startWhisper(bar);
  }
  const field = bar.field();
  if (!Speech){ bar.say(systemDictation()); field.focus(); return; }
  /* No language picked yet, or Detect, which only Whisper can do: Settings opens on it. */
  const lang = voiceLang();
  if (!lang || lang === "auto"){ bar.say("Pick the language the mic listens in, then tap the mic."); openSetupSheet({ voice: true }); return; }
  endVoice();
  const v = { bar, before: field.value, kept: "", live: "", at: Date.now(), last: Date.now(), runs: 0, stopping: false, broke: "", r: null };
  /* A key typed into the box takes over: the mic stops, and the box stays as it is. */
  v.onType = e => { if (e.isTrusted && rec === v) endVoice(); };
  field.addEventListener("input", v.onType);
  rec = v; S.listening = true;
  v.tick = setInterval(() => {
    if (rec !== v){ clearInterval(v.tick); return; }
    const now = Date.now();
    if (!v.stopping && (now - v.last > VOICE_QUIET || now - v.at > VOICE_MAX)) stopVoice();
    paintStrip();
  }, 250);
  if (!listen(v)) return;
  bar.say(""); bar.paint(); paintStrip();
}
/** One run of the speech service, on a recognizer of its own, so a late word from the run before cannot land twice. */
function listen(v){
  const r = new Speech();
  r.lang = voiceLang(); r.interimResults = true; r.continuous = !ANDROID;
  v.r = r; v.live = ""; v.runs++;
  const mine = () => rec === v && v.r === r;
  r.onresult = e => {
    if (!mine()) return;
    const t = heard(e.results);
    if (t && t !== v.live){ v.live = t; v.last = Date.now(); writeVoice(v); }
  };
  r.onerror = e => {
    if (!mine()) return;
    const why = e.error;
    if (why === "no-speech" || why === "aborted") return;
    /* A run after the first that is refused ends quietly: what was heard stays. */
    if (v.runs > 1 && (why === "not-allowed" || why === "service-not-allowed")){ v.stopping = true; return; }
    v.broke = why === "not-allowed" || why === "service-not-allowed" ? "Allow the microphone for this site, then tap the mic again."
      : why === "language-not-supported" ? `This browser cannot listen in ${voiceName()}. Pick another in Settings, Languages, or open it in Chrome.`
      : why === "network" ? "Voice input needs a connection."
      : "Voice input stopped. Tap the mic to try again.";
  };
  r.onend = () => {
    if (!mine()) return;
    keepLive(v);
    const now = Date.now();
    if (!v.stopping && !v.broke && now - v.last <= VOICE_QUIET && now - v.at <= VOICE_MAX && listen(v)) return;
    finishVoice(v);
  };
  try { r.start(); return true; }
  catch { if (v.runs === 1) v.broke = "Voice input stopped. Tap the mic to try again."; finishVoice(v); return false; }
}
/** What was heard so far, after what was typed. */
function writeVoice(v){
  const said = [v.kept, v.live].map(x => x.trim()).filter(Boolean).join(" ");
  const typed = v.before.replace(/\s+$/, "");
  v.bar.field().value = typed && said ? typed + " " + said : typed + said;
  v.bar.grew();
}
/** A run's words join what was kept, once: a run that hands back the words the one before ended on adds nothing. */
function keepLive(v){
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();
  if (v.live && !norm(v.kept).endsWith(norm(v.live))) v.kept = [v.kept, v.live].filter(Boolean).join(" ");
  v.live = "";
}
/** Done: the service is asked to stop and hands back its last words as it ends. If it never ends, what was heard is kept anyway. */
function stopVoice(){
  const v = rec; if (!v) return;
  if (v.whisper) return stopWhisper(v);
  if (v.stopping){ keepLive(v); finishVoice(v); return; }
  v.stopping = true; paintStrip();
  try { v.r.userStopped = true; v.r.stop(); } catch { /* it had stopped already */ }
  v.end = setTimeout(() => { if (rec === v){ keepLive(v); finishVoice(v); } }, 1500);
}
/** Cancel: nothing heard is kept, and the box goes back to what was typed. */
function cancelVoice(){
  const v = rec; if (!v) return;
  quitVoice(v);
  v.bar.field().value = v.before; v.bar.grew();
  v.bar.say(""); v.bar.field().focus();
}
/** The mic has stopped: the words heard stay in the box, written once more as they were kept. */
function finishVoice(v){
  if (rec !== v) return;
  quitVoice(v);
  writeVoice(v);
  v.bar.say(v.broke); v.bar.field().focus();
}
/** The mic stops at once and the box stays as it is: a message was sent, the person typed, or the bar went off screen. */
function endVoice(){ const v = rec; if (v) quitVoice(v); }
function quitVoice(v){
  rec = null; S.listening = false;
  clearInterval(v.tick); clearTimeout(v.end);
  v.bar.field().removeEventListener("input", v.onType);
  if (v.whisper) dropWhisper(v);
  if (v.r){ v.r.userStopped = true; try { v.r.abort ? v.r.abort() : v.r.stop(); } catch { /* it had stopped already */ } }
  paintStrip(); v.bar.paint?.();
}
/** The strip over the bar the mic listens in: what it listens in, for how long, and Cancel and Done. It follows the bar as it moves. */
function paintStrip(){
  const v = rec;
  if (!v){ voiceStrip?.remove(); return; }
  if (!voiceStrip){
    voiceStrip = el("div","vstrip"); voiceStrip.setAttribute("role","status");
    voiceStrip.innerHTML = `<span class="vs-dot" aria-hidden="true"></span><span class="vs-t"></span><span class="vs-time"></span>
      <button class="vs-x" type="button" aria-label="Cancel: keep nothing heard">Cancel</button><button class="vs-ok" type="button">Done</button>`;
    voiceStrip.querySelector(".vs-x").onclick = e => { e.stopPropagation(); cancelVoice(); };
    voiceStrip.querySelector(".vs-ok").onclick = e => { e.stopPropagation(); stopVoice(); };
    voiceStrip.addEventListener("pointerdown", e => e.stopPropagation());
  }
  if (!voiceStrip.isConnected) document.body.append(voiceStrip);
  const s = Math.floor((Date.now() - v.at) / 1000);
  /* The strip names what writes the voice, so the one listening is never in doubt. */
  if (v.whisper){
    const n = writing(v);
    voiceStrip.querySelector(".vs-t").textContent = "Whisper · " + (v.stopping ? (n ? `writing ${n === 1 ? "the last piece" : `${n} pieces`}` : "writing")
      : voiceLang() && voiceLang() !== "auto" ? voiceName() : "any language");
    /* The dot moves with the voice, so you see it hears you. */
    voiceStrip.querySelector(".vs-dot").style.transform = `scale(${(1 + v.level * 1.4).toFixed(2)})`;
  } else voiceStrip.querySelector(".vs-t").textContent = "Browser · " + (v.stopping ? "keeping the last words" : voiceName());
  voiceStrip.querySelector(".vs-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const box = (v.bar.host ? v.bar.host() : v.bar.field().parentElement)?.getBoundingClientRect();
  if (!box) return;
  const w = Math.min(Math.max(box.width, 280), innerWidth - 16, 560), h = voiceStrip.offsetHeight || 48;
  const left = Math.max(8, Math.min(box.left + (box.width - w) / 2, innerWidth - w - 8));
  const top = box.top - h - 8 >= 8 ? box.top - h - 8 : Math.min(box.bottom + 8, innerHeight - h - 8);
  Object.assign(voiceStrip.style, { width: w + "px", left: left + "px", top: top + "px" });
}
/* The language the mic listens in, picked in Settings: the speech service
   hears one language at a time and cannot tell French from English by
   itself, so nothing is guessed. With none picked, the mic asks for one. The
   demo keeps the pick in this browser. */
function voiceLang(){
  const set = S.demo ? localVoice() : S.models?.voice;
  return set === "auto" || VOICE_LANGS.some(x => x[0] === set) ? set : "";
}
function voiceName(){ return voiceLang() === "auto" ? "any language" : (VOICE_LANGS.find(x => x[0] === voiceLang()) || ["", "", ""])[2]; }
function localVoice(){ try { return localStorage.getItem("octopus.voice") || ""; } catch { return ""; } }

/* ---- light or dark ---- */
/** The choice made in Settings: "light", "dark", or "system" to follow the device. */
function themeOf(){ try { const t = localStorage.getItem("octopus.theme"); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } }
/** Whether the page is dark now, by the choice or by the device. */
function isDark(){ const t = themeOf(); return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches); }
function setTheme(t){
  try { t === "system" ? localStorage.removeItem("octopus.theme") : localStorage.setItem("octopus.theme", t); } catch {}
  document.documentElement.dataset.theme = t === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  /* A workspace's own colours are worked out again for the page they now sit on. */
  if (S.brand) applyLook(S.brand, { preview: true });
}
try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themeOf() === "system" && S.brand) applyLook(S.brand, { preview: true }); }); } catch {}
function setLocalVoice(v){ try { localStorage.setItem("octopus.voice", v); } catch { /* kept for this visit only */ } S.models = { ...(S.models || {}), voice: v }; }
$("micBtn").onclick = () => listeningIn(mainBar) ? stopVoice() : startVoice(mainBar);
$("scopeBtn").onclick = e => { e.stopPropagation(); openPick(); };
document.addEventListener("click", e => { if (pickMenu && !pickMenu.contains(e.target)) closePick(); });
document.addEventListener("keydown", e => {
  if (!pickMenu) return;
  if (e.key === "Escape"){ closePick(); $("scopeBtn").focus(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp"){
    const rows = [...pickMenu.querySelectorAll(".pk-row")], at = rows.indexOf(document.activeElement);
    rows[(at + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
    e.preventDefault();
  }
});
window.addEventListener("resize", () => { if (pickMenu) placePick(); });
$("level").onclick = e => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  S.level = b.dataset.v; saveLevel(); renderComposer();
};
$("burger").onclick = () => $("side").classList.toggle("open");
$("scrim").onclick = () => closeSide();
const closeSide = () => $("side").classList.remove("open");
$("newBrain").onclick = () => openSheet("","","subject");
$("groupsBtn").onclick = () => openGroupsSheet();
$("newAsset").onclick = e => { e.stopPropagation(); openAssetAdd(e.currentTarget); };

{
  const wrap = document.querySelector(".composer-wrap");
  wrap.addEventListener("focusin", paintBar);
  /* A beat later, so a click from the box to one of its buttons never folds it. */
  wrap.addEventListener("focusout", () => setTimeout(paintBar, 140));
  /* Folded, the whole pill is the field: a click anywhere on it opens it. */
  wrap.querySelector(".box").addEventListener("mousedown", e => {
    if (!wrap.classList.contains("compact")) return;
    /* Folded, the mic and send act where they are: a press
       that moved the focus would open the bar and slide them out from under
       the finger before the tap landed, and the mic never started. */
    if (e.target.closest("#micBtn, #send")){ e.preventDefault(); return; }
    if (e.target.closest("button, input, textarea")) return;
    e.preventDefault(); $("input").focus();
  });
}
$("freshBtn").onclick = () => { newChat(); $("input").focus(); };
$("startBtn").onclick = () => { closeSide(); newChat(); $("input").focus(); };

$("keyBtn").onclick = openSetupSheet;
/* Drop is a screen of its own, with its own log, on the folders ticked. The
   chat stays as it was, and Back to the chat returns to it. A personal folder
   takes no drop, so Drop leaves it first. */
$("dropBtn").onclick = () => { closeSide(); openDrop(); };
$("pagerSide").onclick = () => openPagerSheet();
$("dropClose").onclick = () => { S.mode = "ask"; render(); $("input").focus(); };
$("sideGo").onclick = () => { closeSide(); $("input").focus(); };
/* The bar floats over the thread, so the thread keeps room under its last line. */
try {
  new ResizeObserver(([e]) => document.querySelector("main").style.setProperty("--bar-h", Math.ceil(e.target.offsetHeight) + "px"))
    .observe(document.querySelector(".composer-wrap"));
} catch {}
$("navToggle").onclick = () => { navOpen = false; paintNav(); };
$("navOpen").onclick  = () => { navOpen = true;  paintNav(); };
paintNav();
$("fileBtn").onclick = () => $("fileIn").click();
$("fileIn").onchange = e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";          // the same file twice still fires
  takeDocument(f);
};
/* Dropping a file on the composer does the same thing, because that is where a
   document goes. */
$("input").addEventListener("dragover", e => { e.preventDefault(); });
$("input").addEventListener("drop", e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  e.preventDefault();
  /* In a personal chat a file is about you: it goes to Add memory. */
  if (S.mode !== "drop" && isPersonal(S.scope) && !S.demo && !S.concept){ openMemorySheet(S.scope, f); return; }
  if (S.mode !== "drop") openDrop();
  takeDocument(f);
});
/* The portable form of the brains: one markdown file, downloaded. */
window.octopusExport = exportAll;

$("lockBtn").onclick = async () => {
  try { await api("/api/lock"); } catch(_){}
  sessionStorage.removeItem(TOKEN_KEY);
  /* Sign out forgets the workspace's own key too, as its button says. */
  try { localStorage.removeItem("octopus.key." + S.space); } catch {}
  location.reload();
};

/**
 * The conflict deck: one open clash at a time, settled with a swipe.
 *
 * Left keeps A, right keeps B, up says both hold, down leaves it for later.
 * The arrow keys and the four buttons do the same. A ruling waits 4 seconds
 * before it is sent, so Undo can take it back; closing the deck sends what is
 * waiting at once. A ruling rewrites the position, which takes a model call,
 * so rewrites run behind the next card. Two rulings on one concept run one
 * after the other, each on the position the one before it wrote.
 */
function openConflictDeck(list, others){
  const UNDO_MS = 4000;
  const brainName = slug => S.brains.find(x => x.slug === slug)?.name || slug;
  const veil = el("div","veil deck-veil");
  veil.innerHTML = `
    <div class="deck" role="dialog" aria-modal="true" aria-label="Open conflicts">
      <header class="dk-h"><b>Open conflicts</b><span class="dk-n" id="dkN"></span>
        <button class="dk-x" id="dkX" aria-label="Close">&times;</button></header>
      <div class="dk-stage" id="dkStage"></div>
      <div class="dk-acts" id="dkActs">
        <button class="ghost" data-p="a">&larr; A holds</button>
        <button class="ghost" data-p="both">&uarr; Both hold</button>
        <button class="ghost" data-p="later">&darr; Later</button>
        <button class="ghost" data-p="b">B holds &rarr;</button>
      </div>
      <div class="dk-foot"><span class="dk-toast" id="dkToast">Swipe toward the side that holds. Up: both hold. Down: later.</span>
        <button class="mini" id="dkUndo" hidden>Undo</button><span class="dk-state" id="dkState"></span></div>
    </div>`;
  document.body.append(veil);
  const $d = id => veil.querySelector("#" + id);
  const stage = $d("dkStage"), toast = $d("dkToast"), undoB = $d("dkUndo"), stateL = $d("dkState");

  let pile = list.slice(), later = [], done = 0, total = list.length;
  let running = 0, card = null, closed = false;
  const waiting = [];            // rulings inside their undo window
  const chains = new Map();      // one rewrite at a time per concept

  const say = (t, bad) => { toast.textContent = t; toast.className = "dk-toast" + (bad ? " bad" : ""); };
  const paintState = () => {
    stateL.textContent = [done ? `${done} settled` : "", running ? `${running} rewriting` : ""].filter(Boolean).join(" \u00b7 ");
  };

  /* ---- sending a ruling ---- */
  const send = r => {
    running++; paintState();
    const prev = chains.get(r.c.id) || Promise.resolve();
    const next = prev.then(async () => {
      try {
        const x = await api("/api/conflicts/settle", { id: r.c.id, a: r.c.a, b: r.c.b, pick: r.pick });
        if (x.error || x.ok === false) throw new Error(x.error || x.why);
        done++;
      } catch (e) {
        /* Back in the pile, so a failed ruling is never lost. */
        pile.push(r.c); total++;
        if (!closed){ say(`Not settled: ${e.message}. "${r.c.title}" is back in the pile.`, true); if (!card) show(); }
      } finally { running--; paintState(); if (!closed && !card && !pile.length) show(); }
    });
    chains.set(r.c.id, next);
  };
  const flush = () => { while (waiting.length){ const r = waiting.shift(); clearTimeout(r.t); send(r); } undoB.hidden = true; };

  const LABEL = { a: "A holds", b: "B holds", both: "Both hold", later: "Later" };
  const rule = pick => {
    if (!card) return;
    const c = pile.shift();
    fly(pick);
    if (pick === "later"){
      later.push(c);
      say(`"${c.title}" is left for later.`);
    } else {
      const r = { c, pick };
      r.t = setTimeout(() => {
        const i = waiting.indexOf(r); if (i < 0) return;
        waiting.splice(i, 1); send(r);
        if (!waiting.length) undoB.hidden = true;
      }, UNDO_MS);
      waiting.push(r);
      say(`${LABEL[pick]}: ${c.title}.`);
      undoB.hidden = false;
    }
    setTimeout(show, 180);
  };
  undoB.onclick = () => {
    const r = waiting.pop(); if (!r) return;
    clearTimeout(r.t);
    pile.unshift(r.c);
    if (card){ card.remove(); card = null; }
    undoB.hidden = !waiting.length;
    say(`Taken back: ${r.c.title}.`);
    show();
  };

  /* ---- the card ---- */
  const fly = pick => {
    if (!card) return;
    const c = card; card = null;
    c.classList.add("gone");
    const [x, y] = { a: [-1, 0], b: [1, 0], both: [0, -1], later: [0, 1] }[pick];
    c.style.transform = `translate(${x * 120}%, ${y * 120}%) rotate(${x * 14}deg)`;
    c.style.opacity = "0";
    setTimeout(() => c.remove(), 260);
  };
  const show = () => {
    if (closed) return;
    stage.querySelectorAll(".dk-card:not(.gone), .dk-done").forEach(n => { if (n !== card) n.remove(); });
    if (card) return;
    const c = pile[0];
    $d("dkActs").hidden = !c;
    $d("dkN").textContent = c ? `${total - pile.length - later.length + 1} of ${total}` : "";
    if (!c){
      const end = el("div","dk-done");
      end.append(el("b",null, running ? "Rewriting the last ones" : later.length ? "The rest is for later" : "All settled"));
      end.append(el("p",null, [done ? `${done} settled.` : "", running ? `${running} still rewriting: they finish on their own.` : "",
        later.length ? `${later.length} left for later.` : "", others ? `${others} more add detail rather than contradict.` : ""].filter(Boolean).join(" ")));
      if (later.length){
        const again = el("button","go", `Go through the ${later.length} again`);
        again.id = "dkAgain";
        again.onclick = () => { pile = later; later = []; total = pile.length; show(); };
        end.append(again);
      }
      const close = el("button","ghost","Close"); close.style.marginLeft = "8px";
      close.onclick = shut;
      end.append(close);
      stage.append(end);
      return;
    }
    const n = el("div","dk-card");
    n.innerHTML = `<span class="dk-brain">${esc(brainName(c.brain))}</span><h4>${esc(c.title)}</h4>
      <div class="dk-sides">
        <div class="dk-side" data-s="a"><span class="dk-tag">&larr; A</span><p>${esc(c.a)}</p><time>${esc(c.aDate || "undated")}</time></div>
        <div class="dk-side" data-s="b"><span class="dk-tag">B &rarr;</span><p>${esc(c.b)}</p><time>${esc(c.bDate || "undated")}</time></div>
      </div>
      ${c.why ? `<div class="dk-why">They differ because ${esc(c.why.replace(/^[A-Z]/, m => m.toLowerCase()))}</div>` : ""}
      ${c.hint ? `<div class="dk-hint">Suggested: ${esc(LABEL[c.hint.pick] || c.hint.pick)}${c.hint.why ? `. ${esc(c.hint.why)}` : ""}</div>` : ""}
      <div class="dk-stamp"></div>`;
    drag(n);
    stage.append(n); card = n;
  };

  /* ---- the swipe ---- */
  const intent = (dx, dy) => Math.abs(dx) > Math.abs(dy)
    ? (dx < -30 ? "a" : dx > 30 ? "b" : "")
    : (dy < -30 ? "both" : dy > 30 ? "later" : "");
  const drag = n => {
    let x0 = 0, y0 = 0, on = false;
    const lit = p => {
      n.querySelectorAll(".dk-side").forEach(s => s.classList.toggle("lit", s.dataset.s === p || p === "both"));
      const st = n.querySelector(".dk-stamp");
      st.textContent = p ? LABEL[p] : ""; st.style.opacity = p ? "1" : "0";
    };
    n.addEventListener("pointerdown", e => {
      if (e.button) return;
      on = true; x0 = e.clientX; y0 = e.clientY;
      n.setPointerCapture(e.pointerId); n.classList.add("drag");
    });
    n.addEventListener("pointermove", e => {
      if (!on) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      n.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)`;
      lit(intent(dx, dy));
    });
    const end = e => {
      if (!on) return;
      on = false; n.classList.remove("drag");
      const dx = e.clientX - x0, dy = e.clientY - y0, p = intent(dx, dy);
      const far = Math.abs(dx) > 90 || Math.abs(dy) > 80;
      if (p && far && card === n) rule(p);
      else { n.style.transform = ""; lit(""); }
    };
    n.addEventListener("pointerup", end);
    n.addEventListener("pointercancel", end);
  };

  /* ---- keys, buttons, closing ---- */
  $d("dkActs").onclick = e => { const b = e.target.closest("button[data-p]"); if (b) rule(b.dataset.p); };
  const KEYS = { ArrowLeft: "a", ArrowRight: "b", ArrowUp: "both", ArrowDown: "later" };
  const onKey = e => {
    if (e.key === "Escape"){ shut(); return; }
    if ((e.key === "z" || e.key === "Z") && !undoB.hidden){ undoB.click(); return; }
    if (KEYS[e.key]){ e.preventDefault(); rule(KEYS[e.key]); }
  };
  function shut(){
    if (closed) return;
    flush(); closed = true;
    document.removeEventListener("keydown", onKey);
    veil.remove();
    Promise.all([...chains.values()]).then(() => { if (done) refresh(); });
  }
  document.addEventListener("keydown", onKey);
  $d("dkX").onclick = shut;
  paintState(); show();
}

