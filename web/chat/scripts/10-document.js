/* 10-document.js: Reading a dropped document: PDF, Word, HTML and text, into markdown. */

/* ============ a document ============ */

/**
 * Where the two readers come from.
 *
 * Both load only when a file of that kind is chosen, so opening the app costs
 * neither of them. Pinned by version, because a moving "latest" would change
 * what runs here without a commit.
 */
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.3/mammoth.browser.min.js";
const MAMMOTH_SRI = "sha512-qTj3l2ESCbkowLBjKi71BxzAnyTRiVjSRpmOuCrwFu07hPPKmBLm4d3N0hYxTNep5bP1sqTbt0FhNVWlJZ1vBA==";

/**
 * A PDF, as text with its lines kept.
 *
 * The line breaks matter. A transcript once arrived as one 34,000 character
 * line and the read came back with nothing, because a wall of words carries no
 * shape to extract. pdf.js marks the end of each line, so each one survives.
 */
/**
 * The text of a PDF, laid out again. pdf.js gives each piece of text with where
 * it stands and how big it is. This puts the pieces back in reading order:
 * headings from their size, tables from cells that line up, lists from their
 * markers and indents, a paragraph from lines that wrap. Running headers and
 * footers are left out, and two columns are read one after the other. Each
 * page opens with its mark.
 */
