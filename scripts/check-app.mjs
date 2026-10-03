/**
 * Boots the pages in a real browser, with a canned deployment behind them.
 *
 * check-pages reads the source. It cannot see a function used before the line
 * that declares it, which throws once at boot and leaves half the screen dead
 * while the page still looks right. This runs the pages and fails on any error
 * the browser reports, then drives the drop composer through the states its
 * buttons depend on.
 *
 *     node scripts/check-app.mjs
 *
 * Playwright is not a dependency of this repo. Without it, this skips and says
 * so, because the static checks still hold on their own.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

let chromium;
{
  const req = createRequire(import.meta.url);
  /* Beside the project, or installed globally, which is not on the default
     resolution path. */
  const global = join(dirname(dirname(process.execPath)), "lib", "node_modules", "playwright");
  const tries = [
    () => req.resolve("playwright"),
    () => join(global, "index.mjs"),
    () => join(global, "index.js"),
  ];
  for (const where of tries) {
    try {
      const m = await import(pathToFileURL(where()).href);
      /* The package resolves to CommonJS from some paths, where the named
         exports arrive under default instead. */
      chromium = m.chromium ?? m.default?.chromium;
      if (chromium) break;
    } catch {}
  }
  if (!chromium) {
    console.log("  skip  playwright is not installed, so the boot check did not run");
    process.exit(0);
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (rq, rs) => {
  const asked = rq.url.split("?")[0];
  /* The type comes from the file served, not the path asked for. "/" is
     index.html, and typed from the path it would be an octet stream, which a
     browser downloads instead of rendering. Vercel's cleanUrls makes the same
     substitution, so /octopus and /squidgy resolve here too. */
  /* vercel.json sends the owner's two doors to their workspace page. */
  const door = { "/octopus": "/chat?w=octopus", "/squidgy": "/chat?w=squidgy" }[asked];
  if (door) { rs.writeHead(302, { Location: door }).end(); return; }
  const file = asked === "/" ? "index.html"
    : /\.[a-z]+$/i.test(asked) ? asked.slice(1)
    : asked.slice(1) + ".html";
  try {
    const body = await readFile(join(APP, file));
    rs.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    rs.end(body);
  } catch { rs.writeHead(404).end("no"); }
});
await new Promise(ok => server.listen(0, "127.0.0.1", ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* One brain, so the composer has something to file into. */
const STATE = {
  brains: [{ slug: "content", name: "Content", type: "subject", scope: "brand and content", owner: null }],
  concepts: [], sources: [], model: "test/model", chunk: 18000, mentions: 1,
  account: null, kind: "owner", owner: true, space: "octopus", spaceName: "Octopus",
  hasKey: false, keyHint: "",
  /* Most checks below look at the folder list, so they run in full mode. */
  full: true,
};

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};

const browser = await chromium.launch();

/**
 * A page with nothing outside this machine behind it.
 *
 * The font stylesheet blocks the scripts under it, so a machine that cannot
 * reach the font host never fires DOMContentLoaded and every check below times
 * out. Refusing the request outright makes this run the same offline, on a
 * plane or in CI.
 */
async function hermetic() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return page;
}

/** One page, booted, with every error the browser reported. */
async function boot(path, init, arg) {
  const page = await hermetic();
  const bad = [];
  page.on("pageerror", e => bad.push(`${path}: ${e.message}`));
  await page.addInitScript(init, arg);
  await page.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  return { page, bad };
}

