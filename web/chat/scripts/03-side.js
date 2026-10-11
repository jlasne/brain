/* 03-side.js: A workspace's look, and the side panel: folders, chats, health rings, the folder picker. */

/* ============ a workspace's own look ============ */
/**
 * A logo and two colours, set in Setup. The accent paints what the brand
 * colour paints; its text and button shades are derived from it, darkened
 * toward the night navy until they read at 4.5:1. The page colour is kept
 * light, so every text colour on it still reads.
 */
const LOOK_VARS = ["--bg", "--surface-2", "--surface-3", "--line", "--line-2", "--accent", "--accent-fill", "--accent-solid",
  "--accent-on", "--accent-soft", "--accent-line", "--mark"];
const NAVY = [5, 11, 22], WHITE = [255, 255, 255];
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const cssRgb = t => { const m = String(t).match(/\d+(\.\d+)?/g); return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
const toRgb = t => /^\s*#[0-9a-f]{6}\s*$/i.test(t) ? hexRgb(t.trim()) : cssRgb(t);
const luma = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function darkenTo(c, on, want){ let x = c; for (let t = .04; t <= 1 && ratio(x, on) < want; t += .04) x = mixRgb(c, NAVY, t); return x; }
function lightenTo(c, min){ let x = c; for (let t = .02; t <= 1 && luma(x) < min; t += .02) x = mixRgb(c, WHITE, t); return x; }

/** The CSS variables a look sets, measured against the page it lands on. */
function lookVars(look){
  const v = {};
  if (!look) return v;
  const page = look.bg ? lightenTo(hexRgb(look.bg), .78)
    : toRgb(getComputedStyle(document.documentElement).getPropertyValue("--bg")) || [245, 245, 245];
  const side = mixRgb(page, NAVY, .06);
  if (look.bg) Object.assign(v, { "--bg": rgbHex(page), "--surface-2": rgbHex(side), "--surface-3": rgbHex(mixRgb(page, NAVY, .11)),
    "--line": rgbHex(mixRgb(page, NAVY, .09)), "--line-2": rgbHex(mixRgb(page, NAVY, .19)) });
  if (look.accent) {
    const a = hexRgb(look.accent);
    Object.assign(v, { "--accent-fill": rgbHex(a), "--accent-solid": rgbHex(darkenTo(a, WHITE, 4.5)), "--accent-on": "#ffffff",
      "--accent": rgbHex(darkenTo(a, side, 4.5)), "--accent-soft": `rgba(${a.join(",")},.12)`, "--accent-line": `rgba(${a.join(",")},.40)` });
  }
  if (look.logo) v["--mark"] = `url("${look.logo}")`;
  return v;
}

/**
 * Wear a look, or the workspace's default with none. A preview is not kept;
 * a saved look is remembered in this browser, so the next visit paints in it.
 */
function applyLook(look, opts = {}){
  const root = document.documentElement;
  for (const k of LOOK_VARS) root.style.removeProperty(k);
  if (!opts.preview) S.brand = look || null;
  const vars = lookVars(look);
  /* In the dark a look keeps its accent and its logo: its page colours are for a light page, and its accent reads as itself. */
  const worn = isDark() ? Object.fromEntries(Object.entries(vars).filter(([k]) => !["--bg", "--surface-2", "--surface-3", "--line", "--line-2", "--accent"].includes(k))) : vars;
  if (isDark() && vars["--accent-fill"]) worn["--accent"] = vars["--accent-fill"];
  for (const [k, val] of Object.entries(worn)) root.style.setProperty(k, val);
  root.dataset.logo = look?.logo ? "1" : "";
  S.logo = look?.logo || null;
  if (!opts.preview) {
    try { Object.keys(vars).length ? localStorage.setItem("octopus.look." + S.space, JSON.stringify(vars)) : localStorage.removeItem("octopus.look." + S.space); } catch {}
  }
  paintSpace();
  renderZero();
}

/** A picked file, drawn onto 128 pixels a side and kept as a PNG. */
async function toLogo(file){
  if (!file) throw new Error("No file was picked.");
  if (file.size > 5e6) throw new Error("That image is over 5 MB. Pick a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That file is not an image this browser can read.")); i.src = url; });
    const side = 128, c = document.createElement("canvas");
    c.width = c.height = side;
    const w0 = img.naturalWidth || side, h0 = img.naturalHeight || side, k = Math.min(side / w0, side / h0);
    c.getContext("2d").drawImage(img, (side - w0 * k) / 2, (side - h0 * k) / 2, w0 * k, h0 * k);
    const out = c.toDataURL("image/png");
    if (out.length > 200000) throw new Error("That logo holds too much detail to keep. Try a simpler one.");
    return out;
  } finally { URL.revokeObjectURL(url); }
}

/** The workspace's mark: its own logo, the octopus, the dog's head, or Tasu's folder. */
function markOf(){
  if (S.logo) return S.logo;
  return S.space === "octopus" ? "/brand/logo-mark.png" : S.space === "squidgy" ? "/brand/squidgy-icon.png" : "/brand/tasu.svg";
}

function paintSpace(){
  document.documentElement.dataset.space = S.space;
  try { sessionStorage.setItem(SPACE_KEY, S.space); } catch {}
  if (INSTALLED) try { localStorage.setItem("octopus.app.space", S.space); } catch {}
  document.title = S.spaceName;
  $("spaceName").textContent = S.spaceName;
  $("spaceNameBar").textContent = S.spaceName;
  /* The header box is square, and a whole dachshund at 24 pixels is a smudge,
     so Squidgy shows its head there and in the tab. */
  const want = markOf();
  if ($("spaceMark").getAttribute("src") === want) return;
  const probe = new Image();
  probe.onload = () => {
    for (const id of ["spaceMark", "spaceMarkBar", "scopeMark", "gateMark"]) { const m = $(id); if (m) m.src = want; }
    const tab = document.querySelector('link[rel="icon"]');
    if (tab) tab.href = want;
  };
  probe.src = want;
}

