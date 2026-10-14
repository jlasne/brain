/* 02-gate.js: The passphrase gate, the boot, and painting the screen. */

/* ============ the gate ============ */
const MARK = document.querySelector(".brand .mark").innerHTML;

const SPACE_KEY = "octopus.space";
const KNOWN_NAMES = { octopus: "Octopus", squidgy: "Squidgy", demo: "Demo" };
const titleCase = slug => slug.split("-").filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
const cap = t => String(t || "").charAt(0).toUpperCase() + String(t || "").slice(1);

/**
 * The workspace this address asks for: /chat?w=octopus. An empty w asks for
 * one by name. With no w at all the tab keeps what it holds, so null.
 */
/** The workspace an installed app opened last: the app opens on it, behind its passphrase. A browser tab goes by its address. */
function appSpace(){
  if (!INSTALLED) return null;
  try { const s = localStorage.getItem("octopus.app.space") || ""; return /^[a-z0-9][a-z0-9-]{1,31}$/.test(s) ? s : null; } catch { return null; }
}
function askedSpace(){
  let q;
  try { q = new URLSearchParams(location.search); } catch { return null; }
  if (!q.has("w")) return null;
  const w = (q.get("w") || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(w) ? w : "";
}

/** A call made before there is a session: the passphrase, or the demo. */
async function openCall(path, body = {}){
  let r;
  try {
    r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("The server did not answer. Check your connection."); }
  const d = await r.json().catch(() => ({ error: "the server sent something unreadable" }));
  if (d.error) throw new Error(cap(d.error));
  return d;
}

/**
 * The passphrase, on top of the workspace.
 *
 * The page paints the workspace the address names, in its own colours and
 * mark, blurred, with one card over it: the passphrase, or the name and the
 * passphrase for a workspace made on the landing. The demo needs neither and
 * opens straight away.
 */
function gateScreen(w, st = {}){
  if (w) { S.space = w; S.spaceName = KNOWN_NAMES[w] || titleCase(w); paintSpace(); renderZero(); }
  if (w === "demo") { demoDoor(st); return; }
  $("app").classList.add("locked");
  /* Only the owner's two doors report whether they have a passphrase yet. */
  const shut = !!w && st.gates && st.gates[w] === false;
  const veil = el("div", "veil gate-veil");
  veil.innerHTML = `
    <form class="sheet wsgate" id="wsGate" role="dialog" aria-modal="true" aria-labelledby="gateH" novalidate>
      <header>
        <img class="gmk" id="gateMark" src="${esc(markOf())}" alt="">
        <h3 id="gateH">${w ? esc(S.spaceName) : "Open your workspace"}</h3>
        <p>${w ? "Enter the passphrase to open this workspace." : "The name and the passphrase you chose when you made it."}</p>
      </header>
      <div class="f">
        ${w ? `<input type="text" name="username" autocomplete="username" value="${esc(w)}" hidden>`
            : `<label for="gName">Workspace name</label><input id="gName" autocomplete="username" maxlength="60" spellcheck="false"><div style="height:14px"></div>`}
        <label for="gPass">Passphrase</label>
        <input id="gPass" type="password" autocomplete="current-password" spellcheck="false">
        <p class="hint gmsg" id="gMsg" role="alert">${shut ? "Shut until its owner sets a passphrase." : ""}</p>
      </div>
      <footer><a class="ghost" href="/">All workspaces</a><button class="go" id="gGo" type="submit">Enter</button></footer>
    </form>`;
  document.body.append(veil);
  if (w) openCall("/api/brand/public", { space: w }).then(r => {
    if (r.name) { S.spaceName = r.name; veil.querySelector("#gateH").textContent = r.name; }
    applyLook(r.brand || null);
  }).catch(() => {});
  const pass = veil.querySelector("#gPass"), name = veil.querySelector("#gName");
  const msg = veil.querySelector("#gMsg"), go = veil.querySelector("#gGo");
  setTimeout(() => (name || pass).focus(), 60);
  veil.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (name && name.value.trim().length < 2) { msg.textContent = "Type the workspace's name."; name.focus(); return; }
    if (pass.value.length < 8) { msg.textContent = "A passphrase runs 8 characters or more."; pass.focus(); return; }
    go.disabled = true; msg.textContent = "Checking";
    let d;
    try { d = await openCall("/api/unlock", name ? { name: name.value.trim(), pass: pass.value } : { space: w, pass: pass.value }); }
    catch (e) { go.disabled = false; pass.value = ""; pass.focus(); msg.textContent = e.message; return; }
    sessionStorage.setItem(TOKEN_KEY, d.token);
    S.token = d.token;
    veil.remove(); $("app").classList.remove("locked");
    try { await open(); } catch (e) { deadScreen(e.message); }
  });
}

/** The demo, from its own address: a fresh visitor session, no passphrase. */
async function demoDoor(st){
  try {
    if (st.demo === false) throw new Error("The demo opens soon.");
    const d = await openCall("/api/demo");
    sessionStorage.setItem(TOKEN_KEY, d.token);
    S.token = d.token;
    await open();
  } catch (e) { deadScreen(e.message); }
}

