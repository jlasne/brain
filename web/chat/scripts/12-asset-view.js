/* 12-asset-view.js: what an open asset shows: a document's sections as the page scrolls, a table's grid, a page as it renders or as
   its code. S.pj is the asset open in the main area, and every "pj-" class belongs to its pane. */

/** A call about the open asset: it names the asset by its number. */
const assetCall = (path, body = {}) => api(path, { file: S.pj.fid, ...body });

/** Grey lines that shimmer where words will be. Each is [width, height]. */
function skelLines(lines = [["46%", 20], ["96%"], ["88%"], ["92%"], ["70%"], ["0"], ["94%"], ["84%"], ["90%"], ["58%"]]){
  const box = el("div","pj-skel"); box.setAttribute("aria-hidden","true");
  for (const [w, h = 11] of lines){ const i = el("i"); i.style.width = w; i.style.height = h + "px"; if (w === "0") i.className = "gap"; box.append(i); }
  return box;
}

/**
 * One pane takes over from another with no blank between them: the new one is drawn under the old, in the same place, and fades in
 * once it shows something, 1.5 seconds on at most; then the old one goes.
 */
async function swapDoc(old, next){
  const pj = S.pj;
  old.classList.add("pj-prev"); old.setAttribute("aria-hidden","true"); old.inert = true;
  old.querySelectorAll("[id]").forEach(x => x.removeAttribute("id"));
  next.classList.add("pj-next");
  old.after(next);
  await Promise.race([pj.ready, new Promise(ok => setTimeout(ok, 1500))]);
  window.requestAnimationFrame(() => next.classList.remove("pj-next"));
  setTimeout(() => old.remove(), 200);
}

/* ---- a page ---- */

/** A page: its code run in a frame of its own, which can reach nothing of this app; or its code as text. */
function paintPage(body){
  const pj = S.pj;
  body.classList.add("web");
  const frame = el("iframe","pj-frame"); frame.title = "The page"; frame.setAttribute("sandbox","allow-scripts allow-popups");
  const code = el("pre","pj-code");
  body.append(frame, code);
  pj.web = { frame, code };
  frame.onload = () => pj.isReady?.();
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
    const r = await assetCall("/api/assets/download");
    if (S.pj !== pj || pj.web !== w) return;
    w.frame.srcdoc = r.text; w.code.textContent = r.text;
    if (pj.view === "code") pj.isReady?.();
  } catch (e){ w.code.textContent = e.message; pj.view = "code"; applyView(); pj.isReady?.(); }
}

/* ---- a document ---- */

/** A document: its sections, read on as the page scrolls. */
function paintPaper(body){
  const pj = S.pj;
  const paper = el("div","pj-paper"), page = el("article","pj-page");
  page.append(skelLines());
  paper.append(page);
  const more = el("div","pj-more");
  body.append(paper, more);
  pj.page = page; pj.more = more; pj.docLast = -1; pj.docEnd = false; pj.docBusy = false;
  body.onscroll = () => { if (pj.body === body && !pj.docEnd && body.scrollTop + body.clientHeight > body.scrollHeight - 700) loadSections(); };
  loadSections();
}
async function loadSections(){
  const pj = S.pj;
  if (!pj?.page || pj.docBusy) return;
  pj.docBusy = true;
  try {
    const page = pj.page;
    const r = await assetCall("/api/assets/doc", { n: pj.keep?.top ? 6 : 3, from: pj.docLast });
    if (S.pj !== pj || pj.page !== page) return;
    page.querySelector(".pj-skel")?.remove();
    const was = pj.keep?.secs;
    for (const s of r.sections){
      const a = el("section","pj-sec"); a.dataset.sid = s.sid; a._text = s.text;
      /* After a change, a section that is new or reads otherwise glows a moment. */
      if (was?.size && was.get(String(s.sid)) !== s.text) a.classList.add("pj-new");
      const md = el("div","pj-md"); md.innerHTML = mdView(s.text); a.append(md);
      pj.page.append(a); pj.docLast = s.ord;
    }
    if (r.sections.length < 3) pj.docEnd = true;
    pj.more.textContent = pj.docEnd ? "End of the file" : "";
  } catch (e){ pj.more.textContent = "Could not load more: " + e.message; pj.docEnd = true; pj.page?.querySelector(".pj-skel")?.remove(); }
  finally { pj.docBusy = false; }
  placeAgain();
  fillDoc();
}
/** Once the new pane holds as much as the old one showed, it opens where the old one was, and says it is ready. */
function placeAgain(){
  const pj = S.pj, b = pj?.body; if (!b) return;
  const k = pj.keep, g = pj.grid;
  if (g && k?.gtop){
    if (g.wrap.scrollHeight < k.gtop + g.wrap.clientHeight && g.last < g.total) return;
    g.wrap.scrollTop = k.gtop; k.gtop = 0;
  } else if (!g && k?.top){
    if (b.scrollHeight < k.top + b.clientHeight && !pj.docEnd) return;
    b.scrollTop = k.top; k.top = 0;
  }
  pj.isReady?.();
  /* What changed is told apart for the first screens; a while later, what loads is simply the file. */
  if (k && !k.timer) k.timer = setTimeout(() => { if (pj.keep === k) pj.keep = null; }, 3000);
}
/** A tall screen shows more than three sections: keep reading while the page is on screen and not yet full. */
function fillDoc(){
  const pj = S.pj, b = pj?.body;
  if (pj?.page && !pj.docEnd && !pj.docBusy && b.clientHeight > 0 && (b.scrollHeight <= b.clientHeight + 700 || b.scrollHeight < (pj.keep?.top || 0) + b.clientHeight)) loadSections();
}

