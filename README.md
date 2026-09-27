# Octopus

A folder that gets smarter every time you feed it. One arm in each brain.

Drop articles, transcripts, studies, links. The brain stores each one once, files it where it belongs, argues with you when a claim clashes with what it already believes, then rewrites its position instead of piling up quotes. Ask it a question and you get an answer, not a list of everything ever said.

Plain markdown at its core, with a chat on top. Brains stay portable whichever way you use it.

## Two ways in

| | Chat | Claude Code |
|---|---|---|
| Where | `brain.jeremylasne.com`, five pages under `app/` | The `brain` skill, in your terminal |
| Model | OpenRouter, your key, server side | Whatever your session runs |
| Brains | Convex tables, exportable to markdown | Markdown files under `brains/` |
| Gate | A passphrase, one per space | Your own machine |

### Two spaces

One deployment holds two spaces that see none of each other: **Octopus**, which
holds one brain per subject, and **Squidgy**, which holds one brain that
everything lands in. Each has its own passphrase, its own colour and its own
door on the landing page, at `/octopus` and `/squidgy`.

A space owns its brains, and every read filters by it. Rows written before the
split carry no space and read as Octopus, so nothing had to move. The MCP server
and the public brain list serve Octopus only.

Set a passphrase from a terminal, which closes a door before it is public:

```bash
# macOS, Linux
npx convex run admin:setPass '{"space":"squidgy","pass":"at least 8 characters"}' --prod
```

```powershell
# Windows PowerShell strips the double quotes inside an argument, so the values
# go in single quotes, which the CLI's JSON5 parser accepts
npx convex run admin:setPass "{space:'squidgy',pass:'at least 8 characters'}" --prod
```

In PowerShell, keep `$` and `'` out of the passphrase, or the shell rewrites it
before the CLI sees it.

Same protocol, same three actions, same export format.

## Why this exists

Most second-brain tools store and search. They skip the hard part, which happens the moment you add something: do I already have this, where does it go, what did it add, and does it contradict what I believed. This brain makes those four calls on every drop, and it finishes each one coherent, so nothing waits in a pile.

## Two kinds of brain

A brain is a **subject** or a **person**.

| Folder | Answers | Names in the answer |
|---|---|---|
| `brain-subject-health` | Does cold water help recovery? | Kept out, listed at the end |
| `brain-person-sarah-chen` | What does she argue about recovery? | Named, because she is the subject |

One source often lands in both. An interview about sleep feeds the sleep brain and the guest's own brain, from one note.

## What you do

**Drop.** A drop is two things: the source, and what it says. A link on the source line is enough, because the page gets opened and a video's transcript gets fetched. Anything else takes the content: pasted text, or a PDF, Word or text file dropped in, read in the browser and never uploaded. Reply to one card. That card shows where the source goes, what is new, what it repeats, and every conflict it raises, numbered. One line settles all of it, and silence keeps both views.

**Ask.** Ask the way you would ask a person. The first sentence answers. Numbers sit inside the answer, sources on one line underneath.

**One-pager.** A brain, a group of brains, or a question, as bullets on one page. A brain and a group read what is stored, so they cost nothing. Copy it, print it, or mail it.

**Create a brain.** Rare. A name, a one-line scope, subject or person.

## No queue

Every drop finishes coherent before the brain says done. No pending pile, no cleanup counter, no separate tidy command.

This works because a position is re-derived from its whole evidence list, never appended to. Adding a sixth source rewrites the view from all six, so one weak source cannot drag a position on its own.

## Size

Nothing counts concepts or sources against a limit. Fit is the only gate: every brain carries a one-line scope, and a concept either fits it or becomes a new brain.

Speed stays flat because of two rules. Summaries get read, whole brains never do. The map gets searched, never read whole.

| Brain size | Read per drop | Read per question | Files opened |
|---|---|---|---|
| 10 concepts · 30 sources | 1.0k | 3.5k | 3 to 5 |
| 200 concepts · 1,000 sources | 2.6k | 5.1k | 3 to 5 |
| 500 concepts · 5,000 sources | 5.0k | 7.5k | 3 to 5 |

Words read, estimated. The deep work stays fixed whatever the size.

## Install

**The chat.** A Convex deployment holds the data, any static host serves `app/`.

