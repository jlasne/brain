/* 01-core.js: What every screen uses: the server's address and calls, the state, small helpers, and every dialog's keys. */


const API = window.OCTOPUS_API;
const TOKEN_KEY = "octopus.token.v1";
/* Running as an installed app, from the home screen or the dock, rather than in a browser tab. */
const INSTALLED = (() => { try { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } })();
/* The browser's own install prompt, kept for Settings, Install: it comes once, before anything asks for it. */
var installAsk = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installAsk = e; });
window.addEventListener("appinstalled", () => { installAsk = null; });
/* A workspace's own model key, in a workspace made on the visitor's key. It
   is kept in this browser, one per workspace, until Sign out forgets it. It
   travels only with the calls that spend a model, and the server keeps no
   copy of it. */
const MODEL_CALLS = new Set(["/api/ask", "/api/onepager", "/api/personal/remember", "/api/conflicts", "/api/conflicts/settle",
  "/api/drop/read", "/api/drop/plan", "/api/drop/merge", "/api/drop/settle",
  "/api/brain/tidy", "/api/concept/merge", "/api/concept/rederive", "/api/interview", "/api/personal/people", "/api/personal/open",
  "/api/assets/part", "/api/assets/adopt"]);

const S = {
  token: null, brains: [], concepts: [], sources: [], model: "", pick: "",
  mode: "ask", scope: "all", into: [], pendingCard: null, chunk: 18000,
  /* Work that runs whatever is on screen: the questions on their way, by the
     chat they were asked in, and the drop under way. A new chat is a draft
     until its first answer names it. */
  jobs: [], draft: "d0", dropJob: null, dropBusy: false, memJob: null,
  /* A chat about one concept: { id, title, brain, personal }, or null. */
  concept: null,
  /* The folders ticked in the side panel to chat in. None asks them all. */
  picks: [],
  /* The folder open in the main area, or null for the chat. */
  folder: null,
  /* The assets a chat calls with @, the number of the one open in the main area, and what it holds on screen.
     `assetsOn` is false while the server is older than this page and has no asset routes yet. */
  assets: [], asset: null, pj: null, assetsOn: true,
  /* The assets ticked in the chat bar's picker: every message reads them, as if it named them with @. */
  assetPicks: [],
  /* The projects made before the assets, still to be turned into assets. */
  projects: [],
  /* The last few turns of the current thread. It travels with each question so
     a follow-up means something, and it is never written down: closing the tab
     ends it. */
  thread: [],
  /* The saved conversations, and the one on screen. Each question joins it. */
  chats: [], chatId: null,
  /* Each brain's health out of 10, and the concepts with an open conflict. */
  health: {}, conflicted: new Set(),
  /* Where each personal brain's interview stands, by slug, and its test and profile. */
  iv: {}, ivFull: {}, daily: {},
  /* The demo, or a workspace on the visitor's own key. */
  demo: false, byok: false,
  /* The workspace's own look, as saved, and the logo on the page now. */
  brand: null, logo: null,
  level: "normal",
  /* Which space this session reads, and what it calls itself. The passphrase at
     the door decided it, and the app only reports it. */
  space: document.documentElement.dataset.space || "", spaceName: "Tasu",
};

/* One screen at a time: opening a folder, or going back to the chat, leaves the open asset. */
{ let folder = S.folder; Object.defineProperty(S, "folder", { enumerable: true, get: () => folder, set(v){ folder = v; S.asset = null; } }); }

/* The level is a per-browser convenience, so a blocked or cleared store just
   falls back to normal. */
const LEVELS = ["normal","educational","learning"];
try { const v = localStorage.getItem("octopus.level"); if (LEVELS.includes(v)) S.level = v; } catch {}
const saveLevel = () => { try { localStorage.setItem("octopus.level", S.level); } catch {} };

/* The model this browser asks for. Empty means the one the server runs. Your
   key pays for it, so the choice sits with whoever holds the key. */
/* The models are picked in Settings for the whole workspace, on the server.
   A pick an older version kept in this browser is dropped. */
try { localStorage.removeItem("octopus.model"); } catch {}

/* Folded nav, remembered. A blocked store just leaves it open. */
let navOpen = true;
try { navOpen = localStorage.getItem("octopus.nav") !== "closed"; } catch {}
function paintNav(){
  $("app").classList.toggle("nav-closed", !navOpen);
  try { localStorage.setItem("octopus.nav", navOpen ? "open" : "closed"); } catch {}
}


const $ = id => document.getElementById(id);
const el = (t,c,txt) => { const n=document.createElement(t); if(c)n.className=c; if(txt!=null)n.textContent=txt; return n; };

/* ---- every dialog, the same way ----
   A dialog is a .veil on the page. When one opens, the focus moves into it: to Cancel when it deletes something, else to its first field,
   else to its first button. Tab stays inside it. Escape closes it the way a press outside it does. When it goes, the focus returns to what
   had it before. Each dialog keeps its own closing; this only presses it. */
