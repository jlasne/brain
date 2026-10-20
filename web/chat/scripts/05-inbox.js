/* 05-inbox.js: Work running in the background, the inbox, audits, Still open and the decisions. */

/* ============ background work and the inbox ============
   A question runs on whatever opens next: another chat, a folder, Drop. It
   lands in the chat it was asked in, and the inbox, top right, lists what is
   on its way, what landed unread, a drop not finished, and the open clashes. */

/** The chat on screen: its saved id, or the draft a new chat is until its first answer. */
function currentKey(){ return S.chatId || S.draft; }
/** A question on its way in the chat on screen. Another chat stays free. */
/* Declarations, not consts: renderComposer reads these before this line runs. */
function chatBusy(){ return S.jobs.some(j => j.status === "running" && j.key === currentKey()); }
var jobSeq = 0;

function addJob(q, about, label){
  const j = { id: ++jobSeq, q, key: currentKey(), chat: S.chatId, status: "running", seen: false, at: Date.now(),
    scope: S.scope, picks: S.picks.slice(), concept: about || null, label: label || "" };
  S.jobs.push(j);
  paintInbox(); renderChats();
  return j;
}
/** The answer names its chat: a draft still on screen becomes that chat. True when it is on screen. */
function landed(j, r){
  const here = currentKey() === j.key;
  if (r && r.chat){
    if (here && !S.chatId) S.chatId = r.chat;
    /* The ticks of the draft go with it to the chat it became. */
    if (S.sels?.[j.key] && !S.sels[r.chat]) S.sels[r.chat] = S.sels[j.key];
    j.key = j.chat = r.chat; loadChats();
  }
  return here;
}
function endJob(j, ok){
  j.status = ok ? "done" : "failed"; j.done = Date.now();
  /* Read when it landed in front of you; otherwise it waits in the inbox. */
  j.seen = !document.hidden && S.mode === "ask" && !S.folder && currentKey() === j.key && !!j.body?.isConnected;
  /* What was read is let go; the list never grows past 30. */
  S.jobs = S.jobs.filter(x => x.status === "running" || !x.seen || Date.now() - x.done < 60000).slice(-30);
  paintInbox(); renderChats();
}
/** What is on screen now counts as read. */
function markSeen(){
  let n = 0;
  if (S.mode === "ask" && !S.folder && !document.hidden)
    for (const j of S.jobs) if (!j.seen && j.status !== "running" && j.key === currentKey()){ j.seen = true; n++; }
  if (S.mode === "drop" && !document.hidden && S.dropJob && !S.dropJob.seen){ S.dropJob.seen = true; n++; }
  const a = S.auditRun;
  if (a && a.state !== "running" && !a.seen && auditShown(a)){ a.seen = true; n++; }
  if (n){ paintInbox(); renderChats(); }
}
document.addEventListener("visibilitychange", markSeen);

/** Where the drop stands: running, a card to review, storing, stored, waiting on a choice, failed. Null when done with. */
function dropState(state, title){
  if (!state){ S.dropJob = null; paintInbox(); return; }
  S.dropJob = { ...(S.dropJob || {}), state, ...(title ? { title: String(title).slice(0, 90) } : {}),
    step: state === "running" ? (S.dropJob?.step || "") : "", seen: S.mode === "drop" && !document.hidden, at: Date.now() };
  paintInbox();
}
function dropStep(label){ if (S.dropJob && label){ S.dropJob.step = String(label); paintInbox(); } }
/** A drop's run is over: a card waits, or the last message says how it ended. */
function dropSettled(){
  if (S.pendingCard){ if (S.dropJob?.state !== "card") dropState("card"); return; }
  if (S.dropJob && !["running", "storing"].includes(S.dropJob.state)) return;
  const last = $("dropThread").lastElementChild;
  dropState(last?.querySelector(".err") ? "failed" : last?.querySelector("button") ? "waiting" : "ended");
}