/**
 * The brains, grouped and ranked.
 *
 * A person and a subject are different questions, so they sit apart. Inside a
 * group the fullest brain leads, counted by positions first and sources second,
 * because that is the one worth opening. Creation order said nothing about
 * which brain you want.
 */
const weight = b => conceptsOf(b.slug).length * 1000 + sourcesOf(b.slug).length;
function grouped(){
  const of = t => ordered().filter(b => b.type !== "personal" && (b.type === "person" ? "person" : "subject") === t);
  return [{ head: "People", rows: of("person") }, { head: "Subjects", rows: of("subject") }]
    .filter(g => g.rows.length);
}
/** Every brain in one list, the fullest first. An icon tells a person from a subject. */
/* Personal brains lead: they are yours, and the list's first stop. */
const ordered = () => [...S.brains].sort((x, y) => (y.type === "personal") - (x.type === "personal") || weight(y) - weight(x) || x.name.localeCompare(y.name));
const BRAIN_ICON = {
  personal: `<svg class="b-ic" viewBox="0 0 24 24" role="img" aria-label="Personal"><title>Personal</title><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
  person: `<svg class="b-ic" viewBox="0 0 24 24" role="img" aria-label="Person"><title>Person</title><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/></svg>`,
  subject: `<svg class="b-ic" viewBox="0 0 24 24" role="img" aria-label="Subject"><title>Subject</title><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/></svg>`,
};
const brainIcon = b => { const w = el("span","b-ico"); w.innerHTML = BRAIN_ICON[b.type === "person" || b.type === "personal" ? b.type : "subject"]; return w.firstChild; };
/* A personal brain: a chat that files what its owner says. Only its own chat reads it. */
function isPersonal(slug){ return S.brains.find(b => b.slug === slug)?.type === "personal"; }
/** A brain shared into this workspace to be read, never fed: the demo's view of one. */
function readOnly(b){ return !!b && (b.viewers || []).includes(S.space); }
/* Into a personal chat or out of one, the thread starts fresh: the two never share a chat. */
function crossing(to){ if ((S.chatId || chatBusy()) && isPersonal(to) !== isPersonal(S.scope)) newChat(); }
/**
 * The folders ticked to chat in. None asks them all, one reads as that
 * folder, and two or more travel as a list. A drop feeds the ones it may.
 */
function setPicks(list){
  const ok = new Set(S.brains.filter(b => b.type !== "personal").map(b => b.slug));
  S.picks = [...new Set(list)].filter(x => ok.has(x));
  S.scope = S.picks.length === 1 ? S.picks[0] : "all";
  S.into = S.picks.filter(x => !readOnly(S.brains.find(b => b.slug === x)));
}
/** The ticked folders by name: "Wealth and Charles Gave", or "4 folders" past three. */
function picksName(){
  const n = S.picks.map(x => S.brains.find(b => b.slug === x)?.name || x);
  return n.length > 3 ? `${n.length} folders` : n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0] || "";
}
const shared = () => S.brains.filter(b => b.type !== "personal");

/* Clicking a row ticks that folder to chat in, and several can be ticked: the
   question reads those alone. A second click unticks it. A personal folder is
   a chat of its own, so its row opens that chat. Open and edit sit on the row
   you point at. */
const TICK_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5"/></svg>`;
function brainRow(b){
  const self = b.type === "personal";
  const on = self ? S.scope === b.slug : S.picks.includes(b.slug);
  const home = b.space || "octopus", label = x => x.charAt(0).toUpperCase() + x.slice(1);
  const out = [...(b.shared || []), ...(b.viewers || [])].map(label), from = home !== S.space ? label(home) : "";
  /* A row that holds two buttons of its own (its health and open) cannot be a button itself: it is one to the keyboard and to a
     screen reader, and Enter or Space ticks it. */
  const row = el("div","brain-row" + (on ? " on" : "") + (self ? " self" : "") + (out.length || from ? " shared" : ""));
  row.setAttribute("role","button"); row.tabIndex = 0;
  if (!self) row.setAttribute("aria-pressed", String(on));
  row.onkeydown = e => { if (e.target === row && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); row.click(); } };
  const ideas = conceptsOf(b.slug).length, read = sourcesOf(b.slug).length;
  /* The score stands for what the brain holds, so the row shows the ring and
     leaves the counts to its title. */
  const tick = el("span","tick");
  tick.append(brainIcon(b));
  if (!self){ const box = el("span","tbox"); box.innerHTML = TICK_SVG; tick.append(box); }
  row.append(tick, el("span","nm",b.name));
  if (readOnly(b)) row.append(el("span","ro-tag","Ask only"));
  row.append(el("span","cnt", self ? "" : String(ideas)));
  const h = S.health[b.slug];
  if (h) row.append(healthRing(h, b));
  row.title = b.type === "personal" ? `Personal, alpha: it files what you say in its chat, dated. Only that chat reads it.\n${ideas} notes`
    : `${b.scope || "no scope line"}\n${ideas} concepts, ${read} sources` +
      (from ? `\nShared with this workspace from ${from}${readOnly(b) ? ". Read only here" : ""}` : out.length ? `\nShared with ${out.join(", ")}` : "");
  row.onclick = () => {
    if (S.concept) newChat();
    if (self){
      crossing(on ? "all" : b.slug);
      if (on) setPicks([]); else { S.picks = []; S.scope = b.slug; S.into = []; }
      /* A personal chat is one folder, so on a phone the drawer closes on it. */
      if (!on) closeSide();
    } else {
      crossing("all");
      setPicks(on ? S.picks.filter(x => x !== b.slug) : [...S.picks, b.slug]);
    }
    /* A tick is for chatting, so an open folder gives way to the chat. */
    S.folder = null;
    render();
  };
  /* One control on the row, so a click anywhere else ticks it. Its name and
     scope are edited from the folder it opens. */
  const op = el("button","ed op","open");
  op.type = "button"; op.title = "See what this folder holds"; op.setAttribute("aria-label", `Open ${b.name}`);
  op.onclick = e => { e.stopPropagation(); openFolder(b); };
  row.append(op);
  return row;
}

