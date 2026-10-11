/* 13-projects-chat.js: Projects: the chat on the right, the memory, and changes to the file. */

/* ---- the chat, on the right ---- */

function chatPane(){
  const pj = S.pj, d = pj.data;
  const pane = el("section","pj-chat");
  const thread = el("div","pj-thread"); pj.thread = thread; pane.append(thread);
  const comp = el("div","pj-comp");
  const memb = el("button","pj-memb"); memb.type = "button"; pj.memb = memb; memb.onclick = openMemory;
  memb.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="2"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/></svg>`;
  const ta = el("textarea"); ta.rows = 1; ta.placeholder = askHint(d.file); ta.setAttribute("aria-label", "Message to the project");
  attachMentions(ta, () => tagChoices(false));
  const send = el("button","pj-send"); send.type = "button"; send.setAttribute("aria-label", "Send"); send.disabled = true;
  send.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M8 3L4 7M8 3l4 4"/></svg>`;
  /* Talk instead of typing, as in the chat bar: the same mic, the same language, and a line for what it says. */
  const mic = el("button","pj-mic"); mic.type = "button"; mic.title = "Talk instead of typing"; mic.setAttribute("aria-label", "Talk"); mic.setAttribute("aria-pressed", "false");
  mic.innerHTML = MIC_SVG;
  const said = el("div","pj-vh"); said.setAttribute("role","status"); said.hidden = true;
  let hint = "";
  const bar = { field: () => ta, grew: () => size(), say: t => { hint = t; paintMic(); }, paint: () => paintMic() };
  const paintMic = () => {
    const on = listeningIn(bar);
    mic.classList.toggle("on", on); mic.setAttribute("aria-pressed", on ? "true" : "false"); mic.setAttribute("aria-label", on ? "Stop talking" : "Talk");
    /* While the mic listens, the strip over the field says so. */
    const t = on ? "" : hint;
    said.textContent = t; said.hidden = !t;
  };
  mic.onclick = () => listeningIn(bar) ? stopVoice() : startVoice(bar);
  const size = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 170) + "px"; send.disabled = !ta.value.trim() || pj.busy || (!!pj.data.file && pj.data.file.status !== "ready"); };
  ta.oninput = () => { if (hint){ hint = ""; paintMic(); } size(); };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); if (!send.disabled) go(); } };
  const go = () => { const q = ta.value.trim(); if (!q) return; if (listeningIn(bar)) endVoice(); ta.value = ""; size(); sendProject(q); };
  send.onclick = go;
  comp.append(memb, ta, mic, send); pane.append(said, comp);
  pj.comp = comp; pj.input = ta; pj.size = size; pj.bar = bar;
  return pane;
}

/** What the message bar invites: a question about the file, or a description of one to make. */
function askHint(f){
  /* On a phone the hint is one line, not four. */
  const small = window.matchMedia("(max-width: 860px)").matches;
  if (!f) return small ? "Describe it. @ names a folder." : "Describe a document, a table or a page to make. Your folders are read when they help.";
  if (f.status !== "ready") return small ? "Drop the file again first." : "Drop the file again first, then ask about it here.";
  const n = pjNoun(f.kind), several = pjFiles().length > 1;
  return f.chars ? (small ? "Ask, or change. @ names a folder." : several ? `Ask about the ${n}, or ask for a change. The other files and your folders are read when they help. Type @ to name one.` : `Ask about the ${n}, or ask for a change. Your folders are read when they help. Type @ to name one.`)
    : (small ? `Describe the ${n} you want.` : `Describe the ${n} you want. It is written here, then changed as you go.`);
}

