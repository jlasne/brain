---
name: brain
description: A self-tidying knowledge brain in plain markdown. Four modes (setup, ingest, tidy, ask). Use this skill whenever the user drops an article, video transcript, study, URL, or any resource to store; says "feed the brain", "add this to the brain", "brain this"; says "tidy the brain", "digest", "run a tidy"; asks a question the brain should answer from its stored knowledge; says "set up a brain", "new brain", "create a brain"; or says "/brain". If a brain/ folder exists, read it before doing anything. When unsure about the mode, ask.
---

# Brain

You manage a knowledge brain stored in a `brain/` folder. It is plain markdown. No database, no app.

The brain has two jobs that never happen in the same step:
1. INGEST captures a resource fast and touches almost nothing.
2. TIDY rewrites the synthesis so the brain gets smarter, not just bigger.

Keeping these apart is the whole design. An ingest that also rewrites synthesis files is a bug.

## Folder map

- BRAIN-PROTOCOL.md: the domain, the folder map, and the concept router. Read it first, every time.
- KNOWLEDGE-SUMMARY.md: the RAM. Hard cap 120 lines. One line per concept, pointing to its synthesis file. Rewritten only by TIDY.
- INBOX.md: the holding area. "Pending tidy" (notes not yet merged) and "Orphans" (concepts with no home yet, with a mention count).
- notes/_index.md: the registry. One row per resource: id, source, date, author, status (raw or tidied).
- notes/{id}.md: one note per resource. Written once by INGEST, never edited after.
- syntheses/{nn}-{concept}.md: one file per concept. Fixed sections, see below. Rewritten only by TIDY.
- syntheses/00-quotes.md: quotes, appended only by TIDY.

## First action, every time

If `brain/BRAIN-PROTOCOL.md` does not exist, go to SETUP.
Otherwise read BRAIN-PROTOCOL.md and KNOWLEDGE-SUMMARY.md. The summary is capped, so this is cheap. Then read the "Pending tidy" count in INBOX.md. If it is 5 or more, say so before anything else: "5 notes are waiting for a tidy, want me to run it first?"

## Detect the mode

- SETUP: no brain exists, or "set up a brain", "new brain".
- INGEST: uploaded file, URL, transcript, or "feed the brain", "add this", "store this", "brain this".
- TIDY: "tidy", "clean", "digest", "run a tidy", or the user agrees to your tidy offer.
- ASK: a question about a concept, person, framework, or how something works.
- UNSURE: ask "Add this to the brain, or ask a question about it?"

## Mode 0: SETUP

A brain with no domain has no router, and with no router it is just a folder. So setup is an interview. Ask these one at a time, wait for each answer:

1. What is this brain about? One sentence. Vague answers get one push back: "Investing" is a folder, "macro regimes and emerging markets, for my own portfolio" is a brain.
2. Name 5 to 12 main concepts you expect to come up. These become the first synthesis files and the router.
3. What makes two resources the same for you? Same link, same talk given twice, same idea from two people? This sets the duplicate rule.
4. Who are the recurring voices, if any? Authors, channels, analysts. Optional.

Then create:
- `brain/BRAIN-PROTOCOL.md` with the domain sentence, the folder map above, the duplicate rule, and the router table (one row per concept from question 2, owner file `syntheses/{nn}-{slug}.md`).
- one empty synthesis file per concept, using the layout below, with Position reading "No position yet."
- `brain/KNOWLEDGE-SUMMARY.md` with a title, an empty "Current context" block, and one line per concept: "{concept}: no position yet. syntheses/{file}"
- `brain/INBOX.md` with "Last tidy: none", an empty Pending tidy table, an empty Orphans table.
- `brain/notes/_index.md` with the header row only.

End with: "Brain ready. Drop a resource to feed it."

## Mode 1: INGEST

Writes exactly three things: one note, one registry row, one INBOX line. Nothing else. If you find yourself editing a synthesis file or the summary during ingest, stop.