/* ---- which workspace this is ---- */

/** The owner's two workspaces: the only ones with mail, the connector and transcripts to spare. */
function ownerWs(){ return !S.demo && !S.byok && (S.space === "octopus" || S.space === "squidgy"); }
/** A workspace's own key lives in this browser only, one per workspace. */
function myKey(){ try { return localStorage.getItem("octopus.key." + S.space) || ""; } catch { return ""; } }
function setMyKey(k){ try { localStorage.setItem("octopus.key." + S.space, k); } catch {} }

/**
 * What changes with the workspace: the demo says what it is and keeps its
 * brains' shape as it is; a workspace on its own key asks for the key once.
 */
let keyAsked = false;
function paintWorkspace(){
  document.documentElement.dataset.demo = S.demo ? "1" : "";
  $("newBrain").hidden = S.demo;
  $("demoBar").hidden = !S.demo;
  if (S.byok && !myKey() && !keyAsked){ keyAsked = true; setTimeout(openSetupSheet, 300); }
}

/* ---- the two folding groups ---- */
/* Read on first use: the sidebar can paint before this part of the script has run. */
function folds(){
  if (!folds.v){ try { folds.v = JSON.parse(localStorage.getItem("octopus.fold") || "{}") || {}; } catch { folds.v = {}; } }
  return folds.v;
}
function paintFolds(){
  for (const k of ["chats","projects","brains"]){
    const shut = !!folds()[k];
    $(k + "Fold").setAttribute("aria-expanded", String(!shut));
    $(k + "Box").hidden = shut;
  }
}
for (const k of ["chats","projects","brains"]) $(k + "Fold").onclick = () => {
  folds()[k] = !$(k + "Box").hidden;
  try { localStorage.setItem("octopus.fold", JSON.stringify(folds())); } catch {}
  paintFolds();
};

/* ---- chats ---- */
/* A chat asked one folder, several joined by commas, or all of them. */
function brainLabel(slug){
  if (!slug || slug === "all") return "All folders";
  return String(slug).split(",").map(x => S.brains.find(b => b.slug === x)?.name || x).join(", ");
}
var chatMsgTimer = 0;
function chatMsg(t){
  const m = $("chatMsg"); m.textContent = t; m.hidden = !t;
  clearTimeout(chatMsgTimer);
  if (t) chatMsgTimer = setTimeout(() => { m.hidden = true; }, 5000);
}
const PIN_SVG = `<svg class="pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4.5-4.5L3 22l-1-1 5.5-5.5L3 11l2-2 5 1 4-4z"/></svg>`;

function chatRow(c){
  const on = S.chatId === c.id;
  const row = el("div","chat-row" + (on ? " on" : "") + (c.pinned ? " pinned" : ""));
  row.tabIndex = 0; row.setAttribute("role","button");
  if (c.pinned){ const p = el("span"); p.innerHTML = PIN_SVG; row.append(p.firstChild); }
  const main = el("span","cm");
  main.append(el("span","nm",c.title));
  row.append(main);
  const job = S.jobs.find(j => j.key === c.id && (j.status === "running" || !j.seen));
  if (job){ const d = el("span","cr-dot" + (job.status === "running" ? " run" : "")); d.title = job.status === "running" ? "On its way" : "Answer unread"; row.append(d); }
  /* The pointer shows what it asked and how often. */
  row.title = `${c.title}\n${c.concept ? "About one concept" : brainLabel(c.brain)} \u00b7 ${c.turns} question${c.turns === 1 ? "" : "s"}`;
  /* The chat already current still has to bring its screen back when a project, a folder or Drop is on top of it. */
  const open = () => {
    if (S.chatId !== c.id) openChat(c.id);
    else if (S.project || S.folder || S.mode === "drop"){ S.folder = null; S.mode = "ask"; render(); closeSide(); }
    else closeSide();
  };
  row.onclick = open;
  row.onkeydown = e => { if (e.key === "Enter" && e.target === row) open(); };

  const more = el("button","more","\u22ef");
  more.title = "Pin, rename or delete"; more.setAttribute("aria-label", `Pin, rename or delete "${c.title}"`);
  more.setAttribute("aria-haspopup","menu"); more.setAttribute("aria-expanded","false");
  more.onclick = e => { e.stopPropagation(); chatMenu ? closeChatMenu() : openChatMenu(c, more); };
  row.append(more);
  return row;
}

/**
 * The menu behind a chat's one button: pin or unpin, rename, delete. Delete
 * asks once more in the menu itself, then goes.
 */
var chatMenu = null;
function closeChatMenu(){
  if (!chatMenu) return;
  chatMenu.anchor.setAttribute("aria-expanded","false");
  document.removeEventListener("pointerdown", chatMenu.outside, true);
  document.removeEventListener("keydown", chatMenu.key, true);
  chatMenu.box.remove(); chatMenu = null;
}
/** A menu under its button, kept on screen, closed by a click outside or Escape. */
function placeMenu(box, anchor){
  document.body.append(box);
  const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  box.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
  const outside = e => { if (!box.contains(e.target) && e.target !== anchor) closeChatMenu(); };
  const key = e => { if (e.key === "Escape"){ e.stopPropagation(); closeChatMenu(); anchor.focus(); } };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", key, true);
  anchor.setAttribute("aria-expanded","true");
  chatMenu = { box, anchor, outside, key };
  box.querySelector(".cm-it").focus();
}
function openChatMenu(c, anchor){
  closeChatMenu();
  const box = el("div","chat-menu"); box.setAttribute("role","menu");
  const item = (label, cls, fn) => {
    const b = el("button","cm-it" + (cls ? " " + cls : ""), label);
    b.setAttribute("role","menuitem");
    b.onclick = e => { e.stopPropagation(); fn(b); };
    box.append(b); return b;
  };
  item(c.pinned ? "Unpin" : "Pin", "", async () => {
    closeChatMenu();
    try {
      const r = await api("/api/chats/edit", { id: c.id, pinned: !c.pinned });
      if (r.error) throw new Error(r.error);
      loadChats();
    } catch (e) { chatMsg(e.message); }
  });
  item("Rename", "", () => { closeChatMenu(); renameChat(c); });
  item("Delete", "del", async b => {
    if (!b.classList.contains("sure")){ b.classList.add("sure"); b.textContent = "Sure? Delete"; return; }
    closeChatMenu();
    try {
      const r = await api("/api/chats/edit", { id: c.id, remove: true });
      if (r.error) throw new Error(r.error);
      if (S.chatId === c.id) newChat();
      loadChats();
    } catch (e) { chatMsg(e.message); }
  });
  placeMenu(box, anchor);
}

