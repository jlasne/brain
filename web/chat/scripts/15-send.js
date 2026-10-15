/* 15-send.js: Sending: a question, a drop or a personal message, from the chat bar. */

/* ============ go ============ */
async function go(){
  if (S.mode === "drop" ? S.dropBusy : chatBusy()) return;
  /* Late words from the mic would land in the box after it was cleared. */
  if (listeningIn(mainBar)) endVoice();
  const text = $("input").value.trim();
  const src = $("srcInput").value.trim();
  if (S.mode === "drop" ? !hasContent(src, text) : !text) return;
  $("input").value = ""; sizeBox();
  if (S.mode === "drop") $("srcInput").value = "";
  /* A question asked from an open folder starts a chat on that folder. */
  if (S.mode !== "drop" && S.folder){ S.folder = null; if (S.chatId) newChat(); else renderView(); }
  /* A drop runs on, whatever is on screen: one at a time, and the chat stays free. */
  const drop = S.mode === "drop";
  if (drop){ S.dropBusy = true; dropState("running", src || text.slice(0, 80)); }
  renderComposer();
  try { drop ? await doDrop(src, text) : await doAsk(text); }
  finally {
    if (drop){ S.dropBusy = false; dropSettled(); }
    renderComposer();
    /* A drop that ended without a card leaves no step running. */
    if (!S.dropBusy && !S.pendingCard && !/^Card ready /.test(document.title)) tabTitle("");
  }
}

/* ---------- ask ---------- */
async function doAsk(q, again){
  /* Try again sends the same message into the message that failed. */
  if (!again) says(q);
  if (!S.brains.length){
    push("ai", b => { b.innerHTML = rich("No folders exist yet, so there is nothing to read. Create one, drop a few sources, then ask again."); });
    return;
  }
  /* It runs on if another chat, a folder or Drop opens: the answer lands in
     its own chat, and the inbox says it is there. */
  const about = S.concept, scope = S.scope, picks = S.picks.slice();
  const asked = about ? about.brain : picks.length > 1 ? picks.join(",") : scope;
  const job = addJob(q, about);
  if (again){ again.innerHTML = ""; thinkInto(again); job.body = again; } else job.body = thinking();
  try {
    /* "chat" files the turn in the chat on screen, or starts one. A chat
       about one concept sends that concept alone. */
    const named = about || S.iv[scope]?.on || dailyToday(scope)?.on ? [] : tagsIn(q, tagChoices(isPersonal(scope)));
    /* An asset tagged travels apart from the folders: the message reads it, and may propose a change to it. */
    const tags = named.filter(t => !t.startsWith("asset:"));
    /* The assets it names, then the ones ticked in the picker: four at most. */
    const assets = about || isPersonal(scope) ? [] : [...new Set([...named.filter(t => t.startsWith("asset:")).map(t => Number(t.slice(6))), ...S.assetPicks])].slice(0, 4);
    const r = await api("/api/ask", about
      ? { q, concept: about.id, history: S.thread.slice(-4), chat: S.chatId }
      : { q, brain: scope, ...(picks.length > 1 ? { brains: picks } : {}), ...(tags.length ? { tags } : {}), ...(assets.length ? { assets } : {}), level: S.level, history: S.thread.slice(-4), chat: S.chatId });
    const here = landed(job, r);
    if (job.body.isConnected){ job.body.innerHTML = ""; showAnswer(job.body, r, q, asked, true); }
    if (r.interview && isPersonal(scope)) S.iv[scope] = r.interview;
    if (r.daily && isPersonal(scope)) S.daily[scope] = r.daily;
    if ((r.filed && (r.filed.new || r.filed.updated)) || r.changed) refresh().catch(() => {});
    /* Six turns is what a thread of follow-ups runs to before the subject has
       moved anyway. Only the last four travel. */
    /* What the answer opened travels back with the next question, so a follow-up keeps its subject. */
    if (here){
      S.thread.push({ q, a: String(r.answer ?? ""), ...(Array.isArray(r.opened) && r.opened.length ? { opened: r.opened.slice(0, 12) } : {}) });
      if (S.thread.length > 6) S.thread = S.thread.slice(-6);
    }
    endJob(job, true);
    renderComposer();
    if (here) bottom();
  } catch(e){
    const where = about ? "chat about one concept" : isPersonal(scope) ? (S.iv[scope]?.on ? "interview" : dailyToday(scope)?.on ? "daily log" : "personal chat") : "chat";
    if (job.body.isConnected) fail(job.body, e.message, { q, where, scope,
      retry: () => { if (chatBusy()) return; doAsk(q, job.body).finally(renderComposer); renderComposer(); } });
    job.error = e.message; endJob(job, false); renderComposer();
  }
}
/**
 * An answer on screen, live or from a saved chat: the small-brain note, the
 * answer and its one action.
 */
