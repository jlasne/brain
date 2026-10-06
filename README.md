<div align="center">

<img src="app/brand/tasu.svg" width="76" alt="">

# Tasu

**Files what you read, and answers from it.**

Drop a talk, a PDF or a link. Each idea lands in a folder with its author and date. Ask, and every answer cites them.

[**Open tasu.ai**](https://tasu.ai) &nbsp;·&nbsp; [Read the white paper](https://tasu.ai/about) &nbsp;·&nbsp; [Run your own](#run-your-own)

<img alt="1271 checks passing" src="https://img.shields.io/badge/checks-1271%20passing-52525b?style=flat-square&labelColor=18181b">
<img alt="Live demo, no sign-up" src="https://img.shields.io/badge/demo-no%20sign--up-52525b?style=flat-square&labelColor=18181b">
<img alt="One-pagers in 9 languages" src="https://img.shields.io/badge/one--pagers-9%20languages-52525b?style=flat-square&labelColor=18181b">
<img alt="MIT license" src="https://img.shields.io/badge/license-MIT-52525b?style=flat-square&labelColor=18181b">

<br><br>

<img src="docs/img/landing.jpg" alt="The Tasu landing page: one passphrase field over a pencil landscape" width="100%">

</div>

<br>

## What it does

<img src="docs/img/goods.jpg" alt="Drop and Ask, and why it holds up" width="100%">

**Drop.** A link, a PDF, a Word file, a video or a transcript. It pulls out each idea with its numbers and files it under a concept, signed with author and date. A claim that clashes with what you hold waits for your call.

**Ask.** Ask anything, at 3 levels: the answer, a lesson from zero, or guided steps. It answers from your sources only, and the last line names who said it and when.

Drop compiles each source once. Ask reads what was compiled. The [white paper](https://tasu.ai/about) walks through both, step by step.

## Why it holds up

- **Zero duplicates.** A source dropped twice is caught on arrival. A new idea joins the concept it belongs to.
- **Zero hidden contradictions.** Every clash is caught at drop and waits for your call, one swipe each. Each concept keeps one clear position.
- **Lightweight.** It keeps the claims and drops the raw transcript. Search reads a 1 KB card per concept.
- **Fast search.** It scans up to 2,300 concept titles in one pass, then opens at most 30 in full.
- **Scalable.** A question reads 152,000 characters of your brain at most, at any size.
- **Your data.** In your own database or as markdown files, exported in one click. Open source, on your own key.

## Compared

A classic AI chat answers from its training data. Karpathy's LLM wiki compiles your files into pages. A brain compiles them into **positions**, each backed by dated evidence you can open, and asks you when two sources clash.

| | Classic AI chat | Karpathy's LLM wiki | **Tasu** |
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
<br><b>It draws itself.</b> One graph, the way Obsidian draws a vault: each folder a node ringed by its health, each concept a dot in its colour, each line a link. Point to light the neighbours, each link coloured by its kind, drag to rearrange, click to read. Heat colours each concept by the questions it answered in 90 days, and rings the blind spots: asked 3 times or more, held by 2 sources or fewer.
</td>
<td width="50%" valign="top">
<img src="docs/img/personal.jpg" alt="A personal brain filing what you say">
<br><b>It learns you.</b> A personal brain files what you tell it as dated notes, and says what it filed. Your other brains never read it.
</td>
</tr>
</table>

- **One field on the landing.** A passphrase opens the workspace it belongs to; any other, or none, opens the demo. The workspaces sit along the top, each opening on its own page.
- **A calm side panel.** Drop, One-pager and Settings sit on top. Chats and Folders follow, each a list that folds. Every folder is listed: yours first, then the ones another workspace lets you ask and drop into, then the ones you may only ask.
- **The chat bar floats** over the thread, with the folder picker, the level, the mic and send in one place.
- **Chat in several folders.** Click a folder to tick it, and tick as many as you like: the question reads those alone. The chat only asks.
- **A folder, open.** Open fills the main area: its scope, its counts, its health and the next move, then every concept, newest first, with the one open beside them. Chat in it, Drop into it, or edit its name and scope from there. The bar below asks that folder.
- **The model, picked in Settings.** It answers, reads drops and writes one-pagers: GLM 5.3 Flash by default, saved for the whole workspace.
- **A drop stores everything.** Every number, date and name of the source is looked for in what was read; the passages holding the ones left out are read again, and what is still missing goes in word for word. Every topic lands in a concept, opinions with nothing behind them included: one placed nowhere is filed once more, then becomes a concept of its own. A reply cut short is read again in halves, never kept half. The card says it in one line: "All of it kept: 7,020 words, 145 numbers, dates and names, 23 topics, filed into 18 concepts".
- **Drop on its own screen.** Drop sits in the side panel and opens a screen with its own log. The chat waits as it was, one click away.
- **New folder.** A folder is fed by Drop, and one switch says it holds one person's view. A personal folder is fed by what you say.
- **Talk instead of typing.** Tap the mic and speak, in the language picked in Settings, Languages: English, French, Spanish, German, Italian or Portuguese. Nothing is guessed: a tap before one is picked opens Settings on it. It uses the free speech service in Safari on iPhone and Mac, Chrome and Edge. Elsewhere it points to the dictation your device already has.
- **Every drop grows the graph.** Each new idea finds its 6 nearest by meaning, in any language. Each link says how: needs, causes, supports, contradicts or example. Folders sort themselves into topics.
- **What follows.** Two linked ideas from different folders can add up to a third. Each drop writes up to 5, marked as Tasu's own conclusion, never a source, and answers can use them.
- **Learning path.** A folder's "needs" links set a reading order: the foundations first, then each step resting on the one before.
- **One page, any shape.** A brain or a question becomes a summary, a quiz, a deep dive or use cases, in 9 languages.
- **Chats that stay.** Reopen, rename, pin up to 5. Old ones clear after 30 days.
- **Questions run in the background.** Ask, then open another chat, a folder or Drop: the answer lands in its own chat. A drop reads on while you chat.
- **An error says what to do.** A dropped connection or a timeout offers Try again, which sends the same message once more in place. Every error offers Send feedback, which mails the error, where it happened and the message behind it, 5 an hour at most.
- **An inbox, top right.** A bubble counts what waits for you and opens a panel: answers ready and unread, questions on their way, a drop not finished, what the scouts found, the personal folder's weekly audit, and the decisions. A ring turns on it while something runs.
- **Decisions, with a call ready.** Every call waiting sits in one list, grouped by folder and topic: clashes, concepts filed twice, titles not in English, empty positions, the same person on two cards. Each comes with a suggested call and its reason: "B holds. The later claim: September 2026 over February 2026". Accept one, pick another call, or Accept all in one tap. It runs on while you look elsewhere. The conflict deck shows the same suggestion on each card.
- **Scouts.** A folder follows the YouTube channels, Substacks and blogs it learns from. Every morning the scouts read each feed. A new piece is read against its folder, then waits in the inbox: what it contradicts, what it backs, the ideas it adds. Drop it, from the text already read, or skip it. A first follow keeps the 3 newest pieces of the last 3 weeks. The authors a folder already reads are one tap away.
- **Settings, folded.** Audit, Languages, Open conflicts, Look and Passphrase each fold shut and say where they stand: "2 due", "mic in French", "default".
- **Audit, in Settings.** One list for every folder you own, each with the date of its last audit. A folder's audit finds concepts filed twice, titles not in English and empty positions. The personal folder's audit files the people in your older notes and finds the cards of one person. You decide each pair: Merge, or Keep apart, and a pair kept apart never comes back. While it runs, it shows the step it is on, a bar and the time it has run, then "Audit finished in 1 min 04s". Leave it, and the inbox shows its step, then that it finished. After 50 new sources, a folder is audited on its own the next time you open Tasu, and what it finds waits as decisions. The personal folder asks every 7 days, since its people need you.
- **Chat about one concept.** Chat about it, from any concept, opens a chat that reads that concept alone.
- **Greys, and your look.** Tasu wears greys and near-black. Octopus keeps its orange and Squidgy its brown. Each workspace can set a logo, an accent and a page colour, previewed as you pick them.
- **A memory for Claude.** The owner's workspaces connect to Claude through MCP: Claude reads and feeds the brains with its own model.

## The personal brain <sup>alpha</sup>

A third kind of brain, next to subjects and experts. You talk to it, and it keeps what you said.

- **It files your words.** Each message becomes up to 3 notes, each claim dated and signed "You". Only your words get filed.
- **A change of mind** rewrites the note: the new view, and the one it replaces with its date.
- **Add memory.** In the bar of the personal chat, in the personal folder, or by dropping a file on the personal chat. Paste what another assistant knows about you, or add a PDF, Word, text or JSON file. It is checked like a drop: every number, date and name is looked for in what was filed, the passages holding the ones left out are filed again, and what is still missing is kept word for word. The result says "All of it kept". It files in the background: close it, and the inbox shows the piece it is on, then what it filed. One stopped by an error goes on from where it stopped.
- **It answers as your twin.** Its notes read "You want to move to Lisbon". Its replies speak as you would: "I want Porto in 2027". It decides with your values and rules from the twin profile, and gives the rule: "I'd pass. I never trade learning for 20% more salary." It answers straight away, with no "based on what you told me" and no dates of notes.
- **The interview ends at 100%.** Once every question is answered or known, the Interview button leaves the chat, the folder and the twin pane.
- **It calls your other brains on its own.** When one holds something that bears on what you said, it brings it up and names it: "your Health brain says 3 to 5 g a day". A line under the reply shows which brains it called.
- **A person is a folder.** Their page opens on an Overview (what is still open, the latest moments), then Facts, History a year at a time, Their people and Raw notes a month at a time. Each moment is stored on its own, so a person grows without a size limit, and the AI reads the moments that bear on what you say first, whatever their age.
- **A file per person.** Each person you mention, by name or by role, gets a file: a short summary on top, then what is still open, their facts by section (identity, contact details, you and them, work, tastes), their people both ways, and their whole history, year by year, each moment dated and told with its details. It only grows: a changed fact keeps the old one with the day it ended, and after the history come its raw notes: every message you sent about them, word for word, dated, in the language you wrote it. The People tab lists them, the most recent first. Settings, Audit, finds the people in your older notes. Edit a card by hand, or merge two cards of the same person: the mentions and names join, and the card is written again as one.
- **It interviews you.** Tap Interview me: one quick question at a time, from 335 in 17 chapters, life story first. Each takes under 30 seconds: a fact, a choice, a number or one sentence. A one-word answer gets one follow-up, a question your notes already answer is skipped, and every 10 answers it reads back 3 notes for you to confirm or correct. Say skip to pass; Stop pauses it, and it picks up where you left off.
- **It asks in passing.** Every few messages, when you asked nothing, it may end its reply with one question from the chapters it knows least.
- **Your twin, measured, and taught.** Each twin test is 5 fresh questions, never the same twice, from the chapters a twin can answer from who you are: values, beliefs, decisions, voice, money, routines and your own rules. Your twin answers first, from your notes alone. The two sets are compared for you, Same, Close or Different, with no score to give by hand. Then your answers go into your notes, and the interview counts those questions as answered. Every test is kept in a history, with its score and each pair. Until the interview reaches 100%, the twin profile writes your notes as 7 parts: identity, values, beliefs, decision rules, voice, knowledge and boundaries. At 100% it goes: the notes and the contacts hold all of it.
- **Any language in, English kept.** Write or talk in French or any other language. Every note and file is kept in English, your own words beside each line. In Settings, Languages, pick how chat answers come back (as you write, or in English) and the language the mic listens in.
- **Edit by talking.** Chat about it, on a note or a person, opens a chat on that one alone. A fact, a date or a correction you give is written to it at once, and the reply says what changed: the summary, the lines added, the lines taken out.
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

**A workspace for someone, on your key.** `npx convex run admin:makeWorkspace "{name:'PandAAAHH',pass:'ABC12345'}" --prod` makes an empty workspace behind that passphrase, which its owner changes from Setup. It runs on the deployment's key, like Octopus and Squidgy, and opens from the landing by its name. You can share a brain with it.

**Share a brain.** In the owner's Settings, a fold called Share brain has a workspace select and a button per brain. It is one brain, not a copy. Shared with Squidgy, a drop in either workspace fills both, and a clash ruled in one is ruled in both. Shared with the demo, visitors can ask it and nobody can change it. Each workspace keeps its own passphrase, chats and other brains. A personal brain is never shared, and a workspace can leave a brain it was given.

**Change the passphrase.** Settings asks for the current one, sets the new one, and signs everyone else out.

**Your key stays yours.** It is checked once with OpenRouter, then kept in your browser, and travels only with the calls that need a model. The server keeps no copy. A workspace on its own key runs on that key only. Sign out forgets it.

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
| `DEMO_MONTHLY_STEPS` | Reads, plans and stores the demo makes in 30 days. Default 20 a drop. |
| `SUPADATA_API_KEY` | Fetches YouTube captions from a bare link. Without it, a video link asks for the transcript. |
| `SUPADATA_MODE` | `auto` transcribes videos that have no captions, at 2 credits a minute. |
| `OTHERS_FETCH_DAY` | Pages and transcripts fetched for every other workspace together, a day. Default 100, on top of 20 each. |
| `RESEND_API_KEY`, `MAIL_FROM` | Mail one-pagers from the owner's workspaces. |
| `DIGEST_TO` | Where the Monday digest goes: the week's sources, new concepts and open conflicts. |
| `FEEDBACK_TO` | Where Send feedback mails an error. Unset, it goes to `DIGEST_TO`. |

`admin:copyBrain '{"slug":"...","space":"demo"}'` adds one more brain to the demo. `digest:send '{"dry":true}'` previews the digest.

</details>

<details>
<summary><b>Claude</b></summary>

<br>

**Connector.** In an owner's workspace, Settings gives an MCP address. Paste it into Claude, ChatGPT or any MCP client: it reads and feeds that workspace's brains, and the client's own model does the thinking. `/doc` has the steps.

**Claude Code.** Copy `skill/brain/` into `~/.claude/skills/brain/`. The brains are then plain markdown files under `brains/`, following [the 41 rules](docs/PROTOCOL.md).

</details>

<details>
<summary><b>Security</b></summary>

<br>

- Passphrases are stored as salted SHA-256 hashes, one per workspace: 8 wrong guesses close that door for an hour. Each guess is counted before it is checked, so guesses sent all at once get no more.
- Every route checks the session before it reads a brain or calls a model.
- The demo runs on the default model within its monthly limits, and cannot create, rename or connect brains.
- A personal brain is read by its own chat only. Every other reader loads the workspace without it.
- A visitor's OpenRouter key is never stored on the server. It travels only with the calls that spend a model, and Sign out forgets it. Raw transcripts are never stored either: only what was extracted.
- Linking runs later on the deployment's key, so the demo and a workspace on its own key never start it.
- The Word reader loads from cdnjs only if its bytes match the published hash.

</details>

<details>
<summary><b>Project layout</b></summary>

<br>

```
app/            the landing, the app (one file), the white paper and the connector page
convex/         the server: routes, store, drop, one-pager, health, conflicts, personal
scripts/        1271 checks, the app driven in a real browser included
docs/           the 41 rules (PROTOCOL.md), the server build (SERVER.md), the screenshots
skill/brain/    the same behaviour, as a Claude Code skill
templates/      the markdown shape of a brain
```

</details>

## Checks

```bash
npm run check
```

1271 checks: the pages parse and bind, the Claude connector, the store and its workspaces, one-pagers, asking, linking, the health score, the personal brain, and the app itself driven in a real browser.

<br>

<div align="center">

Built in September 2026 by [Jeremy Lasne](https://www.jeremylasne.com) for The Build Games. MIT license.

</div>
