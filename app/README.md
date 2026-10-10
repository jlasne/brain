# app/

Four static pages, served by Vercel from this folder. `cleanUrls` is on, so a
file name becomes its path.

| File | Path | What it is |
|---|---|---|
| `index.html` | `/` | The landing: the demo and the live workspaces, then what it does, Drop and Ask. The system font and the colours of jeremylasne.com |
| `about.html` | `/about` | The white paper: the model, Drop, Ask, clashes, the ceilings that keep it fast, and who holds your data. Linked from the footer |
| `chat.html` | `/chat`, `/chat?w=octopus` | The app: drop, ask, one-pager, create a brain. With no session, it asks for the passphrase on top of the workspace the address names. `/octopus` and `/squidgy` redirect here |
| `doc.html` | `/doc` | The connector. The page holds no words: they arrive from the deployment, so an unsigned request gets a refusal |
| `octopus.css` | `/octopus.css` | Tokens and layout shared by the pages around the app |

## The colours

The landing wears Tasu's greys: near-white `#fafafa`, near-black `#09090b`
for text and its one button, Frank Ruhl Libre for the headline and Geist for
the rest, over the pencil landscape in `brand/landing.webp`. The mark is the
folder in `brand/tasu.svg`.

Inside the app, `:root` holds the same greys, with the side panel a step off
white. Octopus keeps its orange and Squidgy its brown, as the accent only. A
workspace's own look, set in Settings, overrides the accent, the page and the
mark with inline variables, and this browser remembers them so the next visit
paints in them from the first frame.

`chat.html` stays self contained, styles and script inline. Pulling its layout
out from under a working screen buys nothing today, so `octopus.css` copies its
tokens instead. Change a colour in one and change it in the other.

Every page reads the same deployment, named once at the top of each file. That
address is public by design: the OpenRouter key lives on the server and never
reaches a browser.

## What each page talks to

| Page | Endpoint | Gated |
|---|---|---|
| `/` | `/api/status` for whether the demo is open, `/api/demo` and `/api/workspace/create` to enter | No |
| `/doc` | `/api/unlock` with the Octopus passphrase, then `/api/doc` for its own words | Yes |
| `/chat` | `/api/status`, `/api/brand/public` and `/api/unlock` before the passphrase; every other `/api/*` route after it | Yes, a passphrase |

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

**Ask.** Across every folder, inside one, or inside the ones ticked in the side
panel, at three levels. Normal answers in three to six lines. Educational
defines the terms and works an example. Learning gives steps and hints instead
of the answer.

**New folder.** A folder, fed by Drop: a name, a one-line scope, and one switch
for one person's view. Or a personal folder, fed by what you say in its chat.
The closest existing scope gets shown first, so you can decide whether a new
folder is worth it.

## Two ways into /chat

| Door | You enter | Your key |
|---|---|---|
| Sign in | A name and a password | Pasted once, or remembered on the account |
| Read access | A model key | Held in the tab, forgotten on close |

A remembered key is encrypted on the server under a secret in its environment.
Unticked, the key never leaves the tab. Read access asks questions and feeds
nothing, so the Drop side and New folder are hidden for it.

The passphrase door is gone from the screen. `/api/unlock` still answers, so a
deployment that loses every account password has a way back in through the API.


## Why there is still a gate

Nothing reaches a model from this app until a key is present, because a model
call costs somebody money. Public reads sit outside the gate on purpose: they
call no model, so they cost nothing to serve.

## Export

`window.octopusExport()` in the console prints every brain as the markdown
`../docs/PROTOCOL.md` specifies: a map, a source list, one summary per brain, one
file per concept. That keeps the plain-markdown format portable and the store
swappable. It lost its sidebar button, not its job.