/** The open clashes across the folders. */
function openClashes(){ return Object.values(S.clashCount || {}).reduce((n, x) => n + (Number(x) || 0), 0); }
function ago(t){ const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`; }

/** The bubble's count, and the panel when it is open. */
function paintInbox(){
  const btn = $("inboxBtn"); if (!btn) return;
  const unread = S.jobs.filter(j => j.status !== "running" && !j.seen).length;
  const running = S.jobs.filter(j => j.status === "running").length;
  const d = S.dropJob;
  const dropWaits = d && (d.state === "card" || (!d.seen && ["stored", "waiting", "failed", "ended"].includes(d.state))) ? 1 : 0;
  const m = S.memJob;
  const memWaits = m && m.state !== "running" && !m.seen ? 1 : 0;
  const a = S.auditRun, auditing = a?.state === "running";
  const auditWaits = a && !auditing && !a.seen ? 1 : 0;
  const dueAudits = S.demo ? [] : (S.brains || []).filter(b => auditDue(b) && !(auditing && a.slug === b.slug));
  const n = unread + dropWaits + memWaits + auditWaits + dueAudits.length + decisionCount() + stillDue();
  $("inboxN").hidden = !n; $("inboxN").textContent = n > 99 ? "99+" : String(n);
  btn.classList.toggle("run", running > 0 || (!!d && ["running", "storing"].includes(d.state)) || m?.state === "running" || auditing || !!S.dcRun);
  btn.setAttribute("aria-label", n ? `Inbox, ${n} waiting` : "Inbox");
  if (!$("inbox").hidden) paintInboxPanel();
}

function paintInboxPanel(box = $("inbox")){
  box.innerHTML = "";
  box.append(el("h3",null,"Inbox"));
  const group = (title, rows) => { if (!rows.length) return; const g = el("section","ib-g"); g.append(el("h4",null,title), ...rows); box.append(g); };
  const item = (cls, title, sub, go) => {
    const b = el("button","ib-it " + cls); b.type = "button";
    b.append(el("i","ib-mark"), el("span","ib-t", title), el("span","ib-s", sub));
    b.onclick = () => { closeInbox(); go(); };
    return b;
  };
  const named = j => j.q ? (j.q.length > 70 ? j.q.slice(0, 67) + "..." : j.q) : (j.label || "Interview");
  const where = j => j.concept ? `About ${j.concept.title}` : brainLabel(j.picks.length > 1 ? j.picks.join(",") : j.scope);
  group("Answers ready", S.jobs.filter(j => j.status !== "running" && !j.seen).reverse()
    .map(j => item(j.status === "failed" ? "bad" : "new", named(j), `${j.status === "failed" ? "Failed" : "Answered"} ${ago(j.done)} ago · ${where(j)}`, () => openJob(j))));
  group("On its way", S.jobs.filter(j => j.status === "running")
    .map(j => item("run", named(j), `Thinking for ${ago(j.at)} · ${where(j)}`, () => openJob(j))));
  const d = S.dropJob;
  if (d){
    const say = { running: d.step || "Reading", storing: "Storing", card: "Card ready to review", stored: "Stored",
      waiting: "Waiting on your choice", failed: "Stopped on an error", ended: "Ended, read why" }[d.state] || "";
    if (["running", "storing", "card"].includes(d.state) || !d.seen)
      group("Drop", [item(["running", "storing"].includes(d.state) ? "run" : d.state === "failed" ? "bad" : "new", d.title || "Your drop", say, () => openDrop())]);
  }
  const m = S.memJob;
  if (m && (m.state === "running" || !m.seen)){
    const n = m.pieces.length;
    group("Memory", [item(m.state === "running" ? "run" : m.state === "failed" ? "bad" : "new", `Add memory to ${m.name}`,
      m.state === "running" ? `Filing piece ${Math.min(m.done + 1, n)} of ${n}` : m.state === "failed" ? `Stopped at piece ${m.done + 1} of ${n}` : "Done: see what it filed",
      () => openMemorySheet(m.brain))]);
  }
  const a = S.auditRun, ab = a && S.brains.find(x => x.slug === a.slug);
  if (ab && (a.state === "running" || !a.seen))
    group("Audit", [item(a.state === "running" ? "run" : a.state === "failed" ? "bad" : "new", `Audit ${a.name}`,
      a.state === "running" ? `${a.step} · ${ago(a.at)}` : a.state === "failed" ? "Stopped on an error" : `Finished · ${a.summary}`, () => runAudit(ab, true))]);
  const due = S.demo ? [] : S.brains.filter(b => auditDue(b) && !(a?.state === "running" && a.slug === b.slug));
  if (due.length) group("Cleaning needed", due.map(b => item("clash", `Audit ${b.name}`, auditDue(b), () => runAudit(b))));
  const lines = stillLines();
  if (lines.length){
    const rows = lines.slice(0, 3).map(({ p, x }) => {
      const row = el("div","ib-still");
      const tick = el("button","pf-tick"); tick.type = "button"; tick.title = "Done"; tick.setAttribute("aria-label", `Mark done: ${x.t}`);
      tick.onclick = e => { e.stopPropagation(); tickStill(p, x, tick); };
      const go = el("button","ib-go"); go.type = "button";
      go.append(el("span","ib-t",`${p.title}: ${x.t}`), el("span","ib-s",`Open since ${fileDay(x.at)}`));
      go.onclick = () => { closeInbox(); openStill(); };
      row.append(tick, go);
      return row;
    });
    const people = new Set(lines.map(l => l.p.id)).size;
    rows.push(item("still", lines.length > 3 ? `See all ${lines.length} lines` : "Comment on a line",
      `${people} ${people === 1 ? "person" : "people"}. Tick what is done, or say what changed`, () => openStill()));
    group("Still open", rows);
  }
  const clash = openClashes(), dn = decisionCount();
  if (S.demo){ if (clash) group("Conflicts", [item("clash", `${clash} open clash${clash === 1 ? "" : "es"} to settle`, "One card at a time: keep a side, or both", () => settleFrom(null, null))]); }
  else if (dn || S.dcRun) group("Decisions", [item(S.dcRun ? "run" : "clash",
    S.dcRun ? `Applying ${S.dcRun.done} of ${S.dcRun.total}` : `${dn} decision${dn === 1 ? "" : "s"} ready`,
    S.dcRun ? "It goes on while you look elsewhere" : "Each with a suggested call. Accept them all in one tap", () => openDecide())]);
  if (box.children.length === 1) box.append(el("p","ib-none","Nothing waiting. A question you send keeps running here while you look elsewhere."));
}

/** A question from the inbox, back on screen: its chat, or the draft it was asked in. */
function openJob(j){
  j.seen = true; paintInbox();
  if (j.chat){
    if (S.chatId === j.chat && S.mode === "ask" && !S.folder){ markSeen(); paintInbox(); renderChats(); return; }
    openChat(j.chat); return;
  }
  /* A new chat with no answer yet: the draft comes back with its question. */
  S.thread = []; S.chatId = null; S.draft = j.key; S.mode = "ask"; S.folder = null; S.concept = j.concept;
  if (j.concept) setScopeFor(j.concept.brain); else if (isPersonal(j.scope)){ S.picks = []; S.scope = j.scope; S.into = []; } else setPicks(j.picks);
  $("thread").innerHTML = "";
  if (j.q) says(j.q);
  if (j.status === "running") j.body = thinking(j.label);
  else push("ai", b => fail(b, j.error, { q: j.q, scope: j.scope, retry: () => { if (!chatBusy()) doAsk(j.q, b).finally(renderComposer); } }));
  render(); renderChats(); paintInbox(); bottom();
}

var inboxTimer = null;
/**
 * The open panel, each second: painted aside and put in only when it reads differently, so a second where nothing changed
 * keeps the rows as they are, with the keyboard's place and the pointer's hover. A change keeps the keyboard on the same row.
 */
function tickInbox(box){
  const fresh = document.createElement("div");
  paintInboxPanel(fresh);
  if (fresh.innerHTML === box.innerHTML) return;
  const at = [...box.querySelectorAll("button")].indexOf(document.activeElement);
  box.replaceChildren(...fresh.childNodes);
  if (at >= 0) box.querySelectorAll("button")[at]?.focus();
}
function openInbox(){
  const box = $("inbox"); box.hidden = false; $("inboxBtn").setAttribute("aria-expanded","true");
  paintInboxPanel();
  clearInterval(inboxTimer); inboxTimer = setInterval(() => { if (box.hidden) clearInterval(inboxTimer); else tickInbox(box); }, 1000);
  /* The open clashes and the open lines are read again as it opens. */
  loadClashCount().then(paintInbox);
  loadStill();
}
function closeInbox(){ $("inbox").hidden = true; $("inboxBtn").setAttribute("aria-expanded","false"); clearInterval(inboxTimer); }
$("inboxBtn").onclick = e => { e.stopPropagation(); $("inbox").hidden ? openInbox() : closeInbox(); };
document.addEventListener("pointerdown", e => { if (!$("inbox").hidden && !$("inbox").contains(e.target) && !$("inboxBtn").contains(e.target)) closeInbox(); }, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("inbox").hidden){ closeInbox(); $("inboxBtn").focus(); } });

/* ============ audits ============
   One place for every folder this workspace holds: what is filed twice,
   titles not in English, empty positions, and in the personal folder the
   people not filed and the same person twice. Due after 50 sources dropped
   since the last one; the personal folder, every week. The inbox says when. */

/* ============ still open: what waits in your people's files ============ */
/**
 * The personal folder's open lines live in the inbox: the 3 oldest, each with its tick, and a row to the whole list. Each
 * person's card carries its count, so with nothing open nothing is read; otherwise the lines are read once, with no model.
 * The inbox's number counts a line once it has been open a week, so a fresh promise never nags.
 */
function personalOfSpace(){ return S.brains.find(b => b.type === "personal" && !readOnly(b) && (b.space || "octopus") === S.space); }
const STILL_DAYS = 7;
/** Every open line, the oldest first, each with its person. */
function stillLines(){ return (S.still || []).flatMap(p => p.items.map(x => ({ p, x }))).sort((a, b) => String(a.x.at).localeCompare(String(b.x.at))); }
/** The lines open a week or more: what the inbox counts. */
function stillDue(){ const cut = Date.now() - STILL_DAYS * 86400000; return stillLines().filter(({ x }) => Date.parse(x.at) <= cut).length; }
/** The counts, from the list the server just read: each person's card, and the inbox. */
function setOpen(pb, people){
  S.still = people;
  const by = new Map(people.map(p => [p.id, p.items.length]));
  for (const c of S.concepts) if (c.brain === pb.slug && c.tag === "contact") c.open = by.get(`${c.brain}/${c.slug}`) || 0;
  paintInbox();
}
/** The lines, read once when there are any, or when a card carries no count yet. */
async function loadStill(){
  const pb = S.demo ? null : personalOfSpace();
  if (!pb || !S.concepts.some(c => c.brain === pb.slug && c.tag === "contact" && (c.open === undefined || c.open > 0))){ S.still = []; paintInbox(); return; }
  try { const r = await api("/api/personal/open", { brain: pb.slug }); if (r.people) setOpen(pb, r.people); }
  catch { /* the inbox shows them on the next visit */ }
}
/** A line closed from the inbox, at once and with no model. */
async function tickStill(p, x, btn){
  const pb = personalOfSpace(); if (!pb) return;
  btn.disabled = true;
  try {
    await api("/api/personal/contact", { action: "part", id: p.id, part: "open", key: x.k, done: true });
    setOpen(pb, (S.still || []).map(q => q.id === p.id ? { ...q, items: q.items.filter(y => y.k !== x.k) } : q).filter(q => q.items.length));
    refresh().catch(() => {});
  } catch { btn.disabled = false; }
}
/**
 * Every open line of every person, by person, the oldest first. A tick closes
 * a line at once. A comment says what changed, and one send updates every line
 * commented: closed, dropped or reworded, with a follow-up or a moment of
 * their history when the comment tells one.
 */
async function openStill(){
  const pb = personalOfSpace(); if (!pb) return;
  closeInbox();
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet dc-sheet op-sheet" role="dialog" aria-modal="true" aria-label="Still open">
      <header><h3>Still open</h3><p>The promises and follow-ups in your people's files, the oldest first. Tick a line that is done, or write under it what changed. One send updates every line you commented.</p></header>
      <div class="f" id="opList"><div class="hint">Loading</div></div>
      <footer><span class="dc-state" id="opSay" role="status"></span><button class="ghost" id="opDone" type="button">Done</button><button class="go" id="opSend" type="button" disabled>Send updates</button></footer>
    </div>`;
  document.body.append(veil);
  const list = veil.querySelector("#opList"), say = veil.querySelector("#opSay"), send = veil.querySelector("#opSend");
  const shut = () => { veil.remove(); };
  veil.querySelector("#opDone").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  const tell = (text, cls = "") => { say.textContent = text; say.className = "dc-state " + cls; };
  let data = [];
  const drafts = new Map();          // "person|line" to the comment typed, kept while the list repaints
  const sendable = () => { send.disabled = ![...drafts.values()].some(v => v.trim()); };
  const paintList = () => {
    list.innerHTML = "";
    setOpen(pb, data);
    if (!data.length){ list.append(el("p","tw-key","Nothing open. A promise or a follow-up you tell your twin about someone lands here.")); return; }
    const n = data.reduce((t, p) => t + p.items.length, 0);
    list.append(el("h4","op-n",`${n} open line${n === 1 ? "" : "s"}, ${data.length} ${data.length === 1 ? "person" : "people"}`));
    for (const p of data){
      const sec = el("section","op-p"); sec.dataset.id = p.id;
      const head = el("button","op-h"); head.type = "button"; head.append(el("b",null,p.title));
      if (p.line) head.append(el("small",null,p.line));
      head.title = "Open their file";
      head.onclick = () => { shut(); openFolder(pb, p.id); };
      sec.append(head);
      for (const x of p.items){
        const key = `${p.id}|${x.k}`;
        const row = el("div","op-row"); row.dataset.k = x.k;
        const top = el("div","pf-orow");
        const tick = el("button","pf-tick"); tick.type = "button"; tick.title = "Done"; tick.setAttribute("aria-label", `Mark done: ${x.t}`);
        tick.onclick = async () => {
          tick.disabled = true;
          try {
            await api("/api/personal/contact", { action: "part", id: p.id, part: "open", key: x.k, done: true });
            drafts.delete(key); p.items = p.items.filter(y => y.k !== x.k); data = data.filter(q => q.items.length);
            paintList(); sendable(); refresh().catch(() => {});
          } catch (e) { tick.disabled = false; tell(e.message, "bad"); }
        };
        top.append(tick, el("span",null,x.t), el("time",null,`since ${fileDay(x.at)}`));
        const inp = el("input","op-in"); inp.type = "text"; inp.maxLength = 500; inp.value = drafts.get(key) || "";
        inp.placeholder = "What changed?"; inp.setAttribute("aria-label", `Comment on: ${x.t}`);
        inp.oninput = () => { drafts.set(key, inp.value); sendable(); };
        inp.onkeydown = e => { if (e.key === "Enter" && !send.disabled) send.click(); };
        row.append(top, inp); sec.append(row);
      }
      list.append(sec);
    }
  };
  send.onclick = async () => {
    const updates = [...drafts].filter(([, v]) => v.trim()).map(([k, v]) => { const [id, key] = k.split("|"); return { id, k: key, comment: v.trim() }; });
    if (!updates.length) return;
    send.disabled = true; tell("Reading your comments", "spin");
    try {
      const r = await api("/api/personal/open", { action: "send", brain: pb.slug, updates });
      if (r.people) data = r.people;
      if (r.error){ paintList(); throw new Error(r.error); }
      /* What was read leaves; what was passed over or did not save keeps its comment, to send again. */
      const again = new Set((r.retry || []).map(x => `${x.id}|${x.k}`));
      for (const u of updates) if (!again.has(`${u.id}|${u.k}`)) drafts.delete(`${u.id}|${u.k}`);
      paintList();
      const said = [r.done && `${r.done} done`, r.dropped && `${r.dropped} dropped`, r.changed && `${r.changed} changed`, r.kept && `${r.kept} still open`,
        r.followed && `${r.followed} follow-up${r.followed === 1 ? "" : "s"} added`, r.moments && `${r.moments} moment${r.moments === 1 ? "" : "s"} added to a history`].filter(Boolean);
      const n = again.size;
      tell((said.length ? said.join(", ") + "." : "Your comments are kept in their notes.") + (n ? ` ${n} line${n === 1 ? "" : "s"} did not go through: send again.` : ""), n ? "bad" : "ok");
      refresh().catch(() => {});
    } catch (e) { tell(e.message, "bad"); }
    finally { sendable(); }
  };
  try { const r = await api("/api/personal/open", { brain: pb.slug }); if (r.error) throw new Error(r.error); data = r.people || []; }
  catch (e) { list.innerHTML = ""; list.append(el("div","hint",e.message)); return; }
  if (!veil.isConnected) return;
  paintList();
}

