/* 07-setup.js: New folder, Settings, add memory, and the sheets they open. */

/* ============ create a brain ============ */

/**
 * Setup: the address that lets another AI client read and feed these brains,
 * and what the transcript service has cost. The deployment's key pays for
 * every model call, so there is no key to set here.
 */
/** Where to tap to install Tasu, for a browser that gives no prompt of its own. */
function installSteps(){
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "On iPhone and iPad: in Safari, tap Share, then Add to Home Screen.";
  if (/Android/.test(ua)) return "On Android: in Chrome, open the menu, then Install app or Add to Home screen.";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg/.test(ua)) return "On a Mac: in Safari, open File, then Add to Dock.";
  return "In Chrome or Edge: the install icon at the right of the address bar, or the menu, then Install Tasu.";
}
async function openSetupSheet(opts = {}){
  if (opts instanceof Event) opts = {};
  closeSide();
  const veil = el("div","veil");
  veil.innerHTML = setupMarkup();
  document.body.append(veil);
  const msg = veil.querySelector("#kMsg"), slot = veil.querySelector("#feedSlot");
  /* A look previewed and not saved goes back to the saved one on close. */
  let draft = null;
  const shut = () => { if (draft) applyLook(S.brand); veil.remove(); };
  veil.querySelector("#kDone").onclick = shut;
  veil.onclick = e => { if(e.target===veil) shut(); };

  setupSpend({ veil });

  /* ---- the look: previewed as it changes, kept on Save ---- */
  const lookImg = veil.querySelector("#lookImg"), lookMsg = veil.querySelector("#lookMsg"), lookSave = veil.querySelector("#lookSave");
  const lookAccent = veil.querySelector("#lookAccent"), lookBg = veil.querySelector("#lookBg");
  const cssHex = name => { const c = toRgb(getComputedStyle(document.documentElement).getPropertyValue(name)); return c ? rgbHex(c) : "#888888"; };
  const paintLookInputs = () => {
    lookImg.src = markOf();
    lookAccent.value = S.brand?.accent || cssHex("--accent-fill");
    lookBg.value = S.brand?.bg || cssHex("--bg");
  };
  paintLookInputs();
  const preview = patch => {
    draft = { ...(draft || S.brand || {}), ...patch };
    applyLook(draft, { preview: true });
    lookImg.src = markOf();
    lookSave.disabled = false; lookMsg.textContent = "";
  };
  lookAccent.oninput = () => preview({ accent: lookAccent.value });
  lookBg.oninput = () => preview({ bg: lookBg.value });
  veil.querySelector("#lookLogo").onclick = () => veil.querySelector("#lookFile").click();
  veil.querySelector("#lookFile").onchange = async ev => {
    try { preview({ logo: await toLogo(ev.target.files?.[0]) }); }
    catch (e) { lookMsg.textContent = e.message; }
    ev.target.value = "";
  };
  lookSave.onclick = async () => {
    if (!draft) return;
    lookSave.disabled = true; lookMsg.textContent = "Saving";
    try {
      const r = await api("/api/brand", { logo: draft.logo ?? null, accent: draft.accent ?? null, bg: draft.bg ?? null });
      draft = null; applyLook(r.brand || null); paintLookInputs();
      veil.querySelector("#lookSum").textContent = r.brand ? "your own" : "default";
      lookMsg.textContent = "Saved. Every page of this workspace wears it now.";
    } catch (e) { lookSave.disabled = false; lookMsg.textContent = e.message; }
  };
  veil.querySelector("#lookReset").onclick = async () => {
    lookMsg.textContent = "Resetting";
    try {
      await api("/api/brand", { reset: true });
      draft = null; applyLook(null); paintLookInputs(); lookSave.disabled = true;
      veil.querySelector("#lookSum").textContent = "default";
      lookMsg.textContent = "Back to the default look.";
    } catch (e) { lookMsg.textContent = e.message; }
  };

  /* ---- the passphrase: the current one proves it is you ---- */
  const passMsg = veil.querySelector("#passMsg"), passGo = veil.querySelector("#passGo");
  const passCur = veil.querySelector("#passCur"), passNew = veil.querySelector("#passNew");
  passGo.onclick = async () => {
    passMsg.className = "hint";
    if (!passCur.value) { passMsg.textContent = "Type your current passphrase first."; return passCur.focus(); }
    if (passNew.value.length < 12) { passMsg.textContent = "The new passphrase needs 12 characters or more."; return passNew.focus(); }
    passGo.disabled = true; passMsg.textContent = "Changing";
    try {
      const r = await api("/api/passphrase", { current: passCur.value, next: passNew.value });
      passCur.value = ""; passNew.value = "";
      passMsg.textContent = r.ended ? `Changed. ${r.ended} other session${r.ended === 1 ? " is" : "s are"} signed out.` : "Changed. It opens this workspace from now on.";
    } catch (e) { passMsg.textContent = e.message; }
    passGo.disabled = false;
  };

  setupShare({ veil });

  /* ---- the model and the export ---- */
  veil.querySelector("#setModel").hidden = S.demo;
  veil.querySelector("#setModel").onclick = () => { shut(); openModelSheet(); };
  /* Audit: one row per folder this workspace holds, the last run and what came since. */
  const al = veil.querySelector("#auditList");
  for (const b of auditFolders()){
    const r = el("div","au-row"); r.dataset.slug = b.slug;
    const due = auditDue(b), run = S.auditRun?.slug === b.slug && S.auditRun.state === "running";
    if (run) r.classList.add("run");
    const t = el("div","au-t"); t.append(el("b",null,b.name), el("span",null, run ? `Running · ${S.auditRun.step}` : auditLine(b)));
    const go = el("button", due && !run ? "mini au-due" : "mini", run ? "Open" : due ? "Audit now" : "Audit"); go.type = "button";
    go.onclick = () => { shut(); runAudit(b, run); };
    r.append(t, go); al.append(r);
  }
  if (!al.children.length) al.append(el("div","hint","No folder to audit yet."));
  /* Each fold says where it stands while closed. */
  const dueN = auditFolders().filter(b => auditDue(b)).length;
  /* The decisions an audit or a drop left: one row, and a button into them. */
  const dn = decisionCount(), dRow = veil.querySelector("#auditDecide");
  const dt = el("div","au-t"); dt.append(el("b",null,"Decisions"), el("span",null, dn ? decisionLine() : "Nothing waiting."));
  const dGo = el("button", dn ? "mini au-due" : "mini", dn ? "Decide" : "Open"); dGo.type = "button";
  dGo.onclick = () => { shut(); openDecide(); };
  dRow.append(dt, dGo);
  veil.querySelector("#auditSum").textContent = [dueN ? `${dueN} due` : "", dn ? `${dn} to decide` : ""].filter(Boolean).join(" \u00b7 ");
  const langSum = () => {
    const v = voiceLang(), w = micEngine() === "whisper", name = v === "auto" ? (w ? "any language" : "") : v ? (VOICE_LANGS.find(x => x[0] === v) || [])[2] || v : w ? "any language" : "";
    veil.querySelector("#langSum").textContent = [S.demo ? "" : S.models?.reply === "en" ? "answers in English" : "answers as you write",
      w || Speech ? (name ? `mic in ${name}` : "mic not set") : ""].filter(Boolean).join(" · ");
  };
  langSum();
  veil.querySelector("#lookSum").textContent = S.brand ? "your own" : "default";
  setupPrefs({ veil, langSum });
  /* The mic, tapped with no language picked, sends you here to pick one. */
  if (opts.voice){
    veil.querySelector("#langBlock").open = true;
    const row = veil.querySelector("#langVoice").closest(".lang-row");
    row.classList.add("ask");
    veil.querySelector("#langMsg").textContent = "Pick the language the mic listens in. It hears one language at a time.";
    setTimeout(() => row.scrollIntoView({ block: "center" }), 60);
  }

  /* Restore: an export picked here goes to the server whole, which adds what this workspace is missing and keeps what it has. */
  const rst = veil.querySelector("#setRestore"), rmsg = veil.querySelector("#restoreMsg");
  rst.onclick = () => pickFile(".md,.markdown,.txt,text/markdown,text/plain", async file => {
    const v = rst.querySelector(".val");
    rst.disabled = true; v.textContent = "reading"; rmsg.className = "hint"; rmsg.textContent = "";
    try {
      const text = await file.text();
      v.textContent = "restoring";
      const r = await api("/api/restore", { text });
      const n = (k, one, many) => `${r[k].added} ${r[k].added === 1 ? one : many}`;
      const kept = r.brains.kept + r.concepts.kept + r.sources.kept;
      rmsg.textContent = `Restored ${n("brains", "folder", "folders")}, ${n("concepts", "concept", "concepts")} and ${n("sources", "source", "sources")}.` +
        (kept ? ` ${kept} already here, kept as they are.` : "") + (r.brains.skipped ? ` ${r.brains.skipped} folder${r.brains.skipped === 1 ? "" : "s"} named in another workspace left out.` : "") +
        (r.linking ? ` Their links follow in a minute.` : "");
      v.textContent = "done";
      refresh().catch(() => {});
    } catch (e) { v.textContent = "failed"; rmsg.className = "hint bad"; rmsg.textContent = /unreadable|404/.test(e.message) ? "The server is older than this page and cannot restore yet. Run convex deploy." : e.message; }
    finally { rst.disabled = false; setTimeout(() => { v.textContent = "from an export"; }, 2500); }
  });

  const exp = veil.querySelector("#setExport");
  exp.onclick = async () => {
    const v = exp.querySelector(".val");
    v.textContent = "reading"; exp.disabled = true;
    try { await exportAll(); v.textContent = "downloaded"; }
    catch (e) { v.textContent = "failed"; msg.className = "bad"; msg.textContent = e.message; }
    finally { exp.disabled = false; setTimeout(() => { v.textContent = "markdown"; }, 2000); }
  };

  /* ---- the address ---- */
  const paint = (st) => {
    slot.innerHTML = st.has ? `
      <div class="urlbox"><input id="mcpFeed" readonly spellcheck="false" value="${esc(location.origin + "/mcp/v0?k=" + st.token)}"><button id="mcpFeedCopy">Copy</button></div>
      <div class="hint">Made ${esc(st.made || "earlier")}.${st.made && Date.now() - Date.parse(st.made) > 90 * 864e5 ? " It is over 90 days old: replace it." : ""} Paste it into Claude, ChatGPT or any MCP client.
        Keep it private: whoever holds it can read and feed every ${esc(S.spaceName)} brain. The thinking
        runs on that client's own model, so nothing is spent here.</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="ghost" id="mcpNew">Replace it</button>
        <button class="ghost" id="mcpOff">Turn it off</button>
      </div>`
    : `
      <div class="hint">No address yet. Make one and your own Claude or ChatGPT can read the
        ${esc(S.spaceName)} brains and drop sources into them. Every step runs on that client's model, so
        it spends nothing here.</div>
      <div style="margin-top:10px"><button class="ghost" id="mcpMake">Make the ${esc(S.spaceName)} address</button></div>`;

    const copy = veil.querySelector("#mcpFeedCopy");
    if (copy) copyTo(copy, veil.querySelector("#mcpFeed"));
    const act = async (body, note) => {
      msg.className="spin"; msg.textContent = "Saving";
      try { const r = await api("/api/account/mcp", body);
        if (r.error) throw new Error(r.error);
        /* A success note is not an alert, so it reads at hint size. */
        msg.className="hint"; msg.textContent = note; paint(r);
      } catch(e){ msg.className="bad"; msg.textContent = e.message; }
    };
    const mk = veil.querySelector("#mcpMake") || veil.querySelector("#mcpNew");
    if (mk) mk.onclick = () => act({ make: true }, "Address ready. Paste it into your client.");
    const off = veil.querySelector("#mcpOff");
    if (off) off.onclick = () => act({ forget: true }, "Turned off. A client holding it can no longer feed.");
  };

  /* ---- your own key, in a workspace that runs on one ---- */
  const kIn = veil.querySelector("#ownKey"), kMsg = veil.querySelector("#ownKeyMsg");
  if (S.byok){
    kIn.value = myKey();
    kMsg.textContent = myKey() ? "Saved in this browser." : "No key in this browser yet: asking and dropping need one.";
    const saveKey = () => {
      const k = kIn.value.trim();
      if (!/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(k)){ kMsg.textContent = "That is not an OpenRouter key. It starts with sk-or-"; return; }
      setMyKey(k); kMsg.textContent = "Saved in this browser.";
    };
    veil.querySelector("#ownKeySave").onclick = saveKey;
    kIn.onkeydown = e => { if (e.key === "Enter") saveKey(); };
  }

  /* The connector and the transcript service are the owner's. */
  if (!ownerWs()) return;
  slot.innerHTML = `<div class="hint">Checking</div>`;
  try { paint(await api("/api/account/mcp", {})); }
  catch(e){ slot.innerHTML = `<div class="hint">${esc(e.message)}</div>`; }

  /* ---- what the transcript service has cost ---- */
  const use = veil.querySelector("#useSlot");
  use.innerHTML = `<div class="hint">Checking</div>`;
  try { use.innerHTML = usageLines(await api("/api/usage", { days: 30 })); }
  catch(e){ use.innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
}

/** The Settings sheet as markup: every section, folded or open, before any of it is wired. */
function setupMarkup(){
  return `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>Settings</h3>
      <p>${S.demo ? `The demo runs on the default model. Export its folders and pick the language of the mic.`
        : `The model that answers, the export of every ${esc(S.spaceName)} folder, the audit with the clashes and the decisions it leaves${ownerWs() ? ", and the MCP address for Claude" : ""}.`}</p></header>

      <div class="f set-row">
        <button class="foot-btn${modelLabel().picked ? " pick" : ""}" id="setModel" title="${esc(modelLabel().title)}">
          <span class="lbl">Model</span><span class="val">${esc(modelLabel().val)}</span></button>
        <button class="foot-btn" id="setExport" title="Every folder of this workspace, as one markdown file">
          <span class="lbl">Export</span><span class="val">markdown</span></button>
        <button class="foot-btn" id="setRestore" title="Read an export back: the folders, concepts and sources this workspace is missing are added, and what it holds is kept" ${S.demo ? "hidden" : ""}>
          <span class="lbl">Restore</span><span class="val">from an export</span></button>
        <button class="foot-btn" id="setInstall" title="Tasu on this device's home screen or dock, in a window of its own">
          <span class="lbl">App</span><span class="val">${INSTALLED ? "installed" : "install"}</span></button>
      </div>
      <div class="hint" id="restoreMsg" role="status" style="margin:4px 0 0"></div>
      <div class="f lang-row theme-row" style="margin-top:10px"><span>Appearance</span>
        <div class="seg" id="themePick" role="radiogroup" aria-label="Light or dark">
          <button type="button" role="radio" data-v="system">System</button><button type="button" role="radio" data-v="light">Light</button><button type="button" role="radio" data-v="dark">Dark</button></div></div>
      <div class="f lang-row theme-row" style="margin-top:10px" ${S.demo ? "hidden" : ""}><span>Answers</span>
        <div class="seg" id="depthPick" role="radiogroup" aria-label="How much an answer reads">
          <button type="button" role="radio" data-v="short">Short</button><button type="button" role="radio" data-v="long">Long</button></div></div>
      <div class="hint" id="depthMsg" role="status" style="margin:4px 0 0" ${S.demo ? "hidden" : ""}></div>

      <details class="f sh-fold" id="auditBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px" ${S.demo ? "hidden" : ""}>
        <summary><span>Audit</span><b id="auditSum" class="sh-count"></b></summary>
        <div class="hint" style="margin:8px 0 10px">Finds what is filed twice, titles not in English and empty positions, and in your personal folder the people not filed yet and the same person twice. A drop that contradicts what you hold joins them. You decide each one. Due after 50 sources dropped, and every week for the personal folder: the inbox says when.</div>
        <div class="au-row" id="auditDecide"></div>
        <div id="auditList"></div>
      </details>

      <details class="f sh-fold" id="langBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px">
        <summary><span>Languages</span><b id="langSum" class="sh-count"></b></summary>
        <div class="hint" style="margin:8px 0 10px">${S.demo ? "The language the mic listens in, kept in this browser." : "Write and talk in any language. Every note and file is kept in English, your own words beside each line."}</div>
        <div class="lang-row" ${S.demo ? "hidden" : ""}><span>Answers in the chat</span>
          <div class="seg" id="langReply" role="radiogroup" aria-label="The language answers come back in">
            <button type="button" role="radio" data-v="same">As you write</button><button type="button" role="radio" data-v="en">In English</button></div></div>
        <div class="lang-row" id="micRow" ${S.demo ? "hidden" : ""}><span>Voice</span>
          <div class="seg" id="micPick" role="radiogroup" aria-label="What writes what you say">
            <button type="button" role="radio" data-v="whisper">Whisper</button><button type="button" role="radio" data-v="browser">Browser</button></div></div>
        <div class="hint" id="micSay" style="margin:2px 0 8px" ${S.demo ? "hidden" : ""}></div>
        <div class="lang-row"><span>Mic language</span>
          <select id="langVoice" class="pick" aria-label="The language the mic listens in"></select></div>
        <div class="hint" id="langMsg" role="status" style="margin-top:6px"></div>
      </details>

      <details class="f sh-fold" id="spendBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px" ${S.demo ? "hidden" : ""}>
        <summary><span>Cost</span><b id="spendSum" class="sh-count"></b></summary>
        <div class="hint" style="margin:8px 0 10px">What this workspace cost this month, as the model host reports it: chats, assets, drops, upkeep, one-pagers and voice.</div>
        <div id="spendBody"><div class="hint">Loading</div></div>
      </details>

      <details class="f sh-fold" id="lookBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px" ${S.demo ? "hidden" : ""}>
        <summary><span>Look</span><b id="lookSum" class="sh-count"></b></summary>
        <div class="hint" style="margin:8px 0 10px">Your logo and colours, on every page of ${esc(S.spaceName)} and on the page that asks for its passphrase.</div>
        <div class="look">
          <button class="look-logo" id="lookLogo" type="button" title="Pick a logo: a square image reads best"><img id="lookImg" alt=""><span>Logo</span></button>
          <label class="look-c" title="The colour of buttons, rings and links"><input type="color" id="lookAccent"><span>Accent</span></label>
          <label class="look-c" title="The page colour, kept light so text reads"><input type="color" id="lookBg"><span>Page</span></label>
          <input type="file" id="lookFile" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
        </div>
        <div class="look-acts"><button class="mini" id="lookReset" type="button">Back to the default</button><button class="go" id="lookSave" type="button" disabled>Save the look</button></div>
        <div class="hint" id="lookMsg" role="status"></div>
      </details>

      <details class="f sh-fold" id="passBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px" ${S.demo ? "hidden" : ""}>
        <summary><span>Passphrase</span></summary>
        <div class="hint" style="margin:8px 0 10px">Change the passphrase that opens ${esc(S.spaceName)}. Anyone else signed in here is signed out.</div>
        <input id="passCur" type="password" autocomplete="current-password" placeholder="Current passphrase" aria-label="Current passphrase" style="margin-bottom:8px">
        <input id="passNew" type="password" autocomplete="new-password" placeholder="New passphrase, 12 characters or more" aria-label="New passphrase">
        <div class="look-acts"><button class="go" id="passGo" type="button">Change it</button></div>
        <div class="hint" id="passMsg" role="status"></div>
      </details>

      <details class="f sh-fold" id="shareBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:14px" ${ownerWs() ? "" : "hidden"}>
        <summary><span>Share folders</span><b id="shareCount" class="sh-count"></b></summary>
        <div class="hint" style="margin:8px 0 10px">Pick a workspace, then which folders go to it. It stays one folder, not a copy. A personal folder is never shared.</div>
        <label for="shareTo">Workspace</label>
        <select class="pick" id="shareTo" aria-label="The workspace to share with"></select>
        <div class="hint" id="shareNote" style="margin:7px 0 4px"></div>
        <div id="shareSlot"><div class="hint">Loading</div></div>
        <div class="hint" id="shareMsg" role="status"></div>
      </details>

      <div class="f" id="keyBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:16px" ${S.byok ? "" : "hidden"}>
        <label for="ownKey">Your OpenRouter key</label>
        <div class="hint" style="margin:0 0 8px">This workspace runs on your own key. It stays in this browser and
          travels with each call that needs a model. It is never saved on the server.</div>
        <div class="urlbox"><input id="ownKey" type="password" spellcheck="false" autocomplete="off" placeholder="sk-or-..."><button id="ownKeySave">Save</button></div>
        <div class="hint" id="ownKeyMsg"></div>
      </div>

      <div class="f" id="mcpBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:16px" ${ownerWs() ? "" : "hidden"}>
        <label>${esc(S.spaceName)} MCP address</label>
        <div class="hint" style="margin:0 0 8px">It lets Claude, ChatGPT or any MCP client read and feed the
          ${esc(S.spaceName)} brains, and no others. That client's own model does the thinking.</div>
        <div id="feedSlot"></div>
      </div>

      <div class="f" id="useBlock" style="border-top:1px solid var(--line); margin-top:14px; padding-top:16px" ${ownerWs() ? "" : "hidden"}>
        <label>Video transcripts</label>
        <div id="useSlot"></div>
      </div>

      <div class="f"><div id="kMsg" class="bad" role="alert"></div></div>
      <footer><a class="ghost" href="/doc" style="text-decoration:none">MCP setup</a><button class="go" id="kDone">Done</button></footer>
    </div>`;
}

/**
 * Settings, the voice: what writes what you say, Whisper or the browser, and the language the mic listens in. Whisper takes any
 * length and tells the language by itself with Detect; the browser is free, hears one language you pick, up to 2 minutes at a time.
 * Saved for the workspace; the demo listens with the browser and keeps its language in this browser.
 */
function setupMic({ veil, langSum }){
  const seg = veil.querySelector("#micPick"), say = veil.querySelector("#micSay"), pick = veil.querySelector("#langVoice"), msg = veil.querySelector("#langMsg");
  const MIC_SAY = { whisper: "Whisper writes it: as long as you talk, in any language, with punctuation and names. About $0.04 an hour of talking, counted under Voice in Cost.",
    browser: "The browser writes it: free, in Chrome, Edge and Safari, up to 2 minutes at a time, in the one language picked below." };
  const engine = () => micEngine();
  const paint = () => {
    const w = engine() === "whisper";
    for (const x of seg.children){ const on = x.dataset.v === (S.models?.mic === "whisper" ? "whisper" : "browser"); x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); }
    say.textContent = whisperOld() ? WHISPER_OLD
      : MIC_SAY[w ? "whisper" : "browser"] + (S.models?.mic === "whisper" && !recorderOK() ? " This browser cannot record, so it listens with its own service here." : "");
    const now = voiceLang();
    pick.innerHTML = (w ? `<option value="auto">Detect: any language</option>` : `<option value="">Pick a language</option>`)
      + VOICE_LANGS.map(x => `<option value="${x[0]}">${esc(x[2])}</option>`).join("");
    pick.value = now === "auto" ? (w ? "auto" : "") : now || (w ? "auto" : "");
    pick.closest(".lang-row").hidden = !w && !Speech;
  };
  /* An older server has no Whisper: the choice is left out, and the line says what to run. */
  veil.querySelector("#micRow").hidden = S.demo || whisperOld();
  say.hidden = !!S.demo;
  paint();
  seg.onclick = async e => {
    const x = e.target.closest("button[data-v]");
    if (!x || x.dataset.v === S.models?.mic) return;
    msg.textContent = "Saving";
    try {
      const r = await api("/api/models", { mic: x.dataset.v });
      S.models = { ...(S.models || {}), mic: r.mic };
      paint(); langSum();
      msg.textContent = r.mic === "whisper" ? "Saved. Whisper writes what you say, on every device of this workspace." : "Saved. The browser writes what you say, free, on every device of this workspace.";
    } catch (err){ msg.textContent = err.message; }
  };
  pick.onchange = async () => {
    const v = pick.value;
    const said = () => `Saved. The mic listens in ${v === "auto" ? "any language, and Whisper tells which" : (VOICE_LANGS.find(x => x[0] === v) || [])[2] || v}${S.demo ? ", in this browser" : ", on every device of this workspace"}. Tap the mic to talk.`;
    if (!v){ return; }
    if (S.demo){ setLocalVoice(v); langSum(); msg.textContent = said(); return; }
    msg.textContent = "Saving";
    try {
      const r = await api("/api/models", { voice: v });
      S.models = { ...(S.models || {}), voice: r.voice };
      langSum(); msg.textContent = said();
    } catch (err){ msg.textContent = err.message; }
  };
}

