# brain

A folder that gets smarter every time you feed it.

Drop articles, transcripts, studies, links. The brain stores each one once, files it where it belongs, and rewrites what it knows instead of piling up quotes. Ask it a question and you get a position, with evidence and dates, not a list of everything ever said.

Plain markdown. No app, no database, no accounts. Works with Claude Code and Claude.ai.

## Why this exists

Most "second brain" tools do two things: store and search. They skip the hard part, which is deciding at the moment you add something: do I already have this, where does it go, what did it add, and does it contradict what I believed. This brain makes those four decisions every time, and runs a separate tidy pass so the synthesis gets rewritten instead of growing forever.

## Install

1. Copy `skill/brain/` into your skills folder.
   Claude Code: `~/.claude/skills/brain/` (personal) or `.claude/skills/brain/` (project).
   Claude.ai: upload `skill/brain/SKILL.md` as a skill.
2. Open a chat in the folder where you want the brain to live.
3. Paste the contents of `SETUP-PROMPT.md`.
4. Answer four questions. The brain creates itself.

## Use

- Feed it: paste a link, a transcript, or a file and say "brain this".
- Ask it: ask a question in your domain.
- Tidy it: say "tidy the brain". It offers by itself after 5 new resources or 7 days.

## How it works

Four modes, two rules.

| Mode | What it touches |
|---|---|
| Setup | Creates the folder from a 4 question interview |
| Ingest | Writes 3 files: the note, the registry row, an inbox line. Nothing else |
| Tidy | Rewrites synthesis files and the summary. Merges, resolves contradictions, promotes orphan concepts |
| Ask | Reads the summary, then the right synthesis files. Answers as position, evidence, open contradictions |

Rule 1: ingest never touches synthesis. Rule 2: synthesis is rewritten, never appended.

The full protocol is in `skill/brain/SKILL.md`. It is readable in five minutes and it is the whole product.

## Folder your brain will have

```
brain/
  BRAIN-PROTOCOL.md       domain, folder map, concept router
  KNOWLEDGE-SUMMARY.md    one line per concept, capped at 120 lines
  INBOX.md                notes waiting for tidy, orphan concepts
  notes/                  one file per resource, written once
  syntheses/              one file per concept, rewritten by tidy
```

## The more specific, the better

A brain about "investing" is a folder. A brain about "macro regimes and emerging markets for my own portfolio" has a router, and a router is what makes filing and deduplication work. Setup pushes back once on vague answers on purpose.

## License

MIT.