/** The memory button: how many notes the project holds, as a small neutral count. */
function paintMemb(){
  const pj = S.pj; if (!pj?.memb) return;
  const n = pj.data.memory.length;
  pj.memb.querySelector("i")?.remove();
  if (n) pj.memb.append(el("i",null,String(n)));
  pj.memb.title = n ? `Memory: ${n} note${n === 1 ? "" : "s"}` : "Memory: nothing kept yet";
  pj.memb.setAttribute("aria-label", pj.memb.title);
}
/** The right side: the thread of the chat. */
function paintSide(){
  const pj = S.pj; if (!pj?.thread) return;
  paintMemb();
  const box = pj.thread; box.innerHTML = "";
  const turns = pj.data.turns;
  if (!turns.length){
    const f = pj.data.file, tbl = f?.kind === "table", blank = f?.status === "ready" && !f.chars;
    const hint = el("div","pj-hint");
    hint.textContent = !f ? "Describe what you want: a document, a table or an HTML page. The chat makes it beside this, from your words and your folders, then changes it as you go. Every change can be undone. A file you have can be dropped instead."
      : f.status !== "ready" ? "The file was not finished. Add it again."
      : blank ? `Describe the ${pjNoun(f.kind)} you want. The chat writes it in the file beside this, then changes it as you go. Every change can be undone.`
      : f.made ? `Ask for a change and it is made at once, with an Undo. Ask a question and you get the answer first, then what it rests on.`
      : `Ask about the ${tbl ? "table" : "file"}. Ask for a brainstorm and you get a proposal, with where each point comes from. Ask for a change and you see it before it is made.`;
    box.append(hint);
    /* Where the project stands, in the chat's words, and the Brief that gives the chat its place. */
    if (pj.data.state?.text){ const st = el("div","pj-state"); st.append(el("b",null,"Where it stands"), el("p",null,pj.data.state.text)); box.append(st); }
    if (!pj.data.brief){
      const bw = el("div","pj-brief"); bw.append(el("p",null,"Give the chat its place: a Brief says who it is here, the goal, the audience and the rules. Five questions write it, by voice or by text."));
      const wb = el("button","ghost","Write the Brief"); wb.type = "button"; wb.id = "pjBriefGo"; wb.onclick = () => openMemory({ brief: "interview" });
      bw.append(wb); box.append(bw);
    }
    if (!f || f.status === "ready"){
      const tries = el("div","pj-try");
      /* A file still to make can be built from the owner's biggest folder: a start that shows the folders are read. */
      const fold = !f || blank ? ordered().find(b => b.type !== "personal") : null;
      const list = !f ? ["A table of my monthly expenses, with a category, an amount and a date", "A landing page for my coaching business: a hero, three offers and a contact form", "A one page project brief: goal, scope, risks and next steps"]
        : blank ? (tbl ? ["A table of my monthly expenses, with a category, an amount and a date", "A content calendar for the next four weeks"]
          : f.kind === "html" ? ["A landing page for my coaching business: a hero, three offers and a contact form", "A one page résumé with my experience and skills"]
          : ["A one page project brief: goal, scope, risks and next steps", "A meeting notes template with decisions and actions"])
        : tbl ? ["Which rows stand out, and why?", "Brainstorm: what should I change in this table?"]
        : ["Summarise this in five lines.", "Brainstorm: what is missing from this?"];
      if (fold) list.push(tbl ? `A table of the key points in my ${fold.name} folder, with the source of each` : f?.kind === "html" ? `A page presenting my ${fold.name} folder in five sections` : `A one page summary of my ${fold.name} folder`);
      for (const q of list){
        const b = el("button",null,q); b.type = "button"; b.onclick = () => { pj.input.value = q; pj.size(); pj.input.focus(); };
        tries.append(b);
      }
      box.append(tries);
    }
  }
  for (const t of turns) box.append(turnEl(t));
  box.scrollTop = box.scrollHeight;
  pj.size();
}

function turnEl(t){
  const w = el("div","pj-turn"); w.dataset.id = t.id || "";
  w.append(el("div","pj-q",t.q));
  const a = el("div","pj-a");
  /* As in the normal chat: the answer on the page, in plain lines. What it read, in the memory, the file and the folders, stays behind it. */
  const text = [t.lead, t.a].filter(Boolean).join("\n\n");
  if (text){ const md = el("div","pj-md"); md.innerHTML = mdView(text); a.append(md); }
  if (t.edit) a.append(editCard(t));
  /* What it could not find is asked of the owner: a resource dropped into the memory. */
  const row = el("div","pj-tact");
  if (t.lacks){
    const drop = el("button","ghost","Add a resource"); drop.type = "button";
    drop.title = "Drop a document or a text into the project's memory"; drop.onclick = () => openMemory({ add: "resource" });
    row.append(drop);
  }
  /* What it needs from the owner to go on, while it is still open. */
  const open = new Set((S.pj?.data?.asks || []).map(x => x.id));
  for (const q of t.asks || []) if (open.has(q.id)){
    const b = el("button","ghost pj-ask",q.q); b.type = "button"; b.title = "Answer in the message bar"; b.onclick = () => answerAsk(q);
    row.append(b);
  }
  /* The step the chat suggests: one line, put in the message bar to send as it is or change. */
  if (t.next){
    const b = el("button","ghost pj-next",t.next); b.type = "button"; b.title = "Put this in the message bar";
    b.onclick = () => fillBar(t.next);
    row.append(b);
  }
  if (row.children.length) a.append(row);
  w.append(a);
  return w;
}

