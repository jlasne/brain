/* 09-pager.js: One-pagers: built, shown, copied and mailed. */

/* ============ one page ============ */

/* The last address a page was sent to. A convenience, per browser, so a blocked
   store just means typing it again. */
const MAIL_KEY = "octopus.mailto";
const lastMail = () => { try { return localStorage.getItem(MAIL_KEY) || ""; } catch { return ""; } };

/**
 * What the page is built from.
 *
 * The brain in the sidebar when one is picked, a group, everything, or a
 * question. The first three assemble from stored positions and cost nothing.
 */
/**
 * Every folder the page can be built from, as chips: by category when the
 * folders have some, then by type. Several can be picked; none is everything.
 * The assets follow, four at most, read whole for the page.
 */
function pickChips(){
  const n = shared().length;
  let out = `<button type="button" class="pm-chip pm-all" data-v="all" aria-pressed="false">Everything <i>${n}</i></button>`;
  const chip = b => `<button type="button" class="pm-chip" data-v="${esc(b.slug)}" aria-pressed="false">${esc(b.name)}</button>`;
  const cats = inGroups(shared());
  for (const g of cats.groups)
    out += `<div class="pm-g"><button type="button" class="pm-head" data-cat="${esc(g.name)}">${esc(g.name)} <i>${g.rows.length}</i></button>${g.rows.map(chip).join("")}</div>`;
  for (const [k, head] of [["person", "People"], ["subject", "Subjects"]]){
    const rows = cats.rest.filter(b => (b.type === "person" ? "person" : "subject") === k);
    if (rows.length) out += `<div class="pm-g"><button type="button" class="pm-head" data-g="${k}">${cats.groups.length ? (k === "person" ? "Other people" : "Other subjects") : head} <i>${rows.length}</i></button>${rows.map(chip).join("")}</div>`;
  }
  const ready = S.demo || !S.assetsOn ? [] : (S.assets || []).filter(a => a.status === "ready");
  if (ready.length)
    out += `<div class="pm-g pm-assets"><span class="pm-head pm-ah">Assets <i>up to 4</i></span>` +
      ready.map(a => `<button type="button" class="pm-chip pm-asset" data-a="${a.id}" aria-pressed="false" title="${esc(assetMeta(a))}"><span class="pk-ic">${pjIcon(a.kind)}</span>${esc(a.name)}</button>`).join("") + `</div>`;
  return out;
}