/* Five chats show, so the folders stay in view on a laptop; the one open always shows, and the rest are one tap away. */
const CHATS_SHOWN = 5;
function renderChats(){
  closeChatMenu();
  const box = $("chats"); box.innerHTML = "";
  $("ccount").textContent = S.chats.length || "";
  if (!S.chats.length){ box.append(el("div","empty-side","No chat")); return; }
  /* One more than five shows whole: a See all for a single chat saves nothing. */
  const all = !!S.chatsAll || S.chats.length <= CHATS_SHOWN + 1;
  for (const c of all ? S.chats : S.chats.filter((c, i) => i < CHATS_SHOWN || c.id === S.chatId)) box.append(chatRow(c));
  if (S.chats.length > CHATS_SHOWN + 1){
    const more = el("button","side-more", all ? "Show fewer" : `See all ${S.chats.length}`); more.type = "button";
    more.setAttribute("aria-expanded", String(all));
    more.onclick = () => { S.chatsAll = !all; renderChats(); };
    box.append(more);
  }
}

/** A clean screen, and the next question starts a new chat. */
function newChat(){
  S.thread = []; S.chatId = null; S.mode = "ask"; S.folder = null; S.concept = null;
  /* A question still on its way in the chat left behind lands there, unread. */
  S.draft = "d" + (++draftSeq);
  $("thread").innerHTML = "";
  render(); renderChats();
}
var draftSeq = 0;

/** A saved chat back on screen, ready to continue on the brain it asked. */
async function openChat(id){
  closeSide();
  let c;
  try { c = (await api("/api/chats/get", { id })).chat; }
  catch (e) { chatMsg(e.message); loadChats(); return; }
  if (!c) return;
  S.chatId = c.id;
  const asked = String(c.brain || "").split(",").filter(x => S.brains.some(b => b.slug === x));
  if (asked.length === 1 && isPersonal(asked[0])){ S.picks = []; S.scope = asked[0]; S.into = []; }
  else setPicks(asked);
  S.mode = "ask"; S.folder = null;
  /* A chat about one concept reads that concept again. */
  S.concept = c.concept ? aboutOf(c.concept, c.title) : null;
  $("thread").innerHTML = "";
  for (const t of c.turns || []){
    /* An interview opens on its question: that turn has no message before it. */
    if (t.q) says(t.q);
    push("ai", body => showAnswer(body, t, t.q, t.concept ? t.concept.split("/")[0] : asked.join(",") || "all"));
  }
  S.thread = (c.turns || []).slice(-6).map(t => ({ q: t.q, a: String(t.a ?? ""), ...(Array.isArray(t.opened) && t.opened.length ? { opened: t.opened } : {}) }));
  /* A question still on its way here gets its waiting line back, and lands in it. */
  for (const j of S.jobs) if (j.status === "running" && j.key === c.id){ if (j.q) says(j.q); j.body = thinking(j.label); }
  render(); renderChats(); bottom();
}

function renameChat(c){
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>Rename the chat</h3></header>
      <div class="f"><label for="rnT">Name</label><input id="rnT" class="pick" maxlength="80"></div>
      <div class="f"><div id="rnMsg" class="bad" role="alert"></div></div>
      <footer><button class="ghost" id="rnNo">Cancel</button><button class="go" id="rnGo">Save</button></footer>
    </div>`;
  document.body.append(veil);
  const t = veil.querySelector("#rnT"); t.value = c.title; t.focus(); t.select();
  const shut = () => veil.remove();
  veil.querySelector("#rnNo").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  const save = async () => {
    const title = t.value.trim();
    if (!title){ t.focus(); return; }
    try {
      const r = await api("/api/chats/edit", { id: c.id, title });
      if (r.error) throw new Error(r.error);
      shut(); loadChats();
    } catch (e) { veil.querySelector("#rnMsg").textContent = e.message; }
  };
  veil.querySelector("#rnGo").onclick = save;
  t.onkeydown = e => { if (e.key === "Enter") save(); if (e.key === "Escape") shut(); };
}

/* ---- health ---- */
function healthTone(x){ return x >= 7 ? "h-hi" : x >= 4 ? "h-mid" : "h-lo"; }
function fmtScore(x){ return Number.isInteger(x) ? String(x) : x.toFixed(1); }
/** The ring on a brain row: it fills with the score, and opens the breakdown. */
/** The ring, as a button of its own; `alone` false gives the ring alone, for a button that already holds it. */
function healthRing(h, b, alone = true){
  const r = el(alone ? "button" : "span","hring"); if (alone) r.type = "button";
  const C = 2 * Math.PI * 9, fill = Math.max(0, Math.min(1, h.score / 10)) * C;
  r.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="tr" cx="12" cy="12" r="9"/>
    <circle class="ar ${healthTone(h.score)}" cx="12" cy="12" r="9" stroke-dasharray="${fill.toFixed(2)} ${C.toFixed(2)}"/>
    <text x="12" y="12.4">${fmtScore(h.score)}</text></svg>`;
  r.title = `Health ${fmtScore(h.score)}/10 against the best folder. ${h.best}`;
  r.setAttribute("aria-label", `Health of ${b.name}: ${fmtScore(h.score)} out of 10`);
  if (alone) r.onclick = e => { e.stopPropagation(); openHealthSheet(b); };
  return r;
}

/**
 * The four parts of a brain's score, each against the best brain on it, and
 * the move that closes the widest gap.
 */