/** Settings, what the workspace cost this month, kind by kind. */
function setupSpend({ veil }){
  const spendBlock = veil.querySelector("#spendBlock");
  if (!spendBlock.hidden){
    const sum = veil.querySelector("#spendSum"), body = veil.querySelector("#spendBody");
    /* Everything that asks a model, by kind, in this order. */
    const KINDS = { folders: "Folder chat", personal: "Personal chat", assets: "Assets", drops: "Drops", upkeep: "Upkeep", pager: "One-pagers", voice: "Voice" };
    const paint = r => {
      const chats = (r.chats || []).filter(c => KINDS[c.kind]).sort((a, b) => Object.keys(KINDS).indexOf(a.kind) - Object.keys(KINDS).indexOf(b.kind));
      const all = { usd: 0, calls: 0, priced: 0, tokensIn: 0, tokensOut: 0, cached: 0 };
      for (const c of chats) for (const k of Object.keys(all)) all[k] += c[k] || 0;
      sum.textContent = `${spendUsd(all.usd)} this month`;
      body.innerHTML = "";
      const row = (name, usd, more, cls) => { const x = el("div","sp-row" + (cls ? " " + cls : "")); x.append(el("span",null,name)); const b = el("b",null,usd); if (more) b.append(el("small",null,more)); x.append(b); body.append(x); };
      const calls = n => `${n.toLocaleString("en-US")} call${n === 1 ? "" : "s"}`;
      const reused = all.tokensIn ? Math.round(100 * all.cached / all.tokensIn) : 0;
      row("This month", spendUsd(all.usd), all.calls ? calls(all.calls) : "");
      for (const c of chats) row(KINDS[c.kind], spendUsd(c.usd), calls(c.calls) + (c.reused ? `, ${c.reused.toLocaleString("en-US")} reused free` : ""), "sub");
      if (all.calls) row("Tokens", `${spendTok(all.tokensIn)} in, ${spendTok(all.tokensOut)} out`, reused ? `${reused}% reused` : "");
      row("Last month", spendUsd(r.last.usd));
      if (all.calls && all.priced < all.calls){ const n = all.calls - all.priced; body.append(el("div","sp-note",`${n.toLocaleString("en-US")} call${n === 1 ? "" : "s"} came back with no price, so the dollars may be low. The tokens are exact.`)); }
    };
    api("/api/spend").then(paint).catch(e => { body.innerHTML = ""; body.append(el("div","sp-note bad",/unreadable/.test(e.message) ? "The server is older than this page and cannot count yet. Run convex deploy." : e.message)); });
  }
}