function pdfMarkdown(pages) {
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const GAP = "\u0001"; // marks a wide column gap inside a line, becomes 3 spaces at the very end
  // Old behaviour and safety net: stream order, so no text is ever lost.
  const plain = () => {
    try {
      return (Array.isArray(pages) ? pages : []).map((p, k) => {
        const t = ((p && p.items) || []).map((i) => ((i && i.s) || "") + (i && i.e ? "\n" : "")).join("").trim();
        return t ? "[[p. " + ((p && p.n) || k + 1) + "]]\n\n" + t : "";
      }).filter(Boolean).join("\n\n");
    } catch (e) {
      return "";
    }
  };
  try {
    // 1. Clean items. Blank items only carried layout, the x positions say the same.
    const clean = (s) => s.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ").replace(/[\u00AD](\s*)$/, "-$1")
      .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "").replace(/[\u0000-\u001F]/g, " ");
    const P = (Array.isArray(pages) ? pages : []).map((pg, k) => {
      const g = pg || {};
      const items = (Array.isArray(g.items) ? g.items : []).map((it) => ({
        s: clean(it && typeof it.s === "string" ? it.s : ""), x: num(it && it.x), y: num(it && it.y),
        w: Math.max(0, num(it && it.w)), h: Math.max(0, num(it && it.h)), f: String((it && it.f) || ""),
      })).filter((it) => it.s.trim());
      items.forEach((it) => { if (!it.w) it.w = it.s.length * 0.5 * (it.h || 10); }); // no width given: a guess keeps gaps sane
      return { n: num(g.n) || k + 1, w: Math.min(num(g.w) || 612, 5000), h: num(g.h) || 792, items };
    });

    // 2. Body font = most characters. Body height = most common height of that font.
    const tally = (m, k, n) => { m[k] = (m[k] || 0) + n; };
    const mode = (m) => Object.keys(m).sort((a, b) => m[b] - m[a])[0];
    const all = [].concat(...P.map((p) => p.items)), fch = {}, hch = {};
    all.forEach((it) => tally(fch, it.f, it.s.length));
    let bodyF = mode(fch);
    all.forEach((it) => { if (it.f === bodyF && it.h > 0) tally(hch, Math.round(it.h * 2) / 2, it.s.length); });
    let bodyH = +mode(hch) || 10;
    all.forEach((it) => { it.h = it.h || bodyH; });

    // 3. Items to lines. Touching items (ligature splits) join with no space, a real gap gives a space.
    const joinIts = (its) => its.reduce((s, it, n) => {
      const p = its[n - 1];
      return s + (p && !s.endsWith(" ") && it.s[0] !== " " && it.x - (p.x + p.w) >= 0.15 * Math.min(it.h, p.h) ? " " : "") + it.s;
    }, "").replace(/ +/g, " ").trim();
    const LONE = /^(?:[-*\u2022\u2013\u2023\u25E6\u25AA\u25CF\u00B7\u25A0\u25A1\u27A2\u25BA]|\d{1,3}[.)]|\(\d{1,3}\)|[a-zA-Z]\))$/;
    const OPEN = /^(?:([-*\u2022\u2013\u2023\u25E6\u25AA\u25CF\u00B7\u25A0\u25A1\u27A2\u25BA])|(\d{1,3})[.)]|\((\d{1,3})\)|([a-zA-Z])\)) +\S/;
    // A segment is a run of items with no wide gap. Wide gaps are column breaks.
    const segsOf = (its) => {
      const out = [];
      its.forEach((it, n) => {
        const p = its[n - 1];
        if (!p || it.x - (p.x + p.w) > Math.max(10, 0.9 * Math.min(it.h, p.h))) out.push({ x0: it.x, x1: 0, its: [] });
        const g = out[out.length - 1];
        g.its.push(it);
        g.x1 = Math.max(g.x1, it.x + it.w);
      });
      out.forEach((g) => { g.text = joinIts(g.its); });
      // a bullet or number drawn apart from its text belongs to that text
      if (out.length > 1 && LONE.test(out[0].text)) {
        out[1].text = out[0].text + " " + out[1].text;
        out[1].x0 = out[0].x0;
        out.shift();
      }
      return out;
    };
    const mkRow = (all) => {
      // text drawn twice a hair apart (fake bold) counts once
      const its = all.sort((a, b) => a.x - b.x).filter((it, n) => !(n && it.s === all[n - 1].s && it.x - all[n - 1].x < 1.5));
      let d = its[0], x1 = 0;
      its.forEach((it) => { if (it.s.length > d.s.length) d = it; x1 = Math.max(x1, it.x + it.w); });
      const segs = segsOf(its);
      const gm = segs.reduce((m, g, n) => (n ? Math.max(m, g.x0 - segs[n - 1].x1) : m), 0); // widest gap in the line
      return { its, segs, gm, y: d.y, h: d.h, f: d.f, x0: segs[0].x0, x1, text: segs.map((g) => g.text).join(GAP) };
    };
    // Same line: baselines within 40% of the larger font size, so superscripts and mixed sizes stay on their line.
    const toRows = (items) => {
      const rows = [];
      let top = 0;
      items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
        const r = rows[rows.length - 1];
        if (r && top - it.y <= 0.4 * Math.max(it.h, r.mh)) { r.its.push(it); r.mh = Math.max(r.mh, it.h); }
        else { rows.push({ its: [it], mh: it.h }); top = it.y; }
      });
      // a big title with small text on its right is two lines: split when segment sizes differ a lot
      const split = (r) => {
        const hs = r.segs.map((g) => g.its.reduce((d, it) => (it.s.length > d.s.length ? it : d)).h);
        return r.segs.length > 1 && Math.max(...hs) >= 1.25 * Math.min(...hs) ? r.segs.map((g) => mkRow(g.its)) : [r];
      };
      return rows.map((r) => mkRow(r.its)).flatMap(split);
    };
    // a line that ends with a hyphen, or with U+2010, and a next line that starts in lowercase, are one word
    const joinLines = (a, b) => (/\p{L}[-\u2010\u2011]$/u.test(a) && /^\p{Ll}/u.test(b) ? a.slice(0, -1) + b : a + " " + b);

    // 4. Running headers and footers: same text (digits as #) at the same height in the top or bottom band.
    const PN = /^(?:(?:page|p\.?|pg\.?)\s*)?[-\u2013\u2014]?\s*#(?:\s*(?:of|\/)\s*#)?\s*[-\u2013\u2014]?$|\bpage\s*#\s*(?:of|\/)\s*#/i;
    const seen = new Map();
    P.forEach((p, pi) => {
      p.rows = toRows(p.items);
      p.rows.forEach((r) => {
        r.t = r.text.replace(/\u0001/g, " ").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
        r.k = (r.y >= p.h * 0.88 ? "T" : r.y <= p.h * 0.12 ? "B" : "") + "|" + r.t;
        if (r.k[0] !== "|") seen.set(r.k, (seen.get(r.k) || new Set()).add(pi));
      });
    });
    const need = Math.max(2, Math.ceil(P.length / 2));
    P.forEach((p) => {
      // repeated on enough pages, or a page number on its own (one page: only when clearly smaller than the body)
      const small = (P.length > 1 ? 1.05 : 0.9) * bodyH;
      p.rows = p.rows.filter((r) => r.k[0] === "|" || (seen.get(r.k).size < need && !(PN.test(r.t) && r.h < small)));
    });

    // 5. Prose columns: one gutter x shared by many lines. Read the left column fully, then the right.
    const columns = (rows, pw, depth) => {
      const diff = new Array(Math.ceil(pw) + 4).fill(0);
      rows.forEach((r) => {
        for (let i = 1; i < r.segs.length; i++) {
          const a = Math.max(0, Math.ceil(r.segs[i - 1].x1) + 2), b = Math.min(diff.length - 2, Math.floor(r.segs[i].x0) - 2);
          if (b >= a) { diff[a]++; diff[b + 1]--; }
        }
      });
      let run = 0, best = 0, x1 = 0, x2 = 0;
      diff.forEach((d, x) => {
        run += d;
        if (run > best) { best = run; x1 = x2 = x; } else if (best > 0 && run === best && x === x2 + 1) x2 = x;
      });
      if (best < 4) return [rows];
      const xs = (x1 + x2) / 2;
      const isL = (it) => it.x + it.w <= xs + 1;
      // 0 left only, 1 right only, 2 both sides, 3 something crosses the gutter
      const kind = rows.map((r) => {
        if (r.its.some((it) => !isL(it) && it.x < xs - 1)) return 3;
        return r.its.some(isL) ? (r.its.some((it) => !isL(it)) ? 2 : 0) : 1;
      });
      // prose columns have long text on both sides of the gutter, table cells are short
      const lens = [];
      rows.forEach((r, i) => {
        const chars = (side) => r.its.reduce((n, it) => n + (isL(it) === side ? it.s.length : 0), 0);
        if (kind[i] === 2) lens.push(Math.min(chars(true), chars(false)));
      });
      lens.sort((a, b) => a - b);
      if (lens.length < 4 || lens[lens.length >> 1] < 20) return [rows];
      // a big one-sided line with nothing beside it (a section title) ends the columns above it
      rows.forEach((r, i) => {
        if (kind[i] > 1 || r.h <= 1.2 * bodyH) return;
        let busy = false;
        [-1, 1].forEach((d) => {
          for (let k = i + d; rows[k] && Math.abs(rows[k].y - r.y) <= 1.2 * r.h; k += d) {
            busy = busy || kind[k] === 2 || kind[k] === 1 - kind[i];
          }
        });
        if (!busy) kind[i] = 3;
      });
      const out = [];
      let flow = [];
      for (let i = 0; i < rows.length; ) {
        if (kind[i] !== 2) { flow.push(rows[i++]); continue; }
        let j = i;
        while (j < rows.length && kind[j] !== 3) j++;
        if (flow.length) out.push(flow);
        flow = [];
        const sides = [[], []];
        rows.slice(i, j).forEach((r) => {
          [r.its.filter(isL), r.its.filter((it) => !isL(it))].forEach((its, s) => { if (its.length) sides[s].push(mkRow(its)); });
        });
        sides.forEach((rs) => (depth < 2 ? columns(rs, pw, depth + 1) : [rs]).forEach((c) => out.push(c)));
        i = j;
      }
      if (flow.length) out.push(flow);
      return out;
    };

    // 6. Tables: lines whose cells (segments) fall in the same x bands row after row.
    const LEADER = /_{3,}|\.{5,}|\u2026{2,}|-{5,}/; // fill-in lines and dot leaders are forms, not tables
    const near = (a) => a.sort((u, v) => u - v).some((v, i) => i > 0 && v - a[i - 1] <= 3);
    const tableAt = (rows, i) => {
      const bands = [], run = [];
      // The band of each cell. Only multi-cell lines may open a band, wrapped lines must start at a band edge.
      const fit = (r, grow) => {
        const idx = r.segs.map((s) => {
          const hit = bands.reduce((a, b, k) => (s.x0 <= b.x1 + 2 && s.x1 >= b.x0 - 2 ? a.concat(k) : a), []);
          if (hit.length > 1 || (!grow && (!hit.length || Math.abs(s.x0 - bands[hit[0]].x0) > 3))) return NaN;
          return hit.length ? hit[0] : -1;
        });
        const old = idx.filter((k) => k >= 0);
        if (idx.some(isNaN) || new Set(old).size !== old.length) return null;
        r.segs.forEach((s, n) => {
          if (idx[n] < 0) idx[n] = bands.push({ x0: s.x0, x1: s.x1 }) - 1;
          const b = bands[idx[n]];
          b.x0 = Math.min(b.x0, s.x0);
          b.x1 = Math.max(b.x1, s.x1);
        });
        return idx;
      };
      let j = i;
      for (; j < rows.length; j++) {
        const r = rows[j], multi = r.segs.length > 1;
        const far = j > i && rows[j - 1].y - r.y > (multi ? 3.5 : 1.6) * r.h;
        const idx = r.h > 1.25 * bodyH || LEADER.test(r.text) || far ? null : fit(r, multi);
        if (!idx) break;
        run.push({ r, idx });
      }
      const multi = run.filter((e) => e.r.segs.length > 1);
      // at least two columns must repeat their left or right edge row after row
      const aligned = bands.filter((b, k) => {
        const cells = multi.flatMap((e) => e.r.segs.filter((s, n) => e.idx[n] === k));
        return near(cells.map((s) => s.x0)) || near(cells.map((s) => s.x1));
      }).length;
      if (multi.length < 2 || aligned < 2) return null;
      const nb = bands.length, order = bands.map((b, k) => k).sort((a, b) => bands[a].x0 - bands[b].x0), pos = [];
      order.forEach((k, n) => { pos[k] = n; });
      const ps = run.map((e, k) => (k && e.r.segs.length === nb ? run[k - 1].r.y - e.r.y : 0)).filter(Boolean);
      ps.sort((a, b) => a - b);
      const rowP = ps[ps.length >> 1] || 0; // usual pitch from one row to the next
      const lines = [];
      run.forEach((e, k) => {
        // a line with an empty cell, close under the line above, is wrapped cell text
        const wrap = k && e.r.segs.length < nb && run[k - 1].r.y - e.r.y <= (rowP ? 0.75 * rowP : 1.5 * e.r.h);
        if (!wrap) lines.push(new Array(nb).fill(""));
        const row = lines[lines.length - 1];
        e.r.segs.forEach((s, n) => { const c = pos[e.idx[n]]; row[c] = row[c] ? joinLines(row[c], s.text) : s.text; });
      });
      return lines.length < 2 ? null : { end: j, lines, cols: order.map((k) => bands[k]) };
    };
    const tmd = (lines) => {
      const row = (cells) => "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |";
      return [row(lines[0]), row(lines[0].map(() => "---"))].concat(lines.slice(1).map(row)).join("\n");
    };
    const withTables = (rows) => {
      const out = [];
      for (let i = 0; i < rows.length; ) {
        const t = rows[i].segs.length > 1 ? tableAt(rows, i) : null;
        out.push(t ? { table: true, lines: t.lines, cols: t.cols } : rows[i]);
        i = t ? t.end : i + 1;
      }
      return out;
    };

    // 7. Per page: columns first, then tables. A chunk is one stretch of single-column reading flow.
    const chunksOf = P.map((p) => columns(p.rows, p.w, 0).map(withTables).filter((c) => c.length));
    // A table that runs on to the next page gets its header again there. A header left alone at the foot of a
    // page counts as one.
    const fits = (a, b) => a.length === b.length
      && a.every((c, n) => Math.abs(c.x0 - b[n].x0) <= 3 || Math.abs(c.x1 - b[n].x1) <= 3);
    const gapRow = (u) => u && !u.table && u.segs.length > 1 && u.h <= 1.25 * bodyH && !LEADER.test(u.text);
    let carry = null;
    chunksOf.forEach((cs) => {
      const first = cs.length ? cs[0][0] : null, lastC = cs.length ? cs[cs.length - 1] : [], last = lastC[lastC.length - 1];
      if (carry && first && first.table && fits(first.cols, carry.cols)) {
        if (first.lines[0].join("|") !== carry.head.join("|")) first.lines.unshift(carry.head);
      } else if (carry && gapRow(first) && fits(first.segs, carry.cols)) {
        cs[0][0] = { table: true, lines: [carry.head, first.segs.map((g) => g.text)], cols: first.segs };
      }
      carry = last && last.table ? { head: last.lines[0], cols: last.cols }
        : gapRow(last) ? { head: last.segs.map((g) => g.text), cols: last.segs } : null;
    });

    // 8. Headings: text bigger than the body, ranked by height, 3 levels at most.
    const units = [].concat(...chunksOf.map((cs) => [].concat(...cs))).filter((u) => !u.table);
    units.forEach((u) => { u.tx = u.text.replace(/\u0001/g, " "); });
    // the body size again, now without table cells (a table full of small text must not make the narrative a heading)
    const hu = {}, fu = {};
    units.forEach((u) => { tally(hu, Math.round(u.h * 2) / 2, u.tx.length); tally(fu, u.f, u.tx.length); });
    bodyH = +mode(hu) || bodyH;
    bodyF = mode(fu) || bodyF;
    const cand = units.filter((u) => u.h >= 1.08 * bodyH && u.tx.length <= 120);
    const strong = cand.filter((u) => u.h >= 1.15 * bodyH), bigF = new Set(strong.map((u) => u.f));
    // only slightly bigger text counts when it shares a font with the real headings
    const heads = cand.filter((u) => u.h >= 1.15 * bodyH || bigF.has(u.f) || (!strong.length && u.f !== bodyF));
    const cl = [];
    heads.map((u) => u.h).sort((a, b) => b - a).forEach((h) => { if (!cl.length || h < cl[cl.length - 1] * 0.97) cl.push(h); });
    heads.forEach((u) => { u.level = Math.min(3, 1 + cl.findIndex((c) => u.h >= c * 0.97)); });

    // 9. Lines to blocks (paragraph, list item, heading, table) inside one chunk.
    const TERM = /[.!?:;]["'\u201D\u2019)\]]?$/;
    const listX = []; // indents that held a run of list items anywhere in the document
    const chunkBlocks = (us) => {
      // this column's own text size (a page can mix sizes, e.g. 9pt columns and 10.5pt notes)
      const hc = {};
      us.forEach((u) => { if (!u.table && !u.level && u.segs.length === 1) tally(hc, Math.round(u.h * 2), u.tx.length); });
      const cH = (+mode(hc) || 2 * bodyH) / 2;
      const isBody = (u) => u.h >= 0.85 * cH && u.h <= 1.08 * cH;
      const txt = us.filter((u) => !u.table && !u.level && u.segs.length === 1 && isBody(u)), fc = {};
      txt.forEach((u) => { u.bt = true; tally(fc, u.f, u.tx.length); });
      // the left margin is the smallest edge shared by a few lines; then the right edge, the usual leading and the font of this column
      const xs = txt.map((u) => u.x0).sort((a, b) => a - b), few = Math.max(2, 0.15 * xs.length);
      let M = xs.length ? xs[0] : 0;
      for (let i = 0, j = 0; i < xs.length; i++) {
        while (j < xs.length && xs[j] <= xs[i] + 3) j++;
        if (j - i >= few) { M = xs[i]; break; }
      }
      const colR = txt.reduce((m, u) => Math.max(m, u.x1), 0), colW = Math.max(1, colR - M);
      const lead = []; // the pitch after a full-width line is surely inside a paragraph
      us.forEach((b, k) => {
        const a = us[k - 1], p = k ? a.y - b.y : 0;
        const full = k && a.bt && b.bt && a.x1 >= colR - 0.06 * colW && b.x0 >= a.x0 - 3;
        if (full && p >= 0.9 * b.h && p <= 2.5 * b.h) lead.push(p);
      });
      lead.sort((a, b) => a - b);
      const L = lead.length > 1 ? lead[lead.length >> 1] : 0, cf = mode(fc);
      // does line u start a new block after block b?
      const brk = (b, u) => {
        const a = b.last, pitch = a.y - u.y, dx = u.x0 - a.x0, ind = Math.max(6, 0.8 * u.h);
        const end = TERM.test(a.text), short = a.x1 < colR - 0.12 * colW;
        if (pitch > (L ? 1.3 * L : 1.6 * u.h)) return true;
        // a number inside a wrapped sentence is not a list marker, a bullet glyph always is
        if (u.mk) return !!u.mk[1] || !!b.mk || end || short;
        if (dx > ind && !(b.mk && u.f === b.f)) return true; // indent step in; hanging list text is not one
        if (dx < -ind && b.n > 1) return true;
        if (b.n === 1 && short && u.f !== a.f) return true; // a short line in another font over body text: a run-in heading
        if (L && pitch - L >= Math.max(1.5, 0.08 * L) && (short || end)) return true; // small extra gap after a short line
        return L > 0 && a.x1 < colR - 0.35 * colW && end && /^[\p{Lu}\d"(\u201C]/u.test(u.text);
      };
      const out = [];
      let cur = null;
      us.forEach((u) => {
        if (u.table) { out.push({ t: "table", text: tmd(u.lines) }); cur = null; return; }
        if (u.level) {
          if (cur && cur.t === "h" && cur.level === u.level && cur.last.y - u.y <= 1.5 * u.h) {
            cur.text = joinLines(cur.text, u.tx);
            cur.last = u;
            cur.n++;
          } else out.push(cur = { t: "h", level: u.level, text: u.tx, last: u, n: 1, x0: u.x0, f: u.f });
          return;
        }
        // a signature line, with its wide gap, stays alone, unless it is just a stretched justified line
        const stretched = Math.abs(u.x1 - colR) < 3 && Math.abs(u.x0 - M) < 3 && u.gm <= 2.5 * u.h;
        const solo = LEADER.test(u.text) || (u.segs.length > 1 && !stretched);
        u.text = solo ? u.text : u.tx;
        u.mk = !solo && isBody(u) ? OPEN.exec(u.text) : null;
        if (solo) {
          out.push({ t: "p", text: u.text, x0: u.x0, f: u.f, solo: true });
          cur = null;
        } else if (cur && cur.t === "p" && !cur.solo && !brk(cur, u)) {
          cur.text = joinLines(cur.text, u.text);
          cur.last = u;
          cur.n++;
          cur.x0 = Math.min(cur.x0, u.x0);
        } else out.push(cur = { t: "p", text: u.text, x0: u.x0, f: u.f, last: u, n: 1, mk: u.mk });
      });
      out.forEach((b) => {
        if (b.t === "h" && (b.n > 3 || b.text.length > 120)) b.t = "p"; // a long run of big text is a paragraph
        b.ind = b.t === "p" && !b.mk && !b.solo && b.x0 > M + Math.max(6, 0.9 * cH);
        b.dif = b.f !== cf;
      });
      // two or more indented blocks in a row with the same left edge are list items
      for (let i = 0, j; i < out.length; i = j + 1) {
        for (j = i; out[i].ind && j + 1 < out.length && out[j + 1].ind && Math.abs(out[j + 1].x0 - out[i].x0) <= 3; ) j++;
        if (j > i) { listX.push(out[i].x0); out.slice(i, j + 1).forEach((b) => { b.t = "li"; }); }
      }
      out.forEach((b) => { if (b.mk) b.t = "li"; });
      return out;
    };
    const pageBlocks = chunksOf.map((cs) => cs.reduce((acc, c) => acc.concat(chunkBlocks(c)), []));
    // a lone indented block: a list item if that indent is a list elsewhere, else a quote when the font differs
    pageBlocks.forEach((bs) => bs.forEach((b) => {
      if (b.t === "p" && b.ind) {
        if (listX.some((x) => Math.abs(x - b.x0) <= 3)) b.t = "li";
        else if (b.dif) b.t = "quote";
      }
    }));

    // 10. Markdown. Consecutive list items stay on adjacent lines, everything else is separated by a blank line.
    const fin = (s) => s.replace(/ +/g, " ").replace(/ ?\u0001 ?/g, "   ").trim();
    const md = P.map((p, pi) => {
      const out = [];
      let inList = false;
      pageBlocks[pi].forEach((b) => {
        let s = fin(b.text);
        if (!s) return;
        if (b.t === "li") {
          const m = b.mk, rest = s.replace(/^\S+ +/, "");
          s = !m ? "- " + s : m[1] ? "- " + rest : m[2] || m[3] ? (m[2] || m[3]) + ". " + rest : "- " + s;
          if (inList) { out[out.length - 1] += "\n" + s; return; }
        }
        inList = b.t === "li";
        out.push(b.t === "h" ? "#".repeat(b.level) + " " + s : b.t === "quote" ? "> " + s : s);
      });
      return out.length ? "[[p. " + p.n + "]]\n\n" + out.join("\n\n") : "";
    }).filter(Boolean).join("\n\n");
    return md.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    return plain();
  }
}

