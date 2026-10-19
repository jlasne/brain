/* 04-thread.js: The thread: messages, answers and their actions. */

/* ============ thread ============ */
const clearZero = () => $("thread").querySelector(".zero")?.remove();
const bottom = (t = $("thread")) => { t.scrollTop = t.scrollHeight; };

/* A message lands in the chat, or, from a drop, on the Drop screen: the chat
   only asks. */
function push(kind, build, where = $("thread")){
  if (where === $("thread")) clearZero(); else where.querySelector(".zero")?.remove();
  const wrap = el("div","msg "+(kind==="me"?"me":"ai"));
  const col = el("div","col");
  if (kind !== "me"){
    const who = el("div","who");
    who.append(el("span",null,S.spaceName));
    const b = S.brains.find(x=>x.slug===S.scope);
    if (b) who.append(el("span","sc","· "+b.name));
    col.append(who);
  }
  const body = el("div","body");
  col.append(body); wrap.append(col); where.append(wrap);
  build(body); bottom(where);
  return body;
}
/** A line that is a heading ("#", "##", "###") or a bullet ("*", "-"): the light Markdown a message and a reply are laid out with. */
const MD_HEAD = /^\s*(#{1,3})\s+(.+)$/, MD_ITEM = /^\s*[*-]\s+(.+)$/;
/**
 * A message's light Markdown into an element: headings and bullets, every
 * other line as written. `inline` fills one line: plain text, or tags shaded.
 */
function lightMd(box, text, inline){
  box.textContent = "";
  let list = null, para = null;
  for (const raw of String(text ?? "").split("\n")){
    const h = MD_HEAD.exec(raw), b = MD_ITEM.exec(raw);
    if (h){ list = para = null; const x = el("div", "md-h md-h" + h[1].length); inline(x, h[2]); box.append(x); continue; }
    if (b){ para = null; if (!list){ list = el("ul","md-ul"); box.append(list); } const li = el("li"); inline(li, b[1]); list.append(li); continue; }
    list = null;
    if (!raw.trim()){ para = null; continue; }
    if (!para){ para = el("p","md-p"); box.append(para); } else para.append(el("br"));
    const span = el("span"); inline(span, raw); para.append(span);
  }
}
function says(text, attach, where){
  const t = String(text ?? ""), choices = t.includes("@") ? tagChoices() : null;
  /* A tag in a message keeps its shade: a folder, a category, an asset. */
  const inline = (x, line) => { if (choices && line.includes("@")) paintTags(x, line, choices); else x.textContent = line; };
  push("me", b => {
    /* Headings and bullets typed are laid out; a message with none stays as written. */
    if (t.split("\n").some(l => MD_HEAD.test(l) || MD_ITEM.test(l))){ b.classList.add("md"); lightMd(b, t, inline); }
    else inline(b, t);
    if (attach) b.append(el("span","attach",attach));
  }, where);
}
/* The same three, on the Drop screen. */
const dpush = (kind, build) => push(kind, build, $("dropThread"));
const dsays = (text, attach) => says(text, attach, $("dropThread"));
const dthinking = label => thinking(label, $("dropThread"));
const dbottom = () => bottom($("dropThread"));
/* What the space's mascot is up to while an answer is on its way, with the
   step it stands for in brackets. The lines follow an answer's order, one
   every 2.4 seconds: the titles are searched, matched, the concepts read,
   the evidence weighed, the answer written. A long wait alternates the last
   two, which is where a long answer spends its time. */
const WAITING = {
  octopus: [
    ["Octopus is reaching into every folder...", "searching"],
    ["Octopus is feeling for the right concepts...", "matching"],
    ["Eight arms, sorting the notes...", "reading"],
    ["Octopus is untangling the answer...", "weighing"],
    ["Octopus is inking the key points...", "writing"],
  ],
  squidgy: [
    ["Squidgy is sniffing around...", "searching"],
    ["Squidgy picked up a scent...", "matching"],
    ["Squidgy is digging through the notes...", "reading"],
    ["Squidgy is fetching the best bits...", "weighing"],
    ["Squidgy is wagging, almost there...", "writing"],
  ],
};

/* Any other workspace waits in its own name. */
const waitingFor = name => [
  [`${name} is searching every title...`, "searching"],
  [`${name} is matching the concepts...`, "matching"],
  [`${name} is reading the notes...`, "reading"],
  [`${name} is weighing the evidence...`, "weighing"],
  [`${name} is writing the answer...`, "writing"],
];

/**
 * The turning mark and a line. Without a label, the line is the mascot's,
 * and it changes while the wait lasts. A drop's steps pass their own label,
 * because "part 3 of 8" says more than a joke.
 */
/**
 * The browser tab says what a drop is doing, so a long one can run while
 * another tab is open: "Reading 3 of 8 · Octopus". A card or a store that
 * lands while the tab is hidden says so until the tab is looked at.
 */
function tabTitle(step){ document.title = step ? `${step} \u00b7 ${S.spaceName}` : S.spaceName; }
function tabStep(label){
  const t = String(label || ""), n = t.match(/(\d+) of (\d+)/), of = n ? ` ${n[1]} of ${n[2]}` : "";
  const step = /^Checking for a repeat/.test(t) ? "Checking"
    : /^Opening the link/.test(t) ? "Opening"
    : /^Reading/.test(t) ? "Reading" + of
    : /^Comparing against/.test(t) ? "Filing" + of
    : /^Rewriting the positions/.test(t) ? "Storing" + of : "";
  if (step) tabTitle(step);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && /^(Card ready|Stored) /.test(document.title)) tabTitle("");
});