/** Settings, Share brain: pick a workspace, then which brains go to it. */
function setupShare({ veil }){
  /* ---- Share brain: pick a workspace, then which brains go to it ---- */
  const shareSlot = veil.querySelector("#shareSlot"), shareMsg = veil.querySelector("#shareMsg");
  const shareTo = veil.querySelector("#shareTo"), shareNote = veil.querySelector("#shareNote"), shareCount = veil.querySelector("#shareCount");
  let shareData = null;
  const paintShare = r => {
    shareData = r;
    const was = shareTo.value;
    shareTo.innerHTML = "";
    for (const t of r.targets){
      const o = el("option", null, t.mode === "read" ? `${t.name} (read only)` : t.name); o.value = t.slug; shareTo.append(o);
    }
    if (r.targets.some(t => t.slug === was)) shareTo.value = was;
    const n = r.brains.filter(b => b.to.length).length;
    shareCount.textContent = n ? `${n} shared` : "";
    paintRows();
  };
  const paintRows = () => {
    const r = shareData, t = r.targets.find(x => x.slug === shareTo.value);
    shareSlot.innerHTML = "";
    shareNote.textContent = !t ? "There is no other workspace to share with." : t.mode === "read"
      ? `Everyone who opens ${t.name} can read the folders you share there. Nobody there can change them.`
      : `${t.name} can read these folders and feed them. A drop there fills them here too.`;
    if (t && !r.brains.length) shareSlot.append(el("div","hint","No folder here to share yet."));
    for (const b of t ? r.brains : []){
      const on = b.to.includes(t.slug);
      const row = el("div","sh-row");
      row.append(el("span","sh-name",b.name));
      const chip = el("button","sh-chip" + (on ? " on" : ""), on ? "Shared" : "Share");
      chip.type = "button"; chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.setAttribute("aria-label", `${on ? "Stop sharing" : "Share"} ${b.name} with ${t.name}`);
      chip.onclick = async () => {
        chip.disabled = true; shareMsg.textContent = "Saving";
        try {
          paintShare(await api("/api/share", { brain: b.slug, to: t.slug, on: !on }));
          shareMsg.textContent = on ? `${b.name} is no longer in ${t.name}.`
            : t.mode === "read" ? `${b.name} is now readable in ${t.name}.` : `${b.name} is now in ${t.name} too. A drop in either fills both.`;
          refresh().catch(() => {});
        } catch (e) { chip.disabled = false; shareMsg.textContent = e.message; }
      };
      row.append(chip); shareSlot.append(row);
    }
    if (r.joined.length){
      shareSlot.append(el("div","sh-sub","Shared with this workspace"));
      for (const b of r.joined){
        const row = el("div","sh-row");
        row.append(el("span","sh-name",b.name), el("span","sh-from",`from ${b.fromName}${b.readOnly ? ", read only" : ""}`));
        const leave = el("button","mini","Leave it");
        leave.type = "button";
        leave.onclick = async () => {
          leave.disabled = true; shareMsg.textContent = "Leaving";
          try {
            paintShare(await api("/api/share", { brain: b.slug, leave: true }));
            shareMsg.textContent = `${b.name} is no longer in this workspace. It stays in ${b.fromName}.`;
            if (S.scope === b.slug) S.scope = "all";
            refresh().catch(() => {});
          } catch (e) { leave.disabled = false; shareMsg.textContent = e.message; }
        };
        row.append(leave); shareSlot.append(row);
      }
    }
  };
  shareTo.onchange = () => { shareMsg.textContent = ""; paintRows(); };
  if (ownerWs()) api("/api/share", {}).then(paintShare).catch(e => { shareSlot.innerHTML = ""; shareMsg.textContent = e.message; });
}