const FOCUSABLE = "button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const topVeil = () => [...document.querySelectorAll(".veil")].pop() || null;
/* What can take the focus in a dialog: on screen, and not in a fold that is shut. */
const shown = x => {
  if (!x.getClientRects().length) return false;
  for (let d = x.closest("details"); d; d = d.parentElement?.closest("details")) if (!d.open && !d.querySelector(":scope > summary")?.contains(x)) return false;
  return true;
};
const inVeil = v => [...v.querySelectorAll(FOCUSABLE)].filter(x => shown(x) || x === document.activeElement);
new MutationObserver(list => {
  for (const m of list){
    for (const n of m.addedNodes){
      if (!(n instanceof HTMLElement) || !n.classList.contains("veil")) continue;
      n._back = document.activeElement;
      setTimeout(() => {
        if (!n.isConnected || n.contains(document.activeElement)) return;
        const all = inVeil(n), danger = n.querySelector(".go.danger");
        const first = danger ? n.querySelector("footer .ghost") : all.find(x => /^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName)) || all[0];
        first?.focus();
      }, 40);
    }
    for (const n of m.removedNodes){
      if (!(n instanceof HTMLElement) || !n.classList.contains("veil")) continue;
      const back = n._back;
      if (back?.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus();
    }
  }
}).observe(document.body, { childList: true });
document.addEventListener("keydown", e => {
  const v = topVeil(); if (!v) return;
  if (e.key === "Tab"){
    const all = inVeil(v); if (!all.length) return;
    const i = all.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)){ e.preventDefault(); all[all.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === all.length - 1)){ e.preventDefault(); all[0].focus(); }
  } else if (e.key === "Escape"){
    /* After the dialog's own handlers: one that closed it on Escape has already done so. */
    setTimeout(() => { if (v.isConnected) v.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, 0);
  }
}, true);
const esc = s => String(s??"").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"item";
/** A short fingerprint of a text. */
const fnv = t => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
/* A concept's id. A long title keeps its first 41 characters and a short
   hash of the rest, so two ideas that open the same way stay two concepts.
   Same rule as the server's conceptSlug. */
const conceptSlug = t => {
  const full = String(t ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "item";
  if (full.length <= 48) return full;
  let h = 0x811c9dc5;
  for (let i = 0; i < full.length; i++){ h ^= full.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${full.slice(0, 41).replace(/-+$/,"")}-${h.toString(36).padStart(6,"0").slice(-6)}`;
};
const pad2 = n => String(n).padStart(2,"0");
const rich = t => esc(t).split(/\n{2,}/).map(p =>
  "<p>" + p.replace(/\n/g,"<br>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>") + "</p>").join("");

/* every call to the server goes through here, carrying the session token */
async function api(path, body = {}) {
  let r;
  const ctl = new AbortController();
  const cap = setTimeout(() => ctl.abort(), 180000);   // a read can think for a while
  try {
    r = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: S.token,
        ...(S.byok && MODEL_CALLS.has(path) && myKey() ? { key: myKey() } : {}), ...body }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e?.name === "AbortError"
      ? "That call ran past 3 minutes with no answer. Try a shorter source."
      : "The server did not answer. Check your connection.");
  } finally { clearTimeout(cap); }
  if (r.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    location.replace("/chat?w=" + encodeURIComponent(S.space || "")); throw new Error("locked");
  }
  const d = await r.json().catch(() => ({ error: "the server sent something unreadable" }));
  if (d.error) throw new Error(d.error);
  return d;
}

/**
 * A call that writes nothing, tried up to three times.
 *
 * Reading and planning a long document is about 40 calls. One busy model or
 * one dropped connection among them used to throw the whole reading away.
 */
/**
 * The model ran out of time on a job this big. The same call again runs out
 * the same way, so the caller splits the job in two instead of retrying it.
 */
const tooBig = e => /still\s(thinking|writing)|sent nothing for|too big for one call|cut off by the token budget|stopped before it ended|ran past 3 minutes/i
  .test(String(e?.message || ""));

async function apiRetry(path, body = {}, opts = {}){
  for (let n = 1; ; n++){
    try { return await api(path, body); }
    catch (e) {
      /* A job too big for one call goes back to be split, not sent again. */
      if (opts.split && tooBig(e)) throw e;
      /* A reply that held no readable JSON is asked again: the next one usually reads. */
      const passing = /did not answer|unreachable|ran past|timed out|still\s(thinking|writing)|429|rate limit|overloaded|busy|50[0-9]|temporar|unreadable|cut off|held no JSON/i
        .test(e.message);
      if (!passing || n >= 3 || e.message === "locked") throw e;
      await new Promise(ok => setTimeout(ok, n * 2500));
    }
  }
}

