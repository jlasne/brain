/**
 * An MCP server over the brains: public for reading, signed for feeding.
 *
 * Anyone can add this as a custom connector in their own Claude and read what
 * the brains hold. Three properties make that safe to leave open:
 *
 *   1. No model call happens here, so no OpenRouter credit is ever spent. The
 *      reader's own Claude subscription does the thinking.
 *   2. Every public tool reads. Writing needs a personal address carrying an
 *      account's own token, so an anonymous visitor cannot move a position,
 *      add a source, or reject one. The write tools are not even listed
 *      without that token.
 *   3. A per-address rate limit caps how fast one caller can pull, so a
 *      scraping loop cannot exhaust the deployment's quota.
 *
 * Transport is Streamable HTTP. A POST carrying one JSON-RPC request gets one
 * JSON object back, which the spec allows in place of an SSE stream, so this
 * server stays stateless and issues no session id.
 */

import { internal } from "./_generated/api";
import { randomHex, today, slug as slugOf } from "./lib";
import { dropCheck, dropSettle, feedable, fetchPage, planContext, PLAN_RULES } from "./drop";

/** Versions this server speaks. The newest sits first, so it wins by default. */
export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Per address, per window. Real reading sits far below this. A loop does not. */
export const RATE_MAX = 120;
export const RATE_WINDOW_MS = 1000 * 60 * 10;

const SERVER = { name: "octopus-brains", title: "Octopus Brains", version: "1.0.0" };

/* ---------- shapes ---------- */

const ok = (id: any, result: any) => ({ jsonrpc: "2.0", id, result });
const err = (id: any, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (s: string) => ({ content: [{ type: "text", text: s }] });

/* ---------- the tools ---------- */

export const TOOLS = [
  {
    name: "ask",
    title: "Ask the brains",
    description:
      "Ask a question and get back everything the brains hold on it: the positions, the evidence behind " +
      "them with authors and dates, the data points, and any open conflict. Name a brain to read only that " +
      "one, or leave it out and the question is routed by scope. This tool retrieves. You write the answer " +
      "from what it returns, and it tells you how. Start here for any question.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, in full." },
        brain: { type: "string", description: "Optional brain slug or name. Omit to search every brain." },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "list_brains",
    title: "List brains",
    description:
      "List every brain, with its one line scope and how much it holds. Call this first, because the " +
      "scope line tells you which brain can answer a question and which cannot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_brain",
    title: "Read a brain summary",
    description:
      "Read one brain's scope plus one line per concept it holds. Use this to see the shape of a brain " +
      "before opening a concept.",
    inputSchema: {
      type: "object",
      properties: { brain: { type: "string", description: "The brain slug or name, as list_brains reported it." } },
      required: ["brain"],
      additionalProperties: false,
    },
  },
  {
    name: "read_concept",
    title: "Read a concept",
    description:
      "Read one concept in full: the position it holds, the evidence behind that position with dates and " +
      "authors, the data points, and any open conflict. This is where the reasoning lives, so read it " +
      "before answering anything specific.",
    inputSchema: {
      type: "object",
      properties: {
        brain: { type: "string", description: "The brain slug." },
        concept: { type: "string", description: "The concept slug or title." },
      },
      required: ["brain", "concept"],
      additionalProperties: false,
    },
  },
  {
    name: "search_brains",
    title: "Search the brains",
    description:
      "Search every concept by keyword across all brains. Matches titles, positions, summaries and data " +
      "points. Use this when you do not know which brain holds the answer.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for." },
        brain: { type: "string", description: "Optional brain slug, to search one brain only." },
        limit: { type: "number", description: "Maximum matches to return. Default 8." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_sources",
    title: "List sources",
    description:
      "List the sources a brain has read, newest first, with date, author and link. Use this to judge how " +
      "current and how broad the evidence is. Raw transcripts are never stored, so only the reference is here.",
    inputSchema: {
      type: "object",
      properties: { brain: { type: "string", description: "Optional brain slug. Omit for every source." } },
      required: [],
      additionalProperties: false,
    },
  },
];

/**
 * Feeding, in four steps, listed only for a caller whose address carries a token.
 *
 * No step calls a model here. The client's own model does every piece of
 * thinking, and each tool hands back the exact instructions for the next piece.
 * So a drop through a connector costs this deployment nothing, and costs the
 * person only what their own client already charges them.
 *
 * The rules are the same ones the app pays a model to follow, and the writing
 * side validates whatever comes back, so a brain cannot be filled with junk by
 * a client that ignores them.
 */
