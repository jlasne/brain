# Tasu audit, October 2026

Scope: the whole repository at commit `f5ac864`. Read only: no code changed.
State at audit time: `npm run check` passes all 1,974 checks. No critical issue found.

## Status after the fixes

| Area | Done | Kept, and why |
|---|---|---|
| Dead code | 3 server functions (1 moved into the tests), 1 admin tool, the probe file (4 functions), 6 unused imports and locals, 1 frontend function, 4 CSS rules, 1 image, 1 index | 7 legacy schema fields and the `candidates` table: production rows may hold them, and Convex refuses a deploy whose schema drops a field a row still has. `promoteAll` and `dropReport`: the only way to promote seeded rows, and a drop diagnostic. `/mcp/v1`: a public address a client may hold |
| Security | S1 to S8, S10. S9: HSTS, Permissions-Policy, a CSP for objects, base and framing | A strict `script-src`: the app is one inline script, and HTML assets inherit the page's policy |
| Optimizations | O1 to O7, O9 | O8, the sources index: it needs a migration across about 10 write paths. The font change: Google serves the same 5 files either way, measured |

## tl;dr

| Area | Count | Fix first |
|---|---|---|
| Security | 9 (0 critical, 3 medium) | Slow passphrase hash, lockout by strangers, SSRF by DNS |
| Dead code | 20 items | 1 unused server function, 6 unused imports, 4 CSS rules, 1 image, 6 schema fields |
| Optimizations | 9 | Minify the app (-31% gzip), stop paid retries, cut 2 of 3 space reads per refresh |
| Other | 17 | No CI, daily log on UTC, lost updates in the interview, Google Fonts and privacy notice |

Top 5 actions, by gain over effort:

1. Hash passphrases with PBKDF2 (600k rounds). One file, rehash at next login.
2. Take the rate-limit address from a header the client cannot set. Two lines.
3. Never retry a job that is too big. Three call sites. Saves up to 2 paid calls per oversized batch.
4. Cap the question length in the folder chat. One line. Closes a cost hole on the demo key.
5. Add a CI workflow that runs `npm run check` with Playwright. 713 browser checks skip today without it.

## 1. Security

### Medium

**S1. Passphrases use one round of SHA-256.**
`convex/lib.ts:22-26`. A leaked `config` table lets a GPU test billions of guesses a second.
Fix: PBKDF2-SHA256 with 600,000 rounds through `crypto.subtle`. Store the scheme with the hash. Rehash on the next good login.

**S2. Anyone can lock the owner out.**
`convex/store.ts:85-97` counts 8 tries an hour per door, for every caller.
8 wrong guesses to `/api/unlock` shut that door for an hour. 120 to `/api/enter` shut the landing field for everyone.
`/api/enter` also tests each guess against every workspace at once: 2,880 guesses a day.
Fix: count per address and door, with growing delays. Ask for 12 characters at creation.

**S3. The per-address limit reads a header the client sets.**
`convex/http.ts:234` and `:2441` take the first `x-forwarded-for` value. A caller who sends a new value each time skips the limit.
Fix: take the last hop added by the platform, or the address Convex reports.

### Medium-low

**S4. The link fetcher checks the name, not the address.**
`convex/drop.ts:200-209`. `https://127.0.0.1.nip.io/` passes the check and reaches the local address.
Reachable from `/api/fetch` (demo visitors too) and MCP `fetch_link`. Impact depends on Convex's own egress rules.
Fix: resolve the name first and refuse private ranges on each hop. Cap the body at 2 MB (`r.text()` has no limit today).

**S5. A question has no length cap in the folder chat.**
`convex/http.ts:1053`. The other chats cap at 40,000 characters. A demo visitor can send a full context window 300 times a month on the owner's key.
Also, a hosted workspace can pick any model per request (`http.ts:157-167`).
Fix: `.slice(0, MAX_CHARS.chat)`. On a hosted workspace, keep models under a price ceiling (`price.ts` has the prices).

### Low