/* ============ decisions: the self-driving inbox ============ */
/**
 * Everything waiting on a call, each with a suggested one and its reason:
 * the open clashes, what an audit found (concepts filed twice, titles not in
 * English, positions never written), and the people filed twice in the
 * personal folder. Accept one, pick another call, or accept them all.
 */
const DC_TAG = { clash: "Clash", same: "Filed twice", rename: "Title", blank: "No position", person: "Same person" };
const pairsOf = ids => { const k = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) k.push([ids[i], ids[j]].sort().join("|")); return k; };
function decisions(){
  if (S.demo) return [];
  const out = [], have = new Map(S.concepts.map(c => [`${c.brain}/${c.slug}`, c])), later = S.dcLater || new Set();
  for (const c of S.clashes || []){
    const h = c.hint || { pick: "both", why: "" };
    out.push({ key: `clash|${c.id}|${c.a}|${c.b}`, kind: "clash", brain: c.brain, ids: [c.id], title: c.title, c,
      lines: [`A${c.aDate ? `, ${c.aDate}` : ""}: ${c.a}`, `B${c.bDate ? `, ${c.bDate}` : ""}: ${c.b}`],
      pick: h.pick, say: { a: "A holds", b: "B holds", both: "Both hold" }[h.pick] || "Both hold", why: h.why || "" });
  }
  for (const b of S.brains){
    if (!auditable(b)) continue;
    const apart = new Set(b.apart || []);
    if (b.type === "personal"){
      for (const g of samePeople(conceptsOf(b.slug).filter(c => c.tag === "contact"), b.apart || [])){
        const keep = g.slice().sort((x, y) => y.title.length - x.title.length || (y.ev || 0) - (x.ev || 0))[0];
        const n = g.reduce((t, c) => t + (c.ev || 0), 0);
        out.push({ key: `person|${g.map(c => c.slug).sort().join("|")}`, kind: "person", brain: b.slug, ids: g.map(c => `${c.brain}/${c.slug}`),
          title: g.map(c => c.title).join(" and "), lines: [], pick: "merge", say: `Merge into ${keep.title}`,
          why: `the fuller name, ${n} mention${n === 1 ? "" : "s"} together`, keep: `${keep.brain}/${keep.slug}` });
      }
      continue;
    }
    const f = b.findings;
    if (!f) continue;
    for (const g of f.same || []){
      const ids = g.map(x => x.id);
      if (!ids.every(id => have.has(id)) || pairsOf(ids).every(k => apart.has(k))) continue;
      const keep = have.get(ids[0]);
      out.push({ key: `same|${ids.slice().sort().join("|")}`, kind: "same", brain: b.slug, ids, title: ids.map(id => have.get(id).title).join(" and "),
        lines: g.map(x => `${have.get(x.id).title}: ${have.get(x.id).summaryLine || "no position yet"}`), pick: "merge",
        say: `Merge into "${keep.title}"`, why: `one idea filed ${ids.length} times, and this title reads clearest`, keep: ids[0] });
    }
    for (const e of f.english || []){
      const c = have.get(e.id);
      if (!c || c.title !== e.title) continue;
      out.push({ key: `rename|${e.id}`, kind: "rename", brain: b.slug, ids: [e.id], title: c.title, lines: [], pick: "rename",
        say: `Rename to "${e.to}"`, why: "its title is not in English", to: e.to });
    }
    for (const x of f.blank || []){
      const c = have.get(x.id);
      if (!c || (c.summaryLine || "") !== (x.line || "")) continue;
      out.push({ key: `blank|${x.id}`, kind: "blank", brain: b.slug, ids: [x.id], title: c.title, lines: [], pick: "write",
        say: "Write its position", why: `it holds ${c.ev || 0} evidence line${c.ev === 1 ? "" : "s"} and no position` });
    }
  }
  return out.filter(d => !later.has(d.key));
}
function decisionCount(){ return S.demo ? openClashes() : decisions().length + (S.clashes ? 0 : openClashes()); }
/** What waits, by kind: "2 clashes · 3 filed twice". */
function decisionLine(){
  const ds = decisions(), n = k => ds.filter(d => d.kind === k).length;
  const part = (k, one, many) => n(k) ? `${n(k)} ${n(k) === 1 ? one : many}` : "";
  return [part("clash", "clash", "clashes"), part("same", "filed twice", "filed twice"), part("rename", "title", "titles"),
    part("blank", "empty position", "empty positions"), part("person", "same person", "same people")].filter(Boolean).join(" \u00b7 ") || `${decisionCount()} waiting`;
}
function paintDecide(){ if (S.dcPaint) S.dcPaint(); }
/** One decision made: the call it was given, sent. Says what changed, or throws. */
async function applyDecision(d, pick){
  const b = S.brains.find(x => x.slug === d.brain);
  const title = id => S.concepts.find(c => `${c.brain}/${c.slug}` === id)?.title || id;
  if (pick === "later"){ (S.dcLater ||= new Set()).add(d.key); return "Left for later."; }
  if (pick === "apart"){
    const r = await api("/api/brain/audit", { brain: d.brain, action: "apart", ids: d.ids });
    if (r.error) throw new Error(r.error);
    if (b) b.apart = [...new Set([...(b.apart || []), ...pairsOf(d.ids)])];
    return "Kept apart. No audit asks again.";
  }
  if (d.kind === "clash"){
    const r = await api("/api/conflicts/settle", { id: d.c.id, a: d.c.a, b: d.c.b, pick });
    if (r.error || r.ok === false) throw new Error(r.error || r.why);
    S.clashes = (S.clashes || []).filter(c => c !== d.c);
    if (S.clashCount[d.brain]) S.clashCount[d.brain] = Math.max(0, S.clashCount[d.brain] - 1);
    return { a: "A holds. Position written again.", b: "B holds. Position written again.", both: "Both hold." }[pick] || "Settled.";
  }
  if (d.kind === "same" || d.kind === "person"){
    /* The suggested card keeps its name, unless the call is to merge into another one of them. */
    const keep = String(pick).startsWith("into:") && d.ids.includes(String(pick).slice(5)) ? String(pick).slice(5) : d.keep;
    const from = d.ids.filter(x => x !== keep);
    const r = d.kind === "same" ? await api("/api/concept/merge", { into: keep, from }) : await api("/api/personal/contact", { action: "merge", into: keep, from });
    if (r.error) throw new Error(r.error);
    const kept = title(keep);
    S.concepts = S.concepts.filter(c => !from.includes(`${c.brain}/${c.slug}`));
    if (S.peek) delete S.peek[keep];
    return `Merged into ${kept}.`;
  }
  if (d.kind === "rename"){
    if (pick === "keep"){
      const r = await api("/api/brain/audit", { brain: d.brain, action: "dismiss", kind: "english", id: d.ids[0] });
      if (r.error) throw new Error(r.error);
      if (b?.findings) b.findings.english = (b.findings.english || []).filter(x => x.id !== d.ids[0]);
      return "Title kept.";
    }
    const r = await api("/api/concept/rename", { id: d.ids[0], title: d.to });
    if (r.error) throw new Error(r.error);
    const c = S.concepts.find(x => `${x.brain}/${x.slug}` === d.ids[0]); if (c) c.title = d.to;
    return `Renamed to ${d.to}.`;
  }
  if (d.kind === "blank"){
    const r = await api("/api/concept/rederive", { ids: d.ids });
    if (r.error) throw new Error(r.error);
    if (!(r.written || []).length) throw new Error("its evidence gave no position. Drop a source on it.");
    if (b?.findings) b.findings.blank = (b.findings.blank || []).filter(x => !d.ids.includes(x.id));
    return "Position written from its evidence.";
  }
  throw new Error("nothing to do");
}
/** Every decision waiting, accepted as suggested, one after the other, in the background. */
async function acceptAll(){
  const ds = decisions();
  if (!ds.length || S.dcRun) return;
  S.dcRun = { done: 0, total: ds.length, ok: 0 }; S.dcErr = new Map();
  paintInbox(); paintDecide();
  const gone = new Set(), blanks = [];
  for (const d of ds){
    if (d.ids.some(id => gone.has(id))){ S.dcRun.done++; continue; }
    if (d.kind === "blank"){ blanks.push(d); continue; }
    try { await applyDecision(d, d.pick); S.dcRun.ok++; if (d.keep) d.ids.filter(x => x !== d.keep).forEach(x => gone.add(x)); }
    catch (e) { S.dcErr.set(d.key, e.message); }
    S.dcRun.done++; paintInbox(); paintDecide();
  }
  /* Positions are written 8 to a call. */
  for (let i = 0; i < blanks.length; i += 8){
    const part = blanks.slice(i, i + 8);
    try {
      const r = await api("/api/concept/rederive", { ids: part.map(d => d.ids[0]) });
      const wrote = new Set(r.written || []);
      for (const d of part){
        if (wrote.has(d.ids[0])){ S.dcRun.ok++; const b = S.brains.find(x => x.slug === d.brain); if (b?.findings) b.findings.blank = (b.findings.blank || []).filter(x => x.id !== d.ids[0]); }
        else S.dcErr.set(d.key, "its evidence gave no position. Drop a source on it.");
      }
    } catch (e) { for (const d of part) S.dcErr.set(d.key, e.message); }
    S.dcRun.done += part.length; paintInbox(); paintDecide();
  }
  const ran = S.dcRun; S.dcRun = null;
  S.dcLast = `${ran.ok} of ${ran.total} done${S.dcErr.size ? `, ${S.dcErr.size} need${S.dcErr.size === 1 ? "s" : ""} a look` : ""}.`;
  try { await refresh(); } catch { /* the lists catch up on the next load */ }
  paintInbox(); paintDecide();
}
/** A folder due for an audit is read in the background, once a session: what it finds waits in the inbox as decisions. */
async function autoAudit(){
  if (S.demo || S.autoAudited) return;
  const b = S.brains.find(x => x.type !== "personal" && auditDue(x));
  if (!b) return;
  S.autoAudited = true;
  try {
    const r = await api("/api/brain/tidy", { brain: b.slug });
    if (r.error) return;
    const x = S.brains.find(y => y.slug === b.slug);
    if (x) x.findings = { same: r.same || [], english: r.english || [], blank: (r.blank || []).slice(0, 40) };
    await auditDone(b);
  } catch { /* it stays due: Settings, Audit runs it by hand */ }
  paintInbox(); paintDecide();
}
/**
 * The decisions, grouped by folder and topic, each with its suggested call
 * and the reason. Accept, pick another call, or leave it for later.
 */