function openPagerSheet(pre = {}){
  closeSide();
  /* A one-pager is built from shared brains: a personal one is read by its own chat only. */
  const here = S.brains.find(b => b.slug === S.scope && b.type !== "personal");
  const veil = el("div","veil pager-veil");
  veil.innerHTML = `
    <div class="sheet pager-sheet" role="dialog" aria-modal="true">
      <header><h3>One-pager</h3>
      <p>Pick what it reads and the format. It lands in the chat, ready to copy or send.</p></header>
      <div class="f pg-sec"><label id="pPickL">Built from</label>
        <div class="pk-multi" id="pPick" role="group" aria-labelledby="pPickL">${pickChips()}</div>
        <div class="hint" id="pPickHint"></div></div>
      <div class="f pg-sec"><label id="pKindL">Format</label><div class="seg pg-seg" id="pKind" role="group" aria-labelledby="pKindL">
        <button type="button" data-k="summary">Summary</button><button type="button" data-k="custom" data-d="quiz">Quiz</button><button type="button" data-k="custom" data-d="deepdive">Deep dive</button><button type="button" data-k="custom" data-d="usecase">Use cases</button><button type="button" data-k="custom" data-d="other">Other</button></div>
        <div class="hint" id="pKindHint"></div></div>
      <div class="f pg-sec"><label for="pQ">Question or subject <span class="pg-opt">optional</span></label>
        <textarea id="pQ" rows="2"></textarea>
        </div>
      <div class="f pg-sec" id="pNoteF" hidden><label for="pNote" id="pNoteL">Special instructions</label>
        <textarea id="pNote" rows="2"></textarea></div>
      <div class="f pg-sec pg-two">
        <div><label for="pLang">Language</label>
          <select id="pLang" class="pick">${["English","French","Spanish","German","Italian","Portuguese","Dutch","Japanese","Chinese"]
            .map(l => `<option value="${l}">${l}</option>`).join("")}</select></div>
        <div ${ownerWs() ? "" : "hidden"}><label for="pTo">Send it to <span class="pg-opt">optional</span></label>
          <input id="pTo" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com"></div>
      </div>
      <div id="pSlot"></div>
      <footer><span class="pg-sum" id="pSum"></span><button class="ghost" id="pCancel">Cancel</button><button class="go" id="pGo">Build it</button></footer>
    </div>`;
  document.body.append(veil);

  /* The folders ticked: one, several, a whole category or type, or none for
     everything. A page asked again arrives with its own list, or a type by its name. */
  const kindOf = b => b.type === "person" ? "person" : "subject";
  const picked = new Set(), assets = new Set();
  for (const x of String(pre.pick || (here ? here.slug : "all")).split(",")){
    if (x === "person" || x === "subject") shared().filter(b => kindOf(b) === x).forEach(b => picked.add(b.slug));
    else if (shared().some(b => b.slug === x)) picked.add(x);
  }
  for (const id of pre.assets || S.assetPicks || []) if (veil.querySelector(`.pm-asset[data-a="${id}"]`)) assets.add(Number(id));
  /* With assets ticked and no folder, the page reads the assets alone; Everything adds every folder back. */
  let every = !picked.size && !assets.size, chose = false;
  /* Summary lays out the positions in bullets, free, or answers the question
     in 9 bullets. Every other format writes a document in its own shape, with one model call. */
  let kind = "summary", doc = "quiz";
  const HINT = {
    summary:  "Bullets: each concept, then what it adds. Free from the stored positions. A question or an asset makes it one model call.",
    quiz:     "8 questions from the basics to the hardest. The answers stay folded until you open them.",
    deepdive: "500 to 800 words: the short answer, how it works, the evidence, where sources disagree, what it means.",
    usecase:  "3 to 5 real situations: what to do step by step, the expected result, the risk.",
    other:    "Your description sets the type, the format, the length and the tone.",
  };
  const NOTE = { other: ["Describe the document", "A checklist for a client meeting. A 5 step action plan. A glossary of the terms."] };
  const NOTE_ANY = ["Special instructions", "Optional: the angle, the audience or the tone. Only the risks. For a new client."];
  const paintKind = () => {
    const at = kind === "summary" ? "summary" : doc;
    for (const x of veil.querySelector("#pKind").children) x.classList.toggle("on", (x.dataset.d || x.dataset.k) === at);
    const custom = kind === "custom";
    veil.querySelector("#pKindHint").textContent = HINT[at];
    veil.querySelector("#pNoteF").hidden = !custom;
    const [lbl, ph] = NOTE[doc] || NOTE_ANY;
    veil.querySelector("#pNoteL").textContent = lbl;
    veil.querySelector("#pNote").placeholder = ph;
    veil.querySelector("#pQ").placeholder = custom ? "Keeps the document to one subject. How do I price an offer?" : "Leave it empty to lay out the positions as they stand.";
    sumLater();
  };
  /* The Build bar says what will be built, in one line, as the choices change.
     A beat later, so every field it reads exists by then. */
  const DOC_NAME = { quiz: "Quiz", deepdive: "Deep dive", usecase: "Use cases", other: "Custom document" };
  const fromName = () => {
    const names = [...picked].map(x => S.brains.find(b => b.slug === x)?.name || x);
    const folders = every ? "Everything" : !names.length ? "" : names.length > 2 ? `${names.length} folders` : names.join(" and ");
    const n = assets.size, an = n === 1 ? (S.assets.find(a => a.id === [...assets][0])?.name || "1 asset") : `${n} assets`;
    return [folders, n ? an : ""].filter(Boolean).join(" + ");
  };
  const sumLater = () => queueMicrotask(() => {
    const sum = veil.querySelector("#pSum"); if (!sum) return;
    const q = veil.querySelector("#pQ").value.trim();
    sum.textContent = [fromName(), kind === "custom" ? DOC_NAME[doc] : "Summary", veil.querySelector("#pLang").value, q ? "on a question" : ""].filter(Boolean).join(" · ");
  });
  paintKind();
  veil.querySelector("#pKind").onclick = e => {
    const x = e.target.closest("button[data-k]"); if (!x) return;
    kind = x.dataset.k; if (x.dataset.d) doc = x.dataset.d;
    paintKind();
    if (doc === "other" && kind === "custom") veil.querySelector("#pNote").focus();
  };
  const picker = veil.querySelector("#pPick");
  const paintPick = () => {
    for (const c of picker.querySelectorAll(".pm-chip")){
      const on = c.dataset.a ? assets.has(Number(c.dataset.a)) : c.dataset.v === "all" ? every : picked.has(c.dataset.v);
      c.setAttribute("aria-pressed", String(on)); c.classList.toggle("on", on);
      /* Four assets at most: the rest wait until one is unticked. */
      if (c.dataset.a) c.disabled = !on && assets.size >= 4;
    }
    for (const h of picker.querySelectorAll(".pm-head[data-cat], .pm-head[data-g]")){
      const rows = rowsOf(h);
      h.classList.toggle("on", rows.length && rows.every(x => picked.has(x)));
    }
    const names = [...picked].map(x => S.brains.find(b => b.slug === x)?.name || x);
    const n = assets.size;
    veil.querySelector("#pPickHint").textContent = every ? (n ? `Every folder, and ${n} asset${n === 1 ? "" : "s"} read whole.` : "Every folder. Tick one, a category or an asset to narrow it.")
      : !names.length ? `${n === 1 ? "This asset" : `These ${n} assets`} alone. Tick Everything or a folder to add the folders.`
      : (names.length > 3 ? `${names.length} folders` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : `${names[0]} only`)
        + (n ? `, and ${n} asset${n === 1 ? "" : "s"}.` : ".");
    sumLater();
  };
  const rowsOf = h => h.dataset.cat ? groupSlugs(h.dataset.cat).filter(x => shared().some(b => b.slug === x))
    : inGroups(shared()).rest.filter(b => kindOf(b) === h.dataset.g).map(b => b.slug);
  picker.onclick = e => {
    const head = e.target.closest(".pm-head[data-cat], .pm-head[data-g]"), chip = e.target.closest(".pm-chip");
    if (head){
      /* A category's name ticks all of it, or clears it when all are ticked. */
      const rows = rowsOf(head);
      const all = rows.every(x => picked.has(x));
      rows.forEach(x => all ? picked.delete(x) : picked.add(x));
    } else if (chip?.dataset.a){
      const id = Number(chip.dataset.a);
      if (assets.has(id)) assets.delete(id); else if (assets.size < 4) assets.add(id);
    } else if (chip){
      const v = chip.dataset.v;
      if (v === "all"){ picked.clear(); chose = true; }
      else { chose = false; if (picked.has(v)) picked.delete(v); else picked.add(v); }
    } else return;
    if (head) chose = false;
    /* A folder ticked narrows to it. Nothing ticked is everything. Assets alone are read alone, unless Everything was ticked with them. */
    every = picked.size ? false : !assets.size ? true : chose;
    if (!assets.size && !picked.size) chose = false;
    paintPick();
  };
  paintPick();
  const pickVal = () => every ? "all" : picked.size ? [...picked].join(",") : "none";
  const shut = () => veil.remove();
  veil.querySelector("#pCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  if (pre.q) veil.querySelector("#pQ").value = pre.q;
  /* The language last picked, English the first time. */
  const langI = veil.querySelector("#pLang");
  langI.onchange = sumLater;
  veil.querySelector("#pQ").addEventListener("input", sumLater);
  try { const l = localStorage.getItem("octopus.pagerLang"); if (l && [...langI.options].some(o => o.value === l)) langI.value = l; } catch {}
  setTimeout(() => veil.querySelector("#pQ").focus(), 30);

  /* The button says what it will do: build, or build and send. */
  const toI = veil.querySelector("#pTo"), goB = veil.querySelector("#pGo");
  toI.value = lastMail();
  const label = () => { goB.textContent = toI.value.trim() ? "Build and send" : "Build it"; };
  label(); toI.oninput = label;

  const warn = msg => {
    const slot = veil.querySelector("#pSlot"); slot.innerHTML = "";
    const c = el("div","closest");
    c.append(el("b",null,"Check this first"), el("div",null,msg));
    slot.append(c);
  };

  goB.onclick = async () => {
    const q = veil.querySelector("#pQ").value.trim();
    const note = kind === "custom" ? veil.querySelector("#pNote").value.trim() : "";
    const to = toI.value.trim();
    const lang = langI.value;
    try { localStorage.setItem("octopus.pagerLang", lang); } catch {}
    if (kind === "custom" && doc === "other" && !note){ warn("Describe the document you want."); veil.querySelector("#pNote").focus(); return; }
    /* A typo stays in the dialog, where it can be fixed, rather than failing
       after the page is built. */
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)){ warn(`"${to}" is not an address.`); toI.focus(); return; }
    shut();

    /* A page the model writes waits on it, so the mascot keeps it company. */
    const viaModel = !!q || kind !== "summary" || lang !== "English" || assets.size > 0;
    const body = thinking(to ? `${viaModel ? "Writing" : "Building"} the page, then sending it to ${to}`
                             : viaModel ? undefined : "Building the page");
    let r;
    const ask = { pick: pickVal(), q, kind, ...(kind === "custom" ? { doc } : {}), ...(note ? { note } : {}), ...(lang !== "English" ? { lang } : {}), ...(assets.size ? { assets: [...assets] } : {}) };
    try { r = await api("/api/onepager", { ...ask, ...(to ? { mail: to } : {}) }); }
    catch (e) {
      body.innerHTML = rich("**The page did not build.** " + esc(e.message));
      bottom(); return;
    }
    body.closest(".msg").remove();
    if (r.sent) { try { localStorage.setItem(MAIL_KEY, to); } catch {} }
    showPager(r.page, r.text, ask,
      r.sent ? { to, ok: true } : to ? { to, ok: false, why: r.mailError || "the mail service refused it" } : null, r);
  };
}