/* ---- a table ---- */

/** A table: a tab for each sheet, a grid with its row numbers, and what each column holds. */
function paintGrid(body){
  const pj = S.pj, f = pj.data.file, si = Math.min(pj.sheet, f.sheets.length - 1), sh = f.sheets[si];
  body.classList.add("tbl");
  if (f.sheets.length > 1){
    const tabs = el("div","pj-sheets");
    f.sheets.forEach((s, i) => { const b = el("button", i === si ? "on" : "", s.name); b.type = "button"; b.onclick = () => { pj.sheet = i; pj.keep = null; body.innerHTML = ""; body.classList.remove("tbl"); paintGrid(body); }; tabs.append(b); });
    body.append(tabs);
  }
  const wrap = el("div","pj-gridwrap"), tbl = el("table","pj-grid"), thead = el("thead"), tr = el("tr");
  tr.append(Object.assign(el("th","r"), { textContent: "#" }));
  for (const c of sh.cols.length ? sh.cols : (sh.header || []).map(n => ({ name: n, kind: "text" }))) tr.append(el("th", c.kind === "num" ? "n" : "", c.name));
  thead.append(tr);
  const tb = el("tbody");
  /* Grey rows hold the place until the first rows come. */
  const width = Math.max(1, (sh.cols.length || (sh.header || []).length));
  for (let i = 0; i < 8; i++){ const r = el("tr","pj-skelrow"); r.setAttribute("aria-hidden","true"); for (let j = 0; j <= width; j++) r.append(el("td",null,"")); tb.append(r); }
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
  const g = pj.grid;
  wrap.onscroll = () => { if (pj.grid === g && wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 500) loadRows(); };
  loadRows();
}
async function loadRows(){
  const pj = S.pj, g = pj?.grid;
  if (!g || g.busy || g.last >= g.total) return;
  g.busy = true;
  try {
    const r = await assetCall("/api/assets/rows", { sheet: g.sheet, from: g.last + 1, n: pj.keep?.gtop ? 300 : 100 });
    if (S.pj !== pj || pj.grid !== g) return;
    g.tb.querySelectorAll(".pj-skelrow").forEach(x => x.remove());
    const was = pj.keep?.rows;
    for (const row of r.rows){
      const tr = el("tr"); tr.dataset.n = row.n; tr._cells = row.cells.join("\u0001");
      if (was?.size && !was.has(tr._cells)) tr.classList.add("pj-new");
      tr.append(Object.assign(el("td","r"), { textContent: row.n }));
      /* A long cell wraps at a set width; the grid scrolls left and right. A web address is a link. */
      row.cells.forEach((c, i) => { const td = el("td", (g.cols[i]?.kind === "num" ? "n" : "") + (c.length > 40 ? " long" : "")); linkText(td, c); tr.append(td); });
      g.tb.append(tr); g.last = row.n;
    }
    g.total = r.total;
  } catch (e){ g.tb.querySelectorAll(".pj-skelrow").forEach(x => x.remove()); }
  finally { g.busy = false; }
  placeAgain();
  fillGrid();
}
function fillGrid(){
  const g = S.pj?.grid;
  if (g && !g.busy && g.last < g.total && g.wrap.clientHeight > 0 && (g.wrap.scrollHeight <= g.wrap.clientHeight + 500 || g.wrap.scrollHeight < (S.pj.keep?.gtop || 0) + g.wrap.clientHeight)) loadRows();
}
