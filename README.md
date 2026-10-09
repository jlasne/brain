<div align="center">

<img src="app/brand/tasu.svg" width="76" alt="">

# Tasu

**Files what you read, and answers from it.**

Drop a talk, a PDF or a link. Each idea lands in a folder with its author and date. Ask, and every answer cites them.

[**Open tasu.ai**](https://tasu.ai) &nbsp;·&nbsp; [Read the white paper](https://tasu.ai/about) &nbsp;·&nbsp; [Run your own](#run-your-own)

<img alt="1930 checks passing" src="https://img.shields.io/badge/checks-1930%20passing-52525b?style=flat-square&labelColor=18181b">
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
| What you get | A reply | Pages, slides, charts | **Answers at 3 levels, one-pagers in 9 languages, a health score** |

## Inside the app

<table>
<tr>
<td width="33%" valign="top">
<img src="docs/img/demo.jpg" alt="An answer with its sources">
<br><b>Answers with receipts.</b> Every line comes from a source you fed it, and the sources line names each author and date. Newer evidence wins on the same question.
</td>
<td width="33%" valign="top">
<img src="docs/img/deck.jpg" alt="Settling a clash, one card at a time">
<br><b>It argues back.</b> A source that contradicts what you hold waits for your call. Swipe: A holds, B holds, or both. The position is rewritten from all its evidence.
</td>
<td width="33%" valign="top">
<img src="docs/img/personal.jpg" alt="A personal brain filing what you say">
<br><b>It learns you.</b> A personal brain files what you tell it as dated notes, and says what it filed. Your other brains never read it.
</td>
</tr>
</table>

- **One field on the landing.** A passphrase opens the workspace it belongs to; any other, or none, opens the demo. The workspaces sit along the top, each opening on its own page.
- **A calm side panel.** Drop, One-pager and Settings sit on top. Chats and Folders follow, each a list that folds. Every folder is listed: yours first, then the ones another workspace lets you ask and drop into, then the ones you may only ask.
- **The chat bar floats** over the thread, with the folder picker, the level, the mic and send in one place.
- **Chat in several folders.** Click a folder to tick it, and tick as many as you like: the question reads those alone. The chat only asks.
- **Tag a folder with @.** In the folders chat, the personal chat and a project's chat, type @ and pick a folder: the chat reads it, and says so under the answer, like "Read @Pricing". Tag up to 4. In the personal chat, a project can be tagged too.
- **A folder, open.** Open fills the main area: its scope, its counts, its health and the next move, then every concept, newest first, with the one open beside them. Chat in it, Drop into it, or edit its name and scope from there. The bar below asks that folder.
- **The model, picked in Settings.** It answers, reads drops and writes one-pagers: GLM 5.3 Flash by default, saved for the whole workspace. A workspace can be given a list of favourite models instead, and the cheapest runs: each morning the average price OpenRouter charges for a call is compared (4 tokens read for 1 written), and the model changes only for a favourite at least 10% cheaper. Settings, Model names the favourites, the prices and the day.
- **A drop stores everything.** Every number, date and name of the source is looked for in what was read; the passages holding the ones left out are read again, and what is still missing goes in word for word. Every topic lands in a concept, opinions with nothing behind them included: one placed nowhere is filed once more, then becomes a concept of its own. A reply cut short is read again in halves, never kept half. The card says it in one line: "All of it kept: 7,020 words, 145 numbers, dates and names, 23 topics, filed into 18 concepts".
- **Drop on its own screen.** Drop sits in the side panel and opens a screen with its own log. The chat waits as it was, one click away.
- **New folder.** A folder is fed by Drop, and one switch says it holds one person's view. A personal folder is fed by what you say.
- **Projects.** One file, table or page, with a chat beside it and a memory of its own. Drop a Word, PDF, text, Markdown, HTML, Excel or CSV file, or start from nothing: name a project, pick a type or leave it open, and describe it in the chat. The chat picks the type from your words, writes the file from them and from your folders, and changes it as you go, each change with an Undo. A page shows as it renders, or as its code. A PDF keeps its headings, tables and lists, and loses its repeated headers and footers. The file takes two thirds of the screen and the chat one third, two tabs on a phone. A file of up to 4,000 pages is filed in sections with a contents line each, and a question opens only the sections it needs: small talk reads none of the file, and a file of 13 pages costs half as much a message as when it was read whole. The project learns where things are as you chat, for no model call, and shows the chat a short list of sections first: 1,000 questions on a file of 143 pages cost $0.26, down from $0.47, and 1,000 thanks cost $0.07, down from $0.25, with the memory kept for free. A long section is read as the passages that bear on the question. 1,000 messages that call a folder of 400 notes cost $0.50, down from $1.14. Each answer says how many sections it read, like "Read 2 of 111 sections", and what it cost: tokens in and out, the part the model host reused, and the price in dollars when the host says it. A table of up to 40,000 rows is searched by filter and totals over every row, so a count or an average is exact. Each answer opens with a TL;DR line, then its support. The chat asks your other folders when they help, never the personal one, and names what it used: the page, the rows, the folder. Ask for a brainstorm and it answers with a proposal. A change to a file you dropped waits for your click. A change to a file made here applies at once. The project's memory fills itself, with no button, in the folder format: a note on its file, what you decide, and what its answers find, each note naming the sections it rests on and marked when the file changes under it. The last 4 exchanges stay. Only the project and your personal folder read its memory.
- **Talk instead of typing.** Tap the mic and speak, in the language picked in Settings, Languages: English, French, Spanish, German, Italian or Portuguese. Nothing is guessed: a tap before one is picked opens Settings on it. On Android it listens one phrase at a time, so nothing is said twice, and a word repeated 4 times or more keeps one. It uses the free speech service in Safari on iPhone and Mac, Chrome and Edge. Elsewhere it points to the dictation your device already has.
- **Every drop grows the graph.** Each new idea finds its 6 nearest by meaning, in any language. Each link says how: needs, causes, supports, contradicts or example. Folders sort themselves into topics.
- **What follows.** Two linked ideas from different folders can add up to a third. Each drop writes up to 5, marked as Tasu's own conclusion, never a source, and answers can use them.
- **One page, any shape.** A brain or a question becomes a summary, a quiz, a deep dive or use cases, in 9 languages.
- **Chats that stay.** Reopen, rename, pin up to 5. Old ones clear after 30 days.
- **Questions run in the background.** Ask, then open another chat, a folder or Drop: the answer lands in its own chat. A drop reads on while you chat.
- **An error says what to do.** A dropped connection or a timeout offers Try again, which sends the same message once more in place. Every error offers Send feedback, which mails the error, where it happened and the message behind it, 5 an hour at most.
- **An inbox, top right.** A bubble counts what waits for you and opens a panel: answers ready and unread, questions on their way, a drop not finished, the personal folder's weekly audit, and the decisions. A ring turns on it while something runs.
- **Decisions, with a call ready.** Every call waiting sits in one list, grouped by folder and topic: clashes, concepts filed twice, titles not in English, empty positions, the same person on two cards. Each comes with a suggested call and its reason: "B holds. The later claim: September 2026 over February 2026". Accept one, pick another call, or Accept all in one tap. It runs on while you look elsewhere. "Swipe the clashes" opens the conflict deck, which shows the same suggestion on each card. A same-person call shows both people side by side: mentions, open lines, last day seen, who they are to you, the facts that tell people apart (email, phone, city, job) and their latest moments. The call can be to merge into either name.
- **Settings, folded.** Audit, Languages, Look and Passphrase each fold shut and say where they stand: "2 due · 3 to decide", "mic in French", "default".
- **Audit, in Settings.** One fold for audits and clashes. It lists every folder you own, each with the date of its last audit, and one Decisions row counts what waits and opens the list. A folder's audit finds concepts filed twice, titles not in English and empty positions. The personal folder's audit files the people in your older notes and finds the cards of one person. You decide each pair: Merge, or Keep apart, and a pair kept apart never comes back. While it runs, it shows the step it is on, a bar and the time it has run, then "Audit finished in 1 min 04s". Leave it, and the inbox shows its step, then that it finished. After 50 new sources, a folder is audited on its own the next time you open Tasu, and what it finds waits as decisions. The personal folder asks every 7 days, since its people need you.
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
- **Still open, for everyone.** An icon beside the inbox counts the promises and follow-ups still open in your people's files. It opens a list grouped by person, the oldest first. Tick a line that is done. Or write under it what changed: "signed Tuesday, he invoices in November". One send updates every line you commented: closed, dropped, reworded, with a follow-up or a moment of their history added when you told one. A line already open is updated, never listed twice: the same words in another order, or with a date added, are one line, and a done closes it. Lines doubled before are made one when you open the list. Your comment stays word for word in their raw notes.
- **A file per person.** Each person you mention, by name or by role, gets a file: a short summary on top, then what is still open, their facts by section (identity, contact details, you and them, work, tastes), their people both ways, and their whole history, year by year, each moment dated and told with its details. It only grows: a changed fact keeps the old one with the day it ended, and after the history come its raw notes: every message you sent about them, word for word, dated, in the language you wrote it. The People tab lists them, the most recent first. Settings, Audit, finds the people in your older notes. Edit a card by hand, or merge two cards of the same person: the mentions and names join, and the card is written again as one.
- **It interviews you.** Tap Interview me: one quick question at a time, from 335 in 17 chapters, life story first. Each takes under 30 seconds: a fact, a choice, a number or one sentence. A one-word answer gets one follow-up, a question your notes already answer is skipped, and every 10 answers it reads back 3 notes for you to confirm or correct. Say skip to pass; Stop pauses it, and it picks up where you left off.
- **It asks in passing.** Every few messages, when you asked nothing, it may end its reply with one question from the chapters it knows least.
- **Your twin, measured, and taught.** Each twin test is 5 new situations built from your own notes and the people in them: a message lands, an email, a text or a chat, and you write the reply you would send. Your notes imply each reply and never state it. Your twin replies first, from your notes alone, and says which notes it used. The two replies are compared for you on the decision, the facts and the voice: Same, Close or Different, with no score to give by hand. Then your replies go into your notes, so what it missed, it answers the same next time. It is the training for the day your twin answers your messages. With fewer than 6 notes, the interview's question bank asks instead. Every test is kept in a history, with its score and each pair. Until the interview reaches 100%, the twin profile writes your notes as 7 parts: identity, values, beliefs, decision rules, voice, knowledge and boundaries. At 100% it goes: the notes and the contacts hold all of it.
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
scripts/        1930 checks, the app driven in a real browser included
docs/           the 41 rules (PROTOCOL.md), the server build (SERVER.md), the screenshots
skill/brain/    the same behaviour, as a Claude Code skill
templates/      the markdown shape of a brain
```

</details>

## Checks

```bash
npm run check
```

1930 checks: the pages parse and bind, the Claude connector, the store and its workspaces, one-pagers, asking, linking, the health score, the personal brain, projects, and the app itself driven in a real browser.

<br>

<div align="center">

Built in September 2026 by [Jeremy Lasne](https://www.jeremylasne.com) for The Build Games. MIT license.

</div>