function openHealthSheet(b){
  const h = S.health[b.slug]; if (!h) return;
  closeSide();
  const veil = el("div","veil");
  const NAMES = { variety: "Variety", depth: "Depth", fresh: "Freshness", conflicts: "Conflicts", tidy: "Tidiness" };
  const messy = !!h.parts.tidy && /to tidy/.test(h.parts.tidy.say);
  const lead = Object.values(S.health).find(x => x.top);
  const leadName = lead ? (S.brains.find(x => x.slug === lead.slug)?.name || lead.slug) : "";
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>${esc(b.name)}: ${fmtScore(h.score)}/10</h3>
        <p>${h.top ? "The best folder here. Every other score is measured against it."
                   : `Measured against the best folder${leadName ? `, ${esc(leadName)},` : ""} which reads 10.`}</p></header>
      <div class="f" id="hbParts"></div>
      <div class="f"><div class="hb-best"><b>Best move</b>${esc(h.best)}</div></div>
      <footer>${h.open ? `<button class="ghost" id="hbSettle">Settle conflicts</button>` : ""}${messy && !S.demo ? `<button class="ghost" id="hbTidy">Tidy it</button>` : ""}<button class="ghost" id="hbOpen">Open the folder</button><button class="go" id="hbDone">Done</button></footer>
    </div>`;
  document.body.append(veil);
  const parts = veil.querySelector("#hbParts");
  for (const k of ["variety","depth","fresh","conflicts","tidy"]){
    const p = h.parts[k]; if (!p) continue;
    const row = el("div","hb-row");
    row.innerHTML = p.counted
      ? `<div class="hb-top">${NAMES[k]}<span>${p.pct}% of the best</span></div>
         <div class="hb-bar"><i class="${healthTone(p.pct / 10)}" style="width:${p.pct}%"></i></div>
         <div class="hb-say">${esc(p.say)}</div>`
      : `<div class="hb-top">${NAMES[k]}<span>not counted</span></div><div class="hb-say">${esc(p.say)}</div>`;
    parts.append(row);
  }
  const shut = () => { veil.remove(); };
  veil.querySelector("#hbDone").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  veil.querySelector("#hbOpen").onclick = () => { shut(); openFolder(b); };
  const st = veil.querySelector("#hbSettle");
  if (st) st.onclick = () => { shut(); settleFrom(null, b.slug); };
  const td = veil.querySelector("#hbTidy");
  if (td) td.onclick = () => { shut(); runAudit(b); };
}

/**
 * The conflict deck, opened from a health sheet or the Decisions: this concept's
 * clashes first, or this brain's.
 */
async function settleFrom(id, brain){
  let r;
  try { r = await api("/api/conflicts", {}); } catch (e) { chatMsg(e.message); return; }
  const list = (r.conflicts || []).slice();
  const rank = c => (id && c.id === id) ? 2 : (brain && c.brain === brain) ? 1 : 0;
  list.sort((x, y) => rank(y) - rank(x));
  if (!list.length){ loadHealth(); return; }
  openConflictDeck(list, r.others || 0);
}

/**
 * Every folder, in three groups: this workspace's own, then the ones another
 * workspace lets you ask and drop into, then the ones you may only ask. A
 * group shows when it holds a folder, and the fullest folder leads each.
 */
function renderSide(){
  paintFolds();
  const box = $("brains"); box.innerHTML = "";
  $("bcount").textContent = S.brains.length || "";
  if (!S.brains.length){
    box.append(el("div","empty-side","None yet. A folder holds one subject or one person's view, with a one line scope."));
  } else {
    /* By type, then the fullest first: what you said, the people, the
       subjects. A folder shared in, or one only asked, says so on its row. */
    const kind = b => b.type === "personal" ? "personal" : b.type === "person" ? "person" : "subject";
    const bySize = (x, y) => conceptsOf(y.slug).length - conceptsOf(x.slug).length || x.name.localeCompare(y.name);
    const groups = [["personal","Personal"], ["person","People"], ["subject","Subjects"]]
      .map(([k, head]) => ({ head, rows: S.brains.filter(b => kind(b) === k).sort(bySize) }))
      .filter(g => g.rows.length);
    for (const g of groups){
      const h = el("div","group-h",g.head); h.dataset.n = g.rows.length;
      box.append(h);
      for (const b of g.rows) box.append(brainRow(b));
    }
  }
  /* On a phone, one button closes the drawer on the ticked folders. */
  const go = $("sideGo");
  go.hidden = !S.picks.length;
  /* It closes the drawer on the folders ticked: New chat, at the top, is the one way to start a chat. */
  go.textContent = S.picks.length ? `Done · ${S.picks.length === 1 ? picksName() : S.picks.length + " folders"} ticked` : "";
}

/** A model in use, as Settings names it: short on the button, whole in its title. */
function modelLabel(){
  const m = S.models || {}, live = m.chat || S.model, def = m.chatDefault || "";
  const picked = !!live && !!def && live !== def;
  return {
    val: live ? live.split("/").pop() : "default", picked,
    title: `${live || "the server default"}${m.favs?.length ? `, the cheapest of your ${m.favs.length} favourites today` : picked ? ", picked for this workspace" : ", the default"}. Click to change it. Build ${window.OCTOPUS_BUILD}.`,
  };
}

/**
 * Everything about one brain, in one place: what it is called, and the line
 * that decides what belongs inside.
 *
 * A new name moves the slug, and the slug is how concepts, source rows and
 * counted candidates find their brain. The server moves all three in one write
 * and reports the counts, which is what the receipt below shows.
 */
function openBrainSheet(b){
  closeSide();
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>${esc(b.name)}</h3>
      <p>The scope line is the only test of what belongs inside. Change it and the next drop is judged
        against the new line.</p></header>
      <div class="f"><label for="rName">Name</label><input id="rName" autocomplete="off"></div>
      <div class="f"><label for="rScope">Scope, in one line</label><textarea id="rScope"></textarea></div>
      <div class="f" id="rMergeF" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px">
        <label for="rInto">Merge into another folder</label>
        <div class="hint" style="margin:0 0 8px">Every concept, source and link moves there, and this folder goes. A concept with the same title joins its twin.</div>
        <div style="display:flex; gap:8px"><select id="rInto" class="pick" style="flex:1; min-width:0"></select><button class="ghost" id="rMerge" type="button">Merge</button></div></div>
      <div class="f"><div id="rMsg" class="bad" role="alert"></div></div>
      <footer><button class="ghost" id="rCancel">Cancel</button><button class="go" id="rSave">Save</button></footer>
    </div>`;
  document.body.append(veil);
  const nameI = veil.querySelector("#rName"), scopeI = veil.querySelector("#rScope"),
        msg = veil.querySelector("#rMsg"), save = veil.querySelector("#rSave");
  nameI.value = b.name || ""; scopeI.value = b.scope || "";
  const shut = () => veil.remove();
  veil.querySelector("#rCancel").onclick = shut;

  /* Merge into: only this workspace's own folders, never a personal one. */
  const home = x => (x.space || S.space) === S.space;
  const targets = S.brains.filter(x => x.slug !== b.slug && x.type !== "personal" && home(x) && !readOnly(x))
    .sort((x, y) => x.name.localeCompare(y.name));
  const into = veil.querySelector("#rInto"), merge = veil.querySelector("#rMerge");
  veil.querySelector("#rMergeF").hidden = b.type === "personal" || !home(b) || !targets.length;
  into.innerHTML = `<option value="">Pick a folder</option>` + targets.map(x => `<option value="${esc(x.slug)}">${esc(x.name)}</option>`).join("");
  into.onchange = () => { merge.textContent = "Merge"; merge.classList.remove("sure"); };
  merge.onclick = async () => {
    const t = targets.find(x => x.slug === into.value);
    if (!t){ into.focus(); return; }
    /* A second click goes: the folder cannot come back. */
    if (!merge.classList.contains("sure")){ merge.classList.add("sure"); merge.textContent = `Sure? Into ${t.name}`; return; }
    merge.disabled = true; msg.className = "spin"; msg.textContent = "Merging";
    let r;
    try { r = await api("/api/brain/merge", { from: b.slug, into: t.slug }); }
    catch (e) { merge.disabled = false; msg.className = "bad"; msg.textContent = e.message; return; }
    shut();
    if (S.folder === b.slug) S.folder = null;
    S.picks = S.picks.filter(x => x !== b.slug);
    await refresh();
    openFolder(S.brains.find(x => x.slug === t.slug));
    push("ai", x => { x.innerHTML = rich(`**${esc(r.fromName)}** is now part of **${esc(r.intoName)}**: ${r.moved + r.joined} concepts` +
      `${r.joined ? `, ${r.joined} joined to a twin` : ""}, ${r.sources} source${r.sources === 1 ? "" : "s"}.`); });
  };
  veil.onclick = e => { if(e.target===veil) shut(); };
  setTimeout(()=>nameI.focus(),30);

  save.onclick = async () => {
    const nm = nameI.value.trim(), sc = scopeI.value.trim();
    if (nm.length < 2){ msg.className="bad"; msg.textContent="give a name of at least 2 characters"; nameI.focus(); return; }
    save.disabled = true; msg.className="spin"; msg.textContent = "Saving";
    try {
      const r = await api("/api/brain/rename", { slug: b.slug, name: nm, scope: sc });
      if (r.error) throw new Error(r.error);
      shut(); await refresh();
      if (S.scope === b.slug) S.scope = r.slug;
      S.into = S.into.map(x => x === b.slug ? r.slug : x);
      render();
      const m = r.moved || {};
      push("ai", x => { x.innerHTML = rich(
        (r.name !== b.name
          ? `**${esc(b.name)}** is now **${esc(r.name)}**, at \`${esc(r.slug)}\`.` +
            (r.slug !== b.slug
              ? ` Moved with it: ${m.concepts||0} concepts and ${m.sources||0} sources.`
              : "")
          : `**${esc(r.name)}** saved.`) +
        `\n\nScope: ${esc(r.scope || sc)}`); });
    } catch(e){ save.disabled=false; msg.className="bad"; msg.textContent = e.message; }
  };
}

