/* 12-projects-view.js: Projects: the side panel, opening a project, the file on the left and the project's files. */

/* ---- the side panel ---- */

function renderProjects(){
  const panel = $("projectsPanel");
  panel.hidden = S.demo;
  const box = $("projects"); box.innerHTML = "";
  $("pcount").textContent = S.projects.length || "";
  /* With no project the panel says nothing: its header and its plus are enough. */
  $("projectsBox").classList.toggle("none", !S.projects.length);
  if (!S.projects.length) return;
  for (const p of S.projects){
    const row = el("button","brain-row self pj-row" + (S.project === p.slug ? " on" : "") + (p.status === "reading" ? " run" : ""));
    const tick = el("span","tick"); tick.innerHTML = pjIcon(p.kind);
    row.append(tick, el("span","nm",p.name), el("span","cnt", p.status === "reading" ? "reading" : p.memory ? String(p.memory) : ""));
    row.title = p.files > 1 ? `${p.files} files, ${p.memory} kept in memory`
      : p.file ? `${p.file}\n${!p.chars ? "Empty: describe it in the chat" : p.kind === "table" ? "A table" : p.kind === "html" ? "A page" : p.sections + " sections"}, ${p.memory} kept in memory` : "No file yet: describe it in the chat";
    row.onclick = () => openProject(p.slug);
    box.append(row);
  }
}

/* ---- opening a project ---- */

async function openProject(slug){
  closeSide();
  document.querySelector(".veil.pm")?.remove();
  S.folder = null; S.mode = "ask"; S.project = slug;
  S.pj = { slug, data: null, seg: "chat", sheet: 0, busy: false, marks: null, fid: 1 };
  render(); paintProject();
  try { await loadProject(); }
  catch (e){
    if (S.pj?.slug !== slug) return;
    const host = $("projectView"); host.innerHTML = "";
    const err = el("div","pj-loading"); err.append(el("p",null,e.message));
    const again = el("button","mini","Try again"); again.type = "button"; again.style.marginTop = "10px"; again.onclick = () => openProject(slug);
    err.append(again); host.append(err);
  }
}
/**
 * A project holds several files. The first is kept under the project's name and the others under `name~n`; every call about one file
 * (its sections, its rows, its changes, its download, its gaps, reading it in) takes that key. The thread, the memory and the Brief
 * are the project's, and take its name.
 */
const fileKeyOf = (slug, fid) => fid > 1 ? `${slug}~${fid}` : slug;
const pjKey = () => fileKeyOf(S.pj.slug, S.pj.fid || 1);
/** What a call that opens the project says of the open file: its number, when it is not the first. */
const pjOpen = () => (S.pj.fid || 1) > 1 ? { file: S.pj.fid } : {};

async function loadProject(){
  const pj = S.pj;
  let d;
  try { d = await api("/api/project/get", { brain: pj.slug, ...pjOpen() }); }
  catch (e){
    /* A file that is gone: the first one opens instead. */
    if (pj.fid > 1 && /not in this project/.test(e.message) && S.pj === pj){ pj.fid = 1; return loadProject(); }
    throw e;
  }
  if (S.pj !== pj) return;
  /* The first file taken out, others left: the first of those opens. */
  if (!d.file && d.files?.length && (pj.fid || 1) === 1 && d.files[0].id !== 1){ pj.fid = d.files[0].id; return loadProject(); }
  pj.data = d;
  /* A file not finished opens on the file side, where the drop is. A project with no file opens on its chat, where it is described. */
  if (d.file && d.file.status !== "ready") pj.seg = "doc";
  paintProject();
  /* A file made here and not written yet, or none yet, waits for a description. */
  if ((!d.file || (d.file.status === "ready" && !d.file.chars)) && window.matchMedia("(min-width: 861px)").matches) pj.input?.focus();
}
/** The project's list entry, kept in step after a change. */
async function syncProjects(){ try { S.projects = (await api("/api/project/list")).projects || S.projects; } catch { /* the list catches up at the next refresh */ } renderProjects(); }