export const WRITE_TOOLS = [
  {
    name: "create_brain",
    title: "Make a new brain",
    description:
      "Make a brain. A brain is one subject or one person, and its scope line is the only test of what " +
      'belongs inside, so make it specific: "health" is a folder, "sleep, recovery and training load for ' +
      'my own routine" is a brain. Call list_brains first. A source that fits a scope line already there ' +
      "belongs in that brain, and a second brain covering the same ground splits the evidence in two. " +
      "The person who owns this address owns the brain. Writes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, one or two words, like Wealth or Content." },
        scope: { type: "string", description: "One line naming exactly what belongs inside." },
        type: { type: "string", enum: ["subject", "person"],
          description: "subject holds your own position, person holds one person's view. Default subject." },
        open: { type: "boolean", description: "true lets any signed-in person feed it. Default false." },
      },
      required: ["name", "scope"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_link",
    title: "Read the text behind a link",
    description:
      "Pull the readable text from a web page, for when you cannot open it yourself. Returns the text " +
      "for you to read. Then call drop_source with what you kept from it. Articles, blogs, papers and " +
      "documentation pages work. A video link returns what to do instead, because the captions sit " +
      "behind a sign in. This tool stores nothing and writes nothing.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The https address of the page." } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "drop_source",
    title: "Start a drop",
    description:
      "Step 1 of 4 of feeding a source into the brains. The source is whatever the person gave you: a " +
      "file attached in this conversation, a PDF, slides, a screenshot, text they pasted, or a page you " +
      "opened from a link. YOU read it and fill in `extraction`. " +
      "Cover every topic present, whether or not it looks relevant, because this is the only read. " +
      "Keep ideas, numbers, names, dates, reasoning chains, exact quotes and historical comparisons. " +
      "Drop repetition, advertising, small talk and filler. Write every field in English whatever " +
      "language the source is in, except quotes, which stay exact in the original, because a " +
      "translated quote stops being evidence. `thin` holds claims made with no number behind them. " +
      "The source text itself is never sent and never stored. Returns the next instructions.",
    inputSchema: {
      type: "object",
      properties: {
        extraction: {
          type: "object",
          description: "Everything worth keeping from the source.",
          properties: {
            title: { type: "string" },
            author: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD, or empty when the source carries none." },
            topics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  ideas: { type: "array", items: { type: "string" } },
                  data: { type: "array", items: { type: "string" }, description: "Numbers, with what they measure." },
                },
                required: ["topic"],
              },
            },
            quotes: {
              type: "array",
              items: { type: "object", properties: { text: { type: "string" }, speaker: { type: "string" } } },
            },
            thin: { type: "array", items: { type: "string" } },
          },
          required: ["title", "topics"],
        },
        link: { type: "string", description: "The source URL, when there is one. Used to catch a repeat." },
        brain: { type: "string", description: "Optional brain slug. Omit and the scope lines route it." },
      },
      required: ["extraction"],
      additionalProperties: false,
    },
  },
  {
    name: "drop_plan",
    title: "File the source against what the brains hold",
    description:
      "Step 2 of 4. Call drop_source first: it returns the brains, their concepts and the filing " +
      "rules. Follow those rules, then send the plan here. The plan is checked against the real " +
      "concept ids, stored, and returned as a card for the person. Nothing is written yet.",
    inputSchema: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The draft id from drop_source." },
        plan: { type: "object", description: "The plan, in the shape drop_source asked for." },
      },
      required: ["draft", "plan"],
      additionalProperties: false,
    },
  },
  {
    name: "drop_prepare",
    title: "Settle the contradictions and take the rewrite job",
    description:
      "Step 3 of 4. Show the card from drop_plan to the person and get their ruling on every " +
      'contradiction first. "new" means the source wins and the old view moves into evidence. ' +
      '"old" means the stored position holds and the new claim joins the evidence. "both" keeps ' +
      "the position and records the clash. A contradiction left out keeps both. Returns the whole " +
      "evidence list behind each position it touches, plus the rewriting rules. Still nothing written.",
    inputSchema: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The draft id from drop_source." },
        rulings: {
          type: "object",
          description: 'Concept id to "new", "old" or "both". Ids come from the card.',
          additionalProperties: { type: "string", enum: ["new", "old", "both"] },
        },
        take: {
          type: "array", items: { type: "string" },
          description: "Candidate concept titles to create in this drop rather than count toward three.",
        },
      },
      required: ["draft"],
      additionalProperties: false,
    },
  },
  {
    name: "drop_store",
    title: "Write the rewritten positions",
    description:
      "Step 4 of 4. This writes. Send the rewrites you produced from the job drop_prepare returned. " +
      "Each position is re-derived from its whole evidence list, never appended to. The source row " +
      "and the note are written, and the receipt comes back. Tell the person what moved.",
    inputSchema: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The draft id from drop_source." },
        rewrites: {
          type: "array",
          description: "One entry per concept in the job.",
          items: {
            type: "object",
            properties: {
              conceptId: { type: "string" },
              position: { type: "string" },
              summaryLine: { type: "string", description: "One line, under 18 words." },
              data: { type: "array", items: { type: "string" } },
              conflicts: {
                type: "array",
                items: { type: "object", properties: {
                  a: { type: "string" }, aDate: { type: "string" },
                  b: { type: "string" }, bDate: { type: "string" }, why: { type: "string" } } },
              },
            },
            required: ["conceptId", "position", "summaryLine"],
          },
        },
      },
      required: ["draft", "rewrites"],
      additionalProperties: false,
    },
  },
];

