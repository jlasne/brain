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
| `/api/public/brains` | Octopus |
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
is the language the mic listens in, one of en-US, fr-FR, es-ES, de-DE,
it-IT, pt-PT, or null for the browser's. Both are set through `/api/models`.

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

Projects, saved one-pagers, the Limited or Full side panel, the map, the scouts and the lab are gone from
the code. Their tables stay in `schema.ts` until emptied, so a deploy accepts
the rows still there: run `npx convex run admin:clearRemoved --prod` until it
says `runAgain: false`, then delete the definitions of `modes`, `projects`,
`onepagers`, `pages`, `gaps`, `heat`, `scouts`, `finds`, `labs` and `labTurns`.

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
app/
  index.html       the interface, pointed at the deployment
vercel.json        serves app/ as the site root
```

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
| `/api/ask` | The answer. With `concept`, it reads that one concept alone; in a personal folder, what the message adds or corrects is written to the note or the person's file at once, and `changed` says what moved. With `tags`, the slugs of folders named with @ in the message, it reads those folders and no other (in the personal chat: the personal folder, those folders and those projects), and `tagged` (`called` in the personal chat) names them | Yes |
| `/api/models` | The workspace's model, and the languages of its answers and its mic. `null` goes back to the default. A model picked here ends the daily choice among favourites, and the answer says so (`favs: null`) | Owner |
| `/api/onepager` | A summary in bullets of a brain, a group or a question, or a document: a quiz, a deep dive, use cases, or a type you describe. Built, shown and never stored. Sends it too, when given an address | Yes |
| `/api/fetch` | Opens a link, or fetches a video's transcript | Yes |
| `/api/usage` | What transcripts have cost, from both sides | Yes |
| `/api/doc` | The connector page's words, served rather than published | Yes |
| `/api/lock` | Drops the session | Yes |
| `/api/brain/tidy` | Reads one folder for concepts filed twice, titles not in English and concepts with no position. Proposes only, and keeps what it found on the folder, for the inbox's decisions | Yes, owner |
| `/api/brain/audit` | Stamps a folder's last audit: its date and its source count. With `action: "apart"`, keeps a pair of concepts or people apart, so no audit proposes them again. With `action: "dismiss"`, takes one finding off the folder: a title kept, a position left empty | Yes, owner |
| `/api/concept/merge` | Folds concepts of one folder into the one kept, then writes its position again from the joined evidence | Yes, owner |
| `/api/concept/rename` | Changes a concept's title. Its id and links stay | Yes, owner |
| `/api/concept/rederive` | Writes positions again from the evidence each concept holds, eight per call | Yes |
| `/api/brain/merge` | Merges one folder into another in the same workspace, then deletes the first. Owner only, never the personal folder | Yes |
| `/api/personal/contact` | A person's file by hand: `edit` sets its name, other names, line and summary (the old name stays as another name); `part` takes one fact, moment or link out, or marks an open item done; `merge` folds other files of the same person into it, then writes the summary again; `peek` (`ids`, up to 20) gives each file in a few lines, read only: names, line, summary, up to 6 facts that still hold (contact details first), the 2 latest moments, mentions, open lines and the day last seen, so a same-person call is made by looking | Owner |
| `/api/personal/open` | What is still open in a personal brain, for every person. Each person's card carries `open`, the count of their open lines, so the app counts them with no read; a card made before that gets it from the first `list`, which writes the ones that differ. `list` (the default): the people with an open line, the oldest first, each line with its key. Lines that say the same thing (the same keywords, the person's name aside) are made one when listed: the oldest stays, with the newest wording. `send`: the owner's comments on up to 25 lines, read in one model call: a line is closed, dropped or reworded by its key, a follow-up (3 a line) or a moment of the history may follow, and each comment is kept word for word in that person's raw notes. A line the model passed over, or that did not save, comes back in `retry` | Owner |
| `/api/personal/remember` | A memory or a message filed into a personal brain. It returns what it kept as text, so the app checks every number, date and name. With `gaps`, the passages a first filing left out; with `verbatim`, what two filings left out, kept word for word with no model call | Owner |
| `/api/personal/page` | One page of a person: the moments of a `year`, or the raw notes of a `month` | Owner |
| `/api/personal/people` | The people in a personal brain's older notes, filed as contacts, 20 notes a call; the app calls again with `at` until `next` is null | Owner |
| `/api/interview` | A personal brain's interview, by `action`: `state`, `start` (on, and its next question), `stop`, `restart`, `test` (the open round of 5 messages to reply to, built from the notes, or `fresh: true` for another), `check` (your replies, and the twin replies the same from the notes alone, with its reasons), `score` (a model compares the two, 0 to 2 a question, and the round goes into the history), `learn` (your answers filed as notes) and `profile` (the notes as 7 parts, offered until the interview reaches 100%). While on, `/api/ask` in that brain's chat takes each message as an answer | Owner |
| `/api/feedback` | Send feedback: mails one error, where it happened, the workspace and the message to `FEEDBACK_TO`, else `DIGEST_TO`. Another workspace's personal message keeps its words out. 5 an hour per sender, 20 per workspace | Yes |
| `/api/project/new`, `/rename`, `/delete` | A project is a folder of type `project`: made from a name, renamed (its slug stays, so its file and thread stay with it) or taken apart a batch at a time. `new` takes `make`, `doc`, `table` or `html`, to start with an empty file the chat will write. Never shared, never merged, never listed among the folders | Owner |
| `/api/project/begin`, `/part`, `/finish` | One file, page or table, read in the browser and sent in pieces. `brain` is the file's key: the project's name for the first file, `name~n` for the others (see Several files). A piece of a document or a page is cut in sections of about 12,000 characters, each given a title and a line by one model call. A sheet's rows are cut in blocks. `finish` reads every row once for each column's totals, writes the note on the file, then the file opens. A new file clears the old sections and the old note, and keeps the rest of the memory and the thread. The page sends one only for a project with no file, and for a file that stopped part way; a file that is read stays | Owner. `part` and `finish` run a model |
| `/api/project/get`, `/list`, `/doc`, `/rows`, `/download` | The project's file (the one `file` names, the first by default) with its contents, changes and the routes it learned; the project's thread, memory and Brief; the list of its files (`files`), and where the changes shown in the thread for other files stand (`editState`); the list of projects, each with how many files it holds; sections of a document and rows of a sheet as the screen scrolls; the file as Markdown, HTML or CSV, read in pages of 3 MB; the page writes the format asked from that text | Yes |
| `/api/project/chat` | One message, to a project with files or with none (`file` names the one that is open, the first by default; a change goes to that file only): with none, the first description makes the file. A cheap step reads the contents list (or a table's columns) and the titles in memory, and says which sections to open, which filter and totals to run over every row, whether the message needs none of the file, and whether the owner's other folders could help. With `tags`, the folders the owner named with @ are the ones read, and a short file then needs no router call. The answer reads that, the memory that bears on the question and those folders, returns a tldr, its support, whether it had enough to answer, and what it cost, and may change the file: at once for a file made here, as a proposal for a file dropped. What the owner said is filed in memory beside it. The last 4 exchanges stay | Owner |
| `/api/project/instructions` | Older projects only. Instructions typed, pasted or read from a file: one model call writes up to 8 notes tagged `instructions` in the project's memory. The page no longer calls it: it saves a Brief instead, and saving a Brief forgets these notes | Owner. Runs a model |
| `/api/project/brief` | What frames the chat besides its notes, by `action`: `save` the owner's Brief (no words clears it; 6,000 characters kept; any instruction notes are forgotten), `write` a Brief from the owner's answers to five questions (one model call; nothing is kept until the owner saves it), `state` the State of play edited by the owner, `next` the closing next step on or off, `drop` a question the chat waits on | Owner. `write` runs a model |
| `/api/project/file` | The project's files, by `action`: `new` (a `kind`, a `name`; with `made: false` the file waits to be read in by begin, part and finish, else it is blank and ready for the chat to write; it takes the next free number, 30 files at most), `rename` (`file`, `name`) and `remove` (`file`: its sections, changes and meaning go, and the notes that rested on it are marked as possibly outdated; the project and its other files stay; a large file asks to be removed again until it is gone) | Owner |
| `/api/project/gaps` | The gaps in the project's file, found in code with no model: placeholders nobody filled, empty cells, dates in the past, two numbers for one thing. At most 25 are returned, with how many there are | Session |
| `/api/project/spend` | What the projects cost: this month's dollars (as the model host reported them), calls and tokens (in, out, and the part reused), the month before, each project's share (a deleted project keeps its row, under no name), and the cap. With `cap` set to a number of dollars it sets the cap (to the cent, above 0 and at most 100,000), and with `null` or an empty string it removes it | Owner |
| `/api/project/resource` | A resource the owner dropped into the project, typed, pasted or read from a file in the browser: one model call writes up to 8 notes in the project's memory, in the folder format, each resting on the resource as its source (`Resource: name, date`, one source for each, `Resource, date` when typed). The page sends a long text in pieces of at most 20,000 characters, up to 5. A note on a topic already held is updated, never doubled; a note never takes the title of an instruction or of the note on the file. The notes are read like any note: by the question | Owner. Runs a model |
| `/api/project/forget` | Forgets one note of the project's memory, an instruction too. Notes are filed by the chat itself | Owner |
| `/api/project/edit` | Applies, undoes or turns down a change the chat proposed, whole or not at all. `brain` is the key of the file the change was made for. The last 10 of each file are kept to undo | Owner |
| `/api/brain/visibility` | Hides a brain from the public endpoints, or shows it again | Yes |
| `/api/public/brains` | Every brain and its concepts, for the `/brains` page | No, by design |
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
| `interviews` | a personal brain's interview: each question answered, known from the notes or skipped, the one waiting, the twin test's answers and scores, and the profile | space, then brain |
| `insights` | what follows from two linked concepts: the pair, the kind of link, a title and a line | the pair, each side, space |
| `projectFiles` | a project's files, one row each (the first under the project's name, the others under `name~n`): its name, its one line for the map of files, document, page or table, whether it was made in the project, its sheets with each column and what it holds, its size, its version, whether it is still being read, and the routes it learned: where things are | folder |
| `projectCards` | the contents list: one light row for each section or block of rows, with its title, its line, its size and the keys it is found by (stems and numbers) | folder and order, folder and section |
| `projectSections` | the words of each section, or the CSV rows of each block | folder and section |
| `projectThreads` | a project's running thread: its last 4 exchanges | folder |
| `projectEdits` | the changes the chat proposed to a file, with what each replaced so it can be undone. The last 10 of each file stay | file and time |
| `projectSpend` | what the projects cost: one row a project a month (UTC, "2026-10") with the dollars the model host reported, the calls it gave a price for and all the calls, the tokens in and out and the part reused. A project taken away keeps its rows, so the month's total is what was spent | workspace and month, project and month |
| `projectBudget` | the most a workspace's projects may cost in a month, when its owner set one | workspace |
| `projectBriefs` | what belongs to the project as a whole: the Brief, the State of play, the questions waiting for the owner, whether answers end with a next step, and the number the next file takes | folder |
| `projectVectors` | the meaning of each section of each file, one row of 1024 numbers a section, searched inside one project | project |

The duplicate check reads `sources` by normalised link, so it stays an index lookup at any size. Nothing else grows the read: summaries come from `concepts.summaryLine`, and only the shortlisted concept rows get opened in full.

## Projects

A project is one file, one table or one HTML page with a chat beside it and a memory of its own. It is a folder of type `project`, so its memory has the format every folder has: concepts with a position and dated evidence. Everything else about it lives in six tables of its own. A file comes from a drop, or is made in the project: the owner picks a document, a table or an HTML page, describes it in the chat, and the chat writes it.

**Size does not set the cost.** A document is cut in sections of about 12,000 characters (3,000 tokens), up to 1,000 of them, about 4,000 pages. Each gets a title and a one line summary when it is read in: that is the contents list. A question does not read the file. One step reads the contents list, the titles of what the project remembers, and the question, and names the sections the answer needs, so the answer reads up to eight sections and the cost follows the question. A file of more than 40 sections shows that step a short list first (see Memory as a shortcut below). The same step says when a message needs none of the file (thanks, small talk, a question the memory answers) and when it is about the whole file. A file under 8,000 characters, about 3 pages, is read whole and needs no contents list. A file up to 48,000 characters, about 16 pages, is read whole only when the message is about all of it, or when a change to a page needs its markup and its style together, or when the step fails. A longer file asked about as a whole is answered from its contents lines, which summarise every section. When the file is short and there is no other folder to consider, the step is skipped.

What one message costs, measured on this code with a recording model and DeepSeek V4 Flash prices ($0.065 in, $0.18 out per million tokens), with the memory call included:

| A message in | Small talk | A question |
|---|---|---|
| a project on a file of 1 page (3,000 characters) | $0.00021 | $0.00025 |
| a project on a file of 13 pages (40,000 characters) | $0.00020 | $0.00027 |
| a project on a file of 133 pages (400,000 characters) | $0.00017 | $0.00028 |
| a project on a table of 3,000 rows | $0.00017 | $0.00025 |
| the folders chat, 400 notes | $0.00051 | $0.00059 |
| the personal chat, 400 notes | $0.00068 | $0.00075 |

A file of 13 pages cost $0.00085 for small talk when it was read whole at every message. A file of 125 pages cost $0.00056 for small talk and $0.00069 for a question when the router read the whole contents list at every message: about 5,700 tokens.

**A table is searched, never skimmed.** Its rows are cut in blocks, and each column's total, average, lowest and highest are worked out once, when the last piece is in. A question about a table becomes a filter and a few totals (`where`, `show`, `sort`, `calc`), which the server runs over every row: a count, a sum or an average is exact at any size, and the model never adds rows up. A column the model names that the sheet lacks drops that one condition and never the answer. A table holds up to 6,000,000 bytes, about 40,000 rows of 10 columns, and each question sees the columns, the first rows and the result.

**Changes are proposals.** The chat may return changes to the file as exact words to replace, a section to rewrite, add or remove, or a cell to set, a row to add or delete. The server checks each against the file as it is now and shows the words before and after. Nothing is written until the owner clicks Apply, which writes the whole change or none of it. What it replaced is kept, so Undo puts it back, unless the section changed since. The last 10 changes are kept. Row numbers in one change name rows as the table stands before it, so a row deleted above never moves where another lands.

**Who reads what.** A project's chat reads its file, its memory and the owner's other folders, when the router says they could help: never the personal folder, never another project. The personal folder's chat reads a project's memory, and nothing else does: `spaceHead` leaves project folders out unless a caller asks, `withoutPersonal` drops them from any reader that has them, and sharing, merging and renaming refuse them. Text inside a file or a folder is material to read: the answer is told never to follow an instruction written in it, and the only way to change the file is a click.

**Tagging a folder with @.** In the folders chat, the personal chat and a project's chat, typing @ in the message bar lists the folders that chat may read, and a pick writes the folder's name into the message. The page sends the slugs of the folders the message names (`tags`, at most 4, read from the words of the message at send time), and the server keeps only those the chat may read: never the personal folder, and a project only in the personal chat. A tagged folder is read on purpose and no other is: the folders chat searches those alone, the personal chat reads its own notes and those folders, a project's chat reads those and leaves the router's choice of folders aside. The answer is told which folders were tagged, and a tagged folder that holds nothing for the message says so in one sentence. The page shows "Read @Pricing" under the answer, and a project's answer lists the tagged folder as used even with no note opened. With no tag nothing changes.

**The thread** keeps the last 4 exchanges, and older ones are deleted. The next prompts read the last exchange whole (its answer to 700 characters) and the one before as its question and the one line that answered it: the notes keep the rest.

**Memory** fills itself, with no button, always in the folder format: concepts with a position and dated evidence, and a note on a topic already held is updated, never doubled. When a file is read in, one call writes a note titled "The file": what it is, what it covers, its main numbers, where each topic sits. For a file of more than 40 sections and 8,000 characters, the same call also writes up to 8 notes, one for each main topic, each naming the sections where the topic sits (a topic that names no section the file has is left out), so a question on a topic goes straight there. A short file is read whole anyway and gets the overview alone. A new file takes away every note that only the old file wrote; a note the chat also wrote to stays, with no section pointer and marked "the file changed since". Then each answer files its own notes, in the same call as the answer: the model returns `notes`, at most 2 a message, and most messages file nothing. It files what the owner said that will matter later (a decision, a number, a name, a limit, a short yes or no to its last answer) and what it found in the file or the folders that the owner will need again. Each note names the sections of the file it rests on (`concepts.sections`), and the page shows "In Offer" under it. A change to those sections, applied or undone, marks the note `stale`: it is shown to the model as "[the file changed since]" and told to check the file, and a note filed again on the topic is up to date again. The call that used to read the owner's message and file it is gone, and so is the Keep in memory button and its route: one model call fewer a message. The router reads the nearest 8 notes with a line each, and a note that states the answer lets it open no section. A note that rests on sections also leads the short list to them, like a route. The answer reads the note on the file first, then the notes that share a word with the question, then only the newest two of the others, within 3,000 characters. The personal chat reads all of it. A note can be forgotten from its own view in the Memory list.

**The Brief.** The Brief is the owner's words on who the chat is in this project: the goal, the audience, the tone, what to always and never do, when to speak up. It is one text of up to 6,000 characters (about 1,500 tokens) in `projectBriefs`, written when the project is made (typed, pasted, or added from a Word, PDF, text, Markdown or HTML file, never a table), or later from Memory, or from five questions: the owner answers by voice or by text, and one model call (`write`) turns the answers into labelled lines (Goal, Audience, Tone and format, Always, Never, Speak up when) that the owner reads, edits and saves. Saving costs no model call. Every message reads it, apart from thanks: it sits in the rules of the answer under "THE BRIEF", after the rules that never change and before the rules for changing the file and for the memory, so the part a model host reuses is as long as it can be. The rules say it never changes the reply format and never allows a number that was not given. It is never in PROJECT MEMORY and never in the router's prompt. A project made before the Brief keeps its instruction notes (the owner's earlier text filed as up to 8 notes tagged `instructions`, read first in the order filed, up to 2,400 characters, under "THE OWNER'S INSTRUCTIONS") until a Brief is saved: the Brief starts from them in the editor and takes their place.

**The State of play, what is still open, the next step.** Each answer may carry three more fields, only when the message is not small talk. `state` is the chat's own summary of where the project stands (60 to 130 words: the goal, what is decided, what is open, the next step), rewritten only when the exchange changed it, in the same call as the answer, so it costs about 200 output tokens on the one message in three that changes it and nothing on the others. It is read at every message under "STATE OF PLAY", as material and never as an order, and the router reads it too. `asks` are at most two short questions that block the work and only the owner can answer; they get a four-letter id, the 8 newest are kept, and a question the list holds already is not added twice. The next messages read them under "STILL OPEN", and `answered` names the ones a message answers, which are taken away. A message that small talk would be, but that comes while a question waits, is still read with the State and the questions, since a short word may be the answer. `next` is one line under 15 words, written as the message the owner could send next; the owner can turn it off for the project. The page shows the questions and the next step as buttons under the answer: a tap puts the words in the message bar, to answer by voice or text, and nothing is sent by itself. The turn says `stated`, `asks`, `answered` and `next`; the owner reads and edits all of it from Memory, and a failure to keep any of it never fails the answer.

**What the projects cost.** Every call a project makes to a model is counted from the usage the model host reports with it: the router, the answer and a second look, the folder router when a folder is read, a contents line for each section of a file read in, the note on the first file and the line of the others, a resource, instructions and a Brief written. The tokens are always kept, and the dollars when the host gives a price, so a call it gave none for counts in the calls and not in the priced calls, and Settings says the dollars may be low. One row a project a month in `projectSpend` is added to once a message, a piece of a file or a Brief is done, whether it finished or failed, since a call that answered was paid for. The meaning of the sections (embeddings) is not counted: it costs under $0.01 per million tokens. The owner reads it in Settings, under Projects cost: this month and the month before, the tokens with how much was reused, and each project. A turn carries the same figures for its own message, now with the folder router's call among them. The owner may set a cap in dollars for the month. Before a message, a file read in (at `begin`, so the old file is not cleared, and at each piece and at the end), a resource, instructions or a Brief written asks a model anything, the month's dollars are read, and a cap that is reached stops it with a sentence that says how much was spent and where to change it. Reading, saving a Brief, a rename, Apply and Undo ask no model and are never stopped. A new month starts at zero; the month before is only shown. The what-stays-the-same-comes-first order of a message's prompt is what lets the model host reuse the start of it, and the reused part is the one figure Settings shows beside the tokens to show it works.

**Several files.** A project holds up to 30 files: documents, pages and tables, each read in as the first one was, or made blank and described in the chat. The first is kept under the project's name and the others under `name~n` (n from 2, never used twice, even after a file is removed, from a counter in `projectBriefs`), in the same tables as ever; the thread, the memory, the Brief and the State of play belong to the project and take its name. One request changes one file, the open one: the chat is told to name the file to open when a change belongs elsewhere, and the page keeps each proposed change with the file it was made for, so Apply and Undo reach that file from any tab. The other files are read, never changed, and in two ways. Every message is told what else the project holds, one line a file (`id | name | what it is`: a document's line is one model call over its contents list when it is read in, the first file's is the summary line of its note, a table's is made in code from its sheets and columns), so it knows what exists. And the sections of the other files that bear on the question are found with no model call, by two searches that miss different things. By words: each section keeps the 40 stems it is known by (the most used, the names, and the numbers of three digits or more, with 1,290 and 1.290 and 1 290 all read 1290), and the question earns a section 3 points for a word in its title, 2 in its keys and 1 in its summary. By meaning: each section's title and summary is embedded when the file is read in (`projectVectors`, 1024 dimensions, searched only inside the project), and the question is embedded once, so a question in other words, or in another language, finds a section it shares no word with. A section is read when it earns 3 points or comes within 0.45 of the question in meaning; the two lists are merged by rank; at most 3 sections and 6,000 characters are read from the other files, a long section as the passages that bear on the question. A question the other files do not touch reads none of them. If the embedding fails, the words alone search. A note names a section of the first file by its number and a section of file n by n times 100,000 plus its number, so a note on another file is found and goes stale when that file changes. A question the project has answered before, from the same sections, in nearly the same words, goes there with no router call once it has done so twice. Removing a file takes its sections, cards, changes and meaning; the notes that rested on it lose those sections and are marked as possibly outdated, and removing the first file also forgets the note on the file and its topics. The others stay, and the next file added takes a new number. A project's delete takes every file with it.

**Gaps.** `/api/project/gaps` reads the file in pages, as a download does, and scans it in code (`convex/gaps.ts`): a bracketed label nobody filled ([Creator name], {{price}}), TBD, TODO and their French forms; in a table, a column filled in part or empty, and a placeholder in a cell with its row; a date in the past on a line that says launch, deadline, release or the like; and two different amounts for the same two words ("team plan" at 1,290 and at 1,190) in two sections. A link, a footnote number, a checkbox and a page mark are not placeholders, and a page is scanned as a reader sees it. The page shows them under a Gaps button, and a tap puts a request to fix one in the message bar. The answer is also told to say, in one line at its end, when what it read holds a gap or two numbers for one thing.

**Memory as a shortcut into a long file.** A project keeps what it learns about where things are, and uses it so that a long file is not read at every message. It is automatic and costs no model call. After an answer that opened sections, the project stores a route in `projectFiles.routes`: the stems of the words of the question and of the router's English search words, the sections that answered, how many times, when, and the question that last used it. A route resting on the same sections takes the new words; any other makes a route of its own; the latest 40 stay, and a new file takes them all away. A route is a pointer and never an answer: the answer is always written from the sections as they stand, so a changed file never makes it stale. Before the router runs on a file of more than 40 sections, `shortlist` builds a list of at most 12 lines: the routes that cover at least half the question's words (marked with a star), then the sections the last exchange opened, then the sections whose title or summary share words with the message. The router reads that list and a count of the others. When none fits it sets `more`, and the whole list is shown, once. The answer's list of titles it did not open is cut to the likeliest 12, and the router sees 120 characters of each summary. Each turn records how many sections it read of how many, and whether memory led; the page shows "Read 2 of 111 sections", and the Memory list shows the routes under "Where things are". Messages with no word in common with any section cost one short router call. A router that cannot answer teaches nothing.

Measured on a contract of 428,000 characters (89 sections of 2,000 to 6,000 characters), with a router that opens the sections a line names. Before is the version that showed the router every contents line and filed notes in a call of its own. A price is one message, in dollars; the tokens are the ones sent in:

| A message | Before | Now |
|---|---|---|
| a first question on a subject its words name | $0.00047, 6,700 tokens | $0.00026, 3,600 tokens |
| the same subject again | $0.00049 | $0.00027 |
| thanks | $0.00025, 3,700 tokens | $0.00007, 960 tokens |
| small talk that is not thanks | $0.00024 | $0.00013 |
| a question in other words, first time | $0.00075 | $0.00058, the short list then the whole list |
| a question that calls a folder of 400 notes | $0.00114, 17,100 tokens | $0.00050, 7,200 tokens |
| the first eight messages in all | $0.00346 | $0.00204 |

A hit saves 45% and a miss 23%.

**What a message sends.** Only what the message needs. What stays the same comes first and what changes comes last, so a model host that reuses what it was sent before can reuse the most: in the answer's rules, what never changes and then the Brief; in the message, the file, the State of play and the questions still open, the notes, the folders and the last exchange, and then the date, what the message seems to want, and the question. The router reads its rules, the file's contents list and the folders first, and the message last. The rules for changing the file (and the `edits` field) go in only when the router says the message changes the file, when the file is empty, or when the router could not say. The rules for the memory and its `notes` field are left out of small talk. The router is told what to return for this kind of file: sections for a document or a page, a query for a table, `more` only when it is shown a short list, `kind` only when there is no file. Each turn carries what it cost, as the model host reports it: tokens in and out, the part reused from before, and the price in dollars (`usd`) when the host gives one, added over every call of the message. The page shows it under the answer, in dollars, like "4.1k in · 310 out · 2k reused · $0.00052".

**Passages.** A section of 2,500 characters or more that a question opens is read as passages: its opening line, the paragraphs that share the most words with the question and with the router's English search words, and the paragraphs beside them, up to two fifths of the section (1,200 to 2,400 characters), in the order they stand, with [...] where parts are left out. A section that no word reaches, or one that would lose less than a fifth, is read whole. A change, a brainstorm, a page and a message the router could not read take their sections whole. When the passages lack what the question needs, the answer is `{"more":true}` and the sections go again whole, once: that message pays for two answers. The page says "passages" beside "Read 2 of 89 sections".

**Thanks.** A message made only of thanks, a greeting or a goodbye, in English or French, needs no section, no note, no folder and no router: one call and about 960 tokens. A bare ok or yes still goes through the router, since it may answer the question before it.

**Folders as support.** A project reads the owner's folders to support its file, so it reads less of them than a folder chat. The folder router is shown the 120 titles nearest the message, the nearest by meaning first and then by words with the router's English search words, instead of all of them. The answer holds 10 concepts of a folder in full and 25 more by title, instead of 30 and 120. A file built from the folders keeps the full dossier.

**The answer is plain.** The model returns `tldr`, the answer or the decision in one or two sentences, and `reply`, up to 4 short lines of support with their sources, empty when the tldr is enough. Small talk gets one line and no tldr. The page shows them as one plain answer, as the normal chat does: no label, no chip for what was read, no token count and no price. The turn still carries `used` and `cost`, which the page uses to mark what the answer rested on in the file; the thread and the memory read both parts.

**Not enough: a second look, then a resource.** The answer carries `enough`: true when it rests on what it was given, or when the message asks it to write, change, judge or talk from the owner's own words, false only when the question asks for a fact, a figure, a name or a decision that the file, the memory and the folders do not hold. On false, once, the chat reads what it had left out: the sections of the file that share the question's words, and the owner's folders the router had not named, read as any folder is. A message of thanks or small talk, and a message that changed the file, never look again. When there is nothing more to read, or the second answer lacks the fact too, the turn is marked `lacks` and the page offers Add a resource under it.

**Resources.** The owner drops a resource from Memory, Add to memory, or from the Add a resource button under an answer that lacks the fact. It takes a Word, PDF, text, Markdown or HTML file, never a table, or pasted text, in a field like the Brief's. `/api/project/resource` files its notes in the project's memory; they are not read at every message like the Brief, and the chat reads the ones that bear on the question.

**Files made in the project.** A document, a table or an HTML page can be made from nothing, in two ways. New project has one field for the file to update: a file you have, or a type (Document, Table or HTML page), or neither. A type starts the project with an empty file marked `made`. Or press Create project with a name alone: the project has no file and its chat is open. The first message runs the router even when the owner has no other folder, which also names the kind (`doc`, `table` or `html`), and the file is made only when the answer carries something to write. A question back makes no file. A router that cannot answer leaves the kind to the words of the message (table, rows, budget, landing page, website, in English and French). The folders the router names are read like for any message, and an empty file is told to build from them and to name them. The chat is told the file is empty and how to build it. A document or a page is written with an insert after section 0. A table is built with a `table` change: its columns and its rows, which replace the sheet whole, take no other change to that sheet in the same go, and come back on Undo with the old columns and totals. A change to a file made here is checked and applied at once, and shows as Applied with an Undo; if it cannot be applied it stays a proposal and the reply says so. A file read from a drop keeps the rule above: a click applies a change. After a change to a table of up to 1,000,000 characters, each column's totals are worked out again.

**A page** is an HTML file kept as text in sections like a document. It shows rendered in a frame with `sandbox="allow-scripts allow-popups"`: no `allow-same-origin`, so its scripts reach nothing of the app, its storage or its session. The head offers Page and Code, and Download offers the `.html` file as written, or its words as Markdown.

**Downloads are written in the browser.** The server gives the words of a document, the code of a page, or the rows of one sheet as CSV. The page turns them into the format asked. A document: Markdown as it stands, a web page of its own with no script, or a PDF written by the page itself: A4, Helvetica and Courier with nothing embedded, headings, lists, quotes, code, tables whose header repeats on each page, and page numbers. A PDF writes Western European text, so a document that is mostly in another script, Chinese or Arabic for one, is refused with a message, and a document of more than 4,000,000 characters is too. A page: its code as written, or its words as Markdown. A table: Excel with every sheet in one workbook, a number kept as a number and a code with a zero in front kept as text; or CSV or a Markdown table of the open sheet. The Excel file is written by the library the page loads to read Excel files.

**What the browser reads.** PDF (pdf.js, with its layout rebuilt from where each piece of text stands: headings by size, tables from cells that line up, lists, paragraphs that wrap, two columns read one after the other, running headers and footers left out, 30 pages at a time), Word (mammoth, as Markdown), HTML (kept as a page in a project, read as Markdown in Drop: scripts, styles, menus and forms left out, the main part kept, the title as the heading), text and Markdown, CSV, and Excel (SheetJS 0.18.5, the last version cdnjs carries, loaded the first time an Excel file is chosen and checked against the hash cdnjs publishes). Each file is read in the tab and only its words and rows are sent. SheetJS 0.18.5 has two published weaknesses, a prototype pollution and a slow pattern, that need a crafted workbook: the app skips a sheet named like an object's own parts, and the file is the one the owner chose to open in their own tab. A scanned PDF has no text to read and says so.

## Steps that need a server

| Step | Why it cannot stay in the browser |
|---|---|
| The passphrase check | A browser check can be edited out |
| Every model call | The key would be readable |
| The settle write | Positions must be rewritten in one pass, atomically |
| The weekly digest | It runs on a schedule, with no browser open. `crons.ts` calls `digest:send` every Monday at 06:00 UTC and mails `DIGEST_TO` |
| The daily model check | It runs on a schedule too. `crons.ts` calls `admin:pickCheapest` every day at 05:30 UTC: each workspace with favourite models is set to the cheapest of them |

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

## Three doors, and whose credit pays

| Door | Credential | Model calls paid by |
|---|---|---|
| Member | A name and a password | Their own key: pasted, or remembered on the account |
| Guest | A model key, nothing else | Their own key, held in their tab only |
| Owner | The passphrase, no longer offered on screen | `OPENROUTER_API_KEY` on this deployment |

One kind of session opens the app: a passphrase, one per door. The owner feeds
every brain of that door's space, and this deployment's key pays for every
model call. Member accounts, guest keys and saved personal keys were removed.
One account record per project remains, without a password, only to hold that
project's connector address; it is made the first time Settings asks for one.


### Who may do what

`canRead` and `canDrop` in `lib.ts` decide, and 22 tests cover them.

| | Owner's brains | Their own | Another member's |
|---|---|---|---|
| Owner reads | yes | yes | yes |
| Owner feeds | yes | yes | yes |
| Member reads | public only | yes, private included | public only |
| Member feeds | no | yes | only if set to `drop` |

A brain with no `owner` predates accounts and belongs to the owner, so a member
cannot feed it. That closes the path where an outside drop rewrites the owner's
positions. Opening a brain to `drop` is the deliberate exception.

Every source row records `by`, the account that fed it, so a contribution can be
traced and undone.

## Every brain is readable. Feeding is the guarded act.

Reading is never restricted, on this site or through the connector. That is the
point of the place: the brains are published.

A source rewrites positions, so feeding is what needs a rule. `visibility` says
who may feed one brain.

| Value | Who may feed it |
|---|---|
| absent, `closed` | The account that created it. The owner, for brains made before accounts |
| `open` | Any signed-in account |

`ask`, `private` and `drop` are earlier spellings still in the store. `isOpen`
in `lib.ts` reads `drop` as `open` and everything else as closed, so no row
needs migrating.

`canDrop` is the whole rule, and 30 tests cover it, the three caller kinds, and the key sealing:

| | Owner's brains | Their own | Another account's |
|---|---|---|---|
| Owner feeds | yes | yes | yes |
| Member feeds | no | yes | only if open |
| Guest feeds | no | no brain to own | no |

A brain with no `owner` predates accounts and belongs to the owner, so a member
cannot feed it. Opening a brain is the deliberate exception, and the only way
an outside source reaches someone else's positions.

Every source row records `by`, the account that fed it, so a contribution can be
traced and undone.


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

## Export stays the contract

`PROTOCOL.md` remains the authority and markdown remains the portable format. Both runtimes export the same shape, so a brain built in one opens in the other.
