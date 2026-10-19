/* 17-drop.js: A drop: long sources read in parts, planned, checked and stored. */

/* ============ long sources, in batches ============ */

/* One model call per request, and each call has to finish inside the server's
   150 second deadline. A 229 topic document planned in one call was cut to its
   first 30,000 characters, and 36 positions rewritten in one call ran out of
   time. Both now go in batches, sized from what was measured. */
const PLAN_TOPICS = 25, PLAN_CHARS = 20000;
const STORE_BATCH = 8, STORE_PARALLEL = 3;
/* Parts of a long source planned at the same time, after the first. */
const PLAN_PARALLEL = 3;

const topicText = t => `### ${t.topic}\n${(t.ideas||[]).join("\n")}\n${(t.data||[]).join("\n")}`;

/** The topics, cut into batches the plan reads whole. */
function topicBatches(topics){
  const out = []; let cur = [], size = 0;
  for (const t of topics){
    const n = topicText(t).length;
    if (cur.length && (cur.length >= PLAN_TOPICS || size + n > PLAN_CHARS)){ out.push(cur); cur = []; size = 0; }
    cur.push(t); size += n;
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [[]];
}

const unitKey = (brain, title) => `${brain}/${conceptSlug(title)}`;

/**
 * The whole source planned, a batch at a time, merged into one plan.
 *
 * Batches run in order, and each sees the titles proposed before it, so an
 * idea that recurs through the document is filed under one name.
 */
async function planAll(ext, held, progress){
  /* A stored extraction keeps its kind with the note's findings. */
  if (!ext.kind && ext.findings && ext.findings.kind) ext = { ...ext, kind: ext.findings.kind };
  /* Each topic keeps its place, so the plan's "from" says where every one
     went. An opinion with nothing behind it is a topic too: everything is filed. */
  const topics = [...(ext.topics || []), ...(ext.thin || []).filter(Boolean).map(x => ({ topic: String(x).split(/\s+/).slice(0, 10).join(" "),
    ideas: [`${x} (asserted, with nothing behind it)`] }))].map((t, i) => ({ ...t, _i: i }));
  ext = { ...ext, topics };
  const placed = new Set(), untracked = new Set();
  const batches = topicBatches(topics);
  const merged = { brains: [], matched: [], candidates: [], new: [], echo: [], conflicts: [] };
  const seenM = new Set(), seenC = new Set(), seenX = new Set();
  const addMatched = m => {
    const had = merged.matched.find(x => x.conceptId === m.conceptId);
    if (!had){ seenM.add(m.conceptId); merged.matched.push({ ...m }); return; }
    if (m.whatItAdds) had.whatItAdds = `${had.whatItAdds || ""} ${m.whatItAdds}`.trim().slice(0, 600);
    if (m.related) had.related = [...new Set([...(had.related || []), ...m.related])];
  };
  const heldConcept = (brain, title) => {
    const id = conceptSlug(title), t = String(title || "").trim().toLowerCase();
    return S.concepts.find(x => x.brain === brain && (x.slug === id || String(x.title || "").trim().toLowerCase() === t));
  };
  /* A part the model runs out of time on is planned again as two halves, and
     both plans are absorbed. */
  const planOne = i => planTopics(batches[i]);
  const planTopics = topics => planCall(topics).then(p => [p]).catch(async e => {
    if (!tooBig(e) || topics.length < 2) throw e;
    const h = Math.ceil(topics.length / 2);
    return [...await planTopics(topics.slice(0, h)), ...await planTopics(topics.slice(h))];
  });
  const planCall = (topics, again) => apiRetry("/api/drop/plan", {
      ext: { ...ext, topics },
      /* Several brains ticked: the plan feeds each one. None: it picks. */
      ...(S.into.length > 1 ? { brains: S.into } : { brain: S.into[0] || "all" }),
      ...(held && held.length ? { exclude: held } : {}),
      ...(merged.candidates.length ? { proposed: merged.candidates.map(c => `${c.brain} | ${c.title}`) } : {}),
      ...(again ? { again: true } : {}),
    }, { split: topics.length > 1 }).then(r => ({ ...(r.plan || {}), _topics: topics }));
  /* Where each topic of a batch went: T3 is the batch's third. A plan that
     names none of its topics leaves them untracked, never counted as lost. */
  const mark = p => {
    const ts = p._topics || [];
    const at = l => { const m = String(l ?? "").match(/(\d+)/); return m ? ts[Number(m[1]) - 1]?._i : undefined; };
    let named = false;
    for (const x of [...(p.matched || []), ...(p.candidates || [])])
      for (const l of Array.isArray(x.from) ? x.from : []){ const i = at(l); if (i !== undefined){ placed.add(i); named = true; } }
    if (!named && ((p.matched || []).length || (p.candidates || []).length)) for (const t of ts) untracked.add(t._i);
  };
  const absorb = p => {
    mark(p);
    for (const b of p.brains || []) if (!merged.brains.includes(b)) merged.brains.push(b);
    for (const m of p.matched || []) addMatched(m);
    for (const c of p.candidates || []){
      /* A "new" idea the brain already holds under that title is a match: filed
         as a candidate, it reached the same concept twice and one write lost
         the other's evidence. */
      const known = heldConcept(c.brain, c.title);
      if (known){ addMatched({ conceptId: `${known.brain}/${known.slug}`, brain: known.brain, whatItAdds: c.why, related: c.related }); continue; }
      const k = unitKey(c.brain, c.title);
      if (seenM.has(k)){ addMatched({ conceptId: k, whatItAdds: c.why, related: c.related }); continue; }
      if (seenC.has(k)){
        /* Proposed again by a later batch: what that batch saw joins it. */
        const had = merged.candidates.find(x => unitKey(x.brain, x.title) === k);
        if (had && c.why) had.why = `${had.why || ""} ${c.why}`.trim().slice(0, 600);
        if (had && c.related) had.related = [...new Set([...(had.related || []), ...c.related])];
        continue;
      }
      seenC.add(k); merged.candidates.push({ ...c });
    }
    merged.new.push(...(p.new || []));
    merged.echo.push(...(p.echo || []));
    for (const x of p.conflicts || []){
      const k = `${x.conceptId || `${x.brain}/${x.concept}`}|${x.says || ""}`;
      if (seenX.has(k)) continue;
      seenX.add(k); merged.conflicts.push(x);
    }
  };

  /* The first part alone, so its titles are the vocabulary the others reuse.
     Then three parts at a time, each seeing every title proposed before its
     group: a 207 page source plans in about a third of the time. */
  let done = 0;
  const tick = () => { if (batches.length > 1) progress(++done, batches.length); };
  for (const p of await planOne(0)) absorb(p);
  tick();
  for (let i = 1; i < batches.length; i += PLAN_PARALLEL){
    const group = await Promise.all(batches.slice(i, i + PLAN_PARALLEL).map((_, k) => planOne(i + k).then(p => { tick(); return p; })));
    for (const ps of group) for (const p of ps) absorb(p);
  }

  /* Every topic lands in a concept. The ones placed nowhere are planned once
     more, on their own; any still left becomes a new concept of its own, in
     the folder the source goes to. */
  const lost = () => topics.filter(t => !placed.has(t._i) && !untracked.has(t._i));
  if (lost().length && topics.length){
    try { absorb(await planCall(lost(), true)); }
    catch (_) { /* filed as they are, below */ }
  }
  const home = merged.brains[0] || S.into[0] || S.brains.find(b => b.type !== "personal" && !readOnly(b))?.slug;
  const rest = lost();
  if (rest.length && home){
    if (!merged.brains.includes(home)) merged.brains.push(home);
    absorb({ candidates: rest.map(t => ({ title: String(t.topic || "").slice(0, 90), brain: home,
      why: [...(t.ideas || []), ...(t.data || [])].join(" ").slice(0, 600), related: [], from: ["T" + (t._i + 1)] })),
      _topics: topics });
  }
  merged._cover = { topics: topics.length, untracked: untracked.size };

  /* Parts planned side by side cannot see each other's titles, and a part
     can propose a new concept for an idea a folder holds in other words or in
     another language. One call reads the new titles beside the closest ones
     held: twins fold into one, an idea already held joins its concept, and a
     title not in English gets its English one. If it fails, nothing changes. */
  if (merged.candidates.length){
    try {
      const sent = merged.candidates.slice();
      const r = await api("/api/drop/merge", {
        candidates: sent.map(c => ({ brain: c.brain, title: c.title, why: c.why || "" })) });
      /* Where a title went: another title, or a concept already held. */
      const to = new Map();
      const point = (x, where) => {
        for (const k of [`${x.brain}/${x.title}`, x.title, `${x.brain}/${conceptSlug(x.title)}`]) to.set(k, where);
      };
      const gone = new Set();
      for (const g of r.same || []){
        const keep = sent[g[0]];
        if (!keep) continue;
        for (const j of g.slice(1)){
          const x = sent[j];
          if (!x || x === keep || x.brain !== keep.brain || gone.has(x)) continue;
          keep.why = `${keep.why || ""} ${x.why || ""}`.trim().slice(0, 600);
          keep.related = [...new Set([...(keep.related || []), ...(x.related || [])])];
          gone.add(x); point(x, `${keep.brain}/${keep.title}`);
        }
      }
      for (const { i, id } of r.into || []){
        const x = sent[i];
        if (!x || gone.has(x) || !S.concepts.some(c => `${c.brain}/${c.slug}` === id)) continue;
        addMatched({ conceptId: id, brain: x.brain, whatItAdds: x.why, related: x.related });
        gone.add(x); point(x, id);
      }
      for (const { i, title } of r.english || []){
        const x = sent[i];
        if (!x || gone.has(x)) continue;
        /* The English title may already be a concept, or another new one. */
        const known = heldConcept(x.brain, title);
        const twin = merged.candidates.find(c => c !== x && !gone.has(c) && unitKey(c.brain, c.title) === unitKey(x.brain, title));
        if (known){
          addMatched({ conceptId: `${known.brain}/${known.slug}`, brain: known.brain, whatItAdds: x.why, related: x.related });
          gone.add(x); point(x, `${known.brain}/${known.slug}`);
        } else if (twin){
          twin.why = `${twin.why || ""} ${x.why || ""}`.trim().slice(0, 600);
          twin.related = [...new Set([...(twin.related || []), ...(x.related || [])])];
          gone.add(x); point(x, `${twin.brain}/${twin.title}`);
        } else {
          point(x, `${x.brain}/${title}`);
          x.title = title;
        }
      }
      if (to.size){
        /* Links that named an old title now name where it went, so none
           points at a concept that will never exist. */
        const remap = l => [...new Set((l || []).map(r => to.get(r) ?? r))];
        merged.candidates = merged.candidates.filter(c => !gone.has(c));
        for (const c of merged.candidates) if (c.related) c.related = remap(c.related);
        for (const m of merged.matched) if (m.related) m.related = remap(m.related);
      }
    } catch (_) {}
  }

  /* A ruling only lands on a concept this drop rewrites, so every concept a
     conflict names is rewritten. */
  for (const x of merged.conflicts){
    const c = x.conceptId && S.concepts.find(y => `${y.brain}/${y.slug}` === x.conceptId);
    if (c && !seenM.has(x.conceptId)) addMatched({ conceptId: x.conceptId, brain: c.brain, whatItAdds: x.says || "" });
  }
  return merged;
}

/**
 * Store a drop, a part at a time, in one press.
 *
 * What is stored is tracked by concept, not by part, so a part the model runs
 * out of time on is split in two and both halves go on their own, down to one
 * concept, with nothing written twice. A press after a real failure picks up
 * where the last one stopped.
 */
async function storeAll(pc, progress){
  const plan = pc.plan;
  const keyOf = u => u.matched ? "m:" + u.matched.conceptId : "c:" + unitKey(u.candidate.brain, u.candidate.title);
  const units = [
    ...(plan.matched || []).map(m => ({ matched: m })),
    ...(plan.candidates || []).map(c => ({ candidate: c })),
  ];
  pc.done = pc.done || new Set();
  pc.written = pc.written || new Set();
  const earlier = units.filter(u => pc.done.has(keyOf(u))).length;
  const todo = units.filter(u => !pc.done.has(keyOf(u)));
  const queue = [];
  for (let i = 0; i < todo.length; i += STORE_BATCH) queue.push(todo.slice(i, i + STORE_BATCH));
  /* A plan with nothing to rewrite still stores its source and its note. */
  if (!queue.length && !pc.noted) queue.push([]);
  let total = queue.length, stored = 0;

  /* The source's text travels once. The first part carries it and the whole
     plan, and the server keeps both with the source's note; the other parts
     send their slice and the server reads the text back from the note. */
  const slim = { title: pc.ext.title, author: pc.ext.author, date: pc.ext.date, kind: pc.ext.kind };
  /* A note keeps 500 passages at most, to fit a database row. A longer source
     sends its text with every part, so no part reads a note cut short. */
  const every = (pc.ext.topics || []).length > 450;
  const body = (part, whole) => {
    whole = whole || every || pc.sendAll;
    return {
      sid: pc.sid, link: pc.link, linkLater: true,
      ext: whole ? pc.ext : slim,
      plan: { brains: plan.brains, conflicts: plan.conflicts, new: [], echo: [],
              matched: part.filter(u => u.matched).map(u => u.matched),
              candidates: part.filter(u => u.candidate).map(u => u.candidate) },
      ...(whole ? { fullPlan: plan } : {}),
      choices: pc.choices,
    };
  };

  const results = [];
  const send = async part => {
    const whole = !pc.noted;
    try {
      const r = await apiRetry("/api/drop/settle", body(part, whole), { split: part.length > 1 });
      results.push(r);
      for (const u of part) pc.done.add(keyOf(u));
      for (const id of r.written || []) pc.written.add(id);
      if (whole) pc.noted = true;
      /* The note kept fewer passages than the source has: the other parts send
         the text themselves rather than read a note cut short. */
      if (whole && r.noteTopics != null && r.noteTopics < (pc.ext.topics || []).length) pc.sendAll = true;
      progress(++stored, total);
    } catch (e) {
      if (!tooBig(e) || part.length < 2) throw e;
      /* Too big for one call: two halves, the first carrying the note if it
         is not written yet. */
      const h = Math.ceil(part.length / 2);
      total++;
      await send(part.slice(0, h));
      await send(part.slice(h));
    }
  };

  /* A part that fails for another reason does not stop the others. It gets
     one more try once they are in, and only then does the press end short. */
  let failed = null;
  const again = [];
  /* The first part alone, so the note exists before any part reads it. */
  if (!pc.noted && queue.length){
    const first = queue.shift();
    try { await send(first); }
    catch (e) { failed = e; again.push(first); }
  }
  const worker = async () => {
    while (queue.length){
      const part = queue.shift();
      try { await send(part); }
      catch (e) { failed = e; again.push(part); }
    }
  };
  /* Without the note, a part cannot read the source back, so the rest waits. */
  if (pc.noted) await Promise.all(Array.from({ length: Math.min(STORE_PARALLEL, queue.length) }, worker));
  if (again.length){
    failed = null;
    for (const part of again.concat(pc.noted ? [] : queue.splice(0))){
      try { await send(part); } catch (e) { failed = e; }
    }
  }
  if (failed){
    const left = units.filter(u => !pc.done.has(keyOf(u))).length;
    const err = new Error(`${units.length - left} of ${units.length} concepts are stored. ${failed.message} ` +
      `Press Store it again to finish: what is stored is not repeated.`);
    err.partial = true; throw err;
  }
  /* A concept a rewrite reply left out was stored with its claim as its
     position. Its real one is written now, eight to a request. */
  const unwritten = [...new Set(results.flatMap(r => r.unwritten || []))];
  for (let i = 0; i < unwritten.length; i += 8){
    try { await api("/api/concept/rederive", { ids: unwritten.slice(i, i + 8) }); } catch (_) {}
  }
  /* Linking runs once, in the background, over everything this drop wrote. */
  try { await api("/api/drop/link", { sid: pc.sid, ids: [...pc.written] }); } catch (_) {}
  const last = results[results.length - 1] || {};
  /* What the server wrote, not what the plan hoped for. A resumed store counts
     the concepts that landed earlier from the plan, since their answers are gone. */
  return {
    sid: last.sid || pc.sid, brains: last.brains || plan.brains,
    counts: { new: (plan.new || []).length, echo: (plan.echo || []).length },
    positions: results.reduce((n, r) => n + (r.positions || 0), 0) + earlier,
    missed: results.flatMap(r => r.missed || []),
  };
}

async function planAndCard(body, sid, link, ext, len, held){
  setThinking(body, "Comparing against what you hold");
  let plan;
  try {
    plan = await planAll(ext, held, (i, n) => setThinking(body,
      `Comparing against what you hold, part ${i} of ${n}`));
  } catch(e){ fail(body, e.message); return; }
  /* Where every topic went, for the card: never sent to be stored. */
  const cover = plan._cover || null; delete plan._cover;

  /* A plan that files nothing anywhere is a failed read, not an empty source.
     Rendering the card would offer Store it on a source that touches no
     position, and the store would refuse. Say what happened instead. */
  const lands = (plan.matched||[]).length + (plan.candidates||[]).length + (plan.new||[]).length;
  if (!lands){
    body.innerHTML = "";
    body.innerHTML = rich(
      `**The plan found nothing to file.** ${len ? `${Math.round(len/1000)}k characters were read` : "The stored extraction was reused"}, ` +
      `and no concept, candidate or new claim came back.\n\n` +
      `An auto-caption with no punctuation is the usual cause. Paste the transcript from the video's own panel, which carries sentences.`);
    const go = el("button","go","Paste the text");
    go.style.marginTop = "12px"; go.onclick = pasteHere; body.append(go);
    S.pendingCard = null; renderComposer();
    return;
  }

  /* Position-changing clashes lead, nuance follows. Both get a say, because
     you are the one who holds these positions. */
  const decide = [...(plan.conflicts||[]).filter(c=>c.kind==="flip"),
                  ...(plan.conflicts||[]).filter(c=>c.kind!=="flip")];
  const pc = { sid, link, ext, plan, choices:{}, byKey:{}, len, cover };
  S.pendingCard = pc; renderComposer();
  dropState("card", ext.title);
  tabTitle(document.hidden ? "Card ready" : "");

  body.innerHTML = "";
  body.append(buildCard(pc, decide));

  /* How the source was read, which decided the grain. The AI picks it from
     the source itself: every rule its own concept for study material, ideas
     rather than passages for an argument. */
  dbottom();
}

/* A source is stored under a named author. The same test the server holds:
   an empty name, or "unknown" and its kin, is no author. */
const knownAuthor = a => {
  const t = String(a ?? "").trim();
  return t.length >= 2 && !/^(unknown|inconnu|anonymous|anonyme|n\/?a|none|null|undefined|not found|\?+|-+)\b/i.test(t);
};

/** The authors the given brains already hold, the most frequent first. */
function authorsIn(slugs){
  const n = new Map();
  for (const s of S.sources){
    if (!(s.brains || []).some(b => slugs.includes(b)) || !knownAuthor(s.author)) continue;
    const a = String(s.author).trim();
    n.set(a, (n.get(a) || 0) + 1);
  }
  return [...n].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(x => x[0]).slice(0, 40);
}

/* The decision travels under the concept it concerns, never under a position
   number, because the rewriter reads it per concept. */
const ckey = (c, i) => c.conceptId || (c.brain && c.concept ? c.brain+"/"+c.concept : c.concept) || ("c"+i);

/**
 * What the drop kept, in one line of the card: how it was read, its words,
 * its numbers, dates and names, and its topics, every one filed.
 */
function keptLine(pc){
  const { ext, plan } = pc, read = ext.cover, cover = pc.cover;
  const kind = ext.kind || (ext.findings && ext.findings.kind) || "";
  const how = kind === "study" ? "Read as study material: one concept per rule, formula and method. "
    : kind === "argument" ? "Read as an argument: passages making the same point share one concept. " : "";
  const n = (plan.matched || []).length + (plan.candidates || []).length;
  const topics = cover?.topics ?? (ext.topics || []).length;
  const bits = [read?.words ? `${read.words.toLocaleString()} word${read.words === 1 ? "" : "s"}` : "",
    read?.facts ? `${read.facts.toLocaleString()} number${read.facts === 1 ? "" : "s"}, date${read.facts === 1 ? "" : "s"} and name${read.facts === 1 ? "" : "s"}` : "",
    `${topics} topic${topics === 1 ? "" : "s"}`].filter(Boolean);
  const all = cover && !cover.untracked;
  return `${how}${all ? "All of it kept" : "Read"}: ${bits.join(", ")}, filed into ${n} concept${n === 1 ? "" : "s"}.`;
}

function buildCard(pc, decide){
  const { sid, ext, plan } = pc;
  const card = el("div","card");
  const top = el("div","card-top");
  top.append(el("span","id",sid),
    el("span","meta",[ext.date,
      pc.len ? Math.round(pc.len/1000)+"k chars" : "read already"].filter(Boolean).join(" · ")));
  card.append(top);

  const dl = el("dl","card-grid");
  const row = (k,node) => { dl.append(el("dt",null,k)); const d=el("dd"); d.append(node); dl.append(d); };

  /* The author the reading found, filled in. When it found none, the person
     picks one of the authors these brains already hold, or writes a new
     name. Nothing is stored without one. */
  const who = el("div","author");
  const whoIn = el("input");
  whoIn.id = "cardAuthor"; whoIn.autocomplete = "off"; whoIn.spellcheck = false;
  whoIn.placeholder = "Who wrote or said it";
  whoIn.value = knownAuthor(ext.author) ? String(ext.author).trim() : "";
  whoIn.oninput = () => whoIn.classList.remove("bad");
  const known = whoIn.value ? [] : authorsIn(plan.brains || []);
  let whoPick = null;
  if (known.length){
    whoPick = el("select");
    whoPick.id = "cardAuthorPick";
    whoPick.append(Object.assign(el("option",null,"Pick the author"), { value: "", disabled: true, selected: true }));
    for (const a of known) whoPick.append(Object.assign(el("option",null,a), { value: a }));
    whoPick.append(Object.assign(el("option",null,"Someone else..."), { value: "__other__" }));
    whoIn.hidden = true;
    whoPick.onchange = () => {
      whoPick.classList.remove("bad");
      const other = whoPick.value === "__other__";
      whoIn.hidden = !other;
      whoIn.value = other ? "" : whoPick.value;
      if (other) whoIn.focus();
    };
    who.append(whoPick);
  }
  const whoHint = el("div","author-hint", whoIn.value
    ? (/youtu\.?be/.test(pc.link || "") ? "The YouTube channel. Rewrite it if it is wrong." : "Found in the source. Rewrite it if it is wrong.")
    : known.length ? "The source names no one. Pick who wrote or said it, or someone else."
    : "The source names no one. Write who wrote or said it.");
  who.append(whoIn, whoHint);
  row("Author", who);

  row("Goes to", el("span",null,
    (plan.brains||[]).map(x => { const b=S.brains.find(y=>y.slug===x); return b?`${b.name} (${b.type})`:x; }).join(" · ") || "no folder matched"));

  const cc = el("div","chips");
  (plan.matched||[]).forEach(m => {
    const c = S.concepts.find(x => `${x.brain}/${x.slug}` === m.conceptId);
    cc.append(el("span","chip", c?c.title:String(m.conceptId||"").split("/").pop()));
  });
  /* A candidate is a concept the brain does not hold yet. It becomes one when
     the drop is stored. */
  (plan.candidates||[]).forEach(m => cc.append(el("span","chip cand","+ "+m.title)));
  if (!cc.children.length) cc.append(el("span","chip none","none"));
  const cbox = el("div");
  cbox.append(cc);
  if ((plan.candidates||[]).length)
    cbox.append(el("div","chip-note", "Orange ones are new here. Each becomes a position when you store it."));
  row("Concepts", cbox);
  /* What was kept of the source: every topic filed, in one line. */
  const kept = el("span","kept", keptLine(pc)); kept.id = "dropKept";
  row("Kept", kept);

  const nu = el("ul");
  (plan.new||[]).slice(0,3).forEach(x => nu.append(el("li",null,"· "+x)));
  if (!(plan.new||[]).length) nu.append(el("li","none","nothing new"));
  else if ((plan.new||[]).length>3) nu.append(el("li","none",`and ${plan.new.length-3} more`));
  row(`New ${(plan.new||[]).length||""}`, nu);

  const eu = el("ul");
  (plan.echo||[]).slice(0,3).forEach(x => eu.append(el("li",null,`· ${x.claim} — repeats ${x.repeatsSource||"an earlier source"}`)));
  if (!(plan.echo||[]).length) eu.append(el("li","none","none"));
  row(`Echoes ${(plan.echo||[]).length||""}`, eu);

  card.append(dl);

  if (decide.length){
    const wrap = el("div","conflicts");
    decide.forEach((c,i) => {
      const key = ckey(c,i);
      const f = el("div","cf"); f.append(el("span","n",String(i+1)));
      const r = el("div");
      r.append(el("div","cn", c.concept + (c.brain ? "  ·  "+(S.brains.find(b=>b.slug===c.brain)?.name||c.brain) : "")));
      r.append(el("div", c.kind==="flip" ? "kind big" : "kind",
        c.kind==="flip" ? "changes the position"
        : c.kind==="drift" ? "same person, later view"
        : "adds nuance, position holds"));
      const mk = (lab,val,date) => { const d=el("div","side"); d.append(el("span",null,lab), document.createTextNode(String(val||"") + (date?`, ${date}`:""))); return d; };
      r.append(mk("new", c.says, c.saysDate), mk("stored", c.stored, c.storedDate));
      if (c.why) r.append(el("div","why","They differ because "+c.why));
      const opts = el("div","opts");
      [["both","keep both"],["new","new wins"],["old","mine wins"],["skip","reject source"]].forEach(([v,lab]) => {
        const o = el("button","opt"+(v==="both"?" dflt on":""), lab);
        o.onclick = () => { pc.choices[key]=v; [...opts.children].forEach(x=>x.classList.remove("on")); o.classList.add("on"); };
        opts.append(o);
      });
      pc.choices[key] = "both";
      pc.byKey[key] = c;
      r.append(opts); f.append(r); wrap.append(f);
    });
    card.append(wrap);
  }

  const foot = el("div","card-foot");
  /* A caveat IS a contradiction, it just does not change a position. Saying
     "no conflict" while one sits above the line reads as a lie. */
  foot.append(el("span","hint", decide.length
    ? `${decide.length} contradiction${decide.length===1?"":"s"} to settle. Silence keeps both, so a long list costs you nothing.`
    : "Nothing here contradicts what you hold."));
  const skip = el("button","ghost","Reject source");
  const ok   = el("button","go","Store it");
  skip.onclick = () => { card.remove(); S.pendingCard=null; dropState(null);
    dpush("ai", b => { b.innerHTML = rich("Rejected. Nothing was stored and no position moved."); }); };
  ok.onclick = async () => {
    const author = whoIn.value.trim();
    if (!knownAuthor(author)){
      const field = whoIn.hidden && whoPick ? whoPick : whoIn;
      field.classList.add("bad");
      whoHint.textContent = whoIn.hidden ? "Pick the author first. Nothing is stored without one."
        : "Write the author first. Nothing is stored without one.";
      field.focus();
      return;
    }
    pc.ext.author = author;
    ok.disabled = skip.disabled = true; ok.textContent = "Storing";
    if (Object.values(pc.choices).includes("skip")){
      card.remove(); S.pendingCard=null; dropState(null);
      dpush("ai", b => { b.innerHTML = rich("Rejected on a conflict. Nothing was stored and no position moved."); });
      return;
    }
    dropState("storing");
    const b2 = dthinking("Rewriting the positions it touched");
    try {
      const r = await storeAll(pc, (i, n) => { if (n > 1) setThinking(b2, `Rewriting the positions it touched, part ${i} of ${n}`); });
      card.remove(); await refresh();
      tabTitle(document.hidden ? "Stored" : "");
      b2.innerHTML = "";
      b2.append(receipt(r, pc));
      dbottom();
      S.pendingCard = null;
      dropState("stored");
    } catch(e){
      ok.disabled = skip.disabled = false; ok.textContent = "Store it";
      dropState("card");
      /* Part of a long source may already be in: the card stays, and pressing
         Store it again finishes the rest. */
      if (e.partial){ b2.innerHTML = rich("**Part of it is stored.** " + esc(e.message)); await refresh(); }
      else fail(b2, e.message);
    }
  };
  foot.append(skip, ok); card.append(foot);
  return card;
}

function receipt(r, pc){
  const names = (r.brains||[]).map(x => S.brains.find(b=>b.slug===x)?.name || x).join(", ") || "none";
  const ch = Object.values(pc.choices||{});
  const flipped = ch.filter(x=>x==="new").length, both = ch.filter(x=>x==="both").length;
  const open = Object.entries(pc.choices||{}).filter(([,v])=>v==="both")
    .map(([k]) => (pc.byKey||{})[k]?.concept).filter(Boolean);
  const d = el("div","receipt");
  d.innerHTML =
`Stored <span class="v">${esc(r.sid)}</span>. Folders <span class="v">${esc(names)}</span>.
Rewritten: <span class="v">${r.positions}</span> position${r.positions===1?"":"s"}
<span class="v">${r.counts?.new ?? 0}</span> new · <span class="v">${r.counts?.echo ?? 0}</span> echoes · <span class="v">${flipped}</span> flipped · <span class="v">${both}</span> kept both
Open conflicts: <span class="v">${esc(open.join(", ")||"none")}</span>`;
  /* A match the server could not find is said, never dropped quietly. */
  if ((r.missed||[]).length){
    d.innerHTML += `\nNot filed: <span class="v">${esc(r.missed.join(", "))}</span>. Those concepts no longer exist under that id.`;
  }

  return d;
}