/* ---------- helpers over the snapshot ---------- */

const norm = (s: any) => String(s ?? "").toLowerCase().trim();

/**
 * Question words carry no subject, and scope lines are written in prose, so
 * "how do I bake sourdough" matched a scope that merely opens with "how".
 * Routing reads the words that name a subject and drops the rest.
 */
const STOP = new Set(("a about after again all also am an and any are as at be because been before being " +
  "between both but by can cannot could did do does doing done down during each few for from further get " +
  "give got had has have having her here hers him his how i if in into is it its just know let like made " +
  "make many may me more most much must my need no nor not now of off on once one only or other our out " +
  "over own per put same say said see should since so some such take than that the their them then there " +
  "these they thing things think this those through to too two under until up us use used using very want " +
  "was way we were what when where which while who whom why will with within would you your").split(" "));

const keywords = (q: string) =>
  norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));

const findBrain = (brains: any[], want: string) => {
  const w = norm(want);
  return brains.find((b: any) => norm(b.slug) === w)
    ?? brains.find((b: any) => norm(b.name) === w)
    ?? brains.find((b: any) => norm(b.name).includes(w) || norm(b.slug).includes(w));
};

const byN = (a: any, b: any) => (a.n ?? 0) - (b.n ?? 0);

function brainLine(b: any, concepts: any[], sources: any[]) {
  const n = concepts.filter((c: any) => c.brain === b.slug).length;
  const sc = sources.filter((s: any) => (s.brains ?? []).includes(b.slug)).length;
  return `- ${b.name} [${b.type}] (slug: ${b.slug})\n  scope: ${b.scope}\n  holds: ${n} concept${n === 1 ? "" : "s"}, ${sc} source${sc === 1 ? "" : "s"}`;
}

function conceptFull(c: any, brainName: string) {
  const ev = (c.evidence ?? []).map((e: any) =>
    `- ${e.date ?? "undated"} ${e.author ?? "unknown"}: ${e.claim ?? ""}${e.rollup ? " (compressed)" : ""}`).join("\n");
  const cf = (c.conflicts ?? []).map((x: any) =>
    `- "${x.a}" (${x.aDate ?? "undated"}) against "${x.b}" (${x.bDate ?? "undated"}), because ${x.why ?? "unstated"}`).join("\n");
  return [
    `# ${c.title}`,
    `brain: ${brainName} (${c.brain}/${c.slug})`,
    ``,
    `POSITION`,
    c.position || "none yet",
    ``,
    `EVIDENCE, newest first`,
    ev || "- none",
    ``,
    `DATA`,
    (c.data ?? []).length ? (c.data ?? []).map((d: string) => `- ${d}`).join("\n") : "- none",
    ``,
    `OPEN CONFLICTS`,
    cf || "- none",
    ``,
    `last updated ${c.updated || "unknown"}, from ${(c.sources ?? []).length} source${(c.sources ?? []).length === 1 ? "" : "s"}`,
  ].join("\n");
}

/* ---------- feeding ---------- */

/** Who a personal address resolves to. Null is an anonymous reader. */
export type Caller = { account: string; name: string } | null;

/** Parts arrive one call at a time and read as one source. */
const mergeExt = (a: any, b: any) => ({
  title: a?.title || b?.title || "",
  author: a?.author || b?.author || "",
  date: a?.date || b?.date || "",
  topics: [...(a?.topics ?? []), ...(b?.topics ?? [])],
  quotes: [...(a?.quotes ?? []), ...(b?.quotes ?? [])],
  thin: [...(a?.thin ?? []), ...(b?.thin ?? [])],
});

