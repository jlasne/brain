# brains/

Your brains live here. Empty until you create one.

A brain is a subject or a person. The folder name carries which:

```
brain-subject-{slug}/     your position on a subject
brain-person-{slug}/      one person's position, dated so drift shows
```

To create one, ask for it: "create a brain for X". You give it a name, a one-line scope, and a type. Before creating, the closest existing scope gets shown, so you can decide whether a new brain is worth it.

Three things appear alongside your brains once the first one exists:

| File | Job |
|---|---|
| `MAP.md` | The front door. Brains table, then one concept section per brain |
| `SOURCES.md` | One row per source. This is what catches a repeat |
| `notes/` | One note per source, written once |

Notes and the source list sit here rather than inside a brain, because raw capture belongs to no brain. That is what lets a repeat get caught across every brain at once.

File shapes are in `../templates/`. The rules are in `../PROTOCOL.md`.
