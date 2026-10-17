/* 20-groups.js: Categories: the folders and the assets sorted under a few names, a category ticked or tagged at once, and the sheet that sets them. */

/* ============ categories ============
   A folder sits in one category, or in none: Wealth, Business, Life. The side
   panel and the chat bar picker show each category with its folders under it,
   and one click on a category ticks all of them. "@All Wealth" in a message
   asks them all too. A personal folder stays apart, in no category. The
   assets take the same names: "@All Wealth" reads the Wealth assets too, four
   at most. */

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

/** Every category in use, by the folders or the assets, A to Z. */
function groupNames(){ return [...new Set([...S.brains.map(groupOf), ...(S.assets || []).map(assetGroupOf)].filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

/** The folders of one category. */
function groupSlugs(name){ return S.brains.filter(b => groupOf(b) === name).map(b => b.slug); }

/** An asset's category, "" for none. */
function assetGroupOf(a){ return String(a?.group || "").trim(); }
/** The categories of some assets, A to Z, each with its assets the newest first; then the assets in none. */
function assetsInGroups(list){
  const m = new Map();
  for (const a of list){ const g = assetGroupOf(a); if (g){ if (!m.has(g)) m.set(g, []); m.get(g).push(a); } }
  return { groups: [...m].map(([name, rows]) => ({ name, rows })).sort((x, y) => x.name.localeCompare(y.name)), rest: list.filter(a => !assetGroupOf(a)) };
}
/** The ready assets of one category. */
function groupAssets(name){ return (S.assets || []).filter(a => a.status === "ready" && assetGroupOf(a) === name).map(a => a.id); }

const GROUP_ICON = `<svg class="b-ic" viewBox="0 0 24 24" role="img" aria-label="Category"><title>Category</title><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>`;

/** Ticks all the folders and assets of a category, four assets at most, or unticks them all once all are ticked. */
function tickGroup(slugs, ids = []){
  const on = groupOn(slugs, ids);
  setPicks(on ? S.picks.filter(x => !slugs.includes(x)) : [...S.picks, ...slugs]);
  S.assetPicks = on ? S.assetPicks.filter(x => !ids.includes(x)) : [...new Set([...ids.slice(0, 4), ...S.assetPicks])].slice(0, 4);
}
/** A category is ticked when its folders are, and its first four assets. */
function groupOn(slugs, ids = []){
  return (slugs.length || ids.length) > 0 && slugs.every(x => S.picks.includes(x)) && ids.slice(0, 4).every(x => S.assetPicks.includes(x));
}

/** A category in the side panel, its folders and assets under it: what they hold, and one click asks them all. */
function groupRow(g){
  const slugs = g.rows.map(b => b.slug), ids = (g.files || []).filter(a => a.status === "ready").map(a => a.id);
  const on = groupOn(slugs, ids), some = !on && (slugs.some(x => S.picks.includes(x)) || ids.some(x => S.assetPicks.includes(x)));
  const row = el("div","brain-row group-row" + (on ? " on" : "") + (some ? " some" : ""));
  row.setAttribute("role","button"); row.tabIndex = 0; row.setAttribute("aria-pressed", String(on));
  row.dataset.group = g.name;
  row.onkeydown = e => { if (e.target === row && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); row.click(); } };
  const tick = el("span","tick"); tick.innerHTML = GROUP_ICON;
  const box = el("span","tbox"); box.innerHTML = TICK_SVG; tick.append(box);
  const n = (g.files || []).length;
  row.append(tick, el("span","nm", g.name), el("span","cnt", g.rows.length ? String(g.size) : `${n} asset${n === 1 ? "" : "s"}`));
  row.title = `${[...g.rows.map(b => b.name), ...(g.files || []).map(a => a.name)].join(", ")}\nClick to ask ${g.rows.length ? `all ${g.rows.length} folders` : "them"}${ids.length ? `${g.rows.length ? " and " : " "}${Math.min(4, ids.length)} asset${ids.length === 1 ? "" : "s"}` : ""}.`;
  row.onclick = () => {
    if (S.concept) newChat();
    if (isPersonal(S.scope)){ const me = S.scope; tickGroup(slugs, ids); S.scope = me; }
    else { crossing("all"); tickGroup(slugs, ids); }
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
  const files = S.demo || !S.assetsOn ? [] : (S.assets || []);
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="gTitle">
      <header><h3 id="gTitle">Categories</h3>
      <p>Each folder and each asset sits under one category in the side panel and the picker. One click on a category asks all its folders. Leave it empty for none.</p></header>
      <div class="f"><div class="g-list" id="gList"></div><datalist id="gNames"></datalist></div>
      <div class="f"><button class="ghost" id="gSuggest" type="button">Suggest categories</button><div id="gMsg" class="hint" role="status"></div></div>
      <footer><button class="ghost" id="gCancel" type="button">Cancel</button><button class="go" id="gSave" type="button">Save</button></footer>
    </div>`;
  document.body.append(veil);
  const list = veil.querySelector("#gList"), names = veil.querySelector("#gNames"), msg = veil.querySelector("#gMsg"),
        save = veil.querySelector("#gSave"), sug = veil.querySelector("#gSuggest");
  const inputs = new Map(), fileIn = new Map();
  const paintNames = () => {
    const all = [...new Set([...groupNames(), ...[...inputs.values(), ...fileIn.values()].map(i => i.value.trim()).filter(Boolean)])].sort();
    names.innerHTML = all.map(n => `<option value="${esc(n)}"></option>`).join("");
  };
  if (files.length) list.append(el("div","g-h","Folders"));
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
  if (files.length){
    list.append(el("div","g-h","Assets"));
    for (const a of files){
      const r = el("label","g-row");
      const i = el("input"); i.setAttribute("list","gNames"); i.maxLength = 40; i.placeholder = "No category"; i.value = assetGroupOf(a);
      i.dataset.fid = String(a.id); i.setAttribute("aria-label", `Category of ${a.name}`);
      i.onchange = paintNames;
      const nm = el("span","g-nm"), ic = el("span","g-ic"); ic.innerHTML = pjIcon(a.kind); nm.append(ic, el("span",null,a.name));
      r.append(nm, i);
      list.append(r); fileIn.set(a.id, i);
    }
  }
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
    const clean = i => i.value.replace(/\s+/g, " ").trim();
    const set = mine.map(b => ({ slug: b.slug, group: clean(inputs.get(b.slug)) })).filter(x => x.group !== groupOf(S.brains.find(b => b.slug === x.slug)));
    const fset = files.map(a => ({ file: a.id, group: clean(fileIn.get(a.id)) })).filter(x => x.group !== assetGroupOf(files.find(a => a.id === x.file)));
    if (!set.length && !fset.length){ shut(); return; }
    save.disabled = true; msg.className = "spin"; msg.textContent = "Saving";
    try {
      if (set.length) await api("/api/brain/groups", { set });
      if (fset.length) await api("/api/assets/groups", { set: fset });
    }
    catch (e) { save.disabled = false; msg.className = "bad"; msg.textContent = e.message; return; }
    shut();
    await refresh();
    render();
  };
  setTimeout(() => list.querySelector("input")?.focus(), 30);
}