/* ---- the app, signed in ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__pager = [];
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/concept")) return Response.json({ concept: { brain: "content", slug: "offer", n: 1, title: "Offer first",
        summaryLine: "Offer beats audience.", position: "An offer people buy beats a bigger audience.",
        evidence: [{ date: "2026-01-02", author: "A", claim: "sold out twice", source: "s-a" }], data: ["31 percent"], conflicts: [],
        sources: ["s-a"], related: ["content/offer"], updated: "2026-09-27" } });
      if (s.includes("/api/export")) {
        /* Two pages, so the export has to follow `next`. */
        const second = JSON.parse(opt?.body || "{}").cursor === "p2";
        return Response.json(second
          ? { concepts: [{ brain: "content", slug: "hooks", n: 2, title: "Hooks", summaryLine: "Three seconds decide.",
              position: "The first 3 seconds decide 70% of watch time.", evidence: [], data: [], conflicts: [], sources: [] }], next: null }
          : { concepts: [{ brain: "content", slug: "offer", n: 1, title: "Offer first",
              summaryLine: "Offer beats audience.", position: "An offer people buy beats a bigger audience.",
              evidence: [{ date: "2026-01-02", author: "A", claim: "sold out twice" }], data: ["31 percent"], conflicts: [], sources: ["s-a"] }],
              next: "p2" });
      }
      if (s.includes("/api/ask")) {
        window.__asked = JSON.parse(opt?.body || "{}");
        await new Promise(ok => setTimeout(ok, 600));
        return Response.json({ answer: "One line.", sources: 3, level: "normal" });
      }
      if (s.includes("/api/onepager")) {
        const body = JSON.parse(opt?.body || "{}");
        window.__pager.push(body);
        const page = { title: "Octopus", line: "1 brain, 2 positions.",
          sections: [{ head: "", bullets: [{ k: "Offer creation", say: "Offer first." }, { k: "Personal brand", say: "Face beats logo." }] }],
          foot: "2 of 2 positions \u00b7 3 sources read \u00b7 2026-09-26" };
        if (body.kind === "custom" && body.doc === "quiz") return Response.json({ text: "x", page: { title: "Quiz: Content", line: "2 questions on Content. The answers follow.",
          sections: [{ head: "Questions", bullets: [], blocks: [{ ol: ["Why does an offer beat a bigger audience?", "What does a **named face** add?"] }] },
                     { head: "Answers", bullets: [], blocks: [{ ol: ["Buyers pay for the offer, not the reach.", "Trust that compounds."] }] }],
          foot: "1 of 2 positions \u00b7 3 sources read \u00b7 2026-09-27" } });
        /* A deep dive says the language it came back in; "slow" is a translation that failed twice. */
        if (body.kind === "custom" && body.doc === "deepdive") return Response.json({ text: "x",
          ...(body.note === "slow" ? { lang: "English", warning: `The ${body.lang} translation did not come back after two tries, so this page is in English. Build it again to retry.` }
                                   : { lang: body.lang || "English" }),
          page: { title: "Deep dive: Content", line: "From Content.",
          sections: [{ head: "The short answer", bullets: [], blocks: [{ p: "An offer people buy beats reach. **2 launches** sold out." }] },
                     { head: "The evidence", bullets: [], blocks: [{ ul: ["2026-01-02: sold out twice", "31 percent came from email"] }] }],
          foot: "1 of 2 positions \u00b7 3 sources read \u00b7 2026-09-27" } });
        if (body.mail === "refused@example.com")
          return Response.json({ page, text: "x", sent: false, to: body.mail, mailError: "domain is not verified" });
        if (body.mail) return Response.json({ page, text: "x", sent: true, to: body.mail, id: "e1" });
      }
      if (s.includes("/api/onepager")) return Response.json({
        page: { title: "Octopus", line: "1 brain, 2 positions.",
                sections: [{ head: "", bullets: [{ k: "Offer creation", say: "Offer first." }, { k: "Personal brand", say: "Face beats logo." }] }],
                foot: "2 of 2 positions \u00b7 3 sources read \u00b7 2026-09-26" },
        text: "Octopus\n\n- Offer first.\n- Face beats logo.",
      });
      return Response.json({ gates: {} });
    };
  }, STATE);
  check("the app boots with nothing thrown", !bad.length, bad.join("\n       "));

  /* ---- simpler: one tool for the drop, one box for the text, no key to set ---- */
  const simple = await page.evaluate(() => ({
    gone: !document.getElementById("testBtn") && !document.getElementById("pasteBtn"),
    count: document.querySelector(".brain-row .ct")?.textContent,
  }));
  check("the drop keeps one tool: + document", simple.gone);
  check("a brain row leaves the concept count to its score", simple.count === undefined, String(simple.count));

  await page.evaluate(() => document.getElementById("dropBtn").click());
  const ph = await page.getAttribute("#input", "placeholder");
  check("the content box says a transcript is pasted there", /transcript/.test(ph || ""), ph);
  const read = async (src, content) => {
    await page.fill("#srcInput", src);
    await page.fill("#input", content);
    await page.waitForTimeout(40);
    return await page.evaluate(() => ({
      off: document.getElementById("send").disabled,
      hint: document.getElementById("tHint").textContent,
    }));
  };
  const empty = await read("", "");
  check("an empty drop cannot send", empty.off === true, `hint: ${empty.hint}`);

  const named = await read("Gave, Le Figaro, 12 Sept 2026", "");
  check("a source with nothing to read cannot send", named.off === true, `hint: ${named.hint}`);
  check("and it says what is missing", /paste|document|link/.test(named.hint), named.hint);

  const linked = await read("https://example.com/piece", "");
  check("a link on its own can send", linked.off === false, `hint: ${linked.hint}`);

  const pasted = await read("", "the words of the source");
  check("content with no source can send", pasted.off === false, `hint: ${pasted.hint}`);
  check("and it asks for the source", /name the source/.test(pasted.hint), pasted.hint);

  await page.click("#dropClose");
  const asking = await page.evaluate(() => ({
    src: document.getElementById("srcLine").hidden,
    file: document.getElementById("fileBtn").hidden,
  }));
  check("asking hides the source line and the document button", asking.src && asking.file);

  /* ---- the brain picker ---- */
  const face = await page.evaluate(() => document.getElementById("scopeBtn").textContent.replace(/\s+/g, " ").trim());
  check("the picker names where a question goes, with no label in front", face === "All folders", face);
  await page.click("#scopeBtn");
  const menu = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".pick-menu .pk-row .pk-nm")].map(x => x.firstChild.textContent),
    heads: [...document.querySelectorAll(".pick-menu .pk-h")].map(x => x.textContent),
  }));
  check("its menu offers every folder in one list", menu.rows.join(",") === "All folders,Content" && menu.heads.join(",") === "Or one folder",
    JSON.stringify(menu));
  check("each with its person or subject mark", await page.evaluate(() =>
    document.querySelector(".pick-menu .pk-row:nth-of-type(2) .b-ic")?.getAttribute("aria-label")) === "Subject");
  await page.click(".pick-menu .pk-row >> nth=1");
  const picked = await page.evaluate(() => ({ val: document.getElementById("scopeVal").textContent, open: !!document.querySelector(".pick-menu") }));
  check("picking a brain names it and closes the menu", picked.val === "Content" && !picked.open, JSON.stringify(picked));
  await page.click("#scopeBtn"); await page.keyboard.press("Escape");
  check("Escape closes the menu", !(await page.$(".pick-menu")));
  await page.click("#scopeBtn"); await page.click(".pick-menu .pk-row >> nth=0");
  const top = await page.evaluate(() => {
    const acts = [...document.querySelectorAll("aside .side-acts button")].map(b => b.id + ":" + b.textContent.trim()).join(",");
    const panels = [...document.querySelectorAll("aside .panel")].map(p => p.id + ":" + p.querySelector(".fold-t").textContent.replace(/\s+/g, " ").trim().split(" ")[0]).join(",");
    return { acts, panels, plus: [...document.querySelectorAll("aside .panel .side-plus")].map(b => b.id).join(","),
      gone: !document.getElementById("gapsBtn") && !document.getElementById("mapBtn") };
  });
  check("the side panel opens on New chat, then Drop, One-pager and Settings as rows", top.acts === "startBtn:New chat,dropBtn:Drop,pagerBtn:One-pager,keyBtn:Settings"
    && await page.evaluate(() => document.getElementById("startBtn").classList.contains("go") && !document.getElementById("dropBtn").classList.contains("go")), top.acts);
  check("then Chats and Folders, each a list of its own, and no Projects", top.panels === "chatsPanel:Chats,brainsPanel:Folders" && top.gone
    && !(await page.$("#projectsPanel")), top.panels);
  check("a new chat and a new folder are the + of their list", top.plus === "newChat,newBrain", top.plus);
  await page.click("#chatsFold");
  check("a list folds", await page.evaluate(() => document.getElementById("chatsBox").hidden));
  await page.click("#chatsFold");
  await page.click("#dropBtn"); await page.waitForTimeout(60);
  const dropping = await page.evaluate(() => ({ on: document.querySelector("main").dataset.view, src: !document.getElementById("srcLine").hidden,
    focus: document.activeElement?.id, chat: document.getElementById("thread").hidden, log: !document.getElementById("dropThread").hidden,
    lit: document.getElementById("dropBtn").classList.contains("on") }));
  check("Drop opens a screen of its own, on the source line, the chat set aside", dropping.on === "drop" && dropping.src && dropping.focus === "srcInput"
    && dropping.chat && dropping.log && dropping.lit, JSON.stringify(dropping));
  check("the chat has no Ask or Drop switch: it only asks", !(await page.$("#mode")));
  await page.click("#dropClose");

  /* ---- a new folder: a folder or a personal one, and one switch for a person ---- */
  await page.click("#newBrain"); await page.waitForTimeout(80);
  const sheet0 = await page.evaluate(() => ({ text: document.querySelector(".sheet")?.textContent || "",
    kinds: [...document.querySelectorAll("#bType button")].map(b => `${b.dataset.t}:${b.getAttribute("aria-checked")}`).join(","),
    scope: !document.getElementById("bScopeF").hidden, person: !document.getElementById("bPersonF").hidden && !document.getElementById("bPerson").checked,
    mine: document.getElementById("bMineF").hidden, go: document.getElementById("bMake").textContent }));
  check("New folder offers a folder or a personal one, the folder picked", sheet0.kinds === "folder:true,personal:false" && /^New folder/.test(sheet0.text.trim()), sheet0.kinds);
  check("a folder asks what it covers, with the person switch off", sheet0.scope && sheet0.person && sheet0.mine && sheet0.go === "Create folder", JSON.stringify(sheet0));
  check("and never who can feed it", !/Who can feed/.test(sheet0.text));
  await page.click("#bCancel");

  /* ---- the one-pager ---- */
  await page.click("#pagerBtn");
  await page.waitForTimeout(120);
  const sheet = await page.evaluate(() => ({
    picks: [...document.querySelectorAll("#pPick .pm-chip")].map(o => o.dataset.v),
    heads: [...document.querySelectorAll("#pPick .pm-head")].map(o => o.textContent),
    on: [...document.querySelectorAll("#pPick .pm-chip.on")].map(o => o.dataset.v).join(","),
  }));
  check("the sheet offers everything and each folder by name, as chips under their group",
    sheet.picks.join(",") === "all,content" && sheet.heads.join(",") === "Subjects", JSON.stringify(sheet));
  check("and starts on everything when no folder is picked", sheet.on === "all", String(sheet.on));

  await page.click("#pGo");
  await page.waitForTimeout(250);
  const card = await page.evaluate(() => {
    const c = document.querySelector(".pager");
    if (!c) return null;
    return {
      title: c.querySelector("h3")?.textContent,
      bullets: [...c.querySelectorAll("li")].map(li => li.textContent),
      heads: [...c.querySelectorAll("li .k")].map(k => k.textContent),
      acts: [...c.querySelectorAll(".acts button")].map(b => b.textContent),
      field: !!c.querySelector(".acts input"),
      gone: !document.querySelector(".veil"),
    };
  });
  check("a page lands in the thread", !!card, "no card");
  if (card) {
    check("titled by what it was built from", card.title === "Octopus", card.title);
    check("carrying its bullets", card.bullets.length === 2, card.bullets.join(" | "));
    check("each bullet leads with its concept", card.heads.join(",") === "Offer creation,Personal brand", card.heads.join(","));
    check("with copy, print and mail", card.acts.join(",") === "Copy,Print,Mail it", card.acts.join(","));
    check("and a field for the address", card.field);
    check("and the sheet closed behind it", card.gone);
  }

  /* ---- the dialog asks where to send it ---- */
  const lastCard = () => page.evaluate(() => {
    const cards = document.querySelectorAll(".pager");
    const c = cards[cards.length - 1];
    const said = c?.querySelector(".said");
    return c ? { said: said?.textContent || "", err: !!said?.classList.contains("err"), btn: [...c.querySelectorAll(".acts button")].pop()?.textContent,
                 to: c.querySelector(".acts input")?.value } : null;
  });

  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("the dialog has an address field", await page.$("#pTo") !== null);
  await page.fill("#pTo", "not an address");
  check("typing an address turns the button into build and send",
    (await page.textContent("#pGo")) === "Build and send", await page.textContent("#pGo"));
  await page.click("#pGo"); await page.waitForTimeout(100);
  check("a bad address keeps the dialog open", await page.$(".veil") !== null);
  check("and says why", /is not an address/.test(await page.textContent("#pSlot")), await page.textContent("#pSlot"));

  await page.fill("#pTo", "me@example.com");
  await page.click("#pGo"); await page.waitForTimeout(300);
  const sent = await lastCard();
  const asked = await page.evaluate(() => window.__pager[window.__pager.length - 1]);
  check("the build carries the address", asked.mail === "me@example.com", JSON.stringify(asked));
  check("the card says it was sent, and where to look if it is not there", sent && /^Sent to me@example\.com\. .*spam/.test(sent.said) && !sent.err, sent && sent.said);
  check("and does not offer to send it again", sent && sent.btn === "Sent", sent && sent.btn);

  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("the next dialog remembers the address", (await page.inputValue("#pTo")) === "me@example.com",
    await page.inputValue("#pTo"));
  await page.fill("#pTo", "refused@example.com");
  await page.click("#pGo"); await page.waitForTimeout(300);
  const refused = await lastCard();
  check("a refused send still shows the page, with the reason, as an error",
    refused && /^Not sent.*domain is not verified/.test(refused.said) && refused.err, refused && JSON.stringify(refused));
  check("and leaves the button to try again", refused && refused.btn === "Mail it", refused && refused.btn);

  /* ---- a summary in bullets, or a document of the type picked ---- */
  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  await page.fill("#pTo", "");
  const kinds = await page.evaluate(() => [...document.querySelectorAll("#pKind button")].map(b => b.dataset.k + (b.classList.contains("on") ? "*" : "")));
  check("the page offers summary and custom, summary first", kinds.join(",") === "summary*,custom", kinds.join(","));
  check("a summary shows no document types", !(await page.isVisible("#pDoc")) && !(await page.isVisible("#pNote")));
  await page.click('#pKind button[data-k="custom"]');
  const docs = await page.evaluate(() => [...document.querySelectorAll("#pDoc button")].map(b => b.textContent + (b.classList.contains("on") ? "*" : "")));
  check("custom offers quiz, deep dive, use case and other, quiz first", docs.join(",") === "Quiz*,Deep dive,Use case,Other", docs.join(","));
  check("with room for special instructions", await page.isVisible("#pNote"));
  check("the quiz says what it gives", /8 questions/.test(await page.textContent("#pDocHint")));
  await page.click('#pDoc button[data-d="other"]');
  check("other asks to describe the document", /Describe the document/.test(await page.textContent("#pNoteL")));
  await page.click("#pGo"); await page.waitForTimeout(80);
  check("other with no description asks for one", /Describe the document/.test(await page.textContent("#pSlot")));
  await page.fill("#pNote", "A checklist for a client meeting");
  await page.click("#pGo"); await page.waitForTimeout(300);
  const customBody = await page.evaluate(() => window.__pager[window.__pager.length - 1]);
  check("the description travels with its type", customBody.kind === "custom" && customBody.doc === "other"
    && customBody.note === "A checklist for a client meeting", JSON.stringify(customBody));

  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  await page.fill("#pTo", "");
  await page.click('#pKind button[data-k="custom"]');
  await page.click("#pGo"); await page.waitForTimeout(300);
  const quiz = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".pager")].pop();
    const d = c?.querySelector("details.answers");
    return { title: c?.querySelector("h3")?.textContent, folded: !!d && !d.open, bullets: c?.querySelectorAll("li .k").length,
      q: c?.querySelector(".doc ol li")?.textContent, bold: c?.querySelector(".doc ol li strong")?.textContent };
  });
  check("a quiz needs no instruction, and lands as numbered questions", quiz.title === "Quiz: Content" && /\?$/.test(quiz.q) && quiz.bullets === 0,
    JSON.stringify(quiz));
  check("with its answers folded", quiz.folded, JSON.stringify(quiz));
  check("and bold kept as bold", quiz.bold === "named face", JSON.stringify(quiz));

  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("the page is in English unless another language is picked", await page.inputValue("#pLang") === "English");
  await page.selectOption("#pLang", "French");
  await page.fill("#pTo", "");
  await page.click('#pKind button[data-k="custom"]');
  await page.click('#pDoc button[data-d="deepdive"]');
  await page.fill("#pNote", "For a new client");
  await page.click("#pGo"); await page.waitForTimeout(300);
  const deep = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".pager")].pop();
    return { heads: [...c.querySelectorAll("h4")].map(h => h.textContent), p: c.querySelector(".doc p")?.textContent,
      list: c.querySelectorAll(".doc ul li").length, asked: window.__pager.at(-1) };
  });
  check("a deep dive lands as sections of paragraphs and lists", deep.heads.join("|") === "The short answer|The evidence"
    && /beats reach/.test(deep.p) && deep.list === 2, JSON.stringify(deep));
  check("its special instructions travel with it", deep.asked.doc === "deepdive" && deep.asked.note === "For a new client", JSON.stringify(deep.asked));
  check("and so does the language picked", deep.asked.lang === "French", JSON.stringify(deep.asked));
  const langFlag = () => page.evaluate(() => {
    const f = [...document.querySelectorAll(".pager")].pop()?.querySelector(".err:not(.said)");
    return f && !f.hidden ? f.textContent : "";
  });
  check("a page that came back in the language asked shows no warning", await langFlag() === "", await langFlag());

  /* A translation that failed twice, and a server that knows no language menu, both say so. */
  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("the next page opens on the language last picked", await page.inputValue("#pLang") === "French");
  await page.fill("#pTo", "");
  await page.click('#pKind button[data-k="custom"]');
  await page.click('#pDoc button[data-d="deepdive"]');
  await page.fill("#pNote", "slow");
  await page.click("#pGo"); await page.waitForTimeout(300);
  check("a translation that failed says the page is in English, above the page", /^Not in French.*did not come back after two tries/.test(await langFlag()), await langFlag());
  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  await page.fill("#pTo", "");
  await page.click('#pKind button[data-k="summary"]');
  await page.click("#pGo"); await page.waitForTimeout(300);
  check("a server that answers in English with no word is caught too", /^Not in French.*npx convex deploy/.test(await langFlag()), await langFlag());
  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  await page.selectOption("#pLang", "English");
  await page.fill("#pTo", "");
  await page.click("#pGo"); await page.waitForTimeout(300);
  check("an English page shows no warning", await langFlag() === "", await langFlag());

  /* ---- the loader is the space's own mark ---- */
  await page.fill("#input", "anything");
  await page.click("#send"); await page.waitForTimeout(150);
  const loader = await page.evaluate(() => {
    const m = document.querySelector(".thinking .spinner");
    return m ? { bg: getComputedStyle(m).backgroundImage, anim: getComputedStyle(m).animationName,
                 line: document.querySelector(".thinking span:last-child")?.textContent } : null;
  });
  check("a question shows the waiting mark while it waits", !!loader, "no .spinner");
  check("with Octopus's first waiting line and the step it stands for",
    loader?.line === "Octopus is reaching into every brain... (searching)", loader?.line);
  if (loader) {
    check("and it is the octopus's own loop, not a turning mark", /octopus-loop-64\.webp/.test(loader.bg) && loader.anim === "none", `${loader.bg} ${loader.anim}`);
  }
  await page.waitForTimeout(700);
  check("and it goes when the answer lands", await page.$(".thinking .spinner") === null);
  const acts = await page.evaluate(() => [...document.querySelectorAll(".msg.ai .ans-acts button")].map(b => b.textContent));
  check("under the answer: Copy and One-pager from this", acts.join(",") === "Copy,One-pager from this", acts.join(","));
  await page.click(".ans-acts button:nth-child(2)"); await page.waitForTimeout(120);
  const pre = await page.evaluate(() => ({ q: document.getElementById("pQ")?.value, pick: [...document.querySelectorAll("#pPick .pm-chip.on")].map(o => o.dataset.v).join(",") }));
  check("One-pager from this opens the page with the question and its brains", pre.q === "anything" && pre.pick === "all", JSON.stringify(pre));
  await page.click("#pCancel");

  /* ---- the export reads whole concepts only when asked ---- */
  const side = await page.evaluate(() => ({ gone: !document.getElementById("exportBtn") && !document.getElementById("stat"),
    foot: [...document.querySelectorAll(".side-foot button:not([hidden])")].map(b => b.textContent.trim()).join(",") }));
  check("the foot of the side panel keeps Sign out only", side.gone && side.foot === "Sign out", side.foot);
  await page.click("#burger").catch(() => {});
  await page.evaluate(() => document.getElementById("keyBtn").click());
  await page.waitForTimeout(150);
  const setup = await page.evaluate(() => ({ model: document.querySelector("#setModel .val")?.textContent,
    exp: !!document.getElementById("setExport"), order: [...document.querySelectorAll(".sheet .set-row button")].map(b => b.id).join(",") }));
  check("Settings holds the model, the export, then the map", setup.order === "setModel,setExport,setMap" && setup.model === "model", JSON.stringify(setup));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#setExport")]);
  const { readFileSync } = await import("node:fs");
  const exported = readFileSync(await dl.path(), "utf8");
  check("Export downloads one markdown file", /\.md$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check("with each brain's concepts whole, read on demand", /sold out twice/.test(exported) && /31 percent/.test(exported),
    exported.slice(0, 200));
  check("page after page, until the brain is read to its end", /70% of watch time/.test(exported), exported.slice(-300));
  await page.waitForTimeout(100);
  check("the export says it is done", await page.textContent("#setExport .val") === "downloaded", await page.textContent("#setExport .val"));
  await page.click("#setModel"); await page.waitForTimeout(150);
  check("Model opens the model list in place of Setup", !!(await page.$("#mList")) && !(await page.$("#setModel")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  await page.evaluate(() => document.querySelectorAll(".veil").forEach(v => v.remove()));

  /* ---- inside a brain ---- */
  await page.hover(".brain-row"); await page.click(".brain-row .ed >> text=open");
  await page.waitForTimeout(120);
  const vw = await page.evaluate(() => ({ title: document.querySelector("#folderView h2")?.textContent,
    shown: !document.getElementById("folderView").hidden, chat: !document.getElementById("thread").hidden,
    count: document.querySelector("#folderView .fv-n")?.textContent, view: document.querySelector("main").dataset.view }));
  check("open shows the folder in the main area, the chat set aside", vw.title === "Content" && vw.shown && !vw.chat && vw.view === "folder" && /concept/.test(vw.count || ""), JSON.stringify(vw));
  check("the row carries open alone, and the folder's name and scope are edited from inside it",
    await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row .ed")].map(x => x.textContent).join(",")) === "open" && !!(await page.$("#fvEdit")));
  check("the open folder carries Chat in it and Drop into it", !!(await page.$("#fvChat")) && !!(await page.$("#fvDrop")));
  check("and the bar below asks that folder", /^Ask Content/.test(await page.getAttribute("#input", "placeholder") || ""), await page.getAttribute("#input", "placeholder"));
  await page.click("#fvEdit"); await page.waitForTimeout(100);
  check("Edit opens the name and the scope line", await page.evaluate(() => document.getElementById("rName")?.value === "Content" && !!document.getElementById("rScope")));
  await page.close();
}

/* ---- the model, saved for the workspace ---- */
{
  const withModels = { ...STATE, model: "deepseek/deepseek-v4-flash-0731",
    models: { chat: "deepseek/deepseek-v4-flash-0731", project: "z-ai/glm-5.3-flash", chatDefault: "deepseek/deepseek-v4-flash-0731", projectDefault: "z-ai/glm-5.3-flash" } };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    localStorage.setItem("octopus.model", "openai/gpt-5");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      window.__calls.push({ s, body });
      if (s.includes("openrouter.ai/api/v1/models")) return Response.json({ data: [
        { id: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", pricing: { prompt: "0.0000000077", completion: "0.00000128" }, context_length: 1048576, supported_parameters: ["response_format"] },
        { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", pricing: { prompt: "0.00000015", completion: "0.0000005" }, context_length: 1048576, supported_parameters: ["response_format"] },
        { id: "z-ai/glm-5.3", name: "Z.ai: GLM 5.3", pricing: { prompt: "0.0000014", completion: "0.0000044" }, context_length: 1048576, supported_parameters: ["response_format"] }] });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/models")) return Response.json({ chat: body.chat === undefined ? state.models.chat : body.chat || state.models.chatDefault,
        project: body.project === undefined ? state.models.project : body.project || state.models.projectDefault });
      if (s.includes("/api/ask")) return Response.json({ answer: "One line.", sources: 3, level: "normal" });
      return Response.json({});
    };
  }, withModels);
  check("a model picked in this browser before is dropped: the workspace's pick rules", await page.evaluate(() => localStorage.getItem("octopus.model")) === null);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(150);
  const rows = await page.evaluate(() => ({ chat: document.querySelector("#setModel .val")?.textContent, proj: !!document.getElementById("setProjModel") }));
  check("Settings shows one model, DeepSeek by default", rows.chat === "deepseek-v4-flash-0731" && !rows.proj, JSON.stringify(rows));
  await page.click("#setModel"); await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({ title: document.querySelector(".sheet h3")?.textContent, first: document.querySelector("#mList .mrow span")?.textContent,
    on: document.querySelector("#mList .mrow.on b")?.textContent }));
  check("Model opens the list on its default, marked", sheet.title === "Model" && /deepseek-v4-flash-0731/.test(sheet.first || "") && /default/.test(sheet.first || "")
    && sheet.on === "DeepSeek V4 Flash", JSON.stringify(sheet));
  await page.click('#mList .mrow:has(b:text-is("Z.ai: GLM 5.3"))'); await page.click("#mSave"); await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({ body: window.__calls.filter(c => c.s.includes("/api/models")).pop()?.body,
    val: document.querySelector("#setModel .val")?.textContent, pick: document.getElementById("setModel")?.classList.contains("pick") }));
  check("a pick is saved for the workspace, and Settings shows it", saved.body?.chat === "z-ai/glm-5.3" && !("project" in saved.body) && saved.val === "glm-5.3" && saved.pick, JSON.stringify(saved));
  await page.click("#setModel"); await page.waitForTimeout(150);
  await page.click("#mReset"); await page.waitForTimeout(150);
  const reset = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/models")).pop()?.body);
  check("Use the default sends no model", reset && reset.chat === null, JSON.stringify(reset));
  await page.evaluate(() => document.querySelectorAll(".veil").forEach(v => v.remove()));
  await page.fill("#input", "Is gold a hedge?"); await page.click("#send"); await page.waitForTimeout(150);
  const asked = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/ask")).pop()?.body);
  check("a question carries no model: the server uses the workspace's pick", asked && !("model" in asked), JSON.stringify(asked));
  check("nothing threw picking models", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- Merge into: a folder poured into another, after a second click ---- */
{
  const two = { ...STATE, brains: [...STATE.brains, { slug: "wealth", name: "Wealth", type: "subject", scope: "w", owner: null },
    { slug: "me", name: "Me", type: "personal", scope: "", owner: null }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    let s0 = state;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/brain/merge")) { s0 = { ...s0, brains: s0.brains.filter(b => b.slug !== body.from) };
        return Response.json({ from: body.from, into: body.into, fromName: "Content", intoName: "Wealth", merged: true, moved: 3, joined: 1, sources: 2 }); }
      if (s.includes("/api/state")) return Response.json(s0);
      return Response.json({ chats: [], health: [] });
    };
  }, two);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Content/.test(r.textContent)).querySelector(".ed.op").click());
  await page.waitForTimeout(120);
  await page.click("#fvEdit"); await page.waitForTimeout(80);
  const opts = await page.evaluate(() => [...document.querySelectorAll("#rInto option")].map(o => o.textContent));
  check("Edit offers Merge into this workspace's other folders, never a personal one", JSON.stringify(opts) === '["Pick a folder","Wealth"]', JSON.stringify(opts));
  await page.selectOption("#rInto", "wealth");
  await page.click("#rMerge");
  check("the first click asks once more", await page.textContent("#rMerge") === "Sure? Into Wealth" && !(await page.evaluate(() => window.__calls.some(c => c.s.includes("/api/brain/merge")))));
  await page.click("#rMerge"); await page.waitForTimeout(250);
  const done = await page.evaluate(() => ({ sent: window.__calls.find(c => c.s.includes("/api/brain/merge"))?.body,
    rows: [...document.querySelectorAll("#brains .brain-row .nm")].map(x => x.textContent), open: document.querySelector("#folderView h2")?.textContent,
    said: [...document.querySelectorAll("#thread .msg.ai")].pop()?.textContent || "" }));
  check("the second merges, and the target opens", done.sent?.from === "content" && done.sent?.into === "wealth" && !done.rows.includes("Content") && done.open === "Wealth",
    JSON.stringify(done));
  check("nothing threw merging", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a concept opens whole, with its evidence and its links ---- */
{
  const withOne = { ...STATE, concepts: [{ brain: "content", slug: "offer", n: 1, title: "Offer first", summaryLine: "Offer beats audience.", ev: 1, src: 1 }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/concept")) return Response.json({ concept: { brain: "content", slug: "offer", n: 1, title: "Offer first",
        summaryLine: "Offer beats audience.", position: "An offer people buy beats a bigger audience.",
        evidence: [{ date: "2026-01-02", author: "A", claim: "sold out twice", source: "s-a" }], data: ["31 percent"], conflicts: [],
        sources: [], related: ["content/offer"], updated: "2026-09-27" } });
      return Response.json({});
    };
  }, withOne);
  await page.hover(".brain-row"); await page.click(".brain-row .ed >> text=open");
  await page.waitForTimeout(150);
  const list = await page.evaluate(() => [...document.querySelectorAll("#folderView .fv-row b")].map(b => b.textContent));
  check("the open folder lists each concept by name", list.join(",") === "Offer first", list.join(","));
  const first = await page.evaluate(() => ({ title: document.querySelector("#folderView .fv-in h1")?.textContent, on: !!document.querySelector("#folderView .fv-row.on") }));
  check("on a wide screen, the newest concept opens beside the list", first.title === "Offer first" && first.on, JSON.stringify(first));
  await page.fill("#fvFilter", "zzz");
  check("its filter narrows the list", (await page.$$("#folderView .fv-row")).length === 0);
  await page.fill("#fvFilter", "");
  await page.click("#folderView .fv-row");
  await page.waitForTimeout(150);
  const one = await page.evaluate(() => ({ title: document.querySelector("#folderView .fv-in h1")?.textContent,
    text: document.querySelector("#folderView .fv-doc")?.textContent || "", links: document.querySelectorAll("#folderView .vw-link").length }));
  check("a concept opens with its position, evidence and figures",
    one.title === "Offer first" && /bigger audience/.test(one.text) && /sold out twice/.test(one.text) && /31 percent/.test(one.text), one.text.slice(0, 160));
  check("and its links, each one clickable", one.links === 1);
  await page.click("#fvAsk");
  check("Ask about it fills the bar, scoped to the folder", /Offer first/.test(await page.inputValue("#input")) && /^Ask Content/.test(await page.getAttribute("#input", "placeholder") || ""));
  await page.fill("#input", "");
  await page.click("#fvClose");
  check("the close button returns to the chat", await page.evaluate(() => document.getElementById("folderView").hidden && !document.getElementById("thread").hidden));
  await page.hover(".brain-row"); await page.click(".brain-row .ed >> text=open"); await page.waitForTimeout(100);
  await page.click("#fvDrop"); await page.waitForTimeout(80);
  const into = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, val: document.getElementById("scopeVal").textContent }));
  check("Drop into it opens Drop on that folder", into.view === "drop" && into.val === "Content", JSON.stringify(into));
  await page.click("#dropClose");
  await page.hover(".brain-row"); await page.click(".brain-row .ed >> text=open"); await page.waitForTimeout(100);
  await page.click("#fvChat"); await page.waitForTimeout(80);
  const chatIn = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, ph: document.getElementById("input").placeholder, focus: document.activeElement?.id }));
  check("Chat in it opens a new chat on that folder", chatIn.view === "chat" && /^Ask Content/.test(chatIn.ph) && chatIn.focus === "input", JSON.stringify(chatIn));
  check("nothing threw in the open folder", !bad.length, bad.join(" | "));
  await page.close();
}

{
  const { page } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/ask")) { window.__asked = JSON.parse(opt?.body || "{}"); await new Promise(ok => setTimeout(ok, 400));
        return Response.json({ answer: "One line.", sources: 3, level: "normal" }); }
      return Response.json({});
    };
  }, STATE);

  /* ---- Learning: steps toward the answer, never the answer ---- */
  const levels = await page.evaluate(() => [...document.querySelectorAll("#level button")].map(b => ({
    v: b.dataset.v, icon: !!b.querySelector("svg path"), name: b.getAttribute("aria-label"), on: b.classList.contains("on") })));
  check("the levels are Normal, Educational and Learning", levels.map(l => l.v).join(",") === "normal,educational,learning",
    levels.map(l => l.v).join(","));
  check("each level carries an icon and a name", levels.every(l => l.icon && l.name));
  check("the level in use is lit", levels.filter(l => l.on).length === 1 && levels.find(l => l.on).v === "normal");
  await page.click('#level button[data-v="learning"]');
  const lit = await page.evaluate(() => document.querySelector("#level button.on")?.dataset.v);
  check("picking a level lights it", lit === "learning", String(lit));
  const note = await page.evaluate(() => document.getElementById("footNote").textContent);
  check("Learning says it gives steps, not the answer", /no answer given/i.test(note), note);
  await page.fill("#input", "why does gold hold value");
  await page.click("#send"); await page.waitForTimeout(800);
  const askedAt = await page.evaluate(() => window.__asked?.level);
  check("and the question goes out at that level", askedAt === "learning", String(askedAt));
  await page.close();
}

