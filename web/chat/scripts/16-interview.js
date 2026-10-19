/* 16-interview.js: The personal folder's interview and twin test. */

/* ============ the interview ============
   A personal brain asks too: one question at a time, from 335 in 17
   chapters, each answer filed as notes like any message. The strip above the
   chat bar starts it, shows where it stands, and stops it. */

/** Where a personal brain's interview stands, read again from the server. */
/** Every question answered or known: the interview has nothing left to ask. */
function ivFull(iv){ return !!iv && (iv.pct >= 100 || (iv.total > 0 && iv.covered >= iv.total)); }
function ivDone(iv){ return ivFull(iv) && !iv.on; }
async function loadIv(slug){
  try {
    const r = await api("/api/interview", { brain: slug });
    S.iv[slug] = r.interview; S.ivFull[slug] = r;
    paintIv();
    return r;
  } catch { return null; }
}

function paintIv(){
  const bar = $("ivBar"); if (!bar) return;
  /* A press on the strip keeps the field's focus: a blur would fold the bar
     and move the strip out from under the pointer before the click lands. */
  if (!bar.dataset.held){ bar.dataset.held = "1"; bar.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); }); }
  const slug = S.scope;
  const show = S.mode === "ask" && isPersonal(slug) && !S.demo && !S.folder && !S.concept;
  paintSubs();
  bar.hidden = !show;
  if (!show) return;
  if (!(slug in S.iv)){ S.iv[slug] = null; loadIv(slug); }
  if (!(slug in S.daily)){ S.daily[slug] = null; loadDaily(slug); }
  const iv = S.iv[slug], dl = dailyToday(slug);
  /* At 100% the interview has nothing left to ask, so the strip goes, unless today's log runs. */
  if (ivDone(iv) && !dl?.on){ bar.hidden = true; bar.innerHTML = ""; bar.dataset.key = ""; return; }
  /* The bar repaints on every focus change: a strip rebuilt under a click
     would lose it, so it is drawn again only when what it says changes. */
  const busy = chatBusy();
  const key = JSON.stringify([slug, !!iv?.on, iv?.pct, iv?.seen, iv?.chapter?.at, busy, !!dl?.on, dl?.seen]);
  if (bar.dataset.key === key && bar.children.length) return;
  bar.dataset.key = key;
  bar.innerHTML = "";
  bar.classList.toggle("on", !!iv?.on || !!dl?.on);
  /* Today's log under way has the strip to itself. */
  if (dl?.on){ dailyStrip(bar, slug, dl, busy); return; }
  if (iv?.on){
    const ch = iv.chapter;
    const live = el("span","iv-live");
    live.append(el("i","iv-dot"), el("b",null,"Interview"));
    if (ch) live.append(el("span","iv-at",`${ch.title} · ${Math.min(ch.at + 1, ch.total)} of ${ch.total}`));
    const track = el("span","iv-track"); const fill = el("i"); fill.style.width = `${Math.max(2, iv.pct)}%`; track.append(fill);
    track.title = `Your twin is ${iv.pct}% complete`;
    const skip = el("button","iv-b","Skip"); skip.type = "button"; skip.id = "ivSkip"; skip.disabled = busy;
    skip.title = "Pass this question";
    skip.onclick = () => { if (chatBusy()) return; $("input").value = "skip"; go(); };
    const stop = el("button","iv-b stop","Stop"); stop.type = "button"; stop.id = "ivStop"; stop.disabled = busy;
    stop.title = "Pause the interview. It picks up where you left off.";
    stop.onclick = () => stopInterview(slug);
    bar.append(live, track, skip, stop);
  } else {
    const goB = el("button","iv-go"); goB.type = "button"; goB.id = "ivGo"; goB.disabled = busy;
    goB.title = "It asks you questions, one at a time, to know you better. Stop any time.";
    goB.innerHTML = IC_IV;
    goB.append(el("span",null, iv?.seen ? "Resume the interview" : "Interview me"));
    if (iv) goB.append(el("small",null,`twin ${iv.pct}%`));
    goB.onclick = () => startInterview(slug);
    if (!ivDone(iv)) bar.append(goB);
  }
}