/** The card, as text, because a connector has no card to click. */
function cardText(plan: any, brains: any[], concepts: any[], draft: string) {
  const named = (s2: string) => brains.find((b: any) => b.slug === s2)?.name ?? s2;
  const matched = (plan.matched ?? []).map((m: any) => {
    const c = concepts.find((x: any) => `${x.brain}/${x.slug}` === m.conceptId);
    return `- ${c ? c.title : m.conceptId}  [${m.conceptId}]\n  adds: ${m.whatItAdds ?? ""}`;
  });
  const cands = (plan.candidates ?? []).map((c: any) =>
    `- ${c.title} in ${named(c.brain)}\n  why: ${c.why ?? ""}`);
  const clashes = (plan.conflicts ?? []).map((c: any, i: number) => {
    const id = c.conceptId || `${c.brain}/${c.concept}`;
    return [
      `${i + 1}. ${c.concept}  [${id}]`,
      `   ${c.kind === "flip" ? "changes the position" : c.kind === "drift" ? "same person, later view" : "adds nuance, position holds"}`,
      `   new:    ${c.says ?? ""} (${c.saysDate || "undated"})`,
      `   stored: ${c.stored ?? ""} (${c.storedDate || "undated"})`,
      ...(c.why ? [`   they differ because ${c.why}`] : []),
    ].join("\n");
  });

  return [
    `DRAFT ${draft}`,
    `GOES TO: ${(plan.brains ?? []).map(named).join(", ") || "no brain matched"}`,
    ``,
    `POSITIONS IT TOUCHES (${matched.length})`,
    matched.join("\n") || "- none",
    ``,
    `NEW CONCEPTS PROPOSED (${cands.length})`,
    cands.join("\n") || "- none",
    ...(cands.length ? [`A new concept needs 3 separate sources. Name one in "take" to create it now.`] : []),
    ``,
    `NEW CLAIMS (${(plan.new ?? []).length})`,
    (plan.new ?? []).map((x: string) => `- ${x}`).join("\n") || "- none",
    ``,
    `ECHOES (${(plan.echo ?? []).length})`,
    (plan.echo ?? []).map((e: any) => `- ${e.claim} repeats ${e.repeatsSource || "an earlier source"}`).join("\n") || "- none",
    ``,
    `CONTRADICTIONS TO SETTLE (${clashes.length})`,
    clashes.join("\n\n") || "none",
    ``,
    `===== WHAT TO DO NOW =====`,
    clashes.length
      ? `Show every contradiction above to the person and ask which side holds. Then call drop_prepare with rulings, keyed by the concept id in brackets: "new", "old" or "both". Silence keeps both.`
      : `Nothing here contradicts what the brains hold. Ask the person to confirm, then call drop_prepare.`,
    `Nothing is written until drop_store, which comes after drop_prepare.`,
  ].join("\n");
}

