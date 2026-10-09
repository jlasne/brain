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
    await page.focus("#input"); await page.fill("#srcInput", src);
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
  await page.focus("#input"); await page.click("#scopeBtn");
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
  await page.focus("#input"); await page.click("#scopeBtn"); await page.keyboard.press("Escape");
  check("Escape closes the menu", !(await page.$(".pick-menu")));
  await page.focus("#input"); await page.click("#scopeBtn"); await page.click(".pick-menu .pk-row >> nth=0");
  const top = await page.evaluate(() => {
    const acts = [...document.querySelectorAll("aside .side-acts button")].map(b => b.id + ":" + b.textContent.trim()).join(",");
    const panels = [...document.querySelectorAll("aside .panel")].map(p => p.id + ":" + p.querySelector(".fold-t").textContent.replace(/\s+/g, " ").trim().split(" ")[0]).join(",");
    return { acts, panels, plus: [...document.querySelectorAll("aside .panel .side-plus")].map(b => b.id).join(","),
      gone: !document.getElementById("gapsBtn") && !document.getElementById("mapBtn") };
  });
  check("the side panel opens on New chat, then Drop, One-pager and Settings as rows", top.acts === "startBtn:New chat,dropBtn:Drop,pagerBtn:One-pager,keyBtn:Settings"
    && await page.evaluate(() => document.getElementById("startBtn").classList.contains("go") && !document.getElementById("dropBtn").classList.contains("go")), top.acts);
  check("then Chats, Projects and Folders, each a list of its own", top.panels === "chatsPanel:Chats,projectsPanel:Projects,brainsPanel:Folders" && top.gone, top.panels);
  check("New chat on top is the one way to start a chat; Projects and Folders keep their +", top.plus === "newProject,newBrain", top.plus);
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
  check("Settings holds the model and the export; Audit has its own section", setup.order === "setModel,setExport" && setup.model === "model"
    && await page.evaluate(() => !!document.getElementById("auditBlock") && !document.getElementById("setTidy")), JSON.stringify(setup));
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
    models: { chat: "deepseek/deepseek-v4-flash-0731", chatDefault: "deepseek/deepseek-v4-flash-0731" } };
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
      if (s.includes("/api/models")) return Response.json({ chat: body.chat === undefined ? state.models.chat : body.chat || state.models.chatDefault });
      if (s.includes("/api/ask")) return Response.json({ answer: "One line.", sources: 3, level: "normal" });
      return Response.json({});
    };
  }, withModels);
  check("a model picked in this browser before is dropped: the workspace's pick rules", await page.evaluate(() => localStorage.getItem("octopus.model")) === null);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(150);
  const rows = await page.evaluate(() => ({ chat: document.querySelector("#setModel .val")?.textContent }));
  check("Settings shows one model, DeepSeek by default", rows.chat === "deepseek-v4-flash-0731", JSON.stringify(rows));
  await page.click("#setModel"); await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({ title: document.querySelector(".sheet h3")?.textContent, first: document.querySelector("#mList .mrow span")?.textContent,
    on: document.querySelector("#mList .mrow.on b")?.textContent }));
  check("Model opens the list on its default, marked", sheet.title === "Model" && /deepseek-v4-flash-0731/.test(sheet.first || "") && /default/.test(sheet.first || "")
    && sheet.on === "DeepSeek V4 Flash", JSON.stringify(sheet));
  await page.click('#mList .mrow:has(b:text-is("Z.ai: GLM 5.3"))'); await page.click("#mSave"); await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({ body: window.__calls.filter(c => c.s.includes("/api/models")).pop()?.body,
    val: document.querySelector("#setModel .val")?.textContent, pick: document.getElementById("setModel")?.classList.contains("pick") }));
  check("a pick is saved for the workspace, and Settings shows it", saved.body?.chat === "z-ai/glm-5.3" && saved.val === "glm-5.3" && saved.pick, JSON.stringify(saved));
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

/* ---- favourites: the model is the cheapest of a list, chosen each day ---- */
{
  const DS = "deepseek/deepseek-v4-flash-0731", GLM = "z-ai/glm-5.3-flash";
  const day = Date.parse("2026-10-08T05:30:00Z");
  const withFavs = { ...STATE, model: DS, models: { chat: DS, chatDefault: GLM, favs: [DS, GLM], favAt: day, favPrices: [{ id: DS, price: 0.12 }, { id: GLM, price: 0.178 }] } };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("openrouter.ai/api/v1/models")) return Response.json({ data: [
        { id: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek: DeepSeek V4 Flash 0731", pricing: { prompt: "0.0000000104", completion: "0.00000128" }, context_length: 1048576, supported_parameters: ["response_format"] },
        { id: "z-ai/glm-5.3-flash", name: "Z.ai: GLM 5.3 Flash", pricing: { prompt: "0.00000015", completion: "0.0000005" }, context_length: 1048576, supported_parameters: ["response_format"] },
        { id: "z-ai/glm-5.3", name: "Z.ai: GLM 5.3", pricing: { prompt: "0.0000014", completion: "0.0000044" }, context_length: 1048576, supported_parameters: ["response_format"] }] });
      if (s.includes("/api/state")) return Response.json(state);
      /* A model picked by hand ends the favourites, as the server does. */
      if (s.includes("/api/models")) return Response.json({ chat: body.chat || state.models.chatDefault, favs: null });
      return Response.json({ chats: [] });
    };
  }, withFavs);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(150);
  const lab = await page.evaluate(() => ({ val: document.querySelector("#setModel .val")?.textContent, title: document.getElementById("setModel")?.title }));
  check("Settings says the model is the cheapest of the favourites today", lab.val === "deepseek-v4-flash-0731" && /the cheapest of your 2 favourites today/.test(lab.title || ""), JSON.stringify(lab));
  await page.click("#setModel"); await page.waitForTimeout(250);
  const line = await page.evaluate(() => { const f = document.getElementById("mFav"); return { hidden: f.hidden, text: f.textContent }; });
  check("the model list opens on a line that names the favourites, the price each was compared at, and the day",
    !line.hidden && line.text === "Chosen each day as the cheapest of your favourites, checked 8 Oct 2026: DeepSeek V4 Flash 0731 $0.12 · GLM 5.3 Flash $0.178, per million tokens. Picking a model here ends that.", JSON.stringify(line));
  await page.click('#mList .mrow:has(b:text-is("Z.ai: GLM 5.3"))'); await page.click("#mSave"); await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ body: window.__calls.filter(c => c.s.includes("/api/models")).pop()?.body, title: document.getElementById("setModel")?.title }));
  check("a model picked by hand is saved, and the label stops saying it is chosen daily", after.body?.chat === "z-ai/glm-5.3" && !/favourites/.test(after.title || "") && /picked for this workspace/.test(after.title || ""), JSON.stringify(after));
  await page.click("#setModel"); await page.waitForTimeout(250);
  check("and the line is gone from the list", await page.evaluate(() => document.getElementById("mFav").hidden));
  check("nothing threw with favourites", !bad.length, bad.join(" | "));
  await page.close();

  /* A workspace with no favourites shows no line. */
  const plain = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async (u) => String(u).includes("openrouter.ai") ? Response.json({ data: [] }) : String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] });
  }, { ...STATE, model: GLM, models: { chat: GLM, chatDefault: GLM } });
  await plain.page.evaluate(() => document.getElementById("keyBtn").click()); await plain.page.waitForTimeout(150);
  const plainTitle = await plain.page.evaluate(() => document.getElementById("setModel").title);
  await plain.page.click("#setModel"); await plain.page.waitForTimeout(200);
  check("a workspace with no favourites shows no such line", await plain.page.evaluate(() => document.getElementById("mFav").hidden) && !/favourites/.test(plainTitle), plainTitle);
  await plain.page.close();
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
      if (s.includes("/api/ask")) { window.__askedC = JSON.parse(opt?.body || "{}");
        return Response.json({ answer: "It holds: an offer beats reach.", sources: 1, level: "normal", chat: "c-about",
          concept: { id: "content/offer", title: "Offer first", brain: "content", personal: false }, changed: null }); }
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
  /* ---- a chat about this one concept alone ---- */
  await page.click("#fvAsk"); await page.waitForTimeout(80);
  const about = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, chip: document.getElementById("aboutLine").textContent,
    shown: !document.getElementById("aboutLine").hidden, ph: document.getElementById("input").placeholder,
    scope: document.getElementById("scopeBtn").hidden, levels: document.getElementById("levelWrap").hidden }));
  check("Chat about it opens a chat on that concept alone, named on a chip",
    about.view === "chat" && about.shown && /Offer first/.test(about.chip) && /^Ask about Offer first/.test(about.ph) && about.scope && about.levels, JSON.stringify(about));
  await page.fill("#input", "What holds?"); await page.click("#send"); await page.waitForTimeout(250);
  const sent = await page.evaluate(() => window.__askedC);
  check("its question travels with the concept, and no folder", sent?.concept === "content/offer" && !("brain" in sent) && !sent.brains, JSON.stringify(sent));
  const said = await page.evaluate(() => ({ ans: [...document.querySelectorAll("#thread .msg.ai")].pop()?.textContent || "",
    pager: [...document.querySelectorAll("#thread .ans-acts button")].some(b => /One-pager/.test(b.textContent)) }));
  check("its answer reads that concept, with Copy alone under it", /an offer beats reach/.test(said.ans) && !said.pager, JSON.stringify(said));
  await page.click("#aboutX"); await page.waitForTimeout(60);
  const left = await page.evaluate(() => ({ hidden: document.getElementById("aboutLine").hidden, ph: document.getElementById("input").placeholder,
    thread: document.querySelectorAll("#thread .msg").length }));
  check("its × leaves it for a new chat on the folders", left.hidden && !/Offer first/.test(left.ph) && left.thread === 0, JSON.stringify(left));
  await page.hover(".brain-row"); await page.click(".brain-row .ed >> text=open"); await page.waitForTimeout(150);
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
  await page.focus("#input"); await page.fill("#srcInput", "Accounting basics.pdf");
  await page.fill("#input", "Five rules, each explained.");
  await page.click("#send"); await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    sent: window.__plans[0]?.ext?.kind,
    note: document.getElementById("dropKept")?.textContent || "",
    button: [...document.querySelectorAll(".msg.ai button")].some(b => /File every topic/.test(b.textContent)) }));
  check(`a source read as ${kind} tells the plan so`, r.sent === kind, String(r.sent));
  check(`and the card says how it was read`,
    kind === "study" ? /Read as study material/.test(r.note) && /5 topics, filed into 5 concepts/.test(r.note)
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
  await page.focus("#input"); await page.fill("#srcInput", "Long manual.pdf");
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
    note: document.getElementById("dropKept")?.textContent || "" }));
  check("60 topics are planned in 3 batches", planned.n === 3 && planned.sizes.join(",") === "25,25,10", planned.sizes.join(","));
  check("the first part plans alone, the next ones see its titles", planned.proposed.join(",") === "0,25,25", planned.proposed.join(","));
  check("and every topic is filed", /60 topics, filed into 60 concepts/.test(planned.note), planned.note);

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
  await page.focus("#input"); await page.fill("#srcInput", "Accounting basics.pdf");
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
  await page.focus("#input"); await page.fill("#srcInput", "Ziggy case.pdf");
  await page.fill("#input", "A hedging case study.");
  await page.click("#send"); await page.waitForTimeout(700);
  const note = await page.evaluate(() => document.getElementById("dropKept")?.textContent || "");
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
  await page.focus("#input"); await page.fill("#srcInput", "Guide.pdf");
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
  await page.focus("#input"); await page.fill("#srcInput", "Big manual.pdf");
  await page.fill("#input", "Two hundred fifty rules.");
  await page.click("#send"); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ plans: window.__plans, peak: window.__peak, merge: window.__merge,
    note: document.getElementById("dropKept")?.textContent || "" }));
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
  await page.focus("#input"); await page.fill("#srcInput", found === "youtube" ? "https://youtu.be/goldTalk42" : "Offers talk");
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
  check("a ticked row shows its box, and the phone's Done counts them", two.box !== "none" && two.go === "Done · 2 folders ticked", JSON.stringify(two));
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

/* ---- Settings: Audit holds the clashes and what an audit found, in one fold ---- */
{
  const st = { ...STATE, concepts: [{ brain: "content", slug: "ai-rates", n: 1, title: "Financing AI", summaryLine: "Rates", src: 2, ev: 2 }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: ["content/ai-rates", "content/paywall"], health: [{ slug: "content", score: 7, open: 2, best: "x", parts: {} }] });
      if (s.includes("/api/conflicts")) return Response.json({ others: 8, conflicts: [
        { id: "content/ai-rates", brain: "content", title: "Financing AI", a: "AI pushes rates up", aDate: "", b: "Rates fell around AI releases", bDate: "2026-09-01",
          why: "Crowding out implies higher rates", hint: { pick: "b", why: "The later claim: 2026-09-01" } },
        { id: "content/paywall", brain: "content", title: "Scaling at $10k MRR", a: "A hard paywall wins", aDate: "", b: "Growth runs on referrals", bDate: "",
          why: "", hint: { pick: "both", why: "Nothing dates either" } }] });
      return Response.json({});
    };
  }, st);
  await page.waitForTimeout(500);
  const asked = () => page.evaluate(() => window.__calls.filter(x => x.s.endsWith("/api/conflicts")).length);
  const before = await asked();
  await page.evaluate(() => document.getElementById("keyBtn").click());
  await page.waitForTimeout(250);
  const set = await page.evaluate(() => ({
    folds: ["auditBlock", "langBlock", "lookBlock", "passBlock"].map(id => document.getElementById(id)).map(d => `${d.id}:${d.tagName}:${d.open}`),
    gone: !document.getElementById("cfBlock") && !document.getElementById("cfSlot") && !document.getElementById("cfDeck"),
    sum: document.getElementById("auditSum").textContent, title: document.querySelector("#auditDecide b").textContent,
    say: document.querySelector("#auditDecide span").textContent, btn: document.querySelector("#auditDecide button").textContent,
    folder: document.querySelector("#auditList .au-row b")?.textContent }));
  check("Settings folds Audit, Languages, Look and Passphrase shut, and the open conflicts are no fold of their own",
    set.folds.every(f => /:DETAILS:false$/.test(f)) && set.gone, JSON.stringify(set));
  check("the Audit fold says what waits, the clashes counted as decisions, and still lists each folder to audit",
    set.sum === "2 to decide" && set.title === "Decisions" && set.say === "2 clashes" && set.btn === "Decide" && set.folder === "Content", JSON.stringify(set));
  check("opening Settings asks the server for no clash list: the inbox holds them already", (await asked()) === before, `${before} -> ${await asked()}`);
  await page.click("#auditBlock > summary");
  await page.click("#auditDecide button"); await page.waitForTimeout(300);
  const dec = await page.evaluate(() => ({ settings: !!document.getElementById("auditBlock"), sheet: !!document.querySelector(".dc-sheet"),
    rows: [...document.querySelectorAll(".dc-row")].map(r => r.querySelector(".dc-t").textContent), swipe: document.getElementById("dcSwipe").hidden }));
  check("Decide opens the decisions, the clashes among them, with a button to swipe through them",
    !dec.settings && dec.sheet && dec.rows.join("|") === "Financing AI|Scaling at $10k MRR" && !dec.swipe, JSON.stringify(dec));
  await page.click("#dcSwipe"); await page.waitForTimeout(200);
  const deck = await page.evaluate(() => ({ title: document.querySelector(".dk-card:not(.gone) h4")?.textContent, n: document.getElementById("dkN").textContent,
    hint: document.querySelector(".dk-card:not(.gone) .dk-hint")?.textContent }));
  check("Swipe the clashes opens the deck on the first one, with its suggested call, and asks the server for nothing",
    deck.title === "Financing AI" && deck.n === "1 of 2" && deck.hint === "Suggested: B holds. The later claim: 2026-09-01" && (await asked()) === before, JSON.stringify(deck));
  check("nothing threw in Settings", !bad.length, bad.join(" | "));
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
      if (s.includes("/api/health")) return Response.json({ conflicted: ["content/ai-rates", "content/paywall"], health: [{ slug: "content", score: 7, open: 2, best: "x", parts: {} }] });
      if (s.includes("/api/conflicts/settle")) { window.__settles.push(body);
        return Response.json(body.pick === "both" ? { ok: true } : { ok: true, position: "P.", summaryLine: "S." }); }
      if (s.includes("/api/conflicts")) return Response.json({ others: 3, conflicts: [
        { id: "content/ai-rates", brain: "content", title: "Financing AI", a: "AI pushes rates up", aDate: "2026-01-02", b: "Rates fell around AI releases", bDate: "2026-09-01", why: "Crowding out implies higher rates" },
        { id: "content/paywall", brain: "content", title: "Scaling at $10k MRR", a: "A hard paywall wins", aDate: "", b: "Growth runs on referrals", bDate: "", why: "" } ] });
      return Response.json({});
    };
  }, STATE);
  await page.waitForTimeout(500);
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  await page.click("#inbox .ib-it >> text=2 decisions ready"); await page.waitForTimeout(250);
  check("the decisions offer the clashes one by one", (await page.textContent("#dcSwipe")) === "Swipe the clashes");
  await page.click("#dcSwipe"); await page.waitForTimeout(150);
  const card = () => page.evaluate(() => {
    const c = document.querySelector(".dk-card:not(.gone)");
    return { title: c?.querySelector("h4")?.textContent || "", n: document.getElementById("dkN").textContent,
      sides: [...(c?.querySelectorAll(".dk-side p") || [])].map(p => p.textContent), undo: !document.getElementById("dkUndo").hidden,
      toast: document.getElementById("dkToast").textContent, done: document.querySelector(".dk-done")?.textContent || "" };
  });
  const first = await card();
  check("the deck opens on the first clash, both sides shown", first.title === "Financing AI" && first.n === "1 of 2"
    && first.sides.join("|") === "AI pushes rates up|Rates fell around AI releases" && !!(await page.$(".deck")), JSON.stringify(first));

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

  await page.evaluate(() => document.getElementById("startBtn").click()); await page.waitForTimeout(100);
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
  await page.focus("#input"); await page.fill("#srcInput", "https://example.com/a-post");
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
  check("Setup offers the look to set", await page.isVisible("#lookBlock") && await page.isDisabled("#lookSave")
    && await page.evaluate(() => document.querySelector("#lookBlock > summary").textContent) === "Lookyour own");
  await page.click("#lookBlock > summary");
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
  await page.click("#passBlock > summary");
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
  await page.focus("#input"); await page.click("#scopeBtn"); await page.waitForTimeout(80);
  const ask = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-nm")].map(x => x.firstChild.textContent).join("|"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.getElementById("dropBtn").click()); await page.waitForTimeout(80);
  await page.focus("#input"); await page.click("#scopeBtn"); await page.waitForTimeout(80);
  const feed = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-nm")].map(x => x.firstChild.textContent).join("|"));
  check("the demo asks across a shared brain and only offers its own to feed", /Wealth/.test(ask) && /Health/.test(ask) && /Health/.test(feed) && !/Wealth/.test(feed), JSON.stringify({ ask, feed }));
  check("and its row says it is read only here", await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].some(r => /Read only here/.test(r.title))));
  const groups = await page.evaluate(() => [...document.querySelectorAll("#brains .group-h, #brains .brain-row .nm")].map(x => x.textContent).join(","));
  check("the demo lists its folders by type, the one it may only ask marked so", groups === "Subjects,Health,Wealth"
    && await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].map(r => r.querySelector(".ro-tag")?.textContent || "").join("|")) === "|Ask only", groups);
  check("and a visitor makes no folder", await page.evaluate(() => document.getElementById("newBrain").hidden));
  await page.close();
}

/* ---- the demo shows what to try: questions and a clash ---- */
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

