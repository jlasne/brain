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
    /* The brain it asked, or "all". */
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
    updated: v.string(),
  }).index("by_cid", ["cid"])
    .index("by_brain", ["brain"])
    .index("by_brain_title", ["brain", "title"]),

  candidates: defineTable({
    brain: v.string(),
    slug: v.string(),
    title: v.string(),
    notes: v.array(v.string()),
    count: v.number(),
    updated: v.string(),
  }).index("by_brain_slug", ["brain", "slug"]),
});