/** The picker's face: the space's mark, where it goes, and to which brain. */
function renderScope(){
  if (!S.brains.some(b => b.slug === S.scope)) S.scope = "all";
  /* The ticks follow a folder picked anywhere else: a reopened chat, a new
     folder, Ask about it. Two or more ticked ask with the scope at "all". */
  S.picks = S.picks.filter(x => S.brains.some(b => b.slug === x && b.type !== "personal"));
  if (isPersonal(S.scope)) S.picks = [];
  else if (S.scope !== "all") S.picks = [S.scope];
  else if (S.picks.length === 1) S.picks = [];
  S.into = S.into.filter(x => S.brains.some(b => b.slug === x) && !isPersonal(x) && !readOnly(S.brains.find(b => b.slug === x)));
  if (isPersonal(S.scope) && S.mode === "drop") S.mode = "ask";
  const drop = S.mode === "drop";
  const nameOf = x => S.brains.find(b => b.slug === x)?.name || x;
  /* Asking across every brain needs no label: the name says it. */
  $("scopeLabel").textContent = drop ? "Into" : isPersonal(S.scope) ? "Chat with" : "";
  /* A drop can feed several brains: the first by name, then how many more. */
  $("scopeVal").textContent = drop
    ? (!S.into.length ? "Suggest for me" : S.into.length === 1 ? nameOf(S.into[0]) : `${nameOf(S.into[0])} +${S.into.length - 1}`)
    : S.picks.length > 1 ? `${nameOf(S.picks[0])} +${S.picks.length - 1}`
    : S.scope === "all" ? "All folders" : nameOf(S.scope);
  const mark = $("spaceMark")?.getAttribute("src");
  if (mark && $("scopeMark").getAttribute("src") !== mark) $("scopeMark").src = mark;
  if (pickMenu) fillPick();
}

/* The picker's menu, drawn on the page itself so the scrolling bar of a phone
   never clips it, and placed above the button, since the box sits low. */
