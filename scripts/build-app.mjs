/**
 * Joins the app's source files into the one page the site serves.
 *
 * The app is written in web/chat: page.html holds the page with two marker lines, and the styles and scripts are split by
 * screen into web/chat/styles and web/chat/scripts. Their file names give their order, which the cascade and the script
 * rely on, so a file keeps its number. The header comment at the top of each file says what it holds and is left out of
 * the page. The result is app/chat.html, the file the site serves.
 *
 *     node scripts/build-app.mjs           writes app/chat.html
 *     node scripts/build-app.mjs --check   fails when app/chat.html is not what the sources make
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

export function build() {
  const page = readFileSync(join(SRC, "page.html"), "utf8");
  const put = (text, marker, what) => {
    const line = `${marker}\n`;
    if (text.split(line).length !== 2) throw new Error(`page.html must hold the line ${marker} once`);
    return text.replace(line, () => what);
  };
  return put(put(page, "<!-- build: styles -->", joined("styles")), "<!-- build: scripts -->", joined("scripts"));
}

const out = build();
if (process.argv.includes("--check")) {
  const now = readFileSync(OUT, "utf8");
  if (now !== out) { console.log("  FAIL app/chat.html is not what web/chat makes: run npm run build"); process.exit(1); }
  console.log("  ok   app/chat.html is what web/chat makes");
} else {
  writeFileSync(OUT, out);
  console.log(`app/chat.html written: ${out.split("\n").length - 1} lines`);
}