async function sendProject(q){
  const pj = S.pj; if (!pj || pj.busy) return;
  pj.busy = true; pj.size();
  const hadFile = !!pj.data.file, sentFid = pj.fid || 1;
  const box = pj.thread;
  box.querySelector(".pj-hint")?.remove(); box.querySelector(".pj-try")?.remove();
  const w = el("div","pj-turn"); w.append(el("div","pj-q",q));
  const a = el("div","pj-a"); thinkInto(a, pj.data.file ? "Reading the file" : "Making it"); w.append(a);
  box.append(w); box.scrollTop = box.scrollHeight;
  try {
    const tags = tagsIn(q, tagChoices(false));
    const r = await api("/api/project/chat", { brain: pj.slug, q, ...pjOpen(), ...(tags.length ? { tags } : {}) });
    if (S.pj !== pj) return;
    pj.data.turns = [...pj.data.turns, r.turn].slice(-4);
    /* What the chat now waits to hear, and what this message closed: known before the answer is drawn, so its buttons are right. */
    if (r.turn.answered?.length) pj.data.asks = (pj.data.asks || []).filter(x => !r.turn.answered.includes(x.id));
    if (r.turn.asks?.length) pj.data.asks = [...(pj.data.asks || []).filter(x => !r.turn.asks.some(y => y.id === x.id)), ...r.turn.asks.map(x => ({ ...x, at: Date.now() }))].slice(-8);
    /* The answer is about the file that was open when the message went; if another opened since, its changes are kept apart. */
    const same = sentFid === (pj.fid || 1);
    if (r.turn.edit){
      if (same) pj.data.edits = [{ id: r.turn.edit.id, at: Date.now(), status: r.turn.edit.status || "open", preview: r.turn.edit.preview }, ...pj.data.edits].slice(0, 10);
      else (pj.data.editState ||= {})[r.turn.edit.id] = r.turn.edit.status || "open";
    }
    w.replaceWith(turnEl(r.turn));
    /* A change applied, or a file the first description just made: the file side follows. */
    if (same && (r.turn.edit?.status === "applied" || (!hadFile && r.turn.edit))) { try { await refreshFile(); } catch { /* the page catches up at the next look */ } }
    if (r.turn.noted?.length || r.turn.stated || r.turn.asks?.length || r.turn.answered?.length) refreshMemory();
    if (same) focusUsed(r.turn, false);
  } catch (e){
    if (S.pj !== pj) return;
    a.innerHTML = "";
    const err = el("div","pj-err"); err.append(el("b",null,"That did not work"), el("span",null,e.message));
    const row = el("div","pj-tact");
    const again = el("button","ghost","Try again"); again.type = "button"; again.onclick = () => { w.remove(); pj.busy = false; sendProject(q); };
    row.append(again); err.append(row); a.append(err);
  } finally { pj.busy = false; pj.size(); box.scrollTop = box.scrollHeight; }
}

/* ---- keeping, remembering, forgetting ---- */

/** What the project remembers, read again after a message noted something. */
async function refreshMemory(){
  const pj = S.pj; if (!pj) return;
  try {
    const d = await api("/api/project/get", { brain: pj.slug, ...pjOpen() });
    if (S.pj !== pj) return;
    pj.data.memory = d.memory; pj.data.shortcuts = d.shortcuts || []; pj.data.folders = d.folders || [];
    pj.data.brief = d.brief ?? null; pj.data.state = d.state ?? null; pj.data.asks = d.asks || []; pj.data.next = d.next !== false;
    paintMemb(); pj.memPaint?.();
    syncProjects();
  } catch { /* the list catches up the next time the project opens */ }
}

/* A day as the lists show it, from a time in milliseconds. */
const msDay = ms => ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
/** The first words of some text, on one line. */
const clipTo = (t, n = 150) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "..." : s; };
const MIC_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.75" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg>`;
/** What the owner's Brief may hold, in characters, as the server keeps it. */
const BRIEF_CHARS = 6000;
/** The five questions that write a Brief. Any may be skipped. */
const BRIEF_QS = [
  "What is this project for? Say the goal in a sentence.",
  "Who will read or use what you make here?",
  "What must the chat always do, and what must it never do?",
  "What tone and format do you want? Short or detailed, formal or casual, bullets or text.",
  "When should the chat speak up on its own? A gap in the file, two numbers that differ, a date gone.",
];

/** The Brief, the State of play, the next step and the open questions: one door, with a server older than this page told apart. */
async function briefCall(body){
  const pj = S.pj;
  try { return await api("/api/project/brief", { brain: pj.slug, ...body }); }
  catch (e){ throw new Error(/unreadable/.test(e.message) ? "The server is older than this page and cannot do this yet. Run convex deploy." : e.message); }
}

/** Words put in the message bar, to send as they are or change, with the cursor at their end. */
function fillBar(text){
  const pj = S.pj; if (!pj?.input) return;
  if (pj.seg === "doc") showChat();
  pj.input.value = text; pj.size();
  pj.input.focus(); pj.input.setSelectionRange(text.length, text.length);
}
/** A question of the chat's, answered in the message bar: the question leads the message, and the cursor waits below it. */
const answerAsk = a => fillBar(`Re: ${a.q}\n`);

/**
 * A mic for a field in a sheet: the message bar's mic, listening into that field. It stops with the sheet.
 * Returns the button, the line that says what the mic is doing, and the bar it listens in.
 */
function fieldMic(ta){
  const mic = el("button","pj-mic"); mic.type = "button"; mic.title = "Talk instead of typing"; mic.setAttribute("aria-label","Talk"); mic.setAttribute("aria-pressed","false");
  mic.innerHTML = MIC_SVG;
  const said = el("div","pj-vh"); said.setAttribute("role","status"); said.hidden = true;
  let hint = "";
  const paint = () => {
    const on = listeningIn(bar);
    mic.classList.toggle("on", on); mic.setAttribute("aria-pressed", on ? "true" : "false"); mic.setAttribute("aria-label", on ? "Stop talking" : "Talk");
    /* While the mic listens, the strip over the field says so. */
    const t = on ? "" : hint;
    said.textContent = t; said.hidden = !t;
  };
  const bar = { sheet: true, field: () => ta, grew: () => ta.dispatchEvent(new Event("input")), say: t => { hint = t; paint(); }, paint };
  mic.onclick = () => listeningIn(bar) ? stopVoice() : startVoice(bar);
  return { mic, said, bar };
}

