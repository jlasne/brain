# app/

Four static pages, served by Vercel from this folder. `cleanUrls` is on, so a
file name becomes its path.

| File | Path | What it is |
|---|---|---|
| `index.html` | `/`, `/octopus`, `/squidgy` | The landing on `/`: the demo, a workspace of your own, or yours again. On `/octopus` and `/squidgy`, the owner's door to that workspace |
| `chat.html` | `/chat` | The app: drop, ask, one-pager, create a brain. Behind a passphrase |
| `about.html` | `/about` | What Octopus is, how to run your own, what is in the repo |
| `doc.html` | `/doc` | The connector. The page holds no words: they arrive from the deployment, so an unsigned request gets a refusal |
| `octopus.css` | `/octopus.css` | Tokens and layout shared by the pages around the app |

## The two colours

Each door carries four values, `--tint`, `--tint-deep`, `--tint-on` and
`--tint-wash`, set in one block at the top of `index.html`. Nothing below names
a colour directly, so swapping those eight values reskins both doors.

Inside the app, `:root[data-space="squidgy"]` redefines the accent and nothing
else, so every button, rule and focus ring follows. Octopus keeps the
terracotta.

The Squidgy mark is `brand/squidgy-mark.png`. Until that file exists the door
shows a letter and the app keeps the Octopus mark, so a missing file leaves no
gap.

`chat.html` stays self contained, styles and script inline. Pulling its layout
out from under a working screen buys nothing today, so `octopus.css` copies its
tokens instead. Change a colour in one and change it in the other.

Every page reads the same deployment, named once at the top of each file. That
address is public by design: the OpenRouter key lives on the server and never
reaches a browser.

## What each page talks to

| Page | Endpoint | Gated |
|---|---|---|
| `/` | `/api/status` for which doors exist, `/api/unlock` to open one, `/api/public/brains` for the counts | No, it is the door |
| `/about` | `/api/public/brains`, for the live counts | No |
| `/doc` | `/api/unlock` with the Octopus passphrase, then `/api/doc` for its own words | Yes |
| `/chat` | Every `/api/*` route | Yes, a passphrase |

`/api/public/brains` reads Octopus, because every Octopus brain is published. It
never writes, and it never reads Squidgy.

## The four actions in the app

**Drop.** A drop is a source and its content. A link on the source line is
enough: the page gets opened, and a video's transcript gets fetched. Anything
else takes the content, pasted or read from a PDF, Word or text file dropped in.
A document is read in this tab and never uploaded. `already stored?` answers the
repeat question for free, because that check reads one indexed row and calls no
model. Then the source gets read once in passes under the input cap, compared
against your summaries, and you reply to one card.

**One-pager.** A brain, a group of brains, or a question, as bullets on one
page. The first two read stored positions and call no model. Copy it, print it,
or mail it through Resend.

**Ask.** Across every brain or inside one, at two depths. Normal answers in
three to six lines. Educational defines the terms and works an example.

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