| # | Issue | Where | Fix |
|---|---|---|---|
| S6 | One visitor can spend the whole monthly demo allowance | `http.ts:148-155` | Add a per-address share under the global one |
| S7 | MCP `fetch_link` puts page text right after the tool's own instructions | `mcp.ts:511-521` | Wrap it in "untrusted content" markers |
| S8 | A new workspace can take the slug `assets-<victim>` and break their Assets | `files.ts:756-766` | Reserve the `assets-` prefix |
| S9 | No Content-Security-Policy. The session and the OpenRouter key sit in browser storage | `vercel.json`, `02-gate.js:87`, `03-side.js:251` | Add CSP, HSTS and Permissions-Policy |
| S10 | The MCP token never expires and travels in the URL | `http.ts:2455` | Accept a Bearer header, show its age, offer rotation |

### Verified sound

- Zero public Convex functions: every one is internal and reached through the gate.
- Workspaces stay apart on every route checked.
- Sessions: 192-bit random token, 12 h expiry, sent in the body (no CSRF).
- About 200 HTML insertions checked: all escape first. Links allow `http(s)` only.
- No secrets in files or git history.

## 2. Dead code

All items below were confirmed by search. "Certain" means zero references.

### Server

| Item | Where | Status |
|---|---|---|
| `conceptsOf` (internal query) | `convex/store.ts:324` | Certain. Callers use `conceptsOfBrain` |
| `everything` | `convex/store.ts:288` | Used by tests only |
| `dossierFor` | `convex/words.ts:206` | Used by tests only |
| `probe.ts`, 4 functions | `convex/probe.ts` | Diagnostic, in no doc or test |
| `clearRemoved` | `convex/admin.ts:357` | Duplicates a step the daily upkeep runs |
| `promoteAll`, `dropReport` | `convex/admin.ts:42`, `:906` | Legacy, drain the old `candidates` table |
| Unused imports | `http.ts:11,12,22`, `store.ts:6`, `onepager.ts:17` | Certain |
| Unused local `ids` | `http.ts:1582` | Certain |
| `/mcp/v1` route | `http.ts:2503`, `vercel.json` | No client uses it. Kept on purpose? |

### Frontend

| Item | Where |
|---|---|
| `today()` never called | `web/chat/scripts/01-core.js:151` |
| `.brain-row .cnt` | `08-shell.css:57-58` |
| `.pj-row .cnt, .as-row .cnt` | `09-assets.css:10-11` |
| `.seg.seg-wrap` | `03-folder.css:180` |
| `.mono` | `app/octopus.css:101` |

### Files and schema

| Item | Where |
|---|---|
| `docs/img/social.jpg`, 66 KB, unreferenced | `docs/img` |
| Index `insights.by_space`, never used (the code scans the table instead) | `schema.ts:362` |
| `accounts.passHash`, `lastSeen` | `schema.ts:58`, `:66` |
| `accounts.key*` (5 fields), legacy, cleared by `forgetOldKeys` | `schema.ts:60-64` |
| `projectCards.meant`, `projectBriefs.briefAt`, `stateAt` | `schema.ts:481`, `:501`, `:503` |
| Table `candidates`, written by the seed only | `schema.ts:564` |

Dependencies: `esbuild` and `playwright` are used by the checks but not declared in `package.json`.

## 3. Optimizations

Each change keeps the same answers, the same data and the same screens.

| # | Change | Where | Gain | Risk |
|---|---|---|---|---|
| O1 | Never retry a "too big" job; pass `{split:true}` | `01-core.js:196-206` + 3 call sites | Up to 2 paid calls and 5 min saved per oversized batch | None |
| O2 | Seed the "must think" set with the default model | `convex/lib.ts:175` | 0.3 to 1 s off each cold call | None |
| O3 | Read a space's brains in parallel | `convex/space.ts:23-34`, `http.ts:2298`, `conflicts.ts:72` | 30 brains: 30 round trips become 1 | None, order kept |
| O4 | `/api/topics` checks one brain by index, not the whole space | `http.ts:556` | One read instead of a full scan | None |
| O5 | Minify `chat.html` at build with esbuild | `scripts/build-app.mjs` | 199 KB to 138 KB gzipped (-31%) | Point 3 checks at the unminified source first |
| O6 | Cache `/brand/*` for 1 day | `vercel.json` | About 10 files not revalidated per view, incl. a 424 KB loop | Rename a file when it changes |
| O7 | Keep an open-clash count on each card; fold health into `/api/state` | `http.ts:2316`, `conflicts.ts:71-86` | Each refresh reads the space once, not 3 times; several MB saved at 1,000 concepts | Update the count wherever clashes change |
| O8 | Index sources by brain | `store.ts:1038-1042` | Today every call scans all sources of all workspaces; 10,000 sources is about 5 MB a call | Needs a migration with a dual-read period |
| O9 | Count concepts per brain once per render; update only the timers in the inbox | `03-side.js` sort, `05-inbox.js` | Faster side panel; inbox keeps focus | None |