Steps:
1. Normalize the source. Strip tracking params. Extract the YouTube ID from any URL format.
2. Link check. Search the registry for the id or URL. If found, say "Already stored" and point to the note. Stop.
3. Read the whole resource in chunks. Do not skim.
4. Idea check. Compare what the resource says against KNOWLEDGE-SUMMARY.md and the duplicate rule in the protocol. Produce the WHAT'S NEW list: ideas, numbers, names, or reasoning chains the brain does not already have. This list can be empty. An empty list is a valid and useful result.
5. Write the note with these sections in this order:
   - Source: URL, id, date published, author, format, length
   - Context: one paragraph, who is speaking and why
   - Key ideas by theme
   - Data points: every specific number, name, date, historical analogy
   - Key quotes: exact wording with speaker
   - Connections: table mapping each key idea to a concept from the router, or to "orphan" if none fits
   - What's new: the list from step 4, or "Nothing new. This resource repeats: [concepts]"
   - Contradictions: anything that conflicts with the current summary, with the summary line quoted
6. Add the registry row with status "raw".
7. Add one line to INBOX "Pending tidy": note id, date ingested, number of new items, number of orphans.
8. For each orphan concept, add it to INBOX "Orphans" or bump its count by one.
9. Print the receipt: "Stored {id}. Files touched: note, registry, inbox. {n} new items, {m} orphans, {k} contradictions. Pending tidy: {total}."

The receipt is mandatory. It replaces every "don't forget" rule. If the receipt says a fourth file was touched, the ingest was wrong.

## Mode 2: TIDY

Run when the user asks, or when "Pending tidy" reaches 5, or when it has been more than 7 days since the last tidy (date in INBOX.md). Always confirm before starting, and say roughly how many notes and files it will touch.

Steps:
1. Read every note in "Pending tidy". Only read the What's new, Connections, and Contradictions sections. The rest was already captured.
2. Merge, do not append. For each concept touched, open its synthesis file and rewrite the relevant section so it reads as one position with evidence, not a list of who said what. Sources stay attributed and dated inside the Evidence section. A section that only grew a quote list was not tidied.
3. Contradictions. Each synthesis file has an "Open contradictions" section. For every new one:
   - If the newer view is better supported, update the Position and move the older view into Evidence with its date.
   - If both views hold, keep it in Open contradictions with both dates and the reason they differ.
   - Never delete a view. Views evolve.
4. Orphans. Any orphan in INBOX with 3 or more mentions becomes a new synthesis file, gets a router line in BRAIN-PROTOCOL.md, and leaves the orphan list. Below 3, it stays.
5. Quotes. Add notable quotes from the pending notes to 00-quotes.md.
6. Compress the summary. Rewrite KNOWLEDGE-SUMMARY.md to reflect the new positions. One line per concept, each line ending with the file path. If it exceeds 120 lines, shorten the weakest lines until it fits. Refresh the "Current context" block with the newest dated data only.
7. Mark each note "tidied" in the registry. Empty "Pending tidy". Write today's date as last tidy in INBOX.md.
8. Print the tidy report: notes merged, files rewritten, positions changed, contradictions resolved and left open, orphans promoted.

## Mode 3: ASK

1. Check KNOWLEDGE-SUMMARY.md. If it answers, answer from it and cite the file.
2. If not, use the router to find the right synthesis files, read them, answer.
3. Answer as a position, then evidence, then open contradictions if any. Not a list of everything ever said.
4. Weight by date. A newer view outranks an older view on the same question unless the older one has better data. Say which is which.
5. If "Pending tidy" is 5 or more, add one line: "Note: {n} recent resources are not merged yet, the answer may lag."
6. Cite file paths so the user can dig deeper.

## Synthesis file layout

Every synthesis file uses these sections, always in this order:

- Position: the brain's current view in a few lines
- Evidence: attributed and dated, newest first
- Data points: numbers and names that back the position
- Open contradictions: views that still conflict, with dates and the reason
- Related concepts: links to other synthesis files
- Last tidied: date

A file missing a section is not finished.

## Quality standards

- Precise numbers. "$7,000 car", not "cheap car". "0.7 fertility rate", not "very low".
- Attribution stays. "Ovas argues X", not "X is true".
- Source views and the brain's Position are different things. The Position is the synthesis, the Evidence is the sources.
- Cross-reference. The brain's value is in the connections between files.
- Extract everything on ingest. Ingest is the only time the full resource is read.

## Structural guarantees

Each one is enforced by a step above, not by memory.

- Ingest touches three files. The receipt proves it.
- Synthesis files change only in TIDY. Never during ingest, never during ask.
- The summary has a hard line cap and a single writer.
- Duplicates are caught twice: by link in step 2, by idea in step 4.
- Orphans have a threshold. No "misc" file exists.
- Every synthesis section is a rewrite, never an append. Quotes are the only append-only file.
- Contradictions have one home and are dated. Nothing is deleted.