/** Settings kept for this browser or the workspace: light or dark, Short or Long answers, the app on this device, and the languages. */
function setupPrefs({ veil, langSum }){
  /* Languages: saved for the workspace on a tap. The demo keeps its voice
     language in this browser, since its settings are shared by every visitor. */
  /* Light, dark, or as the device is set: this browser only, at once, nothing sent. */
  const themeSeg = veil.querySelector("#themePick");
  const paintTheme = () => { for (const x of themeSeg.children){ const on = x.dataset.v === themeOf(); x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); } };
  paintTheme();
  themeSeg.onclick = e => { const x = e.target.closest("button[data-v]"); if (!x) return; setTheme(x.dataset.v); paintTheme(); };
  /* Answers, Short or Long: how much a Normal answer reads, saved for the workspace. */
  const depthSeg = veil.querySelector("#depthPick"), depthMsg = veil.querySelector("#depthMsg");
  const DEPTH_SAY = { short: "Short: a Normal answer reads its 12 best concepts, for about a third less a question. Educational and Learning read in full.",
    long: "Long: a Normal answer reads up to 30 concepts, for questions that pull many sources together." };
  const depthNow = () => S.models?.depth === "short" ? "short" : "long";
  const paintDepth = () => { for (const x of depthSeg.children){ const on = x.dataset.v === depthNow(); x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); }
    depthMsg.textContent = DEPTH_SAY[depthNow()]; };
  paintDepth();
  depthSeg.onclick = async e => {
    const x = e.target.closest("button[data-v]");
    if (!x || x.dataset.v === depthNow()) return;
    depthMsg.textContent = "Saving";
    try { const r = await api("/api/models", { depth: x.dataset.v }); S.models = { ...(S.models || {}), depth: r.depth }; paintDepth(); }
    catch (err) { depthMsg.textContent = err.message; }
  };
  /* Install: the browser's own prompt where it gives one; elsewhere, where to tap; once installed, where it is. */
  const inst = veil.querySelector("#setInstall"), instMsg = veil.querySelector("#restoreMsg");
  inst.onclick = async () => {
    if (INSTALLED){ instMsg.textContent = "Tasu runs as an app on this device, from its home screen or dock."; return; }
    if (installAsk){
      const ask = installAsk; installAsk = null;
      try {
        await ask.prompt();
        const r = await ask.userChoice;
        instMsg.textContent = r?.outcome === "accepted" ? "Installed. Tasu opens from your home screen or dock, in a window of its own." : "Install skipped. Tap App again when you want it.";
      } catch { instMsg.textContent = installSteps(); }
      return;
    }
    instMsg.textContent = installSteps();
  };
  /* How answers come back: as you write, or in English, saved for the workspace on a tap. */
  const langSeg = (id, key, def, said) => {
    const seg = veil.querySelector("#" + id), msg = veil.querySelector("#langMsg");
    const now = () => S.models?.[key] || def;
    const paint = () => { for (const x of seg.children){ const on = x.dataset.v === now(); x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); } };
    seg.closest(".lang-row").hidden = S.demo;
    paint();
    seg.onclick = async e => {
      const x = e.target.closest("button[data-v]");
      if (!x || x.dataset.v === now()) return;
      msg.textContent = "Saving";
      try {
        const r = await api("/api/models", { [key]: x.dataset.v || null });
        S.models = { ...(S.models || {}), reply: r.reply, voice: r.voice };
        paint(); langSum(); msg.textContent = said(x.dataset.v);
      } catch (err) { msg.textContent = err.message; }
    };
  };
  langSeg("langReply", "reply", "same", v => v === "en" ? "Saved. Answers come back in English." : "Saved. Answers come back in the language you write in.");
  setupMic({ veil, langSum });
}