var pickMenu = null;   // var, not let: render() runs before this line is reached
function fillPick(){
  const m = pickMenu, drop = S.mode === "drop";
  const scroll = m.scrollTop;
  m.innerHTML = "";
  m.classList.toggle("multi", drop);
  m.setAttribute("aria-multiselectable", drop ? "true" : "false");
  /* Asking reads one folder, the ones ticked in the side panel, or all of
     them. Dropping ticks as many as the source belongs in, and the menu stays
     open while they are ticked. */
  const isOn = slug => drop ? (slug === "all" ? !S.into.length : S.into.includes(slug))
    : S.picks.length > 1 ? S.picks.includes(slug) : S.scope === slug;
  const row = (slug, name, sub, count, b) => {
    const on = isOn(slug);
    const r = el("button","pk-row" + (on ? " on" : ""));
    r.setAttribute("role","option"); r.setAttribute("aria-selected", on ? "true" : "false");
    const nm = el("span","pk-nm", name);
    if (sub) nm.append(el("span","pk-sub", sub));
    const mark = el("span", drop && slug !== "all" ? "pk-box" : "pk-dot");
    if (drop && slug !== "all") mark.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5"/></svg>`;
    r.append(mark);
    if (b) r.append(brainIcon(b));
    r.append(nm);
    if (count != null) r.append(el("span","pk-ct", count));
    r.onclick = e => {
      e.stopPropagation();
      if (!drop){
        crossing(slug);
        if (isPersonal(slug)){ S.picks = []; S.scope = slug; S.into = []; } else setPicks(slug === "all" ? [] : [slug]);
        closePick(); render(); $("input").focus(); return;
      }
      if (slug === "all") S.into = [];
      else S.into = S.into.includes(slug) ? S.into.filter(x => x !== slug) : [...S.into, slug];
      S.scope = S.into.length === 1 ? S.into[0] : "all";
      S.picks = S.into.slice();
      render();
    };
    return r;
  };
  const ideas = S.concepts.length;
  m.append(row("all", drop ? "Suggest for me" : "All folders",
    drop ? "The AI picks where it belongs" : `${S.brains.length} folder${S.brains.length===1?"":"s"}, ${ideas} concept${ideas===1?"":"s"}`));
  if (drop) m.append(el("div","pk-h","Or tick the folders to feed"));
  if (!drop) m.append(el("div","pk-h","Or one folder"));
  for (const b of ordered()) if (!drop || (b.type !== "personal" && !readOnly(b))) m.append(row(b.slug, b.name, b.type === "personal" ? "your chat" : "", String(conceptsOf(b.slug).length), b));
  if (drop){
    const done = el("button","pk-done", S.into.length > 1 ? `Feed ${S.into.length} folders` : "Done");
    done.onclick = e => { e.stopPropagation(); closePick(); $("input").focus(); };
    m.append(done);
  }
  m.scrollTop = scroll;
}
function placePick(){
  const r = $("scopeBtn").getBoundingClientRect(), w = pickMenu.offsetWidth;
  pickMenu.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
  pickMenu.style.bottom = (innerHeight - r.top + 8) + "px";
}
function openPick(){
  if (pickMenu) return closePick();
  pickMenu = el("div","pick-menu");
  pickMenu.setAttribute("role","listbox");
  fillPick();
  document.body.append(pickMenu);
  placePick();
  $("scopeBtn").setAttribute("aria-expanded","true");
  (pickMenu.querySelector(".pk-row.on") || pickMenu.querySelector(".pk-row"))?.focus();
}
function closePick(){
  if (!pickMenu) return;
  pickMenu.remove(); pickMenu = null;
  $("scopeBtn").setAttribute("aria-expanded","false");
  paintBar();
}

/**
 * The chat bar stays a one-line pill, so the thread keeps the page. It opens
 * to its folders, levels and hints when it is wanted: a click in it, text in
 * it, a drop, its folder menu open, or the mic on.
 */
/* A phone's screen: hints are short there. */
function phone(){ return window.matchMedia("(max-width: 700px)").matches; }
var fullPlaceholder = "";   // var: renderComposer runs before this line is reached
/* The folded bar's few words, where the full line would not fit beside the mic. */
var shortPlaceholder = "";
function paintBar(){
  const wrap = document.querySelector(".composer-wrap");
  if (!wrap) return;
  const drop = S.mode === "drop";
  const open = wrap.contains(document.activeElement) || !!$("input").value.trim()
    || (drop && !!$("srcInput").value.trim()) || !!pickMenu || listeningIn(mainBar);
  wrap.classList.toggle("compact", !open);
  /* Folded, a drop says what it takes in a few words; open, it says it in full. */
  $("input").placeholder = !open && drop ? "Drop a link, a text or a document" : !open && shortPlaceholder ? shortPlaceholder : fullPlaceholder;
}

