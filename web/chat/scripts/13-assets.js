/* 13-assets.js: Assets: the documents, tables and pages a chat calls with @. The side panel's list, adding one, the asset open in the
   main area, turning the projects made before into assets, and the cards of what a chat proposes to change or to make. */

const assetById = fid => (S.assets || []).find(a => a.id === fid);
/** What the list says beside a name: its size, or that it is still being read. */
function assetMeta(a){
  if (!a || a.status !== "ready") return "reading";
  if (a.kind === "table") return `${(a.rows ?? 0).toLocaleString("en-US")} rows`;
  if (!a.chars) return "empty";
  return a.kind === "html" ? "page" : `${a.sections || 1} section${a.sections === 1 ? "" : "s"}`;
}

/* ---- the side panel ---- */
function renderAssets(){
  const panel = $("assetsPanel");
  panel.hidden = S.demo;
  const box = $("assets"); box.innerHTML = "";
  const list = S.assets || [];
  $("acount").textContent = list.length || "";
  /* Projects held from before become assets, once, when the owner says so. */
  const old = S.demo ? [] : (S.projects || []);
  if (old.length){
    const conv = el("button","as-convert"); conv.type = "button"; conv.id = "assetsConvert";
    conv.textContent = `Turn ${old.length} project${old.length === 1 ? "" : "s"} into assets`;
    conv.onclick = openConvert;
    box.append(conv);
  }
  /* With no asset the list says where to start, and takes a file dropped on it. */
  if (!list.length){ box.append(el("div","side-note as-none","Drop a document, a table or a page here. Call it in a chat with @.")); return; }
  for (const a of list){
    const row = el("button","brain-row self pj-row as-row" + (S.asset === a.id ? " on" : "") + (a.status !== "ready" ? " run" : ""));
    row.dataset.fid = String(a.id);
    const tick = el("span","tick"); tick.innerHTML = pjIcon(a.kind);
    row.append(tick, el("span","nm",a.name), el("span","cnt", assetMeta(a)));
    row.title = `${a.name}\n${kindTitle(a)}. In a chat, call it with @.`;
    row.onclick = () => openAsset(a.id);
    box.append(row);
  }
}
/** The list read again after a change. */
async function syncAssets(){
  try { S.assets = (await api("/api/assets/list")).assets || []; } catch { /* the list catches up at the next refresh */ }
  renderAssets();
}
/* A file dropped on the panel is added. */
{
  const panel = $("assetsPanel");
  const carries = e => [...(e.dataTransfer?.types || [])].includes("Files");
  panel.addEventListener("dragover", e => { if (!carries(e) || S.demo) return; e.preventDefault(); panel.classList.add("over"); });
  panel.addEventListener("dragleave", e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("over"); });
  panel.addEventListener("drop", e => { if (!carries(e) || S.demo) return; e.preventDefault(); panel.classList.remove("over"); const files = [...(e.dataTransfer?.files || [])]; if (files.length) addAssets(files); });
}

/** The +: files you have, or a blank document, table or page to fill from a chat. */
function openAssetAdd(anchor){
  popMenu(anchor, "Add an asset", menu => {
    for (const [k, label, hint] of [["add","Add files","Word, PDF, Excel, CSV, HTML"], ["link","Add a link","a web page, read and kept"], ["doc","New document","blank"], ["table","New table","blank"], ["html","New page","blank"]]){
      const b = el("button"); b.type = "button"; b.dataset.add = k; b.setAttribute("role","menuitem");
      b.append(el("b",null,label), el("span",null,hint));
      b.onclick = () => { closeDownload(); if (k === "add") pickFiles(PJ_FILES, files => addAssets(files)); else if (k === "link") askLink(); else newAsset(k); };
      menu.append(b);
    }
  });
}

