/* 20-groups.js: Categories: the folders sorted under a few names, a category ticked or tagged at once, and the sheet that sets them. */

/* ============ categories ============
   A folder sits in one category, or in none: Wealth, Business, Life. The side
   panel and the chat bar picker show each category with its folders under it,
   and one click on a category ticks all of them. "@All Wealth" in a message
   asks them all too. A personal folder stays apart, in no category. */

/** A folder's category, "" for none. */
function groupOf(b){ return b && b.type !== "personal" ? String(b.group || "").trim() : ""; }

/** The categories of some folders, the fullest first, each with its folders the fullest first; then the folders in none. */
function inGroups(list){
  const size = b => conceptsOf(b.slug).length;
  const bySize = (x, y) => size(y) - size(x) || x.name.localeCompare(y.name);
  const m = new Map();
  for (const b of list){ const g = groupOf(b); if (g){ if (!m.has(g)) m.set(g, []); m.get(g).push(b); } }
  const groups = [...m].map(([name, rows]) => ({ name, rows: rows.sort(bySize), size: rows.reduce((n, b) => n + size(b), 0) }))
    .sort((x, y) => y.size - x.size || x.name.localeCompare(y.name));
  return { groups, rest: list.filter(b => !groupOf(b)).sort(bySize) };
}

/** Every category in use, A to Z. */
function groupNames(){ return [...new Set(S.brains.map(groupOf).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

/** The folders of one category. */
function groupSlugs(name){ return S.brains.filter(b => groupOf(b) === name).map(b => b.slug); }

const GROUP_ICON = `<svg class="b-ic" viewBox="0 0 24 24" role="img" aria-label="Category"><title>Category</title><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>`;

/** Ticks all the folders of a category, or unticks them all once all are ticked. */
function tickGroup(slugs){
  const on = slugs.length && slugs.every(x => S.picks.includes(x));
  setPicks(on ? S.picks.filter(x => !slugs.includes(x)) : [...S.picks, ...slugs]);
}

/** A category in the side panel, its folders under it: what they hold, and one click asks them all. */
function groupRow(g){
  const slugs = g.rows.map(b => b.slug);
  const on = slugs.every(x => S.picks.includes(x)), some = !on && slugs.some(x => S.picks.includes(x));
  const row = el("div","brain-row group-row" + (on ? " on" : "") + (some ? " some" : ""));
  row.setAttribute("role","button"); row.tabIndex = 0; row.setAttribute("aria-pressed", String(on));
  row.dataset.group = g.name;
  row.onkeydown = e => { if (e.target === row && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); row.click(); } };
  const tick = el("span","tick"); tick.innerHTML = GROUP_ICON;
  const box = el("span","tbox"); box.innerHTML = TICK_SVG; tick.append(box);
  row.append(tick, el("span","nm", g.name), el("span","cnt", String(g.size)));
  row.title = `${g.rows.map(b => b.name).join(", ")}\nClick to ask all ${g.rows.length} folders.`;
  row.onclick = () => {
    if (S.concept) newChat();
    crossing("all");
    tickGroup(slugs);
    S.folder = null;
    render();
  };
  return row;
}

/**
 * The categories sheet: each folder of this workspace with its category, a
 * name typed or picked from the ones in use. Suggest asks the model for a
 * category per folder; nothing is saved until Save.
 */
function openGroupsSheet(){
  closeSide();
  const mine = S.brains.filter(b => b.type !== "personal" && (b.space || S.space) === S.space && !readOnly(b))
    .sort((x, y) => conceptsOf(y.slug).length - conceptsOf(x.slug).length || x.name.localeCompare(y.name));
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="gTitle">
      <header><h3 id="gTitle">Categories</h3>
      <p>Each folder sits under one category in the side panel and the picker. One click on a category asks all its folders. Leave it empty for none.</p></header>
      <div class="f"><div class="g-list" id="gList"></div><datalist id="gNames"></datalist></div>
      <div class="f"><button class="ghost" id="gSuggest" type="button">Suggest categories</button><div id="gMsg" class="hint" role="status"></div></div>
      <footer><button class="ghost" id="gCancel" type="button">Cancel</button><button class="go" id="gSave" type="button">Save</button></footer>
    </div>`;
  document.body.append(veil);
  const list = veil.querySelector("#gList"), names = veil.querySelector("#gNames"), msg = veil.querySelector("#gMsg"),
        save = veil.querySelector("#gSave"), sug = veil.querySelector("#gSuggest");
  const inputs = new Map();
  const paintNames = () => {
    const all = [...new Set([...groupNames(), ...[...inputs.values()].map(i => i.value.trim()).filter(Boolean)])].sort();
    names.innerHTML = all.map(n => `<option value="${esc(n)}"></option>`).join("");
  };
  for (const b of mine){
    const r = el("label","g-row");
    const i = el("input"); i.setAttribute("list","gNames"); i.maxLength = 40; i.placeholder = "No category"; i.value = groupOf(b);
    i.dataset.slug = b.slug; i.setAttribute("aria-label", `Category of ${b.name}`);
    i.onchange = paintNames;
    const nm = el("span","g-nm"); nm.append(brainIcon(b), el("span",null,b.name));
    r.append(nm, i);
    list.append(r); inputs.set(b.slug, i);
  }
  if (!mine.length) list.append(el("div","hint","No folder of this workspace to sort yet."));
  paintNames();
  const shut = () => veil.remove();
  veil.querySelector("#gCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  sug.hidden = S.demo || !mine.length;
  sug.onclick = async () => {
    sug.disabled = true; msg.className = "spin"; msg.textContent = "Reading the folders";
    try {
      const r = await api("/api/brain/groups", { action: "suggest" });
      let n = 0;
      for (const [slug, g] of Object.entries(r.suggest || {})){ const i = inputs.get(slug); if (i && !i.value.trim()){ i.value = g; n++; } }
      paintNames();
      msg.className = "hint"; msg.textContent = n ? `${n} folder${n === 1 ? "" : "s"} filled in. Change any, then Save.` : "Every folder already has a category.";
    } catch (e) { msg.className = "bad"; msg.textContent = e.message; }
    sug.disabled = false;
  };
  save.onclick = async () => {
    const set = mine.map(b => ({ slug: b.slug, group: inputs.get(b.slug).value.replace(/\s+/g, " ").trim() })).filter(x => x.group !== groupOf(S.brains.find(b => b.slug === x.slug)));
    if (!set.length){ shut(); return; }
    save.disabled = true; msg.className = "spin"; msg.textContent = "Saving";
    try { await api("/api/brain/groups", { set }); }
    catch (e) { save.disabled = false; msg.className = "bad"; msg.textContent = e.message; return; }
    shut();
    await refresh();
    render();
  };
  setTimeout(() => list.querySelector("input")?.focus(), 30);
}
