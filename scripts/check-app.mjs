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
      if (s.includes("/api/ask")) {
        await new Promise(ok => setTimeout(ok, 600));
        return Response.json({ answer: "One line.", sources: 3, level: "normal" });
      }
      if (s.includes("/api/onepager")) {
        const body = JSON.parse(opt?.body || "{}");
        window.__pager.push(body);
        const page = { title: "Octopus", line: "1 brain, 2 positions.",
          sections: [{ head: "", bullets: ["Offer first. (2026-01-02)", "Face beats logo. (2026-02-02)"] }],
          foot: "2 of 2 positions \u00b7 3 sources read \u00b7 2026-09-26" };
        if (body.mail === "refused@example.com")
          return Response.json({ page, text: "x", sent: false, to: body.mail, mailError: "domain is not verified" });
        if (body.mail) return Response.json({ page, text: "x", sent: true, to: body.mail, id: "e1" });
      }
      if (s.includes("/api/onepager")) return Response.json({
        page: { title: "Octopus", line: "1 brain, 2 positions.",
                sections: [{ head: "", bullets: ["Offer first. (2026-01-02)", "Face beats logo. (2026-02-02)"] }],
                foot: "2 of 2 positions \u00b7 3 sources read \u00b7 2026-09-26" },
        text: "Octopus\n\n- Offer first.\n- Face beats logo.",
      });
      return Response.json({ gates: {} });
    };
  }, STATE);
  check("the app boots with nothing thrown", !bad.length, bad.join("\n       "));

  await page.click('#mode button[data-m="drop"]');
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
      acts: [...c.querySelectorAll(".acts button")].map(b => b.textContent),
      field: !!c.querySelector(".acts input"),
      gone: !document.querySelector(".veil"),
    };
  });
  check("a page lands in the thread", !!card, "no card");
  if (card) {
    check("titled by what it was built from", card.title === "Octopus", card.title);
    check("carrying its bullets", card.bullets.length === 2, card.bullets.join(" | "));
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

  /* ---- the loader is the space's own mark ---- */
  await page.fill("#input", "anything");
  await page.click("#send"); await page.waitForTimeout(150);
  const loader = await page.evaluate(() => {
    const m = document.querySelector(".thinking .spinner");
    return m ? { bg: getComputedStyle(m).backgroundImage, anim: getComputedStyle(m).animationName } : null;
  });
  check("a question shows the turning mark while it waits", !!loader, "no .spinner");
  if (loader) {
    check("and it is this space's mark", /logo-mark\.png/.test(loader.bg), loader.bg);
    check("turning", loader.anim === "turn", loader.anim);
  }
  await page.waitForTimeout(700);
  check("and it goes when the answer lands", await page.$(".thinking .spinner") === null);
  await page.close();
}

/* ---- a plan that files less than the source holds ---- */
{
  const { page, bad } = await boot("/chat.html", state => {
    sessionStorage.setItem("octopus.token.v1", "test");
    window.__plans = [];
    const topics = ["Accruals", "Depreciation", "Deferred revenue", "Matching", "Reconciliation"]
      .map(t => ({ topic: t, ideas: [t + " works like this."], data: [] }));
    window.fetch = async (u, opt) => {
      const s = String(u), body = JSON.parse(opt?.body || "{}");
      if (s.includes("/api/state")) return Response.json(state);
      if (s.includes("/api/drop/check")) return Response.json({ duplicate: false, sid: "s-acc" });
      if (s.includes("/api/drop/read")) return Response.json({ part: { title: "Accounting basics", author: "A", date: "2026-09-01", topics } });
      if (s.includes("/api/drop/plan")) {
        window.__plans.push(body);
        const n = body.thorough ? 5 : 1;
        return Response.json({ plan: { brains: ["content"], matched: [], new: ["x"], echo: [], conflicts: [],
          candidates: topics.slice(0, n).map(t => ({ title: t.topic, brain: "content", why: "taught here" })) } });
      }
      return Response.json({});
    };
  }, STATE);
  await page.click('#mode button[data-m="drop"]');
  await page.fill("#srcInput", "Accounting basics.pdf");
  await page.fill("#input", "Accruals, depreciation, deferred revenue, matching and reconciliation, each explained.");
  await page.click("#send"); await page.waitForTimeout(500);
  const note = await page.evaluate(() => document.querySelector(".coverage")?.textContent || "");
  check("a plan filing 1 of 5 topics says so", /Filed 1 of 5 topics/.test(note), note);
  check("and offers to file every topic", /File every topic/.test(note), note);
  await page.click(".coverage button"); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    note: document.querySelector(".coverage")?.textContent || "",
    last: window.__plans[window.__plans.length - 1] }));
  check("the second plan asks for the thorough pass", after.last?.thorough === true, JSON.stringify(after.last?.thorough));
  check("and reuses the same reading", after.last?.ext?.topics?.length === 5);
  check("a plan filing every topic shows no warning", after.note === "", after.note);
  check("nothing threw on the way", !bad.length, bad.join(" | "));
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
  check("a door with no passphrase says the first one sets it", /first one typed/.test(doors.unset), doors.unset);
  check("a door with one says nothing", doors.set === "", `"${doors.set}"`);
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nthe pages run");
process.exit(failures ? 1 : 0);