function paintProject(){
  const host = $("projectView"), pj = S.pj;
  closeDownload();
  /* The message bar is made again: a mic that listened in the old one stops. */
  if (rec && rec.bar !== mainBar) endVoice();
  host.innerHTML = "";
  if (!pj) return;
  if (!pj.data){ host.append(el("div","pj-loading","Opening the project")); return; }
  const root = el("div","pj"); root.dataset.seg = pj.seg; pj.root = root;
  /* On a phone the file and the chat take turns. */
  const seg = el("div","pj-seg");
  for (const [k, label] of [["doc", pjSeg(pj.data.file)], ["chat", "Chat"]]){
    const b = el("button", pj.seg === k ? "on" : "", label); b.type = "button";
    b.onclick = () => { pj.seg = k; root.dataset.seg = k; [...seg.children].forEach(x => x.classList.toggle("on", x === b)); if (k === "doc"){ fillDoc(); fillGrid(); mindMic(); } };
    seg.append(b);
  }
  root.append(seg, docPane(), chatPane());
  host.append(root);
  paintSide();
}
function showDoc(){
  const pj = S.pj; if (!pj?.root) return;
  pj.seg = "doc"; pj.root.dataset.seg = "doc";
  [...pj.root.querySelector(".pj-seg").children].forEach((x, i) => x.classList.toggle("on", i === 0));
  fillDoc(); fillGrid(); mindMic();
}
/** A mic stays in the bar it was tapped in: when a phone shows the file and hides that bar, it stops. */
function mindMic(){ const pj = S.pj; if (pj?.bar && listeningIn(pj.bar) && !pj.comp.offsetParent) endVoice(); }
function showChat(){
  const pj = S.pj; if (!pj?.root) return;
  pj.seg = "chat"; pj.root.dataset.seg = "chat";
  [...pj.root.querySelector(".pj-seg").children].forEach((x, i) => x.classList.toggle("on", i === 1));
  pj.input?.focus();
}

/* ---- the file, on the left ---- */

function docPane(){
  const pj = S.pj, d = pj.data, f = d.file;
  pj.page = pj.grid = pj.more = pj.web = null;
  const pane = el("section","pj-doc");
  const h = el("div","pj-h"), t = el("div","pj-t");
  const title = el("h2",null,d.project.name); title.title = "Rename the project"; title.onclick = renameProject;
  t.append(title);
  h.append(t);
  const acts = el("div","pj-acts");
  const btn = (label, fn, cls) => { const b = el("button","pj-b" + (cls ? " " + cls : ""),label); b.type = "button"; b.onclick = fn; acts.append(b); return b; };
  const ready = f?.status === "ready", written = ready && f.chars > 0;
  if (written && f.kind === "html"){
    /* A page is read as it renders, or as its code. */
    const view = el("div","pj-view"); pj.viewBtns = [];
    for (const [k, label] of [["page","Page"],["code","Code"]]){
      const b = el("button", (pj.view || "page") === k ? "on" : "", label); b.type = "button";
      b.onclick = () => { pj.view = k; applyView(); };
      view.append(b); pj.viewBtns.push([k, b]);
    }
    acts.append(view);
  }
  /* Only a project with no file offers to add one. A file it holds stays: the chat changes it, and another file is another project. */
  if (!f) btn("Add a file", () => chooseFile());
  if (written) btn("Gaps", e => openGaps(e.currentTarget)).setAttribute("aria-haspopup", "menu");
  if (written) btn("Download", e => openDownload(e.currentTarget)).setAttribute("aria-haspopup", "menu");
  btn("Delete", deleteProject, "bad").title = "Delete the project with all its files";
  h.append(acts); pane.append(h);
  /* The files the project holds: one is open, and the chat changes that one. */
  if (pjFiles().length) pane.append(fileStrip());
  const body = el("div","pj-body"); pj.body = body; pane.append(body);
  if (!f || !ready) body.append(dropZone(f));
  else if (!written) body.append(emptyFile(f));
  else if (f.kind === "table") paintGrid(body);
  else if (f.kind === "html") paintPage(body);
  else paintPaper(body);
  return pane;
}

/* ---- the files of a project ---- */