/** One page of a PDF as the layout reader takes it: each piece of text, where it stands and how big it is. */
async function pdfItems(doc, n){
  const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 }), c = await page.getTextContent();
  const items = c.items.map(i => ({ s: i.str || "", x: i.transform?.[4] ?? 0, y: i.transform?.[5] ?? 0, w: i.width || 0, h: i.height || 0, f: i.fontName || "", e: i.hasEOL ? 1 : 0 }));
  page.cleanup();
  return { n, w: vp.width, h: vp.height, items };
}

/**
 * A PDF as Markdown, 30 pages at a time so a long one never sits whole in
 * memory. With `marks`, each page opens with its mark, so an answer can name
 * its page.
 */
async function pdfRead(file, say, marks){
  const pdfjs = await import(PDFJS + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let from = 1; from <= doc.numPages; from += 30){
    const pages = [];
    for (let n = from; n < from + 30 && n <= doc.numPages; n++){
      if (n === 1 || n % 5 === 0 || n === doc.numPages) say(`Reading page ${n} of ${doc.numPages}`);
      pages.push(await pdfItems(doc, n));
    }
    const md = pdfMarkdown(pages);
    if (md) out.push(marks ? md : md.replace(/^\[\[p\. \d+\]\]\n+/gm, ""));
  }
  return out.join("\n\n").trim();
}

