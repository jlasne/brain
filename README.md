<div align="center">

<img src="app/brand/brain.svg" width="76" alt="">

# Brain

**The knowledge you choose, organized.**

Drop the talks, PDFs and links you trust. Ask anything, and see who said it and when.

[**Open the live demo**](https://brain.jeremylasne.com) &nbsp;·&nbsp; [Read the white paper](https://brain.jeremylasne.com/about) &nbsp;·&nbsp; [Run your own](#run-your-own)

<img alt="732 checks passing" src="https://img.shields.io/badge/checks-732%20passing-5fa8d3?style=flat-square&labelColor=050b16">
<img alt="Live demo, no sign-up" src="https://img.shields.io/badge/demo-no%20sign--up-5fa8d3?style=flat-square&labelColor=050b16">
<img alt="One-pagers in 9 languages" src="https://img.shields.io/badge/one--pagers-9%20languages-5fa8d3?style=flat-square&labelColor=050b16">
<img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5fa8d3?style=flat-square&labelColor=050b16">

<br><br>

<img src="docs/img/landing.jpg" alt="The Brain landing page" width="100%">

</div>

<br>

## What it does

<img src="docs/img/goods.jpg" alt="Drop and Ask, and why it holds up" width="100%">

**Drop.** A link, a PDF, a Word file, a video or a transcript. It pulls out each idea with its numbers and files it under a concept, signed with author and date. A claim that clashes with what you hold waits for your call.

**Ask.** Ask anything, at 3 levels: the answer, a lesson from zero, or guided steps. It answers from your sources only, and the last line names who said it and when.

Drop compiles each source once. Ask reads what was compiled. The [white paper](https://brain.jeremylasne.com/about) walks through both, step by step.

## Why it holds up

- **Zero duplicates.** A source dropped twice is caught on arrival. A new idea joins the concept it belongs to.
- **Zero hidden contradictions.** Every clash is caught at drop and waits for your call, one swipe each. Each concept keeps one clear position.
- **Lightweight.** It keeps the claims and drops the raw transcript. Search reads a 1 KB card per concept.
- **Fast search.** It scans up to 2,300 concept titles in one pass, then opens at most 30 in full.
- **Scalable.** A question reads 152,000 characters of your brain at most, at any size.
- **Your data.** In your own database or as markdown files, exported in one click. Open source, on your own key.

## Compared

A classic AI chat answers from its training data. Karpathy's LLM wiki compiles your files into pages. A brain compiles them into **positions**, each backed by dated evidence you can open, and asks you when two sources clash.

| | Classic AI chat | Karpathy's LLM wiki | **Brain** |
|---|---|---|---|
| Answers from | Its training data | Your files, as pages | **Your sources, as positions with their evidence** |
| Proof | None, or a link it made up | A summary per page | **Author and date on every claim** |
| When sources disagree | Blended into one answer | Left side by side | **Flagged at each drop; you rule in a swipe** |
| New information | Frozen at the training date | Added when you run the agent | **Filed the day you drop it** |
| Whose view | An average of the internet | Your topics | **One brain per subject, per expert, or for you** |
| Setup | A chat box | Scripts, Obsidian, a coding agent | **A web page, on desktop and phone** |
| What you get | A reply | Pages, slides, charts | **Answers at 3 levels, one-pagers in 9 languages, a health score, a map** |

## Inside the app

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/img/demo.jpg" alt="An answer with its sources">
<br><b>Answers with receipts.</b> Every line comes from a source you fed it, and the sources line names each author and date. Newer evidence wins on the same question.
</td>
<td width="50%" valign="top">
<img src="docs/img/deck.jpg" alt="Settling a clash, one card at a time">
<br><b>It argues back.</b> A source that contradicts what you hold waits for your call. Swipe: A holds, B holds, or both. The position is rewritten from all its evidence.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/img/map.jpg" alt="The map of every brain">
<br><b>It draws itself.</b> Every brain an arm, every concept a sucker, every line a link between brains. Each arm carries its health score out of 10.
</td>
<td width="50%" valign="top">
<img src="docs/img/personal.jpg" alt="A personal brain filing what you say">
<br><b>It learns you.</b> A personal brain files what you tell it as dated notes, and says what it filed. Your other brains never read it.
</td>
</tr>
</table>

- **Talk instead of typing.** Tap the mic and speak. It uses the free speech service in Safari on iPhone and Mac, Chrome and Edge. Elsewhere it points to the dictation your device already has.
- **One page, any shape.** A brain or a question becomes a summary, a quiz, a deep dive or use cases, in 9 languages.
- **Chats that stay.** Reopen, rename, pin up to 5. Old ones clear after 30 days.
- **Your look.** Each workspace takes a logo, an accent and a page colour, previewed as you pick them.
- **A memory for Claude.** The owner's workspaces connect to Claude through MCP: Claude reads and feeds the brains with its own model.

## The personal brain <sup>alpha</sup>

A third kind of brain, next to subjects and experts. You talk to it, and it keeps what you said.

- **It files your words.** Each message becomes up to 3 notes, each claim dated and signed "You". Only your words get filed.
- **A change of mind** rewrites the note: the new view, and the one it replaces with its date.
- **Add memory.** Paste what another assistant knows about you, or a notes file.
- **It talks to you as "you".** Its notes read "You want to move to Lisbon", and so do its replies.
- **It calls your other brains on its own.** When one holds something that bears on what you said, it brings it up and names it: "your Health brain says 3 to 5 g a day". A line under the reply shows which brains it called.
- **Private.** Its own chat is its only reader.

## Workspaces

A workspace holds its own brains and chats, and sees nothing of the others.

| | Octopus, Squidgy | The demo | Your own |
|---|---|---|---|
| Whose | The builder's, and someone's | Anyone's | Yours |
| Enter | Its own page, passphrase on top | One click | Made on the landing |
| Model calls paid by | The deployment's key | A separate demo key | **Your OpenRouter key** |
| Limits | None | 30 drops and 300 questions a month, shared | Your key's own |
| Create brains, personal brains | Yes | No | Yes |

**Share a brain.** In the owner's Setup, Share brain puts one brain in both workspaces. It is one brain, not a copy: a drop in either workspace fills both, and a clash ruled in one is ruled in both. Each workspace keeps its own passphrase, chats and other brains. A personal brain is never shared, and a workspace can leave a brain it was given.

**Change the passphrase.** Setup asks for the current one, sets the new one, and signs everyone else out.

**Your key stays yours.** It is checked once with OpenRouter, then kept in your browser, and travels only with the calls that need a model. The server keeps no copy. A workspace on its own key runs on that key only.

## Run your own

A Convex deployment holds the data. Any static host serves `app/`.

```bash
git clone https://github.com/jlasne/brain && cd brain && npm install
npx convex dev
npx convex env set OPENROUTER_API_KEY sk-or-... --prod
npx convex deploy
npx convex run admin:setPass '{"space":"octopus","pass":"at least 8 characters"}' --prod
npx convex run admin:makeDemo '{"copy":["health","content","social"]}' --prod
```

Point `window.OCTOPUS_API` in the pages under `app/` at your deployment's `.convex.site` address. In Windows PowerShell, write each argument as `"{space:'octopus',pass:'...'}"`.

<details>
<summary><b>Settings</b></summary>

<br>

| Variable | What it does |
|---|---|
| `OPENROUTER_API_KEY` | Pays for model calls in the owner's workspaces. Required. |
| `DEMO_OPENROUTER_API_KEY` | A separate key for the demo, so its spend shows apart. Falls back to the one above. |
| `DEMO_MONTHLY_DROPS` | Drops the demo takes in 30 days, all visitors together. Default 30. |
| `DEMO_MONTHLY_ASKS` | Questions the demo answers in 30 days. Default 300. |
| `SUPADATA_API_KEY` | Fetches YouTube captions from a bare link. Without it, a video link asks for the transcript. |
| `SUPADATA_MODE` | `auto` transcribes videos that have no captions, at 2 credits a minute. |
| `RESEND_API_KEY`, `MAIL_FROM` | Mail one-pagers from the owner's workspaces. |
| `DIGEST_TO` | Where the Monday digest goes: the week's sources, new concepts and open conflicts. |

`admin:copyBrain '{"slug":"...","space":"demo"}'` adds one more brain to the demo. `digest:send '{"dry":true}'` previews the digest.

</details>

<details>
<summary><b>Claude</b></summary>

<br>

**Connector.** In an owner's workspace, Setup gives an MCP address. Paste it into Claude, ChatGPT or any MCP client: it reads and feeds that workspace's brains, and the client's own model does the thinking. `/doc` has the steps.

**Claude Code.** Copy `skill/brain/` into `~/.claude/skills/brain/`. The brains are then plain markdown files under `brains/`, following [the 41 rules](docs/PROTOCOL.md).

</details>

<details>
<summary><b>Security</b></summary>

<br>

- Passphrases are stored as salted SHA-256 hashes, one per workspace: 8 wrong guesses close that door for an hour.
- Every route checks the session before it reads a brain or calls a model.
- The demo runs on the default model within its monthly limits, and cannot create, rename or connect brains.
- A personal brain is read by its own chat only. Every other reader loads the workspace without it.
- A visitor's OpenRouter key is never stored on the server. Raw transcripts are never stored either: only what was extracted.

</details>

<details>
<summary><b>Project layout</b></summary>

<br>

```
app/            the landing, the app (one file), the white paper and the connector page
convex/         the server: routes, store, drop, one-pager, health, conflicts, personal
scripts/        732 checks, the app driven in a real browser included
docs/           the 41 rules (PROTOCOL.md), the server build (SERVER.md), the screenshots
skill/brain/    the same behaviour, as a Claude Code skill
templates/      the markdown shape of a brain
```

</details>

## Checks

```bash
npm run check
```

732 checks: the pages parse and bind, the Claude connector, the store and its workspaces, one-pagers, asking, linking, the health score, the personal brain, and the app itself driven in a real browser.

<br>

<div align="center">

Built in September 2026 by [Jeremy Lasne](https://www.jeremylasne.com) for The Build Games. MIT license.

</div>
