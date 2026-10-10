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
    /* In a project: the sections of its file this note rests on, and whether the file changed there since it was written. */
    sections: v.optional(v.array(v.number())),
    stale: v.optional(v.boolean()),
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
   * REMOVED FEATURES. The tables modes, projects, onepagers and pages, with
   * gaps, scouts, finds, heat, labs and labTurns further down, are no longer written or read:
   * Projects, saved one-pagers, the side panel's mode, the old blind-spot log,
   * the scouts and the map are gone. Their definitions stay only so a deploy
   * accepts the rows still there. Run `npx convex run admin:clearRemoved --prod`
   * until it says runAgain: false, then delete these ten definitions.
   */

  /* A workspace's side panel mode. Removed. */
  modes: defineTable({
    space: v.string(),
    full: v.boolean(),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /* A project: a chat and a page over some folders. Removed. */
  projects: defineTable({
    space: v.string(),
    name: v.string(),
    brains: v.array(v.string()),
    /* In the owner's words: what the page keeps up to date, and how the chat answers. */
    instructions: v.string(),
    /* An HTML file, 60 KB at most, whose layout every build keeps. */
    template: v.optional(v.string()),
    templateName: v.optional(v.string()),
    /* Rebuild the page when a source lands in one of its folders. Off unless the owner turns it on. */
    auto: v.boolean(),
    /* Answers from its chat waiting for the next Build, which puts them on the page. */
    pending: v.optional(v.array(v.any())),
    /* A source landed since the last build. */
    stale: v.optional(v.boolean()),
    /* When a background rebuild started, so the next drop does not start another. */
    building: v.optional(v.number()),
    /* Its chat: the last 40 questions and answers. */
    turns: v.array(v.any()),
    created: v.number(),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /* Every one-pager built, kept to open again. Removed: a page is built, shown and mailed, never stored. */
  onepagers: defineTable({
    space: v.string(),
    owner: v.optional(v.string()),
    title: v.string(),
    /* The page as the app draws it, its text for Copy, and what built it, so Mail can build it again. */
    page: v.any(),
    text: v.string(),
    ask: v.any(),
    at: v.number(),
  }).index("by_space_at", ["space", "at"]),

  /* Each build of a project's page. Removed. */
  pages: defineTable({
    project: v.id("projects"),
    v: v.number(),
    html: v.string(),
    why: v.string(),
    at: v.number(),
  }).index("by_project_v", ["project", "v"]),

  /**
   * The models a workspace picked in Settings: one for the chat, Drop and
   * one-pagers, one for projects. Absent reads as the deployment's defaults.
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
    /* Favourites: models to choose among, the cheapest one running. A daily
       check writes `chat` from this list, with when it looked and each model's
       price in dollars per million tokens. A model picked by hand clears all three. */
    favs: v.optional(v.array(v.string())),
    favAt: v.optional(v.number()),
    favPrices: v.optional(v.array(v.object({ id: v.string(), price: v.number() }))),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /* Questions the brains could not answer, once logged. Removed. */
  gaps: defineTable({
    space: v.string(),
    q: v.string(),
    gap: v.string(),
    find: v.string(),
    brains: v.array(v.string()),
    at: v.number(),
  }).index("by_space_at", ["space", "at"]),

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
    /* chat, interview or import */
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
    updated: v.number(),
  }).index("by_brain", ["space", "brain"]),

  /* Removed with the scouts: nothing writes or reads these two. They stay until
     admin:clearRemoved has emptied them, then these definitions go. A feed a
     folder followed, and a piece a scout found. */
  scouts: defineTable({
    space: v.string(),
    brain: v.string(),
    /* The address you gave, and the RSS or Atom feed it led to. */
    url: v.string(),
    feed: v.string(),
    name: v.string(),
    kind: v.string(),          // "youtube" | "feed"
    added: v.string(),
    /* When it was last read, the newest piece it has seen, and why the last read failed. */
    checked: v.optional(v.string()),
    seen: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_space", ["space"]),

  finds: defineTable({
    space: v.string(),
    brain: v.string(),
    scout: v.string(),
    link: v.string(),
    key: v.string(),
    title: v.string(),
    date: v.string(),
    author: v.string(),
    status: v.string(),        // "new" | "read" | "failed" | "dropped" | "skipped"
    found: v.string(),
    /* What the read says: a summary, the concepts it bears on and how, the ideas it adds. */
    read: v.optional(v.any()),
    /* The text read, so dropping it reads it again for free. */
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_space", ["space", "status"]).index("by_key", ["space", "key"]).index("by_scout", ["scout"]),

  /* Removed with the map: nothing writes or reads it. It stays until
     admin:clearRemoved has emptied it, then this definition goes. */
  heat: defineTable({
    space: v.string(),
    brain: v.string(),
    slug: v.string(),
    n: v.number(),
    days: v.array(v.string()),
  }).index("by_space", ["space"]).index("by_concept", ["space", "brain", "slug"]),

  /* Removed with the lab (twin calls between two workspaces): nothing writes or
     reads these two. They stay until admin:clearRemoved has emptied them, then
     these definitions go. */
  labs: defineTable({
    title: v.string(),
    topic: v.string(),
    a: v.string(),
    b: v.string(),
    starter: v.string(),
    status: v.string(),
    turns: v.number(),
    until: v.number(),
    last: v.number(),
    gen: v.number(),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
    created: v.number(),
    updated: v.number(),
  }),

  labTurns: defineTable({
    lab: v.id("labs"),
    n: v.number(),
    from: v.string(),
    text: v.string(),
    because: v.optional(v.string()),
    done: v.optional(v.boolean()),
    at: v.number(),
  }).index("by_lab", ["lab", "n"]),

  /**
   * A project's one file, or its one table. The text is never kept whole: it
   * is cut in sections, each with a light row in projectCards for the contents
   * list, and a heavy row in projectSections for the words. A question reads
   * the cards and opens a few sections.
   */
  projectFiles: defineTable({
    space: v.string(),
    /* The project's folder: a brain of type "project". */
    brain: v.string(),
    name: v.string(),
    /* "doc", "html" (a page, kept as text and shown rendered) or "table". */
    kind: v.string(),
    /* Made in the project by describing it, not read from a file: the chat's changes to it apply at once, and can be undone. */
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
    /* What the file is, in one line, for the project's map of its files. */
    line: v.optional(v.string()),
    /* What the project has learned about where things are: the words of a question (stems), the sections that answered it, how often, and when. A new file takes them away. */
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
    /* The words the section is known by: its most used stems and its numbers, so a question in the project's other files finds it without reading it. */
    keys: v.optional(v.array(v.string())),
    /* Its meaning is kept (a row in projectVectors made from its title and summary). A section made by the chat has none until the next message that reads the project's other files makes it. */
    meant: v.optional(v.boolean()),
  }).index("by_brain_ord", ["brain", "ord"])
    .index("by_brain_sid", ["brain", "sid"]),

  projectSections: defineTable({
    brain: v.string(),
    sid: v.number(),
    /* A document's words as Markdown, or a table's rows as CSV with no header. */
    text: v.string(),
  }).index("by_brain_sid", ["brain", "sid"]),

  /* A project's one running thread: its last 4 exchanges, older ones gone. */
  projectThreads: defineTable({
    brain: v.string(),
    turns: v.array(v.any()),
    updated: v.number(),
  }).index("by_brain", ["brain"]),

  /**
   * What frames a project's chat beyond its notes, one row a project. The Brief
   * is the owner's words on who the chat is here, the goal, the audience, the
   * rules and when to speak up: every message reads it. The State of play is
   * the chat's own short summary of where the project stands, rewritten when an
   * exchange changes it. The asks are what the chat still needs from the
   * owner. `next` is false when the owner turned off the closing next step.
   */
  projectBriefs: defineTable({
    brain: v.string(),
    brief: v.optional(v.string()),
    briefAt: v.optional(v.number()),
    state: v.optional(v.string()),
    stateAt: v.optional(v.number()),
    asks: v.optional(v.array(v.object({ id: v.string(), q: v.string(), at: v.number() }))),
    next: v.optional(v.boolean()),
    /* The number the next extra file takes: files are numbered from 2 and a number is never used twice. */
    nextFid: v.optional(v.number()),
  }).index("by_brain", ["brain"]),

  /**
   * The meaning of each section of a project's files, as numbers, so a question
   * finds a section by what it says and not only by its words, in another
   * language too. `base` is the project, so one search reads every file of it.
   */
  projectVectors: defineTable({
    base: v.string(),
    brain: v.string(),
    sid: v.number(),
    vec: v.array(v.float64()),
  }).index("by_brain_sid", ["brain", "sid"])
    .vectorIndex("by_vec", { vectorField: "vec", dimensions: 1024, filterFields: ["base"] }),

  /**
   * What a workspace's projects cost, month by month: one row a project a
   * month, added to after each message, file read or Brief written, from the
   * usage the model host reports. A call the host gave no price for counts in
   * `calls` and not in `priced`, so the total says when it may be low.
   */
  projectSpend: defineTable({
    space: v.string(),
    /* UTC, "2026-10". */
    month: v.string(),
    brain: v.string(),
    usd: v.number(),
    priced: v.number(),
    calls: v.number(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    cached: v.number(),
    at: v.number(),
  }).index("by_space_month", ["space", "month"])
    .index("by_brain_month", ["brain", "month"]),

  /* The most a workspace's projects may cost in a month, when the owner set one. */
  projectBudget: defineTable({
    space: v.string(),
    cap: v.number(),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /* A change the chat proposed to the file: what it would do, what it replaced
     once applied, so it can be undone. The last 10 stay. */
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
