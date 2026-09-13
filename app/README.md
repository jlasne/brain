# app/

Four static pages, served by Vercel from this folder. `cleanUrls` is on, so a
file name becomes its path.

| File | Path | What it is |
|---|---|---|
| `index.html` | `/` | The landing page. What Octopus is, how a source lands, the rules that hold |
| `chat.html` | `/chat` | The app: drop, ask, create a brain. Behind the passphrase |
| `mcp.html` | `/mcp` | The connector address, the setup steps, the tools it exposes |
| `brains.html` | `/brains` | One tile per public brain, with the concepts inside it |
| `octopus.css` | `/octopus.css` | Tokens and layout shared by the three pages around the app |

`chat.html` stays self contained, styles and script inline. Pulling its layout
out from under a working screen buys nothing today, so `octopus.css` copies its
tokens instead. Change a colour in one and change it in the other.

Every page reads the same deployment, named once at the top of each file. That
address is public by design: the OpenRouter key lives on the server and never
reaches a browser.

## What each page talks to

| Page | Endpoint | Gated |
|---|---|---|
| `/` | `/api/public/brains`, for the live counts | No |
| `/brains` | `/api/public/brains` | No |
| `/mcp` | Nothing. It prints an address | No |
| `/chat` | Every `/api/*` route | Yes, the passphrase |

`/api/public/brains` and `/mcp` read every brain, because every brain is
published. Neither one writes.

## The three actions in the app

**Drop.** Paste a link or a transcript. `already stored?` answers the repeat
question for free, because that check reads one indexed row and calls no model.
Then the source gets read once in passes under the input cap, compared against
your summaries, and you reply to one card.

**Ask.** Across every brain or inside one, at three depths. Normal answers in
three to six lines. Educational defines the terms and works an example. Expert
reviews the evidence behind the position and names the thin spots.

**Create a brain.** A name, a one-line scope, subject or person, and whether
anyone may feed it. The closest existing scope gets shown first, so you can
decide whether a new brain is worth it.

## Two ways into /chat

| Door | You enter | Your key |
|---|---|---|
| Sign in | A name and a password | Pasted once, or remembered on the account |
| Read access | A model key | Held in the tab, forgotten on close |

A remembered key is encrypted on the server under a secret in its environment.
Unticked, the key never leaves the tab. Read access asks questions and feeds
nothing, so the Drop side and Create a brain are hidden for it.

The passphrase door is gone from the screen. `/api/unlock` still answers, so a
deployment that loses every account password has a way back in through the API.


## Why there is still a gate

Nothing reaches a model from this app until a key is present, because a model
call costs somebody money. Public reads sit outside the gate on purpose: they
call no model, so they cost nothing to serve.

## Export

`window.octopusExport()` in the console prints every brain as the markdown
`../PROTOCOL.md` specifies: a map, a source list, one summary per brain, one
file per concept. That keeps the plain-markdown format portable and the store
swappable. It lost its sidebar button, not its job.
