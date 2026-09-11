# app/

The Octopus chat, one HTML file. Two runtimes, one interface.

| Runtime | Model | Where brains live | Status |
|---|---|---|---|
| Claude artifact | Claude, paid by the viewer | The artifact store | Running |
| Convex | OpenRouter, your key, server side | Convex tables | Planned, see `../CONVEX.md` |

`index.html` is the artifact build. It reaches two runtime capabilities, a document store and a call to Claude, and it renders the whole product: the brain list, the drop card, the answer shape, and the passphrase gate.

## The three actions

**Drop.** Paste a link or a transcript. The duplicate check runs first, so a repeat costs zero pasting. Then the source gets read once, in passes under the input cap, compared against your summaries, and you reply to one card.

**Ask.** Across every brain or inside one. The first sentence answers, numbers sit in the answer, sources go on one line at the end.

**Create a brain.** A name, a one-line scope, subject or person. The closest existing scope gets shown first, so you can decide whether a new brain is worth it.

## The passphrase gate

Nothing reads a brain and nothing reaches the model until the passphrase is entered. Only a salted SHA-256 hash gets stored, never the passphrase.

In the artifact runtime this is a lock on the door, not a vault: model calls spend each viewer's own Claude usage, and anyone who opens the page can read its code. In the Convex build the lock matters, because the OpenRouter key sits on the server and a visitor would spend your money.

## Export

The sidebar `export` button prints every brain as the markdown `../PROTOCOL.md` specifies: a map, a source list, one summary per brain, one file per concept. That keeps the plain-markdown format portable and the store swappable.