/* ---- talk on Android: no phrase said twice, and it listens one phrase at a time ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36" });
    window.__voice = []; window.__hold = true;
    /* Chrome on Android: every partial of a phrase comes back as a result of its own. The test sends what it hears by hand. */
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start(){ window.__voice.push({ lang: this.lang, continuous: this.continuous }); window.__rec = this;
        setTimeout(() => { if (!this.userStopped) this.onend?.(); }, window.__hold ? 60000 : 90); }
      stop(){ setTimeout(() => this.onend?.(), 10); }
    };
    window.__say = list => window.__rec.onresult({ results: list.map(t => [{ transcript: t }]) });
    window.fetch = async (u, opt) => { const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      return Response.json({ chats: [] }); };
  }, { ...STATE, models: { voice: "fr-FR" } });
  await page.fill("#input", "Voici :");
  await page.click("#micBtn"); await page.waitForTimeout(80);
  const said = async list => { await page.evaluate(l => window.__say(l), list); return await page.inputValue("#input"); };
  const chain = await said(["adjustement", "adjustement", "adjustement at", "adjustement at that my", "adjustement at that my god is small"]);
  check("the partials of a phrase count for the longest alone, so nothing is said twice", chain === "Voici : adjustement at that my god is small", chain);
  const two = await said(["Bonjour tout le monde.", "Comment ça va ?"]);
  const accents = await said(["très", "très bien", "très bien, merci"]);
  const stutter = await said(["je veux je veux je veux je veux je veux partir"]);
  const twice = await said(["ok ok"]);
  check("two phrases stay two, with their accents; a word or a phrase said 4 times or more keeps one, twice stays twice",
    two === "Voici : Bonjour tout le monde. Comment ça va ?" && accents === "Voici : très bien, merci" && stutter === "Voici : je veux partir" && twice === "Voici : ok ok",
    JSON.stringify({ two, accents, stutter, twice }));
  await page.click("#micBtn"); await page.waitForTimeout(80);
  await page.evaluate(() => { window.__hold = false; });
  await page.fill("#input", "");
  await page.click("#micBtn"); await page.evaluate(() => window.__say(["bonjour", "bonjour à tous"])); await page.waitForTimeout(700);
  const run = await page.evaluate(() => ({ value: document.getElementById("input").value, starts: window.__voice.length, continuous: window.__voice.at(-1)?.continuous,
    on: document.getElementById("micBtn").classList.contains("on") }));
  check("on Android the mic listens one phrase at a time, again until two runs in a row hear nothing, and the words come out once",
    run.value === "bonjour à tous" && run.continuous === false && run.starts === 4 && !run.on, JSON.stringify(run));
  await page.click("#micBtn"); await page.waitForTimeout(40);
  await page.click("#micBtn"); await page.waitForTimeout(250);
  const stopped = await page.evaluate(() => ({ starts: window.__voice.length, on: document.getElementById("micBtn").classList.contains("on") }));
  check("a tap on the mic stops it for good: it never starts again by itself", stopped.starts === 5 && !stopped.on, JSON.stringify(stopped));
  check("nothing threw on the phone's mic", !bad.length, bad.join(" | "));
  await page.close();
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
    window.fetch = async (u, opt) => { const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/models")) return Response.json({ chat: "m/x", reply: "same", voice: body.voice ?? null });
      return Response.json({ chats: [] }); };
  }, STATE);
  await page.fill("#input", "Quick one:");
  await page.click("#micBtn"); await page.waitForTimeout(200);
  const ask = await page.evaluate(() => ({ heard: window.__voice.length, open: !!document.getElementById("langVoice"),
    langs: [...document.querySelectorAll("#langVoice button")].map(b => b.textContent), lit: document.querySelectorAll("#langVoice .on").length,
    asked: document.querySelector(".lang-row.ask") !== null, msg: document.getElementById("langMsg")?.textContent }));
  check("with no language picked, the mic opens Settings on Voice input and listens to nothing",
    ask.heard === 0 && ask.open && ask.asked && ask.lit === 0 && /Pick the language the mic listens in/.test(ask.msg || ""), JSON.stringify(ask));
  check("Voice input has no Auto: a language is picked", JSON.stringify(ask.langs) === '["English","French","Spanish","German","Italian","Portuguese"]', JSON.stringify(ask.langs));
  await page.click('#langVoice button[data-v="en-US"]'); await page.waitForTimeout(150);
  await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector(".veil")?.remove());
  await page.click("#micBtn"); await page.waitForTimeout(150);
  const on = await page.evaluate(() => ({ value: document.getElementById("input").value, on: document.getElementById("micBtn").classList.contains("on"),
    pressed: document.getElementById("micBtn").getAttribute("aria-pressed"), hint: document.getElementById("tHint").textContent, lang: window.__voice[0]?.lang }));
  check("once picked, the mic listens in it, says which, and writes after what was typed", on.value === "Quick one: what do my brains say on sleep"
    && on.on && on.pressed === "true" && on.hint === "Listening in English. Tap the mic to stop." && on.lang === "en-US", JSON.stringify(on));
  await page.click("#micBtn"); await page.waitForTimeout(80);
  const off = await page.evaluate(() => ({ on: document.getElementById("micBtn").classList.contains("on"), send: document.getElementById("send").disabled,
    hint: document.getElementById("tHint").textContent }));
  check("a second tap stops it, and the words wait to be sent", !off.on && !off.send && off.hint === "", JSON.stringify(off));

  /* French: set once in Settings, then the mic in the folded bar. */
  check("the bar carries no language chip: the voice language lives in Settings", await page.evaluate(() => !document.getElementById("voiceLang")));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(150);
  check("closed, Languages says where it stands", await page.evaluate(() => document.querySelector("#langBlock > summary").textContent) === "Languagesanswers as you write · mic in English",
    await page.evaluate(() => document.querySelector("#langBlock > summary").textContent));
  await page.click("#langBlock > summary");
  await page.click('#langVoice button[data-v="fr-FR"]'); await page.waitForTimeout(150);
  check("Settings, Languages, Voice input: French saved for the workspace", await page.evaluate(() => document.querySelector("#langVoice .on")?.textContent) === "French");
  await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector(".veil")?.remove());
  await page.fill("#input", ""); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(250);
  check("the bar rests folded", await page.evaluate(() => document.querySelector(".composer-wrap").classList.contains("compact")));
  await page.click("#micBtn"); await page.waitForTimeout(150);
  const heard = await page.evaluate(() => ({ lang: window.__voice.at(-1)?.lang, n: window.__voice.length, hint: document.getElementById("tHint").textContent }));
  check("a tap on the mic in the folded bar starts it, listening in French", heard.n === 2 && heard.lang === "fr-FR" && heard.hint === "Listening in French. Tap the mic to stop.", JSON.stringify(heard));
  await page.click("#micBtn"); await page.waitForTimeout(80);
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
      if (s.includes("/api/brain/tidy") && body.brain === "health") return Response.json({ brain: "health", total: 2, read: 2, same: [], english: [], blank: [] });
      if (s.includes("/api/brain/tidy")) return Response.json({ brain: "content", total: 2, read: 2,
        same: [[{ id: "content/offer-creation", title: "Offer creation", line: "Offer first.", ev: 2 },
                { id: "content/personal-brand", title: "Offre", line: "Face beats logo.", ev: 1 }]],
        english: [{ id: "content/offer-creation", title: "Création d'offre", line: "", ev: 2, to: "Offer creation" }],
        blank: [{ id: "content/offer-creation", title: "Offer creation", line: "", ev: 2 }, { id: "content/personal-brand", title: "Offre", line: "", ev: 1 }] });
      if (s.includes("/api/concept/merge")) return Response.json({ into: body.into, joined: 1, links: 0, rewritten: true });
      if (s.includes("/api/concept/rename")) return Response.json({ id: body.id, title: body.title });
      if (s.includes("/api/concept/rederive")) return Response.json({ written: body.ids });
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] });
    };
  }, { ...STATE, brains: [...STATE.brains, { slug: "health", name: "Health", type: "subject", scope: "h" }, { slug: "me", name: "Me", type: "personal", scope: "" }],
       concepts: [{ brain: "content", slug: "offer-creation", n: 1, title: "Offer creation", summaryLine: "" },
                  { brain: "content", slug: "personal-brand", n: 2, title: "Offre", summaryLine: "Face beats logo." },
                  { brain: "health", slug: "sleep", n: 1, title: "Sleep", summaryLine: "s" }, { brain: "health", slug: "sauna", n: 2, title: "Sauna", summaryLine: "s" },
                  { brain: "me", slug: "n1", n: 1, title: "N1", summaryLine: "" }, { brain: "me", slug: "n2", n: 2, title: "N2", summaryLine: "" }] });
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
  await page.click(".composer .box"); await page.focus("#input"); await page.click("#scopeBtn"); await page.waitForTimeout(250);
  check("its folder menu keeps it open", !(await bar()).c && await page.isVisible(".pick-menu"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);

  /* Audit, from Settings: each finding waits for its own click. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Content/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(250);
  check("a folder carries no Tidy button: the audit lives in Settings", await page.evaluate(() => !document.getElementById("fvTidy")));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#auditList .au-row")].map(r => `${r.querySelector("b").textContent}:${r.querySelector("span").textContent}`));
  check("Settings, Audit lists each folder held, with its last audit and the sources since", rows.some(r => /^Content:Never audited · \d+ sources? since$/.test(r)), JSON.stringify(rows));
  await page.click("#auditBlock > summary");
  await page.click('#auditList .au-row[data-slug="content"] button'); await page.waitForTimeout(300);
  const pane = await page.evaluate(() => ({ heads: [...document.querySelectorAll("#tidyPane h4")].map(h => h.textContent).join("|"),
    opts: [...document.querySelectorAll("#tidyPane .td-opt b")].map(b => b.textContent).join(","),
    ren: document.querySelector("#tidyPane .td-ren .td-in")?.value }));
  check("Tidy lists what is filed twice, what is not in English, and what has no position",
    pane.heads === "Filed twice · 1|Not in English · 1|No position · 2" && pane.opts === "Offer creation,Offre" && pane.ren === "Offer creation", JSON.stringify(pane));
  await page.click("#tidyPane .td-opt:nth-child(1) input");
  await page.click("#tidyPane .td-card .td-go"); await page.waitForTimeout(250);
  const merged = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/merge"))?.body);
  check("Merge folds the others into the title picked", merged?.into === "content/offer-creation" && JSON.stringify(merged?.from) === '["content/personal-brand"]', JSON.stringify(merged));
  check("and says it is done", /Merged into Offer creation, position written again/.test(await page.textContent("#tidyPane .td-card .td-say")));
  await page.fill("#tidyPane .td-ren .td-in", "Personal branding");
  await page.click("#tidyPane .td-ren .td-go"); await page.waitForTimeout(200);
  const renamed = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/rename"))?.body);
  check("Rename sends the title as edited", renamed?.id === "content/offer-creation" && renamed?.title === "Personal branding", JSON.stringify(renamed));
  await page.click("#tidyPane .td-card:last-of-type .td-go"); await page.waitForTimeout(250);
  const wrote = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/concept/rederive"))?.body);
  check("and the empty ones get their position from what they hold, never one a merge folded away", JSON.stringify(wrote?.ids) === '["content/offer-creation"]', JSON.stringify(wrote));
  const stamped = await page.evaluate(() => window.__calls.find(c => c.s.includes("/api/brain/audit"))?.body);
  check("the audit is stamped once it has read the folder", stamped?.brain === "content" && stamped.action === "done", JSON.stringify(stamped));

  check("nothing threw folding the bar or tidying", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the graph: kinds of link, what follows, topics ---- */
{
  const st = { ...STATE, brains: [...STATE.brains, { slug: "macro", name: "Macro", type: "subject", scope: "m" }],
    concepts: [
      { brain: "content", slug: "holding", n: 1, title: "Holding cost", summaryLine: "What a unit costs to keep." },
      { brain: "content", slug: "ordering", n: 2, title: "Ordering cost", summaryLine: "What an order costs to place." },
      { brain: "content", slug: "eoq", n: 3, title: "Economic order quantity", summaryLine: "The order size that costs least.",
        kinds: [{ to: "content/holding", type: "needs" }, { to: "content/ordering", type: "needs" }] },
      { brain: "content", slug: "safety", n: 4, title: "Safety stock", summaryLine: "Stock held against surprises.", kinds: [{ to: "content/eoq", type: "needs" }] },
      { brain: "macro", slug: "rates", n: 1, title: "Interest rates", summaryLine: "The price of money." }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/topics")) return Response.json({ topics: [{ title: "Order costs", summary: "What ordering and holding stock cost.", members: ["content/holding", "content/ordering", "content/eoq"] }] });
      if (s.includes("/api/concept")) return Response.json({
        concept: { brain: "content", slug: "eoq", title: "Economic order quantity", position: "EOQ balances ordering and holding costs.", summaryLine: "",
          evidence: [], data: [], conflicts: [], sources: [], related: ["content/holding", "content/ordering", "macro/rates"],
          kinds: [{ to: "content/holding", type: "needs" }, { to: "content/ordering", type: "needs" }, { to: "macro/rates", type: "causes" }] },
        insights: [{ a: "content/eoq", b: "macro/rates", type: "causes", title: "Higher rates shrink orders", text: "Holding cost carries the interest rate, so a rate rise lowers the EOQ." }] });
      return Response.json({ chats: [], conflicts: [], others: 0, health: [] });
    };
  }, st);
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Content/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(300);
  const tops = await page.evaluate(() => [...document.querySelectorAll(".fv-top")].map(x => x.textContent).join("|"));
  check("a folder shows its topics above its concepts", tops === "All|Order costs3", tops);
  await page.click('.fv-top:has-text("Order costs")'); await page.waitForTimeout(100);
  const rows = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".fv-row b")].map(x => x.textContent).sort().join("|"), line: document.querySelector(".fv-topline").textContent }));
  check("a topic narrows the list to its concepts and says what it holds", rows.rows === "Economic order quantity|Holding cost|Ordering cost"
    && rows.line === "What ordering and holding stock cost.", JSON.stringify(rows));

  await page.click('.fv-row:has-text("Economic order quantity")'); await page.waitForTimeout(300);
  const pane = await page.evaluate(() => ({
    first: [...document.querySelectorAll(".fv-first .vw-link")].map(x => x.textContent).join("|"),
    links: [...document.querySelectorAll(".fv-links .vw-link")].map(x => x.textContent).join("|"),
    ins: document.querySelector(".ins b")?.textContent, note: document.querySelector(".ins-note")?.textContent }));
  check("a concept says what to learn first", pane.first === "Holding cost|Ordering cost", pane.first);
  check("each link says what it is, and a link to another folder names it", /needsHolding cost/.test(pane.links) && /causesInterest rates · Macro/.test(pane.links)
    && /thenSafety stock/.test(pane.links), pane.links);
  check("what follows is shown, marked as drawn by Tasu, not a source", pane.ins === "Higher rates shrink orders" && /not a source/.test(pane.note || ""), JSON.stringify(pane));

  check("and a folder offers no learning path of its own", !(await page.$("#fvPath")) && !(await page.$(".lp-step")));
  check("nothing threw on the graph", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the side panel: Chats and Folders, a personal folder first ---- */
{
  const lim = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "What I say", owner: null },
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
  check("every workspace shows Chats, Projects and Folders", seen.panels === "chatsPanel,projectsPanel,brainsPanel", seen.panels);
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
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "What I say", owner: null, audit: { at: new Date().toISOString().slice(0, 10), sources: 0 } }],
    concepts: [{ brain: "me", slug: "lisbon", n: 1, title: "Moving abroad", summaryLine: "Lisbon in 2027" }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/ask")) return Response.json({ answer: "Noted. Porto replaces Lisbon.", sources: 0, level: "normal", personal: true,
        filed: { new: 1, updated: 1, titles: ["Moving abroad", "Budget"] }, called: ["Health"], chat: "c1" });
      if (s.includes("/api/personal/remember")) { await new Promise(ok => setTimeout(ok, window.__memSlow || 0));
        /* What was filed comes back as text: here, all of it, unless a line is to be left out. */
        const kept = window.__memDrop ? body.text.split(window.__memDrop).join("") : body.text;
        return Response.json({ filed: { new: body.verbatim ? 0 : 2, updated: body.verbatim ? 1 : 0, titles: ["A", "B"], kept: body.gaps ? "" : kept } }); }
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
  await page.evaluate(() => { window.__memSlow = 700; });
  await page.click("#memGo"); await page.waitForTimeout(100);
  const run = await page.evaluate(() => ({ say: document.getElementById("memSay")?.textContent, box: document.getElementById("memIn1").hidden,
    close: document.getElementById("memClose")?.textContent, ring: document.getElementById("inboxBtn").classList.contains("run") }));
  check("Add memory shows where it stands, and can close while it files", /^Filing piece 1 of 3\./.test(run.say || "") && run.box
    && run.close === "Close, it keeps going" && run.ring, JSON.stringify(run));
  await page.click("#memClose"); await page.waitForTimeout(80);
  await page.click("#inboxBtn"); await page.waitForTimeout(60);
  const away = await page.evaluate(() => ({ sheet: !!document.getElementById("memText"),
    item: [...document.querySelectorAll("#inbox .ib-g")].find(g => g.querySelector("h4").textContent === "Memory")?.textContent || "" }));
  check("closed, it keeps filing, and the inbox shows the piece it is on", !away.sheet && /Add memory to Me/.test(away.item) && /Filing piece \d of 3/.test(away.item), JSON.stringify(away));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("inboxBtn").classList.contains("run"), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => ({ calls: window.__calls.filter(x => x.s.includes("/api/personal/remember")).map(x => ({ b: x.body.brain, n: x.body.text.length })),
    said: [...document.querySelectorAll(".msg.ai")].pop()?.textContent, badge: document.getElementById("inboxN").hidden ? "" : document.getElementById("inboxN").textContent,
    ring: document.getElementById("inboxBtn").classList.contains("run") }));
  check("Add memory files a long paste in pieces, each under 6,000 characters", m.calls.length === 3 && m.calls.every(x => x.b === "me" && x.n <= 6000)
    && /Remembered\. All of it kept: 3,080 words, 3 numbers, dates and names, filed as 6 new notes/.test(m.said || "") && !m.ring, JSON.stringify(m));
  check("done while closed, it waits in the inbox", m.badge === "1", m.badge);
  await page.click("#inboxBtn"); await page.waitForTimeout(60);
  await page.click("#inbox .ib-g:has(h4:text('Memory')) .ib-it"); await page.waitForTimeout(100);
  const back = await page.evaluate(() => ({ say: document.getElementById("memSay")?.textContent, badge: document.getElementById("inboxN").hidden,
    btns: [...document.querySelectorAll("#memFoot button")].map(b => b.textContent) }));
  check("the inbox opens it again, with what it filed", /Remembered\. All of it kept: .*6 new notes/.test(back.say || "") && back.badge && JSON.stringify(back.btns) === '["Add more","Done"]', JSON.stringify(back));
  await page.click("#memMore"); await page.waitForTimeout(60);
  check("Add more brings the box back", await page.evaluate(() => !document.getElementById("memIn1").hidden && document.getElementById("memText").value === ""));
  await page.evaluate(() => { window.__memSlow = 0; document.querySelector(".veil")?.remove(); });

  /* Like a drop: a number or a name the filing left out is filed again, then kept as written. */
  await page.evaluate(() => { window.__memDrop = "Kinugawa"; window.__calls = []; });
  await page.click(".composer .box"); await page.click("#memBtn"); await page.waitForTimeout(100);
  await page.fill("#memText", "I eat sushi at Kinugawa every Friday with my sister. I run 10 km on Sundays.");
  await page.click("#memGo"); await page.waitForTimeout(500);
  const gaps = await page.evaluate(() => ({ calls: window.__calls.filter(x => x.s.includes("/api/personal/remember")).map(x => ({ gaps: !!x.body.gaps, verbatim: !!x.body.verbatim, text: x.body.text })),
    say: document.getElementById("memSay")?.textContent }));
  check("a memory is checked like a drop: what the filing left out is filed again, then kept word for word",
    gaps.calls.length === 3 && gaps.calls[1].gaps && /Kinugawa/.test(gaps.calls[1].text) && gaps.calls[2].verbatim && /Kinugawa every Friday/.test(gaps.calls[2].text)
    && /All of it kept: 16 words, 3 numbers, dates and names/.test(gaps.say || ""), JSON.stringify(gaps));
  await page.evaluate(() => { window.__memDrop = ""; document.querySelector(".veil")?.remove(); });

  /* It is never fed by a drop. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(80);
  check("leaving the personal chat brings the levels back", await page.evaluate(() => !document.getElementById("levelWrap").hidden && document.getElementById("memBtn").hidden));
  await page.evaluate(() => document.getElementById("dropBtn").click()); await page.focus("#input"); await page.click("#scopeBtn"); await page.waitForTimeout(80);
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

/* ---- the interview: asked in the personal chat, a twin in the folder ---- */
{
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "", owner: null }],
    concepts: [{ brain: "me", slug: "lyon", n: 1, title: "Born in Lyon", summaryLine: "You were born in Lyon." }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    const titles = ["Life story","Identity","Values","Beliefs","Decisions","Work","Voice and writing","Knowledge","Money","Health and routines","People","Inner world","Tastes","Scenarios","Contradictions","Future","Twin rules"];
    const ch = titles.map((title, i) => ({ key: String.fromCharCode(65 + i), title, total: 20, answered: i === 0 ? 9 : 0, known: i === 0 ? 3 : i === 1 ? 2 : 0, skipped: 0 }));
    /* The twin test: a round of 5 fresh questions, then the history. */
    const tst = { round: null, history: [], n: 0 };
    const tsum = () => ({ count: tst.history.length, last: tst.history[0] ? { at: tst.history[0].at, pct: tst.history[0].pct } : null,
      recent: tst.history.length ? Math.round(tst.history.slice(0, 3).reduce((n, h) => n + h.pct, 0) / Math.min(3, tst.history.length)) : null, open: !!tst.round, learn: false });
    const iv = on => ({ on, pct: 4, covered: 14, seen: 14, total: 335, chapter: { key: "A", title: "Life story", total: 28, at: 12 }, chapters: ch, pending: on ? "q" : null,
      test: tsum(), profile: null });
    let profile = null, on = false;
    const view = () => ({ interview: iv(on), test: { round: tst.round && { at: "2026-10-06", questions: tst.round.ids.map(id => ({ id, text: tst.round.text[id], ...(tst.round.reply[id] ? { reply: true } : {}) })),
      mine: tst.round.mine || {}, twin: tst.round.twin || {}, because: tst.round.because || {}, note: tst.round.note || null },
      history: tst.history }, profile });
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/interview")) {
        const a = body.action || "state";
        if (a === "start") { on = true; return Response.json({ answer: "One question at a time. Who raised you?", interview: iv(true), chat: "c9", personal: true, filed: { new: 0, updated: 0, titles: [] }, called: [] }); }
        if (a === "stop") { on = false; return Response.json({ ...view(), answer: "Paused at Life story, 12 of 28. Your twin is 4% complete. Tap Interview to pick up where you left off." }); }
        /* The first round comes from the bank, as when the notes are few. The others are built from the notes: the first 3 are messages to reply to. */
        if (a === "test" && (!tst.round || body.fresh)) { const ids = ["C", "D", "E", "G", "I"].map(c => c + (++tst.n)), built = tst.n > 5;
          tst.round = { ids, text: Object.fromEntries(ids.map(id => [id, `Test question ${id}?`])), note: built ? null : "thin",
            reply: built ? { [ids[0]]: true, [ids[1]]: true, [ids[2]]: true } : {} }; }
        if (a === "check") { tst.round.mine = body.answers; tst.round.twin = Object.fromEntries(Object.keys(body.answers).map(id => [id, "Twin says " + id]));
          tst.round.because = Object.fromEntries(Object.keys(body.answers).map(id => [id, "your notes hold " + id])); }
        /* A model compares the two: the first answer matches, the second is close, the third differs. */
        if (a === "score") { const ids = Object.keys(tst.round.mine), sc = ids.map((id, i) => [2, 1, 0, 2, 2][i]);
          tst.history.unshift({ at: "2026-10-06", pct: Math.round(100 * sc.reduce((n, x) => n + x, 0) / (2 * sc.length)), learned: false,
            items: ids.map((id, i) => ({ id, q: tst.round.text[id], mine: tst.round.mine[id], twin: tst.round.twin[id], because: tst.round.because[id], score: sc[i] })) }); tst.round = null; }
        if (a === "learn") { if (tst.history[0]) tst.history[0].learned = true; return Response.json({ ...view(), filed: { new: 2, updated: 1, titles: ["A", "B"], people: [] } }); }
        if (a === "profile") profile = { at: "2026-10-04", notes: 40, parts: ["Identity","Values","Beliefs","Decision rules","Voice","Knowledge","Boundaries"].map(t => ({ title: t, points: [`A point on ${t}.`] })) };
        return Response.json(view());
      }
      if (s.includes("/api/ask")) return Response.json({ answer: body.q === "skip" ? "Then, what is your first memory?" : "Why your grandmother?", sources: 0, level: "normal", personal: true,
        filed: body.q === "skip" ? { new: 0, updated: 0, titles: [] } : { new: 1, updated: 0, titles: ["Raised by grandmother"] }, called: [], interview: iv(true), chat: "c9" });
      return Response.json({ chats: [] });
    };
  }, mine);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(250);
  const off = await page.evaluate(() => ({ shown: !document.getElementById("ivBar").hidden, go: document.getElementById("ivGo")?.textContent }));
  check("a personal chat offers the interview above the chat bar, with how complete the twin is", off.shown && /Resume the interview/.test(off.go) && /twin 4%/.test(off.go), JSON.stringify(off));
  await page.click("#ivGo"); await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/interview") && x.body.action === "start").pop()?.body,
    me: document.querySelectorAll("#thread .msg.me").length, ai: [...document.querySelectorAll("#thread .msg.ai")].pop()?.textContent,
    bar: document.getElementById("ivBar").textContent, skip: !!document.getElementById("ivSkip"), stop: !!document.getElementById("ivStop"),
    ph: document.getElementById("input").placeholder, mem: document.getElementById("memBtn").hidden, foot: document.getElementById("footNote").textContent }));
  check("Interview opens on its first question, with no message before it", st.sent?.brain === "me" && st.me === 0 && /Who raised you\?/.test(st.ai || ""), JSON.stringify(st));
  check("while on, the strip says where it stands, with Skip and Stop", /Interview/.test(st.bar) && /Life story · 13 of 28/.test(st.bar) && st.skip && st.stop, st.bar);
  check("the bar asks for an answer, and Add memory stays in reach", /Your answer, in your own words/.test(st.ph) && !st.mem && /Say skip to pass, or Stop any time/.test(st.foot), JSON.stringify(st));
  await page.fill("#input", "My grandmother, in Lyon"); await page.click("#send"); await page.waitForTimeout(250);
  const ans = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/ask")).pop()?.body, filed: [...document.querySelectorAll(".msg.ai")].pop()?.querySelector(".filed")?.textContent }));
  check("an answer goes to the personal brain and is filed like any message", ans.sent?.brain === "me" && ans.sent?.q === "My grandmother, in Lyon" && ans.sent?.chat === "c9" && ans.filed === "Filed: 1 new note", JSON.stringify(ans));
  await page.click("#ivSkip"); await page.waitForTimeout(250);
  const sk = await page.evaluate(() => ({ q: window.__calls.filter(x => x.s.includes("/api/ask")).pop()?.body.q, ai: [...document.querySelectorAll(".msg.ai")].pop()?.textContent }));
  check("Skip sends skip, and the next question comes", sk.q === "skip" && /first memory/.test(sk.ai || ""), JSON.stringify(sk));
  await page.click("#ivStop"); await page.waitForTimeout(250);
  const stop = await page.evaluate(() => ({ called: window.__calls.some(x => x.s.includes("/api/interview") && x.body.action === "stop"), note: [...document.querySelectorAll(".msg.ai")].pop()?.textContent,
    go: document.getElementById("ivGo")?.textContent, mem: document.getElementById("memBtn").hidden }));
  check("Stop pauses it at once, says where, and the chat is everyday again", stop.called && /Paused at Life story/.test(stop.note) && /Resume the interview/.test(stop.go || "") && !stop.mem, JSON.stringify(stop));

  /* The folder: the twin in place of a health score, its chapters, test and profile. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(350);
  const fv = await page.evaluate(() => ({ twin: document.getElementById("fvTwin")?.textContent, acts: [...document.querySelectorAll(".fv-acts .fv-b")].map(b => b.id),
    pane: !!document.getElementById("twinPane"), chs: document.querySelectorAll("#twinPane .tw-ch").length, now: document.querySelector("#twinPane .tw-ch.now b")?.textContent,
    pos: document.querySelector("#twinPane .fv-pos")?.textContent }));
  check("a personal folder shows how complete its twin is in place of a health score", /Twin 4% complete/.test(fv.twin || "") && /Next: Life story, 12 of 28 done/.test(fv.twin || ""), fv.twin);
  check("its actions: chat, add memory, interview, twin test and profile; never drop, edit or tidy", fv.acts.join() === "fvChat,fvMem,fvIv,fvTest,fvProfile,fvClose", fv.acts.join());
  check("it opens on the twin: the share covered and its 17 chapters, the current one marked", fv.pane && fv.chs === 17 && fv.now === "Life story" && /14 of 335 questions/.test(fv.pos || ""), JSON.stringify(fv));

  await page.click("#fvTest"); await page.waitForTimeout(250);
  const form = await page.evaluate(() => ({ qs: [...document.querySelectorAll("#testPane .ts-q span")].map(x => x.textContent), pos: document.querySelector("#testPane .fv-pos")?.textContent,
    hist: !!document.querySelector("#testPane .tt-hist h4") }));
  check("the twin test opens on 5 fresh items, and says what happens to the answers", form.qs.length === 5 && /5 new situations each time/.test(form.pos || "")
    && /yours are added to your notes/.test(form.pos || "") && !form.hist, JSON.stringify(form));
  check("it says they are messages built from your notes, that the notes imply the reply and never state it, and that the twin learns to answer as you",
    /5 new situations each time, built from your own notes: a message lands and you reply/.test(form.pos || "") && /imply each reply and never state it/.test(form.pos || "")
    && /compared on the decision and the voice/.test(form.pos || "") && /learns to answer as you/.test(form.pos || ""), form.pos);
  const thin = await page.evaluate(() => ({ note: document.querySelector("#testPane .ts-form")?.previousElementSibling?.textContent, msgs: document.querySelectorAll("#testPane .ts-q.msg").length,
    ph: [...document.querySelectorAll("#testPane .ts-q textarea")].map(x => x.placeholder) }));
  check("with few notes the questions come from the interview, and it says so; each box asks for an answer",
    /Your notes hold few ideas yet.*6 notes or more/.test(thin.note || "") && thin.msgs === 0 && thin.ph.length === 5 && thin.ph.every(x => x === "Your answer, in your own words"), JSON.stringify(thin));
  await page.click("#tsOther"); await page.waitForTimeout(300);
  const other = await page.evaluate(() => [...document.querySelectorAll("#testPane .ts-q span")].map(x => x.textContent));
  check("Other questions picks 5 others", other.length === 5 && other.every(q => !form.qs.includes(q)), JSON.stringify(other));
  const built = await page.evaluate(() => ({ msgs: [...document.querySelectorAll("#testPane .ts-q")].map(l => l.classList.contains("msg")),
    ph: [...document.querySelectorAll("#testPane .ts-q textarea")].map(x => x.placeholder), built: document.body.innerText.includes("Built from"),
    note: document.querySelector("#testPane .ts-form")?.previousElementSibling?.className }));
  check("built from the notes, a message shows as a message and asks for the reply you would send; no line says what it was built from",
    JSON.stringify(built.msgs) === "[true,true,true,false,false]" && JSON.stringify(built.ph.slice(2, 4)) === '["Your reply, as you would send it","Your answer, in your own words"]'
    && !built.built && !/tw-key/.test(built.note || ""), JSON.stringify(built));
  await page.evaluate(() => { const t = [...document.querySelectorAll("#testPane .ts-q textarea")]; t.slice(0, 2).forEach((x, i) => { x.value = "Answer " + (i + 1); }); });
  await page.click("#tsSave"); await page.waitForTimeout(200);
  check("fewer than 3 answers asks for more, and sends nothing", /at least 3 of the 5/.test(await page.textContent("#testPane .ts-say")) && !(await page.evaluate(() => window.__calls.some(x => x.body.action === "check"))));
  await page.evaluate(() => { const t = [...document.querySelectorAll("#testPane .ts-q textarea")]; t.slice(0, 4).forEach((x, i) => { x.value = "Answer " + (i + 1); }); });
  await page.click("#tsSave"); await page.waitForTimeout(600);
  const res = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.body.action === "check").pop()?.body, n: document.querySelectorAll("#testPane .ts-card").length,
    first: document.querySelector("#testPane .ts-card")?.textContent, marks: [...document.querySelectorAll("#testPane .ts-card .ts-m")].map(x => x.textContent),
    chips: document.querySelectorAll("#testPane .ts-s").length, score: document.querySelector("#testPane .tw-score")?.textContent,
    notes: [...document.querySelectorAll("#testPane .tw-key")].map(x => x.textContent).join(" "), more: !!document.getElementById("tsMore") }));
  const flow = await page.evaluate(() => window.__calls.filter(x => x.s.includes("/api/interview") && x.body.action).map(x => x.body.action).filter(a => ["check", "score", "learn"].includes(a)).slice(-3));
  check("one tap: your twin answers, the two are compared, and your answers go into your notes", JSON.stringify(flow) === '["check","score","learn"]'
    && Object.keys(res.sent.answers).length === 4 && res.n === 4 && /Answer 1/.test(res.first) && /Twin says/.test(res.first), JSON.stringify({ flow, res }));
  check("each pair says same, close or different, and nothing is scored by hand; the total is the share matched", res.chips === 0 && JSON.stringify(res.marks) === '["Same","Close","Different","Same"]'
    && res.score === "Your twin matched you 63% on 4 questions", JSON.stringify(res));
  check("it says the answers are in your notes, and what was filed", /Your answers are in your notes\. Filed: 2 new notes, 1 note updated\./.test(res.notes) && res.more, res.notes);
  const why = await page.evaluate(() => ({ because: [...document.querySelectorAll("#testPane .ts-card")].map(c => c.querySelector(".ts-why")?.textContent || ""), built: document.body.innerText.includes("Built from") }));
  check("each pair says why the twin answered so, and no pair says what the question was built from",
    JSON.stringify(why.because.slice(0, 2)) === '["Because: your notes hold C6","Because: your notes hold D7"]' && !why.built, JSON.stringify(why));
  check("it says how many the twin missed, and that the replies are now notes it can answer from", /2 of 4 missed or half right\. Each reply you gave is now a note, so your twin can answer the same next time\./.test(res.notes), res.notes);
  await page.click("#tsMore"); await page.waitForTimeout(400);
  const next = await page.evaluate(() => ({ qs: [...document.querySelectorAll("#testPane .ts-q span")].map(x => x.textContent), hist: document.querySelector("#testPane .tt-hist h4")?.textContent,
    trend: document.querySelector("#testPane .tt-trend")?.textContent, rows: [...document.querySelectorAll("#testPane .tt-h summary")].map(x => x.textContent) }));
  check("another test brings 5 questions never asked before, and keeps the first in a history with its score", next.qs.length === 5 && next.qs.every(q => !form.qs.includes(q) && !other.includes(q))
    && next.hist === "History · 1 test" && next.trend === "63%" && next.rows.length === 1 && /63%/.test(next.rows[0]) && /4 questions/.test(next.rows[0]), JSON.stringify(next));
  await page.click("#testPane .tt-h summary"); await page.waitForTimeout(100);
  check("a past test opens on its pairs", await page.evaluate(() => document.querySelectorAll("#testPane .tt-h .ts-card").length) === 4);

  await page.click("#fvProfile"); await page.waitForTimeout(250);
  await page.click("#pfGo"); await page.waitForTimeout(300);
  const pf = await page.evaluate(() => [...document.querySelectorAll("#profilePane .pf-part h4")].map(x => x.textContent));
  check("the twin profile writes your notes as 7 parts", pf.join() === "Identity,Values,Beliefs,Decision rules,Voice,Knowledge,Boundaries", pf.join());
  await page.click("#fvIv"); await page.waitForTimeout(300);
  check("Interview from the folder goes back to the chat and asks", await page.evaluate(() => !!document.getElementById("ivStop") && /Who raised you/.test([...document.querySelectorAll(".msg.ai")].pop()?.textContent || "")));
  check("nothing threw around the interview", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- contacts: a People tab in the personal folder, one card per person ---- */
{
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "", owner: null }],
    concepts: [{ brain: "me", slug: "lisbon", n: 1, title: "Moving abroad", summaryLine: "Lisbon in 2027", updated: "2026-10-01" },
      { brain: "me", slug: "marc", n: 2, title: "Marc Dupont", summaryLine: "Your co-founder, now at Revolut", tag: "contact", aliases: ["Marc", "my co-founder"], ev: 4, updated: "2026-10-04" },
      { brain: "me", slug: "paul", n: 3, title: "Paul", summaryLine: "Someone you will introduce to Marc", tag: "contact", ev: 1, updated: "2026-10-02" }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = []; window.__parts = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/personal/people")) return Response.json(body.phase === "files" ? { filed: { people: ["Marc Dupont"] }, next: null, left: 0, total: 1 }
        : body.at ? { filed: { people: ["Lea"] }, next: null, read: 25, total: 25 } : { filed: { people: ["Paul", "Lea"] }, next: 20, read: 20, total: 25 });
      if (s.includes("/api/personal/contact") && body.action === "part") { window.__parts.push(body); return Response.json({ ok: true }); }
      if (s.includes("/api/personal/page")) { window.__page = body; return Response.json({ moments: [{ k: "o1", d: "2021-05", t: "He moved to Lisbon for his first startup." }], raw: [] }); }
      if (s.includes("/api/personal/contact")) return Response.json(body.action === "merge" ? { into: body.into, joined: 1, rewritten: true } : { id: body.id, title: body.title });
      if (s.includes("/api/concept")) return Response.json({ concept: { brain: "me", slug: "marc", title: "Marc Dupont", tag: "contact", aliases: ["Marc", "my co-founder"],
        position: "Your co-founder. Joins Revolut in London (2026-10-04).", evidence: [{ date: "2026-10-04", author: "You", claim: "Marc joins Revolut", orig: "Marc rejoint Revolut" }, { date: "2026-09-30", author: "You", claim: "Marc raises 2M" }],
        data: [], conflicts: [], sources: [], related: [], file: { v: 1, seen: "2026-09-30",
          facts: [{ k: "f1", s: "work", l: "Company", v: "Revolut", since: "2026-10-04", at: "2026-10-04" }, { k: "f0", s: "work", l: "Company", v: "His fintech in Lisbon", until: "2026-10-04", at: "2026-09-30" },
                  { k: "f2", s: "contact", l: "Phone", v: "+44 7700 900123", at: "2026-10-04" }, { k: "f3", s: "identity", l: "Born in", v: "Lyon, 1993", at: "2026-09-12" }],
          events: [{ k: "e1", d: "2026-10-04", t: "Marc left the fintech and joins Revolut in London.", at: "2026-10-04" },
                   { k: "e2", d: "2026-09-30", t: "Lunch together at Kinugawa: he was raising 2M euros.", seen: true, at: "2026-09-30" },
                   { k: "e3", d: "2023-03", t: "You met at Station F.", seen: true, at: "2026-09-12" }],
          links: [{ k: "l1", n: "Paul", r: "an investor he will meet" }, { k: "l2", n: "Julie", r: "his wife" }],
          open: [{ k: "o1", t: "Intro him to Paul Martin", at: "2026-09-30" }, { k: "o2", t: "Send the deck", at: "2026-09-01", done: "2026-09-02" }] } },
        insights: [], linkedFrom: [{ id: "me/paul", title: "Paul", rel: "his future investor" }, { id: "me/clara", title: "Clara", rel: "her brother" }],
        pages: { years: [{ y: "2026", n: 2 }, { y: "2023", n: 1 }, { y: "2021", n: 4 }], months: [{ m: "2026-10", n: 1 }, { m: "2026-09", n: 1 }] },
        raw: { total: 2, notes: [{ date: "2026-10-04", kind: "chat", text: "Marc rejoint Revolut à Londres.\nIl commence lundi.", at: 2 },
          { date: "2026-09-21", kind: "interview", asked: "Who did you build your first company with?", text: "Marc, since Station F", at: 1 }] } });
      if (s.includes("/api/ask")) { const fail = window.__failNext; window.__failNext = false;
        return Response.json({ answer: "Noted.", sources: 0, level: "normal", personal: true,
          filed: fail ? { new: 0, updated: 0, titles: [], failed: true } : { new: 1, updated: 0, titles: ["Intros"], people: ["Marc Dupont", "Paul"] }, called: [] }); }
      if (s.includes("/api/personal/remember")) return Response.json({ filed: { new: 0, updated: 0, titles: [], people: ["Maxime"] } });
      if (s.includes("/api/interview")) return Response.json({});
      return Response.json({ chats: [] });
    };
  }, mine);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(200);
  await page.fill("#input", "Lunch with Marc. I owe him an intro to Paul."); await page.click("#send"); await page.waitForTimeout(250);
  const line = await page.evaluate(() => [...document.querySelectorAll(".msg.ai")].pop()?.querySelector(".filed")?.textContent);
  check("a message about people says whose cards it updated", line === "Filed: 1 new note · Contacts: Marc Dupont, Paul", line);
  check("the chat bar holds no language chip", await page.evaluate(() => !document.getElementById("voiceLang")));

  /* A message whose filing failed offers to keep it, as the message it was. */
  await page.evaluate(() => { window.__failNext = true; });
  await page.fill("#input", "today Maxime arrived, a week together"); await page.click("#send"); await page.waitForTimeout(250);
  const failed = await page.evaluate(() => [...document.querySelectorAll(".msg.ai")].pop()?.querySelector(".filed")?.textContent);
  check("a message that was not filed says so and offers Keep it", /Not filed this time/.test(failed || "") && /Keep it/.test(failed || ""), failed);
  await page.evaluate(() => [...document.querySelectorAll(".msg.ai")].pop().querySelector(".keep").click()); await page.waitForTimeout(250);
  const kept = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/personal/remember")).pop()?.body,
    line: [...document.querySelectorAll(".msg.ai")].pop()?.querySelector(".filed")?.textContent }));
  check("Keep it files the message again as a chat message, and says whose card it made", kept.sent?.kind === "chat" && kept.sent?.brain === "me"
    && kept.sent?.text === "today Maxime arrived, a week together" && kept.line === "Filed: Contact: Maxime", JSON.stringify(kept));

  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(300);
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".fv-tab")].map(x => x.textContent));
  check("a personal folder lists notes and people apart, each counted", JSON.stringify(tabs) === '["Notes1","People2"]', JSON.stringify(tabs));
  const notes = await page.evaluate(() => [...document.querySelectorAll(".fv-row b")].map(x => x.textContent));
  check("Notes holds the notes alone", JSON.stringify(notes) === '["Moving abroad"]', JSON.stringify(notes));
  await page.click("#fvPeople"); await page.waitForTimeout(150);
  const ppl = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".fv-row")].map(x => x.textContent), ph: document.getElementById("fvFilter").placeholder, scan: !!document.getElementById("fvScan") }));
  check("People carries no scan button: the audit finds the people", !ppl.scan);
  check("People holds one card per person, newest mention first, with how often they came up", ppl.rows.length === 2 && /^Marc Dupont/.test(ppl.rows[0]) && /4 mentions · last/.test(ppl.rows[0])
    && /1 mention · last/.test(ppl.rows[1]) && ppl.ph === "Filter people", JSON.stringify(ppl));
  await page.fill("#fvFilter", "co-founder"); await page.waitForTimeout(80);
  check("a person is found by a name they go by", (await page.evaluate(() => document.querySelectorAll(".fv-row").length)) === 1);
  await page.fill("#fvFilter", "");
  await page.click(".fv-row"); await page.waitForTimeout(250);
  const card = await page.evaluate(() => ({ eye: document.querySelector(".fv-doc .fv-eye")?.textContent, aka: document.querySelector(".fv-doc .fv-aka")?.textContent,
    meta: document.querySelector(".fv-doc .pf-meta")?.textContent, pos: document.querySelector(".fv-doc .fv-pos")?.textContent }));
  check("a contact opens as a file: its names, last seen and mentioned, then the summary", card.eye === "Contact · Me" && card.aka === "Also: Marc, my co-founder"
    && card.meta === "Last seen 30 Sep 2026 · last mentioned 4 Oct 2026 · 2 mentions" && /^Your co-founder/.test(card.pos || ""), JSON.stringify(card));
  const file = await page.evaluate(() => ({ open: [...document.querySelectorAll(".pf-open .pf-orow span")].map(x => x.textContent),
    secs: [...document.querySelectorAll(".pf-sec h4")].map(x => x.textContent),
    work: [...document.querySelectorAll(".pf-sec")].find(x => x.querySelector("h4").textContent === "Work")?.textContent,
    people: [...document.querySelectorAll(".pf-link")].map(x => x.textContent),
    years: [...document.querySelectorAll(".pf-year")].map(x => x.textContent), evs: [...document.querySelectorAll(".pf-ev")].map(x => x.textContent),
    seen: document.querySelectorAll(".pf-ev.seen").length, said: document.getElementById("pfSaid")?.textContent, folded: !document.querySelector(".pf-said").open }));
  check("what is still open comes first, a kept promise left out", JSON.stringify(file.open) === '["Intro him to Paul Martin"]', JSON.stringify(file.open));
  check("facts sit by section, in a set order", JSON.stringify(file.secs) === '["Identity","Contact details","Work","Their people"]', JSON.stringify(file.secs));
  check("a fact that changed shows what it was before, and until when", /Revolut \(since 4 Oct 2026\)×?Before: His fintech in Lisbon \(until 4 Oct 2026\)/.test(file.work || ""), file.work);
  check("their people both ways: who they name, and who names them, each person once", JSON.stringify(file.people) === '["Paulan investor he will meet","Juliehis wife","Claraher brother"]', JSON.stringify(file.people));
  check("the history goes year by year, newest first, the days together marked", JSON.stringify(file.years) === '["2026","2023"]' && /^4 Oct/.test(file.evs[0]) && /^Mar/.test(file.evs[2]) && file.seen === 2, JSON.stringify(file));
  check("each mention in one line sits folded under the file", file.said === "Each mention in one line · 2" && file.folded, JSON.stringify(file.said));
  check("a mention kept in English shows the words as you said them beside it", await page.evaluate(() => document.querySelector(".pf-said .ev-orig")?.textContent) === "Marc rejoint Revolut");
  const raw = await page.evaluate(() => {
    const hist = document.getElementById("pfHist"), box = document.getElementById("pfRaw");
    return { after: !!(hist && box && (hist.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)), head: box?.querySelector("h4")?.textContent,
      texts: [...(box?.querySelectorAll(".pf-rt") || [])].map(x => x.textContent), asked: box?.querySelector(".pf-asked")?.textContent,
      kinds: [...(box?.querySelectorAll(".pf-kind") || [])].map(x => x.textContent), wrap: box ? getComputedStyle(box.querySelector(".pf-rt")).whiteSpace : "" };
  });
  check("after the history, every message about them, word for word, newest first", raw.after && raw.head === "Raw notes (2)"
    && raw.texts[0] === "Marc rejoint Revolut à Londres.\nIl commence lundi." && raw.wrap === "pre-wrap" && JSON.stringify(raw.kinds) === '["Chat","Interview"]', JSON.stringify(raw));
  check("an interview answer shows the question it answered", raw.asked === "Who did you build your first company with?", String(raw.asked));
  /* A person is a folder: tabs, one page at a time. */
  const pft = await page.evaluate(() => ({ tabs: [...document.querySelectorAll("#pfTabs .pf-tab")].map(b => b.textContent), on: document.querySelector("#pfTabs .on")?.dataset.k,
    shown: [...document.querySelectorAll(".pf-pane")].filter(p => !p.hidden).map(p => p.dataset.k), late: [...document.querySelectorAll(".pf-late p")].map(p => p.textContent) }));
  check("a person opens as a folder: Overview, Facts, History, Their people, Raw notes, each counted", JSON.stringify(pft.tabs) === '["Overview","Facts3","History3","Their people3","Raw notes2"]'
    && pft.on === "overview" && JSON.stringify(pft.shown) === '["overview"]' && pft.late.length === 3, JSON.stringify(pft));
  await page.click("#pfTab-history"); await page.waitForTimeout(60);
  const years = await page.evaluate(() => ({ shown: [...document.querySelectorAll(".pf-pane")].filter(p => !p.hidden).map(p => p.dataset.k),
    chips: [...document.querySelectorAll("#pfHist .pf-chip")].map(b => b.textContent) }));
  check("History has a page per year, with its count", JSON.stringify(years.shown) === '["history"]' && JSON.stringify(years.chips) === '["Latest","20262","20231","20214"]', JSON.stringify(years));
  await page.click('#pfHist .pf-chip[data-v="2023"]'); await page.waitForTimeout(60);
  check("a year held already shows at once", await page.evaluate(() => [...document.querySelectorAll("#pfHist .pf-ev p")].map(p => p.textContent).join("|")) === "You met at Station F." && !(await page.evaluate(() => window.__page)));
  await page.click('#pfHist .pf-chip[data-v="2021"]'); await page.waitForTimeout(150);
  const old = await page.evaluate(() => ({ asked: window.__page, evs: [...document.querySelectorAll("#pfHist .pf-ev p")].map(p => p.textContent) }));
  check("an older year is fetched when its moments are not all here", old.asked?.id === "me/marc" && old.asked.year === "2021" && JSON.stringify(old.evs) === '["He moved to Lisbon for his first startup."]', JSON.stringify(old));
  await page.click("#pfTab-raw"); await page.waitForTimeout(60);
  check("Raw notes has a page per month", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#pfRaw .pf-chip")].map(b => b.textContent))) === '["Latest","Oct 20261","Sep 20261"]');
  await page.click("#pfTab-overview"); await page.waitForTimeout(40);
  await page.click(".pf-tick"); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector(".pf-ev .pf-x").click()); await page.waitForTimeout(200);
  const parts = await page.evaluate(() => window.__parts);
  check("a promise is ticked done, and a wrong moment taken out, one line at a time", JSON.stringify(parts.map(p => [p.part, p.key, p.done ?? null])) === '[["open","o1",true],["event","e1",null]]'
    && parts.every(p => p.id === "me/marc"), JSON.stringify(parts));
  /* Edit it by hand. */
  await page.click("#ctEdit"); await page.waitForTimeout(150);
  const form = await page.evaluate(() => ({ name: document.getElementById("ctName")?.value, aka: document.getElementById("ctAka")?.value, pos: document.getElementById("ctPos")?.value }));
  check("Edit opens the card's name, other names, line and text, filled in", form.name === "Marc Dupont" && form.aka === "Marc, my co-founder" && /Revolut/.test(form.pos || ""), JSON.stringify(form));
  await page.fill("#ctName", "Marc Dupont-Leroy"); await page.fill("#ctAka", "Marc, my co-founder, MDL");
  await page.click("#ctSave"); await page.waitForTimeout(300);
  const edited = await page.evaluate(() => window.__calls.filter(x => x.s.includes("/api/personal/contact")).pop()?.body);
  check("Save sends the new name and names, and the card comes back", edited?.action === "edit" && edited.id === "me/marc" && edited.title === "Marc Dupont-Leroy"
    && JSON.stringify(edited.aliases) === '["Marc","my co-founder","MDL"]' && /Revolut/.test(edited.position), JSON.stringify(edited));
  check("and the card is shown again", await page.evaluate(() => document.querySelector(".fv-doc .fv-eye")?.textContent === "Contact · Me"));
  /* Merge it with the card of the same person under another name. */
  await page.click("#ctMerge"); await page.waitForTimeout(100);
  const pick = await page.evaluate(() => [...document.querySelectorAll(".ct-row b")].map(x => x.textContent));
  check("Merge lists the other cards, never this one", JSON.stringify(pick) === '["Paul"]', JSON.stringify(pick));
  await page.click(".ct-row .mini"); await page.waitForTimeout(60);
  const armed = await page.evaluate(() => ({ t: document.querySelector(".ct-row .mini").textContent, calls: window.__calls.filter(x => x.body?.action === "merge").length }));
  check("the first tap asks to be sure, and merges nothing", armed.t === "Yes, Paul is Marc Dupont" && armed.calls === 0, JSON.stringify(armed));
  await page.click(".ct-row .mini"); await page.waitForTimeout(300);
  const merged = await page.evaluate(() => window.__calls.filter(x => x.body?.action === "merge").pop()?.body);
  check("the second merges that card into this one", merged?.into === "me/marc" && JSON.stringify(merged.from) === '["me/paul"]', JSON.stringify(merged));
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(200);
  await page.click("#auditBlock > summary");
  await page.click('#auditList .au-row[data-slug="me"] button'); await page.waitForTimeout(500);
  const scans = await page.evaluate(() => ({ at: window.__calls.filter(x => x.s.includes("/api/personal/people")).map(x => x.body.at ?? null), say: document.getElementById("auditSay")?.textContent,
    clean: document.querySelector("#auditPane .td-clean")?.textContent, stamp: window.__calls.filter(x => x.s.includes("/api/brain/audit")).pop()?.body }));
  check("the personal audit finds the people in your notes, a batch at a time, then builds the full files", JSON.stringify(scans.at) === "[0,20,null]"
    && await page.evaluate(() => window.__calls.filter(x => x.s.includes("/api/personal/people")).pop()?.body.phase) === "files"
    && /^3 people filed or brought up to date\. 0 look filed twice\./.test(scans.say || "") && /Each person has one card/.test(scans.clean || "")
    && scans.stamp?.brain === "me" && scans.stamp.action === "done", JSON.stringify(scans));
  check("nothing threw around contacts", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- still open: an icon beside the inbox counts every person's open lines; a comment on each, one send ---- */
{
  const card = (slug, title, open) => ({ brain: "me", slug, n: 1, title, summaryLine: "A person", tag: "contact", ev: 1, updated: "2026-10-04", ...(open === undefined ? {} : { open }) });
  const mine = (open) => ({ ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "", owner: null }],
    concepts: [card("marc", "Marc Dupont", open?.marc), card("paul", "Paul", open?.paul), card("lea", "Lea", open?.lea)] });
  const boot2 = (state) => boot("/chat.html", st => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    let people = [
      { id: "me/marc", title: "Marc Dupont", line: "Your co-founder", items: [{ k: "k1", t: "Send Marc the contract", at: "2026-09-01" }, { k: "k2", t: "Introduce Marc to Paul", at: "2026-09-20" }] },
      { id: "me/paul", title: "Paul", line: "Someone you will introduce to Marc", items: [{ k: "k3", t: "Pay Paul's invoice", at: "2026-10-01" }] }];
    let fail = true, live = false;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (body.action === "send" || s.includes("/api/personal/contact")) live = true;
      /* The cards follow the files, as the server keeps them in step. */
      if (s.includes("/api/state")) return Response.json(!live ? st : { ...st, concepts: st.concepts.map(c => c.open === undefined ? c : { ...c, open: people.find(p => p.id === `${c.brain}/${c.slug}`)?.items.length || 0 }) });
      if (s.includes("/api/personal/open")) {
        if (body.action !== "send") return Response.json({ people });
        /* The first send closes the contract and passes over the other line; the second takes it. */
        const over = body.updates.filter(x => x.k !== "k1");
        if (fail && over.length) { fail = false;
          people = [{ ...people[0], items: people[0].items.filter(x => x.k !== "k1") }, people[1]];
          return Response.json({ done: 1, dropped: 0, changed: 0, followed: 1, moments: 1, kept: 0, retry: over.map(x => ({ id: x.id, k: x.k })), people }); }
        people = people.map(p => ({ ...p, items: p.items.filter(x => !body.updates.some(y => y.k === x.k)) })).filter(p => p.items.length);
        return Response.json({ done: 0, dropped: 0, changed: 0, followed: 0, moments: 0, kept: body.updates.length, retry: [], people });
      }
      if (s.includes("/api/personal/contact")) { people = people.map(p => ({ ...p, items: p.items.filter(x => x.k !== body.key) })).filter(p => p.items.length); return Response.json({ ok: true }); }
      return Response.json({ chats: [] });
    };
  }, state);
  const { page, bad } = await boot2(mine({ marc: 2, paul: 1, lea: 0 }));
  await page.waitForTimeout(500);
  const icon = await page.evaluate(() => { const b = document.getElementById("stillBtn"), i = document.getElementById("inboxBtn"); return { hidden: b.hidden, n: document.getElementById("stillN").textContent,
    label: b.getAttribute("aria-label"), left: b.getBoundingClientRect().right <= i.getBoundingClientRect().left, same: Math.abs(b.getBoundingClientRect().top - i.getBoundingClientRect().top) < 2 }; });
  check("an icon beside the inbox counts every open line of every person, from their cards", !icon.hidden && icon.n === "3" && /3 lines/.test(icon.label) && icon.left && icon.same, JSON.stringify(icon));
  check("no call reads the files for it, since every card carries its count", !(await page.evaluate(() => window.__calls.some(x => x.s.includes("/api/personal/open")))));
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(350);
  check("the personal folder keeps its own actions: no Still open button there", await page.evaluate(() => !document.getElementById("fvOpen")));
  await page.click("#stillBtn"); await page.waitForTimeout(300);
  const first = await page.evaluate(() => ({ title: document.querySelector('[aria-label="Still open"] h3')?.textContent, n: document.querySelector(".op-n")?.textContent,
    people: [...document.querySelectorAll(".op-p")].map(p => p.querySelector(".op-h b").textContent + ":" + [...p.querySelectorAll(".op-row .pf-orow span")].map(x => x.textContent).join("|")),
    inputs: document.querySelectorAll(".op-in").length, since: document.querySelector(".op-row time")?.textContent, send: document.getElementById("opSend").disabled }));
  check("it lists every open line by person, the person with the oldest line first, each with a box for a comment",
    first.title === "Still open" && first.n === "3 open lines, 2 people" && JSON.stringify(first.people) === '["Marc Dupont:Send Marc the contract|Introduce Marc to Paul","Paul:Pay Paul\'s invoice"]'
    && first.inputs === 3 && /^since /.test(first.since) && first.send, JSON.stringify(first));
  await page.fill('.op-row[data-k="k1"] .op-in', "Signed on Tuesday, he invoices in November");
  await page.fill('.op-row[data-k="k2"] .op-in', "Done, they met on Friday");
  check("a comment makes Send updates available", await page.evaluate(() => !document.getElementById("opSend").disabled));
  const vp = page.viewportSize();
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    /* The sheet is still settling after the resize: look until its bar is down, for a second at most. */
    await page.waitForFunction(() => { const f = document.querySelector(".op-sheet > footer"); return !!f && Math.abs(f.getBoundingClientRect().bottom - innerHeight) < 2; }, null, { timeout: 1500 }).catch(() => {});
    const ph = await page.evaluate(() => { const f = document.querySelector(".op-sheet > footer").getBoundingClientRect(), s = document.getElementById("stillBtn").getBoundingClientRect(),
      i = document.getElementById("inboxBtn").getBoundingClientRect(), t = document.querySelector(".op-row .pf-tick").getBoundingClientRect(), n = document.querySelector(".op-row .op-in");
      return { wide: document.documentElement.scrollWidth > innerWidth, pinned: Math.abs(f.bottom - innerHeight) < 2, apart: s.right <= i.left, size: Math.min(s.width, s.height, i.width, i.height),
        font: parseFloat(getComputedStyle(n).fontSize), inH: n.getBoundingClientRect().height, send: document.getElementById("opSend").getBoundingClientRect().height, tick: t.width }; });
    check(`on a ${w}px phone the Send updates bar stays at the bottom, the icons are 40px and apart, the comment box is 46px at 16px, and nothing scrolls sideways`,
      !ph.wide && ph.pinned && ph.apart && ph.size >= 40 && ph.font >= 16 && ph.inH >= 46 && ph.send >= 48, JSON.stringify(ph));
  }
  await page.setViewportSize(vp); await page.waitForTimeout(150);
  await page.click("#opSend"); await page.waitForTimeout(400);
  const one = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/personal/open") && x.body.action === "send").pop()?.body,
    say: document.getElementById("opSay")?.textContent, keep: document.querySelector('.op-row[data-k="k2"] .op-in')?.value,
    left: [...document.querySelectorAll(".op-row")].map(r => r.dataset.k).join(","), badge: document.getElementById("stillN").textContent }));
  check("one send carries every comment with its person and line, and nothing else", one.sent?.brain === "me" && JSON.stringify(one.sent.updates) ===
    JSON.stringify([{ id: "me/marc", k: "k1", comment: "Signed on Tuesday, he invoices in November" }, { id: "me/marc", k: "k2", comment: "Done, they met on Friday" }]), JSON.stringify(one.sent));
  check("it says what changed, the line closed leaves, the one passed over keeps its comment to send again, and the icon counts what is left",
    /1 done, 1 follow-up added, 1 moment added to a history\. 1 line did not go through: send again\./.test(one.say || "") && one.left === "k2,k3" && one.keep === "Done, they met on Friday" && one.badge === "2", JSON.stringify(one));
  await page.click("#opSend"); await page.waitForTimeout(400);
  const two = await page.evaluate(() => ({ n: document.querySelector(".op-n")?.textContent, say: document.getElementById("opSay")?.textContent,
    sent: window.__calls.filter(x => x.s.includes("/api/personal/open") && x.body.action === "send").pop()?.body.updates.length, badge: document.getElementById("stillN").textContent }));
  check("sent again, it goes through, and what is left is listed and counted", two.sent === 1 && two.n === "1 open line, 1 person" && /^1 still open\.$/.test(two.say || "") && two.badge === "1", JSON.stringify(two));
  await page.click(".op-row .pf-tick"); await page.waitForTimeout(300);
  const tick = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s.includes("/api/personal/contact")).pop()?.body, empty: document.getElementById("opList")?.textContent,
    icon: document.getElementById("stillBtn").hidden }));
  check("a tick closes a line at once, with no model, an empty list says so, and the icon goes", tick.call?.action === "part" && tick.call?.part === "open" && tick.call?.key === "k3" && tick.call?.done === true
    && /Nothing open/.test(tick.empty || "") && tick.icon, JSON.stringify(tick));
  check("nothing threw around the open lines", !bad.length, bad.join(" | "));
  await page.close();

  /* Cards made before the count existed read it once, and are healed. */
  const old = await boot2(mine(undefined));
  await old.page.waitForTimeout(600);
  const healed = await old.page.evaluate(() => ({ calls: window.__calls.filter(x => x.s.includes("/api/personal/open")).map(x => x.body.action || "list"), n: document.getElementById("stillN").textContent, hidden: document.getElementById("stillBtn").hidden }));
  check("cards with no count are read once from the files, and the icon shows the total", JSON.stringify(healed.calls) === '["list"]' && healed.n === "3" && !healed.hidden, JSON.stringify(healed));
  check("nothing threw healing the count", !old.bad.length, old.bad.join(" | "));
  await old.page.close();
  /* Nothing open: no icon, no call. */
  const none = await boot2(mine({ marc: 0, paul: 0, lea: 0 }));
  await none.page.waitForTimeout(500);
  check("with nothing open there is no icon and no read", await none.page.evaluate(() => document.getElementById("stillBtn").hidden && !window.__calls.some(x => x.s.includes("/api/personal/open"))));
  await none.page.close();
}