/** The files the project holds, the first one leading. A server older than this page sends the open file alone. */
function pjFiles(){
  const d = S.pj?.data; if (!d) return [];
  return d.files?.length ? d.files : d.file ? [{ id: d.file.id || 1, name: d.file.name, kind: d.file.kind, status: d.file.status }] : [];
}

/** A tab for each file with the open one marked, a plus for another file, and the open file's own menu. */
function fileStrip(){
  const pj = S.pj, files = pjFiles(), open = pj.fid || 1;
  const strip = el("div","pj-files"); strip.setAttribute("role","group"); strip.setAttribute("aria-label","Files of the project");
  const tabs = el("div","pj-ftabs");
  for (const f of files){
    const b = el("button","pj-fc" + (f.id === open ? " on" : "") + (f.status !== "ready" ? " half" : "")); b.type = "button"; b.dataset.fid = String(f.id);
    b.title = f.status !== "ready" ? `${f.name} (not finished)` : f.name;
    if (f.id === open) b.setAttribute("aria-current","true");
    const ic = el("i"); ic.innerHTML = pjIcon(f.kind);
    b.append(ic, el("span",null,f.name));
    b.onclick = () => openFile(f.id);
    tabs.append(b);
  }
  strip.append(tabs);
  const plus = el("button","pj-fp"); plus.type = "button"; plus.id = "pjFilePlus"; plus.setAttribute("aria-label","Add a file"); plus.setAttribute("aria-haspopup","menu"); plus.title = "Add a file, or make a new one";
  plus.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>`;
  plus.onclick = () => openAddMenu(plus);
  const more = el("button","pj-fm"); more.type = "button"; more.id = "pjFileMore"; more.setAttribute("aria-label","Rename or remove the open file"); more.setAttribute("aria-haspopup","menu"); more.title = "Rename or remove this file";
  more.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>`;
  more.onclick = () => openFileMenu(more);
  strip.append(plus, more);
  /* A strip longer than its room shows the open tab, and fades at the edge where more tabs wait. */
  const fade = () => tabs.classList.toggle("fade", tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
  tabs.onscroll = fade;
  setTimeout(() => { const on = tabs.querySelector(".on"); if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, on.offsetLeft - 24); fade(); }, 0);
  return strip;
}

/** A call about the project's files. A server older than this page has no such route, and answers with something unreadable. */
async function fileCall(body){
  const pj = S.pj;
  try { return await api("/api/project/file", { brain: pj.slug, ...body }); }
  catch (e){ throw new Error(/unreadable/.test(e.message) ? "The server is older than this page and cannot hold several files yet. Run convex deploy." : e.message); }
}

/** A file of the project opens on the left. From then on the chat changes that one. */
async function showFile(fid){
  const pj = S.pj; if (!pj?.data) return;
  const was = pj.fid || 1;
  pj.fid = fid; pj.marks = null; pj.sheet = 0; pj.view = undefined;
  try { await refreshFile(); }
  catch (e){ if (S.pj === pj){ pj.fid = was; pjNote(e.message); } }
}
function openFile(fid){ if (S.pj?.data && fid !== (S.pj.fid || 1)) return showFile(fid); }

/** The open file's menu: its name, or its removal. */
function openFileMenu(anchor){
  if (!S.pj?.data?.file) return;
  popMenu(anchor, "This file", menu => {
    for (const [k, label, fn] of [["rename", "Rename", renameFile], ["remove", "Remove", removeFile]]){
      const b = el("button"); b.type = "button"; b.dataset.act = k; b.setAttribute("role","menuitem");
      b.append(el("b",null,label));
      b.onclick = () => { closeDownload(); fn(); };
      menu.append(b);
    }
  });
}
/** The plus: a file you have, or a blank document, table or page to describe in the chat. */
function openAddMenu(anchor){
  popMenu(anchor, "Add to the project", menu => {
    for (const [k, label, hint] of [["add","Add a file","Word, PDF, Excel"], ["doc","New document","blank"], ["table","New table","blank"], ["html","New page","blank"]]){
      const b = el("button"); b.type = "button"; b.dataset.add = k; b.setAttribute("role","menuitem");
      b.append(el("b",null,label), el("span",null,hint));
      b.onclick = () => { closeDownload(); if (k === "add") chooseMore(); else newFile(k); };
      menu.append(b);
    }
  });
}