async function openDecide(){
  closeInbox();
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet dc-sheet" role="dialog" aria-modal="true" aria-label="Decisions">
      <header><h3>Decisions</h3><p id="dcSay"></p>
        <div class="dc-top"><button class="go" id="dcAll" type="button"></button><button class="ghost" id="dcSwipe" type="button" hidden>Swipe the clashes</button><span class="dc-state" id="dcState" role="status"></span></div></header>
      <div class="f" id="dcList"></div>
      <footer><button class="ghost" id="dcDone" type="button">Done</button></footer>
    </div>`;
  document.body.append(veil);
  const list = veil.querySelector("#dcList"), say = veil.querySelector("#dcSay"), all = veil.querySelector("#dcAll"), state = veil.querySelector("#dcState"), swipe = veil.querySelector("#dcSwipe");
  const shut = () => { S.dcPaint = null; veil.remove(); };
  veil.querySelector("#dcDone").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  all.onclick = () => acceptAll();
  /* The clashes one card at a time, each with its suggested call: a swipe or a key rules it. */
  swipe.onclick = () => {
    const cs = decisions().filter(d => d.kind === "clash").map(d => d.c);
    if (cs.length && !S.dcRun) openConflictDeck(cs, S.clashOthers || 0);
  };
  const said = new Map();       // what each one did, while this sheet is open
  /* The people of the "same person" calls: each one's file in a few lines, read once for this sheet. */
  S.peek = {};
  const cardOf = id => S.concepts.find(c => `${c.brain}/${c.slug}` === id);
  const personBlock = (d, id) => {
    const p = S.peek[id], c = cardOf(id) || {};
    const box = el("div","dc-p"); box.dataset.id = id;
    const head = el("div","dc-ph"); head.append(el("b",null,p?.title || c.title || id));
    if (id === d.keep) head.append(el("span","dc-keep","Suggested to keep"));
    const open = el("button","dc-open","Open file"); open.type = "button"; open.title = "Open their file";
    open.onclick = () => { const pb = S.brains.find(b => b.slug === d.brain); if (pb){ shut(); openFolder(pb, id); } };
    head.append(open); box.append(head);
    const n = p?.mentions ?? c.ev ?? 0, o = p?.open ?? c.open ?? 0;
    box.append(el("small","dc-pm",[`${n} mention${n === 1 ? "" : "s"}`, `${o} open`, p?.seen ? `seen ${fileDay(p.seen)}` : ""].filter(Boolean).join(" \u00b7 ")));
    const names = p?.aliases?.length ? p.aliases : c.aliases || [];
    if (names.length) box.append(el("p","dc-pa",`Also called ${names.join(", ")}`));
    const line = p?.line || c.summaryLine;
    box.append(el("p","dc-pl", line || "No line yet."));
    if (!p){ box.append(el("p","dc-pw","Loading their file")); return box; }
    if (p.none){ box.append(el("p","dc-pw","Their file could not be read.")); return box; }
    if (p.summary && p.summary !== line) box.append(el("p","dc-ps",p.summary));
    if (p.facts.length){ const ul = el("ul","dc-pf"); for (const f of p.facts){ const li = el("li"); li.append(el("span",null,`${f.label}:`), ` ${f.value}`); ul.append(li); } box.append(ul); }
    for (const m of p.moments) box.append(el("p","dc-pmo",`${m.d ? fileDay(m.d) + " \u00b7 " : ""}${m.t}`));
    if (!p.facts.length && !p.moments.length) box.append(el("p","dc-pw","Nothing else in their file yet."));
    return box;
  };
  /* Topics name the groups: one fetch per folder, kept for the session. */
  S.topicsOf ||= {};
  const topicOf = id => { const t = (S.topicsOf[id.split("/")[0]] || []).find(t => t.members.includes(id)); return t ? t.title : ""; };
  const ALT = { clash: [["a", "A holds"], ["b", "B holds"], ["both", "Both hold"]], same: [["apart", "Keep apart"]], person: [["apart", "Keep apart"]],
    rename: [["keep", "Keep this title"]], blank: [] };
  const paint = () => {
    const ds = decisions(), run = S.dcRun;
    say.textContent = ds.length ? `${ds.length} waiting, each with a suggested call and its reason. Accept one, pick another call, or accept them all.`
      : "Nothing waiting. Clashes, things filed twice and audit findings land here.";
    all.hidden = !ds.length && !run;
    all.disabled = !!run;
    swipe.hidden = !!run || !ds.some(d => d.kind === "clash");
    all.textContent = run ? `Applying ${run.done} of ${run.total}` : `Accept all ${ds.length}`;
    state.textContent = run ? "You can close this: it goes on." : S.dcLast || "";
    list.innerHTML = "";
    const groups = new Map();
    for (const d of ds){
      const name = S.brains.find(b => b.slug === d.brain)?.name || d.brain;
      const g = d.kind === "person" ? `${name} · People` : [name, topicOf(d.ids[0])].filter(Boolean).join(" · ");
      (groups.get(g) || groups.set(g, []).get(g)).push(d);
    }
    for (const [g, rows] of groups){
      const sec = el("section","dc-g"); sec.append(el("h4",null,`${g} · ${rows.length}`));
      for (const d of rows){
        const row = el("div","dc-row"); row.dataset.key = d.key; row.dataset.kind = d.kind;
        const top = el("div","dc-head"); top.append(el("span","dc-tag",DC_TAG[d.kind]), el("b","dc-t",d.title)); row.append(top);
        for (const l of d.lines) row.append(el("p","dc-l",l));
        if (d.kind === "person"){ const who = el("div","dc-who"); for (const id of d.ids) who.append(personBlock(d, id)); row.append(who); }
        const hint = el("p","dc-hint"); hint.append(el("b",null,`Suggested: ${d.say}`), d.why ? `. ${d.why[0].toUpperCase()}${d.why.slice(1)}${/[.!?]$/.test(d.why) ? "" : "."}` : ""); row.append(hint);
        const msg = el("p","dc-msg"); if (S.dcErr?.has(d.key)){ msg.textContent = S.dcErr.get(d.key); msg.classList.add("bad"); } row.append(msg);
        const acts = el("div","dc-acts");
        const act = (label, pick, cls) => {
          const x = el("button", cls, label); x.type = "button"; x.disabled = !!run;
          x.onclick = async () => {
            acts.querySelectorAll("button").forEach(y => y.disabled = true); msg.className = "dc-msg"; msg.textContent = "Working";
            try { said.set(d.key, `${d.title}: ${await applyDecision(d, pick)}`); S.dcErr?.delete(d.key); paintInbox(); paint(); if (pick !== "later") refresh().catch(() => {}); }
            catch (e) { msg.className = "dc-msg bad"; msg.textContent = e.message; acts.querySelectorAll("button").forEach(y => y.disabled = false); }
          };
          acts.append(x);
        };
        act("Accept", d.pick, "go dc-ok");
        /* Two cards of one person: merge into either, by name. */
        const alts = d.kind === "person" ? [...d.ids.filter(x => x !== d.keep).map(x => [`into:${x}`, `Merge into ${cardOf(x)?.title || x}`]), ["apart", "Keep apart"]] : ALT[d.kind] || [];
        for (const [p, label] of alts) if (p !== d.pick) act(label, p, "ghost");
        act("Later", "later", "ghost");
        row.append(acts); sec.append(row);
      }
      list.append(sec);
    }
    if (said.size){
      const sec = el("section","dc-g dc-said"); sec.append(el("h4",null,`Done here · ${said.size}`));
      for (const t of [...said.values()].reverse()) sec.append(el("p","dc-done",t));
      list.append(sec);
    }
  };
  S.dcPaint = paint;
  paint();
  /* One call for every person in these calls. A card it could not read keeps what the lists hold. */
  const peeks = async () => {
    const byBrain = new Map();
    for (const d of decisions().filter(x => x.kind === "person")) for (const id of d.ids) if (!S.peek[id]) (byBrain.get(d.brain) || byBrain.set(d.brain, new Set()).get(d.brain)).add(id);
    for (const ids of byBrain.values()){
      const want = [...ids];
      for (let i = 0; i < want.length; i += 20){
        const part = want.slice(i, i + 20);
        try { for (const p of (await api("/api/personal/contact", { action: "peek", ids: part })).people || []) S.peek[p.id] = p; } catch { /* the lists' own lines stay */ }
        for (const id of part) if (!S.peek[id]) S.peek[id] = { none: true };
      }
    }
    if (veil.isConnected) paint();
  };
  peeks();
  const need = [...new Set(decisions().map(d => d.brain))].filter(slug => !S.topicsOf[slug] && S.brains.find(b => b.slug === slug)?.type !== "personal");
  await Promise.all(need.map(slug => api("/api/topics", { brain: slug }).then(r => { S.topicsOf[slug] = r.topics || []; }).catch(() => { S.topicsOf[slug] = []; })));
  if (veil.isConnected) paint();
}

/** A folder this workspace holds and may change, never one shared in. */
function auditable(b){ return !!b && !S.demo && !readOnly(b) && (b.space || "octopus") === S.space; }
function auditFolders(){
  return S.brains.filter(b => auditable(b) && (b.type === "personal" || conceptsOf(b.slug).length))
    .sort((x, y) => Number(y.type === "personal") - Number(x.type === "personal") || x.name.localeCompare(y.name));
}
function auditAge(b){ return b.audit?.at ? Math.max(0, Math.floor((Date.now() - Date.parse(b.audit.at)) / 86400000)) : null; }
/** Why a folder needs an audit now, or "". */
function auditDue(b){
  if (!auditable(b)) return "";
  if (b.type === "personal"){
    if (!conceptsOf(b.slug).length) return "";
    const d = auditAge(b);
    return d === null ? "never audited" : d >= 7 ? `last audit ${d} days ago` : "";
  }
  const since = sourcesOf(b.slug).length - (b.audit?.sources || 0);
  return since >= 50 ? `${since} sources dropped since the last audit` : "";
}
/** The last audit in one line: when, and what came since. */
function auditLine(b){
  const since = Math.max(0, sourcesOf(b.slug).length - (b.audit?.sources || 0)), d = auditAge(b);
  const when = d === null ? "Never audited" : `Last audit ${fileDay(b.audit.at)}${d ? `, ${d} day${d === 1 ? "" : "s"} ago` : ", today"}`;
  return b.type === "personal" ? `${when} · due every week` : `${when} · ${since} source${since === 1 ? "" : "s"} since`;
}
/** An audit runs once per folder: asked again while it runs, or once it ended, its pane comes back. */
function runAudit(b, resume){
  closeInbox();
  const a = S.auditRun;
  openFolder(b, null, { audit: true, resume: resume || (a?.slug === b.slug && a.state === "running") });
}
/** The audit's pane is the one on screen: its folder open, the pane in it, the tab in view. */
function auditShown(a){ return S.folder === a.slug && a.inner.isConnected && !document.hidden; }
function clock(ms){ const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}s`; }
/**
 * The audit's loader: the turning mark, the step it is on, a bar once the
 * count is known, and the time it has run. It ends as one line that says it
 * finished, and the inbox says so too when you were looking elsewhere.
 */
