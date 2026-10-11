/* 08-folder.js: A folder open: its concepts, the concept view, the personal folder and people, and the graph. */

/* ============ a folder, open ============ */
const IC_CHAT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>`;
const IC_DROP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10M8 10l4 4 4-4M5 16v4h14v-4"/></svg>`;
const IC_IV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M10 9.3a2 2 0 1 1 2.7 1.9c-.4.2-.7.5-.7 1v.3M12 14.3v.1"/></svg>`;
const IC_TEST = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6M10 4v5l-5 9a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-9V4"/><path d="M7.5 14h9"/></svg>`;
const IC_PROFILE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`;
/** A share out of 100 as a ring, the way a folder's health is drawn. */
function pctRing(pct){
  const r = el("span","hring");
  const C = 2 * Math.PI * 9, fill = Math.max(0, Math.min(1, (pct || 0) / 100)) * C;
  r.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="tr" cx="12" cy="12" r="9"/>
    <circle class="ar ${healthTone((pct || 0) / 10)}" cx="12" cy="12" r="9" stroke-dasharray="${fill.toFixed(2)} ${C.toFixed(2)}"/>
    <text x="12" y="12.4">${Math.round(pct || 0)}</text></svg>`;
  return r;
}
const IC_EDIT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.2 4.3a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L9 19.5 4 20l.5-5Z"/></svg>`;
const dayOf = d => { const t = Date.parse(d); return isNaN(t) ? String(d || "") : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
/* A person's file: its sections, and its dates as people say them: a day, a month, or a year. */
const FILE_SECTIONS = [["identity","Identity"], ["contact","Contact details"], ["you","You and them"], ["work","Work"], ["tastes","Tastes and character"], ["other","Other"]];
function fileDay(d, noYear){
  const s = String(d || "");
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = s.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return s;
  const [, y, mo, da] = m;
  if (!mo) return y;
  const month = M[Number(mo) - 1] || mo;
  if (!da) return noYear ? month : `${month} ${y}`;
  return noYear ? `${Number(da)} ${month}` : `${Number(da)} ${month} ${y}`;
}

/**
 * A folder in the main area: its name, scope and counts, its health and the
 * next move, then every concept, newest first, and the one open beside them.
 * The bar below asks this folder, and the answer lands in a new chat.
 */
function openFolder(b, openId, opts = {}){
  closeSide();
  if (!b) return;
  if (S.mode === "drop") S.mode = "ask";
  if (isPersonal(b.slug)){ crossing(b.slug); S.picks = []; S.scope = b.slug; S.into = []; }
  else { crossing("all"); setPicks([b.slug]); }
  S.folder = b.slug;
  const fv = $("folderView"); fv.innerHTML = "";
  const self = isPersonal(b.slug), ro = readOnly(b);
  const sorted = () => conceptsOf(b.slug).slice().sort((x, y) => String(y.updated || "").localeCompare(String(x.updated || "")) || (y.src || 0) - (x.src || 0));
  /* What changes while the screen is open, shared with its parts below. */
  const live = {};
  live.cs = sorted();
  const reads = sourcesOf(b.slug).length, h = S.health[b.slug];
  const clashes = h ? (h.open || 0) : [...(S.conflicted || [])].filter(id => id.split("/")[0] === b.slug).length;

  /* A personal folder's panes are made further down; the buttons of the head reach them here once made. */
  const panes = {};
  const { head } = folderHead({ b, self, live, reads, clashes, h, ro, panes });

  const cols = el("div","fv-cols");
  const list = el("div","fv-list");
  const f = el("input","fv-filter"); f.placeholder = self ? "Filter notes" : "Filter concepts"; f.id = "fvFilter";
  const rows = el("div","fv-rows");
  /* Its topics: concepts that link to each other, named. A tap shows one. */
  const tops = el("div","fv-topics"); tops.hidden = true;
  const topLine = el("p","fv-topline"); topLine.hidden = true;
  let topic = null;
  /* A personal folder holds notes and contacts: one card per person, tagged. */
  live.tab = self && openId && live.cs.find(c => `${c.brain}/${c.slug}` === openId)?.tag === "contact" ? "people" : "notes";
  const tabs = el("div","fv-tabs"); tabs.hidden = !self;
  const scan = el("div","fv-scan"); scan.hidden = true;
  const isPerson = c => c.tag === "contact";
  const inTab = list0 => self ? list0.filter(c => (live.tab === "people") === isPerson(c)) : list0;
  const paintTabs = () => {
    tabs.innerHTML = "";
    for (const [k, label] of [["notes","Notes"], ["people","People"]]){
      const n = live.cs.filter(c => (k === "people") === isPerson(c)).length;
      const x = el("button","fv-tab" + (live.tab === k ? " on" : "")); x.type = "button"; x.id = k === "people" ? "fvPeople" : "fvNotes";
      x.append(label, el("i",null,String(n)));
      x.onclick = () => { live.tab = k; f.value = ""; f.placeholder = k === "people" ? "Filter people" : "Filter notes"; paintTabs(); paint(); paintScan(); };
      tabs.append(x);
    }
  };
  /* The people in older notes are found by the audit, in Settings. */
  const paintScan = () => { scan.hidden = true; };
  if (self) paintTabs();
  list.append(tabs, f, scan, tops, topLine, rows);
  if (!self) api("/api/topics", { brain: b.slug }).then(r => {
    const list2 = (r.topics || []).filter(t => t.members.length);
    if (!list2.length || S.folder !== b.slug) return;
    tops.hidden = false;
    const chip = (t, label) => {
      const x = el("button","fv-top" + (t === topic ? " on" : "")); x.type = "button";
      x.append(label); if (t) x.append(el("i",null,String(t.members.length)));
      x.onclick = () => { topic = t; paintTops(); paint(); };
      return x;
    };
    const paintTops = () => {
      tops.innerHTML = "";
      tops.append(chip(null, "All"));
      for (const t of list2) tops.append(chip(t, t.title));
      topLine.hidden = !topic; topLine.textContent = topic ? topic.summary : "";
    };
    paintTops();
  }).catch(() => {});
  const doc = el("div","fv-doc");
  cols.append(list, doc);
  fv.append(head, cols);

  live.openNow = null;
  /* The page of a person open last: an edit brings you back to it. */
  live.pfTab = "overview";
  const paint = () => {
    rows.innerHTML = "";
    const q = f.value.trim().toLowerCase();
    const base = inTab(topic ? live.cs.filter(c => topic.members.includes(`${c.brain}/${c.slug}`)) : live.cs);
    const shown = q ? base.filter(c => (c.title + " " + (c.summaryLine || "") + " " + (c.aliases || []).join(" ")).toLowerCase().includes(q)) : base;
    if (!shown.length){ rows.append(el("div","fv-none", q ? "Nothing matches that."
      : self && live.tab === "people" ? "No contact yet. Talk about someone and they get a card here."
      : live.cs.length ? "No concept matches that." : self ? "Nothing yet. Talk to it and it files what you say." : "Nothing yet. Drop a source to feed it.")); return; }
    for (const c of shown){
      const id = `${c.brain}/${c.slug}`;
      const r = el("button","fv-row" + (id === live.openNow ? " on" : "")); r.type = "button"; r.dataset.id = id;
      r.append(el("b",null,c.title));
      if (c.summaryLine) r.append(el("span",null,c.summaryLine));
      r.append(el("small",null, isPerson(c)
        ? `${c.ev || 0} mention${c.ev === 1 ? "" : "s"}${c.seen ? " · seen " + fileDay(c.seen) : c.updated ? " · last " + dayOf(c.updated) : ""}`
        : `${c.src || 0} source${c.src === 1 ? "" : "s"}${c.updated ? " · " + dayOf(c.updated) : ""}`));
      r.onclick = () => show(id);
      rows.append(r);
    }
  };
  f.oninput = paint;

  const nameOf = slug => S.brains.find(x => x.slug === slug)?.name || slug;
  /* A concept of this folder opens here; one of another folder opens there. */
  const go = r => { const rb = r.split("/")[0]; if (rb === b.slug) show(r); else openFolder(S.brains.find(x => x.slug === rb), r); };
  const show = async id => {
    live.openNow = id;
    for (const r of rows.children) r.classList?.toggle("on", r.dataset?.id === id);
    cols.classList.add("reading");
    doc.innerHTML = ""; doc.scrollTop = 0;
    const inner = el("div","fv-in"); doc.append(inner);
    const back = el("button","fv-back", self ? (live.tab === "people" ? "← All people" : "← All notes") : "← All concepts"); back.type = "button";
    back.onclick = () => { cols.classList.remove("reading"); live.openNow = null; paint(); };
    inner.append(back, el("div","fv-none","Opening"));
    let c, insights = [], linkedFrom = [], raw = null, pg = null;
    try { const got = await api("/api/concept", { id }); c = got.concept; insights = got.insights || []; linkedFrom = got.linkedFrom || []; raw = got.raw || null; pg = got.pages || null; }
    catch (e) { inner.lastChild.textContent = e.message; return; }
    if (live.openNow !== id || S.folder !== b.slug) return;
    if (!c){ inner.lastChild.textContent = "This concept is no longer here."; return; }
    inner.lastChild.remove();
    const person = c.tag === "contact";
    inner.append(el("div","fv-eye",`${person ? "Contact" : self ? "Note" : "Concept"} · ${b.name}`), el("h1",null,c.title));
    if (person && (c.aliases || []).length) inner.append(el("p","fv-aka",`Also: ${c.aliases.join(", ")}`));
    if (person){
      const n = (c.evidence || []).length, last = (c.evidence || []).map(e => e.date || "").sort().pop();
      inner.append(el("p","pf-meta", [c.file?.seen ? `Last seen ${fileDay(c.file.seen)}` : "", last ? `last mentioned ${fileDay(last)}` : "",
        `${n} mention${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ")));
    }
    inner.append(el("p","fv-pos", c.position || c.summaryLine || "No position yet."));
    /* A person's card is yours to correct: edit it, or merge it with the
       card of the same person under another name. */
    if (person && !S.demo){
      const acts = el("div","ct-acts");
      const ed = el("button","mini","Edit"); ed.type = "button"; ed.id = "ctEdit";
      const mg = el("button","mini","Merge with another card"); mg.type = "button"; mg.id = "ctMerge";
      const pick = el("div","ct-pick"); pick.hidden = true;
      ed.onclick = () => editCard(c, id);
      mg.onclick = () => { pick.hidden = !pick.hidden; if (!pick.hidden) mergePick(pick, c, id); };
      acts.append(ed, mg); inner.append(acts, pick);
    }
    /* A person is a folder: an overview, then their facts, history by year,
       people, and raw notes by month, each a page of its own. */
    const pp = person ? personTabs(inner, c, raw, linkedFrom) : null;
    if (person){ personFile(pp, c, id, linkedFrom, pg); rawNotes(pp.panes.raw, raw, id, pg); }
    /* What to read first, from its "needs" links. */
    const first = needsOf(c);
    if (first.length){
      const lf = el("div","fv-first"); lf.append(el("span",null,"Learn first"));
      for (const r of first){ const card = cardById(r); const ch = el("button","vw-link", card.title); ch.type = "button"; ch.onclick = () => go(r); lf.append(ch); }
      inner.append(lf);
    }
    const ev = (c.evidence || []).slice().sort((x, y) => (x.rollup ? 1 : 0) - (y.rollup ? 1 : 0) || String(y.date || y.to || "").localeCompare(String(x.date || x.to || "")));
    /* A person's own words sit folded under the file; a concept's evidence is its body. */
    const evBox = person ? el("details","pf-said") : inner;
    if (person){ const sm = el("summary"); sm.id = "pfSaid"; sm.append(`Each mention in one line · ${ev.length}`); evBox.append(sm); pp.panes.raw.append(evBox); }
    else inner.append(el("h4",null, ev.length ? `Evidence, newest first (${ev.length})` : "Evidence"));
    if (!ev.length) evBox.append(el("div","fv-li","None yet."));
    for (const e of ev){
      const row = el("div","fv-ev");
      row.append(el("time",null, e.rollup ? `${e.from || ""}${e.to && e.to !== e.from ? " to " + e.to : ""}` : (e.date || "")));
      const d = el("div");
      if (!e.rollup && e.author){ d.append(el("b",null,e.author + ". ")); }
      d.append(e.claim || "");
      /* Kept in English: their own words beside it, as they said them. */
      if (e.orig) d.append(el("span","ev-orig", e.orig));
      row.append(d); evBox.append(row);
    }
    if ((c.data || []).length){
      inner.append(el("h4",null,"Figures"));
      for (const x of c.data) inner.append(el("div","fv-li",x));
    }
    if ((c.conflicts || []).length){
      inner.append(el("h4",null,"Open clashes"));
      for (const x of c.conflicts) inner.append(el("div","fv-li",`${x.a || ""} (${x.aDate || "?"}) against ${x.b || ""} (${x.bDate || "?"})${x.why ? ". " + x.why : ""}`));
    }
    if ((c.related || []).length){
      inner.append(el("h4",null,"Linked to"));
      const d = el("div","fv-links");
      for (const r of c.related) d.append(linkChip(c, r, go, nameOf));
      inner.append(d);
    }
    /* What reading this one opens: the concepts that need it first. */
    const opens = unlocksOf(id);
    if (opens.length){
      inner.append(el("h4",null,"Read it before"));
      const d = el("div","fv-links");
      for (const x of opens.slice(0, 12)){
        const chip = el("button","vw-link"); chip.type = "button";
        chip.append(el("i","lk-needs","then"), x.title + (x.brain !== c.brain ? ` · ${nameOf(x.brain)}` : ""));
        chip.onclick = () => go(`${x.brain}/${x.slug}`);
        d.append(chip);
      }
      inner.append(d);
    }
    if (insights.length){ inner.append(el("h4",null,"What follows")); inner.append(insightsBlock(insights, id, go, nameOf)); }
    const srcs = (c.sources || []).map(sid => S.sources.find(x => x.sid === sid)).filter(Boolean);
    if (srcs.length){
      inner.append(el("h4",null,`Sources (${(c.sources || []).length})`));
      for (const x of srcs.slice(-12).reverse()) inner.append(el("div","fv-li",`${x.date || ""} · ${x.title || x.sid}${x.author ? " · " + x.author : ""}`));
    }
    const a2 = el("div","fv-acts2");
    /* A chat on this one alone. In the personal folder, what you tell it changes it. */
    const askIt = el("button","fresh","Chat about it"); askIt.type = "button"; askIt.id = "fvAsk";
    askIt.title = self ? "A chat on this one alone. A fact or a correction you give is written to it." : "A chat that reads this concept alone";
    askIt.onclick = () => chatAbout({ id, title: c.title, brain: b.slug, personal: !!self });
    a2.append(askIt, el("span","fv-upd", c.updated ? `Updated ${c.updated}` : ""));
    inner.append(a2);
  };

  const { personTabs, personFile, rawNotes } = folderPeople({ live, show });

  const { reload, editCard, mergePick } = folderEdits({ live, doc, b, show, sorted, self, paintTabs, paint });

  const { backToAudit, personalAudit, tidy } = folderAudit({ live, paint, cols, doc, b, reload, isPerson });

  Object.assign(panes, folderTwinPanes({ live, paint, cols, doc, b, reload }));

  paint();
  const wide = window.matchMedia("(min-width:861px)").matches;
  if (opts.audit && opts.resume && S.auditRun?.slug === b.slug && S.auditRun.inner) backToAudit();
  else if (opts.audit) (self ? personalAudit() : tidy());
  else if (openId) show(openId);
  else if (self && !S.demo && wide) panes.twinPane();
  else if (wide && live.cs.length) show(`${live.cs[0].brain}/${live.cs[0].slug}`);
  else { const p = el("div","fv-in"); p.append(el("div","fv-none", live.cs.length ? "Pick a concept to read it." : "")); doc.append(p); }
  render();
}

/** The head of a folder screen: its name and counts, its health or twin card, and its actions. */
function folderHead({ b, self, live, reads, clashes, h, ro, panes }){
  const head = el("header","fv-h");
  const t = el("div","fv-t");
  t.append(el("h2",null,b.name));
  if (b.scope && !self) t.append(el("p",null,b.scope));
  const nPeople = self ? live.cs.filter(c => c.tag === "contact").length : 0, nNotes = live.cs.length - nPeople;
  t.append(el("p","fv-n", self ? `${nNotes} note${nNotes===1?"":"s"} · ${nPeople} ${nPeople===1?"person":"people"} · only its own chat reads it`
    : `${live.cs.length} concept${live.cs.length===1?"":"s"} · ${reads} source${reads===1?"":"s"} · ${clashes} clash${clashes===1?"":"es"}`));
  head.append(t);
  if (h && !self){
    const hl = el("button","fv-hl"); hl.type = "button"; hl.id = "fvHealth";
    const ring = healthRing(h, b, false); ring.removeAttribute("aria-label");
    const txt = el("div"); txt.append(el("b",null,`Health ${fmtScore(h.score)} / 10`), el("span","say",`Next: ${h.best}`));
    hl.append(ring, txt);
    hl.onclick = () => openHealthSheet(b);
    head.append(hl);
  }
  /* A personal folder shows how well it knows you in place of a health score. */
  if (self && !S.demo){
    const tw = el("button","fv-hl"); tw.type = "button"; tw.id = "fvTwin";
    const fillCard = iv => {
      tw.innerHTML = "";
      const ring = pctRing(iv ? iv.pct : 0); ring.removeAttribute("role");
      const txt = el("div");
      txt.append(el("b",null, iv ? `Twin ${iv.pct}% complete` : "Your twin"),
        el("span","say", !iv ? "How well it knows you" : iv.on ? `Interview on · ${iv.chapter?.title || "last questions"}`
          : iv.chapter ? `Next: ${iv.chapter.title}, ${iv.chapter.at} of ${iv.chapter.total} done` : "Every question asked"));
      tw.append(ring, txt);
    };
    fillCard(S.iv[b.slug]);
    tw.onclick = () => panes.twinPane();
    head.append(tw);
    loadIv(b.slug).then(r => { if (r && S.folder === b.slug){ fillCard(r.interview); if (ivDone(r.interview)) acts.querySelector("#fvIv")?.remove(); if (ivFull(r.interview)) acts.querySelector("#fvProfile")?.remove(); } });
  }
  const acts = el("div","fv-acts");
  const btn = (id, label, icon, fn, title) => {
    const x = el("button","fv-b"); x.type = "button"; x.id = id; x.innerHTML = icon || ""; x.append(label);
    if (title) x.title = title; x.onclick = fn; acts.append(x); return x;
  };
  btn("fvChat", "Chat in it", IC_CHAT, () => { S.folder = null; newChat(); $("input").focus(); });
  if (self && !S.demo){
    btn("fvMem", "Add memory", IC_DROP, () => openMemorySheet(b.slug), "Paste, or add a PDF, Word or text file about you. It is read like a drop.");
    if (!ivDone(S.iv[b.slug])) btn("fvIv", S.iv[b.slug]?.seen ? "Resume the interview" : "Interview me", IC_IV, () => { S.folder = null; newChat(); startInterview(b.slug); },
      "It asks you questions, one at a time, to know you better. Stop any time.");
    btn("fvTest", "Twin test", IC_TEST, () => panes.testPane(), "5 messages to reply to, built from your notes: your twin replies first, from your notes alone, then the two replies are compared, and yours go into your notes");
    /* At 100% the notes and the contacts hold all of it: the profile would only repeat them. */
    if (!ivFull(S.iv[b.slug])) btn("fvProfile", "Twin profile", IC_PROFILE, () => panes.profilePane(), "Your notes written as 7 parts: how you think, decide, speak and act");
  }
  if (!self && !ro) btn("fvDrop", "Drop into it", IC_DROP, () => { S.folder = null; setPicks([b.slug]); openDrop(); });
  if (!S.demo && !ro && !self) btn("fvEdit", "Edit", IC_EDIT, () => openBrainSheet(b), "Its name and the line that decides what goes in");
  const x = btn("fvClose", "×", "", () => { S.folder = null; render(); $("input").focus(); }, "Back to the chat");
  x.classList.add("fv-x"); x.setAttribute("aria-label","Back to the chat");
  head.append(acts);
  return { head };
}

/** A person's file in a personal folder: its tabs, its pages and the raw notes. */
function folderPeople({ live, show }){
  /**
   * A person's file under the summary: what is still open, the facts by
   * section with the ones that no longer hold, the people linked both ways,
   * and the history, year by year, newest first. A line that is wrong comes
   * out with its ×; a promise kept is ticked.
   */
  /** The tabs of a person and their empty pages. */
  const personTabs = (inner, c, raw, linkedFrom) => {
    const f = c.file || {};
    const tabs = el("div","pf-tabs"); tabs.setAttribute("role","tablist"); tabs.id = "pfTabs";
    const panes = {};
    const counts = { facts: (f.facts || []).filter(x => !x.until).length, history: f.n ?? (f.events || []).length,
      people: (f.links || []).length + linkedFrom.length, raw: raw?.total || 0 };
    const pick = k => {
      live.pfTab = k;
      for (const b of tabs.children){ const on = b.dataset.k === k; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
      for (const [kk, p] of Object.entries(panes)) p.hidden = kk !== k;
    };
    for (const [k, label] of [["overview","Overview"],["facts","Facts"],["history","History"],["people","Their people"],["raw","Raw notes"]]){
      const b = el("button","pf-tab"); b.type = "button"; b.dataset.k = k; b.id = "pfTab-" + k; b.setAttribute("role","tab");
      b.append(label); if (counts[k]) b.append(el("small",null,String(counts[k])));
      b.onclick = () => pick(k);
      tabs.append(b);
      const p = el("div","pf-pane"); p.dataset.k = k; p.id = "pfPane-" + k; p.setAttribute("role","tabpanel"); panes[k] = p;
    }
    inner.append(tabs, ...Object.values(panes));
    pick(panes[live.pfTab] ? live.pfTab : "overview");
    /* A count set once the page knows it: each person once, whichever way they link. */
    const count = (k, n) => { const b = tabs.querySelector(`[data-k="${k}"]`); b.querySelector("small")?.remove(); if (n) b.append(el("small",null,String(n))); };
    return { panes, pick, count };
  };

  /** Chips that pick a page: a year of history, a month of raw notes. "All" is the newest ones held. */
  const pageChips = (list, key, label, onPick) => {
    const box = el("div","pf-chips");
    const all = el("button","pf-chip on"); all.type = "button"; all.textContent = "Latest"; all.dataset.v = "";
    box.append(all);
    for (const x of list){ const b = el("button","pf-chip"); b.type = "button"; b.dataset.v = x[key]; b.append(label(x[key]), el("small",null,String(x.n))); box.append(b); }
    box.onclick = e => {
      const b = e.target.closest(".pf-chip"); if (!b) return;
      for (const x of box.children) x.classList.toggle("on", x === b);
      onPick(b.dataset.v);
    };
    return box;
  };

  const personFile = (pp, c, id, linkedFrom, pg) => {
    const { panes, pick } = pp;
    const f = c.file;
    if (!f){
      panes.overview.append(el("p","tw-key","This card has no full file yet. In Settings, Audit writes one from everything you said about them."));
      return;
    }
    const inner = panes.overview;
    const fix = (part, key, extra) => api("/api/personal/contact", { action: "part", id, part, key, ...(extra || {}) })
      .then(() => show(id)).catch(e => alert2(e.message));
    const alert2 = msg => inner.prepend(el("div","fv-li bad",msg));
    const cut = (part, key, what) => { const x = el("button","pf-x","×"); x.type = "button"; x.title = `Take out ${what}`; x.setAttribute("aria-label", `Take out ${what}`);
      x.onclick = () => fix(part, key); return x; };

    const open = (f.open || []).filter(x => !x.done);
    if (open.length){
      const box = el("section","pf-open"); box.append(el("h4",null,`Still open (${open.length})`));
      for (const x of open){
        const r = el("div","pf-orow");
        const tick = el("button","pf-tick"); tick.type = "button"; tick.title = "Done"; tick.setAttribute("aria-label", `Mark done: ${x.t}`);
        tick.onclick = () => fix("open", x.k, { done: true });
        r.append(tick, el("span",null,x.t), el("time",null,`since ${fileDay(x.at)}`));
        box.append(r);
      }
      inner.append(box);
    }

    /* The newest moments, on the overview; the whole history has its own page. */
    const late = (f.events || []).slice(0, 3);
    if (late.length){
      const box = el("section","pf-latest"); box.append(el("h4",null,"Latest"));
      for (const x of late){ const r = el("div","pf-late"); r.append(el("time",null, fileDay(x.d)), el("p",null,x.t)); box.append(r); }
      const more = el("button","mini","See the whole history"); more.type = "button"; more.onclick = () => pick("history");
      box.append(more); inner.append(box);
    }
    if (!inner.children.length) inner.append(el("div","fv-li","Nothing open, and no moment told yet."));

    for (const [key, name] of FILE_SECTIONS){
      const facts = (f.facts || []).filter(x => x.s === key);
      if (!facts.length) continue;
      const sec = el("section","pf-sec"); sec.append(el("h4",null,name));
      const now = facts.filter(x => !x.until), past = facts.filter(x => x.until);
      for (const x of now){
        const r = el("div","pf-fact");
        r.append(el("span","pf-l",x.l), el("span","pf-v", x.v + (x.since ? ` (since ${fileDay(x.since)})` : "")), cut("fact", x.k, x.l));
        const before = past.filter(y => y.l.toLowerCase() === x.l.toLowerCase());
        if (before.length) r.append(el("span","pf-was", "Before: " + before.map(y => `${y.v} (until ${fileDay(y.until)})`).join("; ")));
        sec.append(r);
      }
      for (const y of past.filter(y => !now.some(x => x.l.toLowerCase() === y.l.toLowerCase()))){
        const r = el("div","pf-fact gone");
        r.append(el("span","pf-l",y.l), el("span","pf-v",`${y.v} (until ${fileDay(y.until)})`), cut("fact", y.k, y.l));
        sec.append(r);
      }
      panes.facts.append(sec);
    }
    if (!panes.facts.children.length) panes.facts.append(el("div","fv-li","No fact yet. Their city, work, phone or birthday land here as you mention them."));

    const people = live.cs.filter(x => x.tag === "contact");
    const find = n => people.find(x => [x.title, ...(x.aliases || [])].some(t => String(t).toLowerCase() === String(n).toLowerCase()));
    if ((f.links || []).length || linkedFrom.length){
      const sec = el("section","pf-sec"); sec.append(el("h4",null,"Their people"));
      const row = el("div","fv-links");
      for (const x of f.links || []){
        const p = find(x.n);
        const chip = el("button","vw-link pf-link"); chip.type = "button";
        chip.append(x.n, x.r ? el("i",null,x.r) : "");
        if (p) chip.onclick = () => show(`${p.brain}/${p.slug}`); else chip.disabled = true;
        row.append(chip);
      }
      for (const x of linkedFrom.filter(x => !(f.links || []).some(l => find(l.n) && `${find(l.n).brain}/${find(l.n).slug}` === x.id))){
        const chip = el("button","vw-link pf-link"); chip.type = "button";
        chip.append(x.title, el("i",null, x.rel || "linked"));
        chip.onclick = () => show(x.id);
        row.append(chip);
      }
      sec.append(row); panes.people.append(sec);
      pp.count("people", row.children.length);
    }
    if (!panes.people.children.length) panes.people.append(el("div","fv-li","No one linked yet. Their partner, boss or friends land here as you mention them."));

    /* History, a year at a time: "Latest" is the newest moments held; an
       older year is fetched when its moments are not all here. */
    const evs = (f.events || []), total = f.n ?? evs.length;
    const hist = el("section","pf-hist"); hist.id = "pfHist";
    hist.append(el("h4",null, total ? `History (${total})` : "History"));
    if ((pg?.years || []).length > 1) hist.append(pageChips(pg.years, "y", y => y, async y => {
      if (!y) return draw(evs);
      const held = evs.filter(x => String(x.d).startsWith(y)), want = pg.years.find(x => x.y === y)?.n || 0;
      if (held.length >= want) return draw(held);
      list.innerHTML = ""; list.append(el("div","fv-li","Opening " + y));
      try { draw((await api("/api/personal/page", { id, year: y })).moments || []); } catch (e) { list.innerHTML = ""; list.append(el("div","fv-li bad", e.message)); }
    }));
    const list = el("div","pf-list");
    const draw = rows => {
      list.innerHTML = "";
      if (!rows.length) list.append(el("div","fv-li","Nothing told yet. Every moment you mention lands here, dated."));
      let year = "";
      for (const x of rows){
        const y = String(x.d).slice(0, 4);
        if (y !== year){ year = y; list.append(el("div","pf-year",y)); }
        const r = el("div","pf-ev" + (x.seen ? " seen" : ""));
        const when = el("time",null, fileDay(x.d, true)); if (x.seen) when.title = "You were together";
        r.append(when, el("p",null,x.t), cut("event", x.k, "this moment"));
        list.append(r);
      }
    };
    draw(evs);
    hist.append(list);
    panes.history.append(hist);
  };

  /**
   * Everything you said about a person, word for word and dated, newest
   * first, under their history: the raw material the file is written from,
   * in the language you said it.
   */
  const rawNotes = (inner, raw, id, pg) => {
    const rn = raw?.notes || [], KIND = { chat: "Chat", interview: "Interview", import: "Imported" };
    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const box = el("section","pf-raw"); box.id = "pfRaw";
    box.append(el("h4",null, raw?.total ? `Raw notes (${raw.total})` : "Raw notes"));
    const list = el("div","pf-list");
    const draw = rows => {
      list.innerHTML = "";
      if (!rows.length) list.append(el("div","fv-li","Every message where you talk about them lands here, as you typed it."));
      for (const x of rows){
        const r = el("div","pf-rn");
        const top = el("div","pf-rh"); top.append(el("time",null, fileDay(x.date)), el("span","pf-kind", KIND[x.kind] || x.kind));
        r.append(top);
        if (x.asked) r.append(el("p","pf-asked", x.asked));
        r.append(el("p","pf-rt", x.text));
        list.append(r);
      }
      if (rows === rn && raw?.total > rn.length) list.append(el("div","fv-li",`The newest ${rn.length} of ${raw.total}. Pick a month for the others.`));
    };
    /* A month at a time, fetched when its notes are not all here. */
    if ((pg?.months || []).length > 1) box.append(pageChips(pg.months, "m", m => `${M[Number(m.slice(5)) - 1] || ""} ${m.slice(0, 4)}`, async m => {
      if (!m) return draw(rn);
      const held = rn.filter(x => String(x.date).startsWith(m)), want = pg.months.find(x => x.m === m)?.n || 0;
      if (held.length >= want) return draw(held);
      list.innerHTML = ""; list.append(el("div","fv-li","Opening"));
      try { draw((await api("/api/personal/page", { id, month: m })).raw || []); } catch (e) { list.innerHTML = ""; list.append(el("div","fv-li bad", e.message)); }
    }));
    draw(rn);
    box.append(list);
    inner.append(box);
  };
  return { personTabs, personFile, rawNotes };
}

/** Editing a note or a person's card, merging two people, and reading the folder again after a change. */
function folderEdits({ live, doc, b, show, sorted, self, paintTabs, paint }){
  /** A person's card, by hand: name, other names, line and card. */
  const editCard = (c, id) => {
    live.openNow = id;
    doc.innerHTML = ""; doc.scrollTop = 0;
    const inner = el("div","fv-in ct-form"); inner.id = "ctForm"; doc.append(inner);
    const back = el("button","fv-back","← Back to the card"); back.type = "button"; back.onclick = () => show(id);
    inner.append(back, el("div","fv-eye",`Edit contact · ${b.name}`), el("h1",null,c.title));
    const field = (label, node) => { const l = el("label","ts-q"); l.append(el("span",null,label), node); inner.append(l); return node; };
    const name = field("Name", el("input")); name.id = "ctName"; name.value = c.title; name.maxLength = 80;
    const aka = field("Other names, with a comma between", el("input")); aka.id = "ctAka"; aka.value = (c.aliases || []).join(", ");
    const line = field("Who they are to you, in one line", el("input")); line.id = "ctLine"; line.value = c.summaryLine || ""; line.maxLength = 200;
    const card = field("The card", el("textarea")); card.id = "ctPos"; card.rows = 9; card.value = c.position || "";
    const say = el("span","ts-say"); say.setAttribute("role","status");
    const save = el("button","go","Save"); save.type = "button"; save.id = "ctSave";
    const no = el("button","ghost","Cancel"); no.type = "button"; no.onclick = () => show(id);
    save.onclick = async () => {
      save.disabled = true; say.textContent = "Saving"; say.className = "ts-say";
      try {
        await api("/api/personal/contact", { action: "edit", id, title: name.value.trim(), position: card.value,
          summaryLine: line.value.trim(), aliases: aka.value.split(",").map(x => x.trim()).filter(Boolean) });
        await reload(); show(id);
      } catch (e) { save.disabled = false; say.textContent = e.message; say.className = "ts-say bad"; }
    };
    const row = el("div","tw-acts"); row.append(save, no, say); inner.append(row);
    name.focus();
  };

  /** The other cards, to pick the one that is the same person. */
  const mergePick = (pick, c, id) => {
    pick.innerHTML = "";
    const others = live.cs.filter(x => x.tag === "contact" && `${x.brain}/${x.slug}` !== id);
    if (!others.length){ pick.append(el("p","tw-key","No other card to merge with yet.")); return; }
    pick.append(el("p","tw-key",`Pick the card that is the same person as ${c.title}. Its mentions and names join this card, and the card is written again as one.`));
    const q = el("input","fv-filter ct-find"); q.placeholder = "Find a person"; q.id = "ctFind";
    const list = el("div","ct-list");
    const paintList = () => {
      list.innerHTML = "";
      const t = q.value.trim().toLowerCase();
      for (const x of others.filter(x => !t || (x.title + " " + (x.aliases || []).join(" ") + " " + (x.summaryLine || "")).toLowerCase().includes(t)).slice(0, 30)){
        const r = el("div","ct-row");
        const who2 = el("div"); who2.append(el("b",null,x.title)); if (x.summaryLine) who2.append(el("span",null,x.summaryLine));
        const go2 = el("button","mini","Merge into this card"); go2.type = "button"; go2.dataset.id = `${x.brain}/${x.slug}`;
        let armed = false;
        go2.onclick = async () => {
          if (!armed){ armed = true; go2.textContent = `Yes, ${x.title} is ${c.title}`; go2.classList.add("armed"); return; }
          go2.disabled = true; go2.textContent = "Merging";
          try {
            const res = await api("/api/personal/contact", { action: "merge", into: id, from: [`${x.brain}/${x.slug}`] });
            await reload(); await show(id);
            if (!res.rewritten) doc.querySelector(".fv-in")?.append(el("p","tw-key","Merged. The two cards' text sits side by side until you edit it."));
          } catch (e) { go2.disabled = false; go2.textContent = e.message; }
        };
        r.append(who2, go2); list.append(r);
      }
      if (!list.children.length) list.append(el("p","tw-key","No card matches that."));
    };
    q.oninput = paintList;
    pick.append(q, list); paintList();
  };

  /* After a join, a rename or a position written, the list reads the
     workspace again, and the open pane stays where it is. */
  const reload = async () => {
    try { await refresh(); } catch (_) {}
    if (S.folder !== b.slug) return;
    live.cs = sorted(); if (self) paintTabs(); paint();
  };
  return { reload, editCard, mergePick };
}

/** The audit of one folder in its reading column: the tidy pass of a subject folder and the personal audit. */
function folderAudit({ live, paint, cols, doc, b, reload, isPerson }){
  /**
   * Tidy: what this folder holds twice, titles not in English, and concepts
   * with no position. It proposes; each finding waits for a click.
   */
  /* The audit of a subject or person folder: what is filed twice, titles not
     in English, empty positions. Each one waits for your call. */
  const tidy = async () => {
    live.openNow = null; paint();
    cols.classList.add("reading");
    doc.innerHTML = ""; doc.scrollTop = 0;
    const inner = el("div","fv-in tidy"); inner.id = "tidyPane"; doc.append(inner);
    const back = el("button","fv-back","← All concepts"); back.type = "button";
    back.onclick = () => { cols.classList.remove("reading"); paint(); };
    inner.append(back, el("div","fv-eye",`Audit · ${b.name}`), el("h1",null,"Audit this folder"));
    const n = el("p","fv-pos");
    n.textContent = `It reads ${live.cs.length} concepts for ideas filed twice, titles not in English and concepts with no position.`;
    inner.append(n);
    const load = auditLoader(inner, b);
    load.step(`Reading ${live.cs.length} concept${live.cs.length === 1 ? "" : "s"}`);
    let r;
    try { r = await api("/api/brain/tidy", { brain: b.slug }); if (r.error) throw new Error(r.error); }
    catch (e) { load.end(false); inner.append(el("div","fv-li bad",e.message), feedbackButton(e.message, { where: "audit", scope: b.slug })); return; }
    auditDone(b);
    const kept = S.brains.find(y => y.slug === b.slug);
    if (kept) kept.findings = { same: r.same, english: r.english, blank: r.blank.slice(0, 40) };
    const found = r.same.length + r.english.length + r.blank.length;
    load.end(true, found ? `${found} to decide` : "all clean");
    n.textContent = `${r.total} concepts read${r.read < r.total ? `, the newest ${r.read}` : ""}. ` +
      `${r.same.length} filed twice, ${r.english.length} not in English, ${r.blank.length} with no position.`;
    if (!found){
      inner.append(el("div","td-clean","All clean. Each concept holds one idea, in English, with a position."));
      return;
    }
    tidyCards(inner, r, reload);
  };

  /* The audit of the personal folder: the people in your notes filed, the
     ones with only a card given a full file, then the same person filed
     twice, each pair for you to merge or keep apart. */
  const personalAudit = async () => {
    live.openNow = null; paint();
    cols.classList.add("reading");
    doc.innerHTML = ""; doc.scrollTop = 0;
    const inner = el("div","fv-in tidy"); inner.id = "auditPane"; doc.append(inner);
    const back = el("button","fv-back","← All notes"); back.type = "button";
    back.onclick = () => { cols.classList.remove("reading"); paint(); };
    const say = el("p","fv-pos"); say.id = "auditSay";
    say.textContent = "It finds the people in your notes, gives each one a full file, then shows the cards that look like one person.";
    inner.append(back, el("div","fv-eye",`Audit · ${b.name}`), el("h1",null,"Audit your personal folder"), say);
    const load = auditLoader(inner, b);
    let at = 0, toBuild = 0; const found = new Set();
    try {
      load.step("Step 1 of 2 · Finding the people in your notes");
      for (let i = 0; i < 100; i++){
        const r = await api("/api/personal/people", { brain: b.slug, at });
        for (const x of r.filed?.people || []) found.add(x);
        if (r.total) load.step(`Step 1 of 2 · Finding the people in your notes: ${r.read} of ${r.total} read`, r.read, r.total);
        if (r.next == null) break;
        at = r.next;
      }
      /* Every person with only a card gets a full file, 5 at a time. */
      load.step("Step 2 of 2 · Building full files");
      for (let i = 0; i < 200; i++){
        const r = await api("/api/personal/people", { brain: b.slug, phase: "files" });
        for (const x of r.filed?.people || []) found.add(x);
        if (!toBuild && r.total) toBuild = r.total;
        if (toBuild) load.step(`Step 2 of 2 · Building full files: ${toBuild - (r.left || 0)} of ${toBuild} people`, toBuild - (r.left || 0), toBuild);
        if (r.next == null) break;
      }
    } catch (e) { load.end(false); say.textContent = e.message; inner.append(feedbackButton(e.message, { where: "audit", scope: b.slug })); return; }
    load.step("Reading the cards back");
    await reload();
    auditDone(b);
    const pairs = samePeople(conceptsOf(b.slug).filter(isPerson), S.brains.find(x => x.slug === b.slug)?.apart || []);
    load.end(true, pairs.length ? `${pairs.length} to decide` : "all clean");
    say.textContent = `${found.size} ${found.size === 1 ? "person" : "people"} filed or brought up to date. ${pairs.length} look${pairs.length === 1 ? "s" : ""} filed twice.`;
    if (!pairs.length){ inner.append(el("div","td-clean","All clean. Each person has one card.")); return; }
    inner.append(el("h4",null,`Filed twice · ${pairs.length}`), el("p","td-sub","The same person under two names. Merge keeps the name you pick and joins both files; Keep apart never asks again."));
    for (const g of pairs){
      const card = el("div","td-card"), name = `keep-${Math.random().toString(36).slice(2)}`;
      g.forEach((c, i) => {
        const row = el("label","td-opt");
        const rb = el("input"); rb.type = "radio"; rb.name = name; rb.value = `${c.brain}/${c.slug}`; rb.checked = i === 0;
        const t = el("div"); t.append(el("b",null,c.title), el("span",null,c.summaryLine || "No line yet."), el("small",null,`${c.ev || 0} mention${c.ev === 1 ? "" : "s"}`));
        row.append(rb, t); card.append(row);
      });
      const acts = el("div","td-acts");
      const go = el("button","td-go","Merge"); go.type = "button";
      const no = el("button","td-no","Keep apart"); no.type = "button";
      const msg = el("span","td-say");
      acts.append(go, no, msg); card.append(acts); inner.append(card);
      const ids = g.map(c => `${c.brain}/${c.slug}`);
      no.onclick = () => { card.classList.add("gone"); api("/api/brain/audit", { brain: b.slug, action: "apart", ids }).catch(() => {}); };
      go.onclick = async () => {
        const into = card.querySelector("input:checked")?.value || ids[0];
        go.disabled = no.disabled = true; msg.className = "td-say spin"; msg.textContent = "Merging";
        try {
          const r = await api("/api/personal/contact", { action: "merge", into, from: ids.filter(x => x !== into) });
          if (r.error) throw new Error(r.error);
          msg.className = "td-say ok"; msg.textContent = `Merged into ${g.find(c => `${c.brain}/${c.slug}` === into)?.title || into}.`;
          card.classList.add("done"); reload();
        } catch (e) { go.disabled = no.disabled = false; msg.className = "td-say bad"; msg.textContent = e.message; }
      };
    }
  };

  /* An audit you left, back where it is: still running, or ended. */
  const backToAudit = () => {
    live.openNow = null; paint();
    cols.classList.add("reading");
    doc.innerHTML = ""; doc.scrollTop = 0;
    const a = S.auditRun; doc.append(a.inner);
    const back = a.inner.querySelector(".fv-back");
    if (back) back.onclick = () => { cols.classList.remove("reading"); paint(); };
    if (a.state !== "running"){ a.seen = true; paintInbox(); }
  };
  return { backToAudit, personalAudit, tidy };
}

/** A personal folder's twin, its test and its profile, each shown in the reading column of the folder screen. */
function folderTwinPanes({ live, paint, cols, doc, b, reload }){
  /* ---- a personal folder: the twin, its test and its profile ---- */
  const pane = (id, eye, title) => {
    live.openNow = null; paint();
    cols.classList.add("reading");
    doc.innerHTML = ""; doc.scrollTop = 0;
    const inner = el("div","fv-in tw"); inner.id = id; doc.append(inner);
    const back = el("button","fv-back","← All notes"); back.type = "button";
    back.onclick = () => { cols.classList.remove("reading"); paint(); };
    inner.append(back, el("div","fv-eye",`${eye} · ${b.name}`), el("h1",null,title));
    return inner;
  };
  const waitIn = inner => { const w = el("div","td-wait"); w.append(el("i"), el("i"), el("i")); inner.append(w); return w; };

  /** How well it knows you: the share covered, each chapter, the test and the profile. */
  const twinPane = async () => {
    const inner = pane("twinPane", "Your twin", "How well it knows you");
    const w = waitIn(inner);
    const r = await loadIv(b.slug);
    w.remove();
    if (!doc.contains(inner)) return;
    if (!r?.interview){ inner.append(el("div","fv-li bad","The interview could not be read. Try again.")); return; }
    const iv = r.interview;
    inner.append(el("p","fv-pos",`${iv.pct}% complete: ${iv.covered} of ${iv.total} questions answered, or already known from your notes. ` +
      `It asks one at a time, and every answer is filed as notes here.`));
    /* The test and the profile sit in the folder's own actions, above. */
    const row = el("div","tw-acts");
    if (ivDone(iv)) row.append(el("span","ts-say","Interview complete: every question is answered or known from your notes."));
    else {
      const goB = el("button","go", iv.seen ? "Resume the interview" : "Start the interview"); goB.type = "button"; goB.id = "twGo";
      goB.onclick = () => { S.folder = null; newChat(); startInterview(b.slug); };
      row.append(goB, el("span","ts-say", iv.on ? "It is on: your next message answers it." : "About 15 questions a sitting. Stop any time."));
    }
    inner.append(row);
    const t = iv.test;
    inner.append(el("div","tw-score", !t.last ? "Twin score: take the twin test to measure it."
      : `Last twin test ${t.last.pct}% · average of the last ${Math.min(3, t.count)}: ${t.recent}% · ${t.count} test${t.count === 1 ? "" : "s"} taken`));
    inner.append(el("h4",null,"Chapters"));
    const list3 = el("div","tw-chs");
    for (const c of iv.chapters){
      const done = c.answered + c.known;
      const li = el("div","tw-ch" + (iv.chapter?.key === c.key ? " now" : ""));
      li.append(el("b",null,c.title));
      const bar = el("span","tw-bar");
      const a = el("i","a"); a.style.width = `${100 * c.answered / c.total}%`;
      const k = el("i","k"); k.style.width = `${100 * c.known / c.total}%`;
      bar.append(a, k);
      li.append(bar, el("small",null,`${done} / ${c.total}`));
      li.title = `${c.answered} answered, ${c.known} known from your notes, ${c.skipped} skipped`;
      list3.append(li);
    }
    inner.append(list3);
    inner.append(el("p","tw-key","Dark: answered in the interview. Light: already in your notes. Skipped questions come back when you start over."));
    const reset = el("button","mini","Start over"); reset.type = "button"; reset.id = "twReset";
    let armed = false;
    reset.onclick = async () => {
      if (!armed){ armed = true; reset.textContent = "Click again: every question comes back, your notes stay"; return; }
      try { await api("/api/interview", { action: "restart", brain: b.slug }); await loadIv(b.slug); twinPane(); }
      catch (e) { reset.textContent = e.message; }
    };
    inner.append(reset);
  };

  /** The twin test: your answers, never filed, the twin's from your notes, and a score for each. */
  const testPane = async (just) => {
    const inner = pane("testPane", "Twin test", "Could your twin reply for you?");
    inner.append(el("p","fv-pos","5 new situations each time, built from your own notes: a message lands and you reply. Your notes imply each reply and never state it. " +
      "Write the reply you would send. Your twin replies first, from your notes alone. Then the two are compared on the decision and the voice, and yours are added to your notes, so it learns to answer as you."));
    const now = el("div","tt-now"), histBox = el("div","tt-hist");
    inner.append(now, histBox);
    const say = el("div","ts-say"); say.setAttribute("role","status");
    const tell = (text, cls = "") => { say.textContent = text; say.className = "ts-say " + cls; };
    const call = async (action, extra = {}) => {
      const r = await api("/api/interview", { action, brain: b.slug, ...extra });
      if (r.error) throw new Error(r.error);
      if (r.interview) S.iv[b.slug] = r.interview;
      return r;
    };
    const w = waitIn(now);
    let r;
    try { r = await call(just ? "state" : "test"); } catch (e) { w.remove(); now.append(el("div","fv-li bad",e.message)); return; }
    w.remove();
    if (!doc.contains(inner)) return;
    const t = r.test, MATCH = ["Different", "Close", "Same"];

    /* A question with both answers, and how the comparison read it. */
    const pairCard = it => {
      const card = el("div","ts-card");
      card.append(el("div","ts-qt",it.q));
      const pair = el("div","ts-pair");
      const one = el("div"); one.append(el("small",null,"You"), el("p",null,it.mine));
      const two = el("div"); two.append(el("small",null,"Your twin"), el("p",null,it.twin || "No answer"));
      if (it.because) two.append(el("p","ts-why","Because: " + it.because));
      pair.append(one, two); card.append(pair);
      if (it.score !== null && it.score !== undefined){ const m = el("span","ts-m m" + it.score, MATCH[it.score]); m.dataset.n = String(it.score); card.append(m); }
      return card;
    };
    const total = e => el("div","tw-score", `Your twin matched you ${e.pct}% on ${e.items.length} question${e.items.length === 1 ? "" : "s"}`);
    /* What it did not deduce, and where that goes: your answers become notes, so the next test starts from more. */
    const missed = e => { const n = e.items.filter(i => typeof i.score === "number" && i.score < 2).length;
      return n ? el("p","tw-key",`${n} of ${e.items.length} missed or half right. Each reply you gave is now a note, so your twin can answer the same next time.`) : null; };

    /* The three steps after your answers: the twin answers, the two are compared, yours go into your notes. */
    const STEPS = { check: "Your twin is answering from your notes", score: "Comparing the answers", learn: "Adding your answers to your notes" };
    const run = async (from, answers, retry) => {
      let at = from, filed = null, last = r;
      retry.disabled = true;
      try {
        for (const a of from === "check" ? ["check", "score", "learn"] : from === "score" ? ["score", "learn"] : ["learn"]){
          at = a; tell(STEPS[a], "spin");
          last = await call(a, a === "check" ? { answers } : {});
          if (a === "learn") filed = last.filed;
        }
        reload();
        testPane({ entry: last.test.history[0], filed });
      } catch (e) { retry.disabled = false; retry.onclick = () => run(at, answers, retry); retry.hidden = false; tell(e.message, "bad"); }
    };
    const retryBtn = () => { const x = el("button","go","Try again"); x.type = "button"; x.id = "tsRetry"; x.hidden = true; return x; };

    const round = t.round, last = t.history[0];
    /* Your twin has answered this round, and the two are not compared yet. */
    const checked = !!round && Object.keys(round.mine || {}).length > 0 && Object.keys(round.twin || {}).length > 0;
    if (just){
      now.append(total(just.entry));
      for (const it of just.entry.items) now.append(pairCard(it));
      const ms = missed(just.entry); if (ms) now.append(ms);
      const fl = just.filed && (just.filed.new || just.filed.updated || (just.filed.people || []).length);
      now.append(el("p","tw-key", fl ? `Your answers are in your notes. ${filedLine(just.filed)}.` : "Your answers are in your notes."));
      const more = el("button","go","Take another test"); more.type = "button"; more.id = "tsMore"; more.onclick = () => testPane();
      now.append(more);
    } else if (checked){
      now.append(el("p","tw-key","Your twin has answered. The answers are not compared yet."));
      const rb = retryBtn(); rb.hidden = false; rb.textContent = "Compare the answers"; rb.onclick = () => run("score", null, rb);
      const row = el("div","tw-acts"); row.append(rb, say); now.append(row);
    } else if (last && last.learned === false){
      now.append(total(last));
      for (const it of last.items) now.append(pairCard(it));
      now.append(el("p","tw-key","Your answers are not in your notes yet."));
      const rb = retryBtn(); rb.hidden = false; rb.textContent = "Add them to my notes"; rb.onclick = () => run("learn", null, rb);
      const row = el("div","tw-acts"); row.append(rb, say); now.append(row);
    } else if (round){
      const f = el("div","ts-form"), boxes = {};
      /* A round the notes could not make comes from the interview's bank, and says why. */
      if (round.note) now.append(el("p","tw-key", round.note === "thin"
        ? "Your notes hold few ideas yet, so these come from the interview. With 6 notes or more, each test is built from what you said."
        : "The questions built from your notes did not come back, so these come from the interview. Other questions tries again."));
      for (const q of round.questions){
        const lab = el("label","ts-q"); lab.append(el("span",null,q.text));
        /* A message is shown as the message it is, and asks for the reply you would send. */
        if (q.reply) lab.classList.add("msg");
        const ta = el("textarea"); ta.rows = q.reply ? 3 : 2; ta.dataset.id = q.id; ta.placeholder = q.reply ? "Your reply, as you would send it" : "Your answer, in your own words";
        lab.append(ta); f.append(lab); boxes[q.id] = ta;
      }
      now.append(f);
      const go2 = el("button","go","Check my twin"); go2.type = "button"; go2.id = "tsSave";
      const other = el("button","mini","Other questions"); other.type = "button"; other.id = "tsOther";
      other.onclick = async () => {
        other.disabled = go2.disabled = true; tell("Picking 5 others");
        try { await call("test", { fresh: true }); testPane(); } catch (e) { other.disabled = go2.disabled = false; tell(e.message, "bad"); }
      };
      const rb = retryBtn();
      go2.onclick = () => {
        const answers = {}; for (const id in boxes) if (boxes[id].value.trim()) answers[id] = boxes[id].value.trim();
        if (Object.keys(answers).length < 3){ tell("Answer at least 3 of the 5.", "bad"); return; }
        go2.disabled = other.disabled = true;
        run("check", answers, rb);
      };
      const row = el("div","tw-acts"); row.append(go2, other, rb, say); now.append(row);
    }

    /* Every test so far, newest first: the score, and each pair when opened. */
    /* The test shown above is not listed again below. */
    const past = t.history.slice(just || (!checked && last && last.learned === false) ? 1 : 0);
    const scored = t.history.filter(e => typeof e.pct === "number");
    if (scored.length){
      histBox.append(el("h4",null,`History · ${scored.length} test${scored.length === 1 ? "" : "s"}`));
      histBox.append(el("p","tt-trend", scored.slice(0, 8).reverse().map(e => `${e.pct}%`).join(" → ")));
    }
    for (const e of past){
      if (typeof e.pct !== "number") continue;
      const d = el("details","tt-h");
      const sum = el("summary"); sum.append(el("span",null,fileDay(e.at)), el("b",null,`${e.pct}%`), el("small",null,`${e.items.length} question${e.items.length === 1 ? "" : "s"}`));
      d.append(sum);
      for (const it of e.items) d.append(pairCard(it));
      histBox.append(d);
    }
  };

  /** Your notes written as 7 parts. */
  const profilePane = async () => {
    const inner = pane("profilePane", "Twin profile", "Your twin profile");
    inner.append(el("p","fv-pos","Your notes written as 7 parts: identity, values, beliefs, decision rules, voice, knowledge and boundaries. It stays in this folder."));
    const w = waitIn(inner);
    const r = await loadIv(b.slug);
    w.remove();
    if (!doc.contains(inner)) return;
    const pf = r?.profile;
    const say = el("span","ts-say"); say.setAttribute("role","status");
    const write = el("button", pf ? "ghost" : "go", pf ? "Write it again" : "Write it"); write.type = "button"; write.id = "pfGo";
    write.onclick = async () => {
      write.disabled = true; say.textContent = "Writing it from your notes"; say.className = "ts-say";
      try { await api("/api/interview", { action: "profile", brain: b.slug }); profilePane(); }
      catch (e) { write.disabled = false; say.textContent = e.message; say.className = "ts-say bad"; }
    };
    const row = el("div","tw-acts"); row.append(write, say); inner.append(row);
    if (!pf) return;
    inner.append(el("p","tw-key",`Written on ${pf.at} from ${pf.notes || "your"} notes.`));
    for (const part of pf.parts || []){
      const sec = el("section","pf-part");
      sec.append(el("h4",null,part.title));
      const ul = el("ul"); for (const x of part.points) ul.append(el("li",null,x));
      sec.append(ul); inner.append(sec);
    }
  };
  return { twinPane, testPane, profilePane };
}

/**
 * One folder's tidy findings, as cards that each wait for their own click:
 * concepts filed twice, titles not in English, concepts with no position.
 * Returns what Apply all runs: each merge into the title ticked, each rename
 * as written, and the positions, every one skipped once done.
 */
function tidyCards(inner, r, onChange, tally = {}){
  const runs = [];
  const add = (k, n = 1) => { tally[k] = (tally[k] || 0) + n; };
  /* Concepts folded into another by a merge here: a rename or a position
     asked for one of them has nothing left to change. */
  const gone = new Set();
  const sec = (title, sub) => { inner.append(el("h4",null,title)); if (sub) inner.append(el("p","td-sub",sub)); };

  if (r.same.length){
    sec(`Filed twice · ${r.same.length}`, "The same idea under two titles. Merge keeps the title you pick, joins the evidence, and writes the position again.");
    for (const g of r.same){
      const card = el("div","td-card");
      const name = `keep-${Math.random().toString(36).slice(2)}`;
      g.forEach((c, i) => {
        const row = el("label","td-opt");
        const rb = el("input"); rb.type = "radio"; rb.name = name; rb.value = c.id; rb.checked = i === 0;
        const t = el("div"); t.append(el("b",null,c.title), el("span",null,c.line || "No position yet."), el("small",null,`${c.ev} evidence`));
        row.append(rb, t); card.append(row);
      });
      const acts = el("div","td-acts");
      const go = el("button","td-go","Merge"); go.type = "button";
      const no = el("button","td-no","Keep apart"); no.type = "button";
      const say = el("span","td-say");
      acts.append(go, no, say); card.append(acts);
      /* Kept apart for good: the next audit never proposes them again. */
      no.onclick = () => {
        card.classList.add("gone"); api("/api/brain/audit", { brain: r.brain, action: "apart", ids: g.map(c => c.id) }).catch(() => {});
        const kept = S.brains.find(y => y.slug === r.brain);
        if (kept) kept.apart = [...new Set([...(kept.apart || []), ...pairsOf(g.map(c => c.id))])];
        paintInbox();
      };
      const merge = async () => {
        if (card.classList.contains("done") || card.classList.contains("gone")) return true;
        const keep = card.querySelector("input:checked")?.value || g[0].id;
        go.disabled = no.disabled = true; say.className = "td-say spin"; say.textContent = "Merging";
        try {
          const from = g.map(c => c.id).filter(id => id !== keep);
          const m = await api("/api/concept/merge", { into: keep, from });
          from.forEach(id => gone.add(id)); add("merged");
          say.className = "td-say ok";
          say.textContent = `Merged into ${g.find(c => c.id === keep)?.title || keep}${m.rewritten ? ", position written again" : ""}.`;
          card.classList.add("done");
          return true;
        } catch (e) { go.disabled = no.disabled = false; say.className = "td-say bad"; say.textContent = e.message; return false; }
      };
      go.onclick = async () => { if (await merge()) onChange(); };
      runs.push(merge);
      inner.append(card);
    }
  }

  if (r.english.length){
    sec(`Not in English · ${r.english.length}`, "The title changes; the concept, its evidence and its links stay.");
    const card = el("div","td-card");
    const rows2 = r.english.map(c => {
      const row = el("div","td-ren");
      const old = el("s",null,c.title);
      const inp = el("input","td-in"); inp.value = c.to; inp.setAttribute("aria-label",`New title for ${c.title}`);
      const go = el("button","td-go","Rename"); go.type = "button";
      const say = el("span","td-say");
      row.append(old, inp, go, say); card.append(row);
      const run = async () => {
        const title = inp.value.trim();
        if (title.length < 3 || row.classList.contains("done")) return true;
        if (gone.has(c.id)){ row.classList.add("done"); say.className = "td-say ok"; say.textContent = "Merged into another"; return true; }
        go.disabled = true; say.className = "td-say spin"; say.textContent = "";
        try { await api("/api/concept/rename", { id: c.id, title }); row.classList.add("done"); say.className = "td-say ok"; say.textContent = "Renamed"; add("renamed"); return true; }
        catch (e) { go.disabled = false; say.className = "td-say bad"; say.textContent = e.message; return false; }
      };
      go.onclick = async () => { if (await run()) onChange(); };
      return run;
    });
    if (rows2.length > 1){
      const all = el("button","td-go td-all",`Rename all ${rows2.length}`); all.type = "button";
      all.onclick = async () => { all.disabled = true; for (const run of rows2) await run(); onChange(); };
      card.append(all);
    }
    runs.push(...rows2);
    inner.append(card);
  }

  if (r.blank.length){
    sec(`No position · ${r.blank.length}`, "Each holds evidence but no view. The position is written from the evidence it already has.");
    const card = el("div","td-card");
    for (const c of r.blank) card.append(el("div","td-li",c.title));
    const go = el("button","td-go",`Write ${r.blank.length} position${r.blank.length === 1 ? "" : "s"}`); go.type = "button";
    const say = el("span","td-say");
    const acts = el("div","td-acts"); acts.append(go, say); card.append(acts);
    const write = async () => {
      if (card.classList.contains("done")) return true;
      go.disabled = true;
      const ids = r.blank.map(c => c.id).filter(id => !gone.has(id));
      let done = 0;
      for (let i = 0; i < ids.length; i += 8){
        say.className = "td-say spin"; say.textContent = `${done} of ${ids.length}`;
        try { done += ((await api("/api/concept/rederive", { ids: ids.slice(i, i + 8) })).written || []).length; }
        catch (e) { say.className = "td-say bad"; say.textContent = e.message; go.disabled = false; return false; }
      }
      say.className = "td-say ok"; say.textContent = `${done} of ${ids.length} written.`;
      card.classList.add("done"); add("written", done);
      return true;
    };
    go.onclick = async () => { if (await write()) onChange(); };
    runs.push(write);
    inner.append(card);
  }
  return runs;
}

/** The Drop screen with the cursor in its box, for a source pasted by hand. */
function pasteHere(){
  if (S.mode !== "drop") openDrop();
  $("input").focus();
}

/* ============ the graph: kinds of link and what follows ============ */

/* What a link says, read from the concept holding it to the one it names. */
const LINK_LABEL = { needs: "needs", causes: "causes", supports: "supports", contradicts: "contradicts", example: "example of" };
const kindTo = (c, id) => ((c && c.kinds) || []).find(k => k.to === id)?.type || "related";
const cardById = id => { const [b, ...r] = String(id).split("/"); return S.concepts.find(x => x.brain === b && x.slug === r.join("/")); };
/* What a concept must be read after, and what reading it opens. */
const needsOf = c => ((c && c.kinds) || []).filter(k => k.type === "needs").map(k => k.to).filter(cardById);
const unlocksOf = id => S.concepts.filter(x => (x.kinds || []).some(k => k.type === "needs" && k.to === id));

/** A link as a chip: its kind in small capitals, then the concept, then its folder when another. */
function linkChip(c, r, onOpen, nameOf){
  const rb = r.split("/")[0], card = cardById(r);
  const chip = el("button","vw-link"); chip.type = "button";
  const kind = kindTo(c, r);
  if (kind !== "related"){ const t = el("i","lk-" + kind, LINK_LABEL[kind] || kind); chip.append(t); }
  chip.append((card ? card.title : r.split("/").slice(1).join("/")) + (rb !== c.brain ? ` · ${nameOf(rb)}` : ""));
  chip.onclick = () => onOpen(r);
  return chip;
}

/** What follows from this concept and one of another folder: derived, and said so. */
function insightsBlock(list, id, onOpen, nameOf){
  const box = el("div","ins-list");
  for (const x of list){
    const other = x.a === id ? x.b : x.a, card = cardById(other);
    const it = el("div","ins");
    it.append(el("b",null,x.title), el("p",null,x.text));
    const w = el("button","vw-link"); w.type = "button";
    w.append(el("i","lk-with","with"), (card ? card.title : other) + ` · ${nameOf(other.split("/")[0])}`);
    w.onclick = () => onOpen(other);
    it.append(w);
    box.append(it);
  }
  box.append(el("div","ins-note","Drawn by Tasu from two linked concepts. It is a conclusion, not a source."));
  return box;
}