/* ---- the AI picks the grain from what the source is ---- */
for (const kind of ["study", "argument"]) {
  const { page, bad } = await boot("/chat.html", ([state, kind]) => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__plans = [];
    const topics = ["Accruals", "Depreciation", "Deferred revenue", "Matching", "Reconciliation"]
      .map(t => ({ topic: t, ideas: [t + " works like this."], data: [] }));
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-acc" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Accounting basics", kind, topics } });
      if (s.includes("/api/drop/plan")) {
        window.__plans.push(body);
        return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
          candidates: topics.slice(0, kind === "study" ? 5 : 2).map(t => ({ title: t.topic, brain: "content", why: "taught" })) } });
      }
      return Response.json({});
    };
  }, [STATE, kind]);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Accounting basics.pdf");
  await page.fill("#input", "Five rules, each explained.");
  await page.click("#send"); await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    sent: window.__plans[0]?.ext?.kind,
    note: document.querySelector(".coverage")?.textContent || "",
    button: [...document.querySelectorAll(".msg.ai button")].some(b => /File every topic/.test(b.textContent)) }));
  check(`a source read as ${kind} tells the plan so`, r.sent === kind, String(r.sent));
  check(`and the card says how it was read`,
    kind === "study" ? /Read as study material/.test(r.note) && /5 passages read, filed into 5 concepts/.test(r.note)
                     : /Read as an argument/.test(r.note) && /filed into 2 concepts/.test(r.note), r.note);
  check("with no button to second-guess it", !r.button);
  check("nothing threw", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a long source, planned and stored in batches ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    const topics = Array.from({ length: 60 }, (_, i) => ({ topic: `Rule ${i + 1}`, ideas: [`Rule ${i + 1} works like this.`], data: [] }));
    window.__plans = []; window.__settles = []; window.__live = 0; window.__peak = 0; window.__failHard = 2;
    window.__bodies = []; window.__links = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-long" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Long manual", topics } });
      if (s.includes("/api/drop/plan")) {
        window.__plans.push(body);
        return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
          candidates: body.ext.topics.map(t => ({ title: t.topic, brain: "content", why: "taught" })) } });
      }
      if (s.includes("/api/drop/link")) { window.__links.push(body.ids); return Response.json({ linking: body.ids.length }); }
      if (s.includes("/api/drop/settle")) {
        window.__bodies.push({ topics: Array.isArray(body.ext?.topics), full: !!body.fullPlan, later: !!body.linkLater,
          at: window.__live });
        window.__live++; window.__peak = Math.max(window.__peak, window.__live);
        await new Promise(ok => setTimeout(ok, 40));
        window.__live--;
        /* A part holding Rule 25 is too big for one call until it is down to
           two concepts. A part holding Rule 41 fails once for another reason. */
        const titles = body.plan.candidates.map(c => c.title);
        if (titles.includes("Rule 25") && titles.length > 2)
          return Response.json({ error: "deepseek/deepseek-v4-flash was still writing after 150 seconds. The job was too big for one call." });
        if (window.__failHard && titles.includes("Rule 41")) {
          window.__failHard--;
          return Response.json({ error: "that part could not be written" });
        }
        window.__settles.push(body.plan.candidates.map(c => c.title));
        return Response.json({ sid: "s-long", brains: ["content"], positions: body.plan.candidates.length, counted: [],
          written: body.plan.candidates.map(c => `content/${c.title.toLowerCase().replace(/\W+/g, "-")}`),
          counts: { new: 1, echo: 0 } });
      }
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Long manual.pdf");
  await page.fill("#input", "Sixty rules, each explained.");
  await page.evaluate(() => { window.__titles = []; new MutationObserver(() => window.__titles.push(document.title))
    .observe(document.querySelector("title"), { childList: true, characterData: true, subtree: true }); });
  await page.click("#send"); await page.waitForTimeout(700);
  const titles = await page.evaluate(() => [...new Set(window.__titles)]);
  check("the tab follows the drop, step by step", titles.includes("Checking \u00b7 Octopus") && titles.some(t => /^Filing \d+ of 3 \u00b7 Octopus$/.test(t))
    && (await page.title()) === "Octopus", titles.join(" | "));
  const planned = await page.evaluate(() => ({
    n: window.__plans.length, sizes: window.__plans.map(p => p.ext.topics.length),
    proposed: window.__plans.map(p => (p.proposed || []).length),
    note: document.querySelector(".coverage")?.textContent || "" }));
  check("60 topics are planned in 3 batches", planned.n === 3 && planned.sizes.join(",") === "25,25,10", planned.sizes.join(","));
  check("the first part plans alone, the next ones see its titles", planned.proposed.join(",") === "0,25,25", planned.proposed.join(","));
  check("and every topic is filed", /60 passages read, filed into 60 concepts/.test(planned.note), planned.note);

  /* ---- a source is stored under a named author ---- */
  const who = await page.evaluate(() => ({ value: document.getElementById("cardAuthor")?.value,
    hint: document.querySelector(".author-hint")?.textContent }));
  check("a source naming no one shows an empty author to fill", who.value === "" && /names no one/.test(who.hint || ""), JSON.stringify(who));
  await page.click(".card-foot .go"); await page.waitForTimeout(200);
  check("Store it waits for an author, and stores nothing", await page.evaluate(() => window.__settles.length) === 0
    && /Write the author first/.test(await page.textContent(".author-hint")) && await page.evaluate(() => document.getElementById("cardAuthor").classList.contains("bad")));
  await page.fill("#cardAuthor", "Unknown");
  await page.click(".card-foot .go"); await page.waitForTimeout(200);
  check("\"Unknown\" is not a name", await page.evaluate(() => window.__settles.length) === 0);
  await page.fill("#cardAuthor", "Jane Roe");
  await page.evaluate(() => { window.__authors = []; const f = window.fetch; window.fetch = async (u, o) => {
    if (String(u).includes("/api/drop/settle")) window.__authors.push(JSON.parse(o.body).ext?.author); return f(u, o); }; });
  await page.click(".card-foot .go"); await page.waitForTimeout(900);
  const sentAs = await page.evaluate(() => [...new Set(window.__authors)]);
  check("with a name, every part is stored under it", sentAs.length === 1 && sentAs[0] === "Jane Roe", JSON.stringify(sentAs));
  const first = await page.evaluate(() => ({ stored: window.__settles.flat().length, peak: window.__peak,
    msg: [...document.querySelectorAll(".msg.ai")].pop()?.textContent || "" }));
  const split = await page.evaluate(() => window.__settles.filter(t => t.some(x => /^Rule (2[5-9]|3[0-2])$/.test(x))).map(t => t.length));
  check("a part too big for one call is split by itself until it fits", split.join(",") === "2,2,4", split.join(","));
  check("a part that failed for another reason says how much is stored", /Part of it is stored/.test(first.msg)
    && /52 of 60 concepts are stored/.test(first.msg), first.msg.slice(0, 160));
  check("after the other parts, and one more try of its own", await page.evaluate(() => window.__failHard) === 0);
  check("never more than 3 calls at once", first.peak <= 3 && first.peak >= 2, String(first.peak));

  await page.click(".card-foot .go"); await page.waitForTimeout(900);
  const done = await page.evaluate(() => {
    const all = window.__settles.flat();
    return { total: all.length, unique: new Set(all).size, receipt: document.querySelector(".receipt")?.textContent || "" };
  });
  check("Store it again finishes the rest", done.total === 60, String(done.total));
  check("and repeats no concept already stored", done.unique === 60, `${done.unique} unique of ${done.total}`);
  check("the receipt counts every position", /Rewritten: 60 positions/.test(done.receipt), done.receipt.slice(0, 120));
  check("nothing threw across the batches", !bad.length, bad.join(" | "));
  const sent = await page.evaluate(() => ({ bodies: window.__bodies, links: window.__links }));
  const withText = sent.bodies.filter(x => x.topics);
  check("the source's text travels with the first part only", withText.length === 1 && sent.bodies[0].topics && sent.bodies[0].full,
    JSON.stringify(sent.bodies.map(x => +x.topics).join("")));
  check("the first part runs alone", sent.bodies[0].at === 0 && sent.bodies[1]?.at === 0, JSON.stringify(sent.bodies.slice(0, 3)));
  check("every part leaves linking for the end", sent.bodies.every(x => x.later));
  check("linking is asked for once, with all 60 concepts", sent.links.length === 1 && new Set(sent.links[0]).size === 60,
    JSON.stringify(sent.links.map(l => l.length)));
  await page.close();
}