function showAnswer(body, r, q, asked, fresh){
  if (r.sources > 0 && r.sources < 10)
    body.append(el("div","smallbrain",`Small folder: ${r.sources} source${r.sources===1?"":"s"} behind this`));
  /* An answer about assets is Markdown laid out to scan: headings, bullets, tables. Every other answer reads a line at a time. */
  const md = Array.isArray(r.assets) && r.assets.length;
  const out = el("div", md ? "pj-md as-answer" : null); out.innerHTML = md ? mdView(r.answer ?? r.a ?? "") : splitAnswer(r.answer ?? r.a ?? ""); body.append(out);
  /* The folders the message tagged were read. A personal reply says it in its own line, below. */
  if (!r.personal && Array.isArray(r.tagged) && r.tagged.length) body.append(el("div","filed called",`Read ${r.tagged.map(n => "@" + n).join(", ")}`));
  /* The assets it read, and what it proposes to change or to make: nothing happens before Apply. */
  if (Array.isArray(r.assets) && r.assets.length){
    body.append(el("div","filed called",`Read ${r.assets.map(n => "@" + n).join(", ")}`));
    assetCards(body, r, !!fresh);
  }
  /* One small action: the same question as a one-pager. */
  const acts = el("div","ans-acts");
  const pg = el("button","mini","One-pager from this");
  pg.onclick = () => openPagerSheet({ q, pick: asked });
  /* A chat about one concept: what it wrote to it, and the way to it. */
  if (r.changed){
    const f = el("div","filed", changedLine(r.changed));
    const id = typeof r.concept === "string" ? r.concept : r.concept?.id;
    const fb = id && S.brains.find(x => x.slug === id.split("/")[0]);
    if (fb){
      const op = el("button","mini keep","Open it"); op.type = "button";
      op.onclick = () => openFolder(fb, id);
      f.append(op);
    }
    body.append(f);
  }
  if (r.concept) return;
  /* A video script: one tap copies it. */
  if (r.script){ scriptActs(body, r, asked); return; }
  if (r.filed){
    const line = filedLine(r.filed);
    if (line){
      const f = el("div","filed",line); f.title = (r.filed.titles || []).join(", ");
      /* Not filed: one tap files the message again, people and all. */
      if (r.filed.failed && q && isPersonal(asked) && !S.demo){
        const keep = el("button","mini keep","Keep it"); keep.type = "button";
        keep.onclick = async () => {
          keep.disabled = true; keep.textContent = "Filing";
          try {
            const res = await api("/api/personal/remember", { brain: asked, text: q, kind: "chat" });
            f.textContent = filedLine(res.filed || {}) || "Nothing in it to file.";
            f.classList.add("kept");
            refresh().catch(() => {});
          } catch (e) { keep.disabled = false; keep.textContent = "Try again"; keep.title = e.message; }
        };
        f.append(keep);
      }
      body.append(f);
    }
    const call = calledLine(r.called);
    if (call) body.append(el("div","filed called",call));
    return;
  }
  acts.append(pg);
  /* A question that names an asset without @: one tap asks it again with the asset called. */
  const hint = !r.assets?.length ? assetHint(q) : null;
  if (hint) acts.append(hint);
  body.append(acts);
}

/** What a chat about one concept wrote to it, in a few words. */
function changedLine(c){
  const parts = [c.summary ? "card rewritten" : "",
    c.added ? `${c.added} line${c.added === 1 ? "" : "s"} added` : "",
    c.removed ? `${c.removed} taken out` : ""].filter(Boolean);
  return `Saved to ${c.title}${parts.length ? ": " + parts.join(" · ") : ""}`;
}

/** The other brains a personal reply reached for on its own, or nothing. */
function calledLine(names){
  const n = (Array.isArray(names) ? names : []).map(String).filter(Boolean);
  if (!n.length) return "";
  return n.length === 1 ? `Called your ${n[0]} folder` : `Called your ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]} folders`;
}

/** What a personal reply filed, in a few words, or nothing when it filed nothing. */
function filedLine(f){
  if (f.failed) return "Not filed this time. Say it again to keep it.";
  const n = f.new || 0, u = f.updated || 0;
  const news = n ? `${n} new note${n === 1 ? "" : "s"}` : "", ups = u ? `${u} note${u === 1 ? "" : "s"} updated` : "";
  const notes = [news, ups].filter(Boolean).join(", ");
  /* The people it heard about, each on their own card. */
  const ppl = [...new Set((f.people || []).map(String))];
  const who = ppl.length > 3 ? `${ppl.slice(0, 3).join(", ")} and ${ppl.length - 3} more` : ppl.join(", ");
  const parts = [notes, who ? `Contact${ppl.length === 1 ? "" : "s"}: ${who}` : ""].filter(Boolean);
  return parts.length ? "Filed: " + parts.join(" · ") : "";
}

