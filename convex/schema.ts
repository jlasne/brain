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
    created: v.number(),
    updated: v.number(),
  }).index("by_space_updated", ["space", "updated"]),

  /* Blind spots were removed. The table stays so rows written while they
     existed still match the schema; nothing writes to it. */
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
   * A workspace's side panel. Limited shows Chats and Folders, full adds
   * Projects. A workspace with no row is limited.
   */
  modes: defineTable({
    space: v.string(),
    full: v.boolean(),
    updated: v.number(),
  }).index("by_space", ["space"]),

  /**
   * A project: a chat that reads the folders it names, and one page it keeps
   * up to date, in the owner's HTML template when it has one. A personal
   * folder never joins one, and the demo has none.
   */
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

  /**
   * Every one-pager built, kept so it can be opened again from Projects. The
   * newest 50 of each owner stay. In the demo, each visitor keeps their own.
   */
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

  /* Each build of a project's page. The newest 10 are kept. */
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
    project: v.optional(v.string()),
    /* Languages. Files are always kept in English. How answers come back
       ("same" as asked, or "en"), and the language the mic listens in. The
       old "store" field is left readable for rows written before. */
    store: v.optional(v.string()),
    reply: v.optional(v.string()),
    voice: v.optional(v.string()),
    updated: v.number(),
  }).index("by_space", ["space"]),

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

  candidates: defineTable({
    brain: v.string(),
    slug: v.string(),
    title: v.string(),
    notes: v.array(v.string()),
    count: v.number(),
    updated: v.string(),
  }).index("by_brain_slug", ["brain", "slug"]),
});