/* ---- languages in Settings: what the personal folder keeps, how answers come back ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/models")) return Response.json({ chat: "z-ai/glm-5.3-flash", reply: body.reply ?? "same", voice: "voice" in body ? body.voice : null });
      return Response.json({ chats: [] });
    };
  }, { ...STATE, models: { chat: "z-ai/glm-5.3-flash", chatDefault: "z-ai/glm-5.3-flash", reply: "same", voice: null } });
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(200);
  const lang = await page.evaluate(() => ({ shown: !document.getElementById("langBlock").hidden, store: !!document.getElementById("langStore"),
    hint: document.querySelector("#langBlock .hint").textContent,
    reply: [...document.querySelectorAll("#langReply button")].map(b => b.textContent + (b.classList.contains("on") ? "*" : "")) }));
  check("Settings, Languages: files always in English, answers as you write by default", lang.shown && !lang.store && /Every note and file is kept in English/.test(lang.hint)
    && JSON.stringify(lang.reply) === '["As you write*","In English"]', JSON.stringify(lang));
  await page.click("#langBlock > summary");
  await page.click('#langReply button[data-v="en"]'); await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({ sent: window.__calls.filter(x => x.s.includes("/api/models")).pop()?.body, on: document.querySelector("#langReply .on")?.textContent,
    msg: document.getElementById("langMsg").textContent }));
  check("a tap saves it for the workspace and says so", saved.sent?.reply === "en" && saved.on === "In English" && /Answers come back in English/.test(saved.msg), JSON.stringify(saved));
  check("nothing threw in the languages", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- the open chat bar keeps the folders, levels, mic and send on one row ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.fetch = async u => String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] });
  }, STATE);
  const rows = [];
  for (const w of [390, 640, 800, 860, 1000, 1280]) {
    await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(120);
    await page.focus("#input"); await page.waitForTimeout(400);
    rows.push(await page.evaluate(w => {
      const mid = id => { const b = document.getElementById(id).getBoundingClientRect(); return Math.round(b.top + b.height / 2); };
      return { w, scope: mid("scopeBtn"), mic: mid("micBtn"), send: mid("send"), over: document.documentElement.scrollWidth > innerWidth };
    }, w));
  }
  check("at every width the folders, levels, mic and send share one row, nothing off screen", rows.every(r => r.scope === r.mic && r.mic === r.send && !r.over), JSON.stringify(rows));
  check("nothing threw sizing the bar", !bad.length, bad.join(" | "));
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
  await page.focus("#input"); await page.fill("#srcInput", "Big course.pdf");
  /* 20,000 characters in paragraphs: an 18,000 pass that must split, and a 2,000 one. */
  await page.fill("#input", Array.from({ length: 100 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(38)).join("\n\n"));
  await page.click("#send"); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ reads: window.__reads, plans: window.__plans,
    note: document.getElementById("dropKept")?.textContent || "", card: !!document.querySelector(".card-foot .go"),
    err: document.querySelector(".err")?.textContent || "" }));
  check("a pass too big for one call is read again as two halves", r.reads[0] > 10000 && r.reads.filter(x => x <= 10000).length >= 3 && !r.err,
    JSON.stringify(r.reads) + " " + r.err);
  check("a plan too big for one call is split until it fits, and every topic is filed",
    r.plans.some(x => x > 10) && r.card && /filed into (\d+) concepts/.test(r.note)
    && /(\d+) topics, filed into \1 concepts/.test(r.note), JSON.stringify(r.plans) + " " + r.note);
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
  await page.focus("#input"); await page.click("#scopeBtn");
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
  await page.focus("#input"); await page.fill("#srcInput", "Gold note");
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

  /* Ask: the levels share the folder's row, every button on screen. The bar
     opens with a short rise, so it is measured once that has played. */
  await page.click("#dropClose"); await page.waitForTimeout(450);
  const lv = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, c = document.querySelector(".ctrls");
    const mode = document.getElementById("scopeBtn").getBoundingClientRect(), wrap = document.getElementById("levelWrap").getBoundingClientRect();
    return { W, off: [...document.querySelectorAll("#level button, #scopeBtn")].filter(b => {
        const r = b.getBoundingClientRect(); return r.left < 0 || r.right > W; }).map(b => b.dataset.v || b.id || b.textContent.trim()),
      scrolls: c.scrollWidth > c.clientWidth + 1, row: Math.abs(wrap.top - mode.top) < 6, wide: Math.round(wrap.width),
      tall: [...document.querySelectorAll("#level button")].every(b => b.getBoundingClientRect().height >= 40),
      hs: [...document.querySelectorAll("#level button")].map(b => Math.round(b.getBoundingClientRect().height)).join(","),
      open: !document.querySelector(".composer-wrap").classList.contains("compact") };
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