/** On, in the chat on screen, and its next question. */
async function startInterview(slug){
  if (chatBusy() || !isPersonal(slug)) return;
  if (S.scope !== slug){ crossing(slug); S.picks = []; S.scope = slug; S.into = []; }
  S.mode = "ask"; S.folder = null; S.concept = null;
  render();
  const job = addJob("", null, "Picking a question");
  job.body = thinking(job.label);
  renderComposer();
  try {
    const r = await api("/api/interview", { action: "start", brain: slug, chat: S.chatId, history: S.thread.slice(-4) });
    const here = landed(job, r);
    if (job.body.isConnected){ job.body.innerHTML = ""; showAnswer(job.body, r, "", slug); }
    if (r.interview) S.iv[slug] = r.interview;
    /* One at a time: the interview pauses today's log. */
    if (S.daily[slug]?.on) S.daily[slug] = { ...S.daily[slug], on: false };
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

/** Paused where it stands, with no model call. */
async function stopInterview(slug){
  if (chatBusy()) return;
  try {
    const r = await api("/api/interview", { action: "stop", brain: slug });
    S.iv[slug] = r.interview; S.ivFull[slug] = r;
    push("ai", b => { b.append(el("div","iv-note", r.answer || "Paused.")); });
  } catch (e) { push("ai", b => { b.append(el("div","err", e.message)); }); }
  renderComposer(); bottom();
}

/**
 * The answer arrives as one sentence per line, which is what the prompt asks
 * for. Each line becomes its own block, so the gap between sentences is a
 * setting rather than whatever a line break happens to give.
 *
 * A blank line in the answer starts a new group, with a wider gap.
 */
function splitAnswer(t){
  const m = String(t).match(/\n\s*(Sources:[^\n]*)\s*$/i);
  const body = m ? String(t).slice(0, m.index) : String(t);
  const fmt = l => esc(l).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  /* Each line on its own: one after # to ### is a heading, lines after * or - are a list. */
  const html = body.split(/\n{2,}/).map(group => {
    let out = "", items = [];
    const flush = () => { if (items.length) out += `<ul class="md-ul">${items.map(x => `<li>${fmt(x)}</li>`).join("")}</ul>`; items = []; };
    for (const l of group.split("\n").map(l => l.trim()).filter(Boolean)){
      const h = MD_HEAD.exec(l), b = MD_ITEM.exec(l);
      if (b){ items.push(b[1]); continue; }
      flush();
      out += h ? `<div class="md-h md-h${h[1].length}">${fmt(h[2])}</div>` : `<p class="ln">${fmt(l)}</p>`;
    }
    flush();
    return out ? `<div class="para">${out}</div>` : "";
  }).filter(Boolean).join("");
  return html + (m ? `<div class="srcline">${esc(m[1])}</div>` : "");
}

/* ---------- did the read keep everything? ----------
   Every number, date and name of a part is looked for in what the read kept.
   Numbers compare by value, so 1,000 and 1 000 and 1k are one number, and
   "5 million" is 5,000,000. Names compare by their longest word. */
const SCALES = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, mio: 1e6, millions: 1e6, billion: 1e9, bn: 1e9, b: 1e9, milliard: 1e9,
  milliards: 1e9, billions: 1e9, trillion: 1e12, tn: 1e12, mille: 1e3, md: 1e9, mds: 1e9 };
const NOT_NAMES = new Set("the this that these those there then they their when where what which while with from into over under after before during about also however monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december les des une est dans pour avec mais sur par i'm i've i'll i'd it's i’m i’ve i’ll i’d it’s".split(" "));
function numberValue(tok, scale){
  let t = tok.replace(/[\s\u00a0\u202f]/g, "");
  const dot = t.lastIndexOf("."), comma = t.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) t = dot > comma ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  else if (dot >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, "");
  const v = parseFloat(t) * (SCALES[String(scale || "").toLowerCase()] || 1);
  return isFinite(v) ? Number(v.toPrecision(6)) : null;
}
/** The numbers of a text by value, each with how it was written. */
function numbersOf(text){
  const out = new Map();
  /* A timestamp of a pasted transcript is a place in the video, not a fact. */
  text = String(text).replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
  const re = /(\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*)(?:\s?(thousand|k|millions?|m|mn|mio|billions?|bn|b|milliards?|trillion|tn|mille|mds?)\b)?/gi;
  for (const m of String(text).matchAll(re)){
    const digits = m[1].replace(/\D/g, "");
    if (digits.length < 2 && !m[2]) continue;
    const v = numberValue(m[1], m[2]);
    if (v !== null && !out.has(v)) out.set(v, m[0].trim());
  }
  return out;
}
/** The names of a text: capitalised words inside a sentence. Too many, as in German, and none are counted. */
function namesOf(text){
  const out = new Map(), words = (String(text).match(/\S+/g) || []).length;
  let seen = 0;
  const re = /(?<![.!?:;"«“\n]\s{0,3})(?<=\s)([A-ZÀ-Ý][a-zà-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][a-zà-ÿ'’-]{2,})*)/g;
  for (const m of String(text).matchAll(re)){
    const name = m[1].trim(), key = name.toLowerCase();
    seen++;
    if (NOT_NAMES.has(key) || out.has(key)) continue;
    out.set(key, name);
  }
  /* A language that capitalises every noun, as German does, names nothing this way. */
  return words > 60 && seen > words * 0.12 ? new Map() : out;
}
/** What a read kept, as one text. */
function partText(p){
  return [p.title, p.author, ...(p.topics || []).flatMap(t => [t.topic, ...(t.ideas || []), ...(t.data || [])]),
    ...(p.quotes || []).map(q => `${q.text || ""} ${q.speaker || ""}`), ...(p.thin || [])].join("\n");
}
/** The numbers, dates and names of a part that the read never mentions. */
function factsLeft(chunk, part){ return factsIn(chunk, partText(part)); }
/** The numbers, dates and names of a text that what was kept never mentions. */
function factsIn(chunk, kept){
  kept = String(kept || "");
  const keptNums = numbersOf(kept), low = kept.toLowerCase();
  const nums = numbersOf(chunk), names = namesOf(chunk);
  const missing = [];
  for (const [v, said] of nums) if (!keptNums.has(v)) missing.push(said);
  for (const [, name] of names){
    const long = name.split(/\s+/).sort((a, b) => b.length - a.length)[0].toLowerCase();
    if (!low.includes(long)) missing.push(name);
  }
  return { facts: nums.size + names.size, missing };
}
/** The sentences of a part that hold what the read left out, in order. */
function gapPassages(chunk, missing, limit = 9000){
  const sentences = String(chunk).split(/(?<=[.!?])\s+|\n+/);
  const out = []; let used = 0;
  for (const s of sentences){
    if (!missing.some(f => s.includes(f))) continue;
    if (used + s.length > limit) break;
    out.push(s.trim()); used += s.length + 1;
  }
  return out.join("\n");
}
/** One more read of what a part left out, folded into the part. Its count goes on the card. */
async function fillGaps(chunk, part, i, total){
  let left = factsLeft(chunk, part);
  if (left.missing.length >= 2){
    const passages = gapPassages(chunk, left.missing);
    if (passages){
      try {
        const more = (await apiRetry("/api/drop/read", { chunk: passages, part: i + 1, total, gaps: true }, { split: true })).part || {};
        part = { ...part, topics: [...(part.topics || [])], quotes: [...(part.quotes || []), ...(more.quotes || [])], thin: [...(part.thin || []), ...(more.thin || [])] };
        for (const t of more.topics || []){
          const had = part.topics.find(x => String(x.topic).toLowerCase() === String(t.topic).toLowerCase());
          if (had) Object.assign(had, { ideas: [...(had.ideas || []), ...(t.ideas || [])], data: [...(had.data || []), ...(t.data || [])] });
          else part.topics.push(t);
        }
        left = factsLeft(chunk, part);
      } catch { /* the passages go in as they are, below */ }
    }
  }
  /* What is still missing goes in word for word, so it is filed with the rest. */
  if (left.missing.length){
    const rest = gapPassages(chunk, left.missing).split("\n").filter(Boolean);
    if (rest.length) part = { ...part, topics: [...(part.topics || []), { topic: total > 1 ? `More from part ${i + 1} of the source` : "More from the source", ideas: rest }] };
  }
  return { ...part, cover: { facts: left.facts } };
}

/* ---------- drop ---------- */
async function doDrop(src, content, again){
  /* The link decides whether the source can be opened, and it is what catches a
     repeat later. It is read from the source line, or from the content when the
     content opens with it, the way a pasted transcript does. A link deeper in a
     document, a licence or a footnote, is not the document. */
  const link = (src.match(/https?:\/\/\S+/)||[])[0] || (content.match(/^\s*(https?:\/\/\S+)/)||[])[1] || "";
  let bodyTxt = content || null;
  const said = src || link || content.slice(0, 120);
  const words = t => (t.match(/\S+/g)||[]).length.toLocaleString();
  if (!again) dsays(said, content ? `${words(content)} words` : null);

  if (!S.brains.length){
    dpush("ai", b => { b.innerHTML = rich("Create a folder first. A source needs a scope to be filed against."); });
    return;
  }

  let chk;
  const body = dthinking("Checking for a repeat");
  /* With no link, the source is its name and a fingerprint of its text: the
     same document dropped twice is caught, two documents named alike are not. */
  const fp = bodyTxt ? "#" + fnv(bodyTxt) : "";
  try { chk = await api("/api/drop/check", { link, text: [src, fp].filter(Boolean).join(" ") || content }); }
  catch(e){ fail(body, e.message); return; }

  /* Already held somewhere. That is worth knowing, not a reason to stop: the
     same source often belongs in a second brain. Reusing the extraction it
     already gave up means the second filing reads nothing. */
  if (chk.duplicate && !again){
    const names = (chk.brains||[]).map(x => S.brains.find(y=>y.slug===x)?.name || x);
    body.innerHTML = "";
    body.innerHTML = rich(
      `**Already stored** as \`${esc(chk.sid)}\`, filed ${esc(chk.date||"earlier")} into ` +
      `**${esc(names.join(", ")||"no folder")}**.\n\n` +
      `Filing it into another folder reuses what it already gave up, so nothing gets read twice.`);
    const row = el("div"); row.style.cssText = "display:flex;gap:8px;margin-top:14px";
    const go = el("button","go","File it elsewhere");
    const no = el("button","ghost","Stop");
    no.onclick = () => {
      row.remove(); dropState(null);
      dpush("ai", b => { b.innerHTML = rich("Stopped. Nothing was read and no position moved."); });
    };
    go.onclick = async () => {
      go.disabled = no.disabled = true; row.remove();
      dropState("running");
      const b2 = dthinking("Reading back what it already gave up");
      try {
        let got;
        try { got = await api("/api/drop/again", { sid: chk.sid }); }
        catch(e){ fail(b2, e.message); return; }
        if (got.error){ fail(b2, got.error); return; }
        await planAndCard(b2, chk.sid, chk.link || link, got.ext, 0, chk.brains || []);
      } finally { dropSettled(); }
    };
    /* A source filed under older rules, or filed thinly, deserves a second
       read into the same brain. It needs the text, which a link fetches again
       and pasted text or a document still holds. */
    const redo = el("button","ghost","Read it again here");
    redo.title = "Reads the source again with the current rules and files it into the folder you picked.";
    const text = bodyTxt;
    redo.onclick = async () => {
      row.remove();
      if (S.dropBusy) return;
      S.dropBusy = true; dropState("running", src || said); renderComposer();
      try { await doDrop(src, text || "", true); }
      finally { S.dropBusy = false; dropSettled(); renderComposer(); }
    };
    row.append(go, redo, no); body.append(row);
    return;
  }

  /* A link and no content. The server opens the page, or fetches the transcript
     when it is a video, so pasting is only needed when the text sits somewhere a
     fetch cannot reach. The duplicate check already ran, so a repeat costs
     nothing here. */
  if (!bodyTxt && !link){
    body.innerHTML = "";
    body.innerHTML = rich(
      "**That source has no content.** A link gets opened for you, video or article. " +
      "Anything else needs the text pasted, or a document dropped in.");
    return;
  }
  if (!bodyTxt){
    setThinking(body, "Opening the link");
    let got;
    try { got = await api("/api/fetch", { url: link }); }
    catch(e){ got = { error: e.message }; }

    if (got && got.text){
      bodyTxt = got.text;
    } else {
      body.innerHTML = "";
      body.innerHTML = rich(`**That page needs pasting.** ${esc((got && got.error) || "It gave nothing back.")}`);
      const go = el("button","go","Paste the text");
      go.style.marginTop = "12px"; go.onclick = pasteHere; body.append(go);
      return;
    }
  }

  const CH = S.chunk, chunks = [];
  for (let i=0; i<bodyTxt.length; i+=CH) chunks.push(bodyTxt.slice(i,i+CH));
  /* The passes are independent, so three run at once, the way storing does.
     A 500 page document is about 67 passes: under 20 minutes this way, near an
     hour one at a time. Each part keeps its place, so the order holds. */
  const parts = new Array(chunks.length);
  let nextRead = 0, readDone = 0, readErr = null;
  setThinking(body, chunks.length>1 ? `Reading, pass 0 of ${chunks.length}` : "Reading the source");
  /* A pass the model runs out of time on is read again as two halves, cut at a
     paragraph or a sentence, and the halves read as one part. */
  const readText = async (text, i) => {
    try { return (await apiRetry("/api/drop/read", { chunk: text, part: i+1, total: chunks.length }, { split: true })).part || {}; }
    catch (e) {
      if (!tooBig(e) || text.length < 3000) throw e;
      const mid = text.length >> 1;
      const at = [text.lastIndexOf("\n\n", mid + 2000), text.lastIndexOf(". ", mid + 2000)].find(x => x > mid - 2000) ?? mid;
      const cut = at > 0 ? at + 1 : mid;
      const [a, b] = [await readText(text.slice(0, cut), i), await readText(text.slice(cut), i)];
      return { ...b, ...a, topics: [...(a.topics || []), ...(b.topics || [])],
               quotes: [...(a.quotes || []), ...(b.quotes || [])], thin: [...(a.thin || []), ...(b.thin || [])] };
    }
  };
  const reader = async () => {
    while (nextRead < chunks.length && !readErr){
      const i = nextRead++;
      try {
        parts[i] = await readText(chunks[i], i);
        /* Every number, date and name of the part checked against what was
           read; the passages holding the ones left out are read once more. */
        parts[i] = await fillGaps(chunks[i], parts[i], i, chunks.length);
        if (chunks.length > 1) setThinking(body, `Reading, pass ${++readDone} of ${chunks.length}`);
      } catch(e){ readErr = readErr || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, reader));
  if (readErr){ fail(body, readErr.message); return; }

  const ext = {
    title: parts.find(p=>p.title)?.title || src || link || "Untitled source",
    author: parts.find(p=>p.author)?.author || "",
    date: parts.find(p=>p.date)?.date || "",
    /* What the passes agreed the source is: study material or an argument. */
    kind: (() => {
      const n = { study: 0, argument: 0 };
      for (const p of parts) if (n[p.kind] !== undefined) n[p.kind]++;
      return n.study || n.argument ? (n.study >= n.argument ? "study" : "argument") : "";
    })(),
    topics: parts.flatMap(p=>p.topics||[]),
    quotes: parts.flatMap(p=>p.quotes||[]),
    thin: parts.flatMap(p=>p.thin||[]),
    /* What the reads kept of the source: its words, and its numbers, dates
       and names found again in the extraction. Shown on the card, never stored. */
    cover: { words: (bodyTxt.match(/\S+/g) || []).length,
      facts: parts.reduce((n, p) => n + (p.cover?.facts || 0), 0) },
  };
  /* A YouTube video is filed under its channel, whoever speaks in it. */
  if (chk.channel) ext.author = chk.channel;

  /* An extraction with no topics means the read came back empty, which is a
     different thing from a source that holds nothing. Left alone, the plan runs
     on nothing and the card reads "nothing new", which blames the source. */
  if (!ext.topics.length){
    body.innerHTML = "";
    body.innerHTML = rich(
      `**The read came back empty.** ${Math.round(bodyTxt.length/1000)}k characters went in and no topic came out.\n\n` +
      `Auto-captions with no punctuation are the usual cause. Paste the transcript from the video's own panel, which carries line breaks.`);
    const go = el("button","go","Paste the text");
    go.style.marginTop = "12px"; go.onclick = pasteHere; body.append(go);
    return;
  }

  await planAndCard(body, chk.sid, link, ext, bodyTxt.length);
}

/**
 * The plan and the card, from an extraction however it arrived: read just now,
 * or reused from a source already stored.
 *
 * `held` names the brains that already carry it, which the plan leaves out so
 * it proposes somewhere new rather than rewriting positions with a source they
 * already hold.
 */
