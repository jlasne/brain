/* 13-assets.js: Assets: the documents, tables and pages a chat calls with @. The side panel's list, adding one, the asset open in the
   main area, turning the projects made before into assets, and the cards of what a chat proposes to change or to make. */

const assetById = fid => (S.assets || []).find(a => a.id === fid);
/** Said instead of failing when the server is older than this page: it answers none of the asset routes. */
const ASSETS_OLD = "The server is older than this page and has no Assets yet. Run git pull, then npx convex deploy.";
function assetsOld(){ if (S.assetsOn) return false; chatMsg(ASSETS_OLD); return true; }
/** What the list says beside a name: its size, or that it is still being read. */
function assetMeta(a){
  if (!a || a.status !== "ready") return "reading";
  if (a.kind === "table") return `${(a.rows ?? 0).toLocaleString("en-US")} rows`;
  if (!a.chars) return "empty";
  return a.kind === "html" ? "page" : `${a.sections || 1} section${a.sections === 1 ? "" : "s"}`;
}

/* ---- the side panel ---- */
/**
 * An asset in the side list, beside the folders: a click ticks it for the chat
 * (four at most), open shows it. The assets' own notes sit at the top of the
 * list: a server older than this page, and the projects still to turn into assets.
 */
function assetRow(a){
  const on = S.assetPicks.includes(a.id);
  const row = el("div","brain-row as-row" + (on ? " on" : "") + (S.asset === a.id ? " seen" : "") + (a.status !== "ready" ? " run" : ""));
  row.dataset.fid = String(a.id);
  row.setAttribute("role","button"); row.tabIndex = 0; row.setAttribute("aria-pressed", String(on));
  row.onkeydown = e => { if (e.target === row && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); row.click(); } };
  const tick = el("span","tick"), ic = el("span","a-ic"); ic.innerHTML = pjIcon(a.kind);
  const box = el("span","tbox"); box.innerHTML = TICK_SVG; tick.append(ic, box);
  row.append(tick, el("span","nm",a.name));
  row.title = `${a.name}\n${kindTitle(a)}, ${assetMeta(a)}. Click to read it in the chat, or call it with @.`;
  row.onclick = () => {
    if (a.status !== "ready"){ openAsset(a.id); return; }
    if (S.concept) newChat();
    S.assetPicks = on ? S.assetPicks.filter(x => x !== a.id) : [...S.assetPicks, a.id].slice(-4);
    S.folder = null;
    render();
  };
  const op = el("button","ed op","open"); op.type = "button"; op.title = "See what this asset holds"; op.setAttribute("aria-label", `Open ${a.name}`);
  op.onclick = e => { e.stopPropagation(); openAsset(a.id); };
  row.append(op);
  return row;
}
/** What the side list says about the assets before any row: an older server, or projects to turn into assets. */
function assetNotes(box){
  if (S.demo) return;
  if (!S.assetsOn){ box.append(el("div","side-note as-none as-old", ASSETS_OLD)); return; }
  const old = S.projects || [];
  if (old.length){
    const conv = el("button","as-convert"); conv.type = "button"; conv.id = "assetsConvert";
    conv.textContent = `${old.length} old project${old.length === 1 ? "" : "s"}: delete or keep as assets`;
    conv.onclick = openConvert;
    box.append(conv);
  }
}
/** The list read again after a change. */
async function syncAssets(){
  try { S.assets = (await api("/api/assets/list")).assets || []; } catch { /* the list catches up at the next refresh */ }
  renderSide(); renderScope();
}
/* A file dropped on the list is added as an asset. */
{
  const panel = $("brainsPanel");
  const carries = e => [...(e.dataTransfer?.types || [])].includes("Files");
  panel.addEventListener("dragover", e => { if (!carries(e) || S.demo || !S.assetsOn) return; e.preventDefault(); panel.classList.add("over"); });
  panel.addEventListener("dragleave", e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("over"); });
  panel.addEventListener("drop", e => { if (!carries(e) || S.demo || !S.assetsOn) return; e.preventDefault(); panel.classList.remove("over"); const files = [...(e.dataTransfer?.files || [])]; if (files.length) addAssets(files); });
}

