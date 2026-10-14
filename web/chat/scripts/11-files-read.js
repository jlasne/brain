/* 11-files-read.js: reading a file in this tab, for an asset. The file is read here and goes to the server a piece at a time, cut in
   sections, so a file of any size goes in and a chat reads only what it needs of it. */

const PJ_FILES = ".pdf,.txt,.md,.markdown,.text,.docx,.csv,.tsv,.xlsx,.xls,.html,.htm,.xhtml";
const PJ_PIECE = 120000;            /* characters of a document sent at a time */
const PJ_ROWS = 4000;               /* rows of a sheet sent at a time */
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const XLSX_SRI = "sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==";
const PJ_ICON = {
  doc: `<svg class="b-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>`,
  table: `<svg class="b-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 5v14"/></svg>`,
  html: `<svg class="b-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12"/></svg>`,
};
const pjIcon = k => PJ_ICON[k === "table" ? "table" : k === "html" ? "html" : "doc"];
/** What an asset is called: a document, a page or a table. */
const pjNoun = k => k === "table" ? "table" : k === "html" ? "page" : "document";
/** What an asset is, as a word that starts a line. */
const kindTitle = f => f?.kind === "table" ? "Table" : f?.kind === "html" ? "Page" : "Document";

/* ---- reading a file in this tab ---- */

