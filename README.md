# brain

A folder that gets smarter every time you feed it.

Drop articles, transcripts, studies, links. The brain stores each one once, files it where it belongs, argues with you when a claim clashes with what it already believes, then rewrites its position instead of piling up quotes. Ask it a question and you get an answer, not a list of everything ever said.

Plain markdown. No app, no database, no accounts.

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

**Drop.** Paste a link, a transcript, or a batch. Reply to one card. That card shows where the source goes, what is new, what it repeats, and every conflict it raises, numbered. One line settles all of it, and silence keeps both views.

**Ask.** Ask the way you would ask a person. The first sentence answers. Numbers sit inside the answer, sources on one line underneath.

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

1. Copy `skill/brain/` into your skills folder.
   Claude Code: `~/.claude/skills/brain/` for personal, `.claude/skills/brain/` for one project.
   Claude.ai: upload `skill/brain/SKILL.md` as a skill.
2. Ask for your first brain: "create a brain for X".
3. Drop a source.

Runs on Claude Opus 5 or better. A drop reads a full transcript once and ranks what contradicts what, so a weaker model costs you extraction depth you cannot get back without re-dropping.

## Layout

```
README.md              this file
PROTOCOL.md            the 41 rules, addressable by number
skill/brain/SKILL.md   the behaviour
templates/             the shape of every file the brain writes
brains/                your brains
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
