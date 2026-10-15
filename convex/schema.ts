import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // one row per space, holding its passphrase hash and its unlock attempt counter
  config: defineTable({
    key: v.string(),
    salt: v.optional(v.string()),
    hash: v.optional(v.string()),
    attempts: v.optional(v.number()),
    attemptWindow: v.optional(v.number()),
    setAt: v.optional(v.string()),
    /* A time in milliseconds, for rows that mark work in progress. */
    at: v.optional(v.number()),
  }).index("by_key", ["key"]),

  sessions: defineTable({
    token: v.string(),
    expires: v.number(),
    /* The account this session belongs to, when there is one. */
    account: v.optional(v.string()),
    /* "owner", "member" or "guest". Absent reads as "owner", which is what the
       sessions written before guests existed were. */
    kind: v.optional(v.string()),
    /* Which space this session sees. Absent reads as "octopus", which is where
       every session written before the split belonged. */
    space: v.optional(v.string()),
    /* A demo visitor, so each one keeps their own chats. */
    visitor: v.optional(v.string()),
  }).index("by_token", ["token"]).index("by_space", ["space"]),

  /**
   * A workspace beyond the owner's two. "demo" opens to anyone, with no
   * passphrase, on the deployment's hidden key and a daily allowance. "byok"
   * was made by a visitor: its passphrase opens it and every model call runs
   * on the visitor's own key, which stays in their browser and is never
   * written here.
   */
  workspaces: defineTable({
    slug: v.string(),
    name: v.string(),
    kind: v.string(),
    created: v.string(),
  }).index("by_slug", ["slug"]),

  /**
   * A member. A name and a password get them in. Their model key pays for their
   * own calls, and they choose whether it is remembered.
   *
   * A remembered key is stored sealed: AES-GCM ciphertext plus its nonce, under
   * a secret held in this deployment's environment. Only the last 4 characters
   * are kept in the clear, so the account screen can say which key is saved.
   */
  accounts: defineTable({
    name: v.string(),
    slug: v.string(),
    salt: v.string(),
    passHash: v.optional(v.string()),
    /* The earlier scheme used the model key itself as the credential. */
    keyHash: v.optional(v.string()),
    keyCipher: v.optional(v.string()),
    keyIv: v.optional(v.string()),
    keyHint: v.optional(v.string()),
    keySavedAt: v.optional(v.string()),
    created: v.string(),
    lastSeen: v.string(),
    /* The secret that signs this account's personal connector address. It
       travels in the URL a client stores, so it is the only credential an MCP
       call can carry. Absent means the account has no connector yet. */
    mcpToken: v.optional(v.string()),
    mcpMade: v.optional(v.string()),
    /* The project whose connector address this account holds. Absent reads
       as "octopus", where the only address lived before each project had one. */
    space: v.optional(v.string()),
  }).index("by_slug", ["slug"])
    .index("by_mcpToken", ["mcpToken"]),

  brains: defineTable({
    slug: v.string(),
    name: v.string(),
    type: v.string(),          // "subject" | "person"
    scope: v.string(),         // the one line that decides what belongs
    created: v.string(),
    /* "private" hides the brain from the public endpoints. "ask" lets anyone
       read it. "drop" will also let a key feed it, once keys exist. Absent
       reads as "ask", so brains made before this field keep behaving as they
       did. */
    visibility: v.optional(v.string()),
    /* The account slug that owns it. Absent means the owner's own brain, from
       before accounts existed. */
    owner: v.optional(v.string()),
    /* Which space holds it. Absent reads as "octopus", so every brain that
       existed before the split stays where it was. Slugs stay unique across
       both spaces, so a source, a concept or a candidate needs no space of its
       own: the brain it names carries one. */
    space: v.optional(v.string()),
    /* The other workspaces that see this brain too: one brain, two doors. Only
       the owner of its home workspace sets this, and never for a personal
       brain. Absent means the brain is its home's alone. */
    shared: v.optional(v.array(v.string())),
    /* Workspaces that may read this brain and never change it: the demo, which
       any visitor opens. */
    viewers: v.optional(v.array(v.string())),
    /* The last audit: the day it ran, and how many sources the folder held then. */
    audit: v.optional(v.object({ at: v.string(), sources: v.number() })),
    /* Pairs of concepts or people you said to keep apart, so an audit never asks again. */
    apart: v.optional(v.array(v.string())),
    /* What the last audit found, for the inbox to offer: concepts filed twice,
       titles not in English, concepts with no position. */
    findings: v.optional(v.any()),
    /* The category it sits under in the side panel and the picker: Wealth,
       Business, Life. Absent: no category. Never on a personal brain. */
    group: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  concepts: defineTable({
    brain: v.string(),
    slug: v.string(),
    n: v.number(),
    title: v.string(),
    position: v.string(),
    summaryLine: v.string(),
    evidence: v.array(v.any()),
    data: v.array(v.string()),
    conflicts: v.array(v.any()),
    sources: v.array(v.string()),
    related: v.array(v.string()),
    /* What each link means, from this concept to the one it names: it needs
       that one first, causes it, supports it, contradicts it, or is an example
       of it. A link with no entry here is plainly related. */
    kinds: v.optional(v.array(v.object({ to: v.string(), type: v.string() }))),
    /* In a personal brain, "contact": the card of one person, and the other
       names that person goes by. */
    tag: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    /* A contact's file: facts by section, dated history, links, what is open. */
    file: v.optional(v.any()),
    /* The day a contact's raw notes were last gathered from the saved chats. */
    rawScan: v.optional(v.string()),
    /* Left readable for the notes of a project made before the assets: the sections of its file a note rested on, whether the file
       changed there since, and the folder of its memory. They go when the project is turned into assets. */
    sections: v.optional(v.array(v.number())),
    stale: v.optional(v.boolean()),
    folder: v.optional(v.string()),
    updated: v.string(),
  }).index("by_brain", ["brain"])
    .index("by_brain_slug", ["brain", "slug"]),

  // the duplicate check reads this by normalised link, so it stays an index lookup
  sources: defineTable({
    sid: v.string(),
    link: v.string(),
    linkKey: v.string(),
    title: v.string(),
    author: v.string(),
    date: v.string(),
    location: v.string(),
    brains: v.array(v.string()),
    stored: v.string(),
    /* Which account fed it. Absent means the owner. This is what makes a
       contribution traceable, and revocable. */
    by: v.optional(v.string()),
  }).index("by_sid", ["sid"])
    .index("by_linkKey", ["linkKey"]),

  notes: defineTable({
    sid: v.string(),
    title: v.string(),
    author: v.string(),
    date: v.string(),
    topics: v.array(v.any()),
    quotes: v.array(v.any()),
    thin: v.array(v.string()),
    connections: v.array(v.any()),
    findings: v.any(),
    written: v.string(),
  }).index("by_sid", ["sid"]),

  /**
   * A conversation in the app: its questions and answers, kept so it can be
   * reopened and continued. An unpinned chat goes 30 days after its last
   * question, or when it falls past the newest 20. Up to 5 pinned chats stay.
   */
  chats: defineTable({
    space: v.string(),
    title: v.string(),
    /* The brain it asked, the ticked ones joined by commas, or "all". */
    brain: v.string(),
    pinned: v.boolean(),
    /* In the demo, the visitor whose chat it is. Absent: the workspace's. */
    owner: v.optional(v.string()),
    turns: v.array(v.any()),
    /* A chat about one concept: its brain/slug id. It reads that concept alone. */
    concept: v.optional(v.string()),
    created: v.number(),
    updated: v.number(),
  }).index("by_space_updated", ["space", "updated"]),

  /**
   * A workspace's own look, set in Setup: a logo and two colours. Octopus and
   * Squidgy wear their own without one; every other workspace wears Brain's
   * until it sets one. The demo keeps Brain's.
   */
  brands: defineTable({
    space: v.string(),
    /* A PNG the browser drew, 128 pixels a side at most, as a data URL. */
    logo: v.optional(v.string()),
    /* #rrggbb: the accent, and the page. */
    accent: v.optional(v.string()),
    bg: v.optional(v.string()),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /**
   * The models a workspace picked in Settings: one for the chat, Drop and
   * one-pagers. Absent reads as the deployment's defaults.
   */
  models: defineTable({
    space: v.string(),
    chat: v.optional(v.string()),
    /* The model projects used. Removed: left readable for rows written before, and dropped on the row's next save. */
    project: v.optional(v.string()),
    /* Languages. Files are always kept in English. How answers come back
       ("same" as asked, or "en"), and the language the mic listens in. The
       old "store" field is left readable for rows written before. */
    store: v.optional(v.string()),
    reply: v.optional(v.string()),
    voice: v.optional(v.string()),
    /* How much a Normal answer reads: "short" (its 12 best concepts) or "long" (up to 30, the default). */
    depth: v.optional(v.string()),
    /* What writes what is said into the mic: "browser", the free speech service of the browser, or absent for Whisper. */
    mic: v.optional(v.string()),
    /* Favourites: models to choose among, the cheapest one running. A daily
       check writes `chat` from this list, with when it looked and each model's
       price in dollars per million tokens. A model picked by hand clears all three. */
    favs: v.optional(v.array(v.string())),
    favAt: v.optional(v.number()),
    favPrices: v.optional(v.array(v.object({ id: v.string(), price: v.number() }))),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /* The public MCP endpoint has no passphrase, so a per-address counter is the
     only thing standing between a scraping loop and the deployment quota. */
  mcpHits: defineTable({
    who: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_who", ["who"]),

  /**
   * A drop in progress, held between MCP calls.
   *
   * The app keeps this in the browser across three requests. A connector has no
   * browser, so the steps meet here instead. Only the extraction is kept, never
   * the raw source, which is the same rule the notes follow.
   *
   * Rows expire, so an abandoned draft leaves nothing behind.
   */
  drafts: defineTable({
    token: v.string(),
    account: v.string(),
    link: v.string(),
    sid: v.string(),
    brain: v.string(),
    ext: v.any(),
    plan: v.any(),
    parts: v.number(),
    created: v.string(),
    expires: v.number(),
  }).index("by_token", ["token"]),

  /**
   * One row per transcript fetch, so the pace is visible before the quota runs
   * out. The vendor reports its own billing period, which is the number that
   * decides when to paste instead. This is the local view: what Octopus itself
   * spent, over any window, and it survives changing provider.
   */
  fetches: defineTable({
    at: v.number(),
    host: v.string(),
    ok: v.boolean(),
    chars: v.number(),
    why: v.string(),
  }).index("by_at", ["at"]),

  /**
   * A slim copy of each concept: what searching, planning, linking and the
   * app's lists need, without the evidence, the figures and the conflicts.
   *
   * A concept runs from 1.5 KB to 19 KB. Every question, plan and link job
   * used to read all of them, which stopped at about 4,400 concepts a space
   * and slowed a phone past 525. A card is about 1 KB, and a concept is read
   * whole only when it is opened. Every write to a concept rewrites its card.
   */
  cards: defineTable({
    cid: v.id("concepts"),
    brain: v.string(),
    slug: v.string(),
    n: v.number(),
    title: v.string(),
    summaryLine: v.string(),
    /* The opening of the position, for matching and short lists. */
    lead: v.string(),
    /* How many evidence entries and sources stand behind it. */
    ev: v.number(),
    src: v.number(),
    /* The newest few source ids, which linking reads as a weak bond. */
    srcIds: v.array(v.string()),
    related: v.array(v.string()),
    kinds: v.optional(v.array(v.object({ to: v.string(), type: v.string() }))),
    tag: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    seen: v.optional(v.string()),
    full: v.optional(v.boolean()),
    /* A person's lines still open: the app counts them without reading a file. */
    open: v.optional(v.number()),
    updated: v.string(),
    /* A print of what an answer reads of the concept, so a saved answer knows when it is stale. */
    sig: v.optional(v.string()),
  }).index("by_cid", ["cid"])
    .index("by_brain", ["brain"])
    .index("by_brain_title", ["brain", "title"]),

  /**
   * A concept's meaning as numbers, so a question or a link finds it by what
   * it says, not only by the words it shares. One row per concept, kept apart
   * from the concept so cards and lists stay light. Written in the background
   * after a drop, on the deployment's key.
   */
  vectors: defineTable({
    cid: v.id("concepts"),
    brain: v.string(),
    vec: v.array(v.float64()),
  }).index("by_cid", ["cid"])
    .vectorIndex("by_vec", { vectorField: "vec", dimensions: 1024, filterFields: ["brain"] }),

  /* The themes a folder holds: concepts that link to each other, named and
     summed up. Worked out again after each drop into that folder. */
  topics: defineTable({
    space: v.string(),
    brain: v.string(),
    title: v.string(),
    summary: v.string(),
    members: v.array(v.string()),
    updated: v.string(),
  }).index("by_brain", ["brain"]),

  /* What follows from two linked concepts of two folders: a conclusion neither
     states alone. Tasu's own, never a source, always shown as derived. */
  insights: defineTable({
    space: v.string(),
    key: v.string(),
    a: v.string(),
    b: v.string(),
    type: v.string(),
    title: v.string(),
    text: v.string(),
    at: v.string(),
  }).index("by_key", ["key"])
    .index("by_a", ["a"])
    .index("by_b", ["b"])
    .index("by_space", ["space"]),

  /* A person's history in a personal brain, one moment a row, so a person
     can grow without a size limit: what happened, its date (YYYY, YYYY-MM or
     YYYY-MM-DD), whether you were together, and the day it was told. */
  moments: defineTable({
    brain: v.string(),
    slug: v.string(),
    k: v.string(),
    d: v.string(),
    t: v.string(),
    seen: v.optional(v.boolean()),
    at: v.string(),
  }).index("by_person", ["brain", "slug", "d"]),

  /* Each error report sent with Send feedback: when, from which workspace,
     and its first words. It counts the reports an hour; the mail holds the rest. */
  feedback: defineTable({
    space: v.string(),
    /* In the demo, the visitor who sent it. */
    owner: v.optional(v.string()),
    error: v.string(),
    at: v.number(),
  }).index("by_space_at", ["space", "at"]),

  /* Everything the owner said about a person of their personal brain, word
     for word and dated: one row a message. Only that person's file reads it. */
  rawNotes: defineTable({
    brain: v.string(),
    slug: v.string(),
    date: v.string(),
    /* chat, interview, daily or import */
    kind: v.string(),
    text: v.string(),
    /* For an interview answer, the question it answered. */
    asked: v.optional(v.string()),
    at: v.number(),
  }).index("by_contact", ["brain", "slug", "at"]),

  /* A personal brain's interview: which questions are answered, known from
     the notes or skipped, the one waiting for an answer, and the twin test,
     whose answers are never filed. One row per personal brain. */
  interviews: defineTable({
    space: v.string(),
    brain: v.string(),
    on: v.boolean(),
    /* Question id to "a" answered, "k" known from the notes, "s" skipped. */
    marks: v.any(),
    pending: v.optional(v.any()),
    sinceCheck: v.number(),
    sinceAsk: v.number(),
    /* How many times it was started: the first start explains how it works. */
    opens: v.optional(v.number()),
    test: v.optional(v.any()),
    profile: v.optional(v.any()),
    /* The daily log: today's beats, the question waiting, today's answers and script, and the series line. */
    daily: v.optional(v.any()),
    updated: v.number(),
  }).index("by_brain", ["space", "brain"]),

  /**
   * An asset: a document, a page or a table. The text is never kept whole: it
   * is cut in sections, each with a light row in projectCards for the contents
   * list, and a heavy row in projectSections for the words. A question reads
   * the cards and opens the sections it needs. A project made before the
   * assets holds its files here too, until it is turned into assets.
   */
  projectFiles: defineTable({
    space: v.string(),
    /* The file's key: `assets-<space>~n`, or a project's slug for one of its files. */
    brain: v.string(),
    name: v.string(),
    /* "doc", "html" (a page, kept as text and shown rendered) or "table". */
    kind: v.string(),
    /* Made blank, not read from a file. */
    made: v.optional(v.boolean()),
    /* A table's sheets: name, columns with what they hold, and row count. A document has one with no columns. */
    sheets: v.array(v.any()),
    /* Characters read so far, sections stored so far, the id the next section takes. */
    chars: v.number(),
    parts: v.number(),
    next: v.number(),
    /* A table's size as stored, in bytes: a table may hold 6,000,000. */
    bytes: v.optional(v.number()),
    /* "reading" while pieces arrive, "ready" once the last one is in. */
    status: v.string(),
    /* Which read this is, so a new file replaces the old one whole. */
    ver: v.number(),
    at: v.number(),
    /* Left readable for rows written before: a project's one line on the file, and what it learned about where things are. */
    line: v.optional(v.string()),
    /* An asset's earlier version: the file number it replaced, kept hidden so Undo can bring it back. */
    prev: v.optional(v.number()),
    /* A version replaced by a newer one: kept for Undo, never listed. */
    hidden: v.optional(v.boolean()),
    /* An asset read from a web page: its address, to read it again. */
    url: v.optional(v.string()),
    /* A project's file moving into the assets: the key its rows still stand under, until they have all moved. */
    from: v.optional(v.string()),
    routes: v.optional(v.array(v.object({ t: v.array(v.string()), s: v.array(v.number()), n: v.number(), at: v.number(), q: v.optional(v.string()) }))),
  }).index("by_brain", ["brain"]),

  projectCards: defineTable({
    brain: v.string(),
    /* Stable for the life of the section; the order is `ord`, which a new section can fall between. */
    sid: v.number(),
    ord: v.number(),
    /* A table's sheet, as its position. 0 for a document. */
    sheet: v.number(),
    title: v.string(),
    summary: v.string(),
    chars: v.number(),
    /* A table's block: how many rows it holds. */
    rows: v.optional(v.number()),
    /* The words the section is known by: its most used stems and its numbers, so a message finds it without reading it. */
    keys: v.optional(v.array(v.string())),
    /* Left readable for rows written before: whether a project kept the section's meaning. */
    meant: v.optional(v.boolean()),
  }).index("by_brain_ord", ["brain", "ord"])
    .index("by_brain_sid", ["brain", "sid"]),

  projectSections: defineTable({
    brain: v.string(),
    sid: v.number(),
    /* A document's words as Markdown, or a table's rows as CSV with no header. */
    text: v.string(),
  }).index("by_brain_sid", ["brain", "sid"]),

  /**
   * One row a folder of files. For the assets, the number the next asset
   * takes. For a project made before the assets, what framed its chat: the
   * Brief, the State of play and what it still asked, read once to write its
   * notes when it is turned into assets.
   */
  projectBriefs: defineTable({
    brain: v.string(),
    brief: v.optional(v.string()),
    briefAt: v.optional(v.number()),
    state: v.optional(v.string()),
    stateAt: v.optional(v.number()),
    asks: v.optional(v.array(v.object({ id: v.string(), q: v.string(), at: v.number() }))),
    next: v.optional(v.boolean()),
    /* The number the next asset takes: assets are numbered from 2 and a number is never used twice. */
    nextFid: v.optional(v.number()),
    folders: v.optional(v.array(v.object({ name: v.string(), scope: v.string() }))),
  }).index("by_brain", ["brain"]),

  /**
   * What the workspace costs, month by month: one row a kind of work ("folders" for the main chat and a folder's, "personal" for the
   * personal brain's, "assets" for a chat that tags an asset and a file read in, and drops, upkeep, one-pagers and voice) a month,
   * added to after each call from the usage the model host reports. A call the host gave no price for counts in `calls` and not in
   * `priced`, so the total says when it may be low. Shown in Settings.
   */
  chatSpend: defineTable({
    space: v.string(),
    month: v.string(),
    kind: v.string(),
    usd: v.number(),
    priced: v.number(),
    calls: v.number(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    cached: v.number(),
    /* Answers given again from the cache, for no call. */
    reused: v.optional(v.number()),
    at: v.number(),
  }).index("by_space_month", ["space", "month"]),

  /**
   * Answers given again: a question asked a second time, in the same place and the same way, on folders that have not changed since
   * (`fp`, the print of every card it could read), is answered from here for no model call. Kept 14 days.
   */
  answerCache: defineTable({
    space: v.string(),
    key: v.string(),
    fp: v.string(),
    answer: v.string(),
    sources: v.number(),
    opened: v.array(v.string()),
    tagged: v.optional(v.array(v.string())),
    at: v.number(),
  }).index("by_space_key", ["space", "key"])
    .index("by_space_at", ["space", "at"]),

  /* A change a chat proposed to an asset, or a new asset it proposed: what it
     would do, what it replaced once applied, so it can be undone. The last 10 stay. */
  projectEdits: defineTable({
    brain: v.string(),
    at: v.number(),
    /* "open", "applied", "dismissed" or "undone". */
    status: v.string(),
    ops: v.array(v.any()),
    /* What the app shows: a line each, with the words before and after. */
    preview: v.array(v.any()),
    /* What applying replaced, to put back. */
    before: v.optional(v.array(v.any())),
    /* A new asset a chat proposed: the file number it was made as, once made. */
    made: v.optional(v.union(v.number(), v.null())),
  }).index("by_brain_at", ["brain", "at"]),

  candidates: defineTable({
    brain: v.string(),
    slug: v.string(),
    title: v.string(),
    notes: v.array(v.string()),
    count: v.number(),
    updated: v.string(),
  }).index("by_brain_slug", ["brain", "slug"]),
});