/* ---- a stored source read again into the same brain ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__reads = 0;
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: true, sid: "s-acc", brains: ["content"], date: "2026-09-01" });
      if (s.includes("/api/drop/read")) { window.__reads++; return Response.json({ part: { title: "Accounting basics",
        topics: [{ topic: "Accruals", ideas: ["x"], data: [] }] } }); }
      if (s.includes("/api/drop/plan")) return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
        candidates: [{ title: "Accruals", brain: "content", why: "taught" }] } });
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Accounting basics.pdf");
  await page.fill("#input", "Accruals explained.");
  await page.click("#send"); await page.waitForTimeout(300);
  const offered = await page.evaluate(() => [...document.querySelectorAll(".msg.ai button")].map(b => b.textContent));
  check("a stored source offers to read it again here", offered.includes("Read it again here"), offered.join(","));
  await page.click("text=Read it again here"); await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ reads: window.__reads, card: !!document.querySelector(".msg.ai .card, .msg.ai [class*=card]"),
    mine: document.querySelectorAll(".msg.me").length }));
  check("and reads it again", r.reads === 1, String(r.reads));
  check("without repeating your message", r.mine === 1, String(r.mine));
  check("nothing threw reading it again", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- long titles that open the same way stay apart ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    const topics = Array.from({ length: 30 }, (_, i) => ({ topic: `Part ${i + 1}`, ideas: ["x"], data: [] }));
    const A = "Forward contract hedge for Ziggy receivables: detailed borrowing and investing steps";
    const B = "Forward contract hedge for Ziggy receivables: detailed cost comparison";
    const C = "Discount offer analysis for Ziggy Indonesia: comparison with money market hedge";
    const D = "Discount offer analysis for Ziggy Indonesia: comparison with forward contract";
    /* The second batch names A again: that one is the same idea, so it merges. */
    const byBatch = [[A, B], [C, D, A]];
    window.__n = 0;
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-zig" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Ziggy case", kind: "study", topics } });
      if (s.includes("/api/drop/plan")) return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
        candidates: byBatch[window.__n++ % 2].map(title => ({ title, brain: "content", why: "taught" })) } });
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Ziggy case.pdf");
  await page.fill("#input", "A hedging case study.");
  await page.click("#send"); await page.waitForTimeout(700);
  const note = await page.evaluate(() => document.querySelector(".coverage")?.textContent || "");
  check("four look-alike long titles are four concepts", /filed into 4 concepts/.test(note), note);
  check("nothing threw with long titles", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a drop survives a busy model, knows its own source, and files each concept once ---- */
{
  const held = { ...STATE, concepts: [{ brain: "content", slug: "offer-creation", n: 1, title: "Offer creation", position: "p",
    summaryLine: "", evidence: [], data: [], conflicts: [], sources: [], related: [] }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__checks = []; window.__reads = 0; window.__settles = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) { window.__checks.push(body); return Response.json({ duplicate: false, sid: "s-doc" }); }
      if (s.includes("/api/drop/read")) {
        /* The first read meets a busy model. */
        if (window.__reads++ === 0) return Response.json({ error: "the model answered 429: rate limit" });
        return Response.json({ part: { title: "Guide", kind: "study", topics: [{ topic: "Offers", ideas: ["x"], data: [] }] } });
      }
      if (s.includes("/api/drop/plan")) return Response.json({ plan: { brains: ["content"], new: ["x"], echo: [], conflicts: [],
        matched: [{ conceptId: "content/offer-creation", brain: "content", whatItAdds: "from the match" }],
        candidates: [{ title: "Offer creation", brain: "content", why: "from the candidate" }] } });
      if (s.includes("/api/drop/settle")) {
        window.__settles.push(body.plan);
        return Response.json({ sid: "s-doc", brains: ["content"], positions: 1, counted: [], missed: [], counts: { new: 1, echo: 0 } });
      }
      return Response.json({});
    };
  }, held);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Guide.pdf");
  await page.fill("#input", "Chapter one. The licence is at https://creativecommons.org/licenses/by/4.0/ and applies.");
  await page.click("#send"); await page.waitForTimeout(6000);
  const got = await page.evaluate(() => ({ checks: window.__checks, reads: window.__reads,
    card: !!document.querySelector(".card-foot .go") }));
  check("a link deep inside a document is not its identity", got.checks[0]?.link === "", JSON.stringify(got.checks[0]));
  check("the document is fingerprinted by its text", /^Guide\.pdf #\w+$/.test(got.checks[0]?.text || ""), got.checks[0]?.text);
  check("a busy model is tried again, not fatal", got.reads === 2 && got.card, `${got.reads} reads, card ${got.card}`);
  await page.fill("#cardAuthor", "Guide Team");
  await page.click(".card-foot .go"); await page.waitForTimeout(600);
  const stored = await page.evaluate(() => ({ plans: window.__settles,
    msg: [...document.querySelectorAll(".msg.ai")].pop()?.textContent || "" }));
  const units = stored.plans.flatMap(p => [...p.matched, ...p.candidates]);
  check("a candidate the brain already holds is filed as that concept, once", units.length === 1 && stored.plans[0].matched.length === 1,
    JSON.stringify(stored.plans));
  check("carrying both claims", /from the match/.test(units[0]?.whatItAdds) && /from the candidate/.test(units[0]?.whatItAdds), JSON.stringify(units[0]));
  check("the receipt counts what the server wrote", /Rewritten: 1 position\b/.test(stored.msg), stored.msg.slice(0, 160));
  check("and claims nothing it did not check", !/Coherent|summar/.test(stored.msg), stored.msg.slice(0, 200));
  check("nothing threw", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a long source plans three parts at a time, then merges twin titles ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    const topics = Array.from({ length: 250 }, (_, i) => ({ topic: `Rule ${i + 1}`, ideas: [`Rule ${i + 1} works like this.`], data: [] }));
    window.__plans = []; window.__live = 0; window.__peak = 0; window.__merge = null;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-par" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Big manual", kind: "study", topics } });
      if (s.includes("/api/drop/plan")) {
        window.__live++; window.__peak = Math.max(window.__peak, window.__live);
        window.__plans.push((body.proposed || []).length);
        await new Promise(ok => setTimeout(ok, 30));
        window.__live--;
        const first = body.ext.topics[0].topic;
        /* Two parts name one idea in two ways. */
        const extra = first === "Rule 26" ? [{ title: "Hedging with forwards", brain: "content", why: "part two" }]
          : first === "Rule 51" ? [{ title: "Forward contract hedging", brain: "content", why: "part three" },
                                   { title: "Money market hedge", brain: "content", why: "x", related: ["content/Forward contract hedging"] }] : [];
        return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
          candidates: [...body.ext.topics.map(t => ({ title: t.topic, brain: "content", why: "taught" })), ...extra] } });
      }
      if (s.includes("/api/drop/settle")) {
        (window.__stored ??= []).push(...body.plan.candidates);
        return Response.json({ sid: "s-par", brains: ["content"], positions: body.plan.candidates.length, counted: [],
          written: body.plan.candidates.map(c => `content/${c.title.toLowerCase().replace(/\W+/g, "-")}`) });
      }
      if (s.includes("/api/drop/link")) { window.__link = body; return Response.json({ linking: body.ids.length }); }
      if (s.includes("/api/drop/merge")) {
        window.__merge = body.candidates;
        const a = body.candidates.findIndex(c => c.title === "Hedging with forwards");
        const b = body.candidates.findIndex(c => c.title === "Forward contract hedging");
        return Response.json({ same: [[a + 1 - 1, b + 1 - 1].map(x => x)] });
      }
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Big manual.pdf");
  await page.fill("#input", "Two hundred fifty rules.");
  await page.click("#send"); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ plans: window.__plans, peak: window.__peak, merge: window.__merge,
    note: document.querySelector(".coverage")?.textContent || "" }));
  check("ten parts are planned", r.plans.length === 10, String(r.plans.length));
  check("three at a time, never more", r.peak === 3, String(r.peak));
  check("the first part plans before the rest start", r.plans[0] === 0 && r.plans.slice(1).every(n => n > 0), r.plans.join(","));
  check("twin titles from parts planned together are merged into one concept",
    !!r.merge && /filed into 252 concepts/.test(r.note), r.note);
  await page.fill("#cardAuthor", "Big Manual Press");
  await page.click(".card-foot .go"); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ mm: (window.__stored || []).find(c => c.title === "Money market hedge"), link: window.__link }));
  check("a link to a merged title now names the title kept", JSON.stringify(st.mm?.related) === JSON.stringify(["content/Hedging with forwards"]),
    JSON.stringify(st.mm?.related));
  check("linking is asked for with the drop's source", st.link?.sid === "s-par" && st.link?.ids?.length === 252, JSON.stringify(st.link)?.slice(0, 120));
  check("nothing threw planning in parallel", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the author: filled in when found, picked from the brain's own when not ---- */
for (const found of ["Charles Gave", "", "youtube"]) {
  const held = { ...STATE,
    brains: [...STATE.brains, { slug: "health", name: "Health", type: "subject", scope: "sleep" }],
    sources: [
      { sid: "s1", author: "Alex Hormozi", brains: ["content"], title: "a" },
      { sid: "s2", author: "Alex Hormozi", brains: ["content"], title: "b" },
      { sid: "s3", author: "Marc Durand", brains: ["content"], title: "c" },
      { sid: "s4", author: "unknown", brains: ["content"], title: "d" },
      { sid: "s5", author: "Sleep Doc", brains: ["health"], title: "e" },
    ] };
  const { page, bad } = await boot("/chat.html", ([state, found]) => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__authors = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-new", ...(found === "youtube" ? { channel: "Finary" } : {}) });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Offers", author: found === "youtube" ? "Nicolas Chéron" : found,
        topics: [{ topic: "Offers", ideas: ["x"], data: [] }] } });
      if (s.includes("/api/drop/plan")) return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
        candidates: [{ title: "Offer stacking", brain: "content", why: "new" }] } });
      if (s.includes("/api/drop/settle")) { window.__authors.push(body.ext?.author);
        return Response.json({ sid: "s-new", brains: ["content"], positions: 1, counted: [], written: ["content/offer-stacking"], counts: { new: 1, echo: 0 } }); }
      return Response.json({});
    };
  }, [held, found]);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", found === "youtube" ? "https://youtu.be/goldTalk42" : "Offers talk");
  await page.fill("#input", "Stack the offer until saying no feels stupid.");
  /* The tab is looked away from while it works. */
  if (found === "") await page.evaluate(() => { window.__hidden = true; Object.defineProperty(document, "hidden", { get: () => window.__hidden, configurable: true }); });
  await page.click("#send"); await page.waitForTimeout(900);
  if (found === "") {
    check("a card that lands in a hidden tab says so in the tab", await page.title() === "Card ready \u00b7 Octopus", await page.title());
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    check("and the tab goes back to its name once looked at", await page.title() === "Octopus", await page.title());
  }
  const f = await page.evaluate(() => ({ value: document.getElementById("cardAuthor")?.value,
    shown: !document.getElementById("cardAuthor")?.hidden, pick: !!document.getElementById("cardAuthorPick"),
    options: [...(document.getElementById("cardAuthorPick")?.options || [])].map(o => o.textContent) }));
  if (found === "youtube") {
    check("a YouTube drop is filed under its channel, not its speaker", f.value === "Finary" && f.shown && !f.pick
      && /YouTube channel/.test(await page.textContent(".author-hint")), JSON.stringify(f));
    await page.click(".card-foot .go"); await page.waitForTimeout(400);
    check("and stores under it", JSON.stringify(await page.evaluate(() => window.__authors)) === '["Finary"]');
  } else if (found) {
    check("a found author is filled in, with no list to pick from", f.value === "Charles Gave" && f.shown && !f.pick, JSON.stringify(f));
    await page.click(".card-foot .go"); await page.waitForTimeout(400);
    check("and stores as it is", JSON.stringify(await page.evaluate(() => window.__authors)) === '["Charles Gave"]');
  } else {
    check("with none found, the brain's own authors are offered, most frequent first",
      f.pick && !f.shown && f.options.join("|") === "Pick the author|Alex Hormozi|Marc Durand|Someone else...", JSON.stringify(f));
    await page.click(".card-foot .go"); await page.waitForTimeout(200);
    check("Store it waits for a pick", await page.evaluate(() => window.__authors.length) === 0
      && /Pick the author first/.test(await page.textContent(".author-hint")));
    await page.selectOption("#cardAuthorPick", "__other__");
    check("someone else opens a box for a new name", await page.isVisible("#cardAuthor"));
    await page.selectOption("#cardAuthorPick", "Marc Durand");
    check("and a pick closes it again", !(await page.isVisible("#cardAuthor")));
    await page.click(".card-foot .go"); await page.waitForTimeout(400);
    check("the picked author is the one stored", JSON.stringify(await page.evaluate(() => window.__authors)) === '["Marc Durand"]',
      JSON.stringify(await page.evaluate(() => window.__authors)));
  }
  check("nothing threw on the author", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the sidebar: one list, a mark for a person or a subject ---- */
{
  const mixed = { ...STATE,
    brains: [{ slug: "content", name: "Content", type: "subject", scope: "c" }, { slug: "detente", name: "Richard Detente", type: "person", scope: "d" },
             { slug: "health", name: "Health", type: "subject", scope: "h" }],
    concepts: [..."abc"].map((x, i) => ({ brain: "content", slug: "c" + i, n: i + 1, title: "C" + i }))
      .concat([..."abcde"].map((x, i) => ({ brain: "detente", slug: "d" + i, n: i + 1, title: "D" + i })))
      .concat([{ brain: "health", slug: "h0", n: 1, title: "H0" }]) };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, o) => {
      const s = String(u);
      window.__calls.push({ s, body: o && o.body ? JSON.parse(o.body) : null });
      if (s.includes("/api/ask")) return Response.json({ answer: "From two folders.", sources: 2 });
      if (s.includes("/api/onepager")) return Response.json({ error: "not built in this check" });
      return Response.json(s.includes("/api/state") ? state : {});
    };
  }, mixed);
  const side = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("#brains .brain-row")].map(r => `${r.querySelector(".nm").textContent}:${r.querySelector(".b-ic")?.getAttribute("aria-label")}`),
    heads: [...document.querySelectorAll("#brains .group-h")].map(h => h.textContent).join(",") }));
  check("the folders group by type, People then Subjects, the fullest first in each",
    side.rows.join(",") === "Richard Detente:Person,Content:Subject,Health:Subject" && side.heads === "People,Subjects", JSON.stringify(side));
  const sized = await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row .cnt")].map(x => x.textContent).join(","));
  const counts = sized.split(",").map(Number);
  check("each row shows how many concepts it holds", counts.length === 3 && counts[1] >= counts[2], sized);

  /* The one-pager is built from several folders at once. */
  await page.evaluate(() => document.getElementById("pagerBtn").click()); await page.waitForTimeout(100);
  await page.click('#pPick .pm-chip[data-v="content"]'); await page.click('#pPick .pm-chip[data-v="health"]');
  const multi = await page.evaluate(() => ({ on: [...document.querySelectorAll("#pPick .pm-chip.on")].map(o => o.dataset.v).join(","),
    hint: document.getElementById("pPickHint").textContent }));
  check("Built from takes several folders, and says which", multi.on === "content,health" && multi.hint === "Content and Health.", JSON.stringify(multi));
  await page.click('#pPick .pm-head[data-g="person"]');
  check("a group's name ticks the whole group", await page.evaluate(() => [...document.querySelectorAll("#pPick .pm-chip.on")].map(o => o.dataset.v).join(",")) === "detente,content,health");
  await page.click('#pPick .pm-head[data-g="person"]');
  await page.click("#pGo"); await page.waitForTimeout(150);
  const sentPick = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/onepager"))?.body?.pick);
  check("and the page is asked of exactly those", sentPick === "content,health", String(sentPick));

  /* Ticking: one row is that folder, two ask both, and the question carries the list. */
  const rowOf = n => `#brains .brain-row:has(.nm:text-is("${n}"))`;
  await page.click(rowOf("Content"));
  const one = await page.evaluate(() => ({ on: [...document.querySelectorAll("#brains .brain-row.on .nm")].map(x => x.textContent).join(","),
    val: document.getElementById("scopeVal").textContent, ph: document.getElementById("input").placeholder }));
  check("a click ticks a folder, and the box asks it", one.on === "Content" && one.val === "Content" && one.ph === "Ask Content.", JSON.stringify(one));
  await page.click(rowOf("Health"));
  const two = await page.evaluate(() => ({ on: [...document.querySelectorAll("#brains .brain-row.on")].map(r => r.querySelector(".nm").textContent + ":" + r.getAttribute("aria-pressed")).join(","),
    val: document.getElementById("scopeVal").textContent, ph: document.getElementById("input").placeholder,
    box: getComputedStyle(document.querySelector("#brains .brain-row.on .tbox")).display, go: document.getElementById("sideGo").textContent }));
  check("a second click ticks a second folder, and both are asked", two.on === "Content:true,Health:true" && two.val === "Content +1"
    && two.ph === "Ask Content and Health.", JSON.stringify(two));
  check("a ticked row shows its box, and the phone button counts them", two.box !== "none" && two.go === "Chat in 2 folders", JSON.stringify(two));
  await page.fill("#input", "What holds across both?"); await page.click("#send"); await page.waitForTimeout(200);
  const asked = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/ask")).map(c => c.body).pop());
  check("the question travels with the two folders ticked", asked && asked.brain === "all" && (asked.brains || []).join(",") === "content,health", JSON.stringify(asked));
  await page.click(rowOf("Health"));
  const back = await page.evaluate(() => ({ on: [...document.querySelectorAll("#brains .brain-row.on .nm")].map(x => x.textContent).join(","), val: document.getElementById("scopeVal").textContent }));
  check("a click on a ticked folder unticks it", back.on === "Content" && back.val === "Content", JSON.stringify(back));
  await page.click(rowOf("Content"));
  check("and with none ticked, the box asks every folder", await page.evaluate(() => document.getElementById("scopeVal").textContent) === "All folders");
  await page.mouse.move(900, 400);
  const room = await page.evaluate(() => getComputedStyle(document.querySelector("#brains .brain-row:not(.on) .ed")).display);
  check("a row's open and edit take no room until it is pointed at", room === "none", room);
  await page.hover("#brains .brain-row");
  check("and show when it is", await page.evaluate(() => getComputedStyle(document.querySelector("#brains .brain-row .ed")).display) !== "none");
  check("nothing threw on the list", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- Setup: the real open conflicts, each settled in place ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__settles = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts/settle")) { window.__settles.push(body);
        return Response.json(body.pick === "both" ? { ok: true } : { ok: true, position: "Rates fell around AI releases.", summaryLine: "Long rates fell around AI releases." }); }
      if (s.includes("/api/conflicts")) return Response.json({ others: 8, conflicts: [
        { id: "content/ai-rates", brain: "content", title: "Financing AI", a: "AI pushes rates up", aDate: "", b: "Rates fell around AI releases", bDate: "2026-09-01", why: "Crowding out implies higher rates" },
        { id: "content/paywall", brain: "content", title: "Scaling at $10k MRR", a: "A hard paywall wins", aDate: "", b: "Growth runs on referrals", bDate: "", why: "" } ] });
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("keyBtn").click());
  await page.waitForTimeout(250);
  const shown = await page.evaluate(() => ({ count: document.getElementById("cfCount").textContent,
    items: [...document.querySelectorAll(".cf-item")].map(x => ({ title: x.querySelector(".cf-top b").textContent,
      sides: [...x.querySelectorAll(".cf-claim")].map(c => c.textContent), holds: x.querySelectorAll(".cf-go").length })),
    note: [...document.querySelectorAll("#cfSlot > .hint")].map(h => h.textContent).join(" ") }));
  check("Setup lists the real conflicts, each with both sides and a button on each",
    shown.count === "2" && shown.items.length === 2 && shown.items[0].sides.join("|") === "AI pushes rates up|Rates fell around AI releases"
    && shown.items.every(i => i.holds === 2), JSON.stringify(shown));
  check("and says how many were additions, not contradictions", /8 more add detail/.test(shown.note), shown.note);
  await page.click(".cf-item >> nth=0 >> .cf-go >> nth=1"); await page.waitForTimeout(200);
  const one = await page.evaluate(() => ({ sent: window.__settles[0], text: document.querySelector(".cf-item.done")?.textContent,
    count: document.getElementById("cfCount").textContent }));
  check("This holds settles on that side and shows the new position", one.sent?.pick === "b" && one.sent?.id === "content/ai-rates"
    && /Settled\. The position now reads: Long rates fell/.test(one.text || "") && one.count === "1", JSON.stringify(one));
  await page.click(".cf-item:not(.done) .mini"); await page.waitForTimeout(200);
  const two = await page.evaluate(() => ({ sent: window.__settles[1], count: document.getElementById("cfCount").textContent,
    none: /None to settle\. 8 recorded clashes add detail/.test(document.getElementById("cfSlot").textContent) }));
  check("Both hold clears the last one, and the list says none are left", two.sent?.pick === "both" && two.count === "" && two.none, JSON.stringify(two));
  check("nothing threw settling conflicts", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the conflict deck: one clash at a time, a swipe or a key settles it ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__settles = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts/settle")) { window.__settles.push(body);
        return Response.json(body.pick === "both" ? { ok: true } : { ok: true, position: "P.", summaryLine: "S." }); }
      if (s.includes("/api/conflicts")) return Response.json({ others: 3, conflicts: [
        { id: "content/ai-rates", brain: "content", title: "Financing AI", a: "AI pushes rates up", aDate: "2026-01-02", b: "Rates fell around AI releases", bDate: "2026-09-01", why: "Crowding out implies higher rates" },
        { id: "content/paywall", brain: "content", title: "Scaling at $10k MRR", a: "A hard paywall wins", aDate: "", b: "Growth runs on referrals", bDate: "", why: "" } ] });
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("keyBtn").click());
  await page.waitForTimeout(250);
  check("Setup offers the conflicts one by one", (await page.textContent("#cfDeck")) === "Review one by one: 2", await page.textContent("#cfDeck"));
  await page.click("#cfDeck"); await page.waitForTimeout(150);
  const card = () => page.evaluate(() => {
    const c = document.querySelector(".dk-card:not(.gone)");
    return { title: c?.querySelector("h4")?.textContent || "", n: document.getElementById("dkN").textContent,
      sides: [...(c?.querySelectorAll(".dk-side p") || [])].map(p => p.textContent), undo: !document.getElementById("dkUndo").hidden,
      toast: document.getElementById("dkToast").textContent, done: document.querySelector(".dk-done")?.textContent || "" };
  });
  const first = await card();
  check("the deck opens on the first clash, both sides shown", first.title === "Financing AI" && first.n === "1 of 2"
    && first.sides.join("|") === "AI pushes rates up|Rates fell around AI releases" && !(await page.$(".sheet")), JSON.stringify(first));

  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  const after = await card();
  check("the right arrow keeps B and moves to the next clash, with an undo", after.title === "Scaling at $10k MRR" && after.n === "2 of 2"
    && after.undo && /B holds: Financing AI/.test(after.toast), JSON.stringify(after));
  check("and waits before it sends", (await page.evaluate(() => window.__settles.length)) === 0);
  await page.click("#dkUndo"); await page.waitForTimeout(100);
  const back = await card();
  check("Undo takes the ruling back, nothing sent", back.title === "Financing AI" && back.n === "1 of 2" && !back.undo
    && (await page.evaluate(() => window.__settles.length)) === 0, JSON.stringify(back));

  /* A swipe to the left, with the mouse as a finger. */
  const box = await page.$eval(".dk-card:not(.gone)", n => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 4, { steps: 4 });
  const stamp = await page.evaluate(() => ({ t: document.querySelector(".dk-card:not(.gone) .dk-stamp").textContent,
    lit: [...document.querySelectorAll(".dk-card:not(.gone) .dk-side.lit")].map(s => s.dataset.s).join() }));
  check("dragging left lights side A and says so", stamp.t === "A holds" && stamp.lit === "a", JSON.stringify(stamp));
  await page.mouse.move(box.x - 200, box.y + 6, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(4400);
  const sent = await page.evaluate(() => window.__settles);
  check("a swipe left settles on A once the undo window closes", sent.length === 1 && sent[0].pick === "a" && sent[0].id === "content/ai-rates", JSON.stringify(sent));

  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
  const end = await card();
  check("down leaves a clash for later, and the end says what is left", /1 settled/.test(end.done) && /1 left for later/.test(end.done)
    && /3 more add detail/.test(end.done), end.done);
  await page.click("#dkAgain"); await page.waitForTimeout(150);
  const again = await card();
  check("the ones left for later come round again", again.title === "Scaling at $10k MRR" && again.n === "1 of 1", JSON.stringify(again));
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(100);
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  const last = await page.evaluate(() => ({ sent: window.__settles, open: !!document.querySelector(".deck") }));
  check("closing sends what was waiting at once", last.sent.length === 2 && last.sent[1].pick === "both"
    && last.sent[1].id === "content/paywall" && !last.open, JSON.stringify(last));
  check("nothing threw in the deck", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- chats: saved, listed, reopened, renamed, pinned and deleted ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__asks = []; window.__edits = [];
    const chats = [
      { id: "k1", title: "Is gold a hedge?", brain: "content", pinned: true, updated: Date.now(), turns: 2 },
      { id: "k2", title: "Cold email openers", brain: "all", pinned: false, updated: Date.now() - 3600e3, turns: 1 } ];
    window.__chats = chats;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/chats/get")) return Response.json({ chat: { id: body.id, title: "Is gold a hedge?", brain: "content", pinned: true,
        turns: [{ q: "Is gold a hedge?", a: "Gold held its value over 20 years.\n\nSources: Gave, 2025-03-01", sources: 4, level: "normal" },
                { q: "And since 2001?", a: "It rose 12% a year.", sources: 4, level: "normal" }] } });
      if (s.includes("/api/chats/edit")) { window.__edits.push(body);
        if (body.pinned === true) return Response.json({ error: "5 chats are pinned already. Unpin one first." });
        if (body.remove) window.__chats = window.__chats.filter(c => c.id !== body.id);
        if (body.title) window.__chats = window.__chats.map(c => c.id === body.id ? { ...c, title: body.title } : c);
        return Response.json({ ok: true }); }
      if (s.includes("/api/chats")) return Response.json({ chats: window.__chats });
      if (s.includes("/api/ask")) { window.__asks.push(body);
        if (!body.chat) window.__chats = [{ id: "k9", title: body.q, brain: body.brain, pinned: false, updated: Date.now(), turns: 1 }, ...window.__chats];
        return Response.json({ answer: "One line.", sources: 12, level: "normal", chat: body.chat || "k9" }); }
      return Response.json({});
    };
  }, STATE);
  await page.waitForTimeout(200);
  const listed = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#chats .chat-row")].map(r => ({
    t: r.querySelector(".nm").textContent, b: r.querySelector(".cb").textContent, pin: !!r.querySelector(".pin") })),
    count: document.getElementById("ccount").textContent }));
  check("the chats are listed, pinned first, each with the brain it asked", listed.count === "2" && listed.rows[0].t === "Is gold a hedge?"
    && listed.rows[0].pin && /^Content · 2 questions$/.test(listed.rows[0].b) && /^All folders · 1 question$/.test(listed.rows[1].b), JSON.stringify(listed));

  await page.click("#chatsFold");
  const folded = await page.evaluate(() => ({ hidden: document.getElementById("chatsBox").hidden, exp: document.getElementById("chatsFold").getAttribute("aria-expanded"),
    kept: JSON.parse(localStorage.getItem("octopus.fold") || "{}").chats }));
  check("Chats folds, and the browser remembers it", folded.hidden && folded.exp === "false" && folded.kept === true, JSON.stringify(folded));
  await page.click("#chatsFold");

  /* A row's one button opens its menu; an item is picked by its label. */
  const rowMenu = async n => { await page.hover(`#chats .chat-row >> nth=${n} >> .nm`); await page.click(`#chats .chat-row >> nth=${n} >> .more`); };
  const pick = label => page.evaluate(label => { for (const x of document.querySelectorAll(".chat-menu .cm-it")) if (x.textContent === label) x.click(); }, label);
  const rowAct = async (n, label) => { await rowMenu(n); await page.waitForTimeout(60); await pick(label); };
  await page.click("#chats .chat-row >> nth=0 >> .nm"); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => ({ me: [...document.querySelectorAll(".msg.me .body")].map(b => b.textContent),
    ai: [...document.querySelectorAll(".msg.ai .body .para")].map(b => b.textContent),
    scope: document.getElementById("scopeVal")?.textContent, on: document.querySelector("#chats .chat-row.on .nm")?.textContent }));
  check("reopening a chat shows its questions and answers, on the brain it asked", opened.me.join("|") === "Is gold a hedge?|And since 2001?"
    && /held its value/.test(opened.ai[0]) && opened.scope === "Content" && opened.on === "Is gold a hedge?", JSON.stringify(opened));

  await page.fill("#input", "And in euros?");
  await page.click("#send"); await page.waitForTimeout(300);
  const cont = await page.evaluate(() => window.__asks.at(-1));
  check("a question asked there continues that chat, with its thread", cont.chat === "k1" && cont.brain === "content"
    && cont.history.length === 2 && cont.history[1].q === "And since 2001?", JSON.stringify(cont));

  await page.click("#newChat"); await page.waitForTimeout(100);
  await page.fill("#input", "What is a hook?");
  await page.click("#send"); await page.waitForTimeout(400);
  const fresh = await page.evaluate(() => ({ sent: window.__asks.at(-1), rows: document.querySelectorAll("#chats .chat-row").length,
    on: document.querySelector("#chats .chat-row.on .nm")?.textContent }));
  check("New starts a fresh chat, which then joins the list", fresh.sent.chat === null && fresh.sent.history.length === 0 && fresh.rows === 3
    && fresh.on === "What is a hook?", JSON.stringify(fresh));

  const menu = await page.evaluate(() => ({ each: [...document.querySelectorAll("#chats .chat-row")].map(r => r.querySelectorAll(".more").length),
    old: document.querySelectorAll("#chats .chat-row .ed").length }));
  check("each chat has one button for its actions", menu.each.every(n => n === 1) && menu.old === 0, JSON.stringify(menu));
  /* Row 1 is the pinned chat: the new one went on top. */
  await rowMenu(1); await page.waitForTimeout(60);
  const items = await page.evaluate(() => [...document.querySelectorAll(".chat-menu .cm-it")].map(x => x.textContent));
  check("it opens pin, rename and delete, Unpin on a pinned chat", items.join("|") === "Unpin|Rename|Delete", items.join("|"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(60);
  check("Escape closes the menu", !(await page.$(".chat-menu")));
  await rowAct(2, "Pin"); await page.waitForTimeout(150);
  check("a sixth pin says why it is refused", /5 chats are pinned already/.test(await page.textContent("#chatMsg")) && await page.isVisible("#chatMsg"));

  await rowAct(2, "Rename"); await page.waitForTimeout(80);
  await page.fill("#rnT", "Openers");
  await page.click("#rnGo"); await page.waitForTimeout(200);
  check("rename saves the new name", (await page.evaluate(() => [...document.querySelectorAll("#chats .chat-row .nm")].map(n => n.textContent))).includes("Openers"));

  await rowAct(2, "Delete"); await page.waitForTimeout(80);
  const asked = await page.evaluate(() => ({ sure: document.querySelector(".chat-menu .cm-it.sure")?.textContent, sent: window.__edits.filter(e => e.remove).length }));
  check("delete asks once more in the menu before it goes", asked.sure === "Sure? Delete" && asked.sent === 0, JSON.stringify(asked));
  await pick("Sure? Delete"); await page.waitForTimeout(200);
  const gone = await page.evaluate(() => ({ removed: window.__edits.filter(e => e.remove).map(e => e.id), rows: document.querySelectorAll("#chats .chat-row").length }));
  check("the second tap deletes it", JSON.stringify(gone.removed) === '["k2"]' && gone.rows === 2, JSON.stringify(gone));

  /* A drop is not a question: it runs on its own screen, and the chat waits as it was. */
  await page.click("#chats .chat-row >> nth=1 >> .nm"); await page.waitForTimeout(200);
  const asksBefore = await page.evaluate(() => window.__asks.length);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "https://example.com/a-post");
  await page.click("#send"); await page.waitForTimeout(300);
  const dropped = await page.evaluate(() => ({ chat: document.getElementById("thread").hidden,
    here: [...document.querySelectorAll("#dropThread .msg.me .body")].some(b => /a-post/.test(b.textContent)),
    mixed: [...document.querySelectorAll("#thread .msg.me .body")].some(b => /a-post/.test(b.textContent)), asks: window.__asks.length }));
  check("a drop lands on the Drop screen and is never saved as a chat", dropped.chat && dropped.here && !dropped.mixed && dropped.asks === asksBefore, JSON.stringify(dropped));
  await page.click("#dropClose"); await page.waitForTimeout(80);
  const back = await page.evaluate(() => ({ on: !!document.querySelector("#chats .chat-row.on"), shown: !document.getElementById("thread").hidden,
    old: [...document.querySelectorAll("#thread .msg.me .body")].some(b => b.textContent === "Is gold a hedge?") }));
  check("Back to the chat finds the chat as it was", back.on && back.shown && back.old, JSON.stringify(back));
  check("nothing threw in chats", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- health: a ring per brain, each part against the best brain ---- */
{
  const two = { ...STATE, brains: [...STATE.brains, { slug: "gave", name: "Charles Gave", type: "person", scope: "Gave", owner: null }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: ["content/offer"], health: [
        { slug: "content", score: 6.5, top: false, person: false, open: 1,
          best: "Back more concepts with a second source: 30% here, 100% in Charles Gave.",
          parts: { variety: { counted: true, pct: 83, say: "5 named authors, 9 unsigned. The most of any brain" },
                   depth: { counted: true, pct: 30, say: "30% of 40 concepts rest on 2+ sources. Best: Charles Gave, 100%" },
                   fresh: { counted: true, pct: 60, say: "Last source 9 days ago. Best: Charles Gave, today" },
                   conflicts: { counted: true, pct: 80, say: "1 open conflict in 40 concepts" } } },
        { slug: "gave", score: 10, top: true, person: true, open: 0, best: "The best brain: every other score is measured against it.",
          parts: { variety: { counted: false, pct: 100, say: "Not counted: a person brain is one voice, fed from the same channels." },
                   depth: { counted: true, pct: 100, say: "100% of 12 concepts rest on 2+ sources" },
                   fresh: { counted: true, pct: 100, say: "Last source today" }, conflicts: { counted: true, pct: 100, say: "No open conflict" } } }] });
      return Response.json({});
    };
  }, two);
  await page.waitForTimeout(250);
  const ring = await page.evaluate(() => { const r = document.querySelector('#brains .brain-row .hring');
    const rows = [...document.querySelectorAll("#brains .brain-row")].map(x => x.querySelector(".nm").textContent + ":" + x.querySelector(".hring text")?.textContent);
    return r ? { rows, tone: document.querySelector('#brains .brain-row .hring .ar').getAttribute("class") } : null; });
  check("each brain carries its score ring, the best one at 10", ring && ring.rows.includes("Content:6.5") && ring.rows.includes("Charles Gave:10"), JSON.stringify(ring));
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => r.querySelector(".nm").textContent === "Content").querySelector(".hring").click());
  await page.waitForTimeout(150);
  const sheet = await page.evaluate(() => ({ h: document.querySelector(".sheet h3")?.textContent, p: document.querySelector(".sheet header p")?.textContent,
    parts: [...document.querySelectorAll(".hb-row")].map(r => r.querySelector(".hb-top").textContent + " | " + r.querySelector(".hb-say").textContent),
    bar: document.querySelectorAll(".hb-row")[1]?.querySelector(".hb-bar i")?.style.width,
    best: document.querySelector(".hb-best")?.textContent, settle: !!document.getElementById("hbSettle"), scope: !!document.querySelector(".brain-row.on") }));
  check("tapping the ring shows each part as a share of the best, and the move", sheet.h === "Content: 6.5/10" && /best brain, Charles Gave, which reads 10/.test(sheet.p)
    && sheet.parts.length === 4 && /^Depth30% of the best \| 30% of 40 concepts/.test(sheet.parts[1]) && sheet.bar === "30%"
    && /Best moveBack more concepts with a second source/.test(sheet.best) && sheet.settle && !sheet.scope, JSON.stringify(sheet));
  await page.click("#hbDone");
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => r.querySelector(".nm").textContent === "Charles Gave").querySelector(".hring").click());
  await page.waitForTimeout(150);
  const person = await page.evaluate(() => ({ p: document.querySelector(".sheet header p")?.textContent,
    v: document.querySelector(".hb-row")?.textContent }));
  check("the best brain says it sets the bar, and a person skips variety", /The best brain here/.test(person.p) && /Variety\s*not counted/.test(person.v)
    && /one voice/.test(person.v), JSON.stringify(person));
  check("nothing threw on health", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the map: arms, suckers, links, conflicts ---- */
{
  const two = { ...STATE, brains: [...STATE.brains, { slug: "gave", name: "Charles Gave", type: "person", scope: "Gave", owner: null }],
    concepts: [{ brain: "content", slug: "offer", n: 1, title: "Offer first", summaryLine: "", src: 4, ev: 3, links: 1 },
               { brain: "content", slug: "brand", n: 2, title: "Personal brand", summaryLine: "", src: 1, ev: 1, links: 0 },
               { brain: "gave", slug: "gold", n: 1, title: "Gold", summaryLine: "", src: 2, ev: 2, links: 1 }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u); window.__calls.push(s);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: ["content/offer"], health: [
        { slug: "content", score: 8, open: 1, best: "x", parts: {} }, { slug: "gave", score: 3, open: 0, best: "y", parts: {} }] });
      if (s.includes("/api/map")) return Response.json({ links: [["content/offer", "gave/gold"]] });
      if (s.includes("/api/concept")) return Response.json({ concept: { brain: "content", slug: "offer", n: 1, title: "Offer first", summaryLine: "S.",
        position: "P.", evidence: [], data: [], conflicts: [], sources: [], related: [] } });
      if (s.includes("/api/conflicts")) return Response.json({ others: 0, conflicts: [
        { id: "content/offer", brain: "content", title: "Offer first", a: "A", aDate: "", b: "B", bDate: "", why: "" }] });
      return Response.json({});
    };
  }, two);
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(200);
  await page.click("#setMap"); await page.waitForTimeout(400);
  const drawn = await page.evaluate(() => ({ arms: document.querySelectorAll(".mp-arm").length, person: document.querySelectorAll(".mp-arm.person").length,
    suckers: [...document.querySelectorAll(".mp-sk")].map(c => c.dataset.id + ":" + c.getAttribute("r")), links: document.querySelectorAll(".mp-link").length,
    dots: [...document.querySelectorAll(".mp-cf")].map(c => c.dataset.id), names: [...document.querySelectorAll(".mp-name")].map(t => t.textContent),
    n: document.getElementById("mpN").textContent, head: document.querySelector(".mapbox image")?.getAttribute("href") }));
  check("the map draws an arm per brain, a sucker per concept, the link and the conflict", drawn.arms === 2 && drawn.person === 1
    && drawn.suckers.length === 3 && drawn.links === 1 && JSON.stringify(drawn.dots) === '["content/offer"]'
    && drawn.names.join("|") === "Content|Charles Gave" && /2 brains · 3 concepts · 1 link between brains · 1 with an open conflict/.test(drawn.n)
    && /logo-mark/.test(drawn.head || ""), JSON.stringify(drawn));
  const r = Object.fromEntries(drawn.suckers.map(x => x.split(":")));
  check("a sucker grows with its sources", Number(r["content/offer"]) > Number(r["content/brand"]), JSON.stringify(r));

  await page.hover('.mp-sk[data-id="content/offer"]');
  check("pointing at a sucker lights its links", await page.evaluate(() => document.querySelector(".mp-link").classList.contains("hot")));
  const fitBefore = await page.evaluate(() => document.querySelector(".mapbox svg").getAttribute("viewBox"));
  await page.click("#mpIn");
  const zoomed = await page.evaluate(() => document.querySelector(".mapbox svg").getAttribute("viewBox"));
  await page.click("#mpFit");
  check("zoom in narrows the view and Fit brings it back", zoomed !== fitBefore
    && Number(zoomed.split(" ")[2]) < Number(fitBefore.split(" ")[2])
    && (await page.evaluate(() => document.querySelector(".mapbox svg").getAttribute("viewBox"))) === fitBefore, `${fitBefore} -> ${zoomed}`);

  await page.evaluate(() => document.querySelector('.mp-sk[data-id="content/offer"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(250);
  check("a sucker opens its concept, over the map", await page.evaluate(() => !!document.querySelector(".viewer") && !!document.querySelector(".mapbox")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  check("Escape closes the concept first, the map stays", await page.evaluate(() => !document.querySelector(".viewer") && !!document.querySelector(".mapbox")));

  await page.evaluate(() => document.querySelector(".mp-cf").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(300);
  const deck = await page.evaluate(() => ({ title: document.querySelector(".dk-card h4")?.textContent }));
  check("a red dot opens the swipe deck on that conflict", deck.title === "Offer first", JSON.stringify(deck));
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  check("Escape then closes the map", !(await page.$(".mapbox")));
  check("nothing threw on the map", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the demo: open to anyone, nothing that reshapes it ---- */
{
  const demo = { ...STATE, space: "demo", spaceName: "Demo", demo: true };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u); window.__calls.push({ s, body: JSON.parse(opt?.body || "{}") });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts")) return Response.json({ conflicts: [], others: 0 });
      return Response.json({});
    };
  }, demo);
  await page.waitForTimeout(200);
  const d = await page.evaluate(() => ({ bar: !document.getElementById("demoBar").hidden && /Live demo/.test(document.getElementById("demoBar").textContent),
    make: document.getElementById("newBrain").hidden, edit: [...document.querySelectorAll("#brains .brain-row .ed")].map(x => x.textContent) }));
  check("the demo says what it is, and offers no folder to create or edit", d.bar && d.make && !d.edit.includes("edit"), JSON.stringify(d));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(250);
  const set = await page.evaluate(() => ({ model: document.getElementById("setModel").hidden, mcp: document.getElementById("mcpBlock").hidden,
    use: document.getElementById("useBlock").hidden, key: document.getElementById("keyBlock").hidden,
    asked: window.__calls.filter(c => /\/api\/(account\/mcp|usage)/.test(c.s)).length }));
  check("Setup in the demo keeps the default model, and leaves out the connector and transcripts", set.model && set.mcp && set.use && set.key && set.asked === 0,
    JSON.stringify(set));
  check("the demo keeps Tasu's greys: no logo or colours to set", await page.evaluate(() => document.getElementById("lookBlock").hidden)
    && await page.evaluate(() => document.documentElement.dataset.space === "demo" && getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)"));
  await page.click("#kDone");
  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("a one-pager in the demo is copied or printed, never mailed", !(await page.isVisible("#pTo")));
  await page.click("#pCancel");
  await page.evaluate(() => localStorage.setItem("octopus.model", "openai/gpt-5"));
  await page.fill("#input", "What is a hook?"); await page.click("#send"); await page.waitForTimeout(200);
  const asked = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/ask")).pop()?.body);
  check("nothing in the demo sends a model of its own choosing", asked && !("model" in asked) && !("key" in asked), JSON.stringify(asked));
  check("nothing threw in the demo", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a workspace's own look: a logo and two colours ---- */
{
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const mine = { ...STATE, space: "acme", spaceName: "Acme", brand: { logo: LOGO, accent: "#ff6600", bg: null } };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts")) return Response.json({ conflicts: [], others: 0 });
      if (s.includes("/api/brand")) return Response.json({ brand: body.reset ? null : { logo: body.logo, accent: body.accent, bg: body.bg } });
      return Response.json({});
    };
  }, mine);
  await page.waitForTimeout(300);
  const worn = await page.evaluate(() => ({ fill: document.documentElement.style.getPropertyValue("--accent-fill"),
    solid: document.documentElement.style.getPropertyValue("--accent-solid"), mark: document.getElementById("spaceMark").getAttribute("src").slice(0, 22),
    zero: document.querySelector(".zero .zero-mark")?.getAttribute("src").slice(0, 22), logo: document.documentElement.dataset.logo,
    kept: localStorage.getItem("octopus.look.acme") }));
  check("a saved look is worn: the accent, its darker shades, and the logo as the mark", worn.fill === "#ff6600" && worn.solid !== "#ff6600"
    && worn.mark === "data:image/png;base64," && worn.zero === "data:image/png;base64," && worn.logo === "1" && /ff6600/.test(worn.kept || ""), JSON.stringify(worn));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(250);
  check("Setup offers the look to set", await page.isVisible("#lookBlock") && await page.isDisabled("#lookSave"));
  await page.$eval("#lookAccent", i => { i.value = "#00aa55"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#lookBg", i => { i.value = "#223344"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  const pv = await page.evaluate(() => ({ fill: document.documentElement.style.getPropertyValue("--accent-fill"), bg: getComputedStyle(document.body).backgroundColor,
    sent: window.__calls.some(c => c.s.includes("/api/brand")) }));
  const rgb = pv.bg.match(/\d+/g).map(Number);
  const lum = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [.2126, .7152, .0722][i], 0);
  check("a colour previews on the page before it is saved, and a dark page is kept light", pv.fill === "#00aa55" && lum >= .77 && !pv.sent, JSON.stringify({ ...pv, lum }));
  await page.click("#lookSave"); await page.waitForTimeout(150);
  const saved = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/brand")).pop()?.body);
  check("Save sends the logo and both colours", saved?.accent === "#00aa55" && saved?.bg === "#223344" && saved?.logo === mine.brand.logo && saved?.token === "test",
    JSON.stringify(saved && { ...saved, logo: String(saved.logo).slice(0, 20) }));
  await page.click("#lookReset"); await page.waitForTimeout(150);
  const back = await page.evaluate(() => ({ fill: document.documentElement.style.getPropertyValue("--accent-fill"), mark: document.getElementById("spaceMark").getAttribute("src"),
    kept: localStorage.getItem("octopus.look.acme"), reset: window.__calls.filter(c => c.s.includes("/api/brand")).pop()?.body.reset }));
  check("Back to the default clears the look everywhere", back.fill === "" && back.kept === null && back.reset === true && back.mark === "/brand/tasu.svg", JSON.stringify(back));
  await page.$eval("#lookAccent", i => { i.value = "#aa0000"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("#kDone"); await page.waitForTimeout(100);
  check("a look previewed and not saved goes back on close", await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-fill")) === "");
  check("nothing threw with a look of its own", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- Setup: change the passphrase, and share a brain with another workspace ---- */
{
  const shareState = { targets: [{ slug: "squidgy", name: "Squidgy", mode: "edit" }, { slug: "demo", name: "Demo", mode: "read" }],
    brains: [{ slug: "wealth", name: "Wealth", type: "subject", to: [] }, { slug: "content", name: "Content", type: "subject", to: ["squidgy"] }],
    joined: [] };
  const owner = { ...STATE, space: "octopus", spaceName: "Octopus", brains: [
    { slug: "wealth", name: "Wealth", type: "subject", scope: "s", owner: null },
    { slug: "content", name: "Content", type: "subject", scope: "s", owner: null, shared: ["squidgy"] },
    { slug: "me", name: "Me", type: "personal", scope: "s", owner: null }] };
  const { page, bad } = await boot("/chat.html", ([state, share]) => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = []; window.__share = share;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/passphrase")) return body.current === "right one" ? Response.json({ ok: true, ended: 2 }) : Response.json({ error: "that is not your current passphrase" });
      if (s.includes("/api/share")) {
        const b = window.__share.brains.find(x => x.slug === body.brain);
        if (b && body.leave !== true) b.to = body.on ? [...b.to.filter(x => x !== body.to), body.to] : b.to.filter(x => x !== body.to);
        return Response.json(window.__share);
      }
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] });
    };
  }, [owner, shareState]);
  await page.waitForTimeout(250);
  const mark = await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].map(r => `${r.querySelector(".nm").textContent}:${r.classList.contains("shared")}`).join("|"));
  check("a brain shared with another workspace wears a mark in the list", /Content:true/.test(mark) && /Wealth:false/.test(mark), mark);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(300);
  const ui = await page.evaluate(() => ({ pass: !document.getElementById("passBlock").hidden, share: !document.getElementById("shareBlock").hidden,
    open: document.getElementById("shareBlock").open, count: document.getElementById("shareCount").textContent,
    opts: [...document.querySelectorAll("#shareTo option")].map(o => o.textContent).join("|") }));
  check("Setup offers a passphrase to change, and Share brain folded shut with how many are shared", ui.pass && ui.share && !ui.open && ui.count === "1 shared"
    && ui.opts === "Squidgy|Demo (read only)", JSON.stringify(ui));
  await page.click("#shareBlock > summary"); await page.waitForTimeout(80);
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#shareSlot .sh-row")].map(r => r.querySelector(".sh-name").textContent + ":" + r.querySelector(".sh-chip").textContent).join("|"));
  check("it opens on a tap, and lists the brains here for the first workspace, the personal one left out", await page.evaluate(() => document.getElementById("shareBlock").open)
    && (await rows()) === "Wealth:Share|Content:Shared", await rows());

  /* Share a brain: one tap, saved at once. */
  await page.click("#shareSlot .sh-row:first-child .sh-chip"); await page.waitForTimeout(250);
  const sent = await page.evaluate(() => ({ call: window.__calls.filter(c => c.s.includes("/api/share")).pop()?.body, said: document.getElementById("shareMsg").textContent, count: document.getElementById("shareCount").textContent }));
  check("a tap shares that brain with the chosen workspace", sent.call?.brain === "wealth" && sent.call?.to === "squidgy" && sent.call?.on === true
    && /Wealth is now in Squidgy too/.test(sent.said) && sent.count === "2 shared", JSON.stringify(sent));
  await page.click("#shareSlot .sh-row:last-child .sh-chip"); await page.waitForTimeout(250);
  const off = await page.evaluate(() => ({ call: window.__calls.filter(c => c.s.includes("/api/share")).pop()?.body, chip: document.querySelector("#shareSlot .sh-row:last-child .sh-chip").textContent }));
  check("and a second tap on a shared one stops sharing it", off.call?.brain === "content" && off.call?.to === "squidgy" && off.call?.on === false && off.chip === "Share", JSON.stringify(off));

  /* The select changes the workspace, and the demo says it is read only. */
  await page.selectOption("#shareTo", "demo"); await page.waitForTimeout(80);
  const demoSide = await page.evaluate(() => ({ note: document.getElementById("shareNote").textContent, rows: [...document.querySelectorAll("#shareSlot .sh-chip")].map(c => c.textContent).join("|") }));
  check("choosing the demo says everyone there can read it and nobody can change it, and shows what is shared there", /Everyone who opens Demo can read/.test(demoSide.note)
    && /Nobody there can change them/.test(demoSide.note) && demoSide.rows === "Share|Share", JSON.stringify(demoSide));
  await page.click("#shareSlot .sh-row:first-child .sh-chip"); await page.waitForTimeout(250);
  const toDemo = await page.evaluate(() => ({ call: window.__calls.filter(c => c.s.includes("/api/share")).pop()?.body, said: document.getElementById("shareMsg").textContent }));
  check("a tap with the demo chosen shares it with the demo", toDemo.call?.to === "demo" && toDemo.call?.on === true && /readable in Demo/.test(toDemo.said), JSON.stringify(toDemo));
  check("and the choice stays on the demo after the list repaints", await page.inputValue("#shareTo") === "demo");

  /* The passphrase. */
  await page.click("#passGo"); await page.waitForTimeout(60);
  check("it asks for the current passphrase first", /current passphrase/.test(await page.textContent("#passMsg")) && !(await page.evaluate(() => window.__calls.some(c => c.s.includes("/api/passphrase")))));
  await page.fill("#passCur", "right one"); await page.fill("#passNew", "short");
  await page.click("#passGo"); await page.waitForTimeout(60);
  check("and refuses a new one under 8 characters before anything is sent", /8 characters/.test(await page.textContent("#passMsg")) && !(await page.evaluate(() => window.__calls.some(c => c.s.includes("/api/passphrase")))));
  await page.fill("#passCur", "wrong one"); await page.fill("#passNew", "a longer passphrase");
  await page.click("#passGo"); await page.waitForTimeout(120);
  check("a wrong current passphrase says so and keeps what was typed", /not your current passphrase/.test(await page.textContent("#passMsg")) && (await page.inputValue("#passNew")) === "a longer passphrase");
  await page.fill("#passCur", "right one");
  await page.click("#passGo"); await page.waitForTimeout(150);
  const done = await page.evaluate(() => ({ body: window.__calls.filter(c => c.s.includes("/api/passphrase")).pop()?.body, msg: document.getElementById("passMsg").textContent,
    cur: document.getElementById("passCur").value, next: document.getElementById("passNew").value }));
  check("the change is sent, says who was signed out, and clears both fields", done.body?.current === "right one" && done.body?.next === "a longer passphrase"
    && /2 other sessions are signed out/.test(done.msg) && !done.cur && !done.next, JSON.stringify(done));
  check("nothing threw", !bad.length, bad.join(" | "));
  await page.close();
}
{
  /* A workspace that was given a brain can leave it. */
  const given = { targets: [{ slug: "octopus", name: "Octopus", mode: "edit" }], brains: [], joined: [{ slug: "wealth", name: "Wealth", type: "subject", from: "octopus", fromName: "Octopus", readOnly: false }] };
  const sq = { ...STATE, space: "squidgy", spaceName: "Squidgy", brains: [{ slug: "wealth", name: "Wealth", type: "subject", scope: "s", space: "octopus", shared: ["squidgy"] }] };
  const { page } = await boot("/chat.html", ([state, share]) => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    window.fetch = async (u, opt) => { const s = String(u); window.__calls.push({ s, body: JSON.parse(opt?.body || "{}") });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/share")) return Response.json(share);
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] }); };
  }, [sq, given]);
  await page.waitForTimeout(250);
  check("a brain given by another workspace says where it comes from", await page.evaluate(() => document.querySelector("#brains .brain-row").title.includes("Shared with this workspace from Octopus")));
  check("and it sits with the other subjects, fed from either workspace", await page.evaluate(() => [...document.querySelectorAll("#brains .group-h")].map(h => h.textContent).join(",")) === "Subjects"
    && await page.evaluate(() => !document.querySelector("#brains .ro-tag")));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(300);
  await page.click("#shareBlock > summary"); await page.waitForTimeout(60);
  const row = await page.evaluate(() => [...document.querySelectorAll("#shareSlot .sh-row > *")].map(x => x.textContent).join("|"));
  check("Share brain lists what this workspace was given, with a way to leave it", row === "Wealth|from Octopus|Leave it", row);
  await page.click("#shareSlot .sh-row .mini"); await page.waitForTimeout(200);
  check("leaving sends only that brain", await page.evaluate(() => { const c = window.__calls.filter(x => x.s.includes("/api/share")).pop()?.body; return c?.brain === "wealth" && c?.leave === true; }));
  await page.close();
}
{
  /* In the demo a shared brain is there to ask, and never offered to feed. */
  const demo = { ...STATE, space: "demo", spaceName: "Demo", demo: true, brains: [
    { slug: "health", name: "Health", type: "subject", scope: "s" },
    { slug: "wealth", name: "Wealth", type: "subject", scope: "s", space: "octopus", viewers: ["demo"] }] };
  const { page } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async u => String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] });
  }, demo);
  await page.waitForTimeout(250);
  await page.click("#scopeBtn"); await page.waitForTimeout(80);
  const ask = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-nm")].map(x => x.firstChild.textContent).join("|"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.getElementById("dropBtn").click()); await page.waitForTimeout(80);
  await page.click("#scopeBtn"); await page.waitForTimeout(80);
  const feed = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-nm")].map(x => x.firstChild.textContent).join("|"));
  check("the demo asks across a shared brain and only offers its own to feed", /Wealth/.test(ask) && /Health/.test(ask) && /Health/.test(feed) && !/Wealth/.test(feed), JSON.stringify({ ask, feed }));
  check("and its row says it is read only here", await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].some(r => /Read only here/.test(r.title))));
  const groups = await page.evaluate(() => [...document.querySelectorAll("#brains .group-h, #brains .brain-row .nm")].map(x => x.textContent).join(","));
  check("the demo lists its folders by type, the one it may only ask marked so", groups === "Subjects,Health,Wealth"
    && await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].map(r => r.querySelector(".ro-tag")?.textContent || "").join("|")) === "|Ask only", groups);
  check("and a visitor makes no folder", await page.evaluate(() => document.getElementById("newBrain").hidden));
  await page.close();
}