/**
 * Why a page is not in the language asked for, or "".
 *
 * The server says so itself when a translation failed. A server that does not
 * know the language menu yet says nothing and answers in English, so the page
 * is checked against the ask as well.
 */
function langNote(r, lang){
  if (r.warning) return r.warning;
  if (!lang || lang === "English" || r.lang === lang) return "";
  return `This page is in English, not ${lang}: the server does not know the language menu yet. Run npx convex deploy, then build it again.`;
}

/**
 * The page, on screen, with the three things you do with it.
 *
 * Mailing rebuilds the page on the server rather than sending a body from here,
 * so a signed-in session cannot post arbitrary mail from this address. The
 * reply carries the page that went out and the card repaints to it, so what is
 * on screen is always what was sent. A page built from a question is asked
 * again to do that, and the button says so.
 */
function showPager(page, text, built, mailed, r, where = $("thread")){
  push("ai", body => {
    const card = el("div","pager");
    const slot = el("div");
    const acts = el("div","acts");
    const said = el("div","said");
    const lang = el("div","err");
    card.append(lang, slot, acts, said);
    body.append(card);

    /* The language, above the page: read before the page is. */
    const flagLang = x => {
      const why = x ? langNote(x, built.lang) : "";
      lang.hidden = !why; lang.innerHTML = "";
      if (why) lang.append(el("b",null,"Not in " + built.lang), el("span",null,why));
    };
    flagLang(r);
    /* A mail that went, in a line. One that did not, in full, with the reason. */
    const tell = (ok, msg) => {
      said.innerHTML = "";
      said.className = ok || !msg ? "said" : "said err";
      if (ok) said.textContent = msg;
      else if (msg) said.append(el("b",null,"Not sent"), el("span",null,msg));
    };

    let now = { page, text };
    const paint = () => {
      slot.innerHTML = "";
      const p = now.page;
      slot.append(el("h3",null,p.title));
      if (p.line) slot.append(el("div","sub",p.line));
      for (const sec of p.sections || []){
        /* A summary's bullets, or a document's paragraphs and lists. */
        const ul = (sec.blocks || []).length ? docBody(sec.blocks) : el("ul");
        for (const b of (sec.blocks || []).length ? [] : sec.bullets || []){
          const li = el("li");
          if (typeof b === "string") li.textContent = b;
          else {
            if (b.k) li.append(el("strong","k",b.k));
            if (b.say) li.append(el("span","say",b.say));
          }
          ul.append(li);
        }
        /* A quiz keeps its answers folded, so the questions are worked
           through first. Copy, print and mail carry them in full. */
        if (sec.fold || /^answers?$/i.test(sec.head || "")){
          const d = el("details","answers");
          d.append(el("summary",null,"Show the answers"), ul);
          slot.append(d);
          continue;
        }
        if (sec.head) slot.append(el("h4",null,sec.head));
        slot.append(ul);
      }
      if (p.foot) slot.append(el("div","foot",p.foot));
    };
    paint();

    const copy = el("button","fresh","Copy");
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(now.text); copy.textContent = "Copied"; }
      catch { copy.textContent = "Blocked"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 1600);
    };

    const print = el("button","fresh","Print");
    print.onclick = () => printPager(now.page);

    const to = el("input");
    to.type = "email"; to.placeholder = "Send it to"; to.value = lastMail();
    const send = el("button","fresh","Mail it");
    send.title = built.q || built.lang || (built.kind && built.kind !== "summary")
      ? "The page is written again so the page that is sent is the page you see. One model call."
      : "Built again from the stored positions, which gives the same page.";

    const post = async () => {
      const addr = to.value.trim();
      if (!addr){ to.focus(); return; }
      send.disabled = true; send.textContent = "Sending"; tell(true, "");
      try {
        /* The page is kept already: this build is only for the mail. */
        const r = await api("/api/onepager", { ...built, mail: addr, keep: false });
        now = { page: r.page, text: r.text };
        paint(); flagLang(r); bottom(where);
        if (r.sent === false) throw new Error(r.mailError || "the mail service refused it");
        try { localStorage.setItem(MAIL_KEY, addr); } catch {}
        tell(true, `Sent to ${addr}. Not in the inbox within 5 minutes? Look in spam.`);
        send.textContent = "Sent";
      } catch (e) {
        send.disabled = false; send.textContent = "Mail it";
        tell(false, e.message);
      }
    };
    send.onclick = post;
    to.onkeydown = e => { if (e.key === "Enter") post(); };
    /* A new address means a new send. */
    to.oninput = () => { send.disabled = false; send.textContent = "Mail it"; tell(true, ""); };

    /* Sent from the dialog already: the card says so rather than asking again. */
    if (mailed){
      to.value = mailed.to;
      if (mailed.ok){ send.disabled = true; send.textContent = "Sent"; tell(true, `Sent to ${mailed.to}. Not in the inbox within 5 minutes? Look in spam.`); }
      else tell(false, mailed.why);
    }

    /* Mail goes from the owner's domain, so other workspaces copy or print. */
    acts.append(copy, print, ...(ownerWs() ? [to, send] : []));
  }, where);
  bottom(where);
}

