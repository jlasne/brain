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

`/api/public/brains` and `/mcp` exclude private brains and everything under
them, so the only way to widen what the world sees is to mark a brain public.

## The three actions in the app

**Drop.** Paste a link or a transcript. `already stored?` answers the repeat
question for free, because that check reads one indexed row and calls no model.
Then the source gets read once in passes under the input cap, compared against
your summaries, and you reply to one card.

**Ask.** Across every brain or inside one, at three depths. Normal answers in
three to six lines. Educational defines the terms and works an example. Expert
reviews the evidence behind the position and names the thin spots.

**Create a brain.** A name, a one-line scope, subject or person, public or
private. The closest existing scope gets shown first, so you can decide whether
a new brain is worth it.

## The passphrase gate

Nothing reads a private brain and nothing reaches the model until the passphrase
is entered. Only a salted SHA-256 hash is stored. The lock matters here because
the OpenRouter key sits on the server, so a visitor would spend real money.

Public reads sit outside the gate on purpose. They call no model, so they cost
nothing to serve.

## Export

The sidebar `export` button prints every brain as the markdown `../PROTOCOL.md`
specifies: a map, a source list, one summary per brain, one file per concept.
That keeps the plain-markdown format portable and the store swappable.