/* ---- the demo shows what to try: questions, the map, a clash ---- */
{
  const demo = { ...STATE, space: "demo", spaceName: "Demo", demo: true,
    brains: [{ slug: "health", name: "Health", type: "subject", scope: "s" }, { slug: "social", name: "Social", type: "subject", scope: "s" }],
    concepts: [{ brain: "health", slug: "sleep", n: 1, title: "Sleep optimization", src: 4 }, { brain: "health", slug: "light", n: 2, title: "Light", src: 1 },
      { brain: "social", slug: "hooks", n: 1, title: "Opening hooks for speeches", src: 2 }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u); window.__calls.push({ s, body: JSON.parse(opt?.body || "{}") });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts")) return Response.json({ conflicts: [], others: 0 });
      if (s.includes("/api/ask")) return Response.json({ answer: "Seven to nine hours.", sources: 4, level: "normal" });
      return Response.json({ chats: [] });
    };
  }, demo);
  await page.waitForTimeout(300);
  const tries = await page.evaluate(() => [...document.querySelectorAll(".zero .try button")].map(b => b.textContent));
  check("the empty demo offers questions its brains can answer", JSON.stringify(tries) === '["What does Health hold on sleep optimization?","What does Social hold on opening hooks for speeches?"]',
    JSON.stringify(tries));
  await page.click(".zero .try button"); await page.waitForTimeout(300);
  check("one tap asks it", (await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/ask")).pop()?.body.q)) === "What does Health hold on sleep optimization?");
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("the demo wears the landing's type", /^"?Geist/.test(font), font);
  await page.click("#demoSettle"); await page.waitForTimeout(250);
  check("Settle a clash says when there is none to settle", /No open clash in the demo/.test(await page.textContent("#thread")));
  await page.click("#demoMap"); await page.waitForTimeout(300);
  check("Open the map opens it from the demo bar", await page.evaluate(() => !!document.querySelector(".mapbox")));
  check("nothing threw trying the demo", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- on a phone: the demo's questions on screen, names in full ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const demo = { ...STATE, space: "demo", spaceName: "Demo", demo: true,
    brains: [{ slug: "health", name: "Health", type: "subject", scope: "s" }, { slug: "richard-detente", name: "Richard Detente", type: "person", scope: "s" }],
    concepts: [{ brain: "health", slug: "sleep", n: 1, title: "Sleep optimization", src: 4 }, { brain: "richard-detente", slug: "gold", n: 1, title: "Gold", src: 2 }] };
  await page.addInitScript(st => { sessionStorage.setItem("octopus.token.v1", "t");
    window.fetch = async u => String(u).includes("/api/state") ? Response.json(st) : Response.json({ chats: [] }); }, demo);
  await page.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ lastTry: document.querySelector(".zero .try button:last-child")?.getBoundingClientRect().bottom,
    composer: document.querySelector(".composer-wrap").getBoundingClientRect().top, wide: document.documentElement.scrollWidth,
    bar: document.getElementById("demoBar").getBoundingClientRect().height }));
  check("on a phone the demo's questions to try sit above the composer, and the bar stays short", m.lastTry < m.composer && m.bar < 110 && m.wide <= 390, JSON.stringify(m));
  await page.click("#burger"); await page.waitForTimeout(300);
  const row = await page.evaluate(() => { const r = [...document.querySelectorAll("#brains .brain-row")].find(x => /Richard/.test(x.textContent));
    const nm = r.querySelector(".nm"); return { full: nm.scrollWidth <= nm.clientWidth, icon: getComputedStyle(r.querySelector(".ed.op")).fontSize }; });
  check("and a brain's name shows whole, its open and edit as icons", row.full && row.icon === "0px", JSON.stringify(row));
  await ctx.close();
}