async function runWriteTool(ctx: any, caller: Caller, name: string, args: any) {
  if (!caller) {
    return text("This address reads only. Feeding needs the personal connector address from your Octopus account.");
  }
  /* A member, so the same permission rules apply here as in the app: a brain is
     feedable by the account that owns it, or by anyone when it is open. */
  const who = { kind: "member" as const, account: caller.account };
  const draftOf = async (token: string) =>
    await ctx.runQuery(internal.store.getDraft, { token, account: caller.account });

  if (name === "fetch_link") {
    const r = await fetchPage(String(args?.url ?? ""));
    if (r.error) return text(r.error);
    return text([
      `FETCHED ${r.url}`,
      `${r.chars} characters of text${r.cut ? `, showing the first ${r.text.length}` : ""}.`,
      `Nothing here is stored. Read it, then call drop_source with what is worth keeping.`,
      ``,
      r.text,
    ].join("\n"));
  }

  if (name === "create_brain") {
    const bname = String(args?.name ?? "").trim();
    const scope = String(args?.scope ?? "").trim();
    if (bname.length < 2) return text("Give the brain a name of at least 2 characters.");
    if (scope.length < 10) {
      return text("Give a scope line. It is the only test of what belongs inside, so one word will not do.");
    }
    const { brains } = await feedable(ctx, who, "all");
    const taken = brains.find((b: any) => b.slug === slugOf(bname));
    if (taken) return text(`A brain called ${taken.name} already exists, scoped to "${taken.scope}".`);
    try {
      const made = await ctx.runMutation(internal.store.createBrain, {
        name: bname, scope,
        type: args?.type === "person" ? "person" : "subject",
        visibility: args?.open === true ? "open" : "closed",
        owner: caller.account,
      });
      return text([
        `Made ${bname} (${made}), a ${args?.type === "person" ? "person" : "subject"} brain.`,
        `scope: ${scope}`,
        `feeding: ${args?.open === true ? "anyone signed in" : `${caller.name} only`}`,
        ``,
        `It holds nothing yet. The first source seeds it, so every concept in that first drop becomes a`,
        `position straight away. Call drop_source when you have one.`,
      ].join("\n"));
    } catch (e: any) {
      return text(`That did not work: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  if (name === "drop_source") {
    const part = args?.extraction;
    if (!part || typeof part !== "object" || !Array.isArray(part.topics) || !part.topics.length) {
      return text("Send the extraction with at least one topic. Read the source yourself and fill it in.");
    }
    const link = String(args?.link ?? "").trim();
    const brain = String(args?.brain ?? "").trim();

    const chk = await dropCheck(ctx, { link, text: JSON.stringify(part).slice(0, 400) });
    if (chk.duplicate) {
      return text(`Already stored as ${chk.sid}, filed ${chk.date || "earlier"} into ` +
        `${(chk.brains ?? []).join(", ") || "no brain"}. Nothing to do.`);
    }

    const ext = mergeExt(part, {});
    const draft = randomHex(16);
    await ctx.runMutation(internal.store.newDraft,
      { token: draft, account: caller.account, link, sid: chk.sid, brain, ext });

    const { concepts, sources, pool } = await feedable(ctx, who, brain || "all");
    if (!pool.length) {
      return text(brain
        ? `You cannot feed "${brain}". Either it does not exist, or its owner keeps it closed.`
        : "There is no brain you may feed. Create one in Octopus, or ask an owner to open theirs.");
    }

    return text([
      `DRAFT ${draft}`,
      `read: ${ext.title || "untitled"} | ${ext.author || "unknown author"} | ${ext.date || "undated"}`,
      `${ext.topics.length} topic${ext.topics.length === 1 ? "" : "s"} kept.`,
      ``,
      `===== NOW FILE IT. Send the result to drop_plan with this draft id. =====`,
      ``,
      PLAN_RULES,
      planContext(pool, concepts, sources, ext),
    ].join("\n"));
  }

  if (name === "drop_plan") {
    const token = String(args?.draft ?? "").trim();
    const d = await draftOf(token);
    if (!d) return text(`Draft ${token} is gone. Start again with drop_source.`);
    const plan = args?.plan;
    if (!plan || typeof plan !== "object") return text("Send the plan, in the shape drop_source asked for.");

    const { brains, concepts, pool } = await feedable(ctx, who, d.brain || "all");
    const targets = (plan.brains ?? []).filter((x: string) => pool.some((y: any) => y.slug === x));
    if (!targets.length) {
      return text(`"brains" named none you may feed. Pick from: ${pool.map((b: any) => b.slug).join(", ")}.`);
    }
    /* A concept id the brains do not carry would file the source nowhere, so it
       is caught here rather than after a rewrite that goes nowhere. */
    const bad = (plan.matched ?? [])
      .map((m: any) => String(m.conceptId ?? ""))
      .filter((id: string) => !concepts.some((c: any) => `${c.brain}/${c.slug}` === id));
    if (bad.length) {
      return text(`These concept ids do not exist: ${bad.join(", ")}.\n` +
        `Use the ids listed under BRAINS AND THEIR CONCEPTS, exactly, in the form brain/slug. ` +
        `An idea no listed concept covers belongs under "candidates", not "matched".`);
    }

    await ctx.runMutation(internal.store.saveDraft, { token, account: caller.account, plan });
    return text(cardText(plan, brains, concepts, token));
  }

  if (name === "drop_prepare") {
    const token = String(args?.draft ?? "").trim();
    const d = await draftOf(token);
    if (!d) return text(`Draft ${token} is gone. Start again with drop_source.`);
    if (!d.plan) return text(`Draft ${token} has no plan yet. Call drop_plan first.`);

    const { choices, promote } = rulings(args);
    await ctx.runMutation(internal.store.saveDraft,
      { token, account: caller.account, plan: { ...d.plan, choices, promote } });

    const r = await dropSettle(ctx, who, {
      ext: d.ext, plan: d.plan, sid: d.sid, link: d.link, choices, promote, packetOnly: true });
    if (r.error) return text(String(r.error));
    if (!r.job) {
      return text([
        `Nothing to rewrite in draft ${token}.`,
        ...(r.counted ?? []).map((c: any) =>
          `- ${c.title}: counted at ${c.have} of 3, ${c.need} more source${c.need === 1 ? "" : "s"} makes it a position`),
        ``,
        `Call drop_store with an empty rewrites list to file the source anyway.`,
      ].join("\n"));
    }
    return text([
      `DRAFT ${token}: ${r.positions} position${r.positions === 1 ? "" : "s"} to rewrite.`,
      ``,
      `===== DO THIS, THEN SEND THE RESULT TO drop_store =====`,
      ``,
      r.job,
    ].join("\n"));
  }

  if (name === "drop_store") {
    const token = String(args?.draft ?? "").trim();
    const d = await draftOf(token);
    if (!d) return text(`Draft ${token} is gone. Start again with drop_source.`);
    if (!d.plan) return text(`Draft ${token} has no plan yet. Call drop_plan first.`);
    const rw = Array.isArray(args?.rewrites) ? args.rewrites : [];

    /* The rulings were fixed at drop_prepare, so they cannot change under the
       rewrites they produced. */
    const choices = d.plan.choices ?? {};
    const promote = d.plan.promote ?? [];

    const r = await dropSettle(ctx, who, {
      ext: d.ext, plan: d.plan, sid: d.sid, link: d.link,
      location: "sent through a connector", choices, promote, rewrites: rw });
    if (r.error) return text(String(r.error));

    await ctx.runMutation(internal.store.killDraft, { token, account: caller.account });
    const counted = (r.counted ?? []).map((c: any) =>
      `- ${c.title}: counted at ${c.have} of 3, ${c.need} more source${c.need === 1 ? "" : "s"} makes it a position`);
    return text([
      `STORED ${r.sid} on ${today()}, by ${caller.name}.`,
      `Brains: ${(r.brains ?? []).join(", ")}`,
      `Positions rewritten: ${r.positions}`,
      `New claims: ${r.counts?.new ?? 0} | echoes: ${r.counts?.echo ?? 0}`,
      ...(counted.length ? [``, `COUNTED, NOT YET A POSITION`, ...counted] : []),
      ``,
      `Tell the person what moved, in one or two lines.`,
    ].join("\n"));
  }

  return null;
}

/** The person's ruling on each contradiction, and any candidate they take now. */
function rulings(args: any) {
  const raw = args?.rulings && typeof args.rulings === "object" ? args.rulings : {};
  const choices: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === "new" || v === "old" || v === "both") choices[k] = v;
  }
  return { choices, promote: Array.isArray(args?.take) ? args.take.map(String) : [] };
}

/* ---------- dispatch ---------- */

export async function runTool(ctx: any, name: string, args: any, caller: Caller = null) {
  if (WRITE_TOOLS.some(t => t.name === name)) return await runWriteTool(ctx, caller, name, args);

  /* Every brain is published, so there is nothing to filter here. Feeding is
     the guarded act, and no tool on this server writes. */
  const { brains, concepts, sources } = await ctx.runQuery(internal.store.everything, {});

  if (name === "ask") {
    const q = String(args?.question ?? "").trim();
    if (!q) return text("Give a question.");
    if (!brains.length) return text("No brains exist yet, so there is nothing to read.");

    const words = keywords(q);
    if (!words.length) {
      return text(`"${q}" carries no subject to route on. The brains cover:\n\n` +
        brains.map((b: any) => `- ${b.name} (${b.slug}): ${b.scope}`).join("\n") +
        `\n\nAsk again naming the subject, or call ask with a brain.`);
    }
    const named = args?.brain ? findBrain(brains, args.brain) : null;
    if (args?.brain && !named) {
      return text(`No brain matches "${args.brain}". These exist: ` + brains.map((b: any) => b.slug).join(", "));
    }

    /* Route by scope when no brain was named. A brain earns its place by its
       scope line and by how much its concepts touch the question. */
    let chosen: any[];
    if (named) chosen = [named];
    else {
      chosen = brains.map((b: any) => {
        const scope = norm(b.scope + " " + b.name);
        const own = concepts.filter((c: any) => c.brain === b.slug);
        const body = norm(own.map((c: any) => `${c.title} ${c.summaryLine} ${c.position}`).join(" "));
        let score = 0;
        for (const w of words) {
          if (scope.includes(w)) score += 3;
          if (body.includes(w)) score += 1;
        }
        return { b, score };
      }).filter((x: any) => x.score > 0).sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3).map((x: any) => x.b);
      /* Nothing matched a scope line, so say what exists rather than guess. */
      if (!chosen.length) {
        return text(`Nothing in these brains matches "${q}". Their scopes are:\n\n` +
          brains.map((b: any) => `- ${b.name} (${b.slug}): ${b.scope}`).join("\n") +
          `\n\nSay so plainly rather than answering from outside the brains.`);
      }
    }

    /* Inside the chosen brains, rank concepts and open the top ones in full. */
    const pool = concepts.filter((c: any) => chosen.some((b: any) => b.slug === c.brain));
    const ranked = pool.map((c: any) => {
      const title = norm(c.title), hay = norm([c.title, c.summaryLine, c.position,
        (c.data ?? []).join(" "), (c.evidence ?? []).map((e: any) => e.claim).join(" ")].join(" "));
      let score = 0;
      for (const w of words) { if (title.includes(w)) score += 3; if (hay.includes(w)) score += 1; }
      return { c, score };
    }).sort((a: any, b: any) => b.score - a.score);

    const deep = ranked.filter((x: any) => x.score > 0).slice(0, 8);
    const rest = ranked.filter((x: any) => !deep.includes(x));
    /* A question that hits no concept still gets the whole shape of the brain. */
    const full = (deep.length ? deep : ranked.slice(0, 6)).map((x: any) => x.c);

    const nSources = new Set(sources
      .filter((s: any) => (s.brains ?? []).some((x: string) => chosen.some((b: any) => b.slug === x)))
      .map((s: any) => s.sid)).size;
    const person = chosen.length === 1 && chosen[0].type === "person";

    const out = [
      `QUESTION: ${q}`,
      ``,
      `READ FROM: ${chosen.map((b: any) => `${b.name} [${b.type}]`).join(", ")}`,
      `Behind these: ${nSources} source${nSources === 1 ? "" : "s"}.`,
      ...(nSources > 0 && nSources < 10
        ? [`This is a small brain. Open your answer by saying it rests on ${nSources} source${nSources === 1 ? "" : "s"}.`] : []),
      ``,
      `===== WHAT THE BRAINS HOLD =====`,
      ``,
      full.map((c: any) => conceptFull(c, brains.find((b: any) => b.slug === c.brain)?.name ?? c.brain)).join("\n\n---\n\n"),
      ...(rest.length ? [``, `ALSO HELD, not opened here:`,
        rest.map((x: any) => `- ${x.c.title} (${x.c.brain}/${x.c.slug}): ${x.c.summaryLine || "no line"}`).join("\n"),
        `Call read_concept on any of those if the question needs it.`] : []),
      ``,
      `===== HOW TO WRITE THE ANSWER =====`,
      `- The first sentence answers the question. Natural prose, addressed to the person asking.`,
      `- Put the numbers, dates and findings inside the answer.`,
      person
        ? `- This is a PERSON brain, so name that person throughout. Their view is the subject.`
        : `- Keep source names out of the answer text. Attribution goes on the sources line.`,
      `- Newer evidence wins on the same question, and better data overrides that.`,
      `- State an open conflict when it changes what the reader would do.`,
      `- No em-dashes. Under 30 words per sentence. Data instead of adjectives. No weasel words. Simple wording. Say what holds.`,
      `- Close with one line: "Sources: {author}, {date} · {author}, {date}", listing only what you used.`,
      `- Answer from what is above. Where it falls short, say so in one sentence and name the kind of source that would fill the gap.`,
    ].join("\n");
    return text(out);
  }

  if (name === "list_brains") {
    if (!brains.length) return text("No brains exist yet.");
    const small = brains.length
      ? "\nA brain fed by fewer than 10 sources is a small brain. Say so when you answer from one."
      : "";
    return text(`${brains.length} brain${brains.length === 1 ? "" : "s"}:\n\n` +
      brains.map((b: any) => brainLine(b, concepts, sources)).join("\n\n") + small);
  }

  if (name === "read_brain") {
    const b = findBrain(brains, args?.brain);
    if (!b) return text(`No brain matches "${args?.brain ?? ""}". Call list_brains for the slugs.`);
    const cs = concepts.filter((c: any) => c.brain === b.slug).sort(byN);
    const sc = sources.filter((s: any) => (s.brains ?? []).includes(b.slug)).length;
    const lines = cs.map((c: any) =>
      `- ${c.title} (${c.slug}): ${c.summaryLine || c.position || "no position yet"}`).join("\n");
    return text([
      `# ${b.name} [${b.type}]`,
      `scope: ${b.scope}`,
      `${cs.length} concept${cs.length === 1 ? "" : "s"}, ${sc} source${sc === 1 ? "" : "s"}`,
      ``,
      `CONCEPTS`,
      lines || "- none yet",
      ``,
      `Call read_concept for the position, its evidence and any open conflict.`,
    ].join("\n"));
  }

  if (name === "read_concept") {
    const b = findBrain(brains, args?.brain);
    if (!b) return text(`No brain matches "${args?.brain ?? ""}". Call list_brains for the slugs.`);
    const w = norm(args?.concept);
    const cs = concepts.filter((c: any) => c.brain === b.slug);
    const c = cs.find((x: any) => norm(x.slug) === w)
      ?? cs.find((x: any) => norm(x.title) === w)
      ?? cs.find((x: any) => norm(x.title).includes(w) || norm(x.slug).includes(w));
    if (!c) {
      return text(`"${args?.concept ?? ""}" is not a concept in ${b.name}. It holds: ` +
        (cs.sort(byN).map((x: any) => x.slug).join(", ") || "nothing yet"));
    }
    return text(conceptFull(c, b.name));
  }

  if (name === "search_brains") {
    const words = norm(args?.query).split(/\s+/).filter(Boolean);
    if (!words.length) return text("Give a query with at least one word.");
    const only = args?.brain ? findBrain(brains, args.brain) : null;
    const pool = only ? concepts.filter((c: any) => c.brain === only.slug) : concepts;
    const limit = Math.min(Math.max(Number(args?.limit) || 8, 1), 25);

    const scored = pool.map((c: any) => {
      const hay = norm([c.title, c.position, c.summaryLine, (c.data ?? []).join(" "),
        (c.evidence ?? []).map((e: any) => e.claim).join(" ")].join(" "));
      const title = norm(c.title);
      /* A word in the title counts for more than the same word buried in evidence. */
      let score = 0;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        if (hay.includes(w)) score += 1;
      }
      return { c, score };
    }).filter((x: any) => x.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, limit);

    if (!scored.length) {
      return text(`Nothing matches "${args?.query}". The brains may not cover it. ` +
        `Call list_brains to see the scope lines.`);
    }
    return text(`${scored.length} match${scored.length === 1 ? "" : "es"} for "${args.query}":\n\n` +
      scored.map(({ c }: any) => {
        const b = brains.find((x: any) => x.slug === c.brain);
        return `- ${c.title} in ${b?.name ?? c.brain} (read_concept brain="${c.brain}" concept="${c.slug}")\n` +
               `  ${c.summaryLine || c.position || "no position yet"}`;
      }).join("\n\n"));
  }

  if (name === "list_sources") {
    const b = args?.brain ? findBrain(brains, args.brain) : null;
    if (args?.brain && !b) return text(`No brain matches "${args.brain}". Call list_brains for the slugs.`);
    const rows = (b ? sources.filter((s: any) => (s.brains ?? []).includes(b.slug)) : sources)
      .slice().sort((x: any, y: any) => String(y.date ?? "").localeCompare(String(x.date ?? "")));
    if (!rows.length) return text(b ? `${b.name} has read nothing yet.` : "No sources stored yet.");
    return text(`${rows.length} source${rows.length === 1 ? "" : "s"}${b ? ` in ${b.name}` : ""}, newest first:\n\n` +
      rows.map((s: any) =>
        `- ${s.date || "undated"} | ${s.author || "unknown"} | ${s.title || s.sid}\n  ${s.link || "no link"}`).join("\n"));
  }

  return null;
}