/** Text with Markdown's marks, as a page of HTML: headings, lists inside lists, quotes, code, tables, bold, italic, links, a PDF's page marks. A # is an h2 under the page's own title; `top` sets its level. */
function mdView(text, top = 2){
  const fmt = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  /* A web address is a link only as [words](https://...): its own marks are never read as bold or italic. */
  const inline = s => {
    let html = "", last = 0;
    const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    for (let m; (m = re.exec(s));){ html += fmt(s.slice(last, m.index)) + `<a href="${esc(m[2])}" target="_blank" rel="noopener noreferrer">${fmt(m[1])}</a>`; last = m.index + m[0].length; }
    return html + fmt(s.slice(last));
  };
  const out = []; let para = [], items = [], table = [], quote = [];
  /* A PDF or a plain text file breaks its lines where the page ended: a long line with no stop is read on into the next. */
  const flushP = () => {
    if (!para.length) return;
    const soft = l => l.length >= 50 && !/[.!?:;]["')\]]?$/.test(l);
    out.push("<p>" + para.map((l, i) => (i ? (soft(para[i - 1]) ? " " : "<br>") : "") + inline(l)).join("") + "</p>");
    para = [];
  };
  /* Items carry how far they are indented; a deeper item opens a list inside the one above it. */
  const flushL = () => {
    if (!items.length) return;
    let html = ""; const st = [];
    for (const it of items){
      while (st.length && it.indent < st[st.length - 1].indent) html += `</li></${st.pop().t}>`;
      const top = st[st.length - 1];
      if (!top || it.indent > top.indent){ html += `<${it.t}${it.t === "ol" && it.num > 1 ? ` start="${it.num}"` : ""}>`; st.push({ t: it.t, indent: it.indent }); }
      else { html += "</li>"; if (top.t !== it.t){ html += `</${top.t}><${it.t}>`; top.t = it.t; } }
      html += `<li>${inline(it.text)}`;
    }
    while (st.length) html += `</li></${st.pop().t}>`;
    out.push(html); items = [];
  };
  const flushQ = () => { if (quote.length){ out.push("<blockquote><p>" + quote.map(inline).join(" ") + "</p></blockquote>"); quote = []; } };
  const cells = r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const flushT = () => {
    if (!table.length) return;
    const sep = table.findIndex(r => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(r));
    const head = sep > 0 ? table.slice(0, sep) : [], body = table.filter((r, i) => i !== sep && !head.includes(r));
    out.push("<div class=\"pj-tw\"><table>" + (head.length ? "<thead>" + head.map(r => "<tr>" + cells(r).map(c => `<th>${inline(c)}</th>`).join("") + "</tr>").join("") + "</thead>" : "") +
      "<tbody>" + body.map(r => "<tr>" + cells(r).map(c => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
    table = [];
  };
  const flush = () => { flushP(); flushL(); flushT(); flushQ(); };
  let code = null;
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")){
    const line = raw.trimEnd(), t = line.trim();
    /* A fence opens a block of code, shown as it is written, and runs to the next fence. */
    if (/^```/.test(t)){
      if (code){ out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = null; }
      else { flush(); code = []; }
      continue;
    }
    if (code){ code.push(line); continue; }
    const pg = /^\[\[p\. (\d+)\]\]$/.exec(t);
    if (pg){ flush(); out.push(`<div class="pj-pg">p. ${pg[1]}</div>`); continue; }
    if (!t){ flush(); continue; }
    if (/^([-*_])\1{2,}$/.test(t)){ flush(); out.push("<hr>"); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(t);
    if (h){ flush(); out.push(`<h${h[1].length + top - 1}>${inline(h[2])}</h${h[1].length + top - 1}>`); continue; }
    const q = /^>\s?(.*)$/.exec(t);
    if (q){ flushP(); flushL(); flushT(); quote.push(q[1]); continue; }
    const li = /^(\s*)([-*•]|(\d+)[.)])\s+(.+)$/.exec(line);
    if (li){ flushP(); flushT(); flushQ(); items.push({ t: li[3] ? "ol" : "ul", num: Number(li[3] || 0), indent: li[1].replace(/\t/g, "    ").length, text: li[4] }); continue; }
    if (/^\|.*\|$/.test(t)){ flushP(); flushL(); flushQ(); table.push(t); continue; }
    flushL(); flushT(); flushQ(); para.push(t);
  }
  if (code) out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
  flush();
  return out.join("");
}

/**
 * HTML as Markdown: headings, paragraphs, lists inside lists, tables, quotes,
 * code, links, bold and italic. Word's own HTML comes through it, and so does
 * a page saved from the web: scripts, styles, menus and forms are left out,
 * the main part is kept, and text that sits loose in a block is still text.
 */
function htmlToMd(html){
  const d = new DOMParser().parseFromString(html, "text/html");
  const title = (d.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim();
  for (const x of d.querySelectorAll("script,style,noscript,template,iframe,svg,canvas,link,meta,[hidden],[aria-hidden='true']")) x.remove();
  const root = d.querySelector("main,article,[role='main']") || d.body;
  const SKIP = new Set(["NAV","FOOTER","ASIDE","FORM","BUTTON","SELECT","TEXTAREA","INPUT","DIALOG","IMG","HEAD"]);
  const BLOCK = new Set(["P","DIV","SECTION","ARTICLE","MAIN","HEADER","LI","UL","OL","TABLE","TR","TD","TH","BLOCKQUOTE","PRE","H1","H2","H3","H4","H5","H6","DL","DT","DD","FIGURE","FIGCAPTION","ADDRESS","CENTER","HR","BODY"]);
  const space = t => t.replace(/[ \t\r\f\u00a0]+/g, " ");
  /* The inline text of a node, with its bold, italic, code and links marked. A block inside it reads as a break. */
  const inl = (n, noLists) => {
    let s = "";
    for (const c of n.childNodes){
      if (c.nodeType === 3){ s += c.nodeValue.replace(/\s+/g, " "); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "BR"){ s += "\n"; continue; }
      if (SKIP.has(t) || (noLists && (t === "UL" || t === "OL"))) continue;
      const inner = inl(c, noLists), core = inner.trim();
      if (BLOCK.has(t)){ s += " " + inner + " "; continue; }
      if (!core){ s += /\s/.test(inner) ? " " : ""; continue; }
      const pre = /^\s/.test(inner) ? " " : "", post = /\s$/.test(inner) ? " " : "";
      if (t === "A"){ const h = c.getAttribute("href") || ""; s += /^https?:\/\//i.test(h) ? `${pre}[${core}](${h})${post}` : inner; }
      else if (t === "STRONG" || t === "B") s += `${pre}**${core}**${post}`;
      else if (t === "EM" || t === "I") s += `${pre}*${core}*${post}`;
      else if (t === "CODE" || t === "KBD" || t === "SAMP") s += `${pre}\`${core}\`${post}`;
      else s += inner;
    }
    return s;
  };
  const line = t => space(t).replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  /* A node's blocks, in order. Loose inline text gathers into a paragraph and ends at the next block. */
  const blocks = node => {
    const out = []; let run = "";
    const flush = () => { const t = line(run); if (t) out.push(t); run = ""; };
    const list = (el, depth, lines) => {
      let i = 0;
      for (const li of el.children){
        if (li.tagName !== "LI") continue;
        i++;
        const own = line(inl(li, true)).replace(/\s*\n\s*/g, " ");
        if (own) lines.push(`${"  ".repeat(depth)}${el.tagName === "OL" ? i + "." : "-"} ${own}`);
        for (const sub of li.children) if (sub.tagName === "UL" || sub.tagName === "OL") list(sub, depth + 1, lines);
      }
    };
    const table = t => {
      const rows = [...t.querySelectorAll("tr")].filter(tr => tr.closest("table") === t)
        .map(tr => [...tr.children].filter(c => /^T[DH]$/.test(c.tagName)));
      const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
      if (!w) return;
      /* A layout table, one column wide or holding other tables, is read as the blocks it holds. */
      if (w < 2 || t.querySelector("table")){ for (const r of rows) for (const c of r) out.push(...blocks(c)); return; }
      const cell = c => line(inl(c)).replace(/\s*\n\s*/g, " ").replace(/\|/g, "/");
      const pad = r => `| ${Array.from({ length: w }, (_, i) => r[i] ? cell(r[i]) : "").join(" | ")} |`;
      out.push([pad(rows[0]), `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n"));
    };
    const walk = n => {
      if (n.nodeType === 3){ run += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (SKIP.has(t)) return;
      if (/^H[1-6]$/.test(t)){ flush(); const s = line(inl(n)).replace(/\s*\n\s*/g, " "); if (s) out.push("#".repeat(Math.min(3, Number(t[1]))) + " " + s); return; }
      if (t === "UL" || t === "OL"){ flush(); const lines = []; list(n, 0, lines); if (lines.length) out.push(lines.join("\n")); return; }
      if (t === "TABLE"){ flush(); table(n); return; }
      if (t === "PRE"){ flush(); const c = n.textContent.replace(/\s+$/, ""); if (c.trim()) out.push("```\n" + c + "\n```"); return; }
      if (t === "HR"){ flush(); return; }
      if (t === "BLOCKQUOTE"){ flush(); const inner = blocks(n).join("\n\n"); if (inner) out.push(inner.split("\n").map(l => "> " + l).join("\n")); return; }
      if (BLOCK.has(t)){ flush(); for (const c of n.childNodes) walk(c); flush(); return; }
      /* An inline element read in place keeps its marks. */
      if (n.children.length === 0 || [...n.children].every(c => !BLOCK.has(c.tagName))){ run += inl({ childNodes: [n] }); return; }
      for (const c of n.childNodes) walk(c);
    };
    for (const c of node.childNodes) walk(c);
    flush();
    return out;
  };
  const out = blocks(root);
  /* A page without a heading of its own is named by its title. */
  if (title && !root.querySelector("h1") && !out.some(b => /^# /.test(b))) out.unshift("# " + title.slice(0, 150));
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A Word file as Markdown. */
async function docxMarkdown(file){
  await loadMammoth();
  const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return htmlToMd(String(r?.value ?? ""));
}

/** A PDF as text, each page opening with its mark so an answer can name its page. */
async function pdfPages(file, say){ return await pdfRead(file, say, true); }

/** Comma, semicolon or tab separated text as rows. A quoted cell may hold the separator, quotes and line breaks. */
function parseDelimited(text, sep){
  const s = String(text ?? "").replace(/^﻿/, ""), out = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++){
    const ch = s[i];
    if (q){ if (ch === '"'){ if (s[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep){ row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r"){ if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; out.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== "" || row.length){ row.push(cell); out.push(row); }
  return out;
}

/** The Excel reader, loaded the first time an Excel file is chosen and checked against the file cdnjs published. */
async function loadXlsx(){
  if (window.XLSX) return;
  await new Promise((ok, no) => {
    const t = document.createElement("script");
    t.integrity = XLSX_SRI; t.crossOrigin = "anonymous"; t.src = XLSX_URL; t.onload = ok;
    t.onerror = () => no(new Error("the Excel reader did not load. Check the connection."));
    document.head.append(t);
  });
}

/** A workbook's sheets as rows of text, as Excel shows them. */
async function workbookSheets(file){
  await loadXlsx();
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets = [];
  for (const name of wb.SheetNames.slice(0, 40)){
    /* The one published weakness of this reader needs a sheet named like an object's own parts. */
    if (/^(__proto__|constructor|prototype)$/i.test(name)) continue;
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
    sheets.push({ name, rows: rows.map(r => r.map(c => String(c ?? ""))) });
  }
  return sheets;
}

/** Sheets of rows as a table: the first row is the header, empty rows and columns at the edge are cut. */
function tableOf(name, sheets){
  const out = [];
  for (const s of sheets){
    const rows = s.rows.filter(r => r.some(c => String(c).trim()));
    if (!rows.length) continue;
    /* The widest row, found one by one: a spread of 300,000 rows into one call overflows the stack. */
    let widest = 0;
    for (const r of rows){ let n = r.length; while (n && !String(r[n - 1]).trim()) n--; if (n > widest) widest = n; }
    const width = Math.min(60, widest);
    const fit = r => Array.from({ length: width }, (_, i) => String(r[i] ?? ""));
    out.push({ name: String(s.name).slice(0, 60), header: fit(rows[0]), rows: rows.slice(1).map(fit) });
  }
  if (!out.length) throw new Error(`${name} holds no rows to read.`);
  return { kind: "table", name, sheets: out };
}

/** A chosen file as a document or a table, read here. The file itself is never uploaded: its text and rows are. */
async function readFileIn(file, say){
  const name = file.name || "file", ext = name.toLowerCase().split(".").pop();
  if (file.size > 30 * 1024 * 1024) throw new Error(`${name} is ${Math.round(file.size / 1048576)}MB. 30MB is the ceiling.`);
  say(`Reading ${name}`);
  if (ext === "pdf") return { kind: "doc", name, text: await pdfPages(file, say) };
  if (ext === "docx") return { kind: "doc", name, text: await docxMarkdown(file) };
  if (ext === "csv" || ext === "tsv"){
    const text = await file.text();
    const first = text.split("\n", 1)[0] || "";
    const sep = ext === "tsv" ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
    return tableOf(name, [{ name: name.replace(/\.[^.]+$/, ""), rows: parseDelimited(text, sep) }]);
  }
  if (ext === "xlsx" || ext === "xls"){ say("Loading the Excel reader"); return tableOf(name, await workbookSheets(file)); }
  if (["html", "htm", "xhtml"].includes(ext)) return { kind: "html", name, text: (await file.text()).trim() };
  if (["txt", "md", "markdown", "text"].includes(ext) || file.type.startsWith("text/")) return { kind: "doc", name, text: (await file.text()).trim() };
  throw new Error(`${name} is a .${ext}. An asset is a Word, PDF, text, Markdown, HTML, Excel or CSV file.`);
}

/** A text cut in pieces of about `max` characters, on paragraph breaks. */
function cutText(t, max){
  const out = []; let cur = "";
  for (const p of String(t).split(/\n{2,}/)){
    if (cur && cur.length + p.length + 2 > max){ out.push(cur); cur = ""; }
    if (p.length > max){ for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max)); continue; }
    cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** The file sent to the server a piece at a time, as asset number `fid`. `step` says where it stands. */
async function uploadAsset(fid, got, step){
  /* What an asset holds is said before the first piece goes, not after most of them have. */
  if (got.kind !== "table" && got.text.length > 12000000) throw new Error(`${got.name} is longer than an asset holds: about 4,000 pages.`);
  if (got.kind === "table" && got.sheets.reduce((n, s) => n + s.rows.reduce((a, r) => a + r.reduce((b, c) => b + c.length + 1, 0), 0), 0) > 6000000)
    throw new Error(`${got.name} is bigger than an asset holds: about 40,000 rows of 10 columns.`);
  const begin = await api("/api/assets/begin", { file: fid, name: got.name, kind: got.kind,
    ...(got.kind === "table" ? { sheets: got.sheets.map(s => ({ name: s.name, header: s.header })) } : {}) });
  if (got.kind !== "table"){
    const pieces = cutText(got.text, PJ_PIECE);
    if (!pieces.length) throw new Error(`${got.name} gave no text. A scanned PDF holds pictures of words, so it needs its text.`);
    let page = 0;
    for (let i = 0; i < pieces.length; i++){
      step(pieces.length > 1 ? `Cutting it in sections: part ${i + 1} of ${pieces.length}` : "Cutting it in sections");
      await api("/api/assets/part", { file: fid, ver: begin.ver, text: pieces[i], page });
      const last = [...pieces[i].matchAll(/^\[\[p\. (\d+)\]\]$/gm)].pop();
      if (last) page = Number(last[1]);
    }
  } else {
    for (const [si, s] of got.sheets.entries()){
      for (let at = 0; at < s.rows.length;){
        let n = 0, chars = 0;
        while (at + n < s.rows.length && n < PJ_ROWS && chars < 150000){ chars += s.rows[at + n].reduce((a, c) => a + c.length + 1, 0); n++; }
        step(`Storing ${s.name}: rows ${at + 1} to ${at + n} of ${s.rows.length}`);
        await api("/api/assets/part", { file: fid, ver: begin.ver, sheet: si, rows: s.rows.slice(at, at + n) });
        at += n;
      }
    }
  }
  step("Counting what each column holds");
  return await api("/api/assets/finish", { file: fid, ver: begin.ver });
}

