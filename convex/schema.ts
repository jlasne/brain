import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // one row, holds the passphrase hash and the unlock attempt counter
  config: defineTable({
    key: v.string(),
    salt: v.optional(v.string()),
    hash: v.optional(v.string()),
    attempts: v.optional(v.number()),
    attemptWindow: v.optional(v.number()),
    setAt: v.optional(v.string()),
  }).index("by_key", ["key"]),

  sessions: defineTable({
    token: v.string(),
    expires: v.number(),
    /* The account this session belongs to. Absent means the owner, who got in
       with the passphrase and spends the deployment's own model key. */
    account: v.optional(v.string()),
  }).index("by_token", ["token"]),

  /**
   * A member. Identity is a salted hash of the model key they signed in with,
   * so name plus key finds the account and the key itself is never stored.
   * Their key pays for their own model calls, and it lives in their browser.
   */
  accounts: defineTable({
    name: v.string(),
    slug: v.string(),
    salt: v.string(),
    keyHash: v.string(),
    created: v.string(),
    lastSeen: v.string(),
  }).index("by_slug", ["slug"]),

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

  /* The public MCP endpoint has no passphrase, so a per-address counter is the
     only thing standing between a scraping loop and the deployment quota. */
  mcpHits: defineTable({
    who: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_who", ["who"]),

  candidates: defineTable({
    brain: v.string(),
    slug: v.string(),
    title: v.string(),
    notes: v.array(v.string()),
    count: v.number(),
    updated: v.string(),
  }).index("by_brain_slug", ["brain", "slug"]),
});