/* ---- talk instead of typing: the browser's own speech service ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    /* A stand-in for the speech service Safari and Chrome carry: it hears one
       phrase in two steps, a partial then a final, and ends when stopped. */
    window.__voice = [];
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start(){ window.__voice.push({ lang: this.lang, live: this.interimResults }); window.__rec = this;
        setTimeout(() => this.onresult?.({ results: [[{ transcript: "what do my" }]] }), 30);
        setTimeout(() => this.onresult?.({ results: [[{ transcript: "what do my brains say on sleep" }]] }), 60); }
      stop(){ setTimeout(() => this.onend?.(), 10); }
    };
    window.fetch = async u => String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] });
  }, STATE);
  await page.fill("#input", "Quick one:");
  await page.click("#micBtn"); await page.waitForTimeout(150);
  const on = await page.evaluate(() => ({ value: document.getElementById("input").value, on: document.getElementById("micBtn").classList.contains("on"),
    pressed: document.getElementById("micBtn").getAttribute("aria-pressed"), hint: document.getElementById("tHint").textContent, lang: window.__voice[0]?.lang }));
  check("the mic listens in the browser's language and writes after what was typed", on.value === "Quick one: what do my brains say on sleep"
    && on.on && on.pressed === "true" && on.hint === "Listening. Tap the mic to stop." && !!on.lang, JSON.stringify(on));
  await page.click("#micBtn"); await page.waitForTimeout(80);
  const off = await page.evaluate(() => ({ on: document.getElementById("micBtn").classList.contains("on"), send: document.getElementById("send").disabled,
    hint: document.getElementById("tHint").textContent }));
  check("a second tap stops it, and the words wait to be sent", !off.on && !off.send && off.hint === "", JSON.stringify(off));
  await page.evaluate(() => document.getElementById("dropBtn").click()); await page.waitForTimeout(60);
  check("a drop takes a source, so the mic steps aside", await page.evaluate(() => document.getElementById("micBtn").hidden));
  check("no page error with the mic", bad.length === 0, bad.join(" | "));
  await page.close();
}
{
  const { page } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    delete window.webkitSpeechRecognition; delete window.SpeechRecognition;
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/131.0" });
    window.fetch = async u => String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] });
  }, STATE);
  await page.click("#micBtn"); await page.waitForTimeout(60);
  const h = await page.evaluate(() => document.getElementById("tHint").textContent);
  check("a browser with no voice input points to the free dictation the computer carries", /Press Fn twice to dictate/.test(h), h);
  await page.fill("#input", "typed"); await page.waitForTimeout(30);
  check("and the hint goes once you type", await page.evaluate(() => document.getElementById("tHint").textContent === ""));
  await page.close();
}