/**
 * The + of the list: knowledge, a folder that learns from each drop, or an
 * asset, a file kept as it is: files you have, a link, or a blank document,
 * table or page to fill from a chat.
 */
function openAdd(anchor){
  popMenu(anchor, "Add knowledge or an asset", menu => {
    const item = (k, label, hint, go) => {
      const b = el("button"); b.type = "button"; b.dataset.add = k; b.setAttribute("role","menuitem");
      b.append(el("b",null,label), el("span",null,hint));
      b.onclick = () => { closeDownload(); go(); };
      menu.append(b);
    };
    menu.append(el("div","pj-mh","Knowledge"));
    item("folder", "New folder", "a subject or a person: it learns from each drop", () => openSheet("", "", "subject"));
    if (S.demo) return;
    menu.append(el("div","pj-mh","Asset"));
    for (const [k, label, hint] of [["add","Add files","Word, PDF, Excel, CSV, HTML"], ["link","Add a link","a web page, read and kept"], ["doc","Doc","blank"], ["html","HTML","blank"], ["table","Table","blank"]])
      item(k, label, hint, () => { if (assetsOld()) return; if (k === "add") pickFiles(PJ_FILES, files => addAssets(files)); else if (k === "link") askLink(); else newAsset(k); });
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
    sh.fail(made ? `${e.message} It is in Assets, not finished: open it to choose the file again.` : e.message);
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
    sh.fail(made ? `${e.message} It is in Assets, not finished: read it again from there.` : e.message);
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
  } catch (e){ chatMsg(e.message); }
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
  /* The guide the AI reads with the asset: what it is for, what each column holds. One line here, the whole of it in its sheet. */
  if (ready && !S.demo){
    const g = el("div","as-guide" + (f.guide ? " on" : "")), say = el("span");
    say.append(el("b",null,"Guide for the AI"), f.guide ? ": " + f.guide.replace(/\s+/g, " ") : ": tell it what this " + pjNoun(f.kind) + " is for and what each column holds, so it reads and edits it right.");
    const e2 = el("button","mini", f.guide ? "Edit" : "Write a guide"); e2.type = "button"; e2.onclick = openGuide;
    g.title = f.guide || ""; g.append(say, e2); pane.append(g);
  }
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
/**
 * The guide sheet: what the AI is told each time it reads or changes this asset. "Draft it" writes a first one from the columns and
 * first rows, or from the sections; nothing is kept until Save. An empty guide is no guide.
 */
function openGuide(){
  const pj = S.pj; if (!pj) return;
  const f = pj.data.file, noun = pjNoun(f.kind);
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="agTitle">
    <header><h3 id="agTitle">Guide for the AI</h3><p>Read each time a chat reads or changes ${esc(f.name)}. Say what this ${esc(noun)} is for${f.kind === "table" ? ", what each column holds and its format, and how a new row is filled" : ", its sections and its tone"}.</p></header>
    <div class="f"><label for="agText">Guide</label><textarea id="agText" rows="9" maxlength="3000" placeholder="${f.kind === "table" ? "Leads I follow up. Status: New, Called, Won or Lost. Next step: a date as 2026-10-19. A new lead starts as New." : "My offer page. Short sentences, prices in euros."}"></textarea><div class="hint" id="agCount"></div></div>
    <div class="f"><button class="ghost" id="agDraft" type="button">Draft it for me</button><div id="agMsg" class="hint" role="status"></div></div>
    <footer><button class="ghost" id="agCancel" type="button">Cancel</button><button class="go" id="agSave" type="button">Save</button></footer></div>`;
  document.body.append(veil);
  const ta = veil.querySelector("#agText"), msg = veil.querySelector("#agMsg"), save = veil.querySelector("#agSave"), draft = veil.querySelector("#agDraft"), count = veil.querySelector("#agCount");
  ta.value = f.guide || "";
  const tally = () => { count.textContent = `${ta.value.length.toLocaleString("en-US")} of 3,000 characters`; };
  ta.oninput = tally; tally();
  const shut = () => veil.remove();
  draft.onclick = async () => {
    draft.disabled = true; msg.className = "spin"; msg.textContent = `Reading the ${noun}`;
    try {
      const r = await api("/api/assets/file", { action: "draftGuide", file: pj.fid });
      if (r.draft){ ta.value = r.draft; tally(); msg.className = "hint"; msg.textContent = "Drafted. Change anything, then Save."; ta.focus(); }
      else { msg.className = "bad"; msg.textContent = "Nothing came back. Try again."; }
    } catch (e){ msg.className = "bad"; msg.textContent = e.message; }
    draft.disabled = false;
  };
  save.onclick = async () => {
    save.disabled = true; msg.className = "spin"; msg.textContent = "Saving";
    try { const r = await api("/api/assets/file", { action: "guide", file: pj.fid, guide: ta.value }); f.guide = r.guide || ""; shut(); await syncAssets(); if (S.pj === pj) paintAsset(); }
    catch (e){ save.disabled = false; msg.className = "bad"; msg.textContent = e.message; }
  };
  veil.querySelector("#agCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  ta.onkeydown = e => { if (e.key === "Escape") shut(); };
  setTimeout(() => ta.focus(), 30);
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
 * The projects listed with what each would become, then deleted, or turned into assets one after the other: files with all they hold,
 * the Brief and the memory into one document, Notes of the project. Delete asks a second click. Nothing moves before then.
 */
function openConvert(){
  const list = (S.projects || []).slice();
  if (!list.length) return;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="acTitle"><header><h3 id="acTitle">Old projects</h3>
    <p>Delete them, files and notes with them. Or keep them as assets: each project's files become assets, and its Brief and what it kept become one document, "Notes of" the project. Its chat thread is not kept either way.</p></header>
    <div class="f"><div class="ac-list" id="acList"></div><div class="bad" id="acBad"></div></div>
    <footer><button class="ghost" id="acCancel" type="button">Cancel</button><button class="ghost bad" id="acDel" type="button"></button><button class="go" id="acGo" type="button"></button></footer></div>`;
  document.body.append(veil);
  const box = veil.querySelector("#acList"), go = veil.querySelector("#acGo"), del = veil.querySelector("#acDel"), cancel = veil.querySelector("#acCancel"), bad = veil.querySelector("#acBad");
  const rows = list.map(p => {
    const r = el("div","ac-row"); r.dataset.slug = p.slug;
    const t = el("div","ac-t"); t.append(el("b",null,p.name), el("span",null,convertLine(p)));
    const st = el("span","ac-st","");
    r.append(t, st); box.append(r);
    return { p, r, st };
  });
  const all = list.length === 1 ? "it" : `all ${list.length}`;
  go.textContent = "Keep as assets"; del.textContent = `Delete ${all}`;
  let busy = false;
  const shut = () => { if (!busy) veil.remove(); };
  cancel.onclick = shut; veil.onclick = e => { if (e.target === veil) shut(); };
  /* Each project in turn, deleted with `drop`, or turned into assets. What is done leaves the list; what failed can be asked again. */
  const run = async drop => {
    busy = true; go.disabled = del.disabled = cancel.disabled = true; bad.textContent = "";
    let failed = 0;
    for (const x of rows.filter(x => !x.r.classList.contains("done"))){
      x.r.classList.remove("fail"); x.r.classList.add("run"); x.st.textContent = drop ? "deleting" : "moving";
      try {
        const r = await api("/api/assets/adopt", { project: x.p.slug, ...(drop ? { drop: true } : {}) });
        const n = (r.files || []).length;
        x.st.textContent = drop ? "deleted" : [n ? `${n} file${n === 1 ? "" : "s"}` : "", r.notes ? "its notes" : ""].filter(Boolean).join(" and ") || "done";
        x.r.classList.remove("run"); x.r.classList.add("done");
        S.projects = (S.projects || []).filter(p => p.slug !== x.p.slug);
      } catch (e){
        failed++; x.r.classList.remove("run"); x.r.classList.add("fail");
        x.st.textContent = "stopped"; bad.textContent = e.message;
      }
    }
    busy = false; cancel.disabled = false;
    await syncAssets(); render();
    go.disabled = del.disabled = false;
    if (!failed){ go.dataset.done = "1"; go.textContent = "Done"; del.hidden = cancel.hidden = true; }
    else { go.textContent = "Keep the rest as assets"; del.textContent = "Delete the rest"; delete del.dataset.sure; }
  };
  go.onclick = () => go.dataset.done ? veil.remove() : run(false);
  /* Deleting asks a second click: the button says what goes for good. */
  del.onclick = () => {
    if (!del.dataset.sure){ del.dataset.sure = "1"; del.textContent = "Delete for good?"; return; }
    run(true);
  };
}

/* ---- in a chat: what it proposes ----
   The answer keeps a line for each proposal, with where it stands. The cards to decide sit in the review panel: beside the chat on
   a wide screen, a sheet over it on a phone. A card decided leaves the panel, and the panel closes once none is left. */
const CARD_KIND = { open: "Proposed change", applied: "Applied", undone: "Undone", dismissed: "Turned down", gone: "Earlier change" };
/** Each proposal shown, by its kind and id: its card and its lines read it, so a decision anywhere shows everywhere. */
const PROPOSED = new Map();
function proposalOf(kind, x){
  const k = `${kind}:${x.id}`, had = PROPOSED.get(k);
  /* Seen before: where it stands here is newer than what a saved answer says. */
  if (had){ const status = had.x.status; Object.assign(had.x, x, { status }); return had; }
  const p = { k, kind, x }; PROPOSED.set(k, p); return p;
}
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
/** A decision on a proposal: apply, turn down or undo. Every card and line of it is drawn again. */
async function decide(p, action){
  const x = p.x;
  if (p.kind === "edit"){
    await api("/api/assets/edit", { file: x.fid, id: x.id, action });
    x.status = action === "apply" ? "applied" : action === "undo" ? "undone" : "dismissed";
    if (action !== "dismiss"){ syncAssets(); if (S.pj?.fid === x.fid) refreshAsset().catch(() => {}); }
  } else {
    const r = await api("/api/assets/make", { id: x.id, action });
    x.status = r.status; if (r.fid) x.fid = r.fid;
    await syncAssets();
  }
  proposalMoved(p);
}
/** Buttons that decide, each disabled while its call runs; a refusal is said under them. */
function decideRow(p, host, list){
  const row = el("div","pj-tact");
  for (const [label, cls, act] of list){
    const b = el("button", cls, label); b.type = "button";
    b.onclick = async () => {
      if (act === "open"){ if (p.x.fid) openAsset(p.x.fid); closeReview(); return; }
      row.querySelectorAll("button").forEach(y => { y.disabled = true; });
      host.querySelector(".pj-msg")?.remove();
      try { await decide(p, act); }
      catch (err){ row.querySelectorAll("button").forEach(y => { y.disabled = false; }); host.append(el("div","pj-msg",err.message)); }
    };
    row.append(b);
  }
  return row;
}
/** A proposal's card, to decide in the review panel: what changes, word for word. */
function proposalCard(p){
  const x = p.x, edit = p.kind === "edit";
  const c = el("div","pj-edit " + (edit ? "as-edit " : "as-make ") + x.status); c.dataset.id = x.id; c.dataset.prop = p.k;
  if (edit) c.dataset.fid = String(x.fid);
  c.append(el("div","pj-ek", edit ? CARD_KIND[x.status] || x.status : x.status === "open" ? `New ${pjNoun(x.kind)}` : x.status === "applied" ? "Made" : CARD_KIND[x.status] || x.status));
  const where = el("div","pj-ef");
  if (edit) where.append("In ", assetLink(x.fid, x.name)); else if (x.status === "applied" && x.fid) where.append(assetLink(x.fid, x.name)); else where.append(x.name);
  c.append(where);
  previewLines(c, x.preview);
  if (x.status === "open") c.append(decideRow(p, c, edit ? [["Apply","go","apply"], ["Turn down","ghost","dismiss"]] : [["Create it","go","apply"], ["Turn down","ghost","dismiss"]]));
  else if (x.status === "applied") c.append(decideRow(p, c, edit ? [["Undo","ghost","undo"]] : [["Open it","go","open"], ["Undo","ghost","undo"]]));
  return c;
}
/** A proposal's line in the answer: what it is, where it stands, and the one thing to do now. */
function proposalLine(p){
  const x = p.x, edit = p.kind === "edit", n = (x.preview || []).length;
  const r = el("div","as-sum " + x.status); r.dataset.prop = p.k;
  const what = el("span","as-sum-t");
  if (edit) what.append(`${n || 1} change${n === 1 ? "" : "s"} to `, assetLink(x.fid, x.name));
  else what.append(`New ${pjNoun(x.kind)}: `, x.status === "applied" && x.fid ? assetLink(x.fid, x.name) : x.name);
  const state = el("span","as-sum-s", x.status === "open" ? "to review" : edit ? (CARD_KIND[x.status] || x.status).toLowerCase() : x.status === "applied" ? "made" : (CARD_KIND[x.status] || x.status).toLowerCase());
  r.append(what, state);
  if (x.status === "open"){ const b = el("button","mini go","Review"); b.type = "button"; b.onclick = () => openReview([p], p); r.append(b); }
  else if (x.status === "applied") r.append(decideRow(p, r, edit ? [["Undo","ghost","undo"]] : [["Open it","ghost","open"], ["Undo","ghost","undo"]]));
  return r;
}
/** A proposal decided: its lines are drawn again; its card says so a moment, then leaves the panel. */
function proposalMoved(p){
  for (const n of document.querySelectorAll(`.as-sum[data-prop="${p.k}"]`)) n.replaceWith(proposalLine(p));
  const pn = $("reviewPanel");
  for (const n of document.querySelectorAll(`.pj-edit[data-prop="${p.k}"]`)){
    const fresh = proposalCard(p); n.replaceWith(fresh);
    if (pn?.contains(fresh) && p.x.status !== "open") setTimeout(() => { fresh.remove(); paintReview(); }, 900);
  }
  paintReview();
}

/* The review panel closes on Later, or on a tap beside it on a phone: each change waits in the chat, under Review. */
$("rvLater").onclick = () => closeReview();
$("rvScrim").onclick = () => closeReview();
/** The panel opened on some proposals, the one asked for in view. Only the ones still to decide go in. */
function openReview(ps, focus){
  if (S.demo) return;
  const pn = $("reviewPanel"), list = $("rvList");
  for (const p of ps) if (p.x.status === "open" && !list.querySelector(`[data-prop="${p.k}"]`)) list.append(proposalCard(p));
  if (!list.children.length) return;
  pn.hidden = false; $("rvScrim").hidden = false;
  document.querySelector("main").classList.add("reviewing");
  paintReview();
  if (focus) list.querySelector(`[data-prop="${focus.k}"]`)?.scrollIntoView({ block: "nearest" });
}
/** Its title counts what is left; with nothing left, it closes. */
function paintReview(){
  const pn = $("reviewPanel"); if (!pn || pn.hidden) return;
  const left = [...$("rvList").children].filter(c => c.classList.contains("open")).length;
  $("rvTitle").textContent = left ? `To review: ${left}` : "All decided";
  if (!$("rvList").children.length) closeReview();
}
function closeReview(){
  const pn = $("reviewPanel"); if (!pn) return;
  pn.hidden = true; $("rvScrim").hidden = true; $("rvList").innerHTML = "";
  document.querySelector("main").classList.remove("reviewing");
}
/** An answer's proposals: a line each in the answer, and a new answer's open ones in the panel. A chat opened again asks where they stand now. */
function assetCards(body, r, fresh){
  const ps = [...(r.edits || []).map(e => proposalOf("edit", { ...e })), ...(r.create ? [proposalOf("make", { ...r.create })] : [])];
  if (!ps.length) return;
  const box = el("div","as-sums");
  box.append(...ps.map(proposalLine));
  body.append(box);
  if (fresh){ openReview(ps, ps[0]); return; }
  const list = [...(r.edits || []).map(e => ({ fid: e.fid, id: e.id })), ...(r.create ? [{ fid: 0, id: r.create.id }] : [])];
  api("/api/assets/state", { list }).then(({ state }) => {
    for (const p of ps){ const now = state?.[p.x.id]; if (now && now !== p.x.status){ p.x.status = now; proposalMoved(p); } }
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