/* ---- questions and drops run in the background; the inbox lists what waits ---- */
{
  /* Audited today, so no audit waits in the inbox here. */
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "s", owner: null, audit: { at: new Date().toISOString().slice(0, 10), sources: 0 } }],
    concepts: [{ brain: "me", slug: "marc", n: 2, title: "Marc Dupont", summaryLine: "Your co-founder", tag: "contact", ev: 1, updated: "2026-10-04" }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__asks = []; window.__gets = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: [], health: [{ slug: "content", score: 5, top: true, person: false, open: 3, best: "x", parts: {} }] });
      if (s.includes("/api/ask")) {
        window.__asks.push(body);
        await new Promise(ok => setTimeout(ok, body.q === "slow one" ? 1200 : 100));
        if (body.concept) return Response.json({ answer: "Noted: Marc is at Revolut now.", sources: 0, level: "normal", chat: "c-marc",
          concept: { id: body.concept, title: "Marc Dupont", brain: "me", personal: true }, changed: { title: "Marc Dupont", summary: true, added: 1, removed: 1 } });
        return Response.json({ answer: "Answer to " + body.q, sources: 3, level: "normal", chat: body.chat || (body.q === "slow one" ? "c-slow" : "c-fast") });
      }
      if (s.includes("/api/chats/get")) { window.__gets.push(body.id); return Response.json({ chat: { id: body.id, title: "slow one", brain: "content", pinned: false,
        turns: [{ q: "slow one", a: "Answer to slow one", level: "normal", sources: 3, at: 1 }] } }); }
      if (s.includes("/api/chats")) return Response.json({ chats: [] });
      if (s.includes("/api/drop/check")) { await new Promise(ok => setTimeout(ok, 500)); return Response.json({ duplicate: false, sid: "s-notes" }); }
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Notes", topics: [] } });
      if (s.includes("/api/concept")) return Response.json({ concept: { brain: "me", slug: "marc", title: "Marc Dupont", tag: "contact", position: "Your co-founder.",
        evidence: [], data: [], conflicts: [], sources: [], related: [] }, insights: [], linkedFrom: [], raw: { notes: [], total: 0 } });
      return Response.json({});
    };
  }, mine);
  await page.waitForTimeout(200);
  const badge = () => page.evaluate(() => document.getElementById("inboxN").hidden ? "" : document.getElementById("inboxN").textContent);
  check("the inbox bubble counts the open clashes from the start", await badge() === "3", await badge());
  await page.fill("#input", "slow one"); await page.click("#send"); await page.waitForTimeout(120);
  await page.fill("#input", "and then?");
  const held = await page.evaluate(() => ({ run: document.getElementById("inboxBtn").classList.contains("run"), off: document.getElementById("send").disabled }));
  check("a question on its way turns a ring on the bubble, and holds this chat's send", held.run && held.off, JSON.stringify(held));
  await page.fill("#input", "");
  await page.click("#startBtn"); await page.waitForTimeout(80);
  await page.fill("#input", "fast one");
  check("a new chat is free while the first question runs", !(await page.evaluate(() => document.getElementById("send").disabled)));
  await page.click("#send"); await page.waitForTimeout(400);
  const fast = await page.evaluate(() => ({ chat: window.__asks[1]?.chat ?? null, text: document.getElementById("thread").textContent }));
  check("its question starts a chat of its own, and its answer lands on screen", fast.chat === null && /Answer to fast one/.test(fast.text) && !/slow one/.test(fast.text), JSON.stringify(fast));
  await page.waitForTimeout(900);
  const landed = await page.evaluate(() => ({ text: document.getElementById("thread").textContent, run: document.getElementById("inboxBtn").classList.contains("run") }));
  check("the first answer lands in its own chat, off screen, and the ring stops", !/Answer to slow one/.test(landed.text) && !landed.run, JSON.stringify(landed));
  check("the bubble counts it unread", await badge() === "4", await badge());
  await page.fill("#input", "next"); await page.click("#send"); await page.waitForTimeout(300);
  check("the chat on screen keeps its own id: the next question joins it", await page.evaluate(() => window.__asks[2]?.chat) === "c-fast");
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  const panel = await page.evaluate(() => ({ open: !document.getElementById("inbox").hidden, groups: [...document.querySelectorAll("#inbox .ib-g h4")].map(x => x.textContent),
    items: [...document.querySelectorAll("#inbox .ib-t")].map(x => x.textContent) }));
  check("the bubble opens a panel: answers ready, then the decisions, the clashes among them", panel.open && JSON.stringify(panel.groups) === '["Answers ready","Decisions"]'
    && panel.items[0] === "slow one" && panel.items[1] === "3 decisions ready", JSON.stringify(panel));
  await page.click("#inbox .ib-it.new"); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => ({ get: window.__gets.pop(), text: document.getElementById("thread").textContent, closed: document.getElementById("inbox").hidden }));
  check("an answer ready opens its chat, and counts as read", opened.get === "c-slow" && /Answer to slow one/.test(opened.text) && opened.closed && await badge() === "3", JSON.stringify(opened));

  /* A drop runs on while you chat. */
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.focus("#input"); await page.fill("#srcInput", "Notes.txt"); await page.fill("#input", "Some notes to file.");
  await page.click("#send"); await page.waitForTimeout(100);
  await page.click("#dropClose"); await page.waitForTimeout(60);
  await page.fill("#input", "while it reads");
  const free = await page.evaluate(() => ({ off: document.getElementById("send").disabled, run: document.getElementById("inboxBtn").classList.contains("run") }));
  check("the chat stays free while a drop reads, and the ring says it runs", !free.off && free.run, JSON.stringify(free));
  await page.click("#inboxBtn"); await page.waitForTimeout(60);
  const reading = await page.evaluate(() => [...document.querySelectorAll("#inbox .ib-g")].find(g => g.querySelector("h4").textContent === "Drop")?.textContent || "");
  check("the inbox lists the drop with its step", /Notes\.txt/.test(reading) && /Checking for a repeat/.test(reading), reading);
  await page.keyboard.press("Escape"); await page.fill("#input", "");
  await page.waitForTimeout(700);
  check("a drop that stops on a choice waits in the inbox", await badge() === "4", await badge());
  await page.click("#inboxBtn"); await page.waitForTimeout(60);
  const waits = await page.evaluate(() => [...document.querySelectorAll("#inbox .ib-g")].find(g => g.querySelector("h4").textContent === "Drop")?.textContent || "");
  check("it says what it waits on", /Waiting on your choice/.test(waits), waits);
  await page.click("#inbox .ib-g:has(h4:text('Drop')) .ib-it"); await page.waitForTimeout(80);
  check("a tap opens Drop on it, and it counts as seen", await page.evaluate(() => document.querySelector("main").dataset.view) === "drop" && await badge() === "3");
  await page.click("#dropClose");

  /* A chat about one person of the personal folder changes their file. */
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(200);
  await page.click("#fvPeople"); await page.waitForTimeout(80);
  await page.click(".fv-row"); await page.waitForTimeout(200);
  await page.click("#fvAsk"); await page.waitForTimeout(80);
  const chip = await page.evaluate(() => ({ chip: document.getElementById("aboutLine").textContent, ph: document.getElementById("input").placeholder,
    iv: document.getElementById("ivBar").hidden, foot: document.getElementById("footNote").textContent }));
  check("a person's chat says it edits them, and nothing else runs there", /^EditingMarc Dupont/.test(chip.chip) && /^Tell or ask anything about Marc Dupont/.test(chip.ph)
    && chip.iv && /written to it at once/.test(chip.foot), JSON.stringify(chip));
  await page.fill("#input", "Il a quitté la fintech pour Revolut"); await page.click("#send"); await page.waitForTimeout(300);
  const edit = await page.evaluate(() => ({ sent: window.__asks.pop(), line: [...document.querySelectorAll("#thread .filed")].pop()?.textContent || "" }));
  check("what you tell it goes to that person alone", edit.sent?.concept === "me/marc" && edit.sent.q === "Il a quitté la fintech pour Revolut", JSON.stringify(edit.sent));
  check("the answer says what changed in their file, with the way to it", /^Saved to Marc Dupont: card rewritten · 1 line added · 1 taken out/.test(edit.line) && /Open it$/.test(edit.line), edit.line);
  check("nothing threw in the background or the inbox", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a failed question: Try again for the connection, Send feedback for the rest ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__asks = []; window.__fb = []; window.__mode = "drop";
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/feedback")) { window.__fb.push(body); return Response.json({ sent: true }); }
      if (s.includes("/api/ask")) {
        window.__asks.push(body);
        if (window.__mode === "drop") { window.__mode = "ok"; throw new TypeError("Failed to fetch"); }
        if (window.__mode === "refuse") return Response.json({ error: "that model refused the request" });
        return Response.json({ answer: "Back on track.", sources: 3, level: "normal", chat: "c-1" });
      }
      return Response.json({ chats: [] });
    };
  }, STATE);
  await page.fill("#input", "the first 35 characters matter most"); await page.click("#send"); await page.waitForTimeout(200);
  const dead = await page.evaluate(() => ({ msg: document.querySelector("#thread .err span")?.textContent,
    btns: [...document.querySelectorAll("#thread .err button")].map(b => b.textContent) }));
  check("a dropped connection offers Try again, and Send feedback", /did not answer/.test(dead.msg || "") && JSON.stringify(dead.btns) === '["Try again","Send feedback"]', JSON.stringify(dead));
  await page.click("#thread .err .err-go"); await page.waitForTimeout(250);
  const back = await page.evaluate(() => ({ asks: window.__asks.length, mine: document.querySelectorAll("#thread .msg.me").length,
    text: document.getElementById("thread").textContent, err: !!document.querySelector("#thread .err") }));
  check("Try again sends the same message once more, in place", back.asks === 2 && back.mine === 1 && /Back on track/.test(back.text) && !back.err
    && await page.evaluate(() => window.__asks[1].q) === "the first 35 characters matter most", JSON.stringify(back));
  await page.evaluate(() => { window.__mode = "refuse"; });
  await page.fill("#input", "and the subject line?"); await page.click("#send"); await page.waitForTimeout(200);
  const other = await page.evaluate(() => [...document.querySelectorAll("#thread .err button")].map(b => b.textContent));
  check("any other error offers Send feedback alone", JSON.stringify(other) === '["Send feedback"]', JSON.stringify(other));
  await page.click("#thread .err .err-fb"); await page.waitForTimeout(200);
  const sent = await page.evaluate(() => ({ fb: window.__fb[0], label: document.querySelector("#thread .err .err-fb").textContent }));
  check("Send feedback sends the error, where it happened and the message, then says so",
    sent.fb?.error === "that model refused the request" && sent.fb.where === "chat" && sent.fb.q === "and the subject line?" && sent.fb.chat === "c-1"
    && !("to" in sent.fb) && sent.label === "Sent. Thank you", JSON.stringify(sent));
  check("nothing threw around a failed question", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a drop keeps everything: facts read again, every topic filed ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__reads = []; window.__plans = []; window.__settles = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-fund" });
      if (s.includes("/api/drop/read")) {
        window.__reads.push(body);
        return Response.json({ part: body.gaps
          ? { topics: [{ topic: "Revenue", ideas: ["Revenue reached 3,400 euros in Lyon."] }, { topic: "Fund returns", ideas: ["The fund is run by Charles Gave."] }] }
          : { title: "Fund letter", author: "Jane Roe", kind: "argument", topics: [{ topic: "Fund returns", ideas: ["In 2019 the fund returned 12.5%."] },
              { topic: "Team", ideas: ["The team met twice."] }], thin: ["Markets will rise next year"] } });
      }
      if (s.includes("/api/drop/plan")) {
        window.__plans.push(body);
        return Response.json({ plan: body.again ? { brains: ["content"], matched: [], candidates: [], new: [], echo: [], conflicts: [] }
          : { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
              candidates: [{ title: "Fund returns", brain: "content", why: "12.5% in 2019", from: ["T1"] }, { title: "Revenue", brain: "content", why: "3,400 euros", from: ["T3"] }] } });
      }
      if (s.includes("/api/drop/merge")) return Response.json({ same: [], into: [], english: [] });
      if (s.includes("/api/drop/settle")) { window.__settles.push(body);
        return Response.json({ sid: "s-fund", brains: ["content"], positions: body.plan.candidates.length, counted: [], written: [], counts: { new: 1, echo: 0 } }); }
      return Response.json({});
    };
  }, STATE);
  await page.evaluate(() => document.getElementById("dropBtn").click());
  await page.focus("#input"); await page.fill("#srcInput", "Fund letter.txt");
  await page.fill("#input", "In 2019 the fund returned 12.5% under Charles Gave. Revenue reached 3,400 euros in Lyon. The team met Marie Curie twice.");
  await page.click("#send"); await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ reads: window.__reads.length, gap: window.__reads[1], plans: window.__plans.map(p => ({ again: !!p.again, t: p.ext.topics.map(x => x.topic) })),
    kept: document.getElementById("dropKept")?.textContent || "", box: !!document.getElementById("dropCover"),
    chips: [...document.querySelectorAll(".card .chips .chip")].map(x => x.textContent) }));
  check("numbers and names the read left out send their passages for a second read", r.reads === 2 && r.gap?.gaps === true && /3,400 euros in Lyon/.test(r.gap.chunk || "")
    && /Charles Gave/.test(r.gap.chunk || "") && /Marie Curie/.test(r.gap.chunk || ""), JSON.stringify(r.gap));
  check("an opinion with nothing behind it, and what is still missing word for word, are topics too",
    JSON.stringify(r.plans[0]?.t) === '["Fund returns","Team","Revenue","More from the source","Markets will rise next year"]', JSON.stringify(r.plans));
  check("topics placed nowhere are filed once more, on their own", r.plans.length === 2 && r.plans[1].again
    && JSON.stringify(r.plans[1].t) === '["Team","More from the source","Markets will rise next year"]', JSON.stringify(r.plans));
  check("and the ones still left become concepts of their own: nothing is left out", ["+ Team", "+ More from the source", "+ Markets will rise next year"].every(c => r.chips.includes(c)), JSON.stringify(r.chips));
  check("the card says it in one line, with no section of its own", !r.box && /^Read as an argument: .*All of it kept: 21 words, 6 numbers, dates and names, 5 topics, filed into 5 concepts\.$/.test(r.kept), r.kept);
  await page.click(".card-foot .go"); await page.waitForTimeout(400);
  const stored = await page.evaluate(() => window.__settles.flatMap(b => b.plan.candidates.map(c => c.title)));
  check("Store it files every one", ["Fund returns", "Revenue", "Team", "More from the source", "Markets will rise next year"].every(t => stored.includes(t)), JSON.stringify(stored));
  check("nothing threw checking the drop", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- audits: due after 50 sources, the personal folder every week, decided from the inbox ---- */
{
  const old = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  const st = { ...STATE, brains: [{ slug: "content", name: "Content", type: "subject", scope: "c", audit: { at: old, sources: 2 } },
      { slug: "health", name: "Health", type: "subject", scope: "h", audit: { at: old, sources: 0 } },
      { slug: "me", name: "Me", type: "personal", scope: "", audit: { at: old, sources: 0 } },
      { slug: "theirs", name: "Theirs", type: "subject", scope: "t", space: "squidgy", shared: ["octopus"] }],
    concepts: [{ brain: "content", slug: "a", n: 1, title: "A" }, { brain: "health", slug: "b", n: 1, title: "B" },
      { brain: "me", slug: "marc", n: 1, title: "Marc", tag: "contact", ev: 3 }, { brain: "me", slug: "marc-dupont", n: 2, title: "Marc Dupont", tag: "contact", ev: 1 },
      { brain: "theirs", slug: "c", n: 1, title: "C" }],
    sources: [...Array.from({ length: 60 }, (_, i) => ({ sid: "s" + i, brains: ["content", "theirs"] })), { sid: "h1", brains: ["health"] }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/brain/audit")) return Response.json(body.action === "apart" ? { apart: 1 } : { audit: { at: new Date().toISOString().slice(0, 10), sources: body.brain === "content" ? 60 : 0 } });
      if (s.includes("/api/brain/tidy")) return Response.json({ brain: body.brain, total: 1, read: 1, same: [], english: [], blank: [] });
      if (s.includes("/api/personal/people")) return Response.json({ filed: { people: [] }, next: null, read: 2, total: 2 });
      return Response.json({ chats: [] });
    };
  }, st);
  await page.waitForTimeout(200);
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  const due = await page.evaluate(() => ({ badge: document.getElementById("inboxN").textContent,
    items: [...document.querySelectorAll("#inbox .ib-g")].filter(g => g.querySelector("h4").textContent === "Cleaning needed").flatMap(g => [...g.querySelectorAll(".ib-it")].map(x => x.textContent)) }));
  const auto = await page.evaluate(() => ({ tidy: window.__calls.filter(x => x.s.includes("/api/brain/tidy")).map(x => x.body.brain),
    stamp: window.__calls.filter(x => x.s.includes("/api/brain/audit")).map(x => x.body.brain) }));
  check("a folder with 50 sources since its last audit is audited on its own, once, and leaves the inbox; never a folder shared in",
    JSON.stringify(auto.tidy) === '["content"]' && JSON.stringify(auto.stamp) === '["content"]', JSON.stringify(auto));
  check("the personal folder, due after a week, waits in the inbox: its people need you", JSON.stringify(due.items) === '["Audit Melast audit 9 days ago"]' && due.badge === "2", JSON.stringify(due));
  await page.click("#inbox .ib-it >> text=Audit Me"); await page.waitForTimeout(400);
  const me = await page.evaluate(() => ({ pairs: [...document.querySelectorAll("#auditPane .td-card")].map(c => [...c.querySelectorAll(".td-opt b")].map(b => b.textContent).join("+")),
    fin: document.querySelector("#auditPane .au-fin")?.textContent, load: !!document.querySelector("#auditPane .au-load") }));
  check("the personal audit proposes the same person filed twice, the most mentioned first", JSON.stringify(me.pairs) === '["Marc+Marc Dupont"]', JSON.stringify(me));
  check("and it says it finished, the loader gone", /^Audit finished in \d+s\.$/.test(me.fin || "") && !me.load, JSON.stringify(me));
  await page.click("#auditPane .td-card .td-no"); await page.waitForTimeout(150);
  const apart = await page.evaluate(() => window.__calls.filter(x => x.s.includes("/api/brain/audit") && x.body.action === "apart").pop()?.body);
  check("Keep apart is remembered, so the next audit never asks", apart?.brain === "me" && JSON.stringify(apart.ids) === '["me/marc","me/marc-dupont"]', JSON.stringify(apart));
  check("nothing threw in the audits", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- an audit shows it runs, and says when it finished, here or in the inbox ---- */
{
  const st = { ...STATE, brains: [{ slug: "content", name: "Content", type: "subject", scope: "c", audit: { at: new Date().toISOString().slice(0, 10), sources: 60 } }],
    concepts: [{ brain: "content", slug: "a", n: 1, title: "A" }, { brain: "content", slug: "b", n: 2, title: "B" }],
    sources: Array.from({ length: 60 }, (_, i) => ({ sid: "s" + i, brains: ["content"] })) };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.__go = null;
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/brain/audit")) return Response.json({ audit: { at: new Date().toISOString().slice(0, 10), sources: 60 } });
      if (s.includes("/api/brain/tidy")){ await new Promise(r => { window.__go = r; }); return Response.json({ brain: body.brain, total: 2, read: 2, same: [], english: [], blank: [] }); }
      return Response.json({ chats: [] });
    };
  }, st);
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("keyBtn").click()); await page.waitForTimeout(200);
  await page.click("#auditBlock > summary");
  await page.click('#auditList .au-row[data-slug="content"] button'); await page.waitForTimeout(1300);
  const run = await page.evaluate(() => ({ spin: !!document.querySelector("#tidyPane .au-load .spinner"), step: document.querySelector("#tidyPane .au-step")?.textContent,
    time: document.querySelector("#tidyPane .au-time")?.textContent, ring: document.getElementById("inboxBtn").classList.contains("run") }));
  check("a running audit shows the turning mark, its step and the time it has run, and the inbox ring turns",
    run.spin && run.step === "Reading 2 concepts" && /^[1-9]s$/.test(run.time) && run.ring, JSON.stringify(run));
  await page.click("#fvChat"); await page.waitForTimeout(150);
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  const away = await page.evaluate(() => [...document.querySelectorAll("#inbox .ib-g")].map(g => g.querySelector("h4").textContent + ":" + [...g.querySelectorAll(".ib-it")].map(x => x.className + "=" + x.textContent).join(",")));
  check("left, it keeps running in the inbox, with its step", away.length === 1 && /^Audit:ib-it run=Audit ContentReading 2 concepts · \d+s$/.test(away[0]), JSON.stringify(away));
  await page.click("#inboxBtn"); await page.evaluate(() => window.__go()); await page.waitForTimeout(300);
  const done = await page.evaluate(() => ({ ring: document.getElementById("inboxBtn").classList.contains("run"), badge: document.getElementById("inboxN").textContent }));
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  const fin = await page.evaluate(() => [...document.querySelectorAll("#inbox .ib-it")].map(x => x.textContent));
  check("when it ends elsewhere, the ring stops and the inbox says it finished", !done.ring && done.badge === "1" && JSON.stringify(fin) === '["Audit ContentFinished · all clean"]', JSON.stringify({ done, fin }));
  await page.click("#inbox .ib-it >> text=Audit Content"); await page.waitForTimeout(200);
  const back = await page.evaluate(() => ({ fin: document.querySelector("#tidyPane .au-fin")?.textContent, spin: !!document.querySelector("#tidyPane .au-load"),
    clean: document.querySelector("#tidyPane .td-clean")?.textContent, badge: document.getElementById("inboxN").hidden, tidies: window.__calls.filter(x => x.s.includes("/api/brain/tidy")).length }));
  check("a tap brings its pane back, finished, with no second run, and the inbox lets go",
    /^Audit finished in \d+s\.$/.test(back.fin || "") && !back.spin && /^All clean/.test(back.clean || "") && back.badge && back.tidies === 1, JSON.stringify(back));
  check("nothing threw around a running audit", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a twin at 100%: no interview left to offer ---- */
{
  const mine = { ...STATE, brains: [...STATE.brains, { slug: "me", name: "Me", type: "personal", scope: "", owner: null, audit: { at: new Date().toISOString().slice(0, 10), sources: 0 } }],
    concepts: [{ brain: "me", slug: "lyon", n: 1, title: "Born in Lyon", summaryLine: "You were born in Lyon." }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    const ch = [{ key: "A", title: "Life story", total: 28, answered: 20, known: 8, skipped: 0 }];
    window.fetch = async (u) => {
      const s = String(u);
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/interview")) return Response.json({ interview: { on: false, pct: 100, covered: 335, seen: 335, total: 335, chapter: null, chapters: ch, pending: null,
        test: { mine: false, twin: false, again: false, twinPct: null, selfPct: null, target: 85 }, profile: null } });
      return Response.json({ chats: [] });
    };
  }, mine);
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent)).click());
  await page.waitForTimeout(300);
  const bar = await page.evaluate(() => ({ hidden: document.getElementById("ivBar").hidden, go: !!document.getElementById("ivGo") }));
  await page.evaluate(() => [...document.querySelectorAll("#brains .brain-row")].find(r => /Me/.test(r.textContent))?.querySelector(".ed.op")?.click());
  await page.waitForTimeout(300);
  const fv = await page.evaluate(() => ({ acts: [...document.querySelectorAll(".fv-acts .fv-b")].map(b => b.id), twin: document.getElementById("fvTwin")?.textContent }));
  await page.click("#fvTwin"); await page.waitForTimeout(250);
  const pane = await page.evaluate(() => ({ go: !!document.getElementById("twGo"), say: document.querySelector("#twinPane .tw-acts")?.textContent }));
  check("at 100%, the interview and the profile leave the chat bar, the folder's buttons and the twin pane; the test stays", bar.hidden && !bar.go && !fv.acts.includes("fvIv") && !fv.acts.includes("fvProfile")
    && fv.acts.includes("fvTest") && /Twin 100% complete/.test(fv.twin || "")
    && !pane.go && /Interview complete/.test(pane.say || ""), JSON.stringify({ bar, fv, pane }));
  check("nothing threw with the twin complete", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- decisions: every call waiting, each with a suggested one, grouped by topic, accepted in one tap ---- */
{
  const today = new Date().toISOString().slice(0, 10);
  const st = { ...STATE, brains: [
      { slug: "content", name: "Content", type: "subject", scope: "c", audit: { at: today, sources: 0 },
        findings: { same: [[{ id: "content/a", title: "Offer first", ev: 5 }, { id: "content/b", title: "Offer before audience", ev: 2 }]],
          english: [{ id: "content/c", title: "Ancrage des prix", to: "Price anchoring" }, { id: "content/e", title: "Marque", to: "Brand voice" }], blank: [{ id: "content/d", title: "Pricing", line: "" }] } },
      { slug: "me", name: "Me", type: "personal", scope: "", audit: { at: today, sources: 0 } }],
    concepts: [{ brain: "content", slug: "a", n: 1, title: "Offer first", summaryLine: "An offer beats an audience", ev: 5 },
      { brain: "content", slug: "b", n: 2, title: "Offer before audience", summaryLine: "Sell first", ev: 2 },
      { brain: "content", slug: "c", n: 3, title: "Ancrage des prix", summaryLine: "Anchor high", ev: 1 },
      { brain: "content", slug: "e", n: 5, title: "Marque", summaryLine: "One voice", ev: 1 },
      { brain: "content", slug: "d", n: 4, title: "Pricing", summaryLine: "", ev: 3 },
      { brain: "me", slug: "marc", n: 1, title: "Marc", tag: "contact", ev: 6 }, { brain: "me", slug: "marc-dupont", n: 2, title: "Marc Dupont", tag: "contact", ev: 2 }] };
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    let open = 1;
    const drop = ids => { state.concepts = state.concepts.filter(c => !ids.includes(`${c.brain}/${c.slug}`)); };
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: open ? ["content/a"] : [], health: [{ slug: "content", score: 7, open, best: "x", parts: {} }] });
      if (s.includes("/api/conflicts/settle")){ open = 0; return Response.json({ ok: true }); }
      if (s.includes("/api/conflicts")) return Response.json({ others: 0, conflicts: open ? [{ id: "content/a", brain: "content", title: "Offer first", a: "Offers win", aDate: "2025-01-01",
        b: "Audience wins", bDate: "2026-03-01", why: "", hint: { pick: "b", why: "The later claim: 2026-03-01 over 2025-01-01" } }] : [] });
      if (s.includes("/api/topics")) return Response.json({ topics: [{ title: "Offers", members: ["content/a", "content/b"] }] });
      if (s.includes("/api/concept/merge")){ drop(body.from); return Response.json({ ok: true }); }
      if (s.includes("/api/personal/contact") && body.action === "peek") return Response.json({ people: body.ids.map(id => ({
        "me/marc": { id: "me/marc", title: "Marc", aliases: [], line: "Your co-founder", summary: "Marc runs the company with you.", facts: [{ label: "Email", value: "marc@acme.co" }, { label: "Lives in", value: "Lyon" }],
          moments: [{ d: "2026-09-12", t: "Dinner in Lyon" }, { d: "2026-08-01", t: "Signed the lease" }], mentions: 6, open: 2, seen: "2026-09-12", updated: "2026-10-01" },
        "me/marc-dupont": { id: "me/marc-dupont", title: "Marc Dupont", aliases: ["M. Dupont"], line: "Your co-founder, now at Revolut", summary: "", facts: [{ label: "Email", value: "marc@acme.co" }], moments: [], mentions: 2, open: 0, seen: "", updated: "2026-09-02" },
      }[id])) });
      if (s.includes("/api/personal/contact")){ drop(body.from); return Response.json({ ok: true }); }
      if (s.includes("/api/concept/rename")){ state.concepts.find(c => `${c.brain}/${c.slug}` === body.id).title = body.title; return Response.json({ ok: true }); }
      if (s.includes("/api/concept/rederive")){ for (const id of body.ids) state.concepts.find(c => `${c.brain}/${c.slug}` === id).summaryLine = "Price on value"; return Response.json({ written: body.ids }); }
      if (s.includes("/api/brain/audit")){ if (body.action === "dismiss") state.brains[0].findings.english = state.brains[0].findings.english.filter(x => x.id !== body.id); return Response.json({ ok: true }); }
      return Response.json({ chats: [] });
    };
  }, st);
  await page.waitForTimeout(500);
  const hinted = await page.evaluate(() => window.__calls.filter(x => x.s.endsWith("/api/conflicts")).map(x => x.body.hints));
  await page.click("#inboxBtn"); await page.waitForTimeout(80);
  const ib = await page.evaluate(() => ({ badge: document.getElementById("inboxN").textContent,
    item: [...document.querySelectorAll("#inbox .ib-g")].find(g => g.querySelector("h4").textContent === "Decisions")?.querySelector(".ib-it")?.textContent }));
  check("the inbox gathers every call waiting as decisions: a clash, things filed twice, titles, empty positions, the same person twice",
    JSON.stringify(hinted) === "[true]" && ib.item === "6 decisions readyEach with a suggested call. Accept them all in one tap" && ib.badge === "6", JSON.stringify({ hinted, ib }));
  await page.click("#inbox .ib-it >> text=6 decisions ready"); await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => ({ groups: [...document.querySelectorAll(".dc-g h4")].map(h => h.textContent), all: document.getElementById("dcAll").textContent, swipe: document.getElementById("dcSwipe").hidden,
    rows: [...document.querySelectorAll(".dc-row")].map(r => `${r.querySelector(".dc-tag").textContent}|${r.querySelector(".dc-t").textContent}|${r.querySelector(".dc-hint").textContent}|${[...r.querySelectorAll(".dc-acts button")].map(b => b.textContent).join("/")}`) }));
  check("grouped by folder and topic, each with its suggested call and the reason",
    JSON.stringify(sheet.groups) === '["Content · Offers · 2","Content · 3","Me · People · 1"]' && sheet.all === "Accept all 6" && sheet.swipe === false
    && sheet.rows[0] === "Clash|Offer first|Suggested: B holds. The later claim: 2026-03-01 over 2025-01-01.|Accept/A holds/Both hold/Later"
    && sheet.rows[1] === 'Filed twice|Offer first and Offer before audience|Suggested: Merge into "Offer first". One idea filed 2 times, and this title reads clearest.|Accept/Keep apart/Later'
    && sheet.rows[2] === 'Title|Ancrage des prix|Suggested: Rename to "Price anchoring". Its title is not in English.|Accept/Keep this title/Later'
    && sheet.rows[4] === "No position|Pricing|Suggested: Write its position. It holds 3 evidence lines and no position.|Accept/Later"
    && sheet.rows[5] === "Same person|Marc and Marc Dupont|Suggested: Merge into Marc Dupont. The fuller name, 8 mentions together.|Accept/Merge into Marc/Keep apart/Later", JSON.stringify(sheet));
  const who = await page.evaluate(() => ({ peeks: window.__calls.filter(x => x.body.action === "peek").map(x => x.body.ids),
    blocks: [...document.querySelectorAll('.dc-row[data-kind="person"] .dc-p')].map(b => ({ id: b.dataset.id, text: b.innerText.replace(/\s+/g, " ").trim(), keep: !!b.querySelector(".dc-keep") })),
    other: [...document.querySelectorAll('.dc-row:not([data-kind="person"]) .dc-p')].length }));
  check("a same-person call shows both people side by side, read in one call, with the one the call keeps marked",
    JSON.stringify(who.peeks) === '[["me/marc","me/marc-dupont"]]' && who.blocks.length === 2 && who.other === 0
    && who.blocks[0].id === "me/marc" && !who.blocks[0].keep && who.blocks[1].id === "me/marc-dupont" && who.blocks[1].keep, JSON.stringify(who));
  check("each shows its mentions, open lines and last day seen, its line, its facts and its latest moments",
    /Marc Open file 6 mentions · 2 open · seen /.test(who.blocks[0].text) && /Your co-founder/.test(who.blocks[0].text) && /Email: marc@acme\.co Lives in: Lyon/.test(who.blocks[0].text)
    && /Dinner in Lyon/.test(who.blocks[0].text) && /Signed the lease/.test(who.blocks[0].text) && /Marc runs the company with you\./.test(who.blocks[0].text)
    && /2 mentions · 0 open/.test(who.blocks[1].text) && /Also called M\. Dupont/.test(who.blocks[1].text) && /suggested to keep/i.test(who.blocks[1].text) && /Email: marc@acme\.co/.test(who.blocks[1].text), JSON.stringify(who.blocks));
  await page.click('.dc-row[data-key="rename|content/c"] button >> text=Keep this title'); await page.waitForTimeout(300);
  const kept = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s.includes("/api/brain/audit")).pop()?.body, left: document.querySelectorAll(".dc-row").length,
    said: [...document.querySelectorAll(".dc-done")].map(x => x.textContent) }));
  check("another call is one tap: the title kept, for good, and said under Done here", kept.call?.action === "dismiss" && kept.call?.kind === "english" && kept.call?.id === "content/c"
    && kept.left === 5 && JSON.stringify(kept.said) === '["Ancrage des prix: Title kept."]', JSON.stringify(kept));
  await page.click("#dcAll"); await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ calls: window.__calls.filter(x => /conflicts\/settle|concept\/merge|concept\/rename|concept\/rederive|personal\/contact/.test(x.s) && x.body.action !== "peek").map(x => x.s.split("/api/")[1] + ":" + JSON.stringify(x.body.pick ?? x.body.into ?? x.body.title ?? x.body.ids)),
    say: document.getElementById("dcSay").textContent, state: document.getElementById("dcState").textContent, badge: document.getElementById("inboxN").hidden,
    swipe: document.getElementById("dcSwipe").hidden }));
  check("Accept all applies every suggestion, then the inbox lets go", JSON.stringify(after.calls) === JSON.stringify(['conflicts/settle:"b"', 'concept/merge:"content/a"', 'concept/rename:"Brand voice"', 'personal/contact:"me/marc-dupont"', 'concept/rederive:["content/d"]'])
    && /^Nothing waiting/.test(after.say) && after.state === "5 of 5 done." && after.badge && after.swipe, JSON.stringify(after));
  check("nothing threw around the decisions", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- a same-person call: see both, merge into either, on a phone too ---- */
{
  const today = new Date().toISOString().slice(0, 10);
  const st = { ...STATE, brains: [{ slug: "me", name: "Me", type: "personal", scope: "", audit: { at: today, sources: 0 } }],
    concepts: [{ brain: "me", slug: "paul", n: 1, title: "Paul", tag: "contact", ev: 9, summaryLine: "Your brother" },
      { brain: "me", slug: "paul-martin", n: 2, title: "Paul Martin", tag: "contact", ev: 2, summaryLine: "A client in Nantes" }] };
  const init = state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = [];
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s, body });
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/health")) return Response.json({ conflicted: [], health: [] });
      if (s.includes("/api/personal/contact") && body.action === "peek") return Response.json({ people: body.ids.slice(0, 1).map(id => ({ id, title: "Paul", aliases: [], line: "Your brother", summary: "", facts: [{ label: "Born in", value: "Brest" }], moments: [], mentions: 9, open: 1, seen: "", updated: "" })) });
      if (s.includes("/api/personal/contact")){ state.concepts = state.concepts.filter(c => !body.from.includes(`${c.brain}/${c.slug}`)); return Response.json({ into: body.into, joined: 1 }); }
      return Response.json({ chats: [] });
    };
  };
  const open = async (w, h, mobile) => {
    const page = await hermetic(); const bad = [];
    await page.setViewportSize({ width: w, height: h }); page.on("pageerror", e => bad.push(e.message));
    await page.addInitScript(init, JSON.parse(JSON.stringify(st)));
    await page.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
    await page.click("#inboxBtn"); await page.click("#inbox .ib-it"); await page.waitForTimeout(400);
    return { page, bad };
  };
  const ph = await open(390, 844, true);
  const m = await ph.page.evaluate(() => { const bs = [...document.querySelectorAll(".dc-p")].map(b => b.getBoundingClientRect()), o = document.querySelector(".dc-open").getBoundingClientRect();
    return { n: bs.length, stacked: bs.length === 2 && Math.abs(bs[0].left - bs[1].left) < 2 && bs[1].top >= bs[0].bottom - 1, inside: bs.every(b => b.left >= 0 && b.right <= innerWidth), wide: document.documentElement.scrollWidth > innerWidth, open: Math.round(o.height) }; });
  check("on a phone the two people stack, inside the screen, with a tap target to open each file", m.n === 2 && m.stacked && m.inside && !m.wide && m.open >= 40, JSON.stringify(m));
  check("a card the server could not give keeps the lists' own lines, and says so", await ph.page.evaluate(() => [...document.querySelectorAll(".dc-p")].map(b => b.textContent).some(t => /Paul Martin/.test(t) && /A client in Nantes/.test(t) && /could not be read/.test(t))));
  await ph.page.close();

  const d = await open(1280, 800, false);
  const side = await d.page.evaluate(() => { const bs = [...document.querySelectorAll(".dc-p")].map(b => b.getBoundingClientRect()); return { side: bs.length === 2 && Math.abs(bs[0].top - bs[1].top) < 2 && bs[1].left > bs[0].right - 1 }; });
  check("on a desktop they sit side by side", side.side, JSON.stringify(side));
  const row = await d.page.evaluate(() => [...document.querySelectorAll(".dc-acts button")].map(b => b.textContent).join("/"));
  check("the call can be to merge into either one, by name", row === "Accept/Merge into Paul/Keep apart/Later", row);
  await d.page.click(".dc-acts button >> text=Merge into Paul"); await d.page.waitForTimeout(400);
  const done = await d.page.evaluate(() => ({ call: window.__calls.filter(x => x.body.action === "merge").pop()?.body, said: [...document.querySelectorAll(".dc-done")].map(x => x.textContent) }));
  check("it merges the suggested name into the other card, and says so", done.call?.into === "me/paul" && JSON.stringify(done.call?.from) === '["me/paul-martin"]' && JSON.stringify(done.said) === '["Paul and Paul Martin: Merged into Paul."]', JSON.stringify(done));
  check("nothing threw seeing both people", !d.bad.length && !ph.bad.length, d.bad.concat(ph.bad).join(" | "));
  await d.page.close();
}

