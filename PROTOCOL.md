# Brain Protocol

41 rules, 9 writing rules, 9 guarantees. Every rule carries an address, so a change request names a number.

A knowledge base split into brains. A brain is a subject or a person. A brain grows without limit while its concepts fit its scope.

## What you do

**Drop.** Drop a link, a transcript, or a batch. Paste the transcript when a video link arrives without one. Reply to one card. One or two touches per source.

**Ask.** Ask the question the way you would ask a person. Read a direct answer. One touch.

**Create a brain.** Rare. Name it, give it a one-line scope, say subject or person.

## No queue

Every drop finishes coherent. The positions it touches get rewritten before the brain says done, so nothing waits in a pile and no counter tracks a cleanup.

This works because a position is re-derived from its whole evidence list, never appended to. Adding a sixth source rewrites the view from all six, so one weak source cannot drag a position on its own. A flip still needs a card reply.

## Two kinds of brain

| Folder prefix | Answers | Concept file holds | Names in the answer |
|---|---|---|---|
| `brain-subject-` | "Does cold water help recovery?" | Your position, from all sources | Kept out, listed at the end |
| `brain-person-` | "What does she argue about recovery?" | That person's position, dated so drift shows | Named, because the person is the subject |

The folder name says which, so nothing inside has to.

One source often lands in both. An interview about sleep feeds the sleep brain and the guest's own brain, from one note. The card proposes both, and you confirm them in the same reply.

## Thresholds

| Trigger | Value |
|---|---|
| Mentions before a candidate becomes a concept | 3 |
| Sources under which an answer says "small brain" | 10 |
| Brains read per question | 3 |
| Evidence entries kept per concept | 12 |
| Concepts per brain | no limit |
| Sources per brain | no limit |
| Summary length | no limit |
| Note length | no limit |

Nothing counts concepts or sources against a limit, so fit is the only gate on a brain's size.

## Size and speed

Two rules keep speed flat as a brain grows: summaries get read, whole brains never do, and the map gets searched, never read whole. Both operations then cost what the question needs, not what the brain holds.

| Brain size | Read per drop | Read per question | Summary lines scanned | Files opened |
|---|---|---|---|---|
| 10 concepts · 30 sources | 1.0k | 3.5k | 10 | 3 to 5 |
| 50 concepts · 200 sources | 1.4k | 3.9k | 50 | 3 to 5 |
| 200 concepts · 1,000 sources | 2.6k | 5.1k | 200 | 3 to 5 |
| 500 concepts · 5,000 sources | 5.0k | 7.5k | 500 | 3 to 5 |

Words read, estimated. The shallow scan grows with the summary. The deep work, files opened and compared, stays at 3 to 5 whatever the size.

| Grows with | Effect on speed |
|---|---|
| Concepts in a brain | One summary line each, the only linear part |
| Sources in a brain | None. Notes stay closed, the duplicate check is an id lookup |
| Sources touching one concept | None past 12, where evidence compresses |
| Brains in the base | None. The map gets searched, never read whole |

## Structure

Raw capture belongs to no brain, so notes and the source list sit at the root. Interpretation belongs to one brain, so positions sit inside it. That split lets a repeat get caught across every brain at once.

```
brains/
  MAP.md                    the brains table, then one concept section per brain
  SOURCES.md                one row per source: id, link, date, author, location, brains
  notes/{id}.md             one note per source

  brain-subject-{slug}/
    SUMMARY.md              the scope line, then one line per concept
    {nn}-{slug}.md          one concept: Position · Evidence · Data ·
                            Open conflicts · Sources · Related · Updated

  brain-person-{slug}/
    SUMMARY.md
    {nn}-{slug}.md          same seven sections, their view, dated
```

The folder name carries the type, so a brain declares nothing inside itself. Numbered files are concepts, and `SUMMARY.md` is the only other file, so a concepts folder earns nothing. The map lists concepts under their brain, so sleep in health and sleep in a person brain never collide, and a check on one brain reads one section.

Deepest path: `brains/brain-subject-health/01-sleep.md`. Two folders deep.

**Note sections, fixed order:** Source · Ideas by topic · Data · Quotes · Connections · Findings

Findings holds the three card lists plus thin claims.

## Function 1 · Drop

Extraction covers every topic in a source, so the destination changes nothing about what gets read. That is why one card carries both the routing and the argument. You read step 4. The brain runs the rest.

### Step 1 · Check