function auditLoader(inner, b){
  const box = el("div","au-load"); box.setAttribute("role","status");
  const top = el("div","au-top"), mark = el("span","spinner"), line = el("span","au-step","Starting"), time = el("span","au-time","0s");
  mark.setAttribute("aria-hidden","true");
  top.append(mark, line, time);
  const track = el("div","mem-track"), bar = el("i"); track.append(bar); track.hidden = true;
  box.append(top, track); inner.append(box);
  const run = S.auditRun = { slug: b.slug, name: b.name, state: "running", step: "Starting", at: Date.now(), inner, seen: false };
  const timer = setInterval(() => { time.textContent = clock(Date.now() - run.at); }, 1000);
  paintInbox();
  return {
    step(text, done, total){
      line.textContent = run.step = text;
      track.hidden = !total; if (total) bar.style.width = `${Math.min(100, Math.round(done / total * 100))}%`;
      paintInbox();
    },
    end(ok, summary){
      clearInterval(timer);
      const took = clock(Date.now() - run.at);
      box.replaceWith(el("div", ok ? "au-fin" : "au-fin bad", ok ? `Audit finished in ${took}.` : `Audit stopped after ${took}.`));
      Object.assign(run, { state: ok ? "done" : "failed", summary: summary || "", seen: auditShown(run) });
      paintInbox();
    },
  };
}
/** An audit ran: the day and the sources are kept, and the inbox lets go of it. */
async function auditDone(b){
  try {
    const r = await api("/api/brain/audit", { brain: b.slug, action: "done" });
    const x = S.brains.find(y => y.slug === b.slug);
    if (x && r.audit) x.audit = r.audit;
    paintInbox();
  } catch { /* the next audit stamps it */ }
}
/**
 * The same person on two cards, by their names: one name inside the other
 * ("Marc" and "Marc Dupont"), or one card's other name being the other's
 * title. A pair you kept apart is never proposed again.
 */
function samePeople(people, apart){
  const fold = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  const names = c => [c.title, ...(c.aliases || [])].map(fold).filter(Boolean);
  const kept = new Set(apart || []), out = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++){
    const a = people[i], b = people[j], ida = `${a.brain}/${a.slug}`, idb = `${b.brain}/${b.slug}`;
    if (kept.has([ida, idb].sort().join("|"))) continue;
    const na = names(a), nb = names(b);
    const inside = (x, y) => (` ${y} `).includes(` ${x} `);
    if (na.some(x => nb.some(y => x === y || (x.split(" ").length < y.split(" ").length && inside(x, y)) || (y.split(" ").length < x.split(" ").length && inside(y, x)))))
      out.push((b.ev || 0) > (a.ev || 0) ? [b, a] : [a, b]);
  }
  return out.slice(0, 40);
}

