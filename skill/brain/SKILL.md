---
name: brain
description: A knowledge base split into brains, in plain markdown. A brain is a subject or a person, and it grows without limit while its concepts fit its scope. Use this skill whenever the user drops an article, video transcript, study, URL, or any resource to store; says "feed the brain", "add this to the brain", "brain this", "drop this"; asks a question the brain should answer from its stored knowledge; says "create a brain", "new brain", "set up a brain"; or says "/brain". Read PROTOCOL.md before acting. When unsure whether to drop or ask, ask the user.
---

# Brain

You manage a knowledge base under `brains/`. Plain markdown. No database, no app, no queue.

Two functions the user calls: **drop** and **ask**. One rare third: **create a brain**.

The full rule set is `PROTOCOL.md` at the repository root. It is the authority. This file is the working summary and it points at the rules by number.

## First action, every time

1. If `brains/MAP.md` is missing, no brain exists yet. Go to CREATE.
2. Otherwise read `brains/MAP.md`. Search it, never read it whole (R6.1). It carries the brains table, then one concept section per brain.

Read nothing else until you know the mode.

## Detect the mode

| Mode | Signs |
|---|---|
| DROP | An uploaded file, a URL, a transcript, or "feed the brain", "add this", "store this", "brain this" |
| ASK | A question about a concept, a person, a framework, or how something works |
| CREATE | "create a brain", "new brain", "I want a brain for X" |
| UNSURE | Ask: "Add this to the brain, or ask a question about it?" |

## Mode 1 · DROP

Five steps. The user reads step 4 only.

### Step 1 · Check (R1.1 to R1.3)

Strip tracking parameters. Pull the YouTube video id from any URL format. Search `brains/SOURCES.md` for that link or id.

A match ends the drop. Say "Already stored" and name the note.

A video link with no transcript: ask the user for the transcript, then wait. The check runs first so a repeat costs zero pasting.

### Step 2 · Read (R2.1 to R2.4)

Read the whole transcript. A skim is a failed drop.

**Extract wide.** Cover every topic present, whether or not it matches a brain. The transcript gets discarded after this, so there is no second read.

Keep: ideas, numbers, names, dates, reasoning chains, exact quotes, historical comparisons.
Drop: repetition, advertising, small talk, verbal filler.

Write `brains/notes/{id}.md` from `templates/note.md`. Six sections, fixed order, uncapped length.

Then discard the transcript. Keep the link and the location of the user's own copy.

### Step 3 · Compare (R3.1 to R3.5)

**Read summaries, never whole brains.** One line per concept shortlists what this source touches. Opening every concept file here is the one thing that would make a big brain slow.

Then open only the shortlisted concept files. Compare each idea against that file's position and evidence, which is where an echo shows up.

Sort findings into three lists for the card:

- **new**: ideas, numbers or reasoning the brain lacks
- **echo**: what this repeats, naming the note it repeats
- **conflict**: what contradicts a stored position, naming that position

Claims carrying no data get marked **thin** in the note. They never enter a concept file and they never reach the card.

Rank the conflicts. A flip-level conflict would change a position. A caveat-level conflict adds nuance and gets logged without a question.

### Step 4 · Card (R4.1 to R4.6)

One card per source. A batch gets one card, grouped by source.

```
{id} · {author} · {date} · {length}

Goes to   {brain} (subject) · {brain} (person)
Concepts  {n} matched · {n} candidates: {names}
New       {n} items, top 3: ...
Echoes    {n}, repeats notes {ids}

Conflicts {n}, all kept both unless you say otherwise
  1  {concept}   new: {claim}, {number}, {date}
                 stored: {position line}, {date}
  2  {concept}   new: ...
                 stored: ...

Reply: "ok", or "new on 1, old on 2", or change any line.
```

Every flip-level conflict shows, numbered. No cap. Silence means keep both, so a long list costs the user nothing.

Four outcomes per conflict: accept new, keep old, keep both, reject source.

A source that is pure echo gets flagged, and the user decides whether it stays.

In a **person brain**, a claim contradicting that person's own earlier view is drift, not conflict. Log it with both dates and raise no question.

### Step 5 · Settle (R5.1 to R5.10)

Everything here runs after the reply, in one pass, before you say done.

1. Add the `SOURCES.md` row: id, link, date, author, copy location, destination brains.
2. Add a source row to each touched concept file. Write the card choices into the note.
3. **Re-derive each touched position from its full evidence list**, now carrying this source. Rewrite it as one view. A grown quote list is a failed settle.
4. Superseded views move into evidence with their date. Open conflicts stay dated. Every view survives.
5. **Seeding**: a brain holding zero concept files turns every concept in its first drop into a file. From the second drop on, a candidate needs 3 mentions.
6. **Promotion** re-reads the notes that mentioned the candidate, so the new file opens with all of them as evidence.
7. A candidate outside every scope stays in the map, counted, until the user creates a brain for it.
8. Rewrite each touched summary as the scope line plus exactly one line per concept file. No cap, no trimming. Refresh that brain's map section.
9. Keep 12 evidence entries per concept. Older entries agreeing with the position compress to one line carrying the count and the date range. Superseded views never compress. The notes keep every detail.
10. Verify per touched brain: summary lines equal concept files plus one, map rows equal concept files, every owner resolves, each rewritten position reads as one view matching its own evidence.