/** A PDF as the text a drop reads. */
const pdfText = (file, say) => pdfRead(file, say, false);

/** The Word reader, loaded the first time a Word file is chosen. mammoth carries no types, so it goes in as a plain script. */
async function loadMammoth(){
  if (window.mammoth) return;
  await new Promise((ok, no) => {
    const t = document.createElement("script");
    /* The file cdnjs published, byte for byte, or nothing runs. */
    t.integrity = MAMMOTH_SRI; t.crossOrigin = "anonymous";
    t.src = MAMMOTH; t.onload = ok;
    t.onerror = () => no(new Error("the Word reader did not load. Check the connection."));
    document.head.append(t);
  });
}

/** A Word file. */
async function docxText(file){
  await loadMammoth();
  const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return String(r?.value ?? "").trim();
}

/**
 * A dropped document becomes the content.
 *
 * PDF, Word, a web page, and anything that is already text. The file itself is never
 * uploaded: it is read in this tab, and only the extraction ever reaches a
 * brain, which is the same rule a pasted transcript follows.
 */
async function readDocument(file){
  const name = file.name || "document";
  const ext = name.toLowerCase().split(".").pop();
  const big = Math.round(file.size / 1024);
  if (file.size > 30 * 1024 * 1024) throw new Error(`${name} is ${big}KB. 30MB is the ceiling.`);

  const btn = $("fileBtn");
  const say = t => { btn.textContent = t; };
  say("Reading");
  try {
    if (ext === "pdf") return { name, text: await pdfText(file, say) };
    if (ext === "docx") return { name, text: await docxText(file) };
    /* A web page is read for its words, not its tags. */
    if (["html", "htm", "xhtml"].includes(ext)) return { name, text: htmlToMd(await file.text()) };
    if (["txt", "md", "markdown", "text", "csv", "srt", "vtt"].includes(ext) || file.type.startsWith("text/")) {
      return { name, text: (await file.text()).trim() };
    }
    throw new Error(`${name} is a .${ext}. PDF, Word, HTML and text files are read here.`);
  } finally {
    say("+ document");
  }
}

/** The chosen file fills the content, and names the source when nothing has. */
async function takeDocument(file){
  if (!file) return;
  let got;
  try { got = await readDocument(file); }
  catch (e) {
    dpush("ai", b => { b.innerHTML = rich("**That document did not open.** " + esc(e.message)); });
    dbottom(); return;
  }
  if (!got.text){
    dpush("ai", b => { b.innerHTML = rich(
      `**${esc(got.name)} gave no text.** A scanned PDF holds pictures of words, so it needs the text pasted instead.`); });
    dbottom(); return;
  }
  $("input").value = got.text;
  if (!$("srcInput").value.trim()) $("srcInput").value = got.name;
  sizeBox(); renderComposer();
  const n = (got.text.match(/\S+/g)||[]).length.toLocaleString();
  dpush("ai", b => { b.innerHTML = rich(
    `**${esc(got.name)}** read, ${n} words. It sits in the content box. Send it when the source line is right.`); });
  dbottom();
}