/* ---- the chat bar rests folded, and a folder can be tidied ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/brain/tidy")) return Response.json({ brain: "content", total: 2, read: 2,
        same: [[{ id: "content/offer-creation", title: "Offer creation", line: "Offer first.", ev: 2 },
                { id: "content/personal-brand", title: "Offre", line: "Face beats logo.", ev: 1 }]],
        english: [{ id: "content/personal-brand", title: "Marque personnelle", line: "", ev: 1, to: "Personal brand" }],
        blank: [{ id: "content/offer-creation", title: "Offer creation", line: "", ev: 2 }] });
      if (s.includes("/api/concept/merge")) return Response.json({ into: body.into, joined: 1, links: 0, rewritten: true });
      if (s.includes("/api/concept/rename")) return Response.json({ id: body.id, title: body.title });
      if (s.includes("/api/concept/rederive")) return Response.json({ written: body.ids });
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] });
    };
  }, { ...STATE, concepts: [{ brain: "content", slug: "offer-creation", n: 1, title: "Offer creation", summaryLine: "" },
                             { brain: "content", slug: "personal-brand", n: 2, title: "Offre", summaryLine: "Face beats logo." }] });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(250);
  const bar = () => page.evaluate(() => ({ c: document.querySelector(".composer-wrap").classList.contains("compact"),
    ctrls: getComputedStyle(document.querySelector(".tbar .ctrls")).display, send: getComputedStyle(document.getElementById("send")).display,
    h: Math.round(document.querySelector(".composer .box").getBoundingClientRect().height), focus: document.activeElement?.id }));
  const folded = await bar();
  check("the chat bar rests folded: one line, the field and its send", folded.c && folded.ctrls === "none" && folded.send !== "none" && folded.h < 64, JSON.stringify(folded));
  await page.click(".composer .box"); await page.waitForTimeout(300);
  const open = await bar();
  check("a click opens it to the folders and the levels, the field ready", !open.c && open.ctrls !== "none" && open.h > folded.h && open.focus === "input", JSON.stringify(open));
  await page.fill("#input", "a draft"); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(250);
  check("a draft keeps it open", !(await bar()).c);
  await page.fill("#input", ""); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(250);
  check("and empty, it folds again", (await bar()).c);
  await page.click(".composer .box"); await page.click("#scopeBtn"); await page.waitForTimeout(250);
  check("its folder menu keeps it open", !(await bar()).c && await page.isVisible(".pick-menu"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);

  /* Tidy: each finding waits for its own click. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Content/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(250);
  await page.click("#fvTidy"); await page.waitForTimeout(300);
  const pane = await page.evaluate(() => ({ heads: [...document.querySelectorAll("#tidyPane h4")].map(h => h.textContent).join("|"),
    opts: [...document.querySelectorAll("#tidyPane .td-opt b")].map(b => b.textContent).join(","),
    ren: document.querySelector("#tidyPane .td-ren .td-in")?.value }));
  check("Tidy lists what is filed twice, what is not in English, and what has no position",
    pane.heads === "Filed twice · 1|Not in English · 1|No position · 1" && pane.opts === "Offer creation,Offre" && pane.ren === "Personal brand", JSON.stringify(pane));
  await page.click("#tidyPane .td-opt:nth-child(1) input");
  await page.click("#tidyPane .td-card .td-go"); await page.waitForTimeout(250);
  const merged = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/merge"))?.body);
  check("Merge folds the others into the title picked", merged?.into === "content/offer-creation" && JSON.stringify(merged?.from) === '["content/personal-brand"]', JSON.stringify(merged));
  check("and says it is done", /Merged into Offer creation, position written again/.test(await page.textContent("#tidyPane .td-card .td-say")));
  await page.fill("#tidyPane .td-ren .td-in", "Personal branding");
  await page.click("#tidyPane .td-ren .td-go"); await page.waitForTimeout(200);
  const renamed = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/rename"))?.body);
  check("Rename sends the title as edited", renamed?.id === "content/personal-brand" && renamed?.title === "Personal branding", JSON.stringify(renamed));
  await page.click("#tidyPane .td-card:last-of-type .td-go"); await page.waitForTimeout(250);
  const wrote = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/rederive"))?.body);
  check("and the empty ones get their position from what they hold", JSON.stringify(wrote?.ids) === '["content/offer-creation"]', JSON.stringify(wrote));
  check("nothing threw folding the bar or tidying", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the side panel: Chats and Folders, a personal folder first ---- */
{
  const lim = { ...STATE, full: undefined, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "What I say", owner: null },
    { slug: "health", name: "Health", type: "subject", scope: "h", owner: null }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] });
    };
  }, lim);
  await page.waitForTimeout(200);
  const seen = await page.evaluate(() => ({
    panels: [...document.querySelectorAll("aside .panel")].filter(p => !p.hidden).map(p => p.id).join(","),
    folders: [...document.querySelectorAll("#brains .brain-row .nm")].map(x => x.textContent).join(","),
    acts: [...document.querySelectorAll("aside .side-acts button")].map(b => b.textContent.trim()).join(",") }));
  check("every workspace shows Chats and Folders", seen.panels === "chatsPanel,brainsPanel", seen.panels);
  check("with New chat, Drop, One-pager and Settings on top", seen.acts === "New chat,Drop,One-pager,Settings", seen.acts);
  check("and every folder listed, the personal one first", seen.folders === "Me,Content,Health", seen.folders);
  await page.click('#brains .brain-row:has(.nm:text-is("Me"))'); await page.waitForTimeout(80);
  check("which opens its chat", await page.evaluate(() => /Tell it anything/.test(document.getElementById("input").placeholder)));
  await page.click('#brains .brain-row:has(.nm:text-is("Me"))'); await page.waitForTimeout(80);
  await page.click("#keyBtn"); await page.waitForTimeout(150);
  check("Settings has no side panel switch now", await page.evaluate(() => !document.getElementById("modeBlock") && !document.getElementById("modeSeg")));
  check("nothing threw in the side panel", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a personal brain: a chat that files what you say ---- */
{
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "What I say", owner: null }],
    concepts: [{ brain: "me", slug: "lisbon", n: 1, title: "Moving abroad", summaryLine: "Lisbon in 2027" }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/ask")) return Response.json({ answer: "Noted. Porto replaces Lisbon.", sources: 0, level: "normal", personal: true,
        filed: { new: 1, updated: 1, titles: ["Moving abroad", "Budget"] }, called: ["Health"], chat: "c1" });
      if (s.includes("/api/personal/remember")) return Response.json({ filed: { new: 2, updated: 0, titles: ["A", "B"] } });
      if (s.includes("/api/brain")) return Response.json({ slug: "me-2" });
      return Response.json({ chats: [] });
    };
  }, mine);
  await page.waitForTimeout(250);
  const first = await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row .nm")].map(x => x.textContent)[0]);
  check("a personal brain leads the list", first === "Me", first);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(100);
  const c = await page.evaluate(() => ({ mode: !document.getElementById("mode"), mem: !document.getElementById("memBtn").hidden,
    level: document.getElementById("levelWrap").hidden, ph: document.getElementById("input").placeholder, foot: document.getElementById("footNote").textContent }));
  check("its chat has no Drop and no levels, and offers Add memory", c.mode && c.mem && c.level && /Tell it anything/.test(c.ph) && /only this chat reads it/.test(c.foot),
    JSON.stringify(c));
  await page.fill("#input", "Actually Porto, not Lisbon"); await page.click("#send"); await page.waitForTimeout(250);
  const a = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/ask")).pop()?.body,
    filed: document.querySelector(".msg.ai:last-child .filed")?.textContent, called: document.querySelector(".msg.ai:last-child .filed.called")?.textContent, pager: [...document.querySelectorAll(".msg.ai:last-child .ans-acts .mini")].map(b => b.textContent) }));
  check("a message goes to the personal brain, and the reply says what it filed", a.sent?.brain === "me" && a.filed === "Filed: 1 new note, 1 note updated",
    JSON.stringify(a));
  check("and names the other brain it called on its own", a.called === "Called your Health brain", JSON.stringify(a.called));
  check("a personal reply offers no one-pager", JSON.stringify(a.pager) === '["Copy"]', JSON.stringify(a.pager));

  /* Add memory: a long paste goes in pieces of 6,000 characters at most.
     The bar folded after the send, so a click in it opens it first. */
  await page.click(".composer .box"); await page.click("#memBtn"); await page.waitForTimeout(100);
  const para = "I like long walks and I plan my week on Sundays. ".repeat(40);
  await page.fill("#memText", Array.from({ length: 7 }, () => para).join("\n\n"));
  await page.click("#memGo"); await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({ calls: window.__calls.filter(x => x.s.includes("/api/personal/remember")).map(x => ({ b: x.body.brain, n: x.body.text.length })),
    said: [...document.querySelectorAll(".msg.ai")].pop()?.textContent, open: !!document.getElementById("memText") }));
  check("Add memory files a long paste in pieces, each under 6,000 characters", m.calls.length >= 3 && m.calls.every(x => x.b === "me" && x.n <= 6000)
    && /Remembered\. 6 new notes/.test(m.said || "") && !m.open, JSON.stringify(m));

  /* It is never fed by a drop. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(80);
  check("leaving the personal chat brings the levels back", await page.evaluate(() => !document.getElementById("levelWrap").hidden && document.getElementById("memBtn").hidden));
  await page.evaluate(() => document.getElementById("dropBtn").click()); await page.click("#scopeBtn"); await page.waitForTimeout(80);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-nm")].map(x => x.textContent));
  check("a drop never offers the personal brain", !rows.some(r => /^Me/.test(r)) && rows.some(r => /Content/.test(r)), JSON.stringify(rows));
  await page.keyboard.press("Escape"); await page.evaluate(() => document.body.click());

  /* Making one: New folder, then Personal, with no scope line to write. */
  await page.click("#newBrain"); await page.waitForTimeout(100);
  await page.click('#bType [data-t="personal"]');
  const sheet = await page.evaluate(() => ({ scope: document.getElementById("bScopeF").hidden, person: document.getElementById("bPersonF").hidden,
    name: document.getElementById("bName").value, note: document.getElementById("bMineF").textContent, go: document.getElementById("bMake").textContent }));
  check("a personal folder needs no scope line and no person switch, and says only its chat reads it",
    sheet.scope && sheet.person && sheet.name === "Me" && /Only its own chat reads it/.test(sheet.note) && sheet.go === "Create personal folder", JSON.stringify(sheet));
  await page.fill("#bName", "Me too"); await page.fill("#bMem", "I plan my week on Sundays."); await page.click("#bMake"); await page.waitForTimeout(300);
  const made = await page.evaluate(() => ({ brain: window.__calls.filter(x => x.s.endsWith("/api/brain")).pop()?.body,
    mem: window.__calls.filter(x => x.s.includes("/api/personal/remember")).pop()?.body }));
  check("and it is made as one", made.brain?.type === "personal" && made.brain?.name === "Me too" && made.brain?.scope === "", JSON.stringify(made.brain));
  check("what you paste is filed into it at once", made.mem?.brain === "me-2" && made.mem?.text === "I plan my week on Sundays.", JSON.stringify(made.mem));

  /* A folder with the person switch on is made as one person's view. */
  await page.click("#newBrain"); await page.waitForTimeout(100);
  await page.fill("#bName", "Ray Dalio"); await page.fill("#bScope", "Ray Dalio's views on debt cycles and the changing world order");
  await page.click("#bPersonF"); await page.waitForTimeout(40);
  check("the switch turns on, and its row shows it", await page.evaluate(() => document.getElementById("bPerson").checked && document.getElementById("bPersonF").classList.contains("on")));
  await page.click("#bMake"); await page.waitForTimeout(150);
  if (await page.$("#bMake")) { await page.click("#bMake"); await page.waitForTimeout(200); }
  const person = await page.evaluate(() => window.__calls.filter(x => x.s.endsWith("/api/brain")).pop()?.body);
  check("the switch on makes a folder of one person's view", person?.type === "person" && person?.name === "Ray Dalio", JSON.stringify(person));
  check("nothing threw around the personal brain", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a workspace on its own key ---- */
{
  const mine = { ...STATE, space: "acme", spaceName: "Acme", byok: true };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u); window.__calls.push({ s, body: JSON.parse(opt?.body || "{}") });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/conflicts")) return Response.json({ conflicts: [], others: 0 });
      return Response.json({});
    };
  }, mine);
  await page.waitForTimeout(700);
  const asked = await page.evaluate(() => ({ open: !!document.getElementById("ownKey"), shown: !document.getElementById("keyBlock")?.hidden,
    msg: document.getElementById("ownKeyMsg")?.textContent, mcp: document.getElementById("mcpBlock")?.hidden }));
  check("a workspace on its own key asks for the key on the first visit", asked.open && asked.shown && /No key in this browser yet/.test(asked.msg) && asked.mcp,
    JSON.stringify(asked));
  await page.fill("#ownKey", "not-a-key"); await page.click("#ownKeySave");
  check("a key that is not OpenRouter's is refused", /starts with sk-or-/.test(await page.textContent("#ownKeyMsg")));
  await page.fill("#ownKey", "sk-or-v1-0123456789abcdef0123456789abcdef"); await page.click("#ownKeySave");
  const saved = await page.evaluate(() => localStorage.getItem("octopus.key.acme"));
  check("the key is saved in this browser only, one per workspace", saved === "sk-or-v1-0123456789abcdef0123456789abcdef" && /Saved in this browser/.test(await page.textContent("#ownKeyMsg")));
  await page.click("#kDone");
  await page.fill("#input", "What is a hook?"); await page.click("#send"); await page.waitForTimeout(200);
  const sent = await page.evaluate(() => window.__calls.filter(c => c.s.includes("/api/ask")).pop()?.body);
  check("a call that spends a model carries the workspace's own key", sent?.key === "sk-or-v1-0123456789abcdef0123456789abcdef", JSON.stringify(sent));
  const quiet = await page.evaluate(() => window.__calls.filter(c => /\/api\/(state|chats|health|lock|usage)/.test(c.s) && c.body && "key" in c.body).map(c => c.s));
  check("and a call that spends none leaves it out", quiet.length === 0, JSON.stringify(quiet));
  check("nothing threw in a workspace on its own key", !bad.length, bad.join(" | "));
  await page.click("#lockBtn").catch(async () => { await page.click("#burger"); await page.click("#lockBtn"); });
  await page.waitForTimeout(400);
  check("Sign out forgets the workspace's own key in this browser", await page.evaluate(() => localStorage.getItem("octopus.key.acme")) === null);
  await page.close();
}

