# The Convex build

Built. The deployment is `uncommon-wolf-174`, Europe (Ireland), and the model is `deepseek/deepseek-v4-flash-0731`.

| | Value |
|---|---|
| API the app calls | `https://uncommon-wolf-174.eu-west-1.convex.site` |
| Model | `deepseek/deepseek-v4-flash-0731` |
| Key | `OPENROUTER_API_KEY`, a Convex environment variable |
| Site | `octopus.jeremylasne.com`, its own Vercel project on this repo |

Change the model on one line, `MODEL` in `convex/lib.ts`.

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
| `/api/status` | Says whether a passphrase exists | No, it leaks nothing |
| `/api/unlock` | First call sets the passphrase, later calls check it | Rate limited, 8 tries an hour |
| `/api/login` | A name and a model key. Opens or finds a member account | No, it is the door |
| `/api/state` | Brains, concepts, sources | Yes |
| `/api/brain` | Creates one | Yes |
| `/api/drop/check` | The duplicate check, an index lookup. No model call, so the test button is free | Yes |
| `/api/drop/read` | One extraction pass over one chunk | Yes |
| `/api/drop/plan` | Summaries in, the card out | Yes |
| `/api/drop/settle` | Re-derives positions, writes, returns the receipt | Yes |
| `/api/ask` | The answer | Yes |
| `/api/lock` | Drops the session | Yes |
| `/api/brain/visibility` | Hides a brain from the public endpoints, or shows it again | Yes |
| `/api/public/brains` | Public brains and their concepts, for the `/brains` page | No, by design |
| `/mcp` | The public MCP server, read only | No, by design |

## Why the key has to be server side

| | Artifact build | Convex build |
|---|---|---|
| Who pays for a model call | Each viewer, from their own Claude usage | You, from your OpenRouter balance |
| Where the key sits | No key exists | A Convex environment variable, never sent to a browser |
| What the passphrase protects | Your brains from a casual reader | Your balance from anyone with the link |

In the artifact build a stranger who opens the page spends their own credits, so your balance is already safe. In the Convex build every call spends yours. So the passphrase check belongs in a Convex action, before the model call, and the browser never holds anything that can reach OpenRouter directly.

## Model choice

One function wraps the call, so the model is a single line to change.

| Model | Input /1M | Output /1M | Per source | 100 sources |
|---|---|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 | $0.46 | $46 |
| DeepSeek V4 Flash | $0.065 | $0.18 | $0.004 | $0.42 |

Estimated from 32,000 input and 12,000 output tokens per source.

Two steps carry the design and both are judgment work: extracting wide on a single read, and ranking which claims conflict. Run those on the stronger model and the cheap model on the rest, or test the cheap model on 10 sources and compare the cards. At $0.42 per 100 sources the test costs nothing.

## The tables

| Table | Holds | Indexed by |
|---|---|---|
| `brains` | name, type, scope, created, visibility | slug |
| `concepts` | brain, title, position, summaryLine, evidence, data, conflicts, sources | brain, then slug |
| `sources` | id, link, date, author, location, brains | link, and the normalised link |
| `notes` | the six note sections | source id |
| `candidates` | brain, title, mentions, count | brain and slug |
| `config` | the gate salt and hash | one row |
| `mcpHits` | the public endpoint's per address counter | address |
| `accounts` | a member's name, and a salted hash of their model key | name slug |

The duplicate check reads `sources` by normalised link, so it stays an index lookup at any size. Nothing else grows the read: summaries come from `concepts.summaryLine`, and only the shortlisted concept rows get opened in full.

## Steps that need a server

| Step | Why it cannot stay in the browser |
|---|---|
| The passphrase check | A browser check can be edited out |
| Every model call | The key would be readable |
| The settle write | Positions must be rewritten in one pass, atomically |

Reading brains and rendering the card can stay client side, because that data is already yours.

## The public MCP server

`/mcp` lets anyone read the brains from their own Claude, as a custom connector.
It carries no passphrase. Three properties make that safe:

| Property | Why it holds |
|---|---|
| Spends no credit | No route here calls a model. The reader's own Claude does the thinking |
| Cannot corrupt a brain | Every tool reads. There is no write, no drop, no settle |
| Cannot drain the quota | 120 calls per 10 minutes per address, counted in `mcpHits` |

That last property matters because the endpoint is open. At 4 to 6 calls per
question, the Convex free tier covers roughly 50,000 questions a month, and the
overage beyond it runs $0.22 per extra gigabyte moved.

## Accounts, and whose credit pays

Two ways in.

| Way in | Identity | Model calls paid by |
|---|---|---|
| Passphrase | The owner. Session carries no account | `OPENROUTER_API_KEY` on this deployment |
| Name and key | A member. Session carries their account slug | The key their browser sends, per request |

A member's key does two jobs. Salted and hashed once, it becomes their identity,
so name plus key finds the account. Sent with each request that reaches a model,
it pays for that call.

**The key is never stored.** It arrives in the HTTP body, is read inside the
HTTP action, and is handed straight to `ask()`. It must never be passed into
`runQuery` or `runMutation`, because Convex records the arguments of those
calls, and it must never be written to a table. Nothing keeps it, so nothing can
leak it later. The browser holds it in `sessionStorage`, so closing the tab
forgets it.

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

## Public and private brains

A brain carries a `visibility`. Absent reads as `ask`, so brains made before the
field behave as they did.

| Value | Who reads it | Who feeds it |
|---|---|---|
| `private` | The app only | You |
| `ask` | Anyone, through `/mcp` and `/brains` | You |
| `drop` | Anyone | Reserved for the API key phase |

One query enforces it. `store.publicEverything` drops private brains and every
concept and source under them, and both public endpoints read through it, so no
tool has to remember the check.

The tools:

| Tool | Returns |
|---|---|
| `ask` | The positions bearing on a question, their dated evidence, open conflicts, and how to write the answer |
| `list_brains` | Every readable brain with its scope line and its counts |
| `read_brain` | One brain's scope plus one line per concept |
| `read_concept` | A position, its dated evidence, its data, its open conflicts |
| `search_brains` | Keyword matches across every concept, title hits ranked first |
| `list_sources` | What a brain has read, newest first, with links |

Transport is Streamable HTTP. A POST carrying one JSON-RPC request gets one JSON
object back, which the spec permits in place of an SSE stream, so the server
stays stateless and issues no session id. `GET` answers 405, since nothing here
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