function renderComposer(){
  /* A personal brain is a chat: no Drop, no levels, and a way to bring in
     what another assistant already knows about you. */
  const about = S.mode === "ask" ? S.concept : null;
  const mine = S.mode === "ask" && isPersonal(S.scope) && !about;
  const asking = mine && !!S.iv[S.scope]?.on;
  paintAbout(about);
  $("memBtn").hidden = !mine || S.demo;
  /* It appears once there is something to forget. */
  $("freshBtn").hidden = S.mode !== "ask" || !S.thread.length || !!S.folder;
  const drop = S.mode==="drop";
  $("srcLine").hidden = !drop;
  shortPlaceholder = about ? `About ${about.title}` : asking ? "Your answer" : mine ? "Tell it anything" : "";
  fullPlaceholder = drop
    ? "Paste the text or the transcript here, or add a document. Leave it empty when the source is a link."
    : about ? (about.personal ? `Tell or ask anything about ${about.title}. What you say changes it.` : `Ask about ${about.title}.`)
    : asking ? "Your answer, in your own words"
    : mine ? (phone() ? "Tell it anything. @ calls a folder." : "Tell it anything: a plan, a decision, an idea. Or ask what you said. Type @ to call a folder.")
    : S.picks.length > 1 ? `Ask ${picksName()}.`
    : S.scope==="all" ? (phone() ? "Ask your folders. @ names one." : "Ask anything your folders have read. Type @ to name one.")
                      : "Ask " + (S.brains.find(b=>b.slug===S.scope)?.name || "this folder") + ".";
  $("levelWrap").hidden = drop || mine || !!about || isPersonal(S.scope);
  /* A chat about one concept reads that one alone: its chip stands for the folders. */
  $("scopeBtn").hidden = !!about;
  for (const x of $("level").children){
    const on = x.dataset.v === S.level;
    x.classList.toggle("on", on); x.setAttribute("aria-checked", on ? "true" : "false");
  }
  $("fileBtn").hidden = !drop;
  /* The mic is for asking and talking. A drop takes a source, not a voice. */
  $("micBtn").hidden = drop;
  if (drop && listeningIn(mainBar)) stopVoice();
  $("footNote").textContent = about
    ? (about.personal ? `This chat reads ${about.title} alone. A fact, a date or a correction you give is written to it at once.`
      : `This chat reads ${about.title} alone. A new chat reads every folder.`)
    : asking
    ? "Interview: one question at a time, each answer filed as dated notes. Say skip to pass, or Stop any time."
    : mine
    ? "Personal, alpha: your words are filed as dated notes. It calls your other folders when they help, and only this chat reads it."
    : drop
    ? "The source gets read once, then you reply to one card."
    : S.level==="educational" ? "Educational: terms defined, mechanism built, one worked example."
    : S.level==="learning" ? "Learning: no answer given. Steps and hints to reach it yourself."
    : "Normal: the answer carries the numbers. Sources sit on one line underneath.";

  const t = $("input").value.trim();
  const src = drop ? $("srcInput").value.trim() : "";
  /* A drop needs something to read: content, a pasted transcript, or a link
     the server can open. A source named with neither is a title and nothing
     else, so the button stays off and the hint says what is missing. */
  const ready = hasContent(src, t);
  const busy = drop ? S.dropBusy : chatBusy();
  $("send").disabled = busy || (drop ? !ready : !t);
  $("tHint").textContent = busy ? (drop ? "reading" : "working") : drop ? dropHint(src, t)
    : listeningIn(mainBar) ? `Listening in ${voiceName()}. Tap Done when you finish.` : (S.voiceHint || "");
  paintIv();
  paintBar();
}

/* Declarations, not consts: renderComposer runs once before this line is
   reached, when the shell paints ahead of the first state call. */
function linkIn(s){ return /https?:\/\/\S+/i.test(s || ""); }
function hasContent(src, content){
  return !!(content || linkIn(src) || linkIn(content));
}

/**
 * What the drop still needs, in one line.
 *
 * It says the next move rather than the rule, because the rule only matters at
 * the moment a field is empty.
 */
function dropHint(src, content){
  if (!src && !content) return "";
  if (!src && content) return "name the source, so a repeat is caught later";
  if (hasContent(src, content)) return linkIn(src) && !content
    ? "the link gets opened, video or article" : "";
  return "paste what it says, drop a document, or give a link";
}

/**
 * The octopus's loop, see-through on the page.
 *
 * The WebM carries its transparency in 270 KB. Safari and every iPhone
 * browser play WebM without that transparency, a black square, so they get
 * the animated WebP instead. Asked for less motion, it stays still.
 */
function octopusLoop(){
  const ua = navigator.userAgent;
  const webkit = /iPhone|iPad|iPod/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return `<img class="zero-mark" src="/brand/logo-mark.png" alt="">`;
  return webkit
    ? `<img class="zero-loop" src="/brand/octopus-loop.webp" alt="">`
    : `<video class="zero-loop" src="/brand/octopus-loop.webm" autoplay loop muted playsinline disablepictureinpicture aria-hidden="true"></video>`;
}

function renderZero(){
  const th = $("thread");
  /* The shell paints before the state call says which space this is, so an
     empty state drawn for the wrong space is replaced rather than kept. */
  const old = th.querySelector(".zero");
  const mark = markOf(), logo = !!S.logo, ex = examples();
  if (old && (old.dataset.space !== S.space || old.dataset.mark !== mark || old.dataset.ex !== ex.join("|"))) old.remove();
  if (th.children.length) return;
  const z = el("div","zero");
  z.dataset.space = S.space; z.dataset.mark = mark; z.dataset.ex = ex.join("|");
  z.innerHTML = `
    ${S.space === "octopus" && !logo ? octopusLoop() : `<img class="zero-mark" src="${esc(S.space === "squidgy" && !logo ? "/brand/squidgy-mark.png" : mark)}" alt="">`}
    <h2>A folder that gets smarter every time you feed it.</h2>
    <p class="lede">Feed it any source and it reads the whole thing, files each idea under the right subject, flags every claim that clashes with what you already hold, then answers from dated evidence.</p>`;
  if (ex.length){
    const t = el("div","try"); t.append(el("b",null,"Try"));
    for (const q of ex){ const b = el("button",null,q); b.type = "button"; b.onclick = () => { $("input").value = q; go(); }; t.append(b); }
    z.append(t);
  }
  th.append(z);
}

/**
 * Three questions the brains on screen can answer: the concept with the most
 * sources in each of the three fullest shared brains. A personal chat gets none.
 */
function examples(){
  if (S.mode !== "ask" || isPersonal(S.scope)) return [];
  const pool = S.brains.filter(b => b.type !== "personal" && (S.scope === "all" || b.slug === S.scope));
  const out = [];
  for (const b of [...pool].sort((x, y) => conceptsOf(y.slug).length - conceptsOf(x.slug).length)){
    const top = conceptsOf(b.slug).slice().sort((x, y) => (y.src || 0) - (x.src || 0) || (y.ev || 0) - (x.ev || 0))[0];
    if (top) out.push(`What does ${b.name} hold on ${top.title.replace(/\.$/, "").replace(/^[A-Z](?![A-Z])/, m => m.toLowerCase())}?`);
    if (out.length === 3) break;
  }
  return out;
}

