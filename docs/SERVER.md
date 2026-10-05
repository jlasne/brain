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

A folder's Tidy button does the rest by hand: concepts filed twice, merged on
a click, titles not in English, renamed on a click, and the same positions.
Settings, Tidy all folders, does it for every folder with no click per
finding: twins merge into the clearest title, titles go into English, and
empty positions are written. About $0.003 a folder on GLM 5.3 Flash, plus
$0.001 a merge.

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
covered least. About $0.002 an answer on GLM 5.3 Flash. The twin test's 30
answers are kept in the `interviews` row, never filed, so they can measure the
twin; the twin and the profile read the notes alone. Nothing but that
brain's own folder and chat reads any of it.

Projects are off in the app for now: the side panel shows Chats and Folders,
and the Limited or Full switch left Settings with them. Their routes and
tables stay, so they can come back, and nothing rebuilds a page after a drop.

When projects come back: a project's page changes when its owner presses
Build, and it is shown in a frame that runs no script, reaches no server and
opens no window.

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
another language, can still answer it. "Needs" links give each folder its
Learning path: the concepts in steps, each resting on the ones before. All of
it runs on the deployment's key, so a bring-your-own-key workspace and the demo
skip it, the same as linking.

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
| `/api/concept` | One concept whole, its links with their kinds, and what follows from it, for the brain viewer | Yes |
| `/api/topics` | One folder's topics: a title, a line and its concepts. Never a personal folder | Yes |
| `/api/map` | Every folder, concept and link for the map, each link with its kind | Yes |
| `/api/conflicts` | The open conflicts that are real contradictions. Each clash is checked once and marked | Yes |
| `/api/conflicts/settle` | Settles one: the side that holds rewrites the position, or both hold and it only leaves the list | Yes |
| `/api/passphrase` | Changes the workspace's passphrase: the current one is checked against the same 8 tries an hour, the others are signed out | Owner |
| `/api/share` | Share brain: the owner of a brain's workspace puts it in one more workspace, or takes it back, one workspace at a time. The owner's other workspace can feed it; the demo only reads it. A workspace can leave a brain it was given. Never a personal brain | Owner |
| `/api/brain` | Creates one | Yes |
| `/api/drop/check` | The duplicate check, an index lookup. No model call, so the test button is free | Yes |
| `/api/drop/read` | One extraction pass over one chunk | Yes |
| `/api/drop/plan` | Summaries in, the card out | Yes |
| `/api/drop/settle` | Re-derives positions, writes, returns the receipt | Yes |
| `/api/drop/link` | Links everything a drop wrote, once, in the background | Yes |
| `/api/drop/merge` | Before storing: groups new titles that name one idea twice, joins a new idea to the concept already holding it, and gives a title not in English its English one | Yes |
| `/api/ask` | The answer. With `project`, it reads that project's folders and follows its instructions, and the turn joins the project's chat | Yes |
| `/api/projects` | The workspace's projects and its kept one-pagers, newest first. The demo has no projects; each visitor sees their own one-pagers | Yes |
| `/api/onepagers/get`, `/api/onepagers/remove` | A kept one-pager, opened again or deleted | Yes |
| `/api/projects/get` | One project whole: settings, chat, versions, newest page | Owner |
| `/api/projects/page` | One version of a project's page | Owner |
| `/api/projects/save` | Creates a project or changes its settings. Its folders must be ones the workspace reads, never a personal one. A template holds 60 KB at most | Owner |
| `/api/projects/queue` | Puts an answer from the project's chat aside for the next Build, or takes it back. 10 wait at most. Builds nothing | Owner |
| `/api/projects/build` | Build: the next version of the page, from the folders and the answers that wait. The only way the app changes a page. The newest 10 versions are kept | Owner |
| `/api/models` | The workspace's chat model and project model. `null` goes back to the default | Owner |
| `/api/projects/clear`, `/api/projects/remove` | Clears a project's chat, or deletes the project and its pages | Owner |
| `/api/onepager` | A summary in bullets of a brain, a group or a question, or a document: a quiz, a deep dive, use cases, or a type you describe. Kept, the last 50 per workspace. Sends it too, when given an address | Yes |
| `/api/fetch` | Opens a link, or fetches a video's transcript | Yes |
| `/api/usage` | What transcripts have cost, from both sides | Yes |
| `/api/doc` | The connector page's words, served rather than published | Yes |
| `/api/lock` | Drops the session | Yes |
| `/api/brain/tidy` | Reads one folder for concepts filed twice, titles not in English and concepts with no position. Proposes only | Yes, owner |
| `/api/concept/merge` | Folds concepts of one folder into the one kept, then writes its position again from the joined evidence | Yes, owner |
| `/api/concept/rename` | Changes a concept's title. Its id and links stay | Yes, owner |
| `/api/concept/rederive` | Writes positions again from the evidence each concept holds, eight per call | Yes |
| `/api/brain/merge` | Merges one folder into another in the same workspace, then deletes the first. Owner only, never the personal folder | Yes |
| `/api/personal/contact` | A person's file by hand: `edit` sets its name, other names, line and summary (the old name stays as another name); `part` takes one fact, moment or link out, or marks an open item done; `merge` folds other files of the same person into it, then writes the summary again | Owner |
| `/api/personal/people` | The people in a personal brain's older notes, filed as contacts, 20 notes a call; the app calls again with `at` until `next` is null | Owner |
| `/api/interview` | A personal brain's interview, by `action`: `state`, `start` (on, and its next question), `stop`, `restart`, `answers` (the twin test, round 1 or the retest, never filed), `twin` (the twin answers the test from the notes alone), `score` (0 to 2 a question) and `profile` (the notes as 7 parts). While on, `/api/ask` in that brain's chat takes each message as an answer | Owner |
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
workspace picks two in Settings, saved on the server: the chat model, which
answers, reads drops and writes one-pagers, and the project model, which
answers in projects and builds their pages. Both default to
`z-ai/glm-5.3-flash`, in every workspace. The demo always runs on the defaults.

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
| `brains` | name, type, scope, created, visibility, owner, space | slug |
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
| `projects` | name, folders, instructions, template, rebuild switch, out-of-date mark, its chat | space |
| `pages` | each build of a project's page, the newest 10 | project, then version |
| `models` | the chat model and the project model a workspace picked | space |
| `onepagers` | every one-pager built, its page, text and what built it, the newest 50 per owner | space, then time |
| `vectors` | a concept's meaning as 1,024 numbers | concept, and a vector index by folder |
| `topics` | a folder's topics: title, line, the concepts in each | folder |
| `interviews` | a personal brain's interview: each question answered, known from the notes or skipped, the one waiting, the twin test's answers and scores, and the profile | space, then brain |
| `insights` | what follows from two linked concepts: the pair, the kind of link, a title and a line | the pair, each side, space |

The duplicate check reads `sources` by normalised link, so it stays an index lookup at any size. Nothing else grows the read: summaries come from `concepts.summaryLine`, and only the shortlisted concept rows get opened in full.

## Steps that need a server

| Step | Why it cannot stay in the browser |
|---|---|
| The passphrase check | A browser check can be edited out |
| Every model call | The key would be readable |
| The settle write | Positions must be rewritten in one pass, atomically |
| The weekly digest | It runs on a schedule, with no browser open. `crons.ts` calls `digest:send` every Monday at 06:00 UTC and mails `DIGEST_TO` |

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