/** What the project remembers, listed as a folder lists its concepts: the newest first, a title, a line, a small meta. A tap opens the note, with a way to forget it. */
function openMemory(opts = {}){
  const pj = S.pj; if (!pj?.data) return;
  document.querySelector(".veil.pm")?.remove();
  const veil = el("div","veil pm");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
    <header><h3 id="pmTitle">Memory</h3><p id="pmSub"></p></header>
    <div class="pm-list" id="pmList"></div>
    <footer><button class="ghost" id="pmAdd" type="button"></button><button class="ghost" id="pmClose">Close</button></footer></div>`;
  document.body.append(veil);
  const list = veil.querySelector("#pmList"), sub = veil.querySelector("#pmSub"), add = veil.querySelector("#pmAdd");
  const shut = () => { if (rec?.bar?.sheet) endVoice(); pj.memPaint = null; veil.remove(); };
  veil.querySelector("#pmClose").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  const named = new Map((pj.data.cards || []).map(c => [c.sid, c.title]));
  /* A note names a section by one number that tells its file: the sections of the first file by their own numbers, those of the others by file * 100000 + number. */
  const openFid = pj.fid || 1;
  const restsAt = p => (p >= 100000 ? Math.floor(p / 100000) : 1) === openFid ? named.get(p >= 100000 ? p % 100000 : p)
    : pjFiles().find(f => f.id === (p >= 100000 ? Math.floor(p / 100000) : 1))?.name;
  /* Where a note rests in the file, and whether the file changed there since. */
  const metaOf = m => {
    const rests = [...new Set((m.sections || []).map(restsAt).filter(Boolean))];
    return [m.title === "The file" ? "From the file" : "", m.instructions ? "From the instructions" : "", rests.length ? `In ${rests.slice(0, 2).join(", ")}${rests.length > 2 ? ` +${rests.length - 2}` : ""}` : "",
      m.stale ? "The file changed since" : "", fileDay(m.updated, true)].filter(Boolean).join(" · ");
  };
  let note = null;
  /* The project's frame leads: the Brief the chat reads at every message, where the project stands, what the chat waits to hear, and whether answers end with a next step. */
  const frame = () => {
    const out = document.createDocumentFragment();
    const row = (id, title, line, meta, go) => {
      const r = el("button","fv-row pm-fr"); r.type = "button"; r.id = id;
      r.append(el("b",null,title), el("span",null,line));
      if (meta) r.append(el("small",null,meta));
      r.onclick = go; out.append(r);
    };
    const b = pj.data.brief, st = pj.data.state, asks = pj.data.asks || [], on = pj.data.next !== false;
    row("pmBrief", "Brief", b ? clipTo(b.text) : "Not written yet. Five questions write it, by voice or by text.", b ? `Read at every message${b.at ? " · " + msDay(b.at) : ""}` : "Read at every message once written", () => editBrief());
    row("pmState", "State of play", st ? clipTo(st.text) : "The chat writes it as the project moves.", st ? `Written by the chat${st.at ? " · " + msDay(st.at) : ""}` : "", () => editState());
    if (asks.length) row("pmAsks", `To answer · ${asks.length}`, clipTo(asks[0].q) + (asks.length > 1 ? ` and ${asks.length - 1} more` : ""), "The chat waits for these", () => showAsks());
    row("pmNext", "Next step", on ? "On. An answer may end with one line you can send as your next message." : "Off. Answers end without a suggestion.", on ? "Tap to turn off" : "Tap to turn on", async () => {
      try { const r = await briefCall({ action: "next", on: !on }); pj.data.next = r.next !== false; paint(); }
      catch (e){ paint(e.message, true); }
    });
    return out;
  };
  /* `msg` is a line for the header: what just happened. It is the count otherwise. */
  const paint = (msg, isBad) => {
    note = null; list.innerHTML = ""; list.classList.remove("compose"); add.hidden = false;
    list.append(frame());
    const rules = pj.data.memory.filter(m => m.instructions).sort((x, y) => (x.n ?? 0) - (y.n ?? 0));
    const mem = pj.data.memory.filter(m => !m.instructions).sort((x, y) => String(y.updated || "").localeCompare(String(x.updated || "")) || x.title.localeCompare(y.title));
    const ways = pj.data.shortcuts || [];
    const many = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    sub.classList.toggle("bad", !!isBad);
    const folders = pj.data.folders || [];
    sub.textContent = typeof msg === "string" && msg ? msg : rules.length ? `${many(rules.length, "instruction")}${mem.length ? ` and ${many(mem.length, "note")}` : ""}.`
      : mem.length ? `${many(mem.length, "note")}${folders.length ? ` in ${many(folders.length, "folder")}` : ", the newest first"}.` : "";
    add.textContent = "Add to memory";
    if (!mem.length && !rules.length && !ways.length){ list.append(el("div","fv-none","Nothing kept yet. The project files its notes by itself: what the file holds, what you decide, what its answers find. A resource you add gives it more to read.")); return; }
    const row = m => {
      const r = el("button","fv-row"); r.type = "button";
      r.append(el("b",null,m.title));
      if (m.summaryLine || m.position) r.append(el("span",null,m.summaryLine || m.position));
      r.append(el("small",null,metaOf(m)));
      r.onclick = () => open(m);
      return r;
    };
    /* Instructions an older project holds come first, and say they are read at every message until a Brief takes their place; the notes are read as they bear on a question. */
    if (rules.length){ list.append(el("div","fv-eye",pj.data.brief ? "Instructions, replaced by the Brief" : "Instructions, read at every message")); for (const m of rules) list.append(row(m)); }
    if (folders.length) memoryFolders(list, mem, folders, row, pj, paint);
    else { if (rules.length && mem.length) list.append(el("div","fv-eye","Notes")); for (const m of mem) list.append(row(m)); }
    if (ways.length){
      /* Where things are: learned from the questions, free, and a pointer only: an answer is always written from the sections as they are. */
      list.append(el("div","fv-eye","Where things are"), el("div","fv-none","Learned from your questions, so the chat opens these sections first."));
      for (const w of ways.slice().sort((a, b) => b.at - a.at)){
        const where = w.s.map(sid => named.get(sid)).filter(Boolean);
        const r = el("div","fv-row st");
        r.append(el("b",null, w.q ? `“${w.q}”` : w.t.slice(0, 4).join(" · ")), el("span",null,`${where.slice(0, 3).join(", ")}${where.length > 3 ? ` and ${where.length - 3} more` : ""}`),
          el("small",null,`Used ${w.n} time${w.n === 1 ? "" : "s"}`));
        list.append(r);
      }
    }
    list.scrollTop = 0;
  };
  const open = m => {
    note = m; list.innerHTML = ""; sub.textContent = "";
    const box = el("div","pm-note");
    const back = el("button","pm-back","← All notes"); back.type = "button"; back.onclick = paint;
    box.append(back, el("div","pm-t",m.title), el("p","fv-pos",m.position || m.summaryLine || "No text."));
    const meta = metaOf(m); if (meta) box.append(el("small",null,meta));
    const x = el("button","pj-b bad","Forget this note"); x.type = "button";
    x.onclick = async () => {
      x.disabled = true;
      try { await api("/api/project/forget", { brain: pj.slug, slug: m.slug }); pj.data.memory = pj.data.memory.filter(y => y.slug !== m.slug); paintMemb(); syncProjects(); paint(); }
      catch (e){ x.disabled = false; box.append(el("div","pj-msg", e.message)); }
    };
    box.append(x); list.append(box); list.scrollTop = 0;
  };
  /* A message that just finished may have added notes: the list follows, unless a note is open. */
  pj.memPaint = () => { if (!note) paint(); };
  /* A view of its own in the sheet, with a way back to the list. */
  const view = (title, build) => {
    note = {}; list.innerHTML = ""; list.classList.add("compose"); add.hidden = true; sub.classList.remove("bad"); sub.textContent = "";
    const box = el("div","pm-note");
    const back = el("button","pm-back","← All notes"); back.type = "button"; back.onclick = () => { if (rec?.bar?.sheet) endVoice(); paint(); };
    box.append(back, el("div","pm-t",title));
    build(box);
    list.append(box); list.scrollTop = 0;
    box.querySelector("textarea")?.focus();
  };
  /* A field with its mic and a count of what it holds. */
  const field = (box, o) => {
    const ta = el("textarea","mem"); ta.rows = o.rows || 6; ta.id = o.id; ta.setAttribute("aria-label", o.label); ta.placeholder = o.placeholder || ""; ta.value = o.value || "";
    const m = fieldMic(ta), count = el("span","hint"), bar = el("div","mem-bar");
    const sync = () => { const n = ta.value.length; count.textContent = o.max ? `${n.toLocaleString()} of ${o.max.toLocaleString()} characters` : ""; count.classList.toggle("bad", !!o.max && n > o.max); };
    ta.oninput = sync; sync();
    bar.append(m.mic, count); box.append(ta, bar, m.said);
    return ta;
  };

  /* The Brief: the owner's words on who the chat is here. Written by hand, or from five questions. */
  const editBrief = (o = {}) => view("Brief", box => {
    const b = pj.data.brief;
    const old = !b && pj.data.memory.filter(m => m.instructions).sort((x, y) => (x.n ?? 0) - (y.n ?? 0)).map(m => `${m.title}: ${m.position || m.summaryLine}`).join("\n");
    box.append(el("p","fv-pos", old ? "Your instructions, ready to become the Brief. Change them, then save: the instructions are replaced by it."
      : "Who the chat is here, the goal, the audience, the rules, when to speak up. The chat reads it at every message."));
    const ta = field(box, { id: "pmBriefText", label: "Brief", rows: 9, max: BRIEF_CHARS, value: o.text ?? b?.text ?? old ?? "", placeholder: "Goal: ...\nAudience: ...\nAlways: ...\nNever: ...\nSpeak up when: ..." });
    if (o.note) box.append(el("div","hint",o.note));
    const status = el("div","hint"); status.setAttribute("role","status");
    const save = el("button","go","Save the Brief"); save.type = "button"; save.id = "pmBriefSave";
    const five = el("button","ghost", b || ta.value.trim() ? "Write it again from 5 questions" : "Write it from 5 questions"); five.type = "button"; five.id = "pmBriefAsk";
    save.onclick = async () => {
      if (rec?.bar?.sheet) endVoice();
      save.disabled = five.disabled = true; status.classList.remove("bad"); status.textContent = "Saving the Brief";
      try {
        const r = await briefCall({ action: "save", text: ta.value });
        pj.data.brief = r.text ? { text: r.text, at: Date.now() } : null;
        if (r.replaced) pj.data.memory = pj.data.memory.filter(m => !m.instructions);
        paintMemb(); syncProjects();
        if (!pj.data.turns.length) paintSide();
        paint(!r.text ? "Brief cleared." : r.cut ? `Brief saved. Only the first ${BRIEF_CHARS.toLocaleString()} characters were kept.` : "Brief saved. The chat reads it from the next message.");
      } catch (e){ status.textContent = e.message; status.classList.add("bad"); save.disabled = five.disabled = false; }
    };
    five.onclick = () => interview(0, []);
    const row = el("div","pm-go"); row.append(save, five);
    box.append(row, status);
  });

  /* Five questions, one at a time, each answered by voice or by text. One call writes the Brief from the answers. */
  const interview = (at, answers) => view("Five questions", box => {
    const last = at === BRIEF_QS.length - 1;
    box.append(el("small",null,`Question ${at + 1} of ${BRIEF_QS.length}`), el("p","fv-pos pm-q",BRIEF_QS[at]));
    const ta = field(box, { id: "pmAnswer", label: BRIEF_QS[at], rows: 4, value: answers[at] || "", placeholder: "In your own words. You can skip a question." });
    const status = el("div","hint"); status.setAttribute("role","status");
    const go = el("button","go", last ? "Write my Brief" : "Next"); go.type = "button"; go.id = "pmGo";
    const prev = el("button","ghost","Back"); prev.type = "button"; prev.id = "pmBack";
    const keep = () => { answers[at] = ta.value.trim(); if (rec?.bar?.sheet) endVoice(); };
    prev.onclick = () => { keep(); at ? interview(at - 1, answers) : editBrief(); };
    go.onclick = async () => {
      keep();
      if (!last) return interview(at + 1, answers);
      const given = BRIEF_QS.map((q, i) => ({ q, a: answers[i] || "" })).filter(x => x.a);
      if (!given.length){ status.textContent = "Answer at least one question."; status.classList.add("bad"); return; }
      go.disabled = prev.disabled = ta.disabled = true; status.classList.remove("bad"); status.textContent = "Writing the Brief";
      try { const r = await briefCall({ action: "write", answers: given }); editBrief({ text: r.text, note: "Written from your answers. Read it, change what you want, then save." }); }
      catch (e){ status.textContent = e.message; status.classList.add("bad"); go.disabled = prev.disabled = ta.disabled = false; }
    };
    const row = el("div","pm-go"); row.append(go, prev);
    box.append(row, status);
    ta.focus();
  });

  /* The State of play: where the project stands, written by the chat, edited by the owner. */
  const editState = () => view("State of play", box => {
    box.append(el("p","fv-pos","Where the project stands: the goal, what is decided, what is open. The chat rewrites it when an answer changes it, and reads it at every message. You can edit it."));
    const ta = field(box, { id: "pmStateText", label: "State of play", rows: 7, max: 1500, value: pj.data.state?.text || "", placeholder: "Nothing yet. The chat writes it after an answer that changes where the project stands." });
    const status = el("div","hint"); status.setAttribute("role","status");
    const save = el("button","go","Save"); save.type = "button"; save.id = "pmStateSave";
    save.onclick = async () => {
      if (rec?.bar?.sheet) endVoice();
      save.disabled = true; status.classList.remove("bad"); status.textContent = "Saving";
      try {
        const r = await briefCall({ action: "state", text: ta.value });
        pj.data.state = r.text ? { text: r.text, at: Date.now() } : null;
        if (!pj.data.turns.length) paintSide();
        paint(r.text ? "State of play saved." : "State of play cleared.");
      } catch (e){ status.textContent = e.message; status.classList.add("bad"); save.disabled = false; }
    };
    const row = el("div","pm-go"); row.append(save);
    box.append(row, status);
  });

  /* What the chat needs from the owner to go on: answered in the message bar, or dropped. */
  const showAsks = () => view("To answer", box => {
    const asks = pj.data.asks || [];
    box.append(el("p","fv-pos", asks.length ? "What the chat needs from you to go on. Answer in the message bar, by voice or by text: the answer updates the file and the memory." : "Nothing waits for you."));
    for (const a of asks){
      const r = el("div","pm-ask"); r.append(el("b",null,a.q));
      const acts = el("div","pj-tact"), ans = el("button","go","Answer"), drop = el("button","ghost","Drop");
      ans.type = drop.type = "button";
      ans.onclick = () => { shut(); answerAsk(a); };
      drop.onclick = async () => {
        drop.disabled = ans.disabled = true;
        try { pj.data.asks = (await briefCall({ action: "drop", id: a.id })).asks || []; showAsks(); }
        catch (e){ drop.disabled = ans.disabled = false; r.append(el("div","pj-msg", e.message)); }
      };
      acts.append(ans, drop); r.append(acts); box.append(r);
    }
  });

  /* A resource, typed, pasted or added from a file, as in the personal memory: the notes it holds join the memory. */
  const compose = () => {
    note = {}; list.innerHTML = ""; list.classList.add("compose"); add.hidden = true; sub.classList.remove("bad"); sub.textContent = "";
    const box = el("div","pm-note");
    const back = el("button","pm-back","← All notes"); back.type = "button"; back.onclick = () => paint();
    const intro = el("p","fv-pos"), host = el("div","pj-rules");
    box.append(back, el("div","pm-t","Add a resource"), intro, host);
    const input = instructionsField(host, "resource");
    input.ta.id = "pmText";
    intro.textContent = "A document, a text or the words of a page. The notes it holds join the memory, and the chat reads the ones that bear on a question.";
    const status = el("div","hint"); status.setAttribute("role","status");
    const go = el("button","go","Add to memory"); go.type = "button"; go.id = "pmGo";
    go.onclick = async () => {
      if (!input.text()){ input.ta.focus(); return; }
      const many = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      go.disabled = true; input.lock(true); status.classList.remove("bad"); status.textContent = "Filing the resource in the memory";
      try {
        /* A memory with no folders yet is sorted into some when this drop is big: more than one piece. */
        const r = await fileMemory(pj.slug, { name: input.name(), text: input.text() }, t => { status.textContent = t; }, { plan: !(pj.data.folders || []).length && input.text().length > RES_PIECE });
        await refreshMemory();
        paint(r.cut ? `Only the first ${RES_CHARS.toLocaleString()} characters were read, about ${RES_WORDS}.` : `${many(r.notes, "note")} filed${r.folders?.length ? ` in ${many(r.folders.length, "folder")}` : ""}. The chat reads the ones that bear on a question.`);
      } catch (e){ status.textContent = e.message; status.classList.add("bad"); go.disabled = false; input.lock(false); }
    };
    const row = el("div","pm-go"); row.append(go);
    box.append(row, status); list.append(box); list.scrollTop = 0; input.ta.focus();
  };
  add.onclick = () => compose();
  paint();
  if (opts.add) compose();
  else if (opts.brief === "interview") interview(0, []);
  else if (opts.brief) editBrief();
  else (list.querySelector("button") || veil.querySelector("#pmClose")).focus();
  /* What it learned since the last answer is read again, so the list is current. */
  refreshMemory();
}

/**
 * The notes of a project's memory in its folders: each folder folds shut, with its count and what goes in it, and stays as it was
 * left while the sheet is open. The notes in no folder (the note on the file, what the chat filed outside them) come last.
 */
function memoryFolders(list, mem, folders, row, pj, paint){
  const open = pj.memOpen || (pj.memOpen = new Set());
  const loose = [], by = new Map(folders.map(f => [f.name, []]));
  for (const m of mem) (by.get(m.folder) || loose).push(m);
  for (const f of folders){
    const ms = by.get(f.name);
    const d = el("details","pm-fold"); d.open = open.has(f.name);
    const s = el("summary"); s.append(el("b",null,f.name), el("i",null,String(ms.length)));
    if (f.scope) s.append(el("span",null,f.scope));
    d.append(s);
    for (const m of ms) d.append(row(m));
    if (!ms.length) d.append(el("div","fv-none","Nothing filed here yet."));
    d.append(folderDelete(f, ms.length, pj, paint));
    d.ontoggle = () => { if (d.open) open.add(f.name); else open.delete(f.name); };
    list.append(d);
  }
  if (loose.length){ list.append(el("div","fv-eye","Other notes")); for (const m of loose) list.append(row(m)); }
}

/**
 * Delete a folder of the memory, asked in place: its notes move to Other notes, or are forgotten with it. A folder with no note
 * goes in one tap.
 */
function folderDelete(f, n, pj, paint){
  const box = el("div","pm-fdel");
  const ask = el("button","mini","Delete folder"); ask.type = "button";
  const say = el("span","hint"); say.setAttribute("role","status");
  const go = async forget => {
    box.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
      const r = await api("/api/project/folders", { brain: pj.slug, action: "remove", name: f.name, forget });
      pj.data.folders = r.folders || []; pj.memOpen?.delete(f.name);
      await refreshMemory();
      paint(r.forgotten ? `${f.name} deleted, with its ${r.forgotten === 1 ? "note" : `${r.forgotten} notes`}.` : r.moved ? `${f.name} deleted. Its ${r.moved === 1 ? "note is" : `${r.moved} notes are`} under Other notes.` : `${f.name} deleted.`);
    } catch (e){
      say.textContent = /unreadable/.test(e.message) ? "The server is older than this page and cannot delete a folder yet. Run convex deploy." : e.message;
      box.querySelectorAll("button").forEach(b => { b.disabled = false; });
    }
  };
  ask.onclick = () => {
    if (!n) return go(false);
    box.innerHTML = "";
    const keep = el("button","mini",`Keep its ${n === 1 ? "note" : `${n} notes`}`), drop = el("button","mini bad",`Forget ${n === 1 ? "it" : "them"} too`), back = el("button","mini","Cancel");
    keep.type = drop.type = back.type = "button";
    keep.onclick = () => go(false); drop.onclick = () => go(true);
    back.onclick = () => { box.replaceWith(folderDelete(f, n, pj, paint)); };
    box.append(el("span",null,`Delete ${f.name}?`), keep, drop, back, say);
  };
  box.append(ask, say);
  return box;
}

/* ---- changes to the file ---- */

function editCard(t){
  const pj = S.pj;
  /* A change belongs to the file it was made for, which may not be the one open now. */
  const efid = t.file || 1, here = efid === (pj.fid || 1), key = fileKeyOf(pj.slug, efid);
  const e = (here && pj.data.edits.find(x => x.id === t.edit.id)) || { id: t.edit.id, status: (!here && pj.data.editState?.[t.edit.id]) || t.edit.status || "open", preview: t.edit.preview };
  const c = el("div","pj-edit " + e.status);
  c.append(el("div","pj-ek", { open: "Proposed change", applied: "Applied", undone: "Undone", dismissed: "Turned down", gone: "Earlier change" }[e.status] || e.status));
  if (!here){ const fl = pjFiles().find(x => x.id === efid); if (fl) c.append(el("div","pj-ef",`In ${fl.name}`)); }
  for (const p of e.preview || []){
    const l = el("div","pj-ed"); l.append(el("b",null,p.label));
    if (p.before) l.append(el("del",null,p.before));
    if (p.after) l.append(el("ins",null,p.after));
    c.append(l);
  }
  const act = async (action, btns) => {
    btns.forEach(b => { b.disabled = true; });
    c.querySelector(".pj-msg")?.remove();
    try {
      await api("/api/project/edit", { brain: key, id: e.id, action });
      e.status = action === "apply" ? "applied" : action === "undo" ? "undone" : "dismissed";
      (pj.data.editState ||= {})[e.id] = e.status;
      if (here){ const known = pj.data.edits.find(x => x.id === e.id); if (known) known.status = e.status; else pj.data.edits.unshift(e); }
      c.replaceWith(editCard(t));
      /* The open file is read again when the change was to it; a change to another file shows when that file opens. */
      if (action !== "dismiss" && here) await refreshFile();
    } catch (err){
      btns.forEach(b => { b.disabled = false; });
      c.append(el("div","pj-msg",err.message));
    }
  };
  if (e.status === "gone"){ /* the change is no longer kept: nothing to press */ }
  else if (e.status === "open"){
    const row = el("div","pj-tact"), yes = el("button","go","Apply"), no = el("button","ghost","Turn down");
    yes.type = no.type = "button";
    yes.onclick = () => act("apply", [yes, no]); no.onclick = () => act("dismiss", [yes, no]);
    row.append(yes, no); c.append(row);
  } else if (e.status === "applied"){
    const row = el("div","pj-tact"), undo = el("button","ghost","Undo"); undo.type = "button";
    undo.onclick = () => act("undo", [undo]);
    row.append(undo); c.append(row);
  }
  return c;
}
/** The cards of changes follow the open file: a change made to another file says which one, and offers only what the server says is still possible. */
function repaintEdits(){
  const pj = S.pj; if (!pj?.thread) return;
  for (const t of pj.data.turns){
    if (!t.edit) continue;
    const old = [...pj.thread.querySelectorAll(".pj-turn")].find(w => w.dataset.id === String(t.id))?.querySelector(".pj-edit");
    if (old) old.replaceWith(editCard(t));
  }
}
/** The file read again after a change, so the page shows what it holds now. */
async function refreshFile(){
  const pj = S.pj; if (!pj) return;
  const want = pj.fid || 1;
  let d;
  try { d = await api("/api/project/get", { brain: pj.slug, ...pjOpen() }); }
  catch (e){ if (pj.fid > 1 && /not in this project/.test(e.message) && S.pj === pj){ pj.fid = 1; return refreshFile(); } throw e; }
  /* Another file was opened while this one was read: its answer is the one that counts. */
  if (S.pj !== pj || (pj.fid || 1) !== want) return;
  /* The first file taken out, others left: the first of those opens. */
  if (!d.file && d.files?.length && (pj.fid || 1) === 1 && d.files[0].id !== 1){ pj.fid = d.files[0].id; return refreshFile(); }
  pj.data.file = d.file; pj.data.cards = d.cards; pj.data.edits = d.edits; pj.data.files = d.files || []; pj.data.shortcuts = d.shortcuts || [];
  pj.data.editState = { ...(pj.data.editState || {}), ...(d.editState || {}) };
  pj.marks = null; pj.sheet = Math.min(pj.sheet || 0, Math.max(0, (d.file?.sheets?.length || 1) - 1));
  const old = pj.root?.querySelector(".pj-doc");
  if (old) old.replaceWith(docPane());
  const first = pj.root?.querySelector(".pj-seg")?.children[0];
  if (first) first.textContent = pjSeg(pj.data.file);
  if (pj.input) pj.input.placeholder = askHint(pj.data.file);
  repaintEdits();
  syncProjects();
}