| # | Rule |
|---|---|
| R1.1 | Strip tracking parameters from the link. Pull the video ID from any YouTube format. |
| R1.2 | Search the source list for that link or ID. A match ends the drop. Name the existing note. |
| R1.3 | A video link arriving with no transcript triggers a request. Ask for the transcript, then wait. |

### Step 2 · Read

The transcript gets discarded, so this read is the only one. Extraction covers every topic present, whatever the destination turns out to be.

| # | Rule |
|---|---|
| R2.1 | Read the full transcript. A skim is a failed drop. Extract wide: every topic, whether or not it matches a subject. |
| R2.2 | Keep ideas, numbers, names, dates, reasoning chains, exact quotes, historical comparisons. Drop repetition, advertising, small talk, filler. |
| R2.3 | Write the note in the six fixed sections. Length stays uncapped. |
| R2.4 | Discard the transcript once extraction ends. Keep the link and the location of your copy. |

### Step 3 · Compare

Comparing finds what is new and what is echoed. The rules below fix the order of reads, so this step costs the same on a brain of 8 concepts and a brain of 200.

| # | Rule |
|---|---|
| R3.1 | Read summaries, never whole brains. One line per concept is enough to shortlist what this source touches. Opening every concept file here is the one thing that would make a big brain slow. |
| R3.2 | Open only the shortlisted concept files. Compare each idea against that file's position and evidence, which is where an echo shows up. |
| R3.3 | Map each idea to a concept, or mark it a candidate. Propose every brain it belongs to, subject and person. |
| R3.4 | Sort findings into three lists for the card: new, echo with the note it repeats, conflict with the position it hits. Claims carrying no data get marked thin in the note, and never enter a concept file. |
| R3.5 | Rank conflicts. A flip-level conflict would change a position. A caveat-level conflict adds nuance. |

### Step 4 · Card

A brain that swallows every claim goes incoherent. So the brain argues back here, on the same card that asks where the source goes. Every conflict gets a number, and one line settles all of them.

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

| # | Rule |
|---|---|
| R4.1 | One card per source. A batch of sources gets one card, grouped by source. |
| R4.2 | The card shows every destination brain, the concepts, the three lists, and every flip-level conflict, numbered, each with the new claim and the stored position, both dated. |
| R4.3 | One reply from you. "ok" confirms everything. Otherwise name the numbers to flip, change a destination, or reject the source. |
| R4.4 | Silence on a conflict means keep both. Nothing gets deleted by default, so a long list costs you nothing. |
| R4.5 | A source that is pure echo gets flagged on the card, and you decide whether it stays. |
| R4.6 | In a person brain, a claim contradicting that person's own earlier view is drift, not conflict. It gets logged with both dates and raises no question. |

### Step 5 · Settle

Filing and rewriting happen together, in one pass, after your reply. The receipt appears once the brain is coherent again.

| # | Rule |
|---|---|
| R5.1 | Add the source-list row: link, date, author, copy location, destination brains. |
| R5.2 | Add a source row to each touched concept file, and write your card choices into the note. |
| R5.3 | Re-derive each touched position from its full evidence list, now carrying this source. Rewrite it as one view. A grown quote list is a failed settle. |
| R5.4 | Superseded views move into evidence with their date. Open conflicts stay dated. Every view survives. |
| R5.5 | A brain holding zero concept files seeds directly: every concept in the first drop becomes a file. From the second drop on, candidates need 3 mentions. The owner overrides the wait by picking a candidate on the card, and that candidate becomes a file in the same drop. |
| R5.5b | A drop whose only finding is a first or second mention still stores the source and the note, and the receipt names the count it reached. Refuse a drop only when nothing lands anywhere. |
| R5.6 | Promotion re-reads the notes that mentioned the candidate, so the new file opens with all of them as evidence, not only the latest. |
| R5.7 | A candidate outside every scope stays in the map, counted, until you create a brain for it. |
| R5.8 | Rewrite each touched summary as the scope line plus exactly one line per concept file. No cap, no trimming, no ordering rule. Add a concept file, gain a line. Refresh that brain's section of the map. |
| R5.9 | Keep 12 evidence entries per concept. Older entries agreeing with the position compress to one line carrying the count and the date range. Superseded views never compress, since they are the record of a flip. The notes keep every detail. |
| R5.10 | Verify, for each touched brain: summary lines equal concept files plus one, map rows equal concept files, every owner resolves, and each rewritten position reads as one view that matches its own evidence. Then print the receipt. |

