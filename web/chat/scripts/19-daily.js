/* 19-daily.js: The personal folder's daily log: today's questions in a chat of its own, and the video script. */

/* ============ the daily log ============
   An add-on of the personal folder. Once a day it asks about the day, one
   question at a time, in a chat of its own, and files each answer as notes,
   so the folder grows with every day told. Once 5 are answered, Write the
   script turns the day into a 60-second video script. The strip above the
   chat bar shows where today stands while it runs. */

/** Today's log of a personal folder, or null when what is held is another day's. */
function dailyToday(slug){
  const d = S.daily[slug];
  return d && d.day === new Date().toISOString().slice(0, 10) ? d : null;
}

/** Where today's log stands, read again from the server. */
async function loadDaily(slug){
  try {
    const r = await api("/api/daily", { brain: slug });
    S.daily[slug] = r.daily;
    paintIv();
    return r.daily;
  } catch { return null; }
}

/** A call that lands in the chat on screen: the start of today's log, or its script. */
async function dailyCall(slug, action, label, extra = {}){
  if (chatBusy() || !isPersonal(slug)) return;
  if (S.scope !== slug){ crossing(slug); S.picks = []; S.scope = slug; S.into = []; }
  S.mode = "ask"; S.folder = null; S.concept = null;
  render();
  const job = addJob("", null, label);
  job.body = thinking(job.label);
  renderComposer();
  try {
    const r = await api("/api/daily", { action, brain: slug, chat: S.chatId, history: S.thread.slice(-4), ...extra });
    const here = landed(job, r);
    if (job.body.isConnected){ job.body.innerHTML = ""; showAnswer(job.body, r, "", slug); }
    if (r.daily) S.daily[slug] = r.daily;
    /* One at a time: today's log pauses the interview. */
    if (action === "start" && S.iv[slug]) S.iv[slug] = { ...S.iv[slug], on: false };
    if ((r.filed && (r.filed.new || r.filed.updated))) refresh().catch(() => {});
    if (here){
      S.thread.push({ q: "", a: String(r.answer ?? "") });
      if (S.thread.length > 6) S.thread = S.thread.slice(-6);
    }
    endJob(job, true);
  } catch (e) {
    if (job.body.isConnected){ job.body.innerHTML = ""; job.body.append(el("div","err", e.message)); }
    job.error = e.message; endJob(job, false);
  } finally {
    renderComposer(); bottom(); $("input").focus();
  }
}

/** On, in the chat on screen, and the question waiting or today's first. */
function startDaily(slug){ return dailyCall(slug, "start", "Picking today's first question"); }
/** Today's 60-second video script, from today's answers and a light read of the notes. */
function writeScript(slug){ return dailyCall(slug, "script", "Writing the script"); }
/** Today's script written again, following their comment on the last one. */
function redoScript(slug, note){
  if (chatBusy()) return;
  if (note) says(note);
  return dailyCall(slug, "script", "Writing the script again", { redo: true, note });
}

/** Paused where it stands, with no model call. */
async function stopDaily(slug){
  if (chatBusy()) return;
  try {
    const r = await api("/api/daily", { action: "stop", brain: slug });
    S.daily[slug] = r.daily;
    push("ai", b => { b.append(el("div","iv-note", r.answer || "Paused.")); });
  } catch (e) { push("ai", b => { b.append(el("div","err", e.message)); }); }
  renderComposer(); bottom();
}

/** The strip while today's log runs: the beat it asks, the share told, Skip, Script once ready, and Stop. */
function dailyStrip(bar, slug, dl, busy){
  const live = el("span","iv-live");
  live.append(el("i","iv-dot"), el("b",null,"Daily log"));
  if (dl.beat) live.append(el("span","iv-at",`${dl.beat.label} · ${Math.min(dl.seen + 1, dl.total)} of ${dl.total}`));
  const track = el("span","iv-track"); const fill = el("i"); fill.style.width = `${Math.max(2, 100 * dl.seen / dl.total)}%`; track.append(fill);
  track.title = `${dl.answered} of ${dl.total} answered today`;
  const skip = el("button","iv-b","Skip"); skip.type = "button"; skip.id = "dlSkip"; skip.disabled = busy;
  skip.title = "Pass this question";
  skip.onclick = () => { if (chatBusy()) return; $("input").value = "skip"; go(); };
  bar.append(live, track, skip);
  if (dl.ready){
    const sc = el("button","iv-b","Script"); sc.type = "button"; sc.id = "dlScript"; sc.disabled = busy;
    sc.title = "Write today's 60-second video script now";
    sc.onclick = () => writeScript(slug);
    bar.append(sc);
  }
  const stop = el("button","iv-b stop","Stop"); stop.type = "button"; stop.id = "dlStop"; stop.disabled = busy;
  stop.title = "Pause today's log. It picks up where you left off.";
  stop.onclick = () => stopDaily(slug);
  bar.append(stop);
}