/** Same modal shape when the deployment itself is unreachable. */
function deadScreen(why) {
  $("app").classList.add("locked");
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header>
        <div class="mk" aria-hidden="true">${MARK}</div>
        <h3>The server is not answering</h3>
        <p>Octopus reaches a Convex deployment for every read and every model call. This one stayed quiet.</p>
      </header>
      <div class="f"><div class="closest" style="margin:0"><b>What came back</b><div>${esc(why)}</div></div></div>
      <footer><button class="go" id="again">Try again</button></footer>
    </div>`;
  document.body.append(veil);
  veil.querySelector("#again").onclick = () => location.reload();
}

/* ============ boot ============ */
(async () => {
  render(); sizeBox();                       // the shell paints straight away
  const w = askedSpace() ?? appSpace(), held = sessionStorage.getItem(SPACE_KEY) || "";
  if (S.space) { S.spaceName = KNOWN_NAMES[S.space] || titleCase(S.space); paintSpace(); }
  let saved = sessionStorage.getItem(TOKEN_KEY);
  /* An address that names another workspace than the one this tab holds
     opens that one, behind its own passphrase. */
  if (saved && w !== null && w !== held) {
    sessionStorage.removeItem(TOKEN_KEY); saved = null;
  }
  if (saved) {
    S.token = saved;
    try { await open(); return; }
    catch (_) {
      sessionStorage.removeItem(TOKEN_KEY);
      S.token = null;
    }
  }
  /* A reachability probe first, so an unreachable deployment says so rather
     than asking for a passphrase it cannot check. */
  let st;
  try { st = await api("/api/status"); }
  catch (e) { deadScreen(e.message); return; }
  gateScreen(w ?? (S.space || ""), st);
})();

async function open(){ await refresh(); sizeBox(); $("input").focus(); }

async function refresh(){
  const d = await api("/api/state");
  S.brains = d.brains || []; S.concepts = d.concepts || []; S.sources = d.sources || [];
  S.model = d.model || ""; S.chunk = d.chunk || 18000;
  S.projects = d.projects || [];
  S.assets = d.assets || [];
  /* The model in use, and its default. */
  S.models = d.models || { chat: S.model, chatDefault: S.model };
  if (d.space){ S.space = d.space; S.spaceName = d.spaceName || d.space; paintSpace(); }
  S.demo = !!d.demo; S.byok = !!d.byok;
  applyLook(d.brand || null);
  paintWorkspace();
  render();
  /* The rings and the chats follow, so the brains never wait on them. */
  loadHealth(); loadChats(); autoAudit(); loadStill();
}

/** Each brain's health, then the rings repaint. */
async function loadHealth(){
  try {
    const d = await api("/api/health");
    S.health = Object.fromEntries((d.health || []).map(h => [h.slug, h]));
    S.conflicted = new Set(d.conflicted || []);
  } catch { return; }
  renderSide(); paintInbox();
  loadClashes();
}
/** The open clashes, each with its suggested ruling, for the inbox's decisions. */
async function loadClashes(){
  if (S.demo) return;
  if (!openClashes()){ S.clashes = []; paintInbox(); return; }
  try { const r = await api("/api/conflicts", { hints: true }); if (Array.isArray(r.conflicts)) { S.clashes = r.conflicts; S.clashOthers = r.others || 0; } } catch { return; }
  paintInbox(); paintDecide();
}
async function loadChats(){
  try { S.chats = (await api("/api/chats")).chats || []; } catch { return; }
  renderChats();
}

/* ============ render ============ */
const conceptsOf = b => S.concepts.filter(c => c.brain === b).sort((x,y)=>(x.n||0)-(y.n||0));
const sourcesOf  = b => S.sources.filter(s => (s.brains||[]).includes(b));

function render(){ renderSide(); renderAssets(); renderProjects(); renderScope(); renderComposer(); renderZero(); renderView(); }

/**
 * One screen at a time in the main area: the chat, a folder open, or Drop.
 * Each keeps what it showed, so going back finds it as it was.
 */
function renderView(){
  if (S.folder && !S.brains.some(b => b.slug === S.folder)) S.folder = null;
  if (S.project && !S.projects.some(p => p.slug === S.project)){ S.project = null; if (!S.pj?.asset) S.pj = null; }
  if (S.asset && !(S.assets || []).some(a => a.id === S.asset)){ S.asset = null; if (S.pj?.asset) S.pj = null; }
  /* A project and an asset open in the same place. */
  const drop = S.mode === "drop", folder = !drop && !!S.folder, project = !drop && !folder && (!!S.project || !!S.asset);
  $("dropHead").hidden = !drop; $("dropThread").hidden = !drop;
  $("folderView").hidden = !folder;
  $("projectView").hidden = !project;
  $("thread").hidden = drop || folder || project;
  $("dropBtn").classList.toggle("on", drop);
  document.querySelector("main").dataset.view = drop ? "drop" : folder ? "folder" : project ? "project" : "chat";
  /* A mic stays in the bar it was tapped in: when that screen goes, it stops. */
  if (rec && (project ? rec.bar === mainBar : rec.bar !== mainBar)) endVoice();
  markSeen();
}
/** Drop, on the folders ticked. A personal folder takes no drop. */
function openDrop(){
  if (isPersonal(S.scope)){ crossing("all"); setPicks([]); }
  S.folder = null;
  S.mode = "drop";
  render(); $("srcInput").focus();
}

/**
 * Which space this is, said once and shown everywhere.
 *
 * The attribute on <html> carries the tint, so one line retints every button and
 * rule in the app. The name and the mark follow it. A mark with no file yet
 * leaves the Octopus one in place rather than a gap.
 */
