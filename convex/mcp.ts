/**
 * A public, read-only MCP server over the brains.
 *
 * Anyone can add this as a custom connector in their own Claude and read what
 * the brains hold. Three properties make that safe to leave open:
 *
 *   1. No model call happens here, so no OpenRouter credit is ever spent. The
 *      reader's own Claude subscription does the thinking.
 *   2. Every tool reads. Nothing writes, so no visitor can move a position,
 *      add a source, or reject one.
 *   3. A per-address rate limit caps how fast one caller can pull, so a
 *      scraping loop cannot exhaust the deployment's quota.
 *
 * Transport is Streamable HTTP. A POST carrying one JSON-RPC request gets one
 * JSON object back, which the spec allows in place of an SSE stream, so this
 * server stays stateless and issues no session id.
 */

import { internal } from "./_generated/api";

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

/* ---------- dispatch ---------- */

export async function runTool(ctx: any, name: string, args: any) {
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
export async function handleRpc(ctx: any, msg: any): Promise<any | null> {
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
        "filling the gap yourself.",
    });
  }

  /* Notifications carry no id and expect no reply. */
  if (String(method ?? "").startsWith("notifications/")) return null;
  if (method === "ping") return isNotification ? null : ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    if (!TOOLS.some(t => t.name === name)) {
      return ok(id, { ...text(`This server has no tool named "${name}".`), isError: true });
    }
    try {
      const out = await runTool(ctx, name, params?.arguments ?? {});
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