Then print the receipt:

```
Stored {id}. Brains {names}.
Rewritten: {n} positions · {n} summaries · map
{a} new · {b} echoes · {c} conflicts flipped · {d} kept both
Coherent. Open conflicts: {concepts}
```

The receipt is mandatory. A receipt naming a file outside the allowed set proves the drop went wrong.

## Mode 2 · ASK

Two steps (R6.1 to R6.7).

**Where.** Search the map. Pick at most 3 brains. Read their summaries. Open only the concept files the question needs, following owners across brains.

**What.** Answer the way a well-read colleague would.

- The first sentence answers the question. Natural prose, addressed to the person asking.
- Numbers, dates and findings sit inside the answer.
- **Names stay out of the answer text**, because the sources line carries them.
- Newer evidence wins on the same question, and better data overrides that.
- An open conflict gets stated in prose when it changes what the user would do.
- Close with one line: `Sources: {author}, {date} · {author}, {date}`. **No file paths.**
- A brain fed by fewer than 10 sources still answers, opening by saying it rests on a small brain.

A question about a **person** reads their brain and names them throughout. The names-out rule covers subject brains only.

**Wrong shape**

> Position: Cold exposure helps recovery. Guest A argues 11 minutes a week at 11°C works. Guest B counters that the effect fades.
> `brain-subject-health/02-cold-exposure.md`

**Right shape**

> Yes, at 11 minutes a week split over 2 or 3 sessions, in water near 11°C. One caveat worth planning around: the effect faded after 8 weeks in one trial group, so run it as a cycle rather than a permanent habit.
>
> Sources: Guest A, March 2026 · Guest B, June 2026

## Mode 3 · CREATE

The user creates brains (R7.5, R7.6). Ask for three things, one at a time:

1. **The name.** One or a few words.
2. **The scope**, in one line. This line is the only test of what belongs, so push back once on a vague answer: "health" is a folder, "sleep, recovery and training load for my own routine" is a brain.
3. **Subject or person.**

**Before creating**, show the closest existing scope and ask whether a new brain is worth it. A yes creates `brains/brain-{type}-{slug}/SUMMARY.md` from `templates/SUMMARY.md`, holding the scope line and nothing else, plus a map row. A no points the user at the existing brain.

On a first-ever brain, also create `brains/MAP.md` and `brains/SOURCES.md` from their templates, and the `brains/notes/` folder.

End with: "Brain ready. Drop a source to feed it."

## Structure

```
brains/
  MAP.md                    brains table, then one concept section per brain
  SOURCES.md                one row per source
  notes/{id}.md             one note per source

  brain-subject-{slug}/
    SUMMARY.md              scope line, then one line per concept
    {nn}-{slug}.md          one concept

  brain-person-{slug}/
    SUMMARY.md
    {nn}-{slug}.md
```

File shapes live in `templates/`. Read the template before writing a file of that kind.

Notes and the source list sit at the root because raw capture belongs to no brain. That is what lets a repeat get caught across every brain at once.

## Writing rules

Apply to every note, position, summary, answer and card. Quotes are the one exception.

1. No em-dashes.
2. Under 30 words per sentence.
3. Data replaces adjectives. "0.7 fertility rate", never "very low".
4. Weasel words removed.
5. Every line passes the "so what" test. A failing line gets rewritten.
6. Simple expression.
7. Positive phrasing. State what holds.
8. **Quotes stay exact.** Rules 1 to 7 stop at the quote marks, because editing a quote destroys the evidence.
9. **Everything the brain writes is English.** A source in another language gets extracted into English. Its quotes stay in the original, exact, because a translated quote stops being evidence.

## Guarantees

Each one is held by a rule, not by memory.

- Position text changes only after the card reply.
- Positions get re-derived from the whole evidence list, never appended to.
- Every source is checked twice: by link, then by idea.
- Every view survives, carrying its date.
- A summary carries one line per concept file, always. Never capped, never trimmed.
- Candidates carry a threshold, so a misc file never appears.
- Raw transcripts stay outside the brain.
- Every drop ends coherent, and the receipt proves it.
- A brain grows without limit while its concepts fit its scope.

## Pitfalls

- Opening every concept file during Compare. Read summaries first, then only the shortlist.
- Skimming a transcript. The read happens once.
- Appending to a position instead of re-deriving it. A grown quote list is a failed settle.
- Putting names inside an answer to a subject question. They belong on the sources line.
- Capping or trimming a summary. It carries one line per concept file, whatever the count.
- Saying done before the verify step passes.
- Editing a quote to satisfy a writing rule.
- Writing a note in the source's language. The note is English, the quotes are not.