```
git clone https://github.com/jlasne/brain
cd brain && npm install
npx convex dev
npx convex env set OPENROUTER_API_KEY sk-or-... --prod
npx convex deploy
npx convex run admin:setPass "{space:'octopus',pass:'...'}" --prod
```

One passphrase per door opens the app. The deployment's key pays for every model call.

A video link carries no transcript on its own: YouTube hands captions to a signed-in browser and to nothing else, which a deployment is not. Set a [Supadata](https://supadata.ai) key and a video link becomes enough.

```
npx convex env set SUPADATA_API_KEY sd_... --prod
```

It asks for captions that already exist, at one credit each, and says to paste when a video has none. `SUPADATA_MODE=auto` generates them from the audio instead, at 2 credits per minute, so one hour costs 120 credits rather than 1. Unset, a video link asks you to paste, which is what it did before.

A one-pager can be mailed. Set a [Resend](https://resend.com) key, and verify the sending domain there.

```
npx convex env set RESEND_API_KEY re_... --prod
npx convex env set MAIL_FROM hey@yourdomain.com --prod
```

`MAIL_FROM` defaults to `hello@kaught.app`, so set it to your own. The space names itself as the sender. Unset `RESEND_API_KEY` and the page still builds, copies and prints.

Every Monday at 06:00 UTC, one mail sums up the week across both spaces: sources read, new concepts, concepts fed again with the evidence added, and open conflicts. It calls no model. A week with nothing new sends nothing. Set the address it goes to:

```
npx convex env set DIGEST_TO you@yourdomain.com --prod
npx convex run digest:send '{"dry":true}' --prod
```

The second line shows this week's digest without sending it. Drop `'{"dry":true}'` to send it now.

Then serve `app/` as the site root. `vercel.json` already does it. The landing page is two doors, one per space. A door stays shut until its passphrase is set from a terminal with `npx convex run admin:setPass`. Then create a brain and drop a source.

**Claude Code.** Copy `skill/brain/` into your skills folder: `~/.claude/skills/brain/` for personal, `.claude/skills/brain/` for one project. On Claude.ai, upload `skill/brain/SKILL.md` as a skill. Then ask for your first brain.

Runs on Claude Opus 5 or better. A drop reads a full transcript once and ranks what contradicts what, so a weaker model costs you extraction depth you cannot get back without re-dropping. `CONVEX.md` carries the numbers for cheaper models.

## The passphrase gate

Nothing reads a brain and nothing reaches the model until the passphrase is entered. Only a salted SHA-256 hash gets stored, one per space, each with its own attempt counter, so eight wrong guesses at one door leave the other open.

In the artifact build this is a lock on the door: model calls spend each viewer's own Claude usage, so your balance is never at risk. In the Convex build it becomes a real gate, because your OpenRouter key sits on the server and every call spends your money. `CONVEX.md` covers that split.

## Layout

```
README.md              this file
PROTOCOL.md            the 41 rules, addressable by number
CONVEX.md              the server build, and why the key belongs there
app/index.html         the two doors, one file
app/chat.html          the app, one file
app/about.html         how it works
app/doc.html           the connector, served rather than published
scripts/               the checks: npm run check
skill/brain/SKILL.md   the behaviour, for Claude Code
templates/             the shape of every file a brain writes
brains/                your brains, as markdown
```

## The rules

`PROTOCOL.md` holds 41 numbered rules, 8 writing rules and 9 guarantees. It reads in ten minutes and it is the whole product.

Each guarantee names the rule holding it, so it survives a thousand drops rather than depending on memory:

- Position text changes only after your card reply.
- Positions get re-derived from the whole evidence list, never appended to.
- Every source is checked twice: by link, then by idea.
- Every view survives, carrying its date.
- A summary carries one line per concept file, always.
- Candidates carry a threshold, so a misc file never appears.
- Raw transcripts stay outside the brain.
- Every drop ends coherent, and the receipt proves it.
- A brain grows without limit while its concepts fit its scope.

## The more specific the scope, the better

A brain scoped to "investing" is a folder. A brain scoped to "macro regimes and emerging markets for my own portfolio" has a test, and that test is what makes filing and deduplication work. Creating a brain pushes back once on a vague scope, on purpose.

## License

MIT.
