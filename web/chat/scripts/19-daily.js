/* 19-daily.js: The personal folder's daily log: today's questions in a chat of its own. */

/* ============ the daily log ============
   An add-on of the personal folder. Once a day it asks about the day, one
   question at a time, in a chat of its own, and files each answer as notes,
   so the folder grows with every day told. The strip above the chat bar
   shows where today stands while it runs. */

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

/** On, in the chat on screen, and the question waiting or today's first. */
async function startDaily(slug){
  const action = "start", label = "Picking today's first question";
  if (chatBusy() || !isPersonal(slug)) return;
  if (S.scope !== slug){ crossing(slug); S.picks = []; S.scope = slug; S.into = []; }
  S.mode = "ask"; S.folder = null; S.concept = null;
  render();
  const job = addJob("", null, label);
  job.body = thinking(job.label);
  renderComposer();
  try {
    const r = await api("/api/daily", { action, brain: slug, chat: S.chatId, history: S.thread.slice(-4) });
    const here = landed(job, r);
    if (job.body.isConnected){ job.body.innerHTML = ""; showAnswer(job.body, r, "", slug); }
    if (r.daily) S.daily[slug] = r.daily;
    /* One at a time: today's log pauses the interview. */
    if (S.iv[slug]) S.iv[slug] = { ...S.iv[slug], on: false };
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

/** Today's chat of the log, when one is saved. */
function dailyChat(slug){
  const day = new Date().toISOString().slice(0, 10);
  return (S.chats || []).find(c => c.brain === slug && c.title === `Daily log, ${day}`) || null;
}

/**
 * The way into today's log, from the side panel or the twin pane. Today's chat
 * opens again when there is one: a question waiting is already in it, and a
 * paused log asks its next one there. With no chat yet, a new one starts.
 */
async function openDaily(slug){
  if (chatBusy()) return;
  S.folder = null; S.concept = null;
  const c = dailyChat(slug), dl = dailyToday(slug);
  if (c){
    if (S.chatId !== c.id) await openChat(c.id);
    else { closeSide(); render(); }
    if (!dl?.on && dl?.beat) await startDaily(slug);
    return;
  }
  newChat();
  return startDaily(slug);
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

/** The strip while today's log runs: the beat it asks, the share told, Skip and Stop. */
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
  const stop = el("button","iv-b stop","Stop"); stop.type = "button"; stop.id = "dlStop"; stop.disabled = busy;
  stop.title = "Pause today's log. It picks up where you left off.";
  stop.onclick = () => stopDaily(slug);
  bar.append(stop);
}

/** The daily log in the twin pane: where today stands, and its way in. */
function dailySection(b){
  const box = el("section","dl-sec"); box.id = "dlSec";
  box.append(el("h4",null,"Daily log"));
  const say = el("p","fv-pos","Today's questions, one at a time, in a chat of its own. Each answer goes into your notes here.");
  const now = el("div");
  box.append(say, now);
  const paint = dl => {
    now.innerHTML = "";
    const row = el("div","tw-acts");
    const goB = el("button","go", dl?.on || dl?.seen ? "Resume today's log" : "Start today's log"); goB.type = "button"; goB.id = "dlGo";
    goB.onclick = () => openDaily(b.slug);
    const where = !dl ? "" : `Today: ${dl.answered} of ${dl.total} answered.`;
    row.append(goB, el("span","ts-say", where));
    now.append(row);
  };
  loadDaily(b.slug).then(paint);
  return box;
}