/** A file picked to join the project's others. */
function chooseMore(){ pickFile(PJ_FILES, file => addFile(file)); }
/** A file read here and filed in sections as a file of its own. A file that cannot be read makes none. */
async function addFile(file){
  const pj = S.pj; if (!pj?.data) return;
  const sh = progressSheet(`Reading ${file.name}`);
  let made = null;
  try {
    const got = await readProjectFile(file, sh.read);
    made = await fileCall({ action: "new", kind: got.kind, name: got.name, made: false });
    await uploadProject(made.key, got, sh.store);
    sh.close();
    await syncProjects();
    if (S.pj === pj) await showFile(made.fid);
  } catch (e){
    sh.fail(made ? `${e.message} The file is in the strip: open it to add it again.` : e.message);
    await syncProjects();
    if (made && S.pj === pj) await showFile(made.fid);
  }
}

/** A blank document, table or page, made at once. The chat waits for its description. */
async function newFile(kind){
  const pj = S.pj; if (!pj?.data) return;
  const taken = new Set(pjFiles().map(f => String(f.name).toLowerCase()));
  let name = `New ${pjNoun(kind)}`, i = 1;
  while (taken.has(name.toLowerCase())) name = `New ${pjNoun(kind)} ${++i}`;
  try {
    const made = await fileCall({ action: "new", kind, name });
    await syncProjects();
    if (S.pj !== pj) return;
    await showFile(made.fid);
    showChat();
  } catch (e){ pjNote(e.message); }
}

