/**
 * A PDF's layout, read back from where each piece of text stands.
 *
 * pdf.js gives a page as pieces of text with a place and a size, in the order
 * the file wrote them. A table comes out cell by cell, a two column page line
 * by line across both columns, a footer inside the body. pdfMarkdown puts the
 * pieces back: headings by size, tables from cells that line up, lists from
 * markers and indents, paragraphs from lines that wrap, columns one after the
 * other, running headers and footers left out.
 *
 * The three fixtures are what pdf.js reported for three pages made in a
 * browser: a contract with a table and a list, a report with a table of
 * numbers, a quote and a numbered list, and an article in two columns.
 * The function is read out of the page, so this checks what ships.
 *
 *     node scripts/check-reading.mjs
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "app", "chat.html"), "utf8");
const at = html.indexOf("function pdfMarkdown(pages)");
if (at < 0) { console.log("  FAIL the page has no pdfMarkdown"); process.exit(1); }
let depth = 0, end = at;
for (let i = html.indexOf("{", at); i < html.length; i++) { if (html[i] === "{") depth++; if (html[i] === "}" && --depth === 0) { end = i + 1; break; } }
const src = html.slice(at, end);
const pdfMarkdown = new Function(src + "; return pdfMarkdown;")();
const fx = name => JSON.parse(readFileSync(join(ROOT, "scripts", "fixtures", `pdf-${name}.json`), "utf8"));

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) { console.log(`  ok   ${what}`); return; }
  failures++; console.log(`  FAIL ${what}${saw ? "\n       " + saw : ""}`);
};
const lines = s => s.split("\n");
const count = (s, sub) => s.split(sub).length - 1;

// ---------------------------------------------------------------- contract
{
  const md = pdfMarkdown(fx("contract"));
  const L = lines(md);
  check("contract: starts with [[p. 1]]", md.startsWith("[[p. 1]]\n\n"));
  check("contract: [[p. 2]] present", L.includes("[[p. 2]]"));
  check("contract: title is an h1", L.includes("# App Partnership Agreement - Draft v11"));
  check("contract: numbered heading is an h2", L.includes("## 1. Parties and Key Terms"));
  check("contract: numbered heading is not a list item", !L.some((l) => /^(- )?1\. Parties/.test(l)));
  check("contract: ## 2. The Three Steps", L.includes("## 2. The Three Steps"));
  check("contract: ## 3. Money and Reports", L.includes("## 3. Money and Reports"));
  check("contract: ## 4. Ending the Partnership", L.includes("## 4. Ending the Partnership"));
  check("contract: table header row", L.includes("| Term | Value |"));
  check("contract: table separator row", L.includes("| --- | --- |"));
  check("contract: Company creation row joined",
    L.includes("| Company creation | Within 45 days after working capital reaches $5,000. |"));
  const split = L.find((l) => l.startsWith("| Profit split |")) || "";
  check("contract: Profit split row has the three sentences joined",
    split === "| Profit split | 60% Creator, 40% CreatorMatch, from signing. Cash is paid monthly in USD from company creation. Shares and votes reach the same 60/40 split at month 10. |");
  check("contract: CreatorMatch row joined across wrapped lines",
    L.includes("| CreatorMatch | [Legal entity, address, registration number], run by Jeremy Lasne and Maxime Houel |"));
  const tl = L.filter((l) => l.startsWith("|"));
  check("contract: exactly 11 table lines (header, separator, 9 rows), got " + tl.length, tl.length === 11);
  check("contract: no 'Page 1 of 2' / 'Page 2 of 2'", !/Page \d of \d/.test(md));
  check("contract: footer text gone (Draft v11 appears once, in the title)", count(md, "Draft v11") === 1);
  check("contract: - Step one:", L.some((l) => l.startsWith("- Step one:")));
  check("contract: - Step two:", L.some((l) => l.startsWith("- Step two:")));
  check("contract: - Step three: (list continues on page 2)", L.some((l) => l.startsWith("- Step three:")));
  check("contract: Step one item is one line with its wrapped part",
    L.includes("- Step one: the Creator shares the idea, the audience and the first 20 posts. CreatorMatch builds the first version in 30 days."));
  check("contract: signature line 1 on ONE line with a 3 space gap",
    L.includes("Signed for CreatorMatch: ____________________   Date: __________"));
  check("contract: signature line 2 on ONE line with a 3 space gap",
    L.includes("Signed by the Creator: ____________________   Date: __________"));
  check("contract: signature lines are not table rows", !tl.some((l) => l.includes("Signed")));
  check("contract: paragraph joined into one line",
    L.includes("CreatorMatch builds and runs the app at its own cost, and the Creator ends with 60% of the profit, the shares and the votes."));
  check("contract: no tabs, no trailing spaces, no triple blank lines",
    !/\t/.test(md) && !/ +$/m.test(md) && !/\n\n\n/.test(md));
}

// ---------------------------------------------------------------- report
{
  const md = pdfMarkdown(fx("report"));
  const L = lines(md);
  const hash = (t) => { const l = L.find((x) => /^#+ /.test(x) && x.replace(/^#+ /, "") === t); return l ? l.indexOf(" ") : 0; };
  check("report: # Quarterly Report", L.includes("# Quarterly Report"));
  check("report: ## Summary", L.includes("## Summary"));
  check("report: ## 1. Results", L.includes("## 1. Results"));
  check("report: ### Revenue by plan", L.includes("### Revenue by plan"));
  check("report: heading levels follow height (26pt < 16pt < 12.5pt)",
    hash("Quarterly Report") === 1 && hash("Summary") === 2 && hash("Revenue by plan") === 3);
  check("report: table header row", L.includes("| Plan | Seats | Revenue | Change |"));
  check("report: Total row", L.includes("| Total | 2,430 | $4,200,000 | +18% |"));
  check("report: Starter row", L.includes("| Starter | 1,240 | $610,000 | +4% |"));
  const tl = L.filter((l) => l.startsWith("|"));
  check("report: table has 6 lines, got " + tl.length, tl.length === 6);
  check("report: first ordered item", L.includes("1. One payment provider carries 71% of revenue. A failure there stops cash for up to five days."));
  check("report: ordered list has 3 items", L.filter((l) => /^\d\. /.test(l)).length === 3);
  check("report: ordered item is not a heading", !L.some((l) => /^#+ \d\. One payment/.test(l)));
  const q = L.find((l) => l.includes("We will not trade support quality for growth.")) || "";
  check("report: quote lines joined", q.includes("hiring comes before any new campaign."));
  check("report: quote is '> ' or a plain paragraph", q.startsWith("> We will") || q.startsWith("We will"));
  check("report: header 'Confidential' removed (ligature split too)", !/Con\s*fi|Confidential|Quarterly Report ·/.test(md));
  check("report: page numbers 1 and 2 gone", !L.some((l) => /^[12]$/.test(l.trim())));
  const a = L.indexOf("### What drove it"), b = L.indexOf("## 2. Risks");
  const bl = a >= 0 && b > a ? L.slice(a, b).filter((l) => l.startsWith("- ")) : [];
  check("report: 3 bullet items under 'What drove it', each on one line", bl.length === 3);
  check("report: bullet 1 joined", bl[0] === "- The Team plan added 230 seats after the price change in July, and its payment plan lifted conversion from 3.1% to 4.4% of trials.");
  check("report: bullet 2 joined", bl[1] === "- Studio held steady: eleven new teams signed, nine renewed, two left for a competitor with a lower entry price.");
  check("report: bullet 3", bl[2] === "- Starter grew slowly because the free trial moved behind a sign-up form.");
  check("report: [[p. 2]] present", L.includes("[[p. 2]]"));
  check("report: small note kept as a paragraph", L.includes("Figures are unaudited and rounded to the nearest $10,000. Seat counts are the average over the quarter."));
}

// ---------------------------------------------------------------- twocol
{
  const md = pdfMarkdown(fx("twocol"));
  const L = lines(md);
  const at = (t) => md.indexOf(t);
  check("twocol: no table line", !L.some((l) => l.startsWith("|")));
  check("twocol: title is an h1", L.includes("# The Long Case for Short Contracts"));
  check("twocol: title comes first", at("# The Long Case") < at("A contract that fits"));
  check("twocol: left column before right ('read.' before 'middle path.')",
    at("A contract that fits on one page is read.") >= 0 && at("A contract that fits on one page is read.") < at("There is a middle path."));
  check("twocol: end of left column before start of right column",
    at("which one the document serves.") >= 0 && at("which one the document serves.") < at("There is a middle path."));
  check("twocol: right column is complete and last", at("nothing replaced it.") > at("There is a middle path."));
  check("twocol: never 'serves. There is'", !md.includes("serves. There is"));
  check("twocol: never 'read. There is'", !md.includes("read. There is"));
  check("twocol: no output line mixes the two columns",
    !L.some((l) => l.includes("A contract that") && l.includes("There is a middle path")));
  check("twocol: left column paragraphs are whole lines",
    L.includes("The case for short contracts is not that they are simple. It is that they force the writer to decide what matters. When the page limit is one, a clause has to earn its line. The payment terms stay. The three paragraphs on notices to the registered address go, or shrink to a sentence."));
  check("twocol: justified per-word line is intact", md.includes("This works because people keep promises they understand."));
}

// ---------------------------------------------------------------- robustness
{
  check("robust: [] gives empty string", pdfMarkdown([]) === "");
  check("robust: empty page gives empty string", pdfMarkdown([{ n: 1, w: 612, h: 792, items: [] }]) === "");
  const one = pdfMarkdown([{ n: 1, w: 612, h: 792, items: [{ s: "Hello", x: 72, y: 700, w: 30, h: 11, f: "a", e: 0 }] }]);
  check("robust: single item page contains Hello", one.includes("Hello") && one.startsWith("[[p. 1]]"));
  const garbage = [null, undefined, 5, "x", {}, [], [null], [{}], [{ items: null }], [{ items: [null, undefined, 3, "a"] }],
    [{ n: "z", w: "q", h: NaN, items: [{ s: "A", x: NaN, y: NaN, w: NaN, h: NaN, f: null }, { s: null }, { x: 1 }, { s: "B", x: Infinity, y: -Infinity, w: -5, h: -1 }] }],
    [{ n: 1, w: 612, h: 792, items: [{ s: "x".repeat(200000), x: 1, y: 1, w: 1e6, h: 11, f: "a" }] }],
    [{ n: 1, w: 1e12, h: 1e12, items: [{ s: "a", x: 1e11, y: 5e11, w: 4, h: 11, f: "a" }, { s: "b", x: 3, y: 5e11, w: 4, h: 11, f: "a" }] }]];
  let threw = 0;
  for (const g of garbage) { try { const r = pdfMarkdown(g); if (typeof r !== "string") threw++; } catch (e) { threw++; } }
  check("robust: garbage input never throws and always returns a string", threw === 0);
  const nanPage = pdfMarkdown([{ n: 1, w: 612, h: 792, items: [{ s: "Keep me", x: NaN, y: NaN, w: NaN, h: NaN, f: "a" }] }]);
  check("robust: NaN fields keep the text", nanPage.includes("Keep me"));
  const nb = pdfMarkdown([{ n: 1, w: 612, h: 792, items: [{ s: "a b", x: 72, y: 700, w: 30, h: 11, f: "a" }] }]);
  check("robust: non-breaking space becomes a space", nb.includes("a b"));

  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const words = ["alpha", "beta", "x", "12", "Total", "-", "•", "1.", "(a)", "gamma delta", " ", ""];
  const items = [];
  for (let i = 0; i < 5000; i++) {
    items.push({ s: words[Math.floor(rnd() * words.length)], x: rnd() * 560, y: rnd() * 780, w: rnd() * 80,
      h: [6, 8, 11, 11, 11, 14, 20][Math.floor(rnd() * 7)], f: "f" + Math.floor(rnd() * 5), e: rnd() < 0.2 ? 1 : 0 });
  }
  let t0 = performance.now();
  const big = pdfMarkdown([{ n: 1, w: 612, h: 792, items }]);
  let ms = performance.now() - t0;
  check("speed: 5000 random items in one page: " + ms.toFixed(0) + " ms (< 1000)", ms < 1000 && typeof big === "string");
  // 5000 items laid out as an ordinary single column and as a big table
  const col = [];
  for (let i = 0; i < 5000; i++) col.push({ s: "line number " + i + " of a long list", x: 72, y: 780 - (i % 60) * 12, w: 150, h: 10, f: "a" });
  t0 = performance.now();
  pdfMarkdown([{ n: 1, w: 612, h: 792, items: col }]);
  ms = performance.now() - t0;
  check("speed: 5000 items in a tight column: " + ms.toFixed(0) + " ms (< 1000)", ms < 1000);
  const tab = [];
  for (let r = 0; r < 1000; r++) for (let c = 0; c < 5; c++) tab.push({ s: "v" + r + "_" + c, x: 72 + c * 100, y: 780 - r * 0.7, w: 40, h: 0.6, f: "a" });
  t0 = performance.now();
  pdfMarkdown([{ n: 1, w: 612, h: 792, items: tab }]);
  ms = performance.now() - t0;
  check("speed: 5000 items as a 1000 row table: " + ms.toFixed(0) + " ms (< 1000)", ms < 1000);
  const long = pdfMarkdown([{ n: 1, w: 612, h: 792, items: [{ s: "word ".repeat(100000), x: 72, y: 700, w: 500, h: 11, f: "a" }] }]);
  check("robust: one very long line is kept", long.length > 400000);
}

// ---------------------------------------------------------------- speed
{
  const all = ["contract", "report", "twocol"].map(fx);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) for (const p of all) pdfMarkdown(p);
  const ms = performance.now() - t0;
  check("speed: 200 x 3 fixtures in " + ms.toFixed(0) + " ms (< 3000)", ms < 3000);
}


// ---------------------------------------------------------------- the function, as the page carries it
{
  check("source: a plain function with its helpers inside, nothing imported", /^function pdfMarkdown\(pages\)\s*\{/.test(src) && !/\bexport\b|\brequire\s*\(|\bimport\b/.test(src));
  check("source: plain ASCII, every other character an escape, no tabs, no trailing spaces", /^[\x00-\x7F]*$/.test(src) && !/\t/.test(src) && !/ +$/m.test(src));
  check("source: safe inside an HTML script", !/<\/script|<!--/i.test(src));
  check("source: touches no global of the page", !/\b(window|document|console|globalThis)\s*[.[]/.test(src));
}

// ---------------------------------------------------------------- extra documents (a handbook, an invoice and a CV, dense legal text, three columns)
{
  const md = pdfMarkdown(fx("extra1"));
  const L = lines(md);
  check("extra1: # Product Handbook", L.includes("# Product Handbook"));
  check("extra1: ## 1. Planning and ### 1.1 / ### 1.2", L.includes("## 1. Planning") && L.includes("### 1.1 Quarterly goals") && L.includes("### 1.2 Weekly review"));
  check("extra1: ## 2. Price list, ## 3. Support rota, ## 4. Closing notes", L.includes("## 2. Price list") && L.includes("## 3. Support rota") && L.includes("## 4. Closing notes"));
  check("extra1: soft hyphens vanish inside words", md.includes("internationalization") && md.includes("responsibility"));
  check("extra1: glyph bullets become '- ' items", L.includes("- Write the goal in one sentence with a number in it.") && L.filter((l) => /^- (Write|Share|Review) /.test(l)).length === 3);
  check("extra1: '1)' items become an ordered list", L.includes("1. Read the board.") && L.includes("2. Say what is late.") && L.includes("3. Agree one action per late item and write down who does it."));
  check("extra1: running header and 'Page n of 3' footer gone", !md.includes("internal draft") && !/Page \d of \d/.test(md));
  check("extra1: price table header on page 1 and repeated on page 2", count(md, "| Code | Product | Units | Price |") === 2);
  check("extra1: all 38 price rows kept", L.filter((l) => l.startsWith("| P-")).length === 38);
  check("extra1: rows from both pages", L.includes("| P-100 | Starter kit basic | 10 | $49.00 |") && L.includes("| P-137 | Custom domain max | 89 | $130.00 |"));
  check("extra1: table cut by a page break gets its header back on the next page",
    L.includes("| Week | On call | Backup |") && L.includes("| 1 | Maria | Jon |") && L.includes("| 3 | Aisha | Maria |"));
  check("extra1: three pages", L.includes("[[p. 1]]") && L.includes("[[p. 2]]") && L.includes("[[p. 3]]"));
}
{
  const md = pdfMarkdown(fx("extra2"));
  const L = lines(md);
  check("extra2: title with small text on its right: # INVOICE", L.includes("# INVOICE"));
  check("extra2: the small text is its own line", L.includes("Invoice no. 10234"));
  check("extra2: address blocks side by side become a 2 column table", L.includes("| From | Bill to |") && L.includes("| Dublin 2, Ireland | 10115 Berlin, Germany |"));
  check("extra2: items table with right aligned numbers", L.includes("| Description | Qty | Unit price | Amount |") && L.includes("| Website copy, 12 pages | 12 | $150.00 | $1,800.00 |"));
  check("extra2: wrapped first cell stays on one row", L.some((l) => l.startsWith("| Brand identity workshop, two days on site with the full team | 2 |")));
  check("extra2: total rows with empty first cells", L.includes("| | | Total due | $9,163.00 |"));
  check("extra2: sections are h2", L.includes("## Experience") && L.includes("## Skills"));
  check("extra2: job line with dates at the far right keeps a 3 space gap and is not a table", L.includes("Senior Designer, Northwind Studio   2019 - 2025"));
  check("extra2: glyph bullets", L.includes("- Led the identity work for 14 clients across media, retail and finance."));
  check("extra2: 'Page 1 of 1' footer gone", !md.includes("Page 1 of 1"));
}
{
  const md = pdfMarkdown(fx("extra3"));
  const L = lines(md);
  check("extra3: bold slightly bigger headings are headings", L.includes("# ARTICLE 1 DEFINITIONS") && L.includes("# ARTICLE 2 PAYMENT"));
  check("extra3: first line indents split paragraphs", L.includes("Short paragraph that ends here."));
  check("extra3: hyphen at a line end is dropped when the next line is lowercase", md.includes("documentation") && !/docu.\s/.test(md));
  check("extra3: 7 paragraphs and 2 headings", L.filter((l) => l && !l.startsWith("[[")).length === 9);
}
{
  const md = pdfMarkdown(fx("extra4"));
  const L = lines(md);
  const at = (t) => L.indexOf(t);
  check("extra4: headings in order", at("# Field Notes") < at("## Contents") && at("## Contents") < at("## Summary") && at("## Summary") < at("## Discussion") && at("## Discussion") < at("## Interview transcript"));
  check("extra4: no table", !L.some((l) => l.startsWith("|")));
  check("extra4: contents lines stay separate lines", L.filter((l) => /^\d\. .*\.{5,}/.test(l)).length === 3);
  const sum = L.slice(at("## Summary") + 1, at("## Discussion")).filter(Boolean);
  check("extra4: each column block has its own text between its title and the next title", sum.length >= 3 && sum.every((l) => !l.startsWith("#")));
  check("extra4: double spaced text is one paragraph", L.slice(at("## Interview transcript") + 1).filter(Boolean).length === 1);
}


console.log(failures ? `\n${failures} failed` : "\nall reading checks passed");
process.exit(failures ? 1 : 0);