## Function 2 · Ask

The map costs one cheap read and narrows the search to three brains. Then the answer arrives the way a well-read colleague would give it: the answer itself, carrying the numbers, and a single sources line underneath.

**Wrong shape**

> Position: Cold exposure helps recovery. Guest A argues 11 minutes a week at 11°C works. Guest B counters that the effect fades.
> `brain-subject-health/02-cold-exposure.md`

**Right shape**

> Yes, at 11 minutes a week split over 2 or 3 sessions, in water near 11°C. One caveat worth planning around: the effect faded after 8 weeks in one trial group, so run it as a cycle rather than a permanent habit.
>
> Sources: Guest A, March 2026 · Guest B, June 2026

Shape only. Names and figures are placeholders.

| # | Rule |
|---|---|
| R6.1 | Search the map, never read it whole. Pick at most 3 brains, read their summaries, open only the concept files the question needs, following owners across brains. |
| R6.2 | The first sentence answers the question. Natural prose, written as a reply to the person asking. |
| R6.3 | Numbers, dates and findings stay inside the answer. Names stay out of it, because the sources line carries them. |
| R6.4 | A question about a person reads their brain, and names them throughout. R6.3 covers subject brains only. |
| R6.5 | Newer evidence wins on the same question, and better data overrides that. An open conflict gets stated in prose when it changes what you would do. |
| R6.6 | Close with one line: `Sources: {author}, {date} · {author}, {date}`. No file paths. |
| R6.7 | A brain fed by fewer than 10 sources still answers, and the answer opens by saying it rests on a small brain. |

## Ownership

Dopamine touches health and performance. Two positions on dopamine means the brain contradicts itself, so a concept gets exactly one home and the other brains link to it.

| # | Rule |
|---|---|
| R7.1 | One concept, one owner file per brain. Other brains reach it through their related section, and the map names every owner. |
| R7.2 | One source feeds many brains. The note stays single, and every affected position gets settled in the same drop. |
| R7.3 | A subject brain and a person brain may both hold the same concept. They answer different questions, so each keeps its own position, and each cites the other. |
| R7.4 | Every brain carries a one-line scope at the top of its summary. That line is the only test of what belongs, and it grows the brain without limit while concepts keep fitting it. |
| R7.5 | You create brains. Name it, give it a scope line, say whether it is a subject or a person. |
| R7.6 | Before creating, the brain shows the closest existing scope and asks whether a new brain is worth it. A yes creates the folder and its summary. A no points you at the existing brain. |

## Writing rules

These apply to everything the brain writes and everything the brain says back.

| # | Rule |
|---|---|
| W1 | No em-dashes. |
| W2 | Under 30 words per sentence. |
| W3 | Data replaces adjectives. "0.7 fertility rate", never "very low". |
| W4 | Weasel words removed. |
| W5 | Every line passes the "so what" test. A failing line gets rewritten. |
| W6 | Simple expression. |
| W7 | Positive phrasing. State what holds. |
| W8 | Quotes stay exact. W1 through W7 stop at the quote marks, because editing a quote destroys the evidence. |
| W9 | **Everything the brain writes is English.** A source in another language gets extracted into English. Its quotes stay in the original, exact, because a translated quote stops being evidence. |

## Guarantees

Each line below is held in place by a numbered rule above. That is why they hold across a thousand sources.

| # | Guarantee | Held by |
|---|---|---|
| G1 | Position text changes only after your card reply | R4.3, R5.3 |
| G2 | Positions get re-derived from the whole evidence list, never appended to | R5.3 |
| G3 | Every source is checked twice: by link, then by idea | R1.2, R3.2 |
| G4 | Every view survives, carrying its date | R5.4 |
| G5 | A summary carries one line per concept file, always. Never capped, never trimmed | R5.8, R5.10 |
| G6 | Candidates carry a threshold, so a misc file never appears | R5.5, R5.7 |
| G7 | Raw transcripts stay outside the brain | R2.4 |
| G8 | Every drop ends coherent, and the receipt proves it | R5.10 |
| G9 | A brain grows without limit while its concepts fit its scope | R7.4, R5.9 |

## The receipt

A receipt naming a file outside the allowed set proves the drop went wrong. So the receipt does the work that a list of warnings used to do.

```
Stored {id}. Brains {names}.
Rewritten: {n} positions · {n} summaries · map
{a} new · {b} echoes · {c} conflicts flipped · {d} kept both
Coherent. Open conflicts: {concepts}
```