/** A file's name: a sheet with one field. */
function renameFile(){
  const pj = S.pj, f = pj.data.file; if (!f) return;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rfTitle">
    <header><h3 id="rfTitle">Rename the file</h3></header>
    <div class="f"><label for="rfName">Name</label><input id="rfName" autocomplete="off" maxlength="120"></div>
    <div class="bad" id="rfBad"></div>
    <footer><button class="ghost" id="rfCancel">Cancel</button><button class="go" id="rfSave">Save</button></footer></div>`;
  document.body.append(veil);
  const inp = veil.querySelector("#rfName"), bad = veil.querySelector("#rfBad"), save = veil.querySelector("#rfSave");
  inp.value = f.name;
  const shut = () => veil.remove();
  const run = async () => {
    const name = inp.value.trim(); if (!name) return;
    save.disabled = true;
    try { await fileCall({ action: "rename", file: pj.fid || 1, name }); shut(); if (S.pj === pj){ await refreshFile(); } }
    catch (e){ save.disabled = false; bad.textContent = e.message; }
  };
  save.onclick = run; inp.onkeydown = e => { if (e.key === "Enter") run(); if (e.key === "Escape") shut(); };
  veil.querySelector("#rfCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

/** A file taken out of the project: its sections, its changes and the notes that rest on it. The other files stay. */
function removeFile(){
  const pj = S.pj, f = pj.data.file; if (!f) return;
  const fid = pj.fid || 1, others = pjFiles().filter(x => x.id !== fid);
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rmTitle">
    <header><h3 id="rmTitle"></h3><p>Its sections and its changes go, and the notes that rest on it are marked as possibly outdated. ${others.length ? "The other files stay." : "The project stays, with no file."} This cannot be undone.</p></header>
    <div class="bad" id="rmBad"></div>
    <footer><button class="ghost" id="rmCancel">Cancel</button><button class="go danger" id="rmYes">Remove the file</button></footer></div>`;
  veil.querySelector("#rmTitle").textContent = `Remove ${f.name}?`;
  document.body.append(veil);
  const yes = veil.querySelector("#rmYes"), bad = veil.querySelector("#rmBad"), shut = () => veil.remove();
  yes.onclick = async () => {
    yes.disabled = true; yes.textContent = "Removing";
    try {
      await fileCall({ action: "remove", file: fid });
      shut();
      if (S.pj !== pj) return;
      /* The file before it opens, or the next, or the first one that is left. */
      const files = pjFiles(), at = files.findIndex(x => x.id === fid);
      const next = files[at - 1] || files[at + 1];
      pj.fid = next ? next.id : 1; pj.marks = null; pj.sheet = 0; pj.view = undefined;
      await refreshFile();
      refreshMemory();
    } catch (e){ yes.disabled = false; yes.textContent = "Remove the file"; bad.textContent = e.message; }
  };
  veil.querySelector("#rmCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
}

/** A file made here and not written yet: what to do, and a way to start. */
function emptyFile(f){
  const z = el("div","pj-empty");
  z.append(el("h3",null,`This ${pjNoun(f.kind)} is empty`),
    el("p",null,`Describe it in the chat. The chat writes it here, and changes it as you go. You can undo any change.`));
  const b = el("button","go","Describe it"); b.type = "button"; b.onclick = () => showChat();
  z.append(b);
  return z;
}

/** A page: its code run in a frame of its own, which can reach nothing of this app; or its code as text. */
function paintPage(body){
  const pj = S.pj;
  body.classList.add("web");
  const frame = el("iframe","pj-frame"); frame.title = "The page"; frame.setAttribute("sandbox","allow-scripts allow-popups");
  const code = el("pre","pj-code");
  body.append(frame, code);
  pj.web = { frame, code };
  applyView();
  loadPage();
}
function applyView(){
  const pj = S.pj, w = pj?.web; if (!w) return;
  const code = pj.view === "code";
  w.frame.hidden = code; w.code.hidden = !code;
  for (const [k, b] of pj.viewBtns || []) b.classList.toggle("on", (pj.view || "page") === k);
}
async function loadPage(){
  const pj = S.pj, w = pj?.web; if (!w) return;
  try {
    const r = await api("/api/project/download", { brain: pjKey() });
    if (S.pj !== pj || pj.web !== w) return;
    w.frame.srcdoc = r.text; w.code.textContent = r.text;
  } catch (e){ w.code.textContent = e.message; pj.view = "code"; applyView(); }
}

function dropZone(f){
  const z = el("div","pj-drop");
  z.append(el("h3",null, f ? "This file was not finished" : "Drop the file or the table this project is built on"),
    el("p",null, f ? "Its reading stopped part way. Drop it again to read it from the start."
      : "Word, PDF, text, Markdown, HTML, Excel or CSV. It is read in this tab and filed in sections, so a long file answers fast. Or describe what you want in the chat, and it is made here."));
  const b = el("button","go",f ? "Choose the file again" : "Choose a file"); b.type = "button"; b.onclick = () => chooseFile();
  z.append(b);
  z.ondragover = e => { e.preventDefault(); z.classList.add("over"); };
  z.ondragleave = () => z.classList.remove("over");
  z.ondrop = e => { e.preventDefault(); z.classList.remove("over"); const file = e.dataTransfer?.files?.[0]; if (file) fillProject(S.pj.slug, file, S.pj.fid || 1); };
  return z;
}

/** A document: its sections, read on as the page scrolls. */
function paintPaper(body){
  const pj = S.pj;
  const paper = el("div","pj-paper"), page = el("article","pj-page");
  paper.append(page);
  const more = el("div","pj-more");
  body.append(paper, more);
  pj.page = page; pj.more = more; pj.docLast = -1; pj.docEnd = false; pj.docBusy = false;
  body.onscroll = () => { if (!pj.docEnd && body.scrollTop + body.clientHeight > body.scrollHeight - 700) loadSections(); };
  loadSections();
}
async function loadSections(o = {}){
  const pj = S.pj;
  if (!pj?.page || pj.docBusy) return;
  pj.docBusy = true;
  try {
    const r = await api("/api/project/doc", { brain: pjKey(), n: 3, ...(o.sid != null ? { sid: o.sid } : { from: pj.docLast }) });
    if (S.pj !== pj) return;
    if (o.replace){ pj.page.innerHTML = ""; pj.docEnd = false; }
    for (const s of r.sections){
      const a = el("section","pj-sec"); a.dataset.sid = s.sid;
      const md = el("div","pj-md"); md.innerHTML = mdView(s.text); a.append(md);
      pj.page.append(a); pj.docLast = s.ord;
    }
    if (r.sections.length < 3) pj.docEnd = true;
    pj.more.textContent = pj.docEnd ? "End of the file" : "";
    applyMarks();
  } catch (e){ pj.more.textContent = "Could not load more: " + e.message; pj.docEnd = true; }
  finally { pj.docBusy = false; }
  fillDoc();
}
/** A tall screen shows more than three sections: keep reading while the page is on screen and not yet full. */
function fillDoc(){
  const pj = S.pj, b = pj?.body;
  if (pj?.page && !pj.docEnd && !pj.docBusy && b.clientHeight > 0 && b.scrollHeight <= b.clientHeight + 700) loadSections();
}

/** A table: a tab for each sheet, a grid with its row numbers, and what each column holds. */
function paintGrid(body){
  const pj = S.pj, f = pj.data.file, si = Math.min(pj.sheet, f.sheets.length - 1), sh = f.sheets[si];
  body.classList.add("tbl");
  if (f.sheets.length > 1){
    const tabs = el("div","pj-sheets");
    f.sheets.forEach((s, i) => { const b = el("button", i === si ? "on" : "", s.name); b.type = "button"; b.onclick = () => { pj.sheet = i; body.innerHTML = ""; body.classList.remove("tbl"); paintGrid(body); }; tabs.append(b); });
    body.append(tabs);
  }
  const wrap = el("div","pj-gridwrap"), tbl = el("table","pj-grid"), thead = el("thead"), tr = el("tr");
  tr.append(Object.assign(el("th","r"), { textContent: "#" }));
  for (const c of sh.cols.length ? sh.cols : (sh.header || []).map(n => ({ name: n, kind: "text" }))) tr.append(el("th", c.kind === "num" ? "n" : "", c.name));
  thead.append(tr);
  const tb = el("tbody");
  tbl.append(thead, tb); wrap.append(tbl); body.append(wrap);
  const foot = el("details","pj-foot"), sum = el("summary");
  sum.innerHTML = `<b>${sh.rows.toLocaleString("en-US")}</b> rows · <b>${sh.cols.length}</b> columns · what each column holds`;
  foot.append(sum);
  const n = x => (x ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  for (const c of sh.cols){
    const ln = el("span","ln");
    ln.innerHTML = c.kind === "num"
      ? `<b>${esc(c.name)}</b>: total ${n(c.sum)} · average ${n(c.avg)} · lowest ${n(c.min)} · highest ${n(c.max)}`
      : `<b>${esc(c.name)}</b>${c.values ? ": " + esc(c.values.join(", ")) : ""}`;
    foot.append(ln);
  }
  body.append(foot);
  pj.grid = { tb, wrap, sheet: si, last: 0, total: sh.rows, busy: false, cols: sh.cols };
  wrap.onscroll = () => { if (wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 500) loadRows(); };
  loadRows();
}
async function loadRows(o = {}){
  const pj = S.pj, g = pj?.grid;
  if (!g || g.busy || g.last >= g.total && !o.from) return;
  g.busy = true;
  try {
    const from = o.from ?? g.last + 1;
    const r = await api("/api/project/rows", { brain: pjKey(), sheet: g.sheet, from, n: 100 });
    if (S.pj !== pj || pj.grid !== g) return;
    if (o.replace) g.tb.innerHTML = "";
    for (const row of r.rows){
      const tr = el("tr"); tr.dataset.n = row.n;
      tr.append(Object.assign(el("td","r"), { textContent: row.n }));
      row.cells.forEach((c, i) => tr.append(Object.assign(el("td", g.cols[i]?.kind === "num" ? "n" : ""), { textContent: c, title: c.length > 40 ? c : "" })));
      g.tb.append(tr); g.last = row.n;
    }
    g.total = r.total;
    applyMarks();
  } catch (e){ /* the grid keeps what it has */ }
  finally { g.busy = false; }
  fillGrid();
}
function fillGrid(){
  const g = S.pj?.grid;
  if (g && !g.busy && g.last < g.total && g.wrap.clientHeight > 0 && g.wrap.scrollHeight <= g.wrap.clientHeight + 500) loadRows();
}

/* ---- what an answer used, marked in the file ---- */

/** Wrap each quote the answer rests on, where the words stand in the file. */
function markQuotes(root, quotes){
  root.querySelectorAll("mark.pj-mark").forEach(m => m.replaceWith(...m.childNodes));
  root.normalize();
  for (const q of quotes || []){
    const needle = q.replace(/[|*_`#>]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (needle.length < 6) continue;
    const nodes = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    let hay = ""; const at = [];
    for (const t of nodes){
      const s = t.nodeValue;
      for (let i = 0; i < s.length; i++){
        const c = /\s/.test(s[i]) ? " " : s[i].toLowerCase();
        if (c === " " && hay.endsWith(" ")) continue;
        hay += c; at.push([t, i]);
      }
      /* Two cells or two paragraphs read as separate words. */
      if (at.length && !hay.endsWith(" ")){ hay += " "; at.push(at[at.length - 1]); }
    }
    const k = hay.indexOf(needle);
    if (k < 0) continue;
    /* One mark for each stretch of text inside one node, so words that run across two cells or two paragraphs are marked in both. */
    const spans = new Map();
    for (let i = k; i < k + needle.length; i++){
      const [t, o] = at[i], cur = spans.get(t);
      if (cur) cur[1] = Math.max(cur[1], o + 1); else spans.set(t, [o, o + 1]);
    }
    for (const [t, [from, to]] of spans){
      if (!t.nodeValue.slice(from, to).trim()) continue;
      try {
        const r = document.createRange(); r.setStart(t, from); r.setEnd(t, to);
        const m = document.createElement("mark"); m.className = "pj-mark"; r.surroundContents(m);
      } catch { /* the section's bar still shows where it was found */ }
    }
  }
}
function applyMarks(){
  const pj = S.pj; if (!pj) return;
  const m = pj.marks || { sids: new Set(), rows: new Set(), quotes: [] };
  pj.page?.querySelectorAll(".pj-sec").forEach(s => s.classList.toggle("used", m.sids.has(Number(s.dataset.sid))));
  if (pj.page && m.quotes.length) markQuotes(pj.page, m.quotes); else if (pj.page) markQuotes(pj.page, []);
  pj.grid?.tb.querySelectorAll("tr").forEach(r => r.classList.toggle("used", m.rows.has(Number(r.dataset.n))));
}
/** Show what an answer used: its sections and quotes, or its rows, marked and brought into view. */
async function focusUsed(t, scroll){
  const pj = S.pj, u = t?.used?.file; if (!pj || !u) return;
  /* Sections and rows are numbered in their own file: an answer about another file marks nothing in this one. */
  if ((t.file || 1) !== (pj.fid || 1)){ pj.marks = null; applyMarks(); return; }
  pj.marks = { sids: new Set((u.sections || []).map(s => s.sid)), rows: new Set(u.rows || []), quotes: t.quotes || [] };
  const f = pj.data.file;
  if (f?.kind === "table" && u.rows?.length){
    const sheet = u.sheet ?? 0;
    if (pj.sheet !== sheet){ pj.sheet = sheet; pj.body.innerHTML = ""; pj.body.classList.remove("tbl"); paintGrid(pj.body); }
    const first = u.rows[0];
    if (scroll && !pj.grid.tb.querySelector(`tr[data-n="${first}"]`)) await loadRows({ from: Math.max(1, first - 5), replace: true });
    applyMarks();
    if (scroll){ showDoc(); pj.grid.tb.querySelector(`tr[data-n="${first}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }
  } else if (f?.kind === "doc" && u.sections?.length){
    const first = u.sections[0].sid;
    if (scroll && !pj.page.querySelector(`[data-sid="${first}"]`)) await loadSections({ sid: first, replace: true });
    applyMarks();
    if (scroll){ showDoc(); pj.page.querySelector(`[data-sid="${first}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  } else applyMarks();
}

