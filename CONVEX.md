# The Convex build

Built. The deployment is `uncommon-wolf-174`, Europe (Ireland), and the model is `deepseek/deepseek-v4-flash-0731`.

| | Value |
|---|---|
| API the app calls | `https://uncommon-wolf-174.eu-west-1.convex.site` |
| Model | `deepseek/deepseek-v4-flash-0731` |
| Key | `OPENROUTER_API_KEY`, a Convex environment variable |
| Site | `octopus.jeremylasne.com`, its own Vercel project on this repo |

Change the model on one line, `MODEL` in `convex/lib.ts`.

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

## Routes

| Route | Does | Gated |
|---|---|---|
| `/api/status` | Says whether a passphrase exists | No, it leaks nothing |
| `/api/unlock` | First call sets the passphrase, later calls check it | Rate limited, 8 tries an hour |
| `/api/state` | Brains, concepts, sources | Yes |
| `/api/brain` | Creates one | Yes |
| `/api/drop/check` | The duplicate check, an index lookup | Yes |
| `/api/drop/read` | One extraction pass over one chunk | Yes |
| `/api/drop/plan` | Summaries in, the card out | Yes |
| `/api/drop/settle` | Re-derives positions, writes, returns the receipt | Yes |
| `/api/ask` | The answer | Yes |
| `/api/lock` | Drops the session | Yes |

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
| `brains` | name, type, scope, created | slug |
| `concepts` | brain, title, position, summaryLine, evidence, data, conflicts, sources | brain, then slug |
| `sources` | id, link, date, author, location, brains | link, and the normalised link |
| `notes` | the six note sections | source id |
| `candidates` | brain, title, mentions, count | brain and slug |
| `config` | the gate salt and hash | one row |

The duplicate check reads `sources` by normalised link, so it stays an index lookup at any size. Nothing else grows the read: summaries come from `concepts.summaryLine`, and only the shortlisted concept rows get opened in full.

## Steps that need a server

| Step | Why it cannot stay in the browser |
|---|---|
| The passphrase check | A browser check can be edited out |
| Every model call | The key would be readable |
| The settle write | Positions must be rewritten in one pass, atomically |

Reading brains and rendering the card can stay client side, because that data is already yours.

## Export stays the contract

`PROTOCOL.md` remains the authority and markdown remains the portable format. Both runtimes export the same shape, so a brain built in one opens in the other.