Smaller wins: one variable Geist font file instead of 4 weights; `logo-mark.png` shown at 16-30 px weighs 29 KB, a 64 px WebP is about 3 KB.

Already sound: lazy-loaded PDF, Word and Excel readers; answer cache; `max_tokens` always set; retries back off; crons paginate.

## 4. Other

### Correctness

| Sev | Issue | Where | Fix |
|---|---|---|---|
| Medium | Interview and daily log write back whole objects after 120 s of model calls. Two tabs overwrite each other | `twin.ts:922-978`, `daily.ts:203-260` | Merge inside the mutation |
| Medium | The daily log's day is the UTC date. In the US, evening notes file under tomorrow | `lib.ts:12`, `http.ts:1245` | Send the user's local date |
| Medium | A chat holds 60 turns with no size cap. Past 1 MB every new turn is lost, with no error shown | `store.ts:1475`, `http.ts:122-128` | Trim turns by size, cap each answer at 20,000 characters |
| Low | A failed interview answer still marks the question as answered | `twin.ts:954-969` | Skip the mark on failure |
| Low | A raw NUL byte sits in the passphrase hash line. An editor that strips it changes every hash | `lib.ts:23` | Write `"\0"` |
| Low | A non-numeric quota setting turns the demo quota off | `http.ts:139-145` | Fall back to the default |
| Low | 7 `.catch(() => null)` sites drop the error reason | `http.ts`, `daily.ts`, `twin.ts` | Log the message |
| Low | `sessions` and `mcpHits` grow forever | `store.ts:135` | Daily cleanup cron |
| Low | 3 outside calls have no timeout | `http.ts:278`, `:409`, `probe.ts:52` | 10-20 s timeout |

### Tooling

- No CI: nothing runs the 1,974 checks on a push.
- 713 browser checks skip with exit 0 when Playwright is absent.
- Type check shows 44 errors: missing generated files and Node types. Run `npx convex codegen` and add `@types/node`.
- No linter. No `engines` field.

### Accessibility

- Focus rings at 1.48:1 contrast; WCAG asks 3:1. Use a 2 px ring in `--ink-4` (5.3:1).
- `#sideGo` has no label. `#inbox` lacks `aria-modal` and focus move.

### SEO

- No `robots.txt`, no `sitemap.xml`, no canonical links.
- `doc.html` has no doctype and still says "Octopus".
- `chat.html` has no description and is indexable.

### Privacy (EU users)

| Sev | Issue | Fix |
|---|---|---|
| Medium | Google Fonts send every visitor's IP to Google | Self-host the fonts |
| Medium | No privacy notice: no controller, retention or processors (Convex, Vercel, OpenRouter, Resend, Supadata) | Add a privacy page |
| Medium | Raw IPs stay forever in `mcpHits` | Store a hash, delete after the window |
| Medium | Owners cannot delete their whole workspace | Add an owner-only delete route |

### Docs drift

10 of 12 claims checked match the code. Two do not:

- "Old chats clear after 30 days": cleanup runs only when that workspace saves a chat.
- "A question reads 69,000 characters at most": no constant enforces it.

## Suggested order

| Week | Work |
|---|---|
| 1 | S1, S2, S3, S5, O1, CI with Playwright |
| 2 | Dead code batch ("certain" items), O2-O6, chat size cap, NUL byte, timeouts |
| 3 | O7, interview merge, local date, privacy page, self-hosted fonts |
| Later | O8 migration, S4 resolver, CSP, workspace delete |
