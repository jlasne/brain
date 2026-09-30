# Octopus

**Every video, article and PDF you consume, turned into answers you can check.**

Drop a source. Octopus files each claim under the right subject with its author and date, flags what contradicts what you already hold, and answers from that evidence, in 9 languages.

**[Try the live demo](https://brain.jeremylasne.com)**: no sign-up. Or make a workspace of your own on your own OpenRouter key.

Built for [The Build Games](https://canivibecodeit.com/thebuildgames). Open source, MIT.

---

## What you get

| Outcome | How |
|---|---|
| **Answers with receipts** | Every claim is stored with its author and date. Answers cite them on one line, and newer evidence wins on the same question. |
| **Contradictions settled by you** | A new source that disagrees with a position waits for your ruling. Swipe left, right or "both hold", and the position is rewritten. |
| **One page, any shape** | A brain or a question becomes a summary, a quiz, a deep dive or use cases, in English, French, Spanish, German, Italian, Portuguese, Dutch, Japanese or Chinese. |
| **Three levels** | Normal answers with the numbers. Educational teaches from zero. Learning gives the steps and lets you reach the answer yourself. |
| **See it whole** | Each brain scores out of 10 against your best one on variety, depth, freshness and conflicts. The map draws every brain as an arm of the octopus. |
| **Chats that stay** | Every question and answer is kept. Reopen, rename, pin up to 5. Old ones clear after 30 days. |
| **A memory for Claude** | The owner's workspaces connect to Claude through MCP: Claude reads and feeds the brains with its own model. |

Its builder uses it every day: 126 sources, 369 concepts and 12 brains in the main workspace at the end of September 2026. 615 automated checks run on every change.

## How it works

1. **Drop.** A link, a pasted transcript, a PDF or a Word file. YouTube captions are fetched for you. Files are read in the browser and never uploaded.
2. **Read.** Every topic is extracted with its numbers and quotes, once. The author is named on every source.
3. **File.** Each idea joins a concept or starts one: a position, dated evidence, figures, links to concepts in other brains.
4. **Settle.** A claim that contradicts a position waits for you. Additions and details go straight in.
5. **Ask.** Answers, one-pagers and the map read the compiled positions, never the raw transcripts.

A position is re-derived from its whole evidence list, never appended to, so a sixth source rewrites the view from all six. Every drop finishes coherent: there is no pending pile to clean up later.

Speed stays flat as brains grow, because a question reads summaries and positions, not whole brains:

| Brain size | Read per drop | Read per question |
|---|---|---|
| 10 concepts, 30 sources | 1.0k words | 3.5k words |
| 200 concepts, 1,000 sources | 2.6k words | 5.1k words |
| 500 concepts, 5,000 sources | 5.0k words | 7.5k words |

## Inspired by Karpathy's LLM wiki

Andrej Karpathy showed that an AI should compile your sources into a wiki once, rather than search raw files on every question. Octopus keeps that idea and adds what a wiki leaves open: who said what, when, and what to do when sources disagree.

| | Karpathy's LLM wiki | Octopus |
|---|---|---|
| Setup | Scripts, Obsidian and a coding agent | A web page, on desktop and phone |
| Contradictions | Stay in the pages unresolved | Caught at every drop, and you rule on each |
| Proof | A summary per page | Author and date on every claim |
| Size | One index file, about 100 articles | Every title read in one pass, up to about 2,300 concepts |
| People | Topics only | Person brains: one expert's views, kept apart |
| Outputs | Slides and charts | Answers at 3 levels, one-pagers in 9 languages, a weekly digest, a map |
| Answers | Filed back into the wiki | Kept as chats you reopen and continue |

## Use cases

- **Investing.** One brain per analyst you follow. See what each one holds today and where two of them disagree.
- **Founders and sales.** Turn 20 outreach and pricing talks into one playbook, with the numbers each speaker gave.
- **Creators.** A swipe file of hooks and formats that files itself, each with who taught it and the result they reported.
- **Health.** Sleep, training and nutrition protocols from many podcasts, with the clashes laid out so you pick the one that holds.
- **Learning.** Study from your own sources: steps instead of answers, quizzes, deep dives.
- **Your AI.** A knowledge base Claude reads through MCP, with every claim sourced.

## What it replaces

Recall ($10/mo), Readwise Reader ($9.99/mo), the Notion wiki you never update, and the "watch later" list you never watch. On your own OpenRouter key you pay only for the model calls you make.

## Workspaces

A workspace holds its own brains, chats and passphrase, and sees nothing of the others.

| | The owner's (Octopus, Squidgy) | The demo | Your own |
|---|---|---|---|
| How you enter | Passphrase, at `/octopus` or `/squidgy` | One click from the landing | Name and passphrase from the landing |
| Model calls paid by | The deployment's key | The deployment's key, or `DEMO_OPENROUTER_API_KEY` | Your OpenRouter key |
| Model | Any, picked in Setup | The default | Any, picked in Setup |
| Limits | None | 40 steps a day per visitor, 1,500 for the whole demo | Your key's own |
| Mail, Claude connector, weekly digest | Yes | No | No |
| Create or rename brains | Yes | No | Yes |
| Chats | Shared by the workspace | Each visitor's own | Shared by the workspace |

**Your key stays yours.** It is checked once with OpenRouter when the workspace is made, then kept in your browser only. It travels with each call that needs a model and is never written to the database or logs. A workspace on its own key never falls back to the owner's.

## Self-host

A Convex deployment holds the data. Any static host serves `app/`; `vercel.json` is ready for Vercel.

```bash
git clone https://github.com/jlasne/brain
cd brain && npm install
npx convex dev
npx convex env set OPENROUTER_API_KEY sk-or-... --prod
npx convex deploy
npx convex run admin:setPass '{"space":"octopus","pass":"at least 8 characters"}' --prod
```

In Windows PowerShell, write the argument as `"{space:'octopus',pass:'...'}"`: PowerShell strips double quotes inside an argument, and the CLI accepts JSON5.

Point `window.OCTOPUS_API` in the four pages under `app/` at your deployment's `.convex.site` address.

### Open the demo

```bash
npx convex run admin:makeDemo --prod
npx convex run admin:makeDemo '{"pass":"a long passphrase"}' --prod   # also lets you open it as its owner
npx convex run admin:copyBrain '{"slug":"alex-hormozi","space":"demo"}' --prod
```

`makeDemo` opens the demo workspace. `copyBrain` copies one of your brains into it, with its concepts and sources, and leaves the original where it was. You can also feed the demo directly by opening it with its passphrase.

### Settings

| Variable | What it does |
|---|---|
| `OPENROUTER_API_KEY` | Pays for model calls in the owner's workspaces. Required. |
| `DEMO_OPENROUTER_API_KEY` | A separate key for the demo, so its spend shows apart. Falls back to the one above. |
| `DEMO_VISITOR_CALLS` | Model steps a demo visitor gets per day. Default 40. |
| `DEMO_DAILY_CALLS` | Model steps the whole demo gets per day. Default 1,500. |
| `SUPADATA_API_KEY` | Fetches YouTube captions from a bare link. Without it, a video link asks you to paste the transcript. Other workspaces get 5 to 20 fetches a day. |
| `SUPADATA_MODE` | `auto` transcribes videos that have no captions, at 2 credits a minute. |
| `RESEND_API_KEY`, `MAIL_FROM` | Mail one-pagers from the owner's workspaces. Verify the sending domain in Resend. |
| `DIGEST_TO` | Where the Monday digest goes: the week's sources, new concepts and open conflicts. It calls no model. |

Preview the digest without sending it: `npx convex run digest:send '{"dry":true}' --prod`.

## Claude

**Connector.** In an owner's workspace, Setup gives an MCP address. Paste it into Claude, ChatGPT or any MCP client: it reads and feeds that workspace's brains, and the client's own model does the thinking, so nothing is spent on the deployment. `/doc` has the setup steps.

**Claude Code.** Copy `skill/brain/` into `~/.claude/skills/brain/` or a project's `.claude/skills/brain/`. On Claude.ai, upload `skill/brain/SKILL.md` as a skill. The brains are then plain markdown files under `brains/`.

## Security

- Passphrases are stored as salted SHA-256 hashes, one per workspace, each with its own counter: 8 wrong guesses close that door for an hour.
- Every route checks the session before it reads a brain or calls a model.
- The demo runs on the default model with daily limits, sends no mail and cannot create, rename or connect brains.
- A visitor's OpenRouter key is never stored on the server.
- Raw transcripts are never stored: only what was extracted from them.

## Layout

```
app/index.html         the landing, and the owner's doors
app/chat.html          the app, one file
app/about.html         how it works
app/doc.html           the connector setup
convex/                the server: routes, store, drop, one-pager, health, conflicts
scripts/               the checks: npm run check
PROTOCOL.md            the 41 rules the brain follows
CONVEX.md              the server build, and why the key belongs there
skill/brain/SKILL.md   the same behaviour, for Claude Code
templates/, brains/    the markdown shape of a brain
```

## Checks

```bash
npm run check
```

615 checks: the pages parse and bind, the Claude connector, the store and its workspaces, one-pagers, asking, linking, the health score, and the app itself driven in a real browser.

## License

MIT.
