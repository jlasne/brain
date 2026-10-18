/**
 * Joins the app's source files into the one page the site serves.
 *
 * The app is written in web/chat: page.html holds the page with two marker lines, and the styles and scripts are split by
 * screen into web/chat/styles and web/chat/scripts. Their file names give their order, which the cascade and the script
 * rely on, so a file keeps its number. The header comment at the top of each file says what it holds and is left out of
 * the page. The result is app/chat.html, the file the site serves, minified: its styles and its script lose their comments and
 * spaces, and the script's own names get short, which takes the page from about 199 KB to about 138 KB over the wire. The
 * checks that lift code out of the page read build() instead, which is the page as written.
 *
 *     node scripts/build-app.mjs           writes app/chat.html
 *     node scripts/build-app.mjs --check   fails when app/chat.html is not what the sources make
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "web", "chat");
const OUT = join(ROOT, "app", "chat.html");

/** A file's text without its header: the comment it opens with, and the blank line after it. */
function body(file) {
  const text = readFileSync(file, "utf8");
  const m = /^\/\*[\s\S]*?\*\/\n\n/.exec(text);
  return m ? text.slice(m[0].length) : text;
}
const joined = dir => readdirSync(join(SRC, dir)).filter(f => /^\d\d-.+\.(css|js)$/.test(f)).sort().map(f => body(join(SRC, dir, f))).join("");

const STYLES = "<!-- build: styles -->", SCRIPTS = "<!-- build: scripts -->";
const put = (text, marker, what) => {
  const line = `${marker}\n`;
  if (text.split(line).length !== 2) throw new Error(`page.html must hold the line ${marker} once`);
  return text.replace(line, () => what);
};

/** The page as written: every source file whole, comments and all. */
export function build() {
  const page = readFileSync(join(SRC, "page.html"), "utf8");
  return put(put(page, STYLES, joined("styles")), SCRIPTS, joined("scripts"));
}

/**
 * The page the site serves. The script is minified with the function around it, so its names are local and may get short;
 * the small scripts page.html carries of its own stay as written.
 */
export function buildMin() {
  const page = readFileSync(join(SRC, "page.html"), "utf8");
  const css = transformSync(joined("styles"), { loader: "css", minify: true, charset: "utf8", legalComments: "none" }).code;
  const at = page.indexOf(SCRIPTS), open = page.lastIndexOf("<script>", at) + "<script>".length, close = page.indexOf("</script>", at);
  const whole = put(page.slice(open, close), SCRIPTS, joined("scripts"));
  const js = transformSync(whole, { loader: "js", minify: true, charset: "utf8", legalComments: "none" }).code;
  return put(page.slice(0, open) + "\n" + js + page.slice(close), STYLES, css + "\n");
}

/* Run as a command, it writes or checks the page; imported by a check, it only lends build(). */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = buildMin();
  if (process.argv.includes("--check")) {
    const now = readFileSync(OUT, "utf8");
    if (now !== out) { console.log("  FAIL app/chat.html is not what web/chat makes: run npm run build"); process.exit(1); }
    console.log("  ok   app/chat.html is what web/chat makes");
  } else {
    writeFileSync(OUT, out);
    console.log(`app/chat.html written: ${Math.round(out.length / 1000)} KB`);
  }
}
