# The Convex build

Built. The deployment is `uncommon-wolf-174`, Europe (Ireland), and the model is `z-ai/glm-5.3-flash`.

| | Value |
|---|---|
| API the app calls | `https://uncommon-wolf-174.eu-west-1.convex.site` |
| Model | `z-ai/glm-5.3-flash` |
| Key | `OPENROUTER_API_KEY`, a Convex environment variable |
| Site | `brain.jeremylasne.com`, its own Vercel project on this repo |
| Spaces | `octopus` and `squidgy`, one passphrase each, seeing none of each other |

Change the model on one line, `MODEL` in `convex/lib.ts`.

## The two spaces

A space owns its brains. A session belongs to exactly one, and every brain read
filters by it, so a passphrase shows one space and never the other.

| | Reads |
|---|---|
| A session | the space its passphrase opened |
| The MCP server, with a project's key | that project |
| The MCP server, with no key | Octopus, read only |

A brain row with no `space` reads as Octopus, and Octopus keeps the config key
`gate` that its passphrase was set under, so nothing written before the split
had to move. Slugs stay unique across both spaces, which is what lets a concept,
a source and a candidate name their brain and carry no space of their own.

```bash
# close a door before it is public
npx convex run admin:setPass '{"space":"squidgy","pass":"at least 8 characters"}' --prod

# move a brain, with its concepts, sources and candidates
npx convex run admin:moveBrain '{"slug":"content","space":"squidgy","dry":true}' --prod

# merge one folder into another in the same workspace: concepts, links, sources,
# candidates and chats follow; a concept with the same title joins its twin
npx convex run admin:mergeBrain '{"from":"sport","into":"health","dry":true}' --prod
```

The app does the same from a folder's Edit sheet: Merge into, then a second
click to confirm. The owner only, and never with the personal folder.

Write a position for every concept that has none, or holds a note about its
filing in place of one, from the evidence it already carries. Octopus and
Squidgy, on the deployment's key, eight concepts a call:

```bash
npx convex run admin:repairPositions "{dry:true}" --prod   # count them, free
npx convex run admin:repairPositions --prod                # write them
```

Settings, Audit, does the rest by hand, one folder at a time. A folder's
audit lists concepts filed twice, merged on a click, titles not in English,
renamed on a click, and the same positions. The personal folder's audit files
the people in older notes, builds their files, then lists the cards that look
like one person: Merge, or Keep apart. A pair kept apart is stored on the
folder in `apart` and never proposed again. Each audit stamps the folder's
`audit` with its date and its source count. The inbox shows "Cleaning needed"
for a folder of the workspace with 50 sources dropped since that stamp, and
for the personal folder 7 days after it. About $0.003 a folder on GLM 5.3
Flash, plus $0.001 a merge.

A workspace for someone, on this deployment's key, empty, behind a passphrase
its owner changes from Settings. The passphrase takes 8 characters at least:

```bash
npx convex run admin:makeWorkspace "{name:'PandAAAHH',pass:'ABC12345'}" --prod
```

It runs on `OPENROUTER_API_KEY` like Octopus and Squidgy, with no monthly cap,
and opens from the landing by its name. It has no connector, mail or Share
brain of its own, and 20 transcript fetches a day. The owner's Share brain lists
it, so a brain can be given to it.

Forget the model keys an earlier sign-in scheme kept, sealed, on member
accounts. Nothing reads them now. Run it once, then remove `KEY_SECRET`:

```bash
npx convex run admin:forgetOldKeys --prod
```

A personal brain keeps one file per person its owner mentions, anyone, named
or by role. The file is the contact's `file` field: facts by section
(identity, contact, you, work, tastes, other), the history as dated moments,
links to other people, open items and the last day seen. The filer sends only
what a message adds, and `mergeFile` folds it in: a fact that replaces one
closes the old with the day it ended, a moment told twice stays once, a kept
promise is marked done. The position holds the summary on top. A person
whose card predates files gets one from Build full files
(`/api/personal/people` with `phase: "files"`), from the card and every
mention, with no new mention or source. The filer that reads each message files people apart from
notes: a person already held is updated, matched by name, first name or any
name they go by, and their card is shown to it whole so the rewrite keeps
every fact; each mention is kept as dated evidence. No extra model call: the
same call files notes and people. A person already held and named with a
capital gets the mention on their card even when the filer misses them. A
filing is tried twice, 1.5 seconds apart, and a reply that is not JSON counts
as a failure, never as nothing to file; a message still not filed offers Keep
it, which files it again through `/api/personal/remember` with `kind: "chat"`.

Languages. Every note and file is kept in English, whatever language comes
in: each claim carries `orig`, the words as written, when they were in
another language. Per workspace, in the `models` row and Settings: `reply`
is how answers come back, `same` (the default, the language asked in) or
`en`, for the chat, the personal chat and the interview's questions; `voice`
is the language the mic listens in, one of 27 (en-US, fr-FR, es-ES, de-DE,
it-IT, pt-PT, nl-NL, ja-JP and the rest), `auto` for Whisper to tell, or null;
`mic` is what writes the voice, absent for Whisper or `browser`. All are set
through `/api/models`.

Voice. Whisper large-v3 turbo writes what is said into the mic, through
OpenRouter's transcription endpoint (`/audio/transcriptions`) on the
workspace's key, at $0.04 an hour of audio. The app records with the
browser's MediaRecorder (webm in Chrome and Edge, ogg in Firefox, mp4 in
Safari, sent as m4a) and cuts a piece at the first pause of half a second
after 20 seconds, never past 28, the next piece recording before the last
stops so no word falls between. It measures the loudness as it records: a
piece with under a third of a second of speech is never sent, and the mic
stops by itself after 3 minutes with nothing said. Each piece goes to
`/api/voice` as base64 with its format, the language in two letters (none
with `auto`) and its seconds; a host that fails is asked twice more, and the
words join the box in the order said. Lines Whisper is known to write over
silence (subtitle credits) are dropped. The cost is the host's price, or the
seconds at $0.04 an hour, counted under Voice. The demo, a server older than
the page and a browser that cannot record listen with the browser's own
speech service, which needs a language picked and stops after 2 minutes.