/* ---- projects: a file or a table at two thirds, its chat at one third, a memory of its own ---- */
{
  const mk = (slug, name, n) => [{ slug, name, type: "subject", scope: name }, Array.from({ length: n }, (_, i) => ({ brain: slug, slug: slug + i, n: i + 1, title: `${name} note ${i + 1}`, summaryLine: "", ev: 2 }))];
  const [b1, c1] = mk("pricing", "Pricing", 5);
  const DOC = [
    { sid: 1, ord: 1, title: "Goal", text: "# The Build Games: launch brief\n\n## 1. Goal\n\nFill 200 seats by 30 November. <img src=x onerror=\"window.__pwned=1\">\n\nThe cohort runs for four weeks and every team of three ships a game before the\nlast day. Seats are limited.\nBy Ana" },
    { sid: 2, ord: 2, title: "Offer", text: "## 2. Offer\n\n| Plan | Seats | Price |\n| --- | --- | --- |\n| Starter | 1 | €490 |\n| Team | 3 | €1,490 |" },
    { sid: 3, ord: 3, title: "Timeline", text: "## 3. Timeline\n\n- 20 Oct: the waitlist opens\n- 3 Nov: early-bird pricing closes\n\n[[p. 4]]\nSecond page words." }];
  const COLS = [{ name: "Program", kind: "text", filled: 4 }, { name: "Price", kind: "num", filled: 4, sum: 5130, min: 490, max: 2400, avg: 1282.5 }, { name: "Plan", kind: "text", filled: 4, values: ["Yes", "No"] }];
  const ROWS = [["Game Jam Pro", "1,200", "Yes"], ["Indie Sprint", "690", "No"], ["Studio Lab", "2,400", "Yes"], ["Prototype Club", "490", "No"]];
  const st = { ...STATE, brains: [b1, { slug: "me", name: "Me", type: "personal", scope: "" }], concepts: c1,
    projects: [{ slug: "launch-plan", name: "Launch plan", kind: "doc", file: "brief-v3.docx", status: "ready", chars: 900, sections: 3, memory: 1, at: 3 },
      { slug: "pricing-review", name: "Pricing review", kind: "table", file: "competitors.xlsx", status: "ready", chars: 300, sections: 1, memory: 0, at: 2 },
      { slug: "newsletter", name: "Newsletter plan", kind: null, file: "", status: "empty", chars: 0, sections: 0, memory: 0, at: 0 }] };
  const projects = {
    "launch-plan": { project: { slug: "launch-plan", name: "Launch plan", created: "2026-10-08" },
      file: { name: "brief-v3.docx", kind: "doc", sheets: [{ name: "brief-v3.docx", cols: [], rows: 0 }], chars: 900, sections: 3, status: "ready", ver: 1, at: 1 },
      cards: DOC.map(d => ({ sid: d.sid, ord: d.ord, sheet: 0, title: d.title, summary: "About " + d.title, chars: d.text.length })), turns: [], edits: [],
      memory: [{ slug: "team-price", title: "Team price", position: "Team is priced at 1,490 euros.", summaryLine: "", updated: "2026-10-08", sections: [2], stale: true, dates: ["2026-10-08"] }] },
    "pricing-review": { project: { slug: "pricing-review", name: "Pricing review", created: "2026-10-08" },
      file: { name: "competitors.xlsx", kind: "table", sheets: [{ name: "Programs", header: COLS.map(c => c.name), cols: COLS, rows: 4 }, { name: "Notes", header: ["Note"], cols: [{ name: "Note", kind: "text", filled: 1 }], rows: 1 }], chars: 300, sections: 2, status: "ready", ver: 1, at: 1 },
      cards: [], turns: [], edits: [], memory: [] },
    "newsletter": { project: { slug: "newsletter", name: "Newsletter plan", created: "2026-10-08" }, file: null, cards: [], turns: [], edits: [], memory: [] },
  };
  const init = arg => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = []; window.__proj = JSON.parse(JSON.stringify(arg.projects));
    window.fetch = async (u, opt) => {
      const path = String(u).replace(/^https?:\/\/[^/]+/, ""), body = JSON.parse(opt?.body || "{}");
      window.__calls.push({ s: path, body });
      const P = window.__proj[body.brain], J = x => Response.json(x);
      if (path === "/api/state") return J({ ...arg.state, projects: arg.state.projects });
      if (path === "/api/health") return J({ conflicted: [], health: [] });
      if (path === "/api/project/list") return J({ projects: arg.state.projects });
      if (path === "/api/project/get") return J(P);
      if (path === "/api/project/doc") { const at = body.sid != null ? arg.doc.findIndex(d => d.sid === body.sid) : arg.doc.findIndex(d => d.ord > (body.from ?? -1)); return J({ sections: at < 0 ? [] : arg.doc.slice(at, at + (body.n || 3)) }); }
      if (path === "/api/project/rows") { const f = body.from || 1; return J({ rows: arg.rows.slice(f - 1, f - 1 + (body.n || 100)).map((cells, i) => ({ n: f + i, cells })), total: arg.rows.length }); }
      if (path === "/api/project/chat") {
        const t = window.__reply(body, P); P.turns.push(t); return J({ turn: t });
      }
      if (path === "/api/project/forget") { P.memory = P.memory.filter(x => x.slug !== body.slug); return J({ ok: true }); }
      if (path === "/api/project/edit") { const e = P.edits.find(x => x.id === body.id); if (window.__editFail) return J({ error: "the file changed since this was proposed. Ask again." }); e.status = { apply: "applied", undo: "undone", dismiss: "dismissed" }[body.action]; return J({ ok: true }); }
      if (path === "/api/project/new") return J({ slug: "fresh" });
      if (path === "/api/project/begin") return J({ ver: 1 });
      if (path === "/api/project/part") { if (window.__partFails) return J({ error: "the model host was unreachable" }); return J({ sections: 1, chars: 10 }); }
      if (path === "/api/project/finish") return J({ sections: 1, chars: 10 });
      if (path === "/api/project/rename") { P.project.name = body.name; arg.state.projects.find(x => x.slug === body.brain).name = body.name; return J({ slug: body.brain, name: body.name }); }
      if (path === "/api/project/delete") { arg.state.projects = arg.state.projects.filter(x => x.slug !== body.brain); return J({ ok: true }); }
      if (path === "/api/project/download") return J({ name: P.file.name, kind: P.file.kind, sheet: "Programs", text: "a,b\n1,2\n" });
      if (path === "/api/chats/get") return J({ chat: { id: body.id, title: "Is gold a hedge?", brain: "all", pinned: false, turns: [{ q: "Is gold a hedge?", a: "Gold held its value over 20 years.", sources: 4, level: "normal" }] } });
      if (path === "/api/chats") return J({ chats: [{ id: "k1", title: "Is gold a hedge?", brain: "all", pinned: false, updated: Date.now(), turns: 1 }] });
      return J({ chats: [] });
    };
    window.__reply = (b, P) => {
      /* The project files its own notes: the server wrote one, resting on the Offer section. */
      P.memory.unshift({ slug: "two-payments", title: "Team price", position: "Team stays at 1,490 euros, sold in two payments.", summaryLine: "", updated: "2026-10-09", sections: [2], dates: ["2026-10-09"] });
      return { id: "t" + (P.turns.length + 1), q: b.q, a: "Keep **€1,490** and sell it in two payments.", proposal: /brainstorm/i.test(b.q), quotes: ["Team 3 €1,490"], noted: ["Team price"],
        used: { file: { name: P.file.name, whole: false, sections: [{ sid: 2, title: "Offer" }] }, folders: [{ slug: "pricing", name: "Pricing", notes: 2 }], memory: 1 } };
    };
  };
  const arg = { state: st, projects, doc: DOC, rows: ROWS };
  const { page, bad } = await boot("/chat.html", init, arg);
  await page.waitForTimeout(400);
  const side = await page.evaluate(() => ({ head: document.getElementById("projectsFold").textContent.trim().replace(/\s+/g, " "), n: document.getElementById("pcount").textContent,
    rows: [...document.querySelectorAll("#projects .pj-row")].map(r => r.querySelector(".nm").textContent + ":" + (r.querySelector(".b-ic path[d^='M7 3']") ? "doc" : "table")),
    plus: !!document.getElementById("newProject"), before: [...document.querySelectorAll(".panel")].map(x => x.id).join(","),
    folders: [...document.querySelectorAll("#brains .brain-row .nm")].map(x => x.textContent).join(",") }));
  check("a Projects panel sits between Chats and Folders, with its own plus and a row for each project", side.head === "Projects 3" && side.plus
    && side.before === "chatsPanel,projectsPanel,brainsPanel" && side.rows.join() === "Launch plan:doc,Pricing review:table,Newsletter plan:doc", JSON.stringify(side));
  check("no project is listed among the folders", !/Launch plan|Pricing review|Newsletter/.test(side.folders) && side.folders === "Me,Pricing", side.folders);

  /* a chat is open, a project goes over it, and the chat's row brings the chat back: also when it is the chat already current */
  await page.click("#chats .chat-row >> nth=0"); await page.waitForTimeout(500);
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(700);
  const over = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, project: !document.getElementById("projectView").hidden }));
  await page.click("#chats .chat-row >> nth=0"); await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, project: !document.getElementById("projectView").hidden, thread: !document.getElementById("thread").hidden,
    says: document.getElementById("thread").textContent.includes("Gold held its value"), on: document.querySelector("#chats .chat-row").classList.contains("on"), row: document.querySelector("#projects .pj-row").classList.contains("on") }));
  check("a click on the chat already current brings its screen back over a project", over.view === "project" && over.project && back.view === "chat" && !back.project && back.thread && back.says && back.on && !back.row, JSON.stringify({ over, back }));
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(600);
  await page.click("#chats .chat-row >> nth=0"); await page.waitForTimeout(300);
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(700);

  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(700);
  const lay = await page.evaluate(() => { const d = document.querySelector(".pj-doc").getBoundingClientRect(), c = document.querySelector(".pj-chat").getBoundingClientRect();
    return { view: document.querySelector("main").dataset.view, ratio: d.width / c.width, bar: getComputedStyle(document.querySelector(".composer-wrap")).display, thread: document.getElementById("thread").hidden,
      sections: document.querySelectorAll(".pj-sec").length, title: document.querySelector(".pj-t h2").textContent, chip: document.querySelector(".pj-chip").textContent,
      h2: document.querySelector(".pj-sec h2")?.textContent, table: !!document.querySelector(".pj-tw table th"), li: document.querySelectorAll(".pj-sec li").length, page: document.querySelector(".pj-pg")?.textContent,
      end: document.querySelector(".pj-more").textContent, pwned: !!window.__pwned, img: document.querySelectorAll(".pj-page img").length, row: document.querySelector("#projects .pj-row").classList.contains("on"),
      btns: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/") }; });
  check("a project opens with its file at two thirds of the screen and its chat at one third, the chat bar of the app gone", lay.view === "project" && lay.ratio > 1.8 && lay.ratio < 2.2 && lay.bar === "none" && lay.thread && lay.row, JSON.stringify(lay));
  check("the document reads in sections: headings, a table, a list, a page mark, to its end", lay.sections === 3 && lay.h2 === "The Build Games: launch brief" && lay.table && lay.li === 2 && lay.page === "p. 4" && lay.end === "End of the file", JSON.stringify(lay));
  check("words in the file are text, never markup", !lay.pwned && lay.img === 0, JSON.stringify(lay));
  const wrapped = await page.evaluate(() => [...document.querySelectorAll('.pj-sec[data-sid="1"] p')].pop().innerHTML);
  check("lines a PDF broke at the page's edge read on, and a line that ends a sentence still breaks", /ships a game before the last day\. Seats are limited\.<br>By Ana/.test(wrapped), wrapped);
  check("the head names the project and its file, with Contents, Replace, Download and Delete", lay.title === "Launch plan" && lay.chip === "brief-v3.docx" && lay.btns === "Contents/Replace file/Download/Delete", lay.btns);

  /* a question: sent, answered as a proposal, with what it used marked in the file */
  await page.fill(".pj-comp textarea", "Brainstorm: is Team too high?"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const ans = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/chat").pop()?.body, prop: !!document.querySelector(".pj-a.prop .pj-k"), kind: document.querySelector(".pj-a.prop .pj-k")?.textContent,
    text: document.querySelector(".pj-a .pj-md")?.innerHTML, chips: [...document.querySelectorAll(".pj-used > *")].map(c => c.textContent), used: [...document.querySelectorAll(".pj-sec.used")].map(x => x.dataset.sid),
    marks: [...document.querySelectorAll("mark.pj-mark")].map(m => m.textContent), btns: [...document.querySelectorAll(".pj-a .pj-tact button")].map(b => b.textContent), ta: document.querySelector(".pj-comp textarea").value }));
  check("a question goes to the project's chat with the project named", ans.call?.brain === "launch-plan" && ans.call?.q === "Brainstorm: is Team too high?" && ans.ta === "", JSON.stringify(ans.call));
  check("a brainstorm comes back as a proposal, in bold where it says so, and nothing to press to keep it: only Refine", ans.prop && ans.kind === "Proposal" && /<strong>€1,490<\/strong>/.test(ans.text) && JSON.stringify(ans.btns) === '["Refine"]', JSON.stringify(ans));
  check("it says what it used: the file and its section, the folder and its notes, the memory, and the note it filed by itself", JSON.stringify(ans.chips) === '["brief-v3.docx: Offer","Pricing folder · 2 notes","Memory · 1 note","Noted: Team price"]', JSON.stringify(ans.chips));
  check("the section it used is marked in the file, and the words it rests on, across the table's cells", JSON.stringify(ans.used) === '["2"]' && ans.marks.join(" ") === "Team 3 €1,490", JSON.stringify(ans));

  /* the memory fills by itself */
  await page.waitForTimeout(300);
  const auto = await page.evaluate(() => ({ tab: document.querySelector(".pj-tab i")?.textContent, keeps: window.__calls.filter(x => x.s === "/api/project/keep").length, offer: [...document.querySelectorAll("button")].some(b => /Keep in memory/.test(b.textContent)) }));
  check("the project filed a note by itself: the Memory tab counts it, and nothing offers to keep an answer", auto.tab === "2" && auto.keeps === 0 && !auto.offer, JSON.stringify(auto));
  await page.click(".pj-tab >> text=Memory"); await page.waitForTimeout(200);
  const mem = await page.evaluate(() => ({ items: [...document.querySelectorAll(".pj-mem b")].map(x => x.textContent), comp: document.querySelector(".pj-comp").hidden, small: [...document.querySelectorAll(".pj-mem small")].map(x => x.textContent) }));
  check("the Memory tab lists what the project remembers, with the message bar out of the way", JSON.stringify(mem.items) === '["Team price","Team price"]' && mem.comp === true, JSON.stringify(mem));
  check("each note says which section it rests on, and the file's change under it", mem.small[0] === "In Offer · 2026-10-09" && mem.small[1] === "In Offer · The file changed since · 2026-10-08", JSON.stringify(mem.small));
  await page.click(".pj-mem .pj-b >> nth=0"); await page.waitForTimeout(300);
  check("a note can be forgotten", (await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/forget").pop()?.body, left: document.querySelectorAll(".pj-mem").length })) ).left === 1);
  await page.click(".pj-tab >> text=Chat"); await page.waitForTimeout(200);

  /* a change the chat proposes: the words before and after, a click to apply, a click to undo */
  await page.evaluate(() => { window.__reply = (b, P) => { const e = { id: "e1", at: 1, status: "open", preview: [{ label: 'In "Offer"', before: "€1,490", after: "€1,290" }, { label: 'New section after "Offer"', before: "", after: "Early-bird week: 3 Nov." }] };
    P.edits.unshift(e); return { id: "t" + (P.turns.length + 1), q: b.q, a: "I changed the Team price to **€1,290**.", proposal: false, quotes: [], edit: { id: "e1", preview: e.preview, status: "open" },
      used: { file: { name: P.file.name, whole: false, sections: [{ sid: 2, title: "Offer" }] }, folders: [], memory: 0 } }; }; });
  await page.fill(".pj-comp textarea", "Make Team 1,290"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const ed = await page.evaluate(() => ({ kind: document.querySelector(".pj-edit .pj-ek").textContent, lines: [...document.querySelectorAll(".pj-edit .pj-ed")].map(x => x.innerText.replace(/\s+/g, " ")),
    del: document.querySelector(".pj-edit del")?.textContent, ins: document.querySelector(".pj-edit ins")?.textContent, btns: [...document.querySelectorAll(".pj-edit .pj-tact button")].map(b => b.textContent).join("/") }));
  check("a proposed change shows each place with its words before and after, and nothing is changed yet", ed.kind === "Proposed change" && ed.lines.length === 2 && /In "Offer" €1,490 €1,290/.test(ed.lines[0]) && ed.del === "€1,490" && ed.ins === "€1,290" && ed.btns === "Apply/Turn down"
    && !(await page.evaluate(() => window.__calls.some(x => x.s === "/api/project/edit"))), JSON.stringify(ed));
  await page.evaluate(() => { window.__editFail = true; });
  await page.click(".pj-edit .go"); await page.waitForTimeout(400);
  const refused = await page.evaluate(() => ({ msg: document.querySelector(".pj-edit .pj-msg")?.textContent, btns: [...document.querySelectorAll(".pj-edit .pj-tact button")].map(b => b.disabled).join(), kind: document.querySelector(".pj-edit .pj-ek").textContent }));
  check("a change the server refuses says why, and stays open to ask again", /changed since this was proposed/.test(refused.msg) && refused.btns === "false,false" && refused.kind === "Proposed change", JSON.stringify(refused));
  await page.evaluate(() => { window.__editFail = false; });
  await page.click(".pj-edit .go"); await page.waitForTimeout(500);
  const applied = await page.evaluate(() => ({ calls: window.__calls.filter(x => x.s === "/api/project/edit").map(x => x.body.action).join(), kind: document.querySelector(".pj-edit .pj-ek").textContent, btns: [...document.querySelectorAll(".pj-edit .pj-tact button")].map(b => b.textContent).join("/"),
    reloaded: window.__calls.filter(x => x.s === "/api/project/get").length }));
  check("Apply writes the change, the page reads the file again, and Undo is offered", applied.calls === "apply,apply" && applied.kind === "Applied" && applied.btns === "Undo" && applied.reloaded >= 2, JSON.stringify(applied));
  await page.click(".pj-edit .ghost"); await page.waitForTimeout(500);
  check("Undo puts it back", (await page.evaluate(() => ({ kind: document.querySelector(".pj-edit .pj-ek").textContent, last: window.__calls.filter(x => x.s === "/api/project/edit").pop()?.body.action }))).kind === "Undone");

  /* the contents list jumps to a section */
  await page.click(".pj-acts button >> text=Contents"); await page.waitForTimeout(250);
  const toc = await page.evaluate(() => [...document.querySelectorAll("#pcList .fv-row b")].map(b => b.textContent).join(","));
  await page.click("#pcList .fv-row >> text=Timeline"); await page.waitForTimeout(500);
  const jumped = await page.evaluate(() => ({ first: document.querySelector(".pj-sec")?.dataset.sid, call: window.__calls.filter(x => x.s === "/api/project/doc").pop()?.body }));
  check("Contents lists every section and opens the file from the one picked", toc === "Goal,Offer,Timeline" && jumped.first === "3" && jumped.call?.sid === 3, JSON.stringify({ toc, jumped }));

  /* the title renames, Download gives the file, Delete asks first */
  await page.click(".pj-t h2"); await page.fill("#prName", "Launch brief"); await page.click("#prSave"); await page.waitForTimeout(400);
  const ren = await page.evaluate(() => ({ title: document.querySelector(".pj-t h2").textContent, row: document.querySelector("#projects .pj-row .nm").textContent, call: window.__calls.filter(x => x.s === "/api/project/rename").pop()?.body }));
  check("a project is renamed from its title, and the list follows", ren.title === "Launch brief" && ren.row === "Launch brief" && ren.call?.name === "Launch brief", JSON.stringify(ren));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".pj-acts button >> text=Download")]);
  check("Download gives the file as it stands: a document as Markdown", dl.suggestedFilename() === "brief-v3.md", dl.suggestedFilename());

  /* leaving: a folder, or a new chat, takes the screen back */
  await page.evaluate(() => document.querySelectorAll("#brains .brain-row .op")[1].click()); await page.waitForTimeout(300);
  const leave = await page.evaluate(() => ({ view: document.querySelector("main").dataset.view, project: document.getElementById("projectView").hidden, on: document.querySelector("#projects .pj-row.on") !== null }));
  check("opening a folder leaves the project, which is no longer marked open", leave.view === "folder" && leave.project && !leave.on, JSON.stringify(leave));
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(500);
  await page.click("#startBtn"); await page.waitForTimeout(300);
  check("New chat takes the screen back from a project", (await page.evaluate(() => document.querySelector("main").dataset.view)) === "chat");

  /* a table: sheets as tabs, a grid with row numbers, what each column holds, the rows an answer used marked */
  await page.click("#projects .pj-row >> nth=1"); await page.waitForTimeout(700);
  const tbl = await page.evaluate(() => ({ tabs: [...document.querySelectorAll(".pj-sheets button")].map(b => b.textContent).join(), head: [...document.querySelectorAll(".pj-grid th")].map(t => t.textContent).join("|"),
    nums: [...document.querySelectorAll(".pj-grid tbody tr:first-child td")].map(t => t.className).join("|"), rows: document.querySelectorAll(".pj-grid tbody tr").length, first: document.querySelector(".pj-grid tbody tr td.r").textContent,
    foot: document.querySelector(".pj-foot summary").textContent.replace(/\s+/g, " "), stats: [...document.querySelectorAll(".pj-foot .ln")].map(x => x.textContent), btn: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/"),
    seg: [...document.querySelectorAll(".pj-seg button")].map(b => b.textContent).join() }));
  check("a table shows a tab for each sheet, a grid with row numbers, numbers on the right", tbl.tabs === "Programs,Notes" && tbl.head === "#|Program|Price|Plan" && tbl.nums === "r||n|" && tbl.rows === 4 && tbl.first === "1" && tbl.seg === "Table,Chat", JSON.stringify(tbl));
  check("and what each column holds, computed when it was read", /4<\/b>|4 rows/.test(tbl.foot) || /^4 rows · 3 columns/.test(tbl.foot) ? tbl.stats[1] === "Price: total 5,130 · average 1,282.5 · lowest 490 · highest 2,400" && tbl.stats[2] === "Plan: Yes, No" : false, JSON.stringify(tbl));
  check("Replace table is offered, never Contents", tbl.btn === "Replace table/Download/Delete", tbl.btn);
  await page.evaluate(() => { window.__reply = (b, P) => ({ id: "t1", q: b.q, a: "Two programs charge more than 1,200.", proposal: false, quotes: [], used: { file: { name: P.file.name, whole: false, rows: [1, 3], sheet: 0 }, folders: [], memory: 0 } }); });
  await page.fill(".pj-comp textarea", "Which cost more than 1,200?"); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
  const marked = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".pj-grid tr.used")].map(r => r.dataset.n).join(), chip: document.querySelector(".pj-used button")?.textContent }));
  check("the rows an answer used are marked in the grid, and the chip names them", marked.rows === "1,3" && marked.chip === "competitors.xlsx: rows 1, 3", JSON.stringify(marked));
  await page.click(".pj-sheets button >> text=Notes"); await page.waitForTimeout(400);
  check("a second sheet reads from its own first row", (await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/rows").pop()?.body))?.sheet === 1);

  /* a project with no file opens on the drop */
  await page.click("#projects .pj-row >> nth=2"); await page.waitForTimeout(500);
  const empty = await page.evaluate(() => ({ drop: !!document.querySelector(".pj-drop"), h: document.querySelector(".pj-drop h3")?.textContent, hint: document.querySelector(".pj-hint")?.textContent, send: document.querySelector(".pj-send").disabled,
    btn: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/"), ph: document.querySelector(".pj-comp textarea").placeholder, dropText: document.querySelector(".pj-drop p")?.textContent,
    tries: [...document.querySelectorAll(".pj-try button")].map(b => b.textContent) }));
  check("a project with no file shows where to drop one, and the chat is open to a description", empty.drop && /Drop the file or the table/.test(empty.h) && /^Describe what you want/.test(empty.hint) && /^Describe a document, a table or a page/.test(empty.ph) && empty.btn === "Add a file/Delete", JSON.stringify(empty));
  check("the drop names HTML, and says the chat can make the file instead", /HTML/.test(empty.dropText) && /describe what you want in the chat/.test(empty.dropText), empty.dropText);
  check("it offers three things to make, and one built from the biggest folder", empty.tries.length === 4 && /^A table of my monthly expenses/.test(empty.tries[0]) && empty.tries[3] === "A one page summary of my Pricing folder", JSON.stringify(empty.tries));
  await page.fill(".pj-comp textarea", "A one page brief");
  check("a description can be sent, with no file yet", !(await page.evaluate(() => document.querySelector(".pj-send").disabled)));
  await page.fill(".pj-comp textarea", "");

  /* a new project: a name and a file, read here, sent a piece at a time */
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  await fc.setFiles({ name: "offers.csv", mimeType: "text/csv", buffer: Buffer.from("Program,Price\nGame Jam,1200\nIndie Sprint,690\n\n") });
  await page.waitForTimeout(200);
  check("a file chosen names the project, and shows its own name", (await page.inputValue("#npName")) === "offers" && (await page.textContent("#npFile")) === "offers.csv");
  await page.fill("#npName", "Offer list"); await page.click("#npMake"); await page.waitForTimeout(900);
  const up = await page.evaluate(() => window.__calls.filter(x => /api\/project\/(new|begin|part|finish)/.test(x.s)).map(x => ({ s: x.s.split("/").pop(), b: x.body })));
  check("it makes the project, opens a table, sends its rows, and finishes", JSON.stringify(up.map(x => x.s)) === '["new","begin","part","finish"]' && up[0].b.name === "Offer list"
    && up[1].b.kind === "table" && up[1].b.sheets[0].name === "offers" && JSON.stringify(up[1].b.sheets[0].header) === '["Program","Price"]'
    && JSON.stringify(up[2].b.rows) === '[["Game Jam","1200"],["Indie Sprint","690"]]' && up[2].b.sheet === 0 && up[2].b.ver === 1 && up[3].b.ver === 1, JSON.stringify(up));
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fcBig] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  const callsBefore = await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/begin").length);
  await fcBig.setFiles({ name: "huge.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\n" + "0123456789,abcdefghij\n".repeat(300000)) });
  await page.fill("#npName", "Huge table"); await page.click("#npMake"); await page.waitForTimeout(1500);
  const huge = await page.evaluate(() => ({ bad: document.getElementById("npBad").textContent, begins: window.__calls.filter(x => x.s === "/api/project/begin").length }));
  check("a table past what a project reads is refused before its first piece goes", /is bigger than a project reads: about 40,000 rows of 10 columns/.test(huge.bad) && huge.begins === callsBefore, JSON.stringify(huge));
  await page.evaluate(() => document.querySelector(".veil")?.remove());
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  await fc2.setFiles({ name: "brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Goal\n\nFill 200 seats.\n\n[[p. 1]]\nWords") });
  await page.fill("#npName", "Brief"); await page.click("#npMake"); await page.waitForTimeout(800);
  const doc = await page.evaluate(() => window.__calls.filter(x => /api\/project\/(begin|part)/.test(x.s)).slice(-2).map(x => ({ s: x.s.split("/").pop(), b: x.body })));
  check("a Markdown file is a document: its text goes whole, in a piece, from page 0", doc[0].b.kind === "doc" && doc[1].b.text === "# Goal\n\nFill 200 seats.\n\n[[p. 1]]\nWords" && doc[1].b.page === 0, JSON.stringify(doc));
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fc3] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  await fc3.setFiles({ name: "x.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  const newsBefore = await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/new").length);
  await page.click("#npMake"); await page.waitForTimeout(500);
  const zip = await page.evaluate(() => ({ bad: document.getElementById("npBad").textContent, btn: document.getElementById("npMake").textContent,
    made: window.__calls.filter(x => x.s === "/api/project/new").length }));
  check("a file the project cannot read says so, and makes no project", /is a \.zip\. A project reads Word, PDF, text, Markdown, HTML, Excel and CSV files\./.test(zip.bad) && zip.btn === "Create project" && !/was made/.test(zip.bad) && zip.made === newsBefore, JSON.stringify(zip));
  await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector(".veil")?.remove());
  await page.evaluate(() => { window.__partFails = true; });
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fc4] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  await fc4.setFiles({ name: "late.md", mimeType: "text/markdown", buffer: Buffer.from("Some words") });
  await page.click("#npMake"); await page.waitForTimeout(700);
  check("a piece the server cannot store ends the read with the reason, not a silent half file", /unreachable/.test(await page.textContent("#npBad")));
  check("nothing threw in the projects", !bad.length, bad.join(" | "));
  await page.close();

  /* Word's HTML as Markdown, run in the page with the app's own converter */
  const p2 = await hermetic(); const bad2 = [];
  p2.on("pageerror", e => bad2.push(e.message));
  await p2.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" });
  const src = (await readFile(join(APP, "chat.html"), "utf8"));
  const at = src.indexOf("function htmlToMd(html){"); let depth = 0, end = at;
  for (let i = src.indexOf("{", at); i < src.length; i++){ if (src[i] === "{") depth++; if (src[i] === "}" && --depth === 0){ end = i + 1; break; } }
  const md = await p2.evaluate(code => { const f = new Function(code + "; return htmlToMd;")(); return f("<h1>Goal</h1><p>Fill <strong>200</strong> seats, <em>fast</em>.</p><ul><li>One</li><li>Two</li></ul><ol><li>A</li><li>B</li></ol><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Team</td><td>1,490</td></tr></table><h4>Deep</h4><p></p>"); }, src.slice(at, end));
  check("Word's headings, bold, italic, lists and tables come out as Markdown", md === "# Goal\n\nFill **200** seats, *fast*.\n\n- One\n- Two\n\n1. A\n2. B\n\n| Plan | Price |\n| --- | --- |\n| Team | 1,490 |\n\n### Deep", JSON.stringify(md));
  check("nothing threw converting", !bad2.length, bad2.join(" | "));
  await p2.close();
}