/** Write the script, beside the interview's way in, once today is told and not yet written. */
function scriptButton(slug, busy){
  const b = el("button","iv-go"); b.type = "button"; b.id = "dlWrite"; b.disabled = busy;
  b.title = "Today's answers as a 60-second video script";
  b.innerHTML = IC_DAY;
  b.append(el("span",null,"Write the script"));
  b.onclick = () => writeScript(slug);
  return b;
}

/** The daily log in the twin pane: where today stands, its way in, and the series line. */
function dailySection(b){
  const box = el("section","dl-sec"); box.id = "dlSec";
  box.append(el("h4",null,"Daily log"));
  const say = el("p","fv-pos","Today's questions, one at a time, in a chat of its own. Each answer goes into your notes here, and the day becomes a 60-second video script.");
  const now = el("div");
  box.append(say, now);
  const paint = dl => {
    now.innerHTML = "";
    const row = el("div","tw-acts");
    const goB = el("button","go", dl?.on || dl?.seen ? "Resume today's log" : "Start today's log"); goB.type = "button"; goB.id = "dlGo";
    goB.onclick = () => { S.folder = null; newChat(); startDaily(b.slug); };
    const where = !dl ? "" : `Today: ${dl.answered} of ${dl.total} answered${dl.script ? " · script written" : dl.ready ? " · ready for its script" : ""}.`;
    row.append(goB, el("span","ts-say", where));
    const series = el("p","tw-key", dl?.series
      ? `Every script opens: "${dl.series.line.replace(/\{n\}/gi, dl.dayNo || 1)}"${dl.dayNo ? `. Today is Day ${dl.dayNo}.` : "."}`
      : "No series line: each script opens in its own words.");
    const edit = el("button","mini", dl?.series ? "Change the series line" : "Set a series line"); edit.type = "button"; edit.id = "dlSeries";
    edit.onclick = () => openSeriesSheet(b.slug, dl?.series, next => paint(next));
    now.append(row, series, edit);
  };
  loadDaily(b.slug).then(paint);
  return box;
}

/** The line that opens every script, with {n} as the day count from its Day 1. */
function openSeriesSheet(slug, series, done){
  const veil = el("div","veil");
  veil.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="slTitle">
      <header><h3 id="slTitle">Series line</h3></header>
      <div class="f"><label for="slLine">Every script opens with</label>
        <textarea id="slLine" placeholder="Day {n} working towards my first $10k a month. I'm Jeremy, I'm 25, currently in Ireland"></textarea>
        <div class="hint">{n} is the day count. The script ends the sentence with what you are trying to do that day. Empty: each script opens in its own words.</div></div>
      <div class="f"><label for="slStart">Day 1</label><input id="slStart" type="date"></div>
      <footer><button class="ghost" id="slCancel">Cancel</button><button class="go" id="slSave">Save</button></footer>
    </div>`;
  document.body.append(veil);
  const line = veil.querySelector("#slLine"), start = veil.querySelector("#slStart"), save = veil.querySelector("#slSave");
  line.value = series?.line || "";
  start.value = series?.start || new Date().toISOString().slice(0, 10);
  const shut = () => veil.remove();
  veil.querySelector("#slCancel").onclick = shut;
  veil.onclick = e => { if (e.target === veil) shut(); };
  setTimeout(() => line.focus(), 30);
  save.onclick = async () => {
    save.disabled = true; save.textContent = "Saving";
    try {
      const r = await api("/api/daily", { action: "series", brain: slug, series: { line: line.value.trim(), start: start.value } });
      S.daily[slug] = r.daily;
      shut();
      if (done) done(r.daily);
    } catch (e) { save.disabled = false; save.textContent = "Save"; save.title = e.message; }
  };
}

/** A script on screen: one tap copies it whole, and today's can be written again with a comment. */
function scriptActs(body, r, slug){
  const text = String(r.answer ?? r.a ?? "");
  const acts = el("div","ans-acts");
  const cp = el("button","mini","Copy the script"); cp.type = "button";
  cp.onclick = async () => {
    try { await navigator.clipboard.writeText(text); cp.textContent = "Copied"; }
    catch { cp.textContent = "Select it to copy"; }
  };
  acts.append(cp);
  /* Only today's script: the answers it is written from are today's. */
  const today = new Date().toISOString().slice(0, 10);
  if (r.day === today && isPersonal(slug) && !S.demo){
    const rd = el("button","mini","Redo with a comment"); rd.type = "button"; rd.className = "mini sc-redo";
    rd.onclick = () => {
      acts.hidden = true;
      const form = el("div","sc-form");
      const ta = el("textarea"); ta.rows = 2; ta.placeholder = "What to change: a stronger hook, a number in the Desire line, shorter...";
      ta.setAttribute("aria-label", "Your comment on the script");
      const row = el("div","sc-row");
      const go = el("button","go","Redo"); go.type = "button";
      const no = el("button","ghost","Cancel"); no.type = "button";
      no.onclick = () => { form.remove(); acts.hidden = false; };
      go.onclick = () => { const note = ta.value.trim(); form.remove(); acts.hidden = false; redoScript(slug, note); };
      ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); go.click(); } };
      row.append(go, no);
      form.append(ta, row);
      acts.after(form);
      ta.focus();
    };
    acts.append(rd);
  }
  body.append(acts);
}