A personal brain interviews its owner. 335 questions in 17 chapters, written
for anyone and asked in the model's own words, fitted to what the notes say.
Each answer is filed as notes, like any message, with the question as its
context. Each question takes under 30 seconds: one fact, choice, number or
sentence. A one-word answer gets one follow-up; a question the notes already
answer is marked known and skipped; every 10 answers, 3 notes are read back.
"skip" passes a question and Stop pauses it; "start", "go" or "ok" answer
nothing and get the waiting question again. The model writes its
acknowledgement and its question apart, and a turn whose question is missing,
or is not a question, asks the bank's own words, so every reply ends on one
question. Outside the interview, the chat
asks one of the questions in passing every few messages, from the chapters
covered least. About $0.002 an answer on GLM 5.3 Flash. A twin test is a round of 5
situations built from the notes and the people in them, in one model call when
the round opens: a message the person could receive (an email, a text, a chat),
from someone in their notes or a plausible sender, whose reply the notes imply
and never state. It ends on "Write your reply." Each rests on one or more notes
it names to the model, so a made-up sender or a generic message is dropped, as
is one that repeats an earlier one. With fewer than 6 notes (contacts apart),
or when the model sends nothing usable, the bank fills the round instead: never
asked in a test before, one to a chapter, from the chapters a twin can answer
from who you are, the least covered first. The round says which, with `note`.
The twin writes the reply the person would send, from the notes alone, before
the replies reach the notes, and says which notes it used. A model then
compares each reply with the twin's on the move, the facts and the voice
(length, warmth, formality, language), and scores it 0, 1 or 2: the opposite
move is 0, a voice clearly not theirs is 1. Your replies are filed as notes in
one filing, and the bank's questions among them marked answered in the
interview. Each round is kept in the `interviews` row, 50 at most, with
each item's text, the twin's reason and the score. A reply or answer keeps 700 characters.
At 100% the profile is neither offered nor read by the chat: the notes and
the contacts hold what it would say. Nothing but that
brain's own folder and chat reads any of it.

The daily log is an add-on of the personal folder, next to the twin test. It
asks about today, one question at a time, in a chat of its own: 8 beats,
situation, desire, conflict, change and result (the five lines of a video
script), then the day around the work, the lesson and the why. A vague answer
(a mood, a summary or a range, with no figure, name or moment) gets one
follow-up. Each answer is filed as notes, kind `daily`, under the day's own
source "Daily log, {date}", with the question as its context, and kept for the
script under its beat. "skip", "stop" and "start" work as in the interview, and
one runs at a time: starting either pauses the other. A reply that names no
beat, or asks a follow-up past the one allowed, asks the next beat in plain
words. From 5 answers, or once every beat is seen, Write the script makes a
60-second script in one call: today's answers, the 6 notes nearest them in
full, and the 30 newest as one line each. A series line set once
("Day {n} working towards my first $10k a month", {n} counted from its Day 1)
leads the Situation line, which the model ends with what they tried to do that
day. Every script prompt carries the 8 copy rules (no dashes, under 30
words, data over adjectives, no weasel words, the "so what" test, simple
words, no negations, no sentence without a goal). A check reads the spoken
lines and the shots, never the series line, Sound or Missing, and flags a
dash, a sentence of 30 words or more, a vague word from a fixed list or a
negation; any flag sends the flagged lines back for one rewrite, kept only
when it flags fewer. `redo: true` with a `note` writes today's script again
from the last one and the comment. Once today is ready, a chat message that
asks for it ("rewrite with the series line", "write the script") does the same,
the message as the comment. A new day starts over and keeps the series line. It lives under `daily`
in the `interviews` row, and the script stays in its chat.

Projects (the first kind and the later one: their chat threads, section meanings, costs and caps), saved one-pagers, the
Limited or Full side panel, the map, the scouts and the lab are gone from the code, and their fourteen tables are gone from
`schema.ts`. A schema only checks the tables it lists, so a deploy accepts any of their rows still there. The nightly upkeep
(`admin:upkeep`, 05:40 UTC) empties them once, on its own, and marks it done in `config` as `upkeep:removed-cleared:v2`;
`npx convex run admin:upkeep --prod` runs it now. A project's files, Brief and memory stay until its owner turns it into assets.

Doubled "Still open" lines are made one when the list opens. To do a whole
workspace at once, from a terminal, with no model call:

```bash
npx convex run admin:dedupeOpen "{space:'octopus',dry:true}" --prod   # count them, write nothing
npx convex run admin:dedupeOpen "{space:'octopus'}" --prod
npx convex run admin:dedupeOpen "{space:'pandaaahh'}" --prod
```

Link what is already stored. A drop links the concepts it writes, and these
fill in the rest, in the background, both spaces:

```bash
npx convex run admin:linkPreview --prod   # what it would propose, free
npx convex run admin:linkAll --prod       # do it: about $0.005 per 1000 concepts
npx convex run admin:linkStatus --prod    # how many carry links so far
npx convex run admin:buildCards --prod    # the slim copy of every concept; starts on its own when the app opens
```

The graph for what is already stored. A drop now builds it for what it writes;
run this once after the upgrade, both spaces, on the deployment's key:

```bash
npx convex run admin:graphAll --prod                   # both spaces
npx convex run admin:graphAll "{space:'squidgy'}" --prod   # one
```

It runs in four steps a space, each handing on to the next: every concept
turned into numbers by meaning (`baai/bge-m3`, 1,024 per concept, any
language), every link already held given its kind, every folder's topics, then
what follows from the 20 strongest links across folders. About $0.08 for 1,000
concepts on GLM 5.3 Flash, most of it typing the links. Follow it with
`npx convex logs --prod`.

What a drop adds, in the background after it links:

| Step | Does | Cost a drop |
|---|---|---|
| Meaning | Each new concept is turned into numbers and its 6 nearest by meaning join the word matches as link candidates, 8 at most | Under $0.0001 |
| Kinds | Each link says how: needs, causes, supports, contradicts or example. A plain link stays "related" and is never stored as a kind | Inside the link call |
| What follows | Up to 5 linked pairs across folders, strongest kind first, each read for the conclusion the two make together. Marked as Tasu's own, never a source | About $0.001 |
| Topics | The folders it touched are grouped again by their links and shared sources. Only a new or reshaped group is named, 12 a folder at most | About $0.001 |

A question is turned into numbers too, so a concept worded differently, or in
another language, can still answer it. "Needs" links tell a concept what to
learn first and what follows it. All of it runs on the deployment's key, so a
bring-your-own-key workspace and the demo skip it, the same as linking.

PowerShell strips the double quotes inside an argument, which leaves
`{space:squidgy,...}` and a JSON5 error at 1:8. The CLI parses JSON5, so single
quoted values survive:

```powershell
npx convex run admin:setPass "{space:'squidgy',pass:'at least 8 characters'}" --prod
npx convex run admin:moveBrain "{slug:'content',space:'squidgy',dry:true}" --prod
```

## Setup, in order

```
npm install
npx convex dev
```

`convex dev` logs you in, asks which project, then writes `.env.local` with the deployment it configured. Choose the existing project, not a new one. Leave it running while you work, or stop it once it reports connected.

