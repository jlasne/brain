/* 14-projects-download.js: Projects: the file's own actions, and downloading it as Markdown, PDF, a web page, Excel or CSV. */

/* ---- the file's own actions ---- */

function renameProject(){
  const pj = S.pj;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="prTitle">
    <header><h3 id="prTitle">Rename the project</h3></header>
    <div class="f"><label for="prName">Name</label><input id="prName" autocomplete="off" maxlength="60"></div>
    <div class="bad" id="prBad"></div>
    <footer><button class="ghost" id="prCancel">Cancel</button><button class="go" id="prSave">Save</button></footer></div>`;
  document.body.append(veil);
  const inp = veil.querySelector("#prName"), bad = veil.querySelector("#prBad"), save = veil.querySelector("#prSave");
  inp.value = pj.data.project.name;
  const shut = () => veil.remove();
  const run = async () => {
    const name = inp.value.trim(); if (!name) return;
    save.disabled = true;
    try { await api("/api/project/rename", { brain: pj.slug, name }); pj.data.project.name = name; shut(); paintProject(); await syncProjects(); }
    catch (e){ save.disabled = false; bad.textContent = e.message; }
  };
  save.onclick = run; inp.onkeydown = e => { if (e.key === "Enter") run(); if (e.key === "Escape") shut(); };
  veil.querySelector("#prCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

function deleteProject(){
  const pj = S.pj, name = pj.data.project.name;
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pdTitle">
    <header><h3 id="pdTitle">Delete ${esc(name)}?</h3><p>${pjFiles().length > 1 ? "Its files" : "Its file"}, its memory, its chat and its changes go. This cannot be undone.</p></header>
    <div class="bad" id="pdBad"></div>
    <footer><button class="ghost" id="pdCancel">Cancel</button><button class="go danger" id="pdYes">Delete the project</button></footer></div>`;
  document.body.append(veil);
  const yes = veil.querySelector("#pdYes"), bad = veil.querySelector("#pdBad"), shut = () => veil.remove();
  yes.onclick = async () => {
    yes.disabled = true; yes.textContent = "Deleting";
    try {
      await api("/api/project/delete", { brain: pj.slug });
      shut(); S.project = null; S.pj = null; await refresh();
    } catch (e){ yes.disabled = false; yes.textContent = "Delete the project"; bad.textContent = e.message; }
  };
  veil.querySelector("#pdCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
}

/* ---- downloading the file, in the format asked ---- */

/** What each kind of file can be downloaded as: its key, its name, its extension. */
const DL_FORMATS = {
  doc: [["md","Markdown",".md"], ["pdf","PDF",".pdf"], ["html","Web page",".html"]],
  html: [["html","Web page",".html"], ["md","Markdown",".md"]],
  table: [["xlsx","Excel",".xlsx"], ["csv","CSV",".csv"], ["md","Markdown",".md"]],
};
let dlMenu = null;
function closeDownload(){
  if (!dlMenu) return;
  const m = dlMenu; dlMenu = null;
  document.removeEventListener("pointerdown", m.down, true); document.removeEventListener("keydown", m.key, true);
  window.removeEventListener("resize", m.shut); window.removeEventListener("scroll", m.shut, true);
  m.anchor.setAttribute("aria-expanded", "false"); m.menu.remove();
}
/** A small menu under a button. A second press, an outside press or Escape puts it away. `fill` puts the items in it. */
function popMenu(anchor, label, fill, cls = ""){
  const same = dlMenu?.anchor === anchor; closeDownload(); if (same) return null;
  const menu = el("div","pj-menu" + (cls ? " " + cls : "")); menu.setAttribute("role","menu"); menu.setAttribute("aria-label",label);
  fill(menu);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8))) + "px";
  menu.style.top = Math.round(r.bottom + 6 + h <= innerHeight - 8 || r.top - 6 - h < 8 ? r.bottom + 6 : r.top - 6 - h) + "px";
  const shut = () => closeDownload();
  const down = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) shut(); };
  const key = e => {
    if (e.key === "Escape"){ e.preventDefault(); shut(); anchor.focus(); }
    else if (e.key === "Tab") shut();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      const items = [...menu.querySelectorAll("button")], n = items.length, at = items.indexOf(document.activeElement);
      if (n) items[e.key === "ArrowDown" ? (at + 1) % n : at <= 0 ? n - 1 : at - 1].focus();
    }
  };
  dlMenu = { menu, anchor, down, key, shut };
  document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key, true);
  window.addEventListener("resize", shut); window.addEventListener("scroll", shut, true);
  anchor.setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
  return menu;
}
/** The formats as a small menu under the Download button. */
function openDownload(anchor){
  const f = S.pj?.data?.file; if (!f) return;
  const kind = f.kind === "table" ? "table" : f.kind === "html" ? "html" : "doc";
  popMenu(anchor, "Download as", menu => {
    for (const [k, name, ext] of DL_FORMATS[kind]){
      const b = el("button"); b.type = "button"; b.dataset.fmt = k; b.setAttribute("role","menuitem");
      b.append(el("b",null,name), el("span",null,ext));
      b.onclick = () => { closeDownload(); downloadAs(k, anchor); };
      menu.append(b);
    }
    if (kind === "table" && f.sheets.length > 1) menu.append(el("p",null,`Excel keeps all ${f.sheets.length} sheets. CSV and Markdown take the open one.`));
  });
}

/**
 * The gaps in the open file, found in code with no model: a placeholder nobody filled, an empty cell, a date in the past, two numbers
 * for one thing. A tap puts a request to fix one in the message bar.
 */
async function openGaps(anchor){
  const pj = S.pj; if (!pj?.data?.file) return;
  if (dlMenu?.anchor === anchor){ closeDownload(); return; }
  anchor.disabled = true;
  let r;
  try { r = await api("/api/project/gaps", { brain: pjKey() }); }
  catch (e){ r = { error: /unreadable/.test(e.message) ? "The server is older than this page and cannot look for gaps yet. Run convex deploy." : e.message }; }
  finally { anchor.disabled = false; }
  if (S.pj !== pj) return;
  popMenu(anchor, "Gaps in the file", menu => {
    if (r.error){ menu.append(el("p",null,r.error)); return; }
    if (!r.gaps.length){ menu.append(el("p",null,"No gap found: no placeholder, no empty cell, no date in the past, no two numbers for one thing.")); return; }
    for (const g of r.gaps){
      const b = el("button"); b.type = "button"; b.setAttribute("role","menuitem"); b.title = "Ask the chat to fix it";
      b.append(el("b",null,g.text), el("span",null,g.where));
      b.onclick = () => { closeDownload(); fillBar(`Fix this gap in ${g.where}: ${g.text}.`); };
      menu.append(b);
    }
    if (r.total > r.gaps.length){ const n = r.total - r.gaps.length; menu.append(el("p",null,`${n} more ${n === 1 ? "is" : "are"} not shown.`)); }
  }, "gaps");
}