/* ---- projects on a phone: two tabs, the drawer closes, nothing leaves the screen ---- */
{
  const DOC = [{ sid: 1, ord: 1, title: "Goal", text: "# Brief\n\nFill 200 seats by 30 November. " + "word ".repeat(80) }];
  const st = { ...STATE, brains: [], concepts: [], projects: [{ slug: "launch-plan", name: "Launch plan", kind: "doc", file: "brief-v3.docx", status: "ready", chars: 900, sections: 1, memory: 0, at: 3 },
    { slug: "newsletter", name: "Newsletter plan", kind: null, file: "", status: "empty", chars: 0, sections: 0, memory: 0, at: 0 }] };
  const projects = { "launch-plan": { project: { slug: "launch-plan", name: "Launch plan", created: "2026-10-08" },
      file: { name: "brief-v3.docx", kind: "doc", sheets: [{ name: "brief-v3.docx", cols: [], rows: 0 }], chars: 900, sections: 1, status: "ready", ver: 1, at: 1 },
      cards: [{ sid: 1, ord: 1, sheet: 0, title: "Goal", summary: "x", chars: 100 }], turns: [{ id: "t1", q: "What is the goal?", a: "Fill **200** seats.", proposal: false, quotes: [], used: { file: { name: "brief-v3.docx", whole: true }, folders: [], memory: 0 } }], edits: [], memory: [] },
    "newsletter": { project: { slug: "newsletter", name: "Newsletter plan", created: "2026-10-08" }, file: null, cards: [], turns: [], edits: [], memory: [] } };
  const page = await hermetic(); const bad = [];
  await page.setViewportSize({ width: 390, height: 844 }); page.on("pageerror", e => bad.push(e.message));
  await page.addInitScript(arg => {
    sessionStorage.setItem("octopus.token.v1", "test"); window.__calls = [];
    window.fetch = async (u, opt) => {
      const path = String(u).replace(/^https?:\/\/[^/]+/, ""), body = JSON.parse(opt?.body || "{}"); window.__calls.push({ s: path, body });
      const J = x => Response.json(x);
      if (path === "/api/state") return J(arg.state);
      if (path === "/api/health") return J({ conflicted: [], health: [] });
      if (path === "/api/project/get") return J(arg.projects[body.brain]);
      if (path === "/api/project/doc") return J({ sections: body.from >= 1 ? [] : arg.doc });
      return J({ chats: [] });
    };
  }, { state: st, projects, doc: DOC });
  await page.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
  await page.click("#burger"); await page.waitForTimeout(300);
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(700);
  const m = await page.evaluate(() => { const seg = [...document.querySelectorAll(".pj-seg button")], doc = document.querySelector(".pj-doc"), chat = document.querySelector(".pj-chat");
    return { drawer: document.getElementById("side").classList.contains("open"), seg: seg.map(b => b.textContent).join(), on: seg.filter(b => b.classList.contains("on")).map(b => b.textContent).join(),
      segH: Math.min(...seg.map(b => b.getBoundingClientRect().height)), docShown: getComputedStyle(doc).display !== "none", chatShown: getComputedStyle(chat).display !== "none",
      wide: document.documentElement.scrollWidth > innerWidth + 1, ta: parseFloat(getComputedStyle(document.querySelector(".pj-comp textarea")).fontSize), turn: document.querySelectorAll(".pj-turn").length,
      send: document.querySelector(".pj-send").getBoundingClientRect().width }; });
  check("on a phone the drawer closes on the project, which opens as two tabs on its chat", !m.drawer && m.seg === "Document,Chat" && m.on === "Chat" && m.chatShown && !m.docShown && m.turn === 1, JSON.stringify(m));
  check("the tabs and the send button are thumb sized, the field never zooms the page, nothing runs off the screen", m.segH >= 44 && m.send >= 40 && m.ta >= 16 && !m.wide, JSON.stringify(m));
  await page.click(".pj-seg button >> text=Document"); await page.waitForTimeout(500);
  const d = await page.evaluate(() => ({ docShown: getComputedStyle(document.querySelector(".pj-doc")).display !== "none", chatShown: getComputedStyle(document.querySelector(".pj-chat")).display !== "none",
    secs: document.querySelectorAll(".pj-sec").length, wide: document.documentElement.scrollWidth > innerWidth + 1, page: document.querySelector(".pj-page").getBoundingClientRect() }));
  check("the Document tab shows the file alone, inside the screen", d.docShown && !d.chatShown && d.secs === 1 && !d.wide && d.page.left >= 0 && d.page.right <= 390, JSON.stringify(d));
  await page.click("#burger"); await page.waitForTimeout(300);
  await page.click("#projects .pj-row >> nth=1"); await page.waitForTimeout(600);
  const e = await page.evaluate(() => ({ on: document.querySelector(".pj-seg .on")?.textContent, drop: !!document.querySelector(".pj-drop"), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  check("a project with no file opens on its Chat tab, where it is described, with the drop on the Document tab", e.on === "Chat" && e.drop && !e.wide, JSON.stringify(e));
  await page.click(".pj-seg button >> text=Document"); await page.waitForTimeout(300);
  check("and the Document tab shows the drop", await page.evaluate(() => getComputedStyle(document.querySelector(".pj-doc")).display !== "none" && !!document.querySelector(".pj-drop")));
  check("nothing threw on the phone", !bad.length, bad.join(" | "));
  await page.close();
}

/* ---- projects: a page, a table or a document made by describing it, and an answer in two parts ---- */
{
  const PAGE = "<!doctype html><html><body><h1>Coaching with Ana</h1><p>Three offers.</p></body></html>";
  const st = { ...STATE, brains: [], concepts: [], projects: [] };
  const init = arg => {
    /* The init script runs in every frame, a page's own sandboxed frame too. */
    if (window.top !== window) return;
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = []; window.__proj = {};
    window.fetch = async (u, opt) => {
      const path = String(u).replace(/^https?:\/\/[^/]+/, ""), body = JSON.parse(opt?.body || "{}");
      window.__calls.push({ s: path, body });
      const J = x => Response.json(x), P = window.__proj[body.brain];
      if (path === "/api/state") return J(arg.state);
      if (path === "/api/health") return J({ conflicted: [], health: [] });
      if (path === "/api/project/list") return J({ projects: arg.state.projects });
      if (path === "/api/project/new") {
        /* An older server ignores what to make and leaves the project with no file. */
        const kind = window.__oldServer ? null : (body.make || null), slug = "made-" + (body.make || "file") + "-" + (window.__n = (window.__n || 0) + 1);
        window.__proj[slug] = { project: { slug, name: body.name, created: "2026-10-09" },
          file: kind ? { name: `${body.name}.${kind === "html" ? "html" : kind === "table" ? "csv" : "md"}`, kind, made: true, sheets: [{ name: kind === "table" ? "Sheet 1" : body.name, header: [], cols: [], rows: 0 }], chars: 0, sections: 0, status: "ready", ver: 1, at: 1 } : null,
          cards: [], turns: [], edits: [], memory: [] };
        arg.state.projects.unshift({ slug, name: body.name, kind, file: window.__proj[slug].file?.name || "", status: kind ? "ready" : "empty", made: !!kind, chars: 0, sections: 0, memory: 0, at: Date.now() });
        return J({ slug });
      }
      if (path === "/api/project/get") return J(P);
      if (path === "/api/project/doc") return J({ sections: P.file?.kind === "doc" && P.file.chars ? [{ sid: 1, ord: 1, sheet: 0, title: "Brief", text: "# Brief\n\nFill 200 seats." }] : [] });
      if (path === "/api/project/delete") { arg.state.projects = arg.state.projects.filter(x => x.slug !== body.brain); delete window.__proj[body.brain]; return J({ ok: true }); }
      if (path === "/api/project/chat" && !P.file) {
        /* No file yet: the first description makes one, from the words and a folder. */
        P.file = { name: `${P.project.name}.md`, kind: "doc", made: true, sheets: [{ name: P.project.name, header: [], cols: [], rows: 0 }], chars: 120, sections: 1, status: "ready", ver: 1, at: 1 };
        P.cards = [{ sid: 1, ord: 1, sheet: 0, title: "Brief", summary: "x", chars: 120 }];
        const t = { id: "t1", q: body.q, lead: "I wrote the brief from your Content folder.", a: "**Content folder:** the goal and the date.", proposal: false, quotes: [],
          used: { file: { name: P.file.name, whole: false }, folders: [{ slug: "content", name: "Content", notes: 2 }], memory: 0 }, intent: "change",
          edit: { id: "e1", status: "applied", preview: [{ label: "New section at the start", before: "", after: "# Brief" }] } };
        P.turns.push(t); P.edits.unshift({ id: "e1", at: Date.now(), status: "applied", preview: t.edit.preview });
        const row = arg.state.projects.find(x => x.slug === body.brain); if (row) Object.assign(row, { kind: "doc", file: P.file.name, status: "ready", made: true, chars: 120, sections: 1 });
        return J({ turn: t });
      }
      if (path === "/api/project/chat") {
        const f = P.file, empty = !f.chars;
        if (empty) { f.chars = 300; f.sections = 1; P.html = arg.page; P.cards = [{ sid: 1, ord: 1, sheet: 0, title: "Page", summary: "x", chars: 300 }]; }
        const t = { id: "t" + (P.turns.length + 1), q: body.q, lead: empty ? "I made the page." : "Four offers now.",
          a: "**Hero:** a title and a promise.\n\n### Next\n- Add a contact form\n  - with a phone field\n\n> Keep it short.", proposal: false, quotes: [],
          used: { file: { name: f.name, whole: true }, folders: [], memory: 0 }, ...(empty ? { noted: ["Page purpose"] } : {}), intent: "change",
          edit: { id: "e" + (P.edits.length + 1), status: "applied", preview: [{ label: "New section at the start", before: "", after: "<!doctype html>" }] } };
        P.turns.push(t); P.edits.unshift({ id: t.edit.id, at: Date.now(), status: "applied", preview: t.edit.preview });
        if (empty) P.memory.unshift({ slug: "page-purpose", title: "Page purpose", position: "A landing page for a coaching business (2026-10-09).", summaryLine: "", updated: "2026-10-09", dates: ["2026-10-09"] });
        return J({ turn: t });
      }
      if (path === "/api/project/edit") { const e = P.edits.find(x => x.id === body.id); e.status = body.action === "undo" ? "undone" : "applied";
        if (body.action === "undo") { P.file.chars = 0; P.file.sections = 0; P.cards = []; P.html = ""; } return J({ ok: true }); }
      if (path === "/api/project/download") return J({ name: P.file.name, kind: P.file.kind, sheet: "", text: P.html || "" });
      if (path === "/api/project/begin") return J({ ver: 1 });
      if (path === "/api/project/part") return J({ sections: 1, chars: 10 });
      if (path === "/api/project/finish") return J({ sections: 1, chars: 10 });
      return J({ chats: [] });
    };
  };
  const { page, bad } = await boot("/chat.html", init, { state: st, page: PAGE });
  await page.waitForTimeout(400);
  await page.click("#newProject"); await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({ makes: [...document.querySelectorAll("[data-make]")].map(b => b.textContent).join(), file: document.getElementById("npFile").textContent }));
  check("a new project can start from nothing: a document, a table or an HTML page", sheet.makes === "Document,Table,HTML page" && /HTML/.test(sheet.file), JSON.stringify(sheet));
  await page.click("[data-make=html]"); await page.waitForTimeout(900);
  const made = await page.evaluate(() => ({ call: window.__calls.find(x => x.s === "/api/project/new")?.body, view: document.querySelector("main").dataset.view, empty: document.querySelector(".pj-empty h3")?.textContent,
    chip: document.querySelector(".pj-chip")?.textContent, acts: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/"), ph: document.querySelector(".pj-comp textarea").placeholder,
    tries: [...document.querySelectorAll(".pj-try button")].map(b => b.textContent), icon: !!document.querySelector("#projects .pj-row path[d^='M9 8l-4']"), sheetGone: !document.querySelector(".veil"),
    hint: document.querySelector(".pj-hint")?.textContent }));
  check("it makes the project with the kind chosen, named for the kind when no name is typed", made.call?.name === "New page" && made.call?.make === "html" && made.view === "project" && made.sheetGone, JSON.stringify(made.call));
  check("the page is empty and says so; there is nothing to download yet", made.empty === "This page is empty" && made.chip === "New page.html" && made.acts === "Replace page/Delete", JSON.stringify(made));
  check("the message bar asks for a description, with examples to start from", /^Describe the page you want/.test(made.ph) && made.tries.length === 2 && /^A landing page/.test(made.tries[0]) && /Describe the page you want/.test(made.hint), JSON.stringify(made.tries));
  check("a page has its own icon in the Projects panel", made.icon);

  await page.click(".pj-try button >> nth=0"); await page.keyboard.press("Enter"); await page.waitForTimeout(900);
  const ans = await page.evaluate(() => { const a = document.querySelector(".pj-a"), h = a.querySelector(".pj-md h4");
    return { tl: a.querySelector(".pj-lead .pj-tl")?.textContent, lead: a.querySelector(".pj-ld")?.textContent, bold: a.querySelector(".pj-md strong")?.textContent, h4: h?.textContent, h4size: h && parseFloat(getComputedStyle(h).fontSize),
      nested: a.querySelector(".pj-md ul ul li")?.textContent, quote: a.querySelector(".pj-md blockquote")?.textContent, chips: [...a.querySelectorAll(".pj-used > *")].map(c => c.textContent),
      edit: a.querySelector(".pj-edit")?.className, ek: a.querySelector(".pj-ek")?.textContent, btns: [...a.querySelectorAll(".pj-edit button")].map(b => b.textContent),
      leadFirst: a.firstElementChild?.classList.contains("pj-lead") }; });
  check("an answer opens with a TL;DR line, then its support", ans.tl === "TL;DR" && ans.lead === "I made the page." && ans.leadFirst && ans.bold === "Hero:", JSON.stringify(ans));
  check("headings in an answer read as small labels, lists nest, quotes stand apart", ans.h4 === "Next" && ans.h4size <= 12 && ans.nested === "with a phone field" && ans.quote === "Keep it short.", JSON.stringify(ans));
  check("it says what the project noted from the message", JSON.stringify(ans.chips) === '["New page.html","Noted: Page purpose"]', JSON.stringify(ans.chips));
  await page.waitForTimeout(300);
  const mem = await page.evaluate(() => ({ badge: document.querySelector(".pj-tab i")?.textContent, listed: window.__calls.filter(x => x.s === "/api/project/list").length }));
  check("the Memory tab counts what was noted, and the Projects panel is read again", mem.badge === "1" && mem.listed >= 1, JSON.stringify(mem));
  check("a change made at once shows as applied, with an Undo", /applied/.test(ans.edit) && ans.ek === "Applied" && JSON.stringify(ans.btns) === '["Undo"]', JSON.stringify(ans));

  const web = await page.evaluate(() => { const f = document.querySelector(".pj-frame"); return { sandbox: f?.getAttribute("sandbox"), src: f?.srcdoc, code: document.querySelector(".pj-code")?.hidden,
    acts: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/"), empty: !!document.querySelector(".pj-empty") }; });
  check("the page shows as it renders, in a frame that can reach nothing of the app", web.src === PAGE && web.sandbox === "allow-scripts allow-popups" && !/same-origin/.test(web.sandbox) && web.code === true && !web.empty, JSON.stringify(web));
  check("the head offers Page and Code, and Download now", web.acts === "Page/Code/Replace page/Download/Delete", web.acts);
  await page.click(".pj-view button >> text=Code"); await page.waitForTimeout(150);
  const code = await page.evaluate(() => ({ text: document.querySelector(".pj-code").textContent, hidden: document.querySelector(".pj-code").hidden, frame: document.querySelector(".pj-frame").hidden, on: document.querySelector(".pj-view .on")?.textContent }));
  check("Code shows the page's words as they are written", code.text === PAGE && !code.hidden && code.frame && code.on === "Code", JSON.stringify(code));
  await page.click(".pj-view button >> text=Page"); await page.waitForTimeout(100);
  check("and Page brings the rendering back", await page.evaluate(() => document.querySelector(".pj-code").hidden && !document.querySelector(".pj-frame").hidden));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".pj-b >> text=Download")]);
  check("a page downloads as an HTML file", dl.suggestedFilename() === "New page.html", dl.suggestedFilename());

  await page.click(".pj-edit button >> text=Undo"); await page.waitForTimeout(900);
  const undone = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/edit").pop()?.body, empty: document.querySelector(".pj-empty h3")?.textContent, frame: !!document.querySelector(".pj-frame"), ek: document.querySelector(".pj-ek")?.textContent }));
  check("Undo empties the page again, and the file pane follows", undone.call?.action === "undo" && undone.empty === "This page is empty" && !undone.frame && undone.ek === "Undone", JSON.stringify(undone));

  /* a table and a document, from nothing */
  await page.click("#newProject"); await page.waitForTimeout(200);
  await page.fill("#npName", "Spending"); await page.click("[data-make=table]"); await page.waitForTimeout(800);
  const tbl = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/new").pop()?.body, empty: document.querySelector(".pj-empty h3")?.textContent, ph: document.querySelector(".pj-comp textarea").placeholder,
    seg: document.querySelector(".pj-seg button")?.textContent, tries: document.querySelector(".pj-try button")?.textContent }));
  check("a table can be made from nothing under the name typed", tbl.call?.name === "Spending" && tbl.call?.make === "table" && tbl.empty === "This table is empty" && /^Describe the table you want/.test(tbl.ph) && /^A table of my monthly expenses/.test(tbl.tries) && tbl.seg === "Table", JSON.stringify(tbl));
  await page.click("#newProject"); await page.waitForTimeout(200);
  await page.click("[data-make=doc]"); await page.waitForTimeout(800);
  const dc = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/new").pop()?.body, empty: document.querySelector(".pj-empty h3")?.textContent, chip: document.querySelector(".pj-chip")?.textContent }));
  check("and a document", dc.call?.make === "doc" && dc.call?.name === "New document" && dc.empty === "This document is empty" && dc.chip === "New document.md", JSON.stringify(dc));

  /* the same name twice: the second takes a number */
  await page.click("#newProject"); await page.waitForTimeout(200);
  await page.click("[data-make=table]"); await page.waitForTimeout(700);
  await page.click("#newProject"); await page.waitForTimeout(200);
  await page.click("[data-make=table]"); await page.waitForTimeout(700);
  const names = await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/new" && x.body.make === "table").map(x => x.body.name));
  check("a name left empty is New table, then New table 2, so a second one is never refused", names.slice(-2).join("|") === "New table|New table 2", JSON.stringify(names));

  /* a project made with nothing chosen: the chat makes the file from what is said */
  await page.click("#newProject"); await page.waitForTimeout(200);
  await page.click("#npMake"); await page.waitForTimeout(800);
  const bare = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/new").pop()?.body, drop: !!document.querySelector(".pj-drop"), ph: document.querySelector(".pj-comp textarea").placeholder,
    hint: document.querySelector(".pj-hint")?.textContent, view: document.querySelector("main").dataset.view, seg: document.querySelector(".pj-seg button")?.textContent }));
  check("Create project with nothing chosen makes a project named New project, with no file, and opens its chat", bare.call?.name === "New project" && bare.call?.make === undefined && bare.drop && /^Describe a document, a table or a page/.test(bare.ph) && /^Describe what you want/.test(bare.hint) && bare.view === "project", JSON.stringify(bare));
  await page.fill(".pj-comp textarea", "A one page brief for my launch, from my Content folder"); await page.keyboard.press("Enter"); await page.waitForTimeout(900);
  const said = await page.evaluate(() => ({ call: window.__calls.filter(x => x.s === "/api/project/chat").pop()?.body, drop: !!document.querySelector(".pj-drop"), chip: document.querySelector(".pj-chip")?.textContent,
    acts: [...document.querySelectorAll(".pj-acts button")].map(b => b.textContent).join("/"), page: !!document.querySelector(".pj-paper .pj-page"), seg: document.querySelector(".pj-seg button")?.textContent,
    ph: document.querySelector(".pj-comp textarea").placeholder, lead: document.querySelector(".pj-ld")?.textContent, chips: [...document.querySelectorAll(".pj-used > *")].map(c => c.textContent),
    row: document.querySelector("#projects .pj-row.on")?.title }));
  check("what is said makes the file: the drop gives way to the document, with its name, its buttons and its tab", !said.drop && said.page && said.chip === "New project.md" && said.acts === "Replace file/Download/Delete" && said.seg === "Document", JSON.stringify(said));
  check("the message bar then asks about the document, the answer names the folder it used, and the list knows the file", /^Ask about the document/.test(said.ph) && said.lead === "I wrote the brief from your Content folder." && said.chips.includes("Content folder · 2 notes") && /New project\.md/.test(said.row), JSON.stringify(said));

  /* a server older than this page: nothing is left behind, and the sheet says what to do */
  await page.evaluate(() => { window.__oldServer = true; });
  await page.click("#newProject"); await page.waitForTimeout(200);
  const newsBefore = await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/new").length);
  await page.click("[data-make=table]"); await page.waitForTimeout(700);
  const old = await page.evaluate(() => ({ bad: document.getElementById("npBad").textContent, sheet: !!document.querySelector(".veil"), btn: document.getElementById("npMake").disabled,
    made: window.__calls.filter(x => x.s === "/api/project/new").pop()?.body, del: window.__calls.filter(x => x.s === "/api/project/delete").pop()?.body }));
  check("an older server leaves a project with no file: the sheet says so, deletes it, and stays open", /The server is older than this page/.test(old.bad) && /convex deploy/.test(old.bad) && old.sheet && !old.btn && old.made?.make === "table" && /^made-table-/.test(old.del?.brain), JSON.stringify(old));
  check("and the list holds no half made project", await page.evaluate(() => ![...document.querySelectorAll("#projects .pj-row .nm")].some(n => n.textContent === "New table 3")));
  await page.evaluate(() => { window.__oldServer = false; document.querySelector(".veil")?.remove(); });

  /* an HTML file chosen is a page, kept as it is */
  await page.click("#newProject"); await page.waitForTimeout(200);
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#npPick")]);
  await fc.setFiles({ name: "site.html", mimeType: "text/html", buffer: Buffer.from("<!doctype html>\n<html><body><p>Hello</p></body></html>") });
  await page.fill("#npName", "Site"); await page.click("#npMake"); await page.waitForTimeout(900);
  const up = await page.evaluate(() => window.__calls.filter(x => /api\/project\/(begin|part)/.test(x.s)).slice(-2).map(x => ({ s: x.s.split("/").pop(), b: x.body })));
  check("an HTML file is a page: its code goes whole, as written", up[0].s === "begin" && up[0].b.kind === "html" && up[1].b.text === "<!doctype html>\n<html><body><p>Hello</p></body></html>", JSON.stringify(up));
  check("nothing threw making files", !bad.length, bad.join(" | "));

  /* the text view and the converter, run in the page */
  const srcApp = await readFile(join(APP, "chat.html"), "utf8");
  const grab = name => { const at = srcApp.indexOf(`function ${name}(`); let depth = 0, end = at; for (let i = srcApp.indexOf("{", at); i < srcApp.length; i++){ if (srcApp[i] === "{") depth++; if (srcApp[i] === "}" && --depth === 0){ end = i + 1; break; } } return srcApp.slice(at, end); };
  const conv = `const esc = s => String(s??"").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));` + grab("mdView") + grab("htmlToMd") + "; return { mdView, htmlToMd };";
  const md = await page.evaluate(code => { const { mdView, htmlToMd } = new Function(code)(); return ({
    nested: mdView("- a\n  - b\n- c"), ol: mdView("3. x\n4. y"), code: mdView("```\n<b>x</b>\n```"), quote: mdView("> hi\n> there"), hr: mdView("one\n\n---\n\ntwo"),
    link: mdView("[a](https://x.com/?a=1&b=2) and [bad](javascript:alert(1))"),
    web: htmlToMd('<html><head><title>My Page</title><style>p{color:red}</style><script>alert(1)</script></head><body><nav><a href="/">Home</a></nav><main><div>Loose words <b>bold</b> here</div><p>Para <a href="https://x.com">link</a></p><ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><pre>a  b\n c</pre><blockquote><p>Quoted</p></blockquote><table><tr><td>Only</td></tr></table></main><footer>Footer</footer></body></html>'),
    grid: htmlToMd("<h2>Plans</h2><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Team</td><td>1,490</td></tr></table><div>after</div>"),
  }); }, conv);
  check("lists nest, a list can start at its own number", md.nested === "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>" && md.ol === '<ol start="3"><li>x</li><li>y</li></ol>', JSON.stringify(md));
  check("code is shown as written, never run; quotes and rules are marked", md.code === "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>" && md.quote === "<blockquote><p>hi there</p></blockquote>" && md.hr === "<p>one</p><hr><p>two</p>", JSON.stringify(md));
  check("a link opens in its own tab when it is a web address, and is only words otherwise", /<a href="https:\/\/x\.com\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">a<\/a>/.test(md.link) && !/href="javascript/.test(md.link) && /\[bad\]\(javascript:alert\(1\)\)/.test(md.link), md.link);
  check("a web page comes out as its words: the title, loose text, links, nested lists, code and quotes; no script, style, menu or footer",
    md.web === "# My Page\n\nLoose words **bold** here\n\nPara [link](https://x.com)\n\n- One\n  - Nested\n- Two\n\n```\na  b\n c\n```\n\n> Quoted\n\nOnly", JSON.stringify(md.web));
  check("a table with columns keeps them, and the text after it still comes", md.grid === "## Plans\n\n| Plan | Price |\n| --- | --- |\n| Team | 1,490 |\n\nafter", JSON.stringify(md.grid));
  await page.close();

  /* Drop reads a saved web page for its words */
  const dp = await hermetic(); const bad3 = [];
  dp.on("pageerror", e => bad3.push(e.message));
  await dp.addInitScript(state => { sessionStorage.setItem("octopus.token.v1", "test"); window.fetch = async u => String(u).includes("/api/state") ? Response.json(state) : Response.json({ chats: [] }); }, STATE);
  await dp.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" }); await dp.waitForTimeout(500);
  await dp.click("#dropBtn"); await dp.waitForTimeout(200);
  check("Drop offers web pages among the files it reads", /\.html/.test(await dp.getAttribute("#fileIn", "accept")) && /web page/.test(await dp.getAttribute("#fileBtn", "title")));
  await dp.setInputFiles("#fileIn", { name: "post.html", mimeType: "text/html", buffer: Buffer.from("<html><head><title>On pricing</title><style>x{}</style></head><body><nav>Menu</nav><article><h2>Why 1,490</h2><p>Team costs <b>1,490</b> a seat.</p></article></body></html>") });
  await dp.waitForTimeout(500);
  const got = await dp.evaluate(() => ({ text: document.getElementById("input").value, src: document.getElementById("srcInput").value }));
  check("a saved web page is read for its words, not its tags, named by its title, and names the source", got.text === "# On pricing\n\n## Why 1,490\n\nTeam costs **1,490** a seat." && got.src === "post.html", JSON.stringify(got));
  check("nothing threw reading it", !bad3.length, bad3.join(" | "));
  await dp.close();
}