/* ---- adding ---- */
/** Files added one after the other. A file named as an asset already held asks first: a new version of it, or a second asset. */
async function addAssets(files){
  for (const file of files){
    const same = (S.assets || []).find(a => a.name.toLowerCase() === String(file.name).toLowerCase());
    const prev = same ? await askVersion(same) : 0;
    if (prev === null) continue;
    await addAsset(file, prev || 0);
  }
}
/** "New version, or keep both?": the id of the asset to replace, 0 to keep both, null to add nothing. */
function askVersion(a){
  return new Promise(done => {
    const veil = el("div","veil");
    veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="avTitle"><header><h3 id="avTitle"></h3>
      <p>A new version takes its place, and every chat calls it by the same name. The version before is kept: Undo brings it back.</p></header>
      <footer><button class="ghost" id="avCancel" type="button">Cancel</button><button class="ghost" id="avBoth" type="button">Keep both</button><button class="go" id="avNew" type="button">New version</button></footer></div>`;
    veil.querySelector("h3").textContent = `${a.name} is an asset already`;
    document.body.append(veil);
    const end = v => { veil.remove(); done(v); };
    veil.querySelector("#avNew").onclick = () => end(a.id);
    veil.querySelector("#avBoth").onclick = () => end(0);
    veil.querySelector("#avCancel").onclick = () => end(null);
    veil.onclick = e => { if (e.target === veil) end(null); };
  });
}
/** One file read here, sent a piece at a time, and opened. With `prev`, it is that asset's new version. */
async function addAsset(file, prev = 0){
  const sh = progressSheet(`Reading ${file.name}`);
  let made = null;
  try {
    const got = await readFileIn(file, sh.read);
    made = await api("/api/assets/new", { kind: got.kind, name: got.name, made: false, ...(prev ? { prev } : {}) });
    await uploadAsset(made.fid, got, sh.store);
    sh.close();
    await syncAssets();
    openAsset(made.fid);
  } catch (e){
    sh.fail(made ? `${e.message} It is in Assets, not finished: open it to choose the file again.` : /unreadable/.test(e.message) ? "The server is older than this page and cannot keep assets yet. Run convex deploy." : e.message);
    await syncAssets();
  }
}
/* ---- a web page kept as an asset ---- */
/** The name a page is kept under: its address, without the https and the trailing slash. */
const linkName = url => String(url).replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").slice(0, 120) || "Web page";
/** "Add a link": an address, read by the server, kept as a document. */
function askLink(){
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="alTitle">
    <header><h3 id="alTitle">Add a link</h3><p>The page is read and kept as an asset, up to 60,000 characters. A chat calls it with @. Read it again from the asset when the page changes: the version before is kept for Undo.</p></header>
    <div class="f"><label for="alUrl">Address</label><input id="alUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://jeremylasne.com/invest"></div>
    <div class="f"><div class="bad" id="alBad"></div></div>
    <footer><button class="ghost" id="alCancel" type="button">Cancel</button><button class="go" id="alGo" type="button">Read it</button></footer></div>`;
  document.body.append(veil);
  const inp = veil.querySelector("#alUrl"), go = veil.querySelector("#alGo"), bad = veil.querySelector("#alBad");
  const shut = () => veil.remove();
  const run = async () => {
    let url = inp.value.trim(); if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const same = (S.assets || []).find(a => a.url === url || a.name.toLowerCase() === linkName(url).toLowerCase());
    shut();
    const prev = same ? await askVersion(same) : 0;
    if (prev === null) return;
    await addLink(url, prev || 0);
  };
  go.onclick = run; inp.onkeydown = e => { if (e.key === "Enter") run(); if (e.key === "Escape") shut(); };
  veil.querySelector("#alCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  setTimeout(() => inp.focus(), 30);
}
/** A page read by the server and kept: as a new asset, or with `prev` as that asset's new version. */
async function addLink(url, prev = 0){
  const name = linkName(url);
  const sh = progressSheet(`Reading ${name}`);
  let made = null;
  try {
    sh.read(`Reading ${name}`);
    const page = await api("/api/fetch", { url });
    made = await api("/api/assets/new", { kind: "doc", name, made: false, url: page.url || url, ...(prev ? { prev } : {}) });
    await uploadAsset(made.fid, { kind: "doc", name, text: page.text }, sh.store);
    sh.close();
    await syncAssets();
    await openAsset(made.fid);
    if (page.cut) pjNote("Only the first 60,000 characters of the page were kept.");
  } catch (e){
    sh.fail(made ? `${e.message} It is in Assets, not finished: read it again from there.` : /unreadable/.test(e.message) ? "The server is older than this page and cannot keep assets yet. Run convex deploy." : e.message);
    await syncAssets();
  }
}

/** A blank document, table or page, made at once and opened. A chat that tags it fills it. */
async function newAsset(kind){
  const base = { doc: "New document", table: "New table", html: "New page" }[kind] || "New document";
  const taken = new Set((S.assets || []).map(a => a.name.toLowerCase()));
  let name = base, n = 1; while (taken.has(name.toLowerCase())) name = `${base} ${++n}`;
  try {
    const r = await api("/api/assets/new", { kind, name });
    await syncAssets();
    openAsset(r.fid);
  } catch (e){ chatMsg(/unreadable/.test(e.message) ? "The server is older than this page and cannot keep assets yet. Run convex deploy." : e.message); }
}

/* ---- the viewer ---- */
/** An asset open in the main area, as it reads: a document's pages, a table's grid, a page as it renders. */
async function openAsset(fid){
  closeSide(); closeDownload();
  S.folder = null; S.mode = "ask"; S.asset = fid;
  S.pj = { fid, data: null, sheet: 0 };
  render();
  try { await loadAsset(); }
  catch (e){
    if (S.pj?.fid !== fid) return;
    const host = $("assetView"); host.innerHTML = "";
    const err = el("div","pj-loading"); err.append(el("p",null,e.message));
    const again = el("button","mini","Try again"); again.type = "button"; again.style.marginTop = "10px"; again.onclick = () => openAsset(fid);
    err.append(again); host.append(err);
  }
}
async function loadAsset(){
  const pj = S.pj;
  const d = await assetCall("/api/assets/get");
  if (S.pj !== pj) return;
  pj.data = d;
  paintAsset();
}
function paintAsset(){
  const host = $("assetView"), pj = S.pj;
  closeDownload();
  host.innerHTML = "";
  if (!pj) return;
  if (!pj.data){
    /* While it opens, its shape stands where it will be. */
    const root = el("div","pj pj-opening"); root.setAttribute("aria-busy","true"); root.setAttribute("aria-label","Opening the asset");
    const doc = el("section","pj-doc"), h = el("div","pj-h"); h.append(skelLines([["34%", 18]]));
    const body = el("div","pj-body"), paper = el("div","pj-paper"), page = el("article","pj-page");
    page.append(skelLines()); paper.append(page); body.append(paper); doc.append(h, body); root.append(doc);
    host.append(root); return;
  }
  const root = el("div","pj"); pj.root = root;
  root.append(assetPane());
  host.append(root);
}
/**
 * The asset's pane: its name, what it is, what can be done with it, and what it holds. `keep` comes from the pane it takes over for the
 * same asset: where it was scrolled to, and what each section and row held, so the new one opens at the same place and lights up what
 * changed. `pj.ready` settles once the pane shows something.
 */
function assetPane(o = {}){
  const pj = S.pj, f = pj.data.file, a = assetById(pj.fid) || {};
  pj.page = pj.grid = pj.more = pj.web = null;
  pj.keep = o.keep || null;
  pj.ready = new Promise(ok => { pj.isReady = ok; });
  const pane = el("section","pj-doc");
  pane.dataset.fid = String(pj.fid); pane.dataset.kind = f?.kind || "";
  const h = el("div","pj-h"), t = el("div","pj-t");
  const title = el("h2",null,f.name); title.title = "Rename it"; title.onclick = renameAsset;
  t.append(title, el("span","as-sub", a.url ? `Web page · read ${new Date(f.at || Date.now()).toISOString().slice(0, 10)} from ${a.url} · call it in a chat with @`
    : `${kindTitle(f)} · ${assetMeta({ ...a, ...f, sections: f.sections, rows: a.rows })} · call it in a chat with @`));
  h.append(t);
  const acts = el("div","pj-acts");
  const btn = (label, fn, cls) => { const b = el("button","pj-b" + (cls ? " " + cls : ""),label); b.type = "button"; b.onclick = fn; acts.append(b); return b; };
  const ready = f.status === "ready", written = ready && f.chars > 0;
  btn("Ask about it", askAboutAsset, "go").title = "A new chat, with this asset called";
  if (written && f.kind === "html"){
    const view = el("div","pj-view"); pj.viewBtns = [];
    for (const [k, label] of [["page","Page"],["code","Code"]]){
      const b = el("button", (pj.view || "page") === k ? "on" : "", label); b.type = "button";
      b.onclick = () => { pj.view = k; applyView(); };
      view.append(b); pj.viewBtns.push([k, b]);
    }
    acts.append(view);
  }
  if (written) btn("Download", e => openDownload(e.currentTarget)).setAttribute("aria-haspopup", "menu");
  if (a.url) btn("Read it again", () => addLink(a.url, pj.fid)).title = "Read the page again as this asset's new version: the one before is kept for Undo";
  else btn("New version", () => pickFile(PJ_FILES, file => addAsset(file, pj.fid))).title = "Read a file in as this asset's new version: the one before is kept for Undo";
  btn("Delete", deleteAsset, "bad");
  h.append(acts); pane.append(h);
  /* A new version can be taken back while the one before is kept. */
  if (a.undo){
    const v = el("div","as-ver"); v.append(el("span",null,"This is a new version. The one before is kept."));
    const u = el("button","mini","Undo"); u.type = "button"; u.onclick = () => undoVersion(u);
    v.append(u); pane.append(v);
  }
  const body = el("div","pj-body"); pj.body = body; pane.append(body);
  if (!ready){ pj.isReady(); body.append(assetUnfinished(f)); }
  else if (!written){ pj.isReady(); body.append(assetEmpty(f)); }
  else if (f.kind === "table") paintGrid(body);
  else if (f.kind === "html") paintPage(body);
  else paintPaper(body);
  return pane;
}
function assetEmpty(f){
  const z = el("div","pj-empty");
  z.append(el("h3",null,`This ${pjNoun(f.kind)} is empty`),
    el("p",null,`Call it in a chat with @ and say what to put in it: "@${f.name} a table of my monthly expenses". The chat proposes it, and you apply it.`));
  const b = el("button","go","Fill it from a chat"); b.type = "button"; b.onclick = askAboutAsset;
  z.append(b);
  return z;
}
function assetUnfinished(f){
  const z = el("div","pj-drop");
  z.append(el("h3",null,"This file was not finished"), el("p",null,"Its reading stopped part way. Choose it again to read it from the start."));
  const b = el("button","go","Choose the file again"); b.type = "button";
  const a = assetById(S.pj?.fid);
  b.onclick = () => a?.url ? addLink(a.url, 0).then(() => api("/api/assets/file", { action: "remove", file: a.id })).then(syncAssets) : pickFile(PJ_FILES, file => refillAsset(file));
  z.append(b);
  return z;
}
/** The open asset read in again from the start, from a file chosen again. */
async function refillAsset(file){
  const pj = S.pj; if (!pj) return;
  const sh = progressSheet(`Reading ${file.name}`);
  try {
    const got = await readFileIn(file, sh.read);
    await uploadAsset(pj.fid, got, sh.store);
    sh.close();
  } catch (e){ sh.fail(e.message); }
  await syncAssets();
  if (S.pj === pj) await loadAsset();
}
/** The open asset read again after a change, drawn in place: the same scroll, and what changed glows. */
async function refreshAsset(){
  const pj = S.pj; if (!pj) return;
  const d = await assetCall("/api/assets/get");
  if (S.pj !== pj) return;
  pj.data = d;
  const old = pj.root?.querySelector(".pj-doc:not(.pj-prev)");
  if (!old){ paintAsset(); return; }
  const same = old.dataset.kind === (d.file?.kind || "") && !!d.file?.chars;
  const keep = same ? { top: old.querySelector(".pj-body")?.scrollTop || 0, gtop: old.querySelector(".pj-gridwrap")?.scrollTop || 0,
    secs: new Map([...old.querySelectorAll(".pj-sec")].map(x => [x.dataset.sid, x._text])),
    rows: new Set([...old.querySelectorAll(".pj-grid tbody tr[data-n]")].map(x => x._cells)) } : null;
  await swapDoc(old, assetPane({ keep }));
}
/** A new chat with this asset called, ready for the question. */
function askAboutAsset(){
  const f = S.pj?.data?.file; if (!f) return;
  newChat();
  $("input").value = `@${f.name} `; sizeBox(); renderComposer();
  const inp = $("input"); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
}
function renameAsset(){
  const pj = S.pj; if (!pj) return;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="arTitle">
    <header><h3 id="arTitle">Rename the asset</h3><p>A chat calls it by this name, with @.</p></header>
    <div class="f"><label for="arName">Name</label><input id="arName" autocomplete="off" maxlength="200"></div>
    <div class="bad" id="arBad"></div>
    <footer><button class="ghost" id="arCancel" type="button">Cancel</button><button class="go" id="arSave" type="button">Save</button></footer></div>`;
  document.body.append(veil);
  const inp = veil.querySelector("#arName"), bad = veil.querySelector("#arBad"), save = veil.querySelector("#arSave");
  inp.value = pj.data.file.name;
  const shut = () => veil.remove();
  const run = async () => {
    const name = inp.value.trim(); if (!name) return;
    save.disabled = true;
    try { const r = await api("/api/assets/file", { action: "rename", file: pj.fid, name }); pj.data.file.name = r.name || name; shut(); await syncAssets(); if (S.pj === pj) paintAsset(); }
    catch (e){ save.disabled = false; bad.textContent = e.message; }
  };
  save.onclick = run; inp.onkeydown = e => { if (e.key === "Enter") run(); if (e.key === "Escape") shut(); };
  veil.querySelector("#arCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
function deleteAsset(){
  const pj = S.pj; if (!pj) return;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="adTitle"><header><h3 id="adTitle"></h3>
    <p>What it holds goes, with its changes and the version kept for its Undo. A chat that called it can no longer read it.</p></header>
    <div class="f"><div class="bad" id="adBad"></div></div>
    <footer><button class="ghost" id="adCancel" type="button">Cancel</button><button class="go bad" id="adGo" type="button">Delete</button></footer></div>`;
  veil.querySelector("h3").textContent = `Delete ${pj.data.file.name}?`;
  document.body.append(veil);
  const go = veil.querySelector("#adGo"), bad = veil.querySelector("#adBad");
  const shut = () => veil.remove();
  veil.querySelector("#adCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  go.onclick = async () => {
    go.disabled = true;
    try {
      await api("/api/assets/file", { action: "remove", file: pj.fid });
      shut();
      if (S.pj === pj){ S.asset = null; S.pj = null; }
      await syncAssets(); render();
    } catch (e){ go.disabled = false; bad.textContent = e.message; }
  };
}
async function undoVersion(btn){
  const pj = S.pj; if (!pj) return;
  btn.disabled = true;
  try { const r = await api("/api/assets/file", { action: "undo", file: pj.fid }); await syncAssets(); openAsset(r.back); }
  catch (e){ btn.disabled = false; pjNote(e.message); }
}

/* ---- projects made before the assets, turned into assets ---- */
/** What a project becomes: its files, and a notes document when it kept anything. */
function convertLine(p){
  const files = p.files || 0;
  const parts = [files ? `${files} file${files === 1 ? "" : "s"}` : "", p.memory ? `notes of ${p.memory} thing${p.memory === 1 ? "" : "s"} it kept` : ""].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} become${parts.length === 1 && files === 1 && !p.memory ? "s" : ""} assets` : "nothing to keep: it goes";
}
/**
 * The projects listed with what each becomes, then turned into assets one after the other: files with all they hold, the Brief and the
 * memory into one document, Notes of the project. Its chat thread, its last 4 exchanges, is not kept. Nothing moves before Turn them.
 */
function openConvert(){
  const list = (S.projects || []).slice();
  if (!list.length) return;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="acTitle"><header><h3 id="acTitle">Turn projects into assets</h3>
    <p>Each project's files become assets, with everything they hold. Its Brief and what it kept become one document, "Notes of" the project. Its chat thread, the last 4 exchanges, is not kept. Then the project goes.</p></header>
    <div class="f"><div class="ac-list" id="acList"></div><div class="bad" id="acBad"></div></div>
    <footer><button class="ghost" id="acCancel" type="button">Cancel</button><button class="go" id="acGo" type="button"></button></footer></div>`;
  document.body.append(veil);
  const box = veil.querySelector("#acList"), go = veil.querySelector("#acGo"), cancel = veil.querySelector("#acCancel"), bad = veil.querySelector("#acBad");
  const rows = list.map(p => {
    const r = el("div","ac-row"); r.dataset.slug = p.slug;
    const t = el("div","ac-t"); t.append(el("b",null,p.name), el("span",null,convertLine(p)));
    const st = el("span","ac-st","");
    r.append(t, st); box.append(r);
    return { p, r, st };
  });
  go.textContent = `Turn ${list.length === 1 ? "it" : `all ${list.length}`} into assets`;
  let busy = false;
  const shut = () => { if (!busy) veil.remove(); };
  cancel.onclick = shut; veil.onclick = e => { if (e.target === veil) shut(); };
  go.onclick = async () => {
    if (go.dataset.done){ veil.remove(); return; }
    busy = true; go.disabled = true; cancel.disabled = true; bad.textContent = "";
    let failed = 0;
    for (const x of rows){
      x.r.classList.add("run"); x.st.textContent = "moving";
      try {
        const r = await api("/api/assets/adopt", { project: x.p.slug });
        if (r.error) throw new Error(r.error);
        const n = (r.files || []).length;
        x.st.textContent = [n ? `${n} file${n === 1 ? "" : "s"}` : "", r.notes ? "its notes" : ""].filter(Boolean).join(" and ") || "done";
        x.r.classList.remove("run"); x.r.classList.add("done");
        S.projects = (S.projects || []).filter(p => p.slug !== x.p.slug);
      } catch (e){
        failed++; x.r.classList.remove("run"); x.r.classList.add("fail");
        x.st.textContent = "stopped"; bad.textContent = /unreadable/.test(e.message) ? "The server is older than this page and cannot turn projects into assets yet. Run convex deploy." : e.message;
      }
    }
    busy = false; cancel.disabled = false;
    await syncAssets(); render();
    go.disabled = false;
    if (!failed){ go.dataset.done = "1"; go.textContent = "Done"; cancel.hidden = true; }
    else go.textContent = "Try the rest again";
  };
}

/* ---- in a chat: the cards of what it proposes ---- */
const CARD_KIND = { open: "Proposed change", applied: "Applied", undone: "Undone", dismissed: "Turned down", gone: "Earlier change" };
/** The words before and after, a line each place a change touches. */
function previewLines(c, preview){
  for (const p of preview || []){
    const l = el("div","pj-ed"); l.append(el("b",null,p.label));
    if (p.before) l.append(el("del",null,p.before));
    if (p.after) l.append(el("ins",null,p.after));
    c.append(l);
  }
}
/** The asset a card is about, as a link that opens it. */
function assetLink(fid, name){
  const b = el("button","as-to",name); b.type = "button"; b.title = "Open it";
  b.onclick = () => { if (assetById(fid)) openAsset(fid); };
  return b;
}
/** A change a chat proposed to an asset: Apply or Turn down, then Undo. Nothing changes until Apply. */
function assetEditCard(e){
  const c = el("div","pj-edit as-edit " + e.status); c.dataset.id = e.id; c.dataset.fid = String(e.fid);
  c.append(el("div","pj-ek", CARD_KIND[e.status] || e.status));
  const where = el("div","pj-ef"); where.append("In ", assetLink(e.fid, e.name)); c.append(where);
  previewLines(c, e.preview);
  const act = async (action, btns) => {
    btns.forEach(b => { b.disabled = true; });
    c.querySelector(".pj-msg")?.remove();
    try {
      await api("/api/assets/edit", { file: e.fid, id: e.id, action });
      e.status = action === "apply" ? "applied" : action === "undo" ? "undone" : "dismissed";
      c.replaceWith(assetEditCard(e));
      if (action !== "dismiss"){ syncAssets(); if (S.pj?.fid === e.fid) refreshAsset().catch(() => {}); }
    } catch (err){
      btns.forEach(b => { b.disabled = false; });
      c.append(el("div","pj-msg",err.message));
    }
  };
  if (e.status === "open"){
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
/** A new asset a chat proposed: Create or Turn down; once made, Open it or Undo. */
function assetMakeCard(m){
  const c = el("div","pj-edit as-make " + m.status); c.dataset.id = m.id;
  c.append(el("div","pj-ek", m.status === "open" ? `New ${pjNoun(m.kind)}` : m.status === "applied" ? "Made" : CARD_KIND[m.status] || m.status));
  const name = el("div","pj-ef");
  if (m.status === "applied" && m.fid) name.append(assetLink(m.fid, m.name)); else name.append(m.name);
  c.append(name);
  previewLines(c, m.preview);
  const act = async (action, btns) => {
    btns.forEach(b => { b.disabled = true; });
    c.querySelector(".pj-msg")?.remove();
    try {
      const r = await api("/api/assets/make", { id: m.id, action });
      m.status = r.status; if (r.fid) m.fid = r.fid;
      c.replaceWith(assetMakeCard(m));
      await syncAssets();
    } catch (err){
      btns.forEach(b => { b.disabled = false; });
      c.append(el("div","pj-msg",err.message));
    }
  };
  if (m.status === "open"){
    const row = el("div","pj-tact"), yes = el("button","go","Create it"), no = el("button","ghost","Turn down");
    yes.type = no.type = "button";
    yes.onclick = () => act("apply", [yes, no]); no.onclick = () => act("dismiss", [yes, no]);
    row.append(yes, no); c.append(row);
  } else if (m.status === "applied"){
    const row = el("div","pj-tact"), open = el("button","go","Open it"), undo = el("button","ghost","Undo");
    open.type = undo.type = "button";
    open.onclick = () => { if (m.fid) openAsset(m.fid); };
    undo.onclick = () => act("undo", [open, undo]);
    row.append(open, undo); c.append(row);
  }
  return c;
}
/** The cards of an answer: its changes, and a new asset. A chat opened again asks where they stand now. */
function assetCards(body, r, fresh){
  const cards = [];
  for (const e of r.edits || []) cards.push(assetEditCard({ ...e }));
  if (r.create) cards.push(assetMakeCard({ ...r.create }));
  if (!cards.length) return;
  body.append(...cards);
  if (fresh) return;
  const list = [...(r.edits || []).map(e => ({ fid: e.fid, id: e.id })), ...(r.create ? [{ fid: 0, id: r.create.id }] : [])];
  api("/api/assets/state", { list }).then(({ state }) => {
    for (const e of r.edits || []){ const now = state?.[e.id]; const card = body.querySelector(`.as-edit[data-id="${e.id}"]`); if (now && card && now !== e.status) card.replaceWith(assetEditCard({ ...e, status: now })); }
    if (r.create){ const now = state?.[r.create.id]; const card = body.querySelector(`.as-make[data-id="${r.create.id}"]`); if (now && card && now !== r.create.status) card.replaceWith(assetMakeCard({ ...r.create, status: now })); }
  }).catch(() => {});
}
/** An asset the question names without @: a chip that asks again with it called. */
function assetHint(q){
  if (S.demo || !(S.assets || []).length) return null;
  const words = String(q || "").toLowerCase();
  const stem = a => a.name.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "");
  const a = (S.assets || []).find(x => { const s = stem(x); return s.length >= 4 && (words.includes(s) || words.includes(s.replace(/[-_]+/g, " "))); });
  if (!a || new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(q)) return null;
  const b = el("button","mini as-hint",`Ask again with @${a.name}`); b.type = "button";
  b.onclick = () => { $("input").value = `${q} @${a.name}`; sizeBox(); renderComposer(); $("input").focus(); };
  return b;
}