/**
 * Two counts, because they answer different questions.
 *
 * The vendor's is the one the quota is measured against, so it decides when to
 * start pasting instead. The local one is the pace Octopus itself runs at over
 * the last 30 days, which is what says whether the quota will hold.
 */
function usageLines(u){
  if (!u.configured){
    return `<div class="hint">No transcript service is set, so a video link asks you to paste.
      <a href="/doc">How to turn it on</a>.</div>`;
  }
  const m = u.mine || {}, p = u.plan;
  const mine = `<div class="meter">${m.got || 0} fetched through Octopus in the last ${m.days || 30} days` +
    (m.failed ? `, ${m.failed} asked you to paste` : "") + `.</div>`;

  if (!p){
    return `<div class="hint bad-ish">The service did not report its own count: ${esc(u.why || "no reason given")}</div>` + mine;
  }
  const left = Math.max((p.max || 0) - (p.used || 0), 0);
  const pct = p.max ? Math.min(Math.round((p.used / p.max) * 100), 100) : 0;
  const tight = p.max && left <= Math.max(Math.ceil(p.max * 0.15), 5);
  return `
    <div class="bar"><i style="width:${pct}%" class="${tight?"tight":""}"></i></div>
    <div class="meter"><b>${p.used}</b> of <b>${p.max}</b> credits used this billing period
      &middot; ${esc(p.name)} plan${u.mode === "auto" ? " &middot; generating when captions are missing" : ""}</div>
    ${mine}
    ${tight ? `<div class="hint" style="color:var(--accent)">${left} left. Paste transcripts until it resets.</div>` : ""}`;
}

/* Clipboard access can be refused, so leaving the text selected is the fallback. */
function copyTo(btn, input){
  btn.onclick = async () => {
    input.select();
    try { await navigator.clipboard.writeText(input.value); btn.textContent = "Copied"; }
    catch { btn.textContent = "Press copy"; }
    setTimeout(() => { btn.textContent = "Copy"; }, 1600);
  };
}

/**
 * The model list comes from OpenRouter itself, so the prices shown are the ones
 * that get billed. Only models that accept a JSON response format are offered,
 * because every drop asks for JSON and the rest fail on the first call.
 *
 * Fetched once per tab. A failed fetch leaves the text field, which still works.
 */
let MODELS = null;
async function models(){
  if (MODELS) return MODELS;
  const r = await fetch("https://openrouter.ai/api/v1/models");
  if (!r.ok) throw new Error("OpenRouter did not answer with its model list");
  const d = await r.json();
  MODELS = (d.data || [])
    .filter(m => (m.supported_parameters || []).includes("response_format"))
    .map(m => ({
      id: m.id, name: m.name || m.id,
      inp: Number(m.pricing?.prompt || 0) * 1e6,
      out: Number(m.pricing?.completion || 0) * 1e6,
      ctx: Number(m.context_length || 0),
    }))
    /* A negative price means the router decides at call time, so no number can
       be shown. Those rows would read as "$-1000000 in". */
    .filter(m => m.inp >= 0 && m.out >= 0)
    .sort((a, b) => (a.inp + a.out) - (b.inp + b.out));
  return MODELS;
}

