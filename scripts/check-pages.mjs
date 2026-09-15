/**
 * Catches the way these pages actually break.
 *
 * They are single HTML files edited by matching and replacing text, so the
 * failure is never a syntax error. It is a handler that survives while the
 * function it points at is removed. The browser throws one ReferenceError, the
 * rest of the script never runs, and every button below that line goes dead
 * while the page looks fine.
 *
 *     node scripts/check-pages.mjs
 *
 * Three checks per page: the script parses, every element it reaches for
 * exists, and every name it binds or calls at the top level is declared.
 */

import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const pages = readdirSync(APP).filter(f => f.endsWith(".html"));

let failures = 0;
const fail = (page, msg) => { failures++; console.log(`  FAIL ${page}: ${msg}`); };

for (const page of pages) {
  const src = readFileSync(join(APP, page), "utf8");
  const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const code = scripts.join("\n");
  let ok = true;

  /* 1. It parses. */
  const tmp = join(tmpdir(), `octo-check-${page}.mjs`);
  try {
    writeFileSync(tmp, code);
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    ok = false; fail(page, "does not parse: " + String(e.stderr ?? e).split("\n")[1]);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }

  /* 2. Every element it reaches for exists in the markup.
        A page whose body arrives from the deployment can reach for an id the
        file does not carry. It has to say so, in one line, so the exemption is
        a decision on the page rather than a hole in the check:

            <!-- check-pages: external-ids docUrl docCopy -->
   */
  const ids = new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  for (const m of src.matchAll(/<!--\s*check-pages:\s*external-ids([^>]*?)-->/g)) {
    for (const id of m[1].trim().split(/\s+/).filter(Boolean)) ids.add(id);
  }
  const asked = new Set([...code.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  const alsoAsked = [...code.matchAll(/getElementById\("([^"]+)"\)/g)].map(m => m[1]);
  for (const id of new Set([...asked, ...alsoAsked])) {
    if (!ids.has(id)) { ok = false; fail(page, `asks for #${id}, which the markup does not have`); }
  }

  /* 3. Every name bound or called at the top level is declared somewhere. */
  const declared = new Set([
    ...[...code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
    ...[...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
    /* Destructured, and named in a parameter list or a catch. */
    ...[...code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)].flatMap(m => m[1].split(",").map(x => x.split(":").pop().trim())),
    ...[...code.matchAll(/\(([^()]*)\)\s*=>/g)].flatMap(m => m[1].split(",").map(x => x.trim().split(/[\s=]/)[0])),
    ...[...code.matchAll(/function\s*[\w$]*\s*\(([^()]*)\)/g)].flatMap(m => m[1].split(",").map(x => x.trim().split(/[\s=]/)[0])),
  ].filter(Boolean));
  const used = [
    ...[...code.matchAll(/\.(?:onclick|onchange)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)].map(m => m[1]),
    ...[...code.matchAll(/addEventListener\("[^"]+",\s*([A-Za-z_$][\w$]*)\s*\)/g)].map(m => m[1]),
  ];
  for (const name of new Set(used)) {
    if (!declared.has(name) && !(name in globalThis)) {
      ok = false; fail(page, `binds ${name}, which is never declared`);
    }
  }

  /* 4. Every function it calls still exists.
        Editing these files by cutting a range is how a whole block of functions
        once disappeared while the page still parsed and every handler still
        bound. A call to something deleted is the fingerprint of that. */
  const KEYWORDS = new Set(("if for while switch catch return typeof function async await new " +
    "of in do else try throw delete void instanceof yield case " +
    /* var() is CSS, which these files carry inside template strings. */
    "var let const").split(" "));
  const called = [...code.matchAll(/(^|[^.\w$'"`])([a-z_$][\w$]*)\s*\(/gm)].map(m => m[2]);
  for (const name of new Set(called)) {
    if (KEYWORDS.has(name) || declared.has(name) || (name in globalThis)) continue;
    ok = false; fail(page, `calls ${name}(), which is never declared`);
  }

  if (ok) console.log(`  ok   ${page}  (${scripts.length} script block${scripts.length === 1 ? "" : "s"}, ${asked.size} elements)`);
}

console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}` : "\nall pages clean");
process.exit(failures ? 1 : 0);