/* ---- the empty chat: the octopus's loop in Octopus, the dog's mark in Squidgy ---- */
for (const space of ["octopus", "squidgy"]) {
  const st = { ...STATE, space, spaceName: space === "octopus" ? "Octopus" : "Squidgy" };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async (u) => { const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/ask")) { await new Promise(ok => setTimeout(ok, 500)); return Response.json({ answer: "x", sources: 12 }); }
      return Response.json({}); };
  }, st);
  const z = await page.evaluate(() => { const v = document.querySelector(".zero .zero-loop, .zero .zero-mark");
    return v ? { tag: v.tagName, src: v.getAttribute("src"), loop: v.loop, muted: v.muted, playing: v.tagName === "VIDEO" ? !v.paused : null } : null; });
  await page.fill("#input", "anything"); await page.click("#send"); await page.waitForTimeout(150);
  const spin = await page.evaluate(() => { const m = document.querySelector(".thinking .spinner");
    return m ? { bg: getComputedStyle(m).backgroundImage, anim: getComputedStyle(m).animationName } : null; });
  if (space === "octopus") {
    check("an empty Octopus chat plays the octopus's loop, muted, on repeat", z?.tag === "VIDEO" && /octopus-loop\.webm$/.test(z.src) && z.loop && z.muted,
      JSON.stringify(z));
  } else {
    check("an empty Squidgy chat keeps the dog's mark", z?.tag === "IMG" && /squidgy-mark/.test(z.src), JSON.stringify(z));
    check("and Squidgy waits with its turning mark", /squidgy-mark/.test(spin?.bg || "") && spin?.anim === "turn", JSON.stringify(spin));
  }
  check(`nothing threw in the empty ${space} chat`, !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a pass or a plan too big for one call splits by itself ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__reads = []; window.__plans = []; let n = 0;
    const slow = { error: "deepseek/deepseek-v4-flash was still writing after 150 seconds. The job was too big for one call." };
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-big" });
      if (s.includes("/api/drop/read")) {
        window.__reads.push(body.chunk.length);
        if (body.chunk.length > 10000) return Response.json(slow);
        return Response.json({ part: { title: "Big course", author: "Ada Lane", kind: "study",
          topics: Array.from({ length: Math.ceil(body.chunk.length / 1000) }, () => ({ topic: `Topic ${++n}`, ideas: ["x"], data: [] })) } });
      }
      if (s.includes("/api/drop/plan")) {
        window.__plans.push(body.ext.topics.length);
        if (body.ext.topics.length > 10) return Response.json(slow);
        return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
          candidates: body.ext.topics.map(t => ({ title: t.topic, brain: "content", why: "taught" })) } });
      }
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.fill("#srcInput", "Big course.pdf");
  /* 20,000 characters in paragraphs: an 18,000 pass that must split, and a 2,000 one. */
  await page.fill("#input", Array.from({ length: 100 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(38)).join("\n\n"));
  await page.click("#send"); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ reads: window.__reads, plans: window.__plans,
    note: document.querySelector(".coverage")?.textContent || "", card: !!document.querySelector(".card-foot .go"),
    err: document.querySelector(".err")?.textContent || "" }));
  check("a pass too big for one call is read again as two halves", r.reads[0] > 10000 && r.reads.filter(x => x <= 10000).length >= 3 && !r.err,
    JSON.stringify(r.reads) + " " + r.err);
  check("a plan too big for one call is split until it fits, and every topic is filed",
    r.plans.some(x => x > 10) && r.card && /filed into (\d+) concepts/.test(r.note)
    && /(\d+) passages read, filed into \1 concepts/.test(r.note), JSON.stringify(r.plans) + " " + r.note);
  check("nothing threw splitting", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a drop can feed several brains at once ---- */
{
  const three = { ...STATE, brains: [
    { slug: "content", name: "Content", type: "subject", scope: "brand" },
    { slug: "wealth", name: "Wealth", type: "subject", scope: "money" },
    { slug: "gave", name: "Charles Gave", type: "person", scope: "Gave" }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__plan = null;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-multi" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Gold note", topics: [{ topic: "Gold", ideas: ["x"], data: [] }] } });
      if (s.includes("/api/drop/plan")) { window.__plan = body; return Response.json({ plan: { brains: ["wealth", "gave"], matched: [], new: ["x"], echo: [], conflicts: [],
        candidates: [{ title: "Gold", brain: "wealth", why: "x" }, { title: "Gold", brain: "gave", why: "y" }] } }); }
      return Response.json({});
    };
  }, three);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.click("#scopeBtn");
  const first = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-box")].length);
  check("dropping, each brain can be ticked", first === 3, String(first));
  await page.click('.pick-menu .pk-row:has-text("Wealth")');
  await page.click('.pick-menu .pk-row:has-text("Charles Gave")');
  const face = await page.evaluate(() => ({ val: document.getElementById("scopeVal").textContent,
    open: !!document.querySelector(".pick-menu"), done: document.querySelector(".pick-menu .pk-done")?.textContent }));
  check("two ticked brains show on the picker, and the menu stays open", /^(Wealth|Charles Gave) \+1$/.test(face.val) && face.open, JSON.stringify(face));
  check("its button says how many will be fed", face.done === "Feed 2 folders", face.done);
  await page.click(".pick-menu .pk-done");
  check("Done closes the menu", !(await page.$(".pick-menu")));
  await page.fill("#srcInput", "Gold note");
  await page.fill("#input", "Gold keeps its value.");
  await page.click("#send"); await page.waitForTimeout(700);
  const sent = await page.evaluate(() => window.__plan);
  check("the plan is asked to feed both brains", JSON.stringify((sent?.brains || []).slice().sort()) === JSON.stringify(["gave", "wealth"]),
    JSON.stringify(sent && { brains: sent.brains, brain: sent.brain }));
  const note = await page.evaluate(() => [...document.querySelectorAll(".msg.ai")].pop()?.textContent || "");
  check("one idea filed in two brains is two concepts", !/filed into 1 concept\b/.test(note));
  await page.click("#dropClose");
  const askFace = await page.evaluate(() => document.getElementById("scopeVal").textContent);
  check("asking after the drop keeps the two folders ticked", /^(Wealth|Charles Gave) \+1$/.test(askFace), askFace);
  check("nothing threw ticking brains", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- on a phone ---- */
{
  /* isMobile makes the browser honour the viewport tag the way a phone does,
     which is what a desktop-sized check never exercises. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const bad = []; page.on("pageerror", e => bad.push(e.message));
  await page.addInitScript(state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async u => Response.json(String(u).includes("/api/state") ? state : {});
  }, { ...STATE, concepts: [{ brain: "content", slug: "offer", n: 1, title: "Offer first", summaryLine: "Offer beats audience.", ev: 1, src: 1 }] });
  await page.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const shown = e => e.offsetParent !== null;
    return {
      W, side: document.documentElement.scrollWidth - W,
      small: [...document.querySelectorAll("input:not([type=file]), textarea, select")].filter(shown)
        .filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.tagName),
      short: [...document.querySelectorAll(".composer button, .topbar button, #send")].filter(shown)
        .filter(e => e.getBoundingClientRect().height < 40).map(e => e.id || e.textContent.trim()),
      sendIn: document.getElementById("send").getBoundingClientRect().right <= W,
    };
  });
  check("a phone lays the app out at its own width", r.W === 390, String(r.W));
  check("nothing scrolls the page sideways", r.side === 0, `${r.side}px`);
  check("no field under 16px, which makes iPhone zoom", !r.small.length, r.small.join(","));
  check("every composer button reaches 40px", !r.short.length, r.short.join(","));
  check("the send button stays on screen in Drop", r.sendIn);

  /* Ask: the levels sit on a row of their own, every button on screen. */
  await page.click("#dropClose"); await page.waitForTimeout(100);
  const lv = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, c = document.querySelector(".ctrls");
    const mode = document.getElementById("scopeBtn").getBoundingClientRect(), wrap = document.getElementById("levelWrap").getBoundingClientRect();
    return { W, off: [...document.querySelectorAll("#level button, #scopeBtn")].filter(b => {
        const r = b.getBoundingClientRect(); return r.left < 0 || r.right > W; }).map(b => b.dataset.v || b.id || b.textContent.trim()),
      scrolls: c.scrollWidth > c.clientWidth + 1, row: Math.abs(wrap.top - mode.top) < 6, wide: Math.round(wrap.width),
      tall: [...document.querySelectorAll("#level button")].every(b => b.getBoundingClientRect().height >= 40) };
  });
  check("on a phone the folder and the level share one row in the bar, every button on screen", !lv.off.length && !lv.scrolls && lv.row && lv.tall,
    JSON.stringify(lv));

  await page.click("#burger"); await page.waitForTimeout(300);
  const open = await page.evaluate(() => document.getElementById("side").classList.contains("open"));
  await page.mouse.click(370, 400); await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.getElementById("side").classList.contains("open"));
  check("the drawer opens, and a tap beside it closes it", open && closed);

  /* A folder on a phone: its list first, then one concept, and back. */
  await page.evaluate(() => document.querySelector("#brains .brain-row .ed.op").click()); await page.waitForTimeout(120);
  const fl = await page.evaluate(() => ({ list: document.querySelector(".fv-list")?.offsetParent !== null, doc: document.querySelector(".fv-doc")?.offsetParent !== null,
    drawer: document.getElementById("side").classList.contains("open"), side: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check("on a phone a folder opens on its list, the drawer shut, nothing off screen", fl.list && !fl.doc && !fl.drawer && fl.side === 0, JSON.stringify(fl));
  if (await page.$(".fv-row")){
    await page.click(".fv-row"); await page.waitForTimeout(120);
    const rd = await page.evaluate(() => ({ list: document.querySelector(".fv-list").offsetParent !== null, doc: document.querySelector(".fv-doc").offsetParent !== null }));
    await page.click(".fv-back"); await page.waitForTimeout(80);
    const bk = await page.evaluate(() => document.querySelector(".fv-list").offsetParent !== null);
    check("a concept takes the screen, and All concepts goes back", !rd.list && rd.doc && bk, JSON.stringify(rd));
  }
  check("and nothing threw on a phone", !bad.length, bad.join(" | "));
  await ctx.close();
}

/* ---- the app with no session asks for a workspace by its name ---- */
{
  const { page, bad } = await boot("/chat?w=", () => {
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/unlock")) { sessionStorage.setItem("test.unlock", opt.body); return Response.json({ token: "tOpen", space: "acme-research" }); }
      if (s.includes("/api/state")) return Response.json({ brains: [], concepts: [], sources: [], space: "acme-research", spaceName: "Acme Research", byok: false });
      if (s.includes("/api/status")) return Response.json({ gates: { octopus: true, squidgy: true }, demo: true });
      return Response.json({});
    };
  });
  const g = await page.evaluate(() => ({ gate: !!document.getElementById("wsGate"), name: !!document.getElementById("gName"),
    h: document.getElementById("gateH")?.textContent, locked: document.getElementById("app").classList.contains("locked"),
    theme: document.documentElement.dataset.space || "", bg: getComputedStyle(document.body).backgroundColor }));
  check("a tab with no session asks for the workspace's name and passphrase, over the app", g.gate && g.name && g.locked && g.h === "Open your workspace", JSON.stringify(g));
  check("and it wears Tasu's greys, not Octopus's", g.theme === "" && g.bg === "rgb(255, 255, 255)", JSON.stringify(g));
  await page.fill("#gName", "Acme Research"); await page.fill("#gPass", "short");
  await page.click("#gGo"); await page.waitForTimeout(100);
  check("a short passphrase is caught before anything is sent", /8 characters/.test(await page.textContent("#gMsg")) && !(await page.evaluate(() => sessionStorage.getItem("test.unlock"))));
  await page.fill("#gPass", "a long passphrase"); await page.click("#gGo"); await page.waitForTimeout(400);
  const o = await page.evaluate(() => ({ body: sessionStorage.getItem("test.unlock"), token: sessionStorage.getItem("octopus.token.v1"),
    gate: !!document.getElementById("wsGate"), locked: document.getElementById("app").classList.contains("locked"), name: document.getElementById("spaceName").textContent }));
  check("a workspace opens by its name and passphrase, in place", o.body === '{"name":"Acme Research","pass":"a long passphrase"}' && o.token === "tOpen"
    && !o.gate && !o.locked && o.name === "Acme Research", JSON.stringify(o));
  check("and nothing threw on the way", !bad.length, bad.join("\n       "));
  await page.close();
}

/* ---- the owner's doors: their workspace, with the passphrase on top ---- */
{
  const { page, bad } = await boot("/octopus", () => {
    window.fetch = async (u, opt) => {
      const s = String(u);
      if (s.includes("/api/status")) return Response.json({ gates: { octopus: true, squidgy: false }, demo: true });
      if (s.includes("/api/unlock")) {
        sessionStorage.setItem("test.unlock", opt.body);
        return JSON.parse(opt.body).pass === "a long passphrase" ? Response.json({ token: "tOcto", space: "octopus" }) : Response.json({ error: "that is not it" });
      }
      if (s.includes("/api/state")) return Response.json({ brains: [], concepts: [], sources: [], space: "octopus", spaceName: "Octopus" });
      return Response.json({});
    };
  });
  const d = await page.evaluate(() => ({ url: location.pathname + location.search, h: document.getElementById("gateH")?.textContent,
    name: !!document.getElementById("gName"), theme: document.documentElement.dataset.space, mark: document.getElementById("gateMark")?.getAttribute("src"),
    bg: getComputedStyle(document.body).backgroundColor, top: document.getElementById("wsGate")?.getBoundingClientRect().top }));
  check("/octopus opens the Octopus workspace with only its passphrase on top", d.url === "/chat?w=octopus" && d.h === "Octopus" && !d.name
    && d.theme === "octopus" && /logo-mark/.test(d.mark) && d.bg === "rgb(255, 255, 255)" && d.top < 200, JSON.stringify(d));
  await page.fill("#gPass", "a wrong passphrase"); await page.click("#gGo"); await page.waitForTimeout(150);
  check("a wrong passphrase says so, and the card stays", /That is not it/.test(await page.textContent("#gMsg")), await page.textContent("#gMsg"));
  await page.fill("#gPass", "a long passphrase"); await page.click("#gGo"); await page.waitForTimeout(400);
  const o = await page.evaluate(() => ({ body: sessionStorage.getItem("test.unlock"), token: sessionStorage.getItem("octopus.token.v1"),
    gate: !!document.getElementById("wsGate"), held: sessionStorage.getItem("octopus.space") }));
  check("the right passphrase opens it where it stands", o.body === '{"space":"octopus","pass":"a long passphrase"}' && o.token === "tOcto" && !o.gate && o.held === "octopus",
    JSON.stringify(o));
  check("the Octopus door boots with nothing thrown", !bad.length, bad.join("\n       "));
  await page.close();

  const sq = await boot("/squidgy", () => {
    window.fetch = async u => String(u).includes("/api/status") ? Response.json({ gates: { octopus: true, squidgy: false } }) : Response.json({});
  });
  const q = await sq.page.evaluate(() => ({ h: document.getElementById("gateH")?.textContent, theme: document.documentElement.dataset.space,
    mark: document.getElementById("gateMark")?.getAttribute("src"), msg: document.getElementById("gMsg")?.textContent }));
  check("Squidgy wears its own colours and mark, and says when it has no passphrase yet", q.h === "Squidgy" && q.theme === "squidgy"
    && /squidgy-icon/.test(q.mark) && /Shut until its owner/.test(q.msg), JSON.stringify(q));
  await sq.page.close();

  /* A tab that holds Octopus, sent to Squidgy, asks for Squidgy's passphrase. */
  const sw = await boot("/chat?w=squidgy", () => {
    sessionStorage.setItem("octopus.token.v1", "tOcto"); sessionStorage.setItem("octopus.space", "octopus");
    window.fetch = async u => { const s = String(u);
      if (s.includes("/api/state")) return Response.json({ brains: [], concepts: [], sources: [], space: "octopus", spaceName: "Octopus" });
      return Response.json({ gates: { octopus: true, squidgy: true } }); };
  });
  const k = await sw.page.evaluate(() => ({ h: document.getElementById("gateH")?.textContent, token: sessionStorage.getItem("octopus.token.v1") }));
  check("a link to another workspace asks for that one's passphrase", k.h === "Squidgy" && k.token === null, JSON.stringify(k));
  await sw.page.close();
}

/* ---- the landing: the workspaces along the top, one passphrase field ---- */
{
  const { page, bad } = await boot("/", () => {
    window.__posts = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      window.__posts.push({ s, body });
      if (s.includes("/api/status")) return Response.json({ demo: true });
      if (s.includes("/api/enter")) return body.pass === "the octopus door key" ? Response.json({ token: "tOct", space: "octopus" }) : Response.json({ demo: true });
      if (s.includes("/api/demo")) return Response.json({ token: "tDemo", space: "demo" });
      if (s.includes("/api/workspace/create")) return body.name === "Taken" ? Response.json({ error: "that name is taken. Pick another." })
        : Response.json({ token: "tNew", space: "acme-research", name: body.name });
      return Response.json({});
    };
  });
  await page.waitForTimeout(200);
  const l = await page.evaluate(() => ({ h1: document.querySelector("h1").textContent, sub: document.querySelector(".sub").textContent,
    spaces: [...document.querySelectorAll("#spaces .sp")].map(x => x.textContent.trim()).join("|"),
    doors: [document.getElementById("goOctopus")?.getAttribute("href"), document.getElementById("goSquidgy")?.getAttribute("href")],
    field: document.getElementById("pass")?.getAttribute("type"), ph: document.getElementById("pass")?.placeholder,
    help: document.querySelector(".help").textContent, bg: getComputedStyle(document.querySelector(".bg")).backgroundImage,
    sections: document.querySelectorAll("main section").length, font: getComputedStyle(document.body).fontFamily,
    page: getComputedStyle(document.body).backgroundColor, logo: document.querySelector(".logo").textContent.trim(),
    mark: document.querySelector(".logo img").getAttribute("src"), title: document.title, text: document.body.textContent }));
  check("the landing is one hero: a serif line, a sub line, one field", l.h1 === "Files what you read, and answers from it." && l.sections === 0
    && /^Drop a talk, a PDF or a link\./.test(l.sub), JSON.stringify(l.h1));
  check("the workspaces sit along the top, the demo first", l.spaces === "Demo|Octopus|Squidgy" && JSON.stringify(l.doors) === '["/chat?w=octopus","/chat?w=squidgy"]', l.spaces);
  check("the field takes a passphrase, hidden as it is typed", l.field === "password" && l.ph === "Enter your passphrase" && /opens the demo/.test(l.help), l.ph);
  check("the pencil landscape sits behind it", /\/brand\/landing\.webp/.test(l.bg), l.bg);
  check("it wears the Tasu greys: Geist on near-white, the folder mark", /^"?Geist/.test(l.font) && l.page === "rgb(250, 250, 250)" && l.logo === "tasu" && l.mark === "/brand/tasu.svg"
    && /^Tasu/.test(l.title), `${l.font} ${l.page}`);
  check("no em-dash on the landing", !/—/.test(l.text));

  await page.fill("#pass", "the octopus door key");
  await Promise.all([page.waitForURL(u => new URL(u).pathname === "/chat", { timeout: 5000 }).catch(() => {}), page.press("#pass", "Enter")]);
  const opened = await page.evaluate(() => ({ token: sessionStorage.getItem("octopus.token.v1"), space: sessionStorage.getItem("octopus.space"),
    sent: window.__posts?.find(p => p.s.includes("/api/enter"))?.body }));
  check("a passphrase opens the workspace it belongs to", opened.token === "tOct" && opened.space === "octopus" && new URL(page.url()).pathname === "/chat",
    JSON.stringify(opened) + " " + page.url());
  check("nothing threw on the landing", !bad.length, bad.join(" | "));
  await page.close();

  const w = await boot("/", () => {
    window.__posts = [];
    window.fetch = async (u, opt) => { const s = String(u); window.__posts.push({ s, body: JSON.parse(opt?.body || "{}") });
      if (s.includes("/api/status")) return Response.json({ demo: true });
      if (s.includes("/api/enter")) return Response.json({ demo: true });
      if (s.includes("/api/demo")) return Response.json({ token: "tDemo", space: "demo" });
      return Response.json({}); };
  });
  await w.page.fill("#pass", "not a real passphrase");
  await Promise.all([w.page.waitForURL(u => new URL(u).pathname === "/chat", { timeout: 5000 }).catch(() => {}), w.page.click("#go")]);
  check("a passphrase that opens nothing opens the demo", await w.page.evaluate(() => sessionStorage.getItem("octopus.token.v1")) === "tDemo"
    && new URL(w.page.url()).pathname === "/chat", w.page.url());
  await w.page.close();

  const e = await boot("/", () => {
    window.__posts = [];
    window.fetch = async (u, opt) => { const s = String(u); window.__posts.push({ s });
      if (s.includes("/api/status")) return Response.json({ demo: true });
      if (s.includes("/api/demo")) return Response.json({ token: "tDemo", space: "demo" });
      return Response.json({}); };
  });
  await Promise.all([e.page.waitForURL(u => new URL(u).pathname === "/chat", { timeout: 5000 }).catch(() => {}), e.page.click("#go")]);
  check("an empty field opens the demo, asking no door", await e.page.evaluate(() => sessionStorage.getItem("octopus.token.v1")) === "tDemo");
  await e.page.close();

  const d = await boot("/", () => {
    window.fetch = async u => { const s = String(u);
      if (s.includes("/api/status")) return Response.json({ demo: true });
      if (s.includes("/api/demo")) return Response.json({ token: "tDemo", space: "demo" });
      return Response.json({}); };
  });
  await Promise.all([d.page.waitForURL(u => new URL(u).pathname === "/chat", { timeout: 5000 }).catch(() => {}), d.page.click("#demoGo")]);
  check("the demo opens in one click from the top", await d.page.evaluate(() => sessionStorage.getItem("octopus.token.v1")) === "tDemo" && new URL(d.page.url()).pathname === "/chat", d.page.url());
  await d.page.close();

  /* Make your own workspace, from a sheet. */
  const c = await boot("/", () => {
    window.__posts = [];
    window.fetch = async (u, opt) => { const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__posts.push({ s, body });
      if (s.includes("/api/status")) return Response.json({ demo: true });
      if (s.includes("/api/workspace/create")) return body.name === "Taken" ? Response.json({ error: "that name is taken. Pick another." })
        : Response.json({ token: "tNew", space: "acme-research", name: body.name });
      return Response.json({}); };
  });
  check("the create form waits behind its link", !(await c.page.evaluate(() => document.getElementById("make").open)));
  await c.page.click("#makeOpen");
  await c.page.fill("#cName", "Taken"); await c.page.fill("#cPass", "a long passphrase"); await c.page.fill("#cKey", "nope");
  await c.page.click("#cGo"); await c.page.waitForTimeout(100);
  check("a key that is not OpenRouter's is caught before anything is sent", /starts with sk-or-/.test(await c.page.textContent("#cMsg"))
    && !(await c.page.evaluate(() => window.__posts.some(p => p.s.includes("/api/workspace/create")))));
  await c.page.fill("#cKey", "sk-or-v1-0123456789abcdef0123456789abcdef");
  await c.page.click("#cGo"); await c.page.waitForTimeout(150);
  check("a taken name says so", /taken/.test(await c.page.textContent("#cMsg")));
  await c.page.fill("#cName", "Acme Research");
  await Promise.all([c.page.waitForURL(u => new URL(u).pathname === "/chat", { timeout: 5000 }).catch(() => {}), c.page.click("#cGo")]);
  const made = await c.page.evaluate(() => ({ token: sessionStorage.getItem("octopus.token.v1"), key: localStorage.getItem("octopus.key.acme-research") }));
  check("a new workspace opens in the app, its key kept in this browser only", made.token === "tNew" && made.key === "sk-or-v1-0123456789abcdef0123456789abcdef"
    && new URL(c.page.url()).pathname === "/chat", JSON.stringify(made) + " " + c.page.url());
  await c.page.close();

  /* A workspace made for someone joins the list, by its name, with its own mark. */
  const hostedPage = await boot("/", () => {
    const px = "data:image/png;base64,iVBORw0KGgo=";
    window.fetch = async u => String(u).includes("/api/status") ? Response.json({ demo: true, hosted: [{ slug: "pandaaahh", name: "PandAAAHH" }, { slug: "bad slug<", name: "x" }],
      logos: { pandaaahh: px, octopus: "javascript:alert(1)", squidgy: px } }) : Response.json({});
  });
  await hostedPage.page.waitForTimeout(200);
  const marks = await hostedPage.page.evaluate(() => ({
    panda: document.querySelector('#spaces a[href="/chat?w=pandaaahh"] img')?.getAttribute("src"),
    squidgy: document.querySelector("#goSquidgy img").getAttribute("src"), octopus: document.querySelector("#goOctopus img").getAttribute("src"),
    listed: [...document.querySelectorAll("#spaces .sp")].map(a => `${a.textContent.trim()}:${a.getAttribute("href") || "demo"}`).join("|") }));
  check("a workspace wears the logo its owner set, on the landing", marks.panda?.startsWith("data:image/png") && marks.squidgy.startsWith("data:image/png"), JSON.stringify(marks));
  check("a logo that is not an image is never used, the default mark stays", marks.octopus === "/brand/logo-mark.png", marks.octopus);
  check("a workspace made on the deployment's key joins the top, and a bad slug never does", marks.listed === "Demo:demo|Octopus:/chat?w=octopus|Squidgy:/chat?w=squidgy|PandAAAHH:/chat?w=pandaaahh", marks.listed);
  await hostedPage.page.close();

  const o = await boot("/", () => {
    window.fetch = async u => String(u).includes("/api/status") ? Response.json({ demo: false }) : Response.json({});
  });
  await o.page.waitForTimeout(150);
  check("with no demo open, its button waits", await o.page.isDisabled("#demoGo"));
  await o.page.close();

  /* A phone gets the same page, and nothing scrolls sideways. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ph = await ctx.newPage();
  await ph.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ph.addInitScript(() => { window.fetch = async () => Response.json({ demo: true }); });
  await ph.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" }); await ph.waitForTimeout(400);
  const wide = await ph.evaluate(() => document.documentElement.scrollWidth);
  check("the landing fits a phone", wide <= 390, String(wide));
  check("it links the white paper", await ph.evaluate(() => [...document.querySelectorAll(".more a")].some(a => a.getAttribute("href") === "/about")));

  /* The white paper: eleven numbered sections, the house rules kept, and its
     tables scroll in their frame on a phone. */
  await ph.goto(ORIGIN + "/about", { waitUntil: "domcontentloaded" }); await ph.waitForTimeout(300);
  const paper = await ph.evaluate(() => {
    const text = document.querySelector("main").innerText;
    const toc = [...document.querySelectorAll(".toc a")].map(a => a.getAttribute("href").slice(1));
    return { title: document.title, sections: [...document.querySelectorAll("main section")].map(x => x.id), toc,
      dash: /—/.test(text), wide: document.documentElement.scrollWidth };
  });
  check("the white paper opens on its own address with eleven sections, each in the contents",
    paper.title === "Tasu: the white paper" && paper.sections.length === 11 && JSON.stringify(paper.sections) === JSON.stringify(paper.toc), JSON.stringify(paper.sections));
  check("it keeps the house rules: no em-dash", !paper.dash);
  check("and it fits a phone, its tables scrolling in their own frame", paper.wide <= 390, String(paper.wide));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nthe pages run");
process.exit(failures ? 1 : 0);
