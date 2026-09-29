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
        if (body.kind === "custom" && body.doc === "deepdive") return Response.json({ text: "x", page: { title: "Deep dive: Content", line: "From Content.",
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
  check("a brain row shows its concept count alone", /^\d+$/.test(simple.count || ""), simple.count);

  await page.click('#mode button[data-m="drop"]');
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

  await page.click('#mode button[data-m="ask"]');
  const asking = await page.evaluate(() => ({
    src: document.getElementById("srcLine").hidden,
    file: document.getElementById("fileBtn").hidden,
  }));
  check("asking hides the source line and the document button", asking.src && asking.file);

  /* ---- the brain picker ---- */
  const face = await page.evaluate(() => document.getElementById("scopeBtn").textContent.replace(/\s+/g, " ").trim());
  check("the picker says where a question goes", /Across All brains/.test(face), face);
  await page.click("#scopeBtn");
  const menu = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".pick-menu .pk-row .pk-nm")].map(x => x.firstChild.textContent),
    heads: [...document.querySelectorAll(".pick-menu .pk-h")].map(x => x.textContent),
  }));
  check("its menu offers every brain, grouped", menu.rows.join(",") === "All brains,Content" && menu.heads.join(",") === "Subjects",
    JSON.stringify(menu));
  await page.click(".pick-menu .pk-row >> nth=1");
  const picked = await page.evaluate(() => ({ val: document.getElementById("scopeVal").textContent, open: !!document.querySelector(".pick-menu") }));
  check("picking a brain names it and closes the menu", picked.val === "Content" && !picked.open, JSON.stringify(picked));
  await page.click("#scopeBtn"); await page.keyboard.press("Escape");
  check("Escape closes the menu", !(await page.$(".pick-menu")));
  await page.click("#scopeBtn"); await page.click(".pick-menu .pk-row >> nth=0");
  check("the one-pager sits in the side panel, above Create a brain",
    await page.evaluate(() => { const p = document.getElementById("pagerBtn");
      return !!p.closest("aside") && p.nextElementSibling === document.getElementById("newBrain"); }));

  /* ---- a new brain asks for a name, a scope and a kind, nothing more ---- */
  await page.click("#newBrain"); await page.waitForTimeout(80);
  const sheetText = await page.evaluate(() => document.querySelector(".sheet")?.textContent || "");
  check("creating a brain no longer asks who can feed it", /Scope/.test(sheetText) && !/Who can feed/.test(sheetText), sheetText.slice(0, 120));
  await page.click("#bCancel");

  /* ---- the one-pager ---- */
  await page.click("#pagerBtn");
  await page.waitForTimeout(120);
  const sheet = await page.evaluate(() => ({
    picks: [...document.querySelectorAll("#pPick option")].map(o => o.value),
    on: document.getElementById("pPick")?.value,
  }));
  check("the sheet offers everything, the group, and each brain by name",
    sheet.picks.join(",") === "all,subject,content", sheet.picks.join(","));
  check("and starts on everything when no brain is picked", sheet.on === "all", String(sheet.on));

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
    return c ? { said: c.querySelector(".said")?.textContent || "", btn: [...c.querySelectorAll(".acts button")].pop()?.textContent,
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
  check("the card says it was sent", sent && sent.said === "Sent to me@example.com.", sent && sent.said);
  check("and does not offer to send it again", sent && sent.btn === "Sent", sent && sent.btn);

  await page.click("#pagerBtn"); await page.waitForTimeout(100);
  check("the next dialog remembers the address", (await page.inputValue("#pTo")) === "me@example.com",
    await page.inputValue("#pTo"));
  await page.fill("#pTo", "refused@example.com");
  await page.click("#pGo"); await page.waitForTimeout(300);
  const refused = await lastCard();
  check("a refused send still shows the page, with the reason",
    refused && /Not sent: domain is not verified/.test(refused.said), refused && refused.said);
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

  /* ---- the loader is the space's own mark ---- */
  await page.fill("#input", "anything");
  await page.click("#send"); await page.waitForTimeout(150);
  const loader = await page.evaluate(() => {
    const m = document.querySelector(".thinking .spinner");
    return m ? { bg: getComputedStyle(m).backgroundImage, anim: getComputedStyle(m).animationName,
                 line: document.querySelector(".thinking span:last-child")?.textContent } : null;
  });
  check("a question shows the turning mark while it waits", !!loader, "no .spinner");
  check("with Octopus's first waiting line and the step it stands for",
    loader?.line === "Octopus is reaching into every brain... (searching)", loader?.line);
  if (loader) {
    check("and it is this space's mark", /logo-mark\.png/.test(loader.bg), loader.bg);
    check("turning", loader.anim === "turn", loader.anim);
  }
  await page.waitForTimeout(700);
  check("and it goes when the answer lands", await page.$(".thinking .spinner") === null);

  /* ---- the export reads whole concepts only when asked ---- */
  const side = await page.evaluate(() => ({ gone: !document.getElementById("exportBtn") && !document.getElementById("stat"),
    foot: [...document.querySelectorAll(".side-foot button")].map(b => b.textContent.trim()).join(",") }));
  check("the sidebar keeps Setup and Sign out only", side.gone && side.foot === "Setup,Sign out", side.foot);
  await page.click("#burger").catch(() => {});
  await page.evaluate(() => document.getElementById("keyBtn").click());
  await page.waitForTimeout(150);
  const setup = await page.evaluate(() => ({ model: document.querySelector("#setModel .val")?.textContent,
    exp: !!document.getElementById("setExport"), order: [...document.querySelectorAll(".sheet .set-row button")].map(b => b.id).join(",") }));
  check("Setup holds the model, then the export", setup.order === "setModel,setExport" && setup.model === "model", JSON.stringify(setup));
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
  await page.click(".brain-row .ed >> text=open");
  await page.waitForTimeout(120);
  const vw = await page.evaluate(() => ({ title: document.querySelector(".viewer h3")?.textContent,
    rows: document.querySelectorAll(".viewer .vw-row").length, count: document.querySelector(".viewer .vw-count")?.textContent }));
  check("open shows the brain with its concepts listed", vw.title === "Content" && /concept/.test(vw.count || ""), JSON.stringify(vw));
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
  await page.click(".brain-row .ed >> text=open");
  await page.waitForTimeout(100);
  const list = await page.evaluate(() => [...document.querySelectorAll(".viewer .vw-row b")].map(b => b.textContent));
  check("the viewer lists each concept by name", list.join(",") === "Offer first", list.join(","));
  await page.fill(".viewer .vw-filter", "zzz");
  check("its filter narrows the list", (await page.$$(".viewer .vw-row")).length === 0);
  await page.fill(".viewer .vw-filter", "");
  await page.click(".viewer .vw-row");
  await page.waitForTimeout(150);
  const one = await page.evaluate(() => ({ title: document.querySelector(".viewer h3")?.textContent,
    text: document.querySelector(".viewer .vw-body")?.textContent || "", links: document.querySelectorAll(".viewer .vw-link").length }));
  check("a concept opens with its position, evidence and figures",
    one.title === "Offer first" && /bigger audience/.test(one.text) && /sold out twice/.test(one.text) && /31 percent/.test(one.text), one.text.slice(0, 160));
  check("and its links, each one clickable", one.links === 1);
  await page.click(".viewer .vw-back");
  check("back returns to the list", !!(await page.$(".viewer .vw-row")));
  await page.keyboard.press("Escape");
  check("Escape closes the viewer", !(await page.$(".viewer")));
  check("nothing threw in the viewer", !bad.length, bad.join(" | "));
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
  await page.click('#mode button[data-m="drop"]');
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
    window.__plans = []; window.__settles = []; window.__live = 0; window.__peak = 0; window.__failOnce = true;
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
        /* The fourth batch fails once, the way a timeout would. */
        if (window.__failOnce && body.plan.candidates[0]?.title === "Rule 25") {
          window.__failOnce = false;
          return Response.json({ error: "was still writing after 150 seconds" });
        }
        window.__settles.push(body.plan.candidates.map(c => c.title));
        return Response.json({ sid: "s-long", brains: ["content"], positions: body.plan.candidates.length, counted: [],
          written: body.plan.candidates.map(c => `content/${c.title.toLowerCase().replace(/\W+/g, "-")}`),
          counts: { new: 1, echo: 0 } });
      }
      return Response.json({});
    };
  }, STATE);
  await page.click('#mode button[data-m="drop"]');
  await page.fill("#srcInput", "Long manual.pdf");
  await page.fill("#input", "Sixty rules, each explained.");
  await page.click("#send"); await page.waitForTimeout(700);
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
  check("a failed batch says how much is already stored", /Part of it is stored/.test(first.msg) && /of 8 parts are stored/.test(first.msg), first.msg.slice(0, 120));
  check("never more than 3 calls at once", first.peak <= 3 && first.peak >= 2, String(first.peak));

  await page.click(".card-foot .go"); await page.waitForTimeout(900);
  const done = await page.evaluate(() => {
    const all = window.__settles.flat();
    return { total: all.length, unique: new Set(all).size, receipt: document.querySelector(".receipt")?.textContent || "" };
  });
  check("Store it again finishes the rest", done.total === 60, String(done.total));
  check("and repeats no batch already stored", done.unique === 60, `${done.unique} unique of ${done.total}`);
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
  await page.click('#mode button[data-m="drop"]');
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
  await page.click('#mode button[data-m="drop"]');
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
  await page.click('#mode button[data-m="drop"]');
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
  await page.click('#mode button[data-m="drop"]');
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
  await page.click('#mode button[data-m="drop"]');
  await page.click("#scopeBtn");
  const first = await page.evaluate(() => [...document.querySelectorAll(".pick-menu .pk-box")].length);
  check("dropping, each brain can be ticked", first === 3, String(first));
  await page.click('.pick-menu .pk-row:has-text("Wealth")');
  await page.click('.pick-menu .pk-row:has-text("Charles Gave")');
  const face = await page.evaluate(() => ({ val: document.getElementById("scopeVal").textContent,
    open: !!document.querySelector(".pick-menu"), done: document.querySelector(".pick-menu .pk-done")?.textContent }));
  check("two ticked brains show on the picker, and the menu stays open", /^(Wealth|Charles Gave) \+1$/.test(face.val) && face.open, JSON.stringify(face));
  check("its button says how many will be fed", face.done === "Feed 2 brains", face.done);
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
  await page.click('#mode button[data-m="ask"]');
  const askFace = await page.evaluate(() => document.getElementById("scopeVal").textContent);
  check("asking reads one brain or all of them", askFace === "All brains", askFace);
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
  }, STATE);
  await page.goto(ORIGIN + "/chat.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.click('#mode button[data-m="drop"]');
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

  await page.click("#burger"); await page.waitForTimeout(300);
  const open = await page.evaluate(() => document.getElementById("side").classList.contains("open"));
  await page.mouse.click(370, 400); await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.getElementById("side").classList.contains("open"));
  check("the drawer opens, and a tap beside it closes it", open && closed);
  check("and nothing threw on a phone", !bad.length, bad.join(" | "));
  await ctx.close();
}