/** **bold** in a document's text, with everything else escaped. */
const boldText = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
/** A document section's paragraphs and lists, as one element. */
function docBody(blocks){
  const box = el("div","doc");
  for (const x of blocks){
    if (x.p != null){ const p = el("p"); p.innerHTML = boldText(x.p); box.append(p); continue; }
    const list = el(x.ol ? "ol" : "ul");
    for (const t of x.ol || x.ul || []){ const li = el("li"); li.innerHTML = boldText(t); list.append(li); }
    box.append(list);
  }
  return box;
}
const docHtml = blocks => blocks.map(x => x.p != null ? `<p>${boldText(x.p)}</p>`
  : `<${x.ol ? "ol" : "ul"}>${(x.ol || x.ul || []).map(t => `<li>${boldText(t)}</li>`).join("")}</${x.ol ? "ol" : "ul"}>`).join("");

/** The page on its own, in a window that prints it and nothing else. */
function printPager(page){
  const w = window.open("", "_blank", "width=820,height=980");
  if (!w){ push("ai", b => { b.innerHTML = rich("The print window was blocked. Allow pop-ups for this site, or copy the page instead."); }); return; }
  const li = (page.sections || []).map(sec =>
    (sec.head ? `<h2>${esc(sec.head)}</h2>` : "") +
    ((sec.blocks || []).length ? docHtml(sec.blocks) :
    "<ul>" + (sec.bullets || []).map(b => typeof b === "string" ? `<li>${esc(b)}</li>`
      : `<li>${b.k ? `<strong>${esc(b.k)}</strong>` : ""}${b.k && b.say ? "<br>" : ""}${esc(b.say || "")}</li>`).join("") + "</ul>")).join("");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(page.title)}</title>
<style>
  @page{ margin:18mm; }
  body{ font:400 12pt/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif; color:#141413; max-width:170mm; margin:0 auto; padding:14mm 10mm; }
  h1{ font-size:21pt; line-height:1.15; margin:0; letter-spacing:-.01em; }
  .sub{ margin:5pt 0 0; color:#6e6e68; font-size:11pt; }
  h2{ margin:14pt 0 4pt; font-size:9.5pt; letter-spacing:.07em; text-transform:uppercase; color:#93918a; }
  ul, ol{ margin:8pt 0 0; padding-left:14pt; }
  p{ margin:0 0 8pt; }
  li{ margin-bottom:7pt; }
  li strong{ font-weight:600; }
  .foot{ margin-top:16pt; padding-top:7pt; border-top:1px solid #e5e2d9; color:#93918a; font-size:9.5pt; }
</style>
<h1>${esc(page.title)}</h1>${page.line ? `<p class="sub">${esc(page.line)}</p>` : ""}${li}
<p class="foot">${esc(page.foot || "")}</p>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