/** One JSON-RPC message in, one reply out. Null means the caller sent a notification. */
export async function handleRpc(ctx: any, msg: any, caller: Caller = null): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    const want = String(params?.protocolVersion ?? "");
    return ok(id, {
      protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions:
        "These are Octopus brains: a knowledge base split by subject, each brain holding positions derived " +
        "from the sources it has read. For a question, call ask with the question text, and a brain name " +
        "only if the user named one. It returns the relevant positions, their dated evidence, any open " +
        "conflict, and the rules for writing the answer. The other tools are for browsing: list_brains, " +
        "read_brain, read_concept, search_brains, list_sources. Answer from what the tools return, cite the " +
        "authors and dates they carry, and say plainly when the brains do not cover a question rather than " +
        "filling the gap yourself." +
        (caller
          ? ` This address is signed as ${caller.name}, so it can also feed a brain. Feeding runs in three ` +
            "steps: drop_source reads the text, drop_plan compares it against what the brains hold and " +
            "returns the contradictions, drop_store writes. Always show the plan to the person and get " +
            "their ruling on each contradiction before calling drop_store."
          : ""),
    });
  }

  /* Notifications carry no id and expect no reply. */
  if (String(method ?? "").startsWith("notifications/")) return null;
  if (method === "ping") return isNotification ? null : ok(id, {});
  /* The write tools are not listed for an anonymous reader, so a public client
     never sees a door it cannot open. */
  if (method === "tools/list") {
    return ok(id, { tools: caller ? [...TOOLS, ...WRITE_TOOLS] : TOOLS });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const known = caller ? [...TOOLS, ...WRITE_TOOLS] : TOOLS;
    if (!known.some(t => t.name === name)) {
      return ok(id, { ...text(`This server has no tool named "${name}".`), isError: true });
    }
    try {
      const out = await runTool(ctx, name, params?.arguments ?? {}, caller);
      if (!out) return ok(id, { ...text(`Tool "${name}" returned nothing.`), isError: true });
      return ok(id, out);
    } catch (e: any) {
      /* A tool failure is a result, not a protocol error, so the model can react. */
      return ok(id, { ...text(`Tool "${name}" failed: ${String(e?.message ?? e).slice(0, 300)}`), isError: true });
    }
  }

  if (isNotification) return null;
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  return err(id, -32601, `Unknown method: ${method}`);
}