/* ---- the app with no session goes back to the door ---- */
{
  const page = await hermetic();
  const bad = [];
  page.on("pageerror", e => bad.push(e.message));
  await page.addInitScript(() => {
    window.fetch = async () => Response.json({ gates: { octopus: true, squidgy: true } });
  });
  /* The page redirects while it is still loading, which supersedes the
     navigation, so this waits for where it lands rather than for this one to
     settle. */
  await page.goto(ORIGIN + "/chat.html", { waitUntil: "commit" });
  let landed = "";
  try {
    await page.waitForURL(u => new URL(u).pathname === "/", { timeout: 8000 });
    landed = page.url();
  } catch { landed = page.url(); }
  check("a tab with no session lands on the door", new URL(landed).pathname === "/", landed);
  check("and nothing threw on the way", !bad.length, bad.join("\n       "));
  await page.close();
}

/* ---- both doors ---- */
{
  const { page, bad } = await boot("/", () => {
    window.fetch = async u => String(u).includes("/api/status")
      ? Response.json({ gates: { octopus: true, squidgy: false } })
      : Response.json({ brains: [], concepts: [] });
  });
  check("the door boots with nothing thrown", !bad.length, bad.join("\n       "));
  const doors = await page.evaluate(() => ({
    both: !document.getElementById("dOctopus").hidden && !document.getElementById("dSquidgy").hidden,
    unset: document.getElementById("msgSquidgy").textContent,
    set: document.getElementById("msgOctopus").textContent,
  }));
  check("both doors show on the landing", doors.both);
  check("a door with no passphrase says it is shut", /Shut until its owner/.test(doors.unset), doors.unset);
  check("a door with one says nothing", doors.set === "", `"${doors.set}"`);
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nthe pages run");
process.exit(failures ? 1 : 0);