function thinking(label, where){
  tabStep(label);
  if (where && where === $("dropThread")) dropStep(label);
  return push("ai", b => thinkInto(b, label), where);
}
/** The turning mark and its line, inside a message already on screen. */
function thinkInto(b, label){
  const t = el("div","thinking"), mark = el("span","spinner");
  mark.setAttribute("aria-hidden", "true");
  t.setAttribute("role", "status");
  const line = el("span","tl",label||"Thinking");
  t.append(mark, line);
  b.append(t);
  const lines = !label && (WAITING[S.space] || waitingFor(S.spaceName));
  if (lines){
    const show = i => { line.textContent = lines[i][0] + " "; line.append(el("span","act",`(${lines[i][1]})`)); };
    let i = 0;
    show(i);
    const timer = setInterval(() => {
      /* The wait ended when the line left the page. */
      if (!line.isConnected || t.dataset.fixed){ clearInterval(timer); return; }
      i = i < lines.length - 1 ? i + 1 : lines.length - 2;
      show(i);
    }, 2400);
  }
}
function setThinking(body, label){
  tabStep(label);
  if (body.closest?.("#dropThread")) dropStep(label);
  const t = body.querySelector(".thinking");
  const s = body.querySelector(".thinking .tl");
  if (t) t.dataset.fixed = "1";
  if (s) s.textContent = label;
}
/* A failure worth trying again as it was: the connection, the clock, a busy model. */
const RETRYABLE = /did not answer|ran past|unreachable|timed out|still\s(thinking|writing)|sent nothing|overloaded|rate limit|429|50[0-9]|busy|temporar/i;
/**
 * The error, and what to do about it: Try again when the failure was the
 * connection or the clock and the caller can send it again, and Send
 * feedback, which mails the error to the people who run Tasu.
 */
function fail(body, msg, o = {}){
  tabTitle("");
  body.innerHTML = "";
  const text = msg || "Something failed on the way. Send it again.";
  const e = el("div","err");
  e.append(el("b",null,"Nothing was stored"), el("span",null,text));
  const acts = el("div","err-acts");
  if (o.retry && RETRYABLE.test(text)){
    const again = el("button","mini err-go","Try again"); again.type = "button";
    again.onclick = () => { if (!again.disabled){ again.disabled = true; o.retry(); } };
    acts.append(again);
  }
  if (text !== "locked") acts.append(feedbackButton(text, { ...o, where: o.where || (body.closest?.("#dropThread") ? "drop" : "chat") }));
  e.append(acts);
  body.append(e);
}
/** Send feedback: the error, where it happened and the message behind it, mailed once. */
function feedbackButton(error, o){
  const b = el("button","mini err-fb","Send feedback"); b.type = "button";
  b.title = "Mails this error to the people who run Tasu";
  b.onclick = async () => {
    b.disabled = true; b.textContent = "Sending";
    try {
      await api("/api/feedback", { error, where: o.where, q: o.q || "", chat: S.chatId || "", personal: isPersonal(o.scope ?? S.scope),
        agent: navigator.userAgent });
      b.textContent = "Sent. Thank you";
    } catch (e) { b.disabled = false; b.textContent = "Send feedback"; b.title = "Not sent: " + e.message; b.after(el("span","err-why", "Not sent: " + e.message)); }
  };
  return b;
}