/** A blob handed to the browser as a file with a name. */
function saveBlob(blob, name){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** A document's HTML as a page of its own: it reads on a phone and on paper, and holds no script. */
function htmlDocument(body, title){
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;padding:32px 20px 64px;background:#fff;color:#1c1c1e;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto}
h1,h2,h3{line-height:1.25;margin:1.6em 0 .5em}
main > :first-child{margin-top:0}
h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}
p{margin:.8em 0}
a{color:#2150c4}
blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid #ccc;color:#555}
pre{overflow:auto;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-size:.88em}
code{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f4f4f5;padding:1px 5px;border-radius:4px}
pre code{background:none;padding:0}
.pj-tw{overflow-x:auto;margin:1em 0}
table{border-collapse:collapse;width:100%;font-size:.95em}
th,td{border-bottom:1px solid #ddd;padding:8px 10px;text-align:left;vertical-align:top}
th{font-size:.8em;letter-spacing:.05em;text-transform:uppercase;color:#666}
hr{border:0;border-top:1px solid #ddd;margin:2em 0}
.pj-pg{margin:1.6em 0 .6em;font-size:.75em;letter-spacing:.06em;text-transform:uppercase;color:#888}
</style></head><body><main>${body}</main></body></html>
`;
}

/** Rows of a table as a Markdown table: the first row heads it, a bar inside a cell is written \| and a line break is a space. */
function tableMarkdown(rows){
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!w) return "";
  const cell = c => String(c ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
  const line = r => `| ${Array.from({ length: w }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(rows[0]), `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") + "\n";
}

/** The sheets of a table as one Excel workbook: a number stays a number, so a column can be summed; a code with a leading zero stays text. */
function xlsxBlob(sheets){
  const X = window.XLSX, wb = X.utils.book_new(), used = new Set();
  const typed = v => /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v) ? Number(v) : v;
  sheets.forEach((sh, i) => {
    /* Excel allows 31 letters, no brackets, colons, stars, question marks or slashes, and no two sheets of one name. */
    let base = String(sh.name || "").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31);
    if (!base || /^(__proto__|constructor|prototype)$/i.test(base)) base = `Sheet ${i + 1}`;
    let name = base, k = 1;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${++k}`;
    used.add(name.toLowerCase());
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sh.rows.map((r, j) => j ? r.map(typed) : r)), name);
  });
  return new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** The file in the format asked: what is said here is written here, in this tab. The server only gives the words, or the rows. */
async function downloadAs(fmt, anchor){
  const pj = S.pj, f = pj.data.file, table = f.kind === "table";
  /* A sheet at a time for Excel, or a PDF written here, takes a moment: the button says so and waits, and a second press does nothing. */
  if (anchor?.dataset.busy) return;
  const label = anchor ? anchor.getAttribute("aria-label") : null;
  if (anchor){ anchor.dataset.busy = "1"; anchor.disabled = true; anchor.setAttribute("aria-busy","true"); anchor.setAttribute("aria-label","Preparing the file"); }
  const note = pj.body ? el("div","pj-wait",`Preparing the ${({ xlsx: "Excel", csv: "CSV", pdf: "PDF", html: "web page", md: "Markdown" })[fmt] || ""} file`) : null;
  if (note){ note.setAttribute("role","status"); pj.body.prepend(note); }
  try {
    if (fmt === "xlsx"){
      await loadXlsx();
      const sheets = [];
      for (let i = 0; i < f.sheets.length; i++){
        const r = await api("/api/project/download", { brain: pjKey(), sheet: i });
        sheets.push({ name: r.sheet || f.sheets[i].name, rows: parseDelimited(r.text, ",") });
      }
      saveBlob(xlsxBlob(sheets), `${String(f.name).replace(/\.[^.]+$/, "")}.xlsx`);
      return;
    }
    const r = await api("/api/project/download", { brain: pjKey(), sheet: table ? pj.sheet : 0 });
    const base = String(r.name).replace(/\.[^.]+$/, ""), part = table && f.sheets.length > 1 ? ` - ${r.sheet}` : "";
    const save = (text, type, name) => saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);
    if (fmt === "csv") save(r.text, "text/csv", `${base}${part}.csv`);
    else if (fmt === "html"){
      /* A page is its own code. A document becomes one. */
      if (r.kind === "html") save(r.text, "text/html", /\.(html?|xhtml)$/i.test(r.name) ? r.name : `${base}.html`);
      else save(htmlDocument(mdView(r.text, 1), base), "text/html", `${base}.html`);
    } else if (fmt === "pdf"){
      if (r.text.length > 4000000) throw new Error("This document is too long for a PDF. Download it as Markdown or a web page.");
      /* Let the menu go before the page is busy. */
      await new Promise(ok => setTimeout(ok, 20));
      const pdf = pdfFromMarkdown(r.text, base);
      if (!pdf) throw new Error("This document uses letters a PDF cannot print here. Download it as Markdown or a web page.");
      saveBlob(new Blob([pdf], { type: "application/pdf" }), `${base}.pdf`);
    } else {
      const md = r.kind === "table" ? tableMarkdown(parseDelimited(r.text, ",")) : r.kind === "html" ? htmlToMd(r.text) : r.text;
      if (!md.trim()) throw new Error("There is nothing here to write as Markdown.");
      save(md, "text/markdown", r.kind === "doc" && /\.(md|markdown|txt)$/i.test(r.name) ? r.name : `${base}${part}.md`);
    }
  } catch (e){ pjNote(e.message); }
  finally {
    note?.remove();
    if (anchor){ delete anchor.dataset.busy; anchor.disabled = false; anchor.removeAttribute("aria-busy"); if (label === null) anchor.removeAttribute("aria-label"); else anchor.setAttribute("aria-label", label); }
  }
}

/**
 * A document's Markdown as a PDF, written here: A4, Helvetica and Courier,
 * headings, paragraphs with bold and italic, lists, quotes, code, tables whose
 * header repeats on each page, and the page number. The fonts are the ones every
 * PDF reader holds, so nothing is embedded and the file stays small. They write
 * Western European text; a document that is mostly in another script, Chinese,
 * Arabic or Cyrillic for one, comes back as null, since a PDF here would print question marks.
 */
function pdfFromMarkdown(md, title){
  /* Widths of Helvetica and Helvetica-Bold for the characters 32 to 126, in thousandths of the size. */
  const WR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  /* What Windows-1252 holds beyond Latin-1, and a few signs written with letters when the font lacks them. */
  const WIN = [[0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],
    [0x0152,0x8C],[0x017D,0x8E],[0x2018,0x91],[0x2019,0x92],[0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02DC,0x98],[0x2122,0x99],
    [0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]];
  const SPEC = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0xA9: 737, 0xAE: 737, 0xB0: 400, 0xB1: 584, 0xB7: 278, 0xD7: 584, 0xF7: 584 };
  const WORDS = { "→": "->", "←": "<-", "↔": "<->", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "−": "-", "‑": "-", "‒": "-", "✓": "v", "✔": "v", "●": "•", "◦": "-", "⁃": "-" };
  const win = new Map(WIN);
  let lost = 0, total = 0;
  /* One text as the bytes of the font: Latin-1 as it is, the rest by the table, a question mark where nothing fits. */
  const bytes = t => {
    let s = "";
    for (const ch of String(t).normalize("NFC")){
      let c = ch.codePointAt(0);
      if (c === 0xA0 || c === 0x202F) c = 32;
      if (c === 0xAD || (c >= 0x200B && c <= 0x200F) || c === 0xFEFF || (c < 32 && c !== 10 && c !== 9)) continue;
      if (c === 9) { s += "    "; continue; }
      if (WORDS[ch] && !win.has(c)) { s += WORDS[ch]; continue; }
      total++;
      if ((c >= 32 && c < 127) || (c >= 0xA0 && c <= 0xFF) || c === 10) s += String.fromCharCode(c);
      else if (win.has(c)) s += String.fromCharCode(win.get(c));
      else { s += "?"; lost++; }
    }
    return s;
  };
  const wch = (c, bold) => {
    if (c >= 32 && c < 127) return (bold ? WB : WR)[c - 32];
    if (SPEC[c]) return SPEC[c];
    const b = String.fromCharCode(c).normalize("NFD").charCodeAt(0);
    return b >= 32 && b < 127 ? (bold ? WB : WR)[b - 32] : 556;
  };
  const FONTS = { R: ["Helvetica", false], B: ["Helvetica-Bold", true], I: ["Helvetica-Oblique", false], BI: ["Helvetica-BoldOblique", true], C: ["Courier", false] };
  const FKEY = ["R", "B", "I", "BI", "C"];
  const width = (s, f, sz) => { let w = 0; if (f === "C") return s.length * 0.6 * sz; const bold = FONTS[f][1]; for (let i = 0; i < s.length; i++) w += wch(s.charCodeAt(i), bold); return w * sz / 1000; };
  const esc = s => s.replace(/[\\()]/g, m => "\\" + m);
  const num = n => (Math.round(n * 100) / 100).toString();

  const { wrap, wordsOf, inline } = pdfWrap({ bytes, width });

  /* ---- the page ---- */
  const PW = 595.28, PH = 841.89, ML = 56, MR = 56, MT = 60, MB = 62, TW = PW - ML - MR;
  const pages = []; let page = null, y = 0;
  const newPage = () => { page = []; pages.push(page); y = PH - MT; };
  const room = h => y - h >= MB;
  const color = (r, g, b) => `${num(r)} ${num(g)} ${num(b)} rg`;
  /* A line of words (their fonts named by resource) with its top at `top`, from x, or ending at x when it aligns right. */
  const drawLine = (line, x, top, sz, lead, rgb = [0.1, 0.1, 0.12], align) => {
    const base = top - lead * 0.76;
    let cx = align === "right" ? x - line.reduce((n, w) => n + w.lead + w.w, 0) : x, run = null;
    const out = () => { if (run) page.push(`BT /${run.f} ${num(sz)} Tf ${color(...rgb)} 1 0 0 1 ${num(run.x)} ${num(base)} Tm (${esc(run.t)}) Tj ET`); run = null; };
    for (const w of line){
      cx += w.lead;
      if (run && run.f !== w.f) out();
      if (!run) run = { f: w.f, x: cx, t: "" };
      else if (w.lead) run.t += " ";
      run.t += w.t; cx += w.w;
    }
    out();
  };
  const FONTCODE = { R: "F1", B: "F2", I: "F3", BI: "F4", C: "F5" };
  const rect = (x, top, w, h, g) => page.push(`${num(g)} g ${num(x)} ${num(top - h)} ${num(w)} ${num(h)} re f`);
  const stroke = (x1, y1, x2, y2, g = 0.8, lw = 0.6) => page.push(`${num(g)} G ${num(lw)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);

  /* Lines of words as text blocks: fonts are named by their resource code. */
  const emit = (line, x, top, sz, lead, rgb, align) => {
    const mapped = line.map(w => ({ ...w, f: FONTCODE[w.f] }));
    drawLine(mapped, x, top, sz, lead, rgb, align);
  };
  const para = (runs, o) => {
    const { x = ML, w = TW, sz = 10.5, lead = 15.5, rgb, after = 6, hang = 0, mark = null } = o || {};
    const lines = wrap(wordsOf(runs, sz), w - hang, sz);
    lines.forEach((ln, i) => {
      if (!room(lead)) newPage();
      if (i === 0 && mark) emit([{ t: bytes(mark.t), f: "R", w: 0, lead: 0 }], x, y, sz, lead, rgb);
      emit(ln, x + hang, y, sz, lead, rgb);
      y -= lead;
    });
    y -= after;
  };

  const { blocks } = mdBlocks({ md });

  /* ---- laying the blocks out ---- */
  newPage();
  const H = { 1: [19, 24, 14], 2: [14.5, 19, 11], 3: [12, 16, 9], 4: [10.5, 15, 7], 5: [10.5, 15, 7], 6: [10.5, 15, 7] };
  let first = true;
  for (const b of blocks){
    if (b.k === "h"){
      const [sz, lead, before] = H[b.n];
      if (!first && y < PH - MT - 1) y -= before;
      if (!room(lead * 2 + 14)) newPage();
      para(inline(b.s, "B"), { sz, lead, after: 5, rgb: [0.07, 0.07, 0.09] });
    } else if (b.k === "p"){
      let s = "";
      b.lines.forEach((l, j) => { const p = b.lines[j - 1]; s += j ? (p.length >= 50 && !/[.!?:;]["')\]]?$/.test(p) ? " " : "\n") + l : l; });
      para(inline(s, "R"), {});
    } else if (b.k === "list"){
      const counters = [];
      for (const it of b.items){
        counters.length = it.lvl + 1;
        const n = it.num ? (counters[it.lvl] = it.num) : 0;
        if (it.num) counters[it.lvl] = it.num + 1; else counters[it.lvl] = 0;
        const x = ML + it.lvl * 16;
        para(inline(it.s, "R"), { x, w: TW - it.lvl * 16, hang: 15, after: 2.5, mark: { t: it.num ? `${n}.` : it.lvl ? "-" : "•" } });
      }
      y -= 4;
    } else if (b.k === "quote"){
      const top = y;
      para(inline(b.s, "I"), { x: ML + 14, w: TW - 14, rgb: [0.33, 0.33, 0.36], after: 0 });
      stroke(ML + 4, top - 1, ML + 4, y + 3, 0.72, 2);
      y -= 8;
    } else if (b.k === "code"){
      const sz = 8.8, lead = 12, per = Math.max(20, Math.floor((TW - 16) / (0.6 * sz)));
      const rows = [];
      for (const l of b.lines){ const t = bytes(l.replace(/\t/g, "    ")); if (!t) rows.push(""); for (let k = 0; k < t.length; k += per) rows.push(t.slice(k, k + per)); }
      let i = 0;
      while (i < rows.length){
        if (!room(lead + 8)) newPage();
        const fit = Math.max(1, Math.min(rows.length - i, Math.floor((y - MB - 8) / lead)));
        rect(ML, y, TW, fit * lead + 8, 0.955);
        for (let k = 0; k < fit; k++){ if (rows[i + k]) page.push(`BT /F5 ${num(sz)} Tf 0.15 0.15 0.18 rg 1 0 0 1 ${num(ML + 8)} ${num(y - 4 - lead * (k + 0.76))} Tm (${esc(rows[i + k])}) Tj ET`); }
        y -= fit * lead + 8; i += fit;
      }
      y -= 8;
    } else if (b.k === "hr"){
      if (!room(20)) newPage();
      y -= 8; stroke(ML, y, PW - MR, y, 0.78, 0.8); y -= 10;
    } else if (b.k === "table"){
      const sz = 9, lead = 12.5, padX = 5, padY = 4;
      y -= 4;
      const all = [...b.head, ...b.rows];
      const cols = Math.max(1, ...all.map(r => r.length));
      const cellWords = r => Array.from({ length: cols }, (_, c) => wordsOf(inline(r[c] ?? "", b.head.includes(r) ? "B" : "R"), sz));
      const prep = all.map(cellWords);
      const natural = Array.from({ length: cols }, (_, c) => Math.max(20, ...prep.map(r => r[c].reduce((n, w) => n + (w.w || 0) + (w.sp ? width(" ", "R", sz) : 0), 0))) + 2 * padX);
      const least = Array.from({ length: cols }, (_, c) => Math.min(natural[c], Math.max(34, ...prep.map(r => Math.max(0, ...r[c].map(w => w.w || 0))) + 2 * padX)));
      let colw = natural.slice();
      const sum = a => a.reduce((n, x) => n + x, 0);
      if (sum(natural) > TW){
        const spare = TW - sum(least), want = sum(natural) - sum(least);
        colw = least.map((l, c) => l + (want > 0 ? (natural[c] - l) * Math.max(0, spare) / want : 0));
        const over = sum(colw) - TW; if (over > 0) colw = colw.map(w => w * TW / sum(colw));
      } else colw = natural.map(w => w + (TW - sum(natural)) / cols);
      const drawRow = (cells, head) => {
        const wrapped = cells.map((c, j) => wrap(c, colw[j] - 2 * padX, sz));
        const h = Math.max(...wrapped.map(l => l.length)) * lead + 2 * padY;
        if (!room(h)) { newPage(); if (!head && b.head.length) drawRow(prep[0], true); }
        if (head) rect(ML, y, TW, h, 0.93);
        let x = ML;
        wrapped.forEach((lines, j) => {
          lines.forEach((ln, k) => emit(ln, x + padX, y - padY - k * lead, sz, lead, [0.1, 0.1, 0.12]));
          page.push(`0.8 G 0.5 w ${num(x)} ${num(y - h)} ${num(colw[j])} ${num(h)} re S`);
          x += colw[j];
        });
        y -= h;
      };
      b.head.forEach((_, r) => drawRow(prep[r], true));
      b.rows.forEach((_, r) => drawRow(prep[b.head.length + r], false));
      y -= 10;
    }
    first = false;
  }
  if (total && lost > Math.max(4, total * 0.02)) return null;

  /* ---- the file ---- */
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const off = [];
  const put = (id, body) => { off[id] = out.length; out += `${id} 0 obj\n${body}\nendobj\n`; };
  const n = pages.length, first0 = 9;
  put(1, "<< /Type /Catalog /Pages 2 0 R >>");
  put(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${first0 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  FKEY.forEach((k, i) => put(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k][0]} /Encoding /WinAnsiEncoding >>`));
  const name = esc(String(title ?? "Document").replace(/[^\x20-\x7e]/g, "").slice(0, 120));
  put(8, `<< /Title (${name}) /Producer (Octopus) >>`);
  const foot = bytes(String(title ?? "")).slice(0, 70);
  pages.forEach((ops, i) => {
    /* The footer: the name of the file at the left, the page at the right. */
    page = ops;
    const left = [{ t: foot, f: "F1", w: width(foot, "R", 8), lead: 0 }], right = [{ t: `${i + 1} / ${n}`, f: "F1", w: width(`${i + 1} / ${n}`, "R", 8), lead: 0 }];
    drawLine(left, ML, MB - 22, 8, 10, [0.5, 0.5, 0.54]);
    drawLine(right, PW - MR, MB - 22, 8, 10, [0.5, 0.5, 0.54], "right");
    const content = ops.join("\n");
    put(first0 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /Font << ${FKEY.map((k, j) => `/F${j + 1} ${3 + j} 0 R`).join(" ")} >> >> /Contents ${first0 + i * 2 + 1} 0 R >>`);
    put(first0 + i * 2 + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const size = first0 + n * 2, xref = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) out += `${String(off[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bin = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bin[i] = out.charCodeAt(i) & 255;
  return bin;
}

/** PDF writing: inline Markdown as runs of one font each, and a paragraph wrapped into lines that fit the width. */
function pdfWrap({ bytes, width }){
  /* Inline Markdown as runs of one font each. */
  const inline = (s, f) => {
    const runs = [], push = (t, ff) => { if (t) runs.push({ t, f: ff }); };
    const re = /`([^`]+)`|(!?)\[([^\]]*)\]\(([^)\s]*)[^)]*\)|\*\*([^\s*](?:[^*]*[^\s*])?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*|<br\s*\/?>|<\/?[a-zA-Z][^>]*>|\\([*_`\[\]()#>|\\-])/g;
    let last = 0, m;
    while ((m = re.exec(s))){
      push(s.slice(last, m.index), f); last = m.index + m[0].length;
      if (m[1] != null) push(m[1], "C");
      else if (m[3] != null){ push(m[3], f); if (!m[2] && m[4] && m[4] !== m[3]) push(` (${m[4]})`, f); }
      else if (m[5] != null) runs.push(...inline(m[5], f === "I" || f === "BI" ? "BI" : "B"));
      else if (m[6] != null) runs.push(...inline(m[6], f === "B" || f === "BI" ? "BI" : "I"));
      else if (/^<br/i.test(m[0])) push("\n", f);
      else if (m[7] != null) push(m[7], f);
    }
    push(s.slice(last), f);
    return runs;
  };
  /* Words with their font, ready to wrap; `sp` says whitespace follows the word. */
  const wordsOf = (runs, sz) => {
    const out = [];
    for (const r of runs){
      for (const p of bytes(r.t).split(/(\n|\s+)/)){
        if (!p) continue;
        if (p === "\n") out.push({ br: true });
        else if (/^\s+$/.test(p)) { if (out.length && !out[out.length - 1].br) out[out.length - 1].sp = true; }
        else out.push({ t: p, f: r.f, w: width(p, r.f, sz), sp: false });
      }
    }
    return out;
  };
  /* Words as lines no wider than `max`; each word knows the space before it. A word wider than a line is cut where it overflows. */
  const wrap = (words, max, sz) => {
    const lines = []; let cur = [], x = 0;
    const flush = () => { lines.push(cur); cur = []; x = 0; };
    for (const w of words){
      if (w.br){ flush(); continue; }
      const prev = cur[cur.length - 1];
      const gap = prev && prev.sp ? width(" ", prev.f, sz) : 0;
      if (w.w > max){
        if (cur.length) flush();
        let rest = w.t;
        while (rest){
          let n = rest.length;
          while (n > 1 && width(rest.slice(0, n), w.f, sz) > max) n--;
          const piece = rest.slice(0, n); rest = rest.slice(n);
          cur.push({ t: piece, f: w.f, w: width(piece, w.f, sz), sp: !rest && w.sp, lead: 0 }); x = width(piece, w.f, sz);
          if (rest) flush();
        }
        continue;
      }
      if (cur.length && x + gap + w.w > max) flush();
      const lead = cur.length ? (cur[cur.length - 1].sp ? width(" ", cur[cur.length - 1].f, sz) : 0) : 0;
      cur.push({ ...w, lead }); x += lead + w.w;
    }
    if (cur.length || !lines.length) flush();
    return lines;
  };
  return { wrap, wordsOf, inline };
}

/** PDF writing: Markdown read as blocks, a heading, a paragraph, a list item, a quote, code, a rule or a table. */
function mdBlocks({ md }){
  /* ---- Markdown as blocks ---- */
  const src = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const cellsOf = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const isSep = r => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(r.trim());
  const itemRe = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
  for (let i = 0; i < src.length;){
    const ln = src[i], t = ln.trim();
    if (!t){ i++; continue; }
    let m;
    if ((m = /^(```|~~~)/.exec(t))){
      const body = []; i++;
      while (i < src.length && !/^(```|~~~)/.test(src[i].trim())) body.push(src[i++]);
      i++; blocks.push({ k: "code", lines: body }); continue;
    }
    if (/^\[\[p\. \d+\]\]$/.test(t)){ i++; continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(t))){ blocks.push({ k: "h", n: m[1].length, s: m[2] }); i++; continue; }
    if (/^([-*_])(\s*\1){2,}$/.test(t)){ blocks.push({ k: "hr" }); i++; continue; }
    if (/^>/.test(t)){ const q = []; while (i < src.length && /^\s*>/.test(src[i])) q.push(src[i++].trim().replace(/^>\s?/, "")); blocks.push({ k: "quote", s: q.join(" ") }); continue; }
    if (/^\|.*\|$/.test(t)){
      const rows = []; while (i < src.length && /^\s*\|.*\|\s*$/.test(src[i])) rows.push(src[i++]);
      const sep = rows.findIndex(isSep);
      const body = rows.filter((r, j) => j !== sep).map(cellsOf);
      blocks.push({ k: "table", head: sep > 0 ? body.slice(0, sep) : [], rows: sep > 0 ? body.slice(sep) : body }); continue;
    }
    if (itemRe.test(ln)){
      const items = [];
      while (i < src.length && src[i].trim()){
        const li = itemRe.exec(src[i]);
        if (li) items.push({ lvl: Math.min(3, Math.floor(li[1].replace(/\t/g, "    ").length / 2)), num: /\d/.test(li[2]) ? parseInt(li[2], 10) : 0, s: li[3] });
        else if (/^\s+\S/.test(src[i]) && items.length) items[items.length - 1].s += " " + src[i].trim();
        else break;
        i++;
      }
      blocks.push({ k: "list", items }); continue;
    }
    /* A paragraph: the lines of a PDF or a text file break where the page ended, so a long line that stops no sentence reads on. */
    const lines = [];
    while (i < src.length && src[i].trim() && !/^(```|~~~|#{1,6}\s|>|\|.*\|$)/.test(src[i].trim()) && !itemRe.test(src[i]) && !/^([-*_])(\s*\1){2,}$/.test(src[i].trim())) lines.push(src[i++].trim());
    blocks.push({ k: "p", lines });
  }
  return { blocks };
}

/** A line at the top of the file, for what did not work. It goes by itself. */
function pjNote(text){
  const pj = S.pj; if (!pj?.body) return;
  const n = el("div","pj-msg",text); n.style.cssText = "padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--line)";
  pj.body.prepend(n); setTimeout(() => n.remove(), 7000);
}

/** A file picked in the browser's own window, and handed on. */
function pickFile(accept, then){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept; inp.hidden = true;
  inp.onchange = () => { const file = inp.files?.[0] || null; inp.remove(); if (file) then(file); };
  document.body.append(inp); inp.click();
}

/** Several files picked at once. */
function pickFiles(accept, then){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept; inp.multiple = true; inp.hidden = true;
  inp.onchange = () => { const files = [...(inp.files || [])]; inp.remove(); if (files.length) then(files); };
  document.body.append(inp); inp.click();
}

/** A file picked for the open project: read here, filed in sections. */
function chooseFile(){ pickFile(PJ_FILES, file => fillProject(S.pj.slug, file, S.pj.fid || 1)); }

/* A resource is sent in pieces of what one call reads, up to 10 of them: 200,000 characters, about 33,000 words. */
const RES_PIECE = 20000, RES_PIECES = 10, RES_CHARS = RES_PIECE * RES_PIECES, RES_WORDS = "33,000 words";

/**
 * A field for words, as the personal memory has one: typed or pasted, or a file added whose words join the field. It says how many
 * characters it holds, and how many are read: 6,000 of a Brief, 200,000 of a resource.
 */
function instructionsField(host, what = "brief"){
  host.innerHTML = `<textarea class="mem" rows="5" aria-label="Brief"></textarea>
    <div class="mem-bar"><button class="mini" type="button">+ file</button><span class="hint" role="status"></span></div>`;
  const ta = host.querySelector("textarea"), add = host.querySelector("button"), count = host.querySelector(".hint");
  const names = [];
  const say = (t, bad) => { count.textContent = t; count.classList.toggle("bad", !!bad); };
  const limit = () => what === "resource" ? RES_CHARS : BRIEF_CHARS;
  const sync = () => { const n = ta.value.length; say(n ? `${n.toLocaleString()} characters${n > limit() ? `, the first ${limit().toLocaleString()} are read` : ""}` : ""); };
  /* What the words are for: the hint and the limit follow, the words stay. */
  const aim = w => {
    what = w;
    ta.placeholder = w === "resource" ? "Paste the text of a resource here, or add a file" : "Paste or write the Brief here, or add a file";
    ta.setAttribute("aria-label", w === "resource" ? "Resource" : "Brief");
    sync();
  };
  ta.oninput = sync;
  /* A file's words join the field after what it holds: from + file, or dropped on it. */
  const take = async f => {
    add.disabled = true;
    try {
      const got = await readInstructions(f, t => say(t), what);
      ta.value = (ta.value.trim() ? ta.value.trimEnd() + "\n\n" : "") + got.text;
      names.push(got.name); sync();
    } catch (e){ say(e.message, true); }
    finally { add.disabled = false; }
  };
  add.onclick = () => pickFile(RULE_FILES, take);
  aim(what);
  return { ta, add, count, aim, take, text: () => ta.value.trim(), name: () => ta.value.trim() ? names.join(", ").slice(0, 120) : "", lock: on => { ta.disabled = on; add.disabled = on; } };
}

/** A file read in this tab as words: Word, PDF, text, Markdown or HTML. A table is no instruction and no resource. */
async function readInstructions(file, say, what = "brief"){
  if (/\.(csv|tsv|xlsx|xls)$/i.test(file.name)) throw new Error(`${file.name} is a table. ${what === "resource" ? "A resource is words: Word, PDF, text, Markdown or HTML. Paste the part of the table that matters." : "A Brief is words: Word, PDF, text, Markdown or HTML."}`);
  const got = await readProjectFile(file, say);
  const text = (got.kind === "html" ? htmlToMd(got.text) : got.text).replace(/^\[\[p\. \d+\]\]$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`${got.name} gave no text. A scanned PDF holds pictures of words, so it needs its text.`);
  return { name: got.name, text };
}

/** The Brief, typed or read from a file, saved as written: the chat reads it at every message. */
async function sendBrief(slug, text){
  try { return await api("/api/project/brief", { brain: slug, action: "save", text }); }
  catch (e){
    /* A server older than this page has no such route, and answers with something unreadable. */
    throw new Error(/unreadable/.test(e.message) ? "The server is older than this page and cannot save a Brief yet. Run convex deploy." : e.message);
  }
}

/** Words cut in pieces of at most one call's size, each at a paragraph, a line or a sentence where one is near. The rest past 5 pieces is left. */
function resourcePieces(text){
  const out = []; let rest = String(text).trim();
  while (rest && out.length < RES_PIECES){
    if (rest.length <= RES_PIECE){ out.push(rest); rest = ""; break; }
    let cut = rest.lastIndexOf("\n\n", RES_PIECE);
    if (cut < RES_PIECE * .6) cut = rest.lastIndexOf("\n", RES_PIECE);
    if (cut < RES_PIECE * .6) cut = rest.lastIndexOf(". ", RES_PIECE) + 1;
    if (cut < RES_PIECE * .6) cut = RES_PIECE;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  return { pieces: out, cut: !!rest };
}

/**
 * Words for the project's memory: sorted into folders first when asked (one call names 3 to 8 topics from the drop, and a project
 * that has folders keeps them), then filed as notes in pieces. A plan that fails leaves the notes unsorted, and they are filed all the same.
 */
async function fileMemory(slug, got, say, o = {}){
  let folders = null, unsorted = "";
  if (o.plan){
    say("Sorting it into folders");
    try { folders = (await api("/api/project/folders", { brain: slug, action: "plan", text: got.text })).folders || null; }
    catch (e){
      if (/unreadable/.test(e.message)) throw new Error("The server is older than this page and cannot sort a memory into folders yet. Run convex deploy.");
      unsorted = e.message;
    }
  }
  const r = await sendResource(slug, got, say);
  return { ...r, folders, ...(unsorted ? { unsorted } : {}) };
}

/** A resource, typed or read from a file, sent in pieces to be filed as notes in the project's memory, which the chat then reads as they bear on a question. */
async function sendResource(slug, got, say){
  const { pieces, cut } = resourcePieces(got.text);
  let notes = 0;
  for (let i = 0; i < pieces.length; i++){
    say(pieces.length > 1 ? `Filing part ${i + 1} of ${pieces.length} in the memory` : "Filing the resource in the memory");
    try {
      const r = await api("/api/project/resource", { brain: slug, name: got.name && pieces.length > 1 ? `${got.name}, part ${i + 1}` : got.name, text: pieces[i] });
      notes += r.notes || 0;
    } catch (e){
      /* A server older than this page has no such route, and answers with something unreadable. */
      throw new Error(/unreadable/.test(e.message) ? "The server is older than this page and cannot file resources yet. Run convex deploy."
        : i ? `Part ${i + 1} of ${pieces.length} failed: ${String(e.message).replace(/\.?\s*$/, ".")} The ${i === 1 ? "first part is" : `first ${i} parts are`} filed.` : e.message);
    }
  }
  return { notes, cut };
}

/** A sheet that says where a file stands while it is read and filed. */
function progressSheet(title){
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ppTitle"><header><h3 id="ppTitle"></h3>
    <p>The file is read in this tab. Only its words and rows are sent.</p></header><div class="f"><div class="pj-step" role="status"></div><div class="bad"></div></div>
    <footer hidden><button class="ghost">Close</button></footer></div>`;
  veil.querySelector("h3").textContent = title;
  document.body.append(veil);
  const step = veil.querySelector(".pj-step"), bad = veil.querySelector(".bad"), foot = veil.querySelector("footer");
  foot.querySelector("button").onclick = () => veil.remove();
  return { say: t => { step.textContent = t; tabTitle(t.startsWith("Reading") ? "Reading" : ""); }, fail: msg => { step.textContent = ""; bad.textContent = msg; foot.hidden = false; tabTitle(""); }, close: () => { veil.remove(); tabTitle(""); } };
}

/** Read a file and fill a project's file with it: the first by default, or the one numbered. */
async function fillProject(slug, file, fid = 1){
  const sh = progressSheet(`Reading ${file.name}`);
  try {
    const got = await readProjectFile(file, sh.say);
    await uploadProject(fileKeyOf(slug, fid), got, sh.say);
    sh.close();
    await syncProjects();
    if (S.project === slug){ S.pj.marks = null; S.pj.sheet = 0; S.pj.data = null; paintProject(); await loadProject(); }
  } catch (e){
    sh.fail(e.message);
    await syncProjects();
    if (S.project === slug) { try { await loadProject(); } catch { /* the sheet says what failed */ } }
  }
}

/** Files a new project starts with. More join from the project's + once it is open, up to 30. */
const NEW_FILES = 3;

/** New project: a name, up to 3 files dropped or chosen (or a blank to start from), a Brief, and a first memory sorted into folders. */
function openProjectSheet(){
  closeSide();
  const veil = el("div","veil");
  veil.innerHTML = `<div class="sheet roomy" role="dialog" aria-modal="true" aria-labelledby="npTitle">
    <header><h3 id="npTitle">New project</h3><p>Files, tables and pages, with a chat beside them and a memory of its own. Only this project and your personal folder read that memory.</p></header>
    <div class="f"><label for="npName">Name</label><input id="npName" autocomplete="off" maxlength="60" placeholder="New project"></div>
    <div class="f np-drop" id="npDrop"><label>Files <span class="pj-opt">up to ${NEW_FILES}, optional</span></label>
      <div class="pj-make"><button class="ghost" id="npPick" type="button">Choose files</button><button class="ghost" data-make="doc" type="button">Document</button><button class="ghost" data-make="table" type="button">Table</button><button class="ghost" data-make="html" type="button">HTML page</button></div>
      <div class="np-list" id="npList"></div>
      <div class="hint" id="npFile"></div></div>
    <div class="f"><label>Brief <span class="pj-opt">optional</span></label>
      <div class="pj-rules" id="npRules"></div>
      <div class="hint">Who the chat is here, the goal, the audience, the rules. The chat reads it at every message. No Brief yet? Five questions write it, from the chat.</div></div>
    <div class="f np-drop" id="npMem"><label>Memory <span class="pj-opt">optional</span></label>
      <div class="pj-rules" id="npMemField"></div>
      <div class="hint">What the chat should know from day one: notes, research, past work. Paste it, add files, or drop them here, up to ${RES_CHARS.toLocaleString()} characters. It is sorted into 3 to 8 folders in the project's memory, and the chat reads the notes that bear on a question.</div></div>
    <div class="f"><div class="pj-step" id="npStep" role="status"></div><div class="bad" id="npBad"></div></div>
    <footer><button class="ghost" id="npCancel" type="button">Cancel</button><button class="go" id="npMake" type="button">Create project</button></footer></div>`;
  document.body.append(veil);
  const name = veil.querySelector("#npName"), pick = veil.querySelector("#npPick"), fileEl = veil.querySelector("#npFile"), listEl = veil.querySelector("#npList"),
        dropEl = veil.querySelector("#npDrop"), stepEl = veil.querySelector("#npStep"), bad = veil.querySelector("#npBad"), make = veil.querySelector("#npMake"), cancel = veil.querySelector("#npCancel");
  const start = veil.querySelectorAll("[data-make]");
  /* Up to 3 files, or a blank to start from, or neither, and the chat picks the type. The first file is the one the project opens on. */
  let files = [], kind = "", busy = false, typed = false, over = "";
  const rules = instructionsField(veil.querySelector("#npRules"));
  rules.ta.id = "npRulesText"; rules.add.id = "npRulesAdd"; rules.count.id = "npRulesCount";
  const memEl = veil.querySelector("#npMem"), mem = instructionsField(veil.querySelector("#npMemField"), "resource");
  mem.ta.id = "npMemText"; mem.add.id = "npMemAdd"; mem.count.id = "npMemCount";
  mem.ta.placeholder = "Paste what the project should know, or add files";
  const sync = () => {
    pick.classList.toggle("on", files.length > 0); pick.setAttribute("aria-pressed", String(files.length > 0));
    pick.textContent = files.length >= NEW_FILES ? `${NEW_FILES} files chosen` : files.length ? "Add files" : "Choose files";
    pick.disabled = busy || files.length >= NEW_FILES;
    start.forEach(b => { b.classList.toggle("on", b.dataset.make === kind); b.setAttribute("aria-pressed", String(b.dataset.make === kind)); });
    listEl.innerHTML = "";
    files.forEach((f, i) => {
      const row = el("div","np-f"); row.append(el("span",null,f.name));
      const x = el("button","np-x","×"); x.type = "button"; x.setAttribute("aria-label", `Remove ${f.name}`); x.disabled = busy;
      x.onclick = () => { files.splice(i, 1); over = ""; sync(); };
      row.append(x); listEl.append(row);
    });
    fileEl.textContent = (files.length === 1 ? "The project opens on it."
      : files.length ? `The project opens on ${files[0].name}. The chat reads all ${files.length}.`
      : kind ? `An empty ${pjNoun(kind)}. Describe it in the chat, from your words and your folders. Every change can be undone.`
      : `Drop up to ${NEW_FILES} files here, or choose them: Word, PDF, text, Markdown, HTML, Excel or CSV, of any length. Or start from a blank and describe it in the chat: with no type, the chat picks one.`)
      + (over ? " " + over : "");
  };
  /* Files join the list once each, up to 3. What is left over is said, with where to add it later. */
  const add = more => {
    if (busy || !more.length) return;
    const seen = new Set(files.map(f => `${f.name}|${f.size}`));
    const fresh = more.filter(f => !seen.has(`${f.name}|${f.size}`));
    const room = NEW_FILES - files.length, kept = fresh.slice(0, Math.max(0, room));
    over = fresh.length > kept.length ? `${fresh.length - kept.length} more left out: a new project takes ${NEW_FILES}. Add them from its + once it is open.` : "";
    if (!kept.length){ sync(); return; }
    files = files.concat(kept); kind = "";
    if (!typed || !name.value.trim()) name.value = files[0].name.replace(/\.[^.]+$/, "").slice(0, 60);
    sync();
  };
  const shut = () => { if (!busy) veil.remove(); };
  name.oninput = () => { typed = true; };
  pick.onclick = () => pickFiles(PJ_FILES, add);
  start.forEach(b => { b.onclick = () => { kind = kind === b.dataset.make ? "" : b.dataset.make; if (kind){ files = []; over = ""; } sync(); }; });
  cancel.onclick = shut; veil.onclick = e => { if (e.target === veil) shut(); };
  /* A file dropped on the memory joins its words; dropped anywhere else on the sheet, it joins the files. */
  const carries = e => [...(e.dataTransfer?.types || [])].includes("Files");
  const target = e => memEl.contains(e.target) ? memEl : dropEl;
  const unlit = () => { dropEl.classList.remove("over"); memEl.classList.remove("over"); };
  veil.ondragover = e => { if (!carries(e)) return; e.preventDefault(); if (busy) return; const t = target(e); unlit(); t.classList.add("over"); };
  veil.ondragleave = e => { if (!veil.contains(e.relatedTarget)) unlit(); };
  veil.ondrop = async e => {
    if (!carries(e)) return;
    e.preventDefault(); const t = target(e); unlit();
    const dropped = [...(e.dataTransfer?.files || [])];
    if (busy || !dropped.length) return;
    if (t === dropEl) return add(dropped);
    for (const f of dropped) await mem.take(f);
  };
  /* A name nothing else in the list has: New table, then New table 2. */
  const free = base => {
    const taken = new Set((S.projects || []).map(p => String(p.name).toLowerCase()));
    let n = base, i = 1; while (taken.has(n.toLowerCase())) n = `${base} ${++i}`;
    return n;
  };
  const lock = on => { make.disabled = on; rules.lock(on); mem.lock(on); cancel.disabled = on; start.forEach(b => { b.disabled = on; }); sync(); };
  const run = async () => {
    const nm = name.value.trim() || (kind ? free(`New ${pjNoun(kind)}`) : files.length ? "" : free("New project"));
    if (!nm){ name.focus(); return; }
    busy = true; lock(true); bad.textContent = "";
    const say = t => { stepEl.textContent = t; };
    /* Each step names its file when there are several. */
    const sayOf = (i, f) => t => say(files.length > 1 ? `${f.name}, ${i + 1} of ${files.length}: ${t}` : t);
    let slug = "", phase = "file", stored = 0;
    try {
      /* What is read here is read first: a file that cannot be read makes no project. */
      const got = [];
      for (const [i, f] of files.entries()) got.push(await readProjectFile(f, sayOf(i, f)));
      const words = rules.text() ? { name: rules.name(), text: rules.text() } : null;
      const memo = mem.text() ? { name: mem.name(), text: mem.text() } : null;
      slug = (await api("/api/project/new", { name: nm, ...(kind ? { make: kind } : {}) })).slug;
      /* A server older than this page leaves the project with no file: say so, and leave nothing behind. */
      if (kind && !(await api("/api/project/get", { brain: slug })).file){
        try { await api("/api/project/delete", { brain: slug }); slug = ""; } catch { /* the project stays, and the line below says so */ }
        throw new Error("The server is older than this page and cannot start a file from nothing yet. Run convex deploy, then try again.");
      }
      /* The first file is the project's own; the others are files beside it, as the + adds them. */
      for (const [i, g] of got.entries()){
        let key = slug;
        if (i > 0){
          try { key = (await api("/api/project/file", { brain: slug, action: "new", kind: g.kind, name: g.name, made: false })).key; }
          catch (e){ throw new Error(/unreadable/.test(e.message) ? "The server is older than this page and cannot hold several files yet. Run convex deploy." : e.message); }
        }
        await uploadProject(key, g, sayOf(i, files[i]));
        stored = i + 1;
      }
      let cut = false, filed = null;
      if (words){ phase = "brief"; say("Saving the Brief"); cut = !!(await sendBrief(slug, words.text)).cut; }
      /* The first memory: sorted into folders, then filed as notes in them. */
      if (memo){ phase = "memory"; filed = await fileMemory(slug, memo, say, { plan: true }); }
      busy = false; veil.remove();
      await syncProjects();
      await openProject(slug);
      if (cut) pjNote(`Only the first ${BRIEF_CHARS.toLocaleString()} characters of the Brief were kept, about 1,000 words.`);
      if (filed?.cut) pjNote(`Only the first ${RES_CHARS.toLocaleString()} characters of the memory were read, about ${RES_WORDS}.`);
      if (filed?.unsorted) pjNote(`The memory was filed without folders: ${filed.unsorted}`);
    } catch (e){
      busy = false; lock(false);
      const left = files.length > 1 && stored < files.length ? `add ${files.slice(stored).map(f => f.name).join(" and ")} again from its +` : "add the file again";
      stepEl.textContent = ""; bad.textContent = slug ? `${e.message} The project was made: open it to ${phase === "brief" ? "write the Brief again from Memory" : phase === "memory" ? "add the memory again from Memory" : left}.` : e.message;
      if (slug){ make.textContent = "Open the project"; make.onclick = async () => { veil.remove(); await syncProjects(); await openProject(slug); }; }
    }
  };
  make.onclick = run;
  name.onkeydown = e => { if (e.key === "Enter") make.click(); };
  sync();
  setTimeout(() => name.focus(), 30);
}