Then put the key on production and push:

```
npx convex env set OPENROUTER_API_KEY sk-or-v1-... --prod
npx convex deploy
```

The `--prod` flag matters. Without it the key lands on the dev deployment, and the live site reads production.

To test locally against dev, set it there too and point `window.OCTOPUS_API` in `app/index.html` at the dev URL that `convex dev` printed.

## Why it exists

The artifact build cannot call OpenRouter. A published artifact's network is locked to a short allowlist of script hosts, so every other fetch is blocked with no visible error. That is the whole reason a second runtime exists.

Convex solves the two things the artifact cannot: your OpenRouter key stays server side, and the passphrase becomes a real gate rather than a speed bump.

## Shape

```
convex/
  schema.ts        brains · concepts · sources · notes · candidates · config · sessions
  lib.ts           the model call, the hash, the link key, CORS
  store.ts         every read and write, reached only through internal functions
  http.ts          the routes, and the gate every one of them passes
  spend.ts         the cost meter: a tally per kind of work, added once the work is done
  files.ts         the assets as the database holds them: files, sections, changes, versions
  reader.ts        a file read in a piece at a time, and read out again
  assets.ts        a chat that tags an asset: what it reads, and the changes it may propose
  style.ts         the house writing rules, written once and put into every prompt that needs them
  restore.ts       an export read back into folders, concepts and sources
  voice.ts         a piece of speech written by Whisper large-v3 turbo through OpenRouter
app/
  index.html       the landing, pointed at the deployment
  chat.html        the app, built from web/chat: never edited by hand
  manifest.webmanifest, brand/   what a phone or a computer reads to install Tasu as an app
web/chat/
  page.html        the page, with a marker where the styles go and one where the scripts go
  styles/          10 stylesheets, one a screen, joined in the order of their numbers
  scripts/         20 scripts, one a screen, joined in the order of their numbers
scripts/build-app.mjs   joins web/chat into app/chat.html: npm run build
vercel.json        serves app/ as the site root
```

**The app is built, and the built file is kept.** The source of the app is `web/chat/`, cut by screen: the side panel, the inbox, Settings, a folder, the assets, Drop. `npm run build` joins it into `app/chat.html`, the one file the host serves, with no build step on the host. The built file is committed, and `npm run check` starts by building it again in memory: a built file that differs from its source fails the check. Each part opens with one comment that says what it holds, which the build leaves out, so the built file is the same byte for byte as the one written by hand before the split. No function is longer than 250 lines.

## Two stores, one command

A brain built in a Claude Code session lands in `brains/` as markdown. A brain built in the app lands in Convex. Nothing crossed between them until now, which is why the Wealth brain existed in the repo and not on the site.

`convex/seed.ts` closes it. It reads `convex/seedData.json`, generated from the markdown, and writes it into the store.

**Deploy first.** `convex run` only sees code that is already on the deployment, so a new function in git is invisible until it ships:

```
git pull
npx convex deploy
npx convex run seed:load --prod
```

A "Could not find function" error listing the functions that do exist means the deploy step was skipped.

It runs under your deploy key rather than the HTTP gate, so no passphrase is involved, and nothing in it is reachable from a browser. It refuses any brain that already exists, so a second run changes nothing. To reverse one:

```
npx convex run seed:unload --prod '{"brain":"wealth"}'
```

Export runs the other way, from the app's sidebar, in the same markdown shape.

## Routes