const money = n => n === 0 ? "free" : n < 1 ? "$" + n.toFixed(3).replace(/0+$/,"").replace(/\.$/,"") : "$" + n.toFixed(2);
/** What the workspace cost, in dollars: cents from ten cents, a place more below, and four under a cent. */
const spendUsd = n => "$" + (n >= 0.1 || n === 0 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4));
/** Tokens as a person reads them: 950, 12.4k, 3.20M. */
const spendTok = n => n < 1000 ? String(Math.round(n)) : n < 1e6 ? (n / 1000).toFixed(1) + "k" : (n / 1e6).toFixed(2) + "M";
const ctxOf = n => n >= 1000000 ? Math.round(n/1000000) + "M" : n >= 1000 ? Math.round(n/1000) + "k" : String(n);

/**
 * Pick a model for the whole workspace: it answers in the chat, reads Drop and
 * writes one-pagers. Use the default goes back to the one this deployment runs.
 */
function openModelSheet(){
  closeSide();
  const def = S.models?.chatDefault || S.model;
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>Model</h3>
      <p>The model that answers in the chat, reads and files what you drop, and writes one-pagers.
      It applies to everyone in this workspace. ${S.byok ? "Your own key pays for every call." : "This deployment's key pays for every call."}
      Prices are per million tokens, read from OpenRouter.</p>
      <p class="mfav" id="mFav" role="status" hidden></p></header>
      <div class="f"><label for="mQ">Search</label><input id="mQ" autocomplete="off" spellcheck="false" placeholder="claude, gemini, free, ...">
        <div class="mlist" id="mList"><div class="mnone">Loading the list</div></div>
      </div>
      <div class="f"><div id="mMsg" class="bad" role="alert"></div></div>
      <footer>
        <button class="ghost" id="mReset">Use the default</button>
        <button class="ghost" id="mCancel">Cancel</button>
        <button class="go" id="mSave">Use this one</button>
      </footer>
    </div>`;
  document.body.append(veil);
  const q = veil.querySelector("#mQ"), list = veil.querySelector("#mList"),
        msg = veil.querySelector("#mMsg"), save = veil.querySelector("#mSave");
  const shut = () => veil.remove();
  veil.querySelector("#mCancel").onclick = shut;
  veil.onclick = e => { if(e.target===veil) shut(); };

  let chosen = S.models?.chat || def || "";
  let all = [];

  /* The favourites, when there are some: each with the price that was compared, the day it was read, and what a pick here does. */
  const favBox = veil.querySelector("#mFav");
  const paintFav = () => {
    const f = S.models?.favs;
    favBox.hidden = !f?.length;
    if (!f?.length) return;
    const price = new Map((S.models.favPrices || []).map(p => [p.id, p.price]));
    const name = id => (all.find(m => m.id === id)?.name || "").replace(/^[^:]+:\s*/, "") || id.split("/").pop();
    const day = S.models.favAt ? fileDay(new Date(S.models.favAt).toISOString().slice(0, 10)) : "";
    favBox.textContent = `Chosen each day as the cheapest of your favourites${day ? `, checked ${day}` : ""}: ` +
      f.map(id => `${name(id)}${price.has(id) ? " " + money(price.get(id)) : ""}`).join(" \u00b7 ") +
      ", per million tokens. Picking a model here ends that.";
  };
  paintFav();

  const paint = () => {
    const t = q.value.trim().toLowerCase();
    /* Cheapest first, with the one this deployment runs pinned to the top, so
       the list opens on the model you are already paying for. */
    const hits = (t ? all.filter(m => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t)
                                      || (t === "free" && m.inp === 0 && m.out === 0))
                    : [...all.filter(m => m.id === def), ...all.filter(m => m.id !== def)]).slice(0, 120);
    list.innerHTML = "";
    if (!hits.length){ list.append(el("div","mnone", all.length ? "No model matches that." : "The list did not load. Nothing to pick from.")); return; }
    for (const m of hits){
      const row = el("button","mrow" + (m.id === chosen ? " on" : ""));
      row.append(el("b",null,m.name));
      row.append(el("span",null,
        `${m.id}  ·  ${money(m.inp)} in / ${money(m.out)} out per M  ·  ${ctxOf(m.ctx)} ctx` +
        (m.id === def ? "  ·  default" : "")));
      row.onclick = () => { chosen = m.id; paint(); };
      list.append(row);
    }
  };
  q.oninput = paint;

  models().then(ms => { all = ms; paint(); paintFav(); setTimeout(()=>q.focus(),30); })
    .catch(e => { msg.className="bad"; msg.textContent = e.message; list.innerHTML = ""; list.append(el("div","mnone","The list did not load.")); });

  /* Saved for the workspace, then Settings opens again on the new pick. */
  const keep = async model => {
    save.disabled = true; msg.textContent = "";
    let r;
    try { r = await api("/api/models", { chat: model }); }
    catch (e) { save.disabled = false; msg.className = "bad"; msg.textContent = e.message; return; }
    S.models = { ...(S.models || {}), chat: r.chat, favs: r.favs ?? null, ...(r.reply ? { reply: r.reply, voice: r.voice } : {}) };
    S.model = r.chat;
    shut(); render(); openSetupSheet();
  };
  veil.querySelector("#mReset").onclick = () => keep(null);
  save.onclick = () => {
    if (!chosen){ msg.className="bad"; msg.textContent="pick one from the list"; return; }
    keep(chosen === def ? null : chosen);
  };
}

/**
 * A new folder. A folder is fed by Drop from sources, and one switch says it
 * holds one person's view: answers then name that person, and a change of
 * mind is logged as a later view instead of a clash. A personal folder is fed
 * by what you say in its chat, and only that chat reads it.
 */
const KIND_ICON = {
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>`,
  personal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
};
function openSheet(name, scope, type){
  closeSide();
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet roomy" role="dialog" aria-modal="true" aria-labelledby="bTitle">
      <header><h3 id="bTitle">New folder</h3></header>
      <div class="f"><div class="kind" id="bType" role="radiogroup" aria-label="Kind of folder">
        <button type="button" role="radio" data-t="folder"><span class="k-ic">${KIND_ICON.folder}</span><span><b>Folder</b><small>Fed by Drop, from sources</small></span></button>
        <button type="button" role="radio" data-t="personal"><span class="k-ic me">${KIND_ICON.personal}</span><span><b>Personal</b><small>Fed by what you say</small></span></button>
      </div></div>
      <div class="f"><label for="bName">Name</label><input id="bName" autocomplete="off"></div>
      <div class="f" id="bScopeF"><label for="bScope">What it covers, in one line</label><textarea id="bScope"></textarea>
        <div class="hint">Drop reads this line to decide what goes in, so make it specific.</div></div>
      <label class="switch-row" id="bPersonF"><input type="checkbox" id="bPerson" role="switch"><span class="sw" aria-hidden="true"></span>
        <span><b>One person's view</b><small>Answers name this person all the way through. When they change their mind, it is logged as a later view, with nothing for you to rule.</small></span></label>
      <div class="f" id="bMineF" hidden>
        <div class="mine-note">You talk to it, and it files what you say as dated notes, in your words. It can call your other folders.
          <b>Only its own chat reads it.</b></div>
        <label for="bMem" style="margin-top:14px">What it should know about you <span class="optl">(optional)</span></label>
        <textarea id="bMem" placeholder="Paste what another assistant knows about you, or your notes."></textarea></div>
      <div id="closestSlot"></div>
      <footer><button class="ghost" id="bCancel">Cancel</button><button class="go" id="bMake">Create folder</button></footer>
    </div>`;
  document.body.append(veil);
  const nameI = veil.querySelector("#bName"), scopeI = veil.querySelector("#bScope"),
        personI = veil.querySelector("#bPerson"), memI = veil.querySelector("#bMem"), btn = veil.querySelector("#bMake");
  nameI.value = name||""; scopeI.value = scope||"";
  /* Who may feed a folder is not asked: the passphrase feeds every folder, and
     a folder is made closed to other accounts, which is the server's default. */
  let kind = type === "personal" ? "personal" : "folder";
  personI.checked = type === "person";
  const label = () => kind === "personal" ? "Create personal folder" : "Create folder";
  const paint = () => {
    [...veil.querySelectorAll("#bType button")].forEach(b => { const on = b.dataset.t === kind; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
    veil.querySelector("#bScopeF").hidden = kind === "personal";
    veil.querySelector("#bPersonF").hidden = kind === "personal";
    veil.querySelector("#bPersonF").classList.toggle("on", personI.checked);
    veil.querySelector("#bMineF").hidden = kind !== "personal";
    if (kind === "personal" && !nameI.value.trim()) nameI.value = "Me";
    if (!btn.disabled) btn.textContent = label();
  };
  paint();
  veil.querySelector("#bType").onclick = e => { const b=e.target.closest("button"); if(b){ kind=b.dataset.t; confirmed = false; veil.querySelector("#closestSlot").innerHTML = ""; paint(); } };
  personI.onchange = paint;
  const shut = () => { if (!busy) veil.remove(); };
  veil.querySelector("#bCancel").onclick = shut;
  veil.onclick = e => { if(e.target===veil) shut(); };
  setTimeout(()=>nameI.focus(),30);

  let confirmed = false, busy = false;
  btn.onclick = async () => {
    const mine = kind === "personal";
    const nm = nameI.value.trim(), sc = mine ? "" : scopeI.value.trim();
    const t = mine ? "personal" : personI.checked ? "person" : "subject";
    if (!nm || (!sc && !mine)){ (nm?scopeI:nameI).focus(); return; }
    if (!confirmed && S.brains.length && !mine){
      const near = nearest(sc);
      if (near){
        const slot = veil.querySelector("#closestSlot"); slot.innerHTML = "";
        const c = el("div","closest");
        c.append(el("b",null,"Closest folder you already have"), el("div",null,`${near.name}: ${near.scope}`));
        const p = el("div",null,"Create a new one anyway, or cancel and feed that folder instead.");
        p.style.cssText = "margin-top:7px;color:var(--ink-3)"; c.append(p);
        slot.append(c);
        btn.textContent = "Create anyway";
        confirmed = true; return;
      }
    }
    busy = true; btn.disabled = true; btn.textContent = "Creating";
    try {
      const r = await api("/api/brain", { name:nm, scope:sc, type:t });
      /* What it should know about you, filed the way Add memory files it. */
      const mem = mine ? memI.value.trim().slice(0, 200000) : "";
      busy = false; shut(); await refresh();
      /* What was pasted is filed in the background; the inbox shows where it stands. */
      const memo = mem && !(S.memJob && S.memJob.state === "running") ? startMemory(r.slug, nm, mem) : null;
      if (mine){
        if (S.chatId) newChat();
        S.picks = []; S.scope = r.slug; S.into = []; S.mode = "ask"; S.folder = null;
        render();
        push("ai", b => { b.innerHTML = rich(`**${esc(nm)}** is ready. Talk to it: it files what you say as dated notes, and answers from them and from your other folders. ` +
          (memo ? `It is filing what you pasted, ${memo.pieces.length} piece${memo.pieces.length === 1 ? "" : "s"}, in the background: the inbox shows where it stands.`
            : `**Add memory** brings in what another assistant already knows about you.`)); });
        $("input").focus();
        return;
      }
      setPicks([r.slug]); openDrop();
      dpush("ai", b => { b.innerHTML = rich(`**${esc(nm)}** is ready, scoped to "${esc(sc)}". Drop a source to feed it.`); });
    } catch(e){
      busy = false; btn.disabled = false; btn.textContent = label();
      const slot = veil.querySelector("#closestSlot");
      slot.innerHTML = ""; const c = el("div","closest");
      c.append(el("b",null,"That did not work"), el("div",null,String(e.message)));
      slot.append(c);
    }
  };
}

/**
 * Add memory: what another assistant knows about you, pasted or dropped in.
 * It is cut into pieces of about 6,000 characters on paragraph breaks, and
 * each piece is filed like a message, one call at a time.
 */
function memPieces(t, max = 6000){
  const out = []; let cur = "";
  for (const para of String(t).replace(/\r/g, "").split(/\n{2,}/)){
    let p = para.trim();
    if (!p) continue;
    while (p.length > max){
      const cut = Math.max(p.lastIndexOf(". ", max), p.lastIndexOf("\n", max), p.lastIndexOf(" ", max), Math.floor(max / 2));
      if (cur){ out.push(cur); cur = ""; }
      out.push(p.slice(0, cut + 1).trim()); p = p.slice(cut + 1).trim();
    }
    if (cur && cur.length + p.length + 2 > max){ out.push(cur); cur = ""; }
    cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}
/* ---- Add memory runs in the background ----
   One memory at a time is filed, piece by piece, whatever is on screen: the
   sheet can close, and the inbox shows where it stands. A memory stopped by
   an error goes on from the piece it stopped at. */

function startMemory(brain, name, text){
  S.memJob = { brain, name, pieces: memPieces(text), done: 0, made: 0, updated: 0, people: [], words: 0, facts: 0, state: "running", seen: false, at: Date.now() };
  runMemory(S.memJob);
  return S.memJob;
}
async function runMemory(j){
  j.state = "running"; j.error = ""; j.seen = false;
  paintInbox(); memOn()?.paint();
  try {
    while (j.done < j.pieces.length){
      /* As a drop is checked: every number, date and name of the piece looked
         for in what was filed; the passages holding the ones left out filed
         once more; what is still missing kept word for word. */
      const piece = j.pieces[j.done];
      const add = f => { j.made += f?.new || 0; j.updated += f?.updated || 0; j.people = [...new Set([...j.people, ...(f?.people || [])])]; return f?.kept || ""; };
      let kept = add((await apiRetry("/api/personal/remember", { brain: j.brain, text: piece })).filed);
      let left = factsIn(piece, kept);
      if (left.missing.length){
        const passages = gapPassages(piece, left.missing, 7000);
        if (passages){
          try { kept += "\n" + add((await apiRetry("/api/personal/remember", { brain: j.brain, text: passages, gaps: true }, { split: true })).filed); left = factsIn(piece, kept); }
          catch { /* kept as written, below */ }
        }
        const rest = left.missing.length ? gapPassages(piece, left.missing, 7000) : "";
        if (rest) add((await apiRetry("/api/personal/remember", { brain: j.brain, text: rest, verbatim: true })).filed);
      }
      j.words += (piece.match(/\S+/g) || []).length; j.facts += left.facts;
      j.done++;
      paintInbox(); memOn()?.paint();
    }
    j.state = "done";
    refresh().catch(() => {});
    /* Said in its own chat when that chat is on screen. */
    if (S.mode === "ask" && !S.folder && S.scope === j.brain && !memOn())
      push("ai", x => { x.innerHTML = rich(memSaid(j)); });
  } catch (e) { j.state = "failed"; j.error = e.message; }
  j.ended = Date.now();
  j.seen = memOn()?.brain === j.brain;
  paintInbox(); memOn()?.paint();
}
/** What a memory filed, in one line. */
function memSaid(j){
  const kept = [`${j.words.toLocaleString()} word${j.words === 1 ? "" : "s"}`,
    j.facts ? `${j.facts.toLocaleString()} number${j.facts === 1 ? "" : "s"}, date${j.facts === 1 ? "" : "s"} and name${j.facts === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return j.made || j.updated || j.people.length
    ? `**Remembered.** All of it kept: ${kept}, filed as ${filedLine({ new: j.made, updated: j.updated, people: j.people }).replace(/^Filed: /, "")}, in ${esc(j.name)}. Ask it what it knows about you.`
    : "Nothing in that was worth filing as a note.";
}

var memView = null;
/** The memory sheet, when it is on screen. */
function memOn(){ return memView && memView.veil.isConnected ? memView : null; }
function openMemorySheet(slug, file){
  const b = S.brains.find(x => x.slug === (typeof slug === "string" ? slug : S.scope) && x.type === "personal");
  if (!b) return;
  closeSide();
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <header><h3>Add memory to ${esc(b.name)}</h3>
      <p>Paste what another assistant knows about you, or add a PDF, Word, text, markdown or JSON file. In ChatGPT it sits under
        Settings, Personalization, Memory. It is read like a drop: every fact, number, date and name is filed as dated notes, and the result says so.</p></header>
      <div class="f" id="memIn1"><textarea class="mem" id="memText" placeholder="Paste it here"></textarea>
        <div class="mem-bar"><button class="mini" id="memFile" type="button">+ file</button><span class="hint" id="memCount"></span></div>
        <input type="file" id="memIn" hidden accept=".pdf,.docx,.txt,.md,.markdown,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json"></div>
      <div class="f mem-run" id="memRun" hidden>
        <div class="mem-track"><i id="memFill"></i></div>
        <div class="mem-say" id="memSay" role="status"></div>
      </div>
      <div class="f"><div id="memMsg" class="hint" role="status"></div></div>
      <footer id="memFoot"></footer>
    </div>`;
  document.body.append(veil);
  const t = veil.querySelector("#memText"), msg = veil.querySelector("#memMsg"), foot = veil.querySelector("#memFoot");
  const count = () => { const n = t.value.length, k = memPieces(t.value).length; veil.querySelector("#memCount").textContent = n ? `${n.toLocaleString()} characters, ${k} piece${k === 1 ? "" : "s"}` : ""; };
  t.oninput = count;
  /* Closing never stops it: what is filing goes on, and the inbox keeps count. */
  const shut = () => { veil.remove(); if (memView?.veil === veil) memView = null; };
  veil.onclick = e => { if (e.target === veil) shut(); };
  veil.querySelector("#memFile").onclick = () => veil.querySelector("#memIn").click();
  veil.querySelector("#memIn").onchange = ev => { const f = ev.target.files?.[0]; ev.target.value = ""; takeFile(f); };
  const takeFile = async f => {
    if (!f) return;
    /* A PDF or a Word file is read the way a drop reads it. */
    let text = "";
    try {
      if (/\.(pdf|docx)$/i.test(f.name)){ msg.textContent = `Reading ${f.name}`; text = (await readDocument(f)).text; msg.textContent = ""; }
      else if (f.size > 400000){ msg.textContent = "That file is over 400 KB. Paste the part that matters."; return; }
      else text = await f.text();
    } catch (e) { msg.textContent = e.message; return; }
    if (!text.trim()){ msg.textContent = `${f.name} gave no text. A scanned PDF holds pictures of words: paste the text instead.`; return; }
    t.value = (t.value ? t.value + "\n\n" : "") + text; count();
  };
  const button = (cls, label, fn, id) => { const x = el("button", cls, label); x.type = "button"; if (id) x.id = id; x.onclick = fn; return x; };
  /* The sheet shows the memory of this folder when there is one to show:
     filing, stopped, or done and not looked at yet. Otherwise, the box. */
  const paint = () => {
    const j = S.memJob && S.memJob.brain === b.slug ? S.memJob : null;
    const show = j && (j.state !== "done" || !j.seen || memView?.keep);
    veil.querySelector("#memIn1").hidden = !!show;
    veil.querySelector("#memRun").hidden = !show;
    foot.innerHTML = "";
    if (!show){
      msg.textContent = S.memJob && S.memJob.state === "running" ? `${S.memJob.name} is still filing a memory. This one starts when it is done.` : "";
      foot.append(button("ghost", "Cancel", shut, "memNo"), button("go", "Remember it", go, "memGo"));
      veil.querySelector("#memGo").disabled = !!(S.memJob && S.memJob.state === "running");
      return;
    }
    if (memView) memView.keep = true;
    j.seen = j.state !== "running" ? true : j.seen;
    const n = j.pieces.length;
    veil.querySelector("#memFill").style.width = `${Math.max(3, Math.round(100 * j.done / n))}%`;
    veil.querySelector("#memSay").innerHTML = j.state === "running"
      ? rich(`**Filing piece ${Math.min(j.done + 1, n)} of ${n}.** ${j.made || j.updated ? filedLine({ new: j.made, updated: j.updated }).replace(/^Filed: /, "") + " so far. " : ""}Close this: it goes on, and the inbox shows where it stands.`)
      : j.state === "done" ? rich(memSaid(j))
      : rich(`**Stopped at piece ${j.done + 1} of ${n}.** ${j.done ? `${j.done} filed. ` : ""}${esc(j.error || "")}`);
    msg.textContent = "";
    if (j.state === "running") foot.append(button("go", "Close, it keeps going", shut, "memClose"));
    else if (j.state === "failed"){
      foot.append(feedbackButton(j.error || "memory stopped", { where: "add memory", scope: b.slug }),
        button("ghost", "Close", shut, "memClose"), button("go", "Go on", () => runMemory(j), "memOn"));
    }
    else foot.append(button("ghost", "Add more", () => { S.memJob = null; memView.keep = false; t.value = ""; count(); paint(); paintInbox(); }, "memMore"),
      button("go", "Done", shut, "memClose"));
    paintInbox();
  };
  const go = () => {
    const text = t.value.trim();
    if (!text){ t.focus(); return; }
    if (text.length > 400000){ msg.textContent = "Up to 400,000 characters at a time, about 70 pages. Add the rest after."; return; }
    if (S.memJob && S.memJob.state === "running") return;
    startMemory(b.slug, b.name, text);
  };
  memView = { veil, paint, brain: b.slug, keep: false };
  paint();
  if (file && !veil.querySelector("#memIn1").hidden) takeFile(file);
  if (!veil.querySelector("#memIn1").hidden) setTimeout(() => t.focus(), 30);
}
$("memBtn").onclick = openMemorySheet;
/* The clashes the demo holds, one card at a time; a line in the thread when there are none. */
$("demoSettle").onclick = async () => {
  const b = $("demoSettle"); b.disabled = true; b.textContent = "Looking";
  try {
    const r = await api("/api/conflicts", {});
    const list = r.conflicts || [];
    if (list.length) openConflictDeck(list, r.others || 0);
    else push("ai", x => { x.innerHTML = rich("No open clash in the demo right now. Drop a source that disagrees with a folder, and one appears here."); });
  } catch (e) { push("ai", x => { x.innerHTML = rich(esc(e.message)); }); }
  finally { b.disabled = false; b.textContent = "Settle a clash"; }
};

function nearest(scope){
  const stop = new Set("the a an and or of for my own to in on with about from at by as is are".split(" "));
  const w = new Set((scope.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(x=>!stop.has(x)));
  let best=null, bestN=0;
  for (const b of S.brains){
    const o = new Set((String(b.scope||"").toLowerCase().match(/[a-z]{3,}/g)||[]).filter(x=>!stop.has(x)));
    let n=0; for (const x of w) if (o.has(x)) n++;
    if (n>bestN){ bestN=n; best=b; }
  }
  return bestN>=2 ? best : null;
}