/* ---- projects: memory as a shortcut into a long file ---- */
{
  const SECS = Array.from({ length: 30 }, (_, i) => ({ sid: i + 1, ord: i + 1, sheet: 0, title: `Clause ${i + 1} ${["payment", "audit", "privacy"][i % 3]}`, summary: "x", chars: 3000 }));
  const st = { ...STATE, brains: [], concepts: [], projects: [{ slug: "contract", name: "Contract", kind: "doc", file: "contract.pdf", status: "ready", chars: 90000, sections: 30, memory: 0, at: 1 }] };
  const init = arg => {
    if (window.top !== window) return;
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__calls = []; window.__ways = []; window.__n = 0;
    window.fetch = async (u, opt) => {
      const path = String(u).replace(/^https?:\/\/[^/]+/, ""), body = JSON.parse(opt?.body || "{}");
      window.__calls.push({ s: path, body });
      const J = x => Response.json(x);
      if (path === "/api/state") return J(arg.state);
      if (path === "/api/health") return J({ conflicted: [], health: [] });
      if (path === "/api/project/list") return J({ projects: arg.state.projects });
      if (path === "/api/project/get") return J({ project: { slug: "contract", name: "Contract", created: "2026-10-09" }, file: { name: "contract.pdf", kind: "doc", sheets: [{ name: "contract.pdf", cols: [], rows: 0 }], chars: 90000, sections: 30, status: "ready", ver: 1, at: 1 },
        cards: arg.secs, turns: [], edits: [], memory: [], shortcuts: window.__ways });
      if (path === "/api/project/doc") return J({ sections: [] });
      if (path === "/api/project/chat") {
        const via = window.__n++ > 0;
        const t = { id: "t" + window.__n, q: body.q, lead: "Payments are monthly.", a: "**Clause 1:** the 10th of each month.", proposal: false, quotes: [],
          used: { file: { name: "contract.pdf", whole: false, sections: [{ sid: 1, title: "Clause 1 payment" }, { sid: 4, title: "Clause 4 payment" }], of: 30, ...(via ? { via: "memory" } : {}) }, folders: [], memory: 0 }, intent: "ask" };
        window.__ways = [{ t: ["payment", "tim"], s: [1, 4], n: window.__n, at: Date.now(), q: body.q }];
        return J({ turn: t });
      }
      return J({ chats: [] });
    };
  };
  const { page, bad } = await boot("/chat.html", init, { state: st, secs: SECS });
  await page.click("#projects .pj-row >> nth=0"); await page.waitForTimeout(600);
  await page.click(".pj-tab >> text=Memory"); await page.waitForTimeout(300);
  check("with nothing kept and nothing learned, the Memory tab says what it will keep, and that it learns where things are", /Nothing kept yet/.test(await page.textContent(".pj-hint")) && /learns where things are in a long file/.test(await page.textContent(".pj-hint")));
  await page.click(".pj-tab >> text=Chat"); await page.waitForTimeout(200);
  await page.fill(".pj-comp textarea", "When are the payments made?"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const first = await page.evaluate(() => [...document.querySelectorAll(".pj-used > *")].map(c => c.textContent));
  check("an answer says how little of a long file it read", JSON.stringify(first) === '["contract.pdf: Clause 1 payment · Clause 4 payment","Read 2 of 30 sections"]', JSON.stringify(first));
  const gets = await page.evaluate(() => window.__calls.filter(x => x.s === "/api/project/get").length);
  await page.click(".pj-tab >> text=Memory"); await page.waitForTimeout(400);
  const mem = await page.evaluate(() => ({ hint: [...document.querySelectorAll(".pj-hint")].map(x => x.textContent), rows: [...document.querySelectorAll(".pj-mem")].map(r => [r.querySelector("b").textContent, r.querySelector("p").textContent, r.querySelector("small").textContent]),
    forget: document.querySelectorAll(".pj-mem .pj-b").length, gets: window.__calls.filter(x => x.s === "/api/project/get").length }));
  check("opening the Memory tab reads what the project learned since", mem.gets === gets + 1, JSON.stringify(mem));
  check("it lists where things are: the question that taught it, the sections, how often", mem.rows.length === 1 && mem.rows[0][0] === "“When are the payments made?”" && mem.rows[0][1] === "Clause 1 payment, Clause 4 payment" && mem.rows[0][2] === "Used 1 time" && /Where things are/.test(mem.hint.join(" ")), JSON.stringify(mem));
  check("a route is a pointer: it has no Forget, it mends itself", mem.forget === 0);
  await page.click(".pj-tab >> text=Chat"); await page.waitForTimeout(200);
  await page.fill(".pj-comp textarea", "What do the payments look like?"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const second = await page.evaluate(() => [...document.querySelectorAll(".pj-turn")].pop().querySelector(".pj-used")?.textContent);
  check("when memory led, the answer says so", /Read 2 of 30 sections · led by memory/.test(second), second);
  check("nothing threw", !bad.length, bad.join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nthe pages run");
process.exit(failures ? 1 : 0);