| Route | Does | Gated |
|---|---|---|
| `/api/status` | Says which spaces have a passphrase | No, it leaks nothing |
| `/api/unlock` | One door per space. It checks the passphrase; only `admin:setPass` sets one | Rate limited, 8 tries an hour per door |
| `/api/enter` | The landing's one field: the workspace a passphrase opens, or `demo: true` when it opens none. Counted apart from the doors, so a wrong guess never locks one | Rate limited, 10 tries an hour per address and 120 from everyone |
| `/api/state` | Brains, concept names and summary lines, sources | Yes |
| `/api/export` | One brain's concepts whole, 100 a page, for the markdown export | Yes |
| `/api/restore` | Reads an export back (`text`, up to 15 million characters): the folders, concepts and sources the workspace is missing are added, and what it already holds stays as it is. A personal folder in the file joins the workspace's own. A slug another workspace holds is left out. The links between new concepts are rebuilt in the background. Returns the counts added and kept | Owner, never the demo |
| `/api/concept` | One concept whole, its links with their kinds, and what follows from it, for the brain viewer. A person of a personal folder also brings the people linking to them and their raw notes, the newest 300; the first open gathers those from the chats still kept | Yes |
| `/api/topics` | One folder's topics: a title, a line and its concepts. Never a personal folder | Yes |
| `/api/conflicts` | The open conflicts that are real contradictions. Each clash is checked once and marked. With `hints`, each gets a suggested ruling and its reason, 20 clashes to a model call, kept on the clash so it is asked once; with no answer, the later date suggests one | Yes |
| `/api/conflicts/settle` | Settles one: the side that holds rewrites the position, or both hold and it only leaves the list | Yes |
| `/api/passphrase` | Changes the workspace's passphrase: the current one is checked against the same 8 tries an hour, the others are signed out | Owner |
| `/api/share` | Share brain: the owner of a brain's workspace puts it in one more workspace, or takes it back, one workspace at a time. The owner's other workspace can feed it; the demo only reads it. A workspace can leave a brain it was given. Never a personal brain | Owner |
| `/api/brain` | Creates one | Yes |
| `/api/drop/check` | The duplicate check, an index lookup. No model call, so the test button is free | Yes |
| `/api/drop/read` | One extraction pass over one chunk. With `gaps`, a second look at the passages whose numbers, dates and names the first read never mentioned | Yes |
| `/api/drop/plan` | Summaries in, the card out. Each topic is numbered, and the plan names it in a concept's `from`: everything is filed, opinions with nothing behind them included. With `again`, the topics a first plan placed nowhere | Yes |
| `/api/drop/settle` | Re-derives positions, writes, returns the receipt | Yes |
| `/api/drop/link` | Links everything a drop wrote, once, in the background | Yes |
| `/api/drop/merge` | Before storing: groups new titles that name one idea twice, joins a new idea to the concept already holding it, and gives a title not in English its English one | Yes |
| `/api/ask` | The answer (see The chats), with `opened`, the concepts it read, for the page to send back with the thread. Thanks, a greeting or a goodbye is answered in one short call that reads nothing. With `concept`, it reads that one concept alone; in a personal folder, what the message adds or corrects is written to the note or the person's file at once, and `changed` says what moved. With `tags`, the slugs of folders named with @ in the message, it reads those folders and no other (in the personal chat: the personal folder and those folders), and `tagged` (`called` in the personal chat) names them | Yes |
| `/api/voice` | A piece of speech, about 20 seconds as base64 with its format, language and seconds, written by Whisper large-v3 turbo through OpenRouter on the workspace's key. Counted under Voice. Never the demo | Yes |
| `/api/models` | The workspace's model, the languages of its answers and its mic, and what writes the voice (`mic`: whisper or browser). `null` goes back to the default. A model picked here ends the daily choice among favourites, and the answer says so (`favs: null`) | Owner |
| `/api/onepager` | A summary in bullets of a brain, a group or a question, or a document: a quiz, a deep dive, use cases, or a type you describe. `assets` (four at most) are read whole beside the folders, or alone with `pick: "none"`. Built, shown and never stored. Sends it too, when given an address | Yes |
| `/api/fetch` | Opens a link, or fetches a video's transcript | Yes |
| `/api/usage` | What transcripts have cost, from both sides | Yes |
| `/api/doc` | The connector page's words, served rather than published | Yes |
| `/api/lock` | Drops the session | Yes |
| `/api/brain/tidy` | Reads one folder for concepts filed twice, titles not in English and concepts with no position. Proposes only, and keeps what it found on the folder, for the inbox's decisions | Yes, owner |
| `/api/brain/audit` | Stamps a folder's last audit: its date and its source count. With `action: "apart"`, keeps a pair of concepts or people apart, so no audit proposes them again. With `action: "dismiss"`, takes one finding off the folder: a title kept, a position left empty | Yes, owner |
| `/api/concept/merge` | Folds concepts of one folder into the one kept, then writes its position again from the joined evidence | Yes, owner |
| `/api/concept/rename` | Changes a concept's title. Its id and links stay | Yes, owner |
| `/api/concept/rederive` | Writes positions again from the evidence each concept holds, eight per call | Yes |
| `/api/brain/groups` | The categories of the folders. `set: [{slug, group}]` puts each folder of this workspace in a category, or in none with `""`. `action: "suggest"` returns a category per folder from its name and scope line, one model call, nothing saved. Owner only, never the personal folder | Suggest only |
| `/api/brain/merge` | Merges one folder into another in the same workspace, then deletes the first. Owner only, never the personal folder | Yes |
| `/api/brain/delete` | Deletes a folder of this workspace. With `dry`, counts what would go: its concepts, its sources and those it alone holds, the chats that asked it, the workspaces it is shared with. Otherwise 150 concepts a call, with their cards and meaning, then once: links from other folders into it cut, its topics, the insights resting on it and its candidates gone, a source it alone held gone with its note, a chat that asked it asking the rest (or every folder). The folder row goes last, so a stop half way finishes when asked again. Never the personal folder, a project, or a folder shared in from another workspace | Yes |
| `/api/personal/contact` | A person's file by hand: `edit` sets its name, other names, line and summary (the old name stays as another name); `part` takes one fact, moment or link out, or marks an open item done; `merge` folds other files of the same person into it, then writes the summary again; `peek` (`ids`, up to 20) gives each file in a few lines, read only: names, line, summary, up to 6 facts that still hold (contact details first), the 2 latest moments, mentions, open lines and the day last seen, so a same-person call is made by looking | Owner |
| `/api/personal/open` | What is still open in a personal brain, for every person. Each person's card carries `open`, the count of their open lines, so the app counts them with no read; a card made before that gets it from the first `list`, which writes the ones that differ. `list` (the default): the people with an open line, the oldest first, each line with its key. Lines that say the same thing (the same keywords, the person's name aside) are made one when listed: the oldest stays, with the newest wording. `send`: the owner's comments on up to 25 lines, read in one model call: a line is closed, dropped or reworded by its key, a follow-up (3 a line) or a moment of the history may follow, and each comment is kept word for word in that person's raw notes. A line the model passed over, or that did not save, comes back in `retry` | Owner |
| `/api/personal/remember` | A memory or a message filed into a personal brain. It returns what it kept as text, so the app checks every number, date and name. With `gaps`, the passages a first filing left out; with `verbatim`, what two filings left out, kept word for word with no model call | Owner |
| `/api/personal/page` | One page of a person: the moments of a `year`, or the raw notes of a `month` | Owner |
| `/api/personal/people` | The people in a personal brain's older notes, filed as contacts, 20 notes a call; the app calls again with `at` until `next` is null | Owner |
| `/api/interview` | A personal brain's interview, by `action`: `state`, `start` (on, and its next question), `stop`, `restart`, `test` (the open round of 5 messages to reply to, built from the notes, or `fresh: true` for another), `check` (your replies, and the twin replies the same from the notes alone, with its reasons), `score` (a model compares the two, 0 to 2 a question, and the round goes into the history), `learn` (your answers filed as notes) and `profile` (the notes as 7 parts, offered until the interview reaches 100%). While on, `/api/ask` in that brain's chat takes each message as an answer | Owner |
| `/api/daily` | A personal brain's daily log, by `action`: `state`, `start` (on, in the chat sent, and the question waiting or today's first), `stop`, `script` (today's 60-second video script, saved in the chat; `redo: true` and a `note` write it again from the last one and the comment) and `series` (`{line, start}`: the line that opens every script, `{n}` its day count from `start`). While on, `/api/ask` in that brain's chat takes each message as today's answer | Owner |
| `/api/feedback` | Send feedback: mails one error, where it happened, the workspace and the message to `FEEDBACK_TO`, else `DIGEST_TO`. Another workspace's personal message keeps its words out. 5 an hour per sender, 20 per workspace | Yes |
| `/api/assets/list` | The workspace's assets, newest first: name, kind, size, its web address when it is a page, and whether a version before it is kept for Undo | Yes |
| `/api/assets/new` | A new asset: a blank document, table or page, or (`made: false`) the place a file read in the browser goes, then `begin`, `part` and `finish` on its number. `prev` makes it that asset's new version; `url` keeps the web address it was read from. 100 at most. Returns `fid`, the number every other asset route takes as `file` | Owner |
| `/api/assets/begin`, `/part`, `/finish` | One file, page or table, read in the browser and sent in pieces. `begin` clears what the asset held and starts it one version on, so a piece sent for the version before is refused. A piece of a document or a page is cut in sections of about 12,000 characters, each given a title and a line, 4 sections a model call, and the words it is known by. A sheet's rows are cut in blocks. `finish` reads every row once for each column's totals, then the asset opens; a new version takes the place of the one it replaces, which is kept for Undo | Owner. `part` runs a model for a document |
| `/api/assets/get`, `/doc`, `/rows`, `/download` | One asset: its shape and contents list; sections of a document and rows of a sheet as the screen scrolls; the asset as Markdown, HTML or CSV, read in pages of 3 MB; the page writes the format asked from that text | Yes |
| `/api/assets/edit` | Applies, undoes or turns down a change a chat proposed, whole or not at all. The last 10 of each asset are kept to undo | Owner |
| `/api/assets/file` | One asset, by `action`: `rename`, `remove` (with the version kept for its Undo), or `undo` (a new version taken back, the one before returns) | Owner |
| `/api/assets/make` | A new asset a chat proposed, by `action`: `apply` makes and fills it, `undo` takes it away, `dismiss` turns it down | Owner |
| `/api/assets/state` | Where the changes and new assets of a chat opened again stand now | Yes |
| `/api/assets/adopt` | A project made before the assets, deleted whole with `drop: true`, or turned into assets, once: its files move with all they hold (a name an asset holds gets the project's name after it), its Brief, State of play, open questions and memory become one document, "Notes of" the project, and the project goes with its thread | Owner. Runs a model for the notes |
| `/api/spend` | What the workspace cost this month, kind by kind (folder chat, personal chat, assets, drops, upkeep, one-pagers, voice): the dollars the model host reported, the calls it gave a price for and all the calls, the tokens in, out and reused, and the answers given again for free; and the month before in all | Owner |
| `/mcp`, and any path under `/mcp/` | The public MCP server, read only. `/mcp/v0` reaches the same handler | No, by design |

## Why the key has to be server side

| | Artifact build | Convex build |
|---|---|---|
| Who pays for a model call | Each viewer, from their own Claude usage | You, from your OpenRouter balance |
| Where the key sits | No key exists | A Convex environment variable, never sent to a browser |
| What the passphrase protects | Your brains from a casual reader | Your balance from anyone with the link |

In the artifact build a stranger who opens the page spends their own credits, so your balance is already safe. In the Convex build every call spends yours. So the passphrase check belongs in a Convex action, before the model call, and the browser never holds anything that can reach OpenRouter directly.

## Model choice

One function wraps the call, so the model is a single line to change. Each
workspace picks one in Settings, saved on the server: it answers, reads drops
and writes one-pagers. It defaults to `z-ai/glm-5.3-flash`, in every
workspace. The demo always runs on the defaults.

To set the model of Octopus, Squidgy and every workspace made with
`makeWorkspace` at once, from a terminal, with no model call:

```bash
npx convex run admin:setModel "{model:'deepseek/deepseek-v4.1-flash',dry:true}" --prod   # who changes, nothing written
npx convex run admin:setModel "{model:'deepseek/deepseek-v4.1-flash'}" --prod
npx convex run admin:setModel "{model:null}" --prod                                      # back to the default
```

It writes what each workspace would pick in Settings, and each can change it
there afterwards. The demo and the workspaces visitors made on their own key
keep the default. `spaces:['pandaaahh']` names a few instead of all. A model
set this way ends a list of favourites, below.

**Favourites: the cheapest one runs.** Give the same workspaces a list of 2 to
8 models, and each morning (05:30 UTC) the cheapest of them runs. Nothing is
read from OpenRouter while no workspace has a list.

```bash
npx convex run admin:setFavourites "{models:['deepseek/deepseek-v4-flash-0731','z-ai/glm-5.3-flash'],dry:true}" --prod   # prices, nothing written
npx convex run admin:setFavourites "{models:['deepseek/deepseek-v4-flash-0731','z-ai/glm-5.3-flash']}" --prod
npx convex run admin:addFavourite "{model:'deepseek/deepseek-v4.1-flash-1017'}" --prod                                                # one more on each list, priced with the rest
npx convex run admin:pickCheapest --prod                                                                                    # look now, as the daily check does
npx convex run admin:setFavourites "{models:null}" --prod                                                                   # end it, the model running stays
```

The price of a model is what a call costs on OpenRouter on average, in dollars
per million tokens, at 4 tokens read for 1 written (a drop reads about 32,000
and writes 12,000; an answer reads far more than it writes). OpenRouter sends
each call to one provider of the model, picked at random and favouring cheap
ones: half the price gets 4 times the calls. A call that asks for JSON goes only
to providers that take it, and to those with no recent outage. So the price is
the average over the providers that take JSON and had 95% uptime over the last
30 minutes, each weighted by the inverse square of its price (`price.ts`).
The price OpenRouter lists for a model is one provider's, so it is not used.
Calls are sent as before.

A workspace changes model only for a favourite at least 10% cheaper than the one
running. A favourite that cannot be priced on a given day leaves the choice as it
is. The command prices every model before it writes anything, and refuses one
OpenRouter does not know, or one with no provider that takes JSON, such as an
alias that redirects to the newest version. The prices, and the day they were
read, are kept on the workspace's `models` row and shown in Settings, Model.
A model picked there, or set with `setModel`, ends the list for that workspace.
The price is an estimate: OpenRouter's Activity page shows what a call cost.
It leaves thinking out, which is billed as output: a model that must think, such
as GLM 5.3 Flash, costs more than its price here.

Every call asks the model to skip thinking, which is cheaper and quicker. GLM
5.3 Flash cannot skip it and refuses such a call, so it is asked again with
low thinking, kept out of the reply, and 4,000 more tokens of room. The model
is remembered, so later calls ask it right the first time.

| Model | Input /1M | Output /1M | Per source | 100 sources |
|---|---|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 | $0.46 | $46 |
| DeepSeek V4 Flash | $0.065 | $0.18 | $0.004 | $0.42 |

Estimated from 32,000 input and 12,000 output tokens per source.

Two steps carry the design and both are judgment work: extracting wide on a single read, and ranking which claims conflict. Run those on the stronger model and the cheap model on the rest, or test the cheap model on 10 sources and compare the cards. At $0.42 per 100 sources the test costs nothing.

## The tables

| Table | Holds | Indexed by |
|---|---|---|
| `brains` | name, type, scope, created, visibility, owner, space; `audit`, the last audit's date and source count; `apart`, the pairs kept apart; `findings`, what the last audit found | slug |
| `concepts` | brain, title, position, summaryLine, evidence, data, conflicts, sources, links and their kinds; in a personal brain, `tag: "contact"` and the other names a person goes by | brain, then slug |
| `sources` | id, link, date, author, location, brains | link, and the normalised link |
| `notes` | the six note sections | source id |
| `candidates` | brain, title, mentions, count | brain and slug |
| `config` | one space's gate salt, hash and attempt counter | key, one row per space |
| `mcpHits` | the public endpoint's per address counter | address |
| `accounts` | a member's name, a salted password hash, and optionally their sealed key | name slug |
| `sessions` | the token, when it expires, its kind and its space | token |
| `drafts` | a connector drop in progress | token |
| `fetches` | one row per transcript fetch, so the pace is visible | time |
| `models` | the model a workspace picked, the languages of its answers and its mic, and its favourite models with the day they were priced and each price | space |
| `vectors` | a concept's meaning as 1,024 numbers | concept, and a vector index by folder |
| `topics` | a folder's topics: title, line, the concepts in each | folder |
| `feedback` | each error report sent: workspace, sender in the demo, its first words, when. It counts the hour; the mail holds the rest. Cleared after a week | space, then time |
| `rawNotes` | everything said about a person of a personal folder, word for word and dated: one row a message, with the question it answered for an interview. Only that person's file reads it | brain, slug, then time |
| `moments` | a person's history in a personal brain, one moment a row: date, what happened, whether you were together. The person's file keeps the count and the last day together, and a read carries the newest 300; older years come a page at a time | brain, slug, then date |
| `interviews` | a personal brain's interview: each question answered, known from the notes or skipped, the one waiting, the twin test's answers and scores, the profile, and under `daily` today's log: its beats, the question waiting, the answers, the script and the series line | space, then brain |
| `insights` | what follows from two linked concepts: the pair, the kind of link, a title and a line | the pair, each side, space |
| `projectFiles` | the assets, one row each under `assets-<space>~n` (and the files of a project made before the assets, until it is turned into assets): its name, document, page or table, whether it was made blank, its sheets with each column and what it holds, its size, its version, whether it is still being read, the number of the version it replaced and whether it is that hidden version, and the web address it was read from | file |
| `projectCards` | the contents list: one light row for each section or block of rows, with its title, its line, its size and the keys it is found by (stems and numbers) | file and order, file and section |
| `projectSections` | the words of each section, or the CSV rows of each block | file and section |
| `projectEdits` | the changes a chat proposed to an asset, with what each replaced so it can be undone, and the new assets it proposed, with the number each was made as. The last 10 of each stay | file and time |
| `chatSpend` | what the workspace costs: one row a kind a month (UTC, "2026-10"), with the dollars the model host reported, the calls it gave a price for and all the calls, the tokens in, out and reused, and `reused`, the answers given again for no call. The kinds: `folders` (the main chat, a folder's, a concept's), `personal` (the personal chat, the interview, the daily log, remember, people and contacts), `assets` (a chat that tags one, a document read in, a project's notes), `drops` (read, plan, merge, settle), `upkeep` (linking, topics, conflicts, tidy, rederive), `pager` (one-pagers) and `voice` (Whisper, by the second). The demo is not counted | workspace and month |
| `answerCache` | a question asked to open a chat, and its answer: the key (the question in lower case, the folders, the tags, the level, the language and the model), the print of the folders it read, the answer, its source count, the concepts it opened and the folders tagged. A row is replaced when the same key is asked again, and rows older than 14 days go 20 at a time | workspace and key, workspace and time |
| `projectBriefs` | one row a folder of files: for the assets, the number the next one takes; for a project made before them, its Brief, State of play and open questions, read once for its notes | folder |

The duplicate check reads `sources` by normalised link, so it stays an index lookup at any size. Nothing else grows the read: summaries come from `concepts.summaryLine`, and only the shortlisted concept rows get opened in full.

## The chats

The folders' chat (the main chat, one folder, or the folders ticked) and the personal brain's chat read the brains, then answer. A message used to send every concept title to the router and open up to 30 concepts, so a question cost the same whatever it asked and grew with the size of the brains. What it sends now:

- **Thanks, a greeting or a goodbye** ("thanks", "ok thanks, that helps", "merci", "bonjour", "bye"; at most 6 words, one of them thanks or a greeting, the rest filler) reads nothing: one call of about 55 tokens in the folders' chat, about 440 in the personal chat, where nothing is filed, no concept is read and no interview question is asked in passing. A bare ok or yes, and anything with a request in it, is a question. A message that names a folder with @ is a question.
- **The meaning first.** The question is embedded before the router runs, and the 40 concepts nearest in meaning are found. With 20 or more found (the meaning of the folders is kept), the router is shown 120 titles: those 40, the nearest first, then the best matches by words. With fewer, or on a workspace's own key or the demo, which do not embed, it reads every title up to 80,000 characters, as it always did. A brain of 1,000 concepts costs the router 1,750 tokens, not 12,700. The personal chat's reply reads the nearest in meaning too, which it did not before.
- **What opens.** What the router picked, the concepts the question names in their title, the 6 nearest in meaning and the ones they link to open first, up to 30 within 60,000 characters. When the router picked something, a concept that only shares a word with the question fills the answer up to 8 concepts in all and no further: loose matches were most of what an answer held. A router that picked nothing or failed leaves every match to open, as before. Up to 40 more are named by title, within 4,000 characters, under ALSO HELD.
- **The thread.** The last turn is read in full, its question to 400 characters and its answer to 900. The three before it are read as the question to 200 characters and the first line of the answer, which is the answer itself in this chat. The thread only says what "the second one" points at: every claim still comes from what is stored.
- **The order.** What stays the same comes first: the rules, then the stored knowledge, then the thread, then what changes with this answer (the folders tagged, whether it reads a person's folder, how few sources it rests on, under ABOUT THIS ANSWER), then the question. A model host that reuses the start of a prompt can then reuse the rules and the knowledge of a follow-up that opens the same concepts.
- **The cost.** Each message is counted from the usage the model host reports, by kind, and added once the message is done, finished or not. Settings, Cost shows it.
- **A follow-up keeps its subject.** Each answer returns `opened`, the ids of the concepts it read (12 at most), and the page sends them back with the thread. The next message lists them first to the router, and shows it the first 300 characters of the last answer, so "and the second one?" finds what the last answer named. With no router, they open again. Only ids the chat may read are taken. A saved chat keeps them with each turn.
- **Close in meaning is not enough.** A concept the router saw and passed over opens on its meaning alone only at a cosine of 0.45 or more. A router that read the titles and picked none opens nothing, rather than the 30 concepts with the most evidence. When nothing was picked, nothing is close enough and no title carries the question's words, ABOUT THIS ANSWER says that nothing stored answers it directly, and the answer says so first, then gives what comes closest. The personal chat says it only for a question.
- **The Sources line is checked.** An entry whose author is in none of the opened concepts' evidence is taken out; a line left empty goes whole. One shared name is enough, so "Damodaran" counts for "Aswath Damodaran".
- **A number or a question mark is a question.** "Great, thanks. For 2025?" is answered, not thanked.
- **The same question twice costs nothing.** A question that opens a chat is saved with its answer, under a key made of the question (lower case, spaces and end marks trimmed), the folders asked, the tags, the level, the language and the model. Asked again within 14 days, on folders whose print has not moved, the saved answer comes back for no model call, and Settings counts it as reused. The print covers each card of the folders asked (its title, position, summary line, evidence, data, conflicts, links and file) and each folder's name and scope, so a drop, an edit, a rename or a new concept makes the next answer fresh. A follow-up reads its thread, so it is always answered anew.
- **Short or Long.** Settings, Answers sets how much a Normal answer reads, for the whole workspace, kept in `models.depth`. Long is the default: up to 30 concepts opened in full within 60,000 characters, and 40 more by their title. Short opens the 12 best within 30,000 characters, and 25 more by their title, for about a third less a question. Educational and Learning answers read in full either way. A saved answer is kept apart for each, so a switch never brings back an answer read the other way.
- **The meaning follows the concept.** A rename or a merge moves each concept's vector to its new folder as the concept moves, and a concept that goes takes its vector with it.

Measured on the code with a recording model: 12 folders, concepts of about 2,000 characters, a thread of 4, tokens as characters over 4, $0.065 in and $0.18 out per million. Before is the version that showed the router every title and opened every word match. Messages are in tokens sent, with the price of one message in cents.

| message | before | after |
| --- | --- | --- |
| folders, a question, 400 concepts | 16,935 tokens, 0.113 cents | 6,248, 0.043 cents |
| folders, a follow-up, 400 concepts | 17,679, 0.118 cents | 6,687, 0.046 cents |
| folders, thanks, 400 concepts | 9,284, 0.061 cents | 55, 0.001 cents |
| folders, a question, 1,000 concepts | 24,314, 0.161 cents | 6,258, 0.043 cents |
| folders, thanks, 1,000 concepts | 16,716, 0.109 cents | 55, 0.001 cents |
| personal, a question, 400 concepts | 20,231, 0.134 cents | 8,813, 0.060 cents |
| personal, thanks, 400 concepts | 11,949, 0.078 cents | 438, 0.003 cents |
| personal, a question, 1,000 concepts | 27,624, 0.182 cents | 8,823, 0.060 cents |
| personal, thanks, 1,000 concepts | 19,395, 0.127 cents | 438, 0.003 cents |

The size of the brains no longer moves the price of a question: 400 and 1,000 concepts send the same. One folder of 100 concepts, which the router read whole already, changes little (4,428 tokens to 3,952).

## What everything else costs

Every model call is counted in `chatSpend`, by kind, from the usage the model host reports. `spend.ts` holds the meter: `withChatSpend` opens a tally, each call adds its usage through the `meter` option of `ask`, and the row is added once the work is done, finished or failed. Settings, Cost lists each kind with its dollars and calls, and the answers given again for free.

| Kind | Counts |
|---|---|
| Folder chat | the main chat, a folder's chat, a concept's chat |
| Personal chat | the personal chat, the interview and twin test, remember, people and contacts |
| Drops | reading a source, the plan, the merge, the settle |
| Upkeep | linking, topics, what follows, conflicts and their hints, tidy, rederive |
| One-pagers | the page, its translation, the route of its question |
| Assets | a chat that tags an asset, a document read in, a project's notes when it turns into assets |
| Voice | Whisper, by the second of speech |

**What a drop sends.** A long source is planned in batches of topics, and every batch carries the concept list of the folders. The list now comes right after the rules and the folders chosen, and what changes with the batch comes last: the titles filed so far, a second try, the topics. A model host that reuses the start of a prompt bills the list at full price once per source, and at its lower rate for every batch after the first, while the list fits whole. The settle sends the new source first and the concept last. A source that fits the limit goes whole; a longer one sends only the topics the concept draws on, and all of them when none matches.

## Restore from export

Settings, Export writes every folder of the workspace as one markdown file: a MAP of the folders with their names, the SOURCES with their titles, each folder's SUMMARY, and each concept with its title, summary line, position, evidence, data, open conflicts, sources, typed links and other names. Settings, Restore reads that file back in one step. `restore.ts` reads it by its headings, so an export from before titles, names and links were written still restores: a title then comes from the folder's summary list, and a name from the slug. `restoreBatch` in `store.ts` adds what is missing and keeps what is there, so a restore run twice adds nothing the second time. Assets are not restored: they are files, which an export does not hold.

## Install as an app

Tasu installs from the browser, with no app store. `app/manifest.webmanifest` names it, opens it on `/chat` in a window of its own, and gives the icons: 192 and 512 pixels, a 512 one with room to be cut round, and the SVG, all drawn from the brand mark on white. Settings, App does the rest. Where the browser offers its own install prompt (Chrome and Edge on a computer, Chrome on Android), App opens it and says what was chosen. Where it offers none, App says where to tap: on an iPhone or an iPad, Share then Add to Home Screen; on a Mac in Safari, File then Add to Dock. Installed, it says so, and the app opens on the workspace used last. Nothing is sent to the server: the page check reads the manifest, its icons and their sizes.

## Assets

The documents, tables and pages a workspace keeps for its chats. They are the files of one hidden folder per workspace, `assets-<space>`, made the first time an asset is added and never listed among the folders (`files.ts` holds them, `reader.ts` reads them in, `assets.ts` holds the chat). Each asset is `assets-<space>~n`, n from 2 and never used twice, and every route names it by that number, `file`. A workspace holds 100. The demo keeps none.

**Reading one in.** The file is read in the browser and sent in pieces. A document is cut in sections of about 12,000 characters (3,000 tokens), up to 1,000 of them, about 4,000 pages; each gets a title and a one line summary, written 4 sections a model call, and the words it is known by (its most used stems and its numbers, made in code). A section the model leaves out keeps its heading and its opening words, so a busy model never stops a file. A table is cut in blocks of rows, up to 6,000,000 bytes, about 40,000 rows of 10 columns, and each column's totals are read over every row once the last piece is in.

**A chat calls one with @.** The app lists the assets beside the folders when @ is typed, and sends the numbers of those a message names as `assets` beside its folder `tags`, 4 in all. A message with an asset goes to the asset chat, on the workspace's key and counted under Assets: a table of up to 120,000 characters is read whole, every row; a bigger one gives its columns and first rows, and one cheap call names a filter and totals the server runs over every row, so a count or an average is exact at any size. A document of up to 60,000 characters, and any page, is read whole; a longer document opens the 8 sections its words point at (a word in a title counts 3, in the words a section is known by 2, in its summary 1), with the contents line of every other. A web page kept as an asset is said to be that page, as read on its date. The folders tagged beside it are read as the folders' chat reads them. The answer is JSON: the reply, the changes it proposes to each asset, and a new asset it proposes.

**Nothing changes without the owner.** A change is checked against the asset as it stands and kept as a proposal on that file (`projectEdits`), with the words before and after; a change on words that are not there, or that stand twice, is left out and the answer says why. A table takes changes to cells and rows, rows added at the end in one change, whole columns removed (`dropcols`, every row rewritten without them, up to 400,000 characters of sheet), or a rebuild of a sheet of up to 1,000 rows. A reply cut off before its end keeps its answer and proposes nothing. Apply checks it again and writes it whole or not at all; Undo puts back what it replaced, when that part has not changed since. A new asset is kept as a proposal on the assets themselves, with what it will hold; Apply makes it (a blank file of its kind, then its changes, applied), Undo takes it away. The chat turn keeps its proposals, and a chat opened again asks where they stand.

**Versions.** A file read in as an asset's new version takes a new number and keeps the number of the one it replaces through its read; when its last piece is in, the old one is hidden and kept, and a version older than that goes. Undo brings the hidden one back and takes the new one apart. One version back is kept.

**Web pages.** A link is read by the same fetch as a drop (`/api/fetch`: https, public hosts only, 60,000 characters), and kept as a document with its address. Read it again makes a new version.

**Projects from before** are turned into assets once, from a line in Assets that lists what each becomes before anything moves (`/api/assets/adopt`). The notes come first, while the project holds them: its Brief, where it stood, the questions still open and every note of its memory, as one document, "Notes of" the project. Then its files move in batches of 400 rows, their sections, contents and changes with them, and the project goes with its memory and the sources it alone rested on. Its chat thread is not kept.

**What the browser reads.** PDF (pdf.js, with its layout rebuilt from where each piece of text stands: headings by size, tables from cells that line up, lists, paragraphs that wrap, two columns read one after the other, running headers and footers left out, 30 pages at a time), Word (mammoth, as Markdown), HTML (kept as a page in Assets, read as Markdown in Drop: scripts, styles, menus and forms left out, the main part kept, the title as the heading), text and Markdown, CSV, and Excel (SheetJS 0.18.5, the last version cdnjs carries, loaded the first time an Excel file is chosen and checked against the hash cdnjs publishes). Each file is read in the tab and only its words and rows are sent. SheetJS 0.18.5 has two published weaknesses, a prototype pollution and a slow pattern, that need a crafted workbook: the app skips a sheet named like an object's own parts, and the file is the one the owner chose to open in their own tab. A scanned PDF has no text to read and says so.

## Steps that need a server

| Step | Why it cannot stay in the browser |
|---|---|
| The passphrase check | A browser check can be edited out |
| Every model call | The key would be readable |
| The settle write | Positions must be rewritten in one pass, atomically |
| The weekly digest | It runs on a schedule, with no browser open. `crons.ts` calls `digest:send` every Monday at 06:00 UTC and mails `DIGEST_TO` |
| The daily model check | It runs on a schedule too. `crons.ts` calls `admin:pickCheapest` every day at 05:30 UTC: each workspace with favourite models is set to the cheapest of them |
| Upkeep | `crons.ts` calls `admin:upkeep` every day at 05:40 UTC. It runs each one-time repair it has not finished, a page at a time, then marks it done in `config`: every vector pointed at its concept's folder again (a rename or a merge once left them behind), and the tables of removed features emptied. Once both are done it reads two rows and stops |

Reading brains and rendering the card can stay client side, because that data is already yours.

## The MCP server

Each project has its own address, made in Settings inside that project. It
carries a key, `?k=...`, and reads and feeds that project and no other: the
Octopus address never sees Squidgy, and the reverse. Add both to a client to
reach both. The key belongs to the project's holder account, `owner` for
Octopus and `owner-squidgy` for Squidgy, and any other account's key opens
nothing.

With no key, `/mcp` reads the Octopus brains, as a custom connector anyone can
add. It carries no passphrase. Three properties make that safe:

| Property | Why it holds |
|---|---|
| Spends no credit | No route here calls a model. The reader's own Claude does the thinking |
| Cannot corrupt a brain | Every tool reads. There is no write, no drop, no settle |
| Cannot drain the quota | 120 calls per 10 minutes per address, counted in `mcpHits` |

That last property matters because the endpoint is open. At 4 to 6 calls per
question, the Convex free tier covers roughly 50,000 questions a month, and the
overage beyond it runs $0.22 per extra gigabyte moved.

The tools:

| Tool | Returns |
|---|---|
| `ask` | The positions bearing on a question, their dated evidence, open conflicts, and how to write the answer |
| `list_brains` | Every readable brain with its scope line and its counts |
| `read_brain` | One brain's scope plus one line per concept |
| `read_concept` | A position, its dated evidence, its data, its open conflicts |
| `search_brains` | Keyword matches across every concept, title hits ranked first |
| `list_sources` | What a brain has read, newest first, with links |

Transport is Streamable HTTP, so any client speaking it reaches the server, not
only Claude. A POST carrying one JSON-RPC request gets one JSON object back,
which the spec permits in place of an SSE stream, so the server stays stateless
and issues no session id.

Four methods are registered on each of `/mcp`, `/mcp/v0` and `/mcp/v1`, so a
client can be pointed at the bare path or at a pinned version and reach the same
handler.

A `pathPrefix` of `/mcp/` was tried first and is not what this router honours
next to an exact `/mcp`: it registered without error, then matched nothing, and
every path under it answered 404 on the live deployment. Adding another label is
one entry in `MCP_PATHS`. `GET` answers 405, since nothing here
pushes to the client. An unsupported `MCP-Protocol-Version` answers 400.

Raw transcripts never entered the store (R8.6), so opening this endpoint shares
the synthesis and the source links, never the source text.

To check it is live:

```
curl -s -X POST https://<deployment>.convex.site/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Who may feed a folder

One kind of session opens the app: a workspace passphrase. That owner reads and
feeds every folder of the workspace, and the workspace's model key pays for
every call. Member accounts, guest keys and saved personal keys were removed.
One account record per project remains, without a password, only to hold that
project's connector address.

`canDrop` in `lib.ts` is the whole rule: the caller owns the session, and the
folder is not a read-only share from another workspace (`isViewer`). A folder
shared with a second workspace can be fed from there; a share given to the demo
stays read only. `check-store` covers each case.

Every source row records `by`, the account that fed it, so a contribution can be
traced and undone. Old rows keep a `visibility` field from the account era; no
code reads it, so no row needs migrating.

## Export stays the contract

`PROTOCOL.md` remains the authority and markdown remains the portable format. Both runtimes export the same shape, so a brain built in one opens in the other.
