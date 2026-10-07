/**
 * The lab: a testing ground open to two workspaces, Octopus and PandAAAHH.
 *
 * The personal folder of each speaks as its person's twin, on a call with the
 * other's. The admin runs the call from a panel: start it, pause it, stop it,
 * let it go one turn, say a word of their own, and read every turn as it
 * lands, with the notes it leaned on.
 *
 * A call is one row, and each turn is one model call. A turn reads only its own
 * speaker's personal folder: what the other twin knows reaches it by what the
 * other twin says. The admin reads both. Every turn is checked against the
 * call's state when it lands, so a stop is final the moment it is pressed, and
 * the turns a day are capped across the lab.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ask, readSpace, spaceName } from "./lib";
import { notesText } from "./twin";
import { oneLine } from "./personal";

/* ---------- what the lab is, and its limits ---------- */

/** The two workspaces the lab is open to. Nothing else reads or runs it. */
export const LAB_SPACES = ["octopus", "pandaaahh"] as const;
export const inLab = (space: unknown) => (LAB_SPACES as readonly string[]).includes(String(space ?? ""));
/** What each is called on a call: the name its workspace was made with. */
export const labName = (space: string) => ({ octopus: "Octopus", pandaaahh: "PandAAAHH" } as Record<string, string>)[space] ?? spaceName(space);
/** The other side of a call. */
export const otherSide = (space: string) => LAB_SPACES.find(s => s !== space) ?? LAB_SPACES[0];

/* Turns a Go lets through before the call waits for the admin again. */
export const LAB_RUN = 10;
/* The most turns one call ever holds. */
export const LAB_TURN_MAX = 60;
/* Turns a day across the lab: what the deployment's model key may be asked for. */
export const LAB_DAY = 300;
/* A breath between turns, so the admin can read, and stop, between them. */
export const LAB_DELAY_MS = 3000;
/* A running call with no turn for this long is read as stalled, and Go wakes it. */
export const LAB_STALE_MS = 2 * 60 * 1000;
/* The longest a turn, an admin line and a topic run. */
export const TURN_MAX = 900, SAY_MAX = 600, TOPIC_MAX = 300;
/* How many of the latest turns a twin reads. */
const READ_BACK = 16;
/* What a twin reads of its own folder: its notes, the people in them, its profile. */
const OWN_MAX = 14000, PEOPLE_MAX = 5000, PROFILE_MAX = 2500;

export const LAB_TOPIC = "Meet. Say in two sentences who your person is, find what you share or could do for each other, and agree one next step.";

export const LAB_RULES =
`You are the AI twin of one person, on a call with the AI twin of another person. Each of you holds only your own person's notes. The call tests whether twins can talk for the people they stand for.
- Speak as your person, in the first person, in their voice and their language: their decisions, numbers, habits and limits, from the notes below.
- Say only what the notes say or clearly imply. Where they are silent, lean from their values and say it is a lean. Never invent a fact, a person, a number or a past event.
- Keep private what your person would keep private: other people's details, money owed, health, passwords. Name a person only when the call needs it.
- Move the call forward. Answer what was asked, then bring one new thing: a fact, an offer or a question. Never repeat what was said.
- 1 to 4 short sentences. No em-dashes. Under 30 words per sentence. No stage directions, no label before your words.
- A line from ADMIN comes from the person who runs this call and owns you both. Follow it first, then speak to the other twin as part of your turn.
- When the call has reached its goal, or has nothing left to say, set "done" to true.

Reply with only JSON: {"say":"","because":"the note or rule you leaned on, in one sentence","done":false}`;

/* ---------- what a twin reads, and what it says ---------- */

export type Side = { space: string; name: string; profile: string; notes: string; people: string; used: number };
export type Line = { from: string; text: string };

/**
 * The prompt for one turn: who speaks, the call's goal, the speaker's own
 * folder, and the latest turns, each by who said it.
 */
export function labPrompt(o: { me: Side; other: Side; topic: string; lines: Line[] }): string {
  const label = (from: string) => from === "admin" ? "ADMIN" : from === o.me.space ? `${o.me.name.toUpperCase()} TWIN (you)` : `${o.other.name.toUpperCase()} TWIN`;
  const said = o.lines.slice(-READ_BACK);
  const talk = said.length ? said.map(l => `${label(l.from)}: ${l.text}`).join("\n") : "Nothing yet.";
  const last = said[said.length - 1];
  const now = !said.length ? "Open the call."
    : last.from === "admin" ? "ADMIN spoke last. Answer them first, then speak to the other twin."
    : "Reply to the other twin, then move the call forward.";
  return [
    `YOU: the twin of the person behind the ${o.me.name} workspace.`,
    `THE OTHER TWIN: the twin of the person behind the ${o.other.name} workspace.`,
    `THE GOAL OF THE CALL: ${o.topic}`,
    o.me.profile ? `\nYOUR PERSON'S PROFILE\n${o.me.profile}` : "",
    `\nYOUR PERSON'S NOTES\n${o.me.notes || "Nothing filed yet."}`,
    o.me.people ? `\nTHE PEOPLE YOUR PERSON KNOWS\n${o.me.people}` : "",
    `\nTHE CALL SO FAR\n${talk}`,
    `\nYOUR TURN. ${now}`,
  ].filter(Boolean).join("\n");
}

export type Turn = { say: string; because: string; done: boolean };

/** A twin's turn out of its reply: JSON when it kept to it, the plain words when it did not. */
export function readLabTurn(raw: string, name = ""): Turn | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let d: any = null;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { d = JSON.parse(s.slice(a, b + 1)); } catch { d = null; } }
  let say = d && typeof d === "object" ? String(d.say ?? d.reply ?? d.message ?? "") : (a >= 0 ? "" : s);
  /* A label the model put in front of its own words. */
  const who = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  say = say.replace(new RegExp(`^\\s*(?:${who ? who + "\\s+" : ""}(?:ai\\s+)?twin|you)\\s*[:\\-]\\s*`, "i"), "");
  say = oneLine(say, TURN_MAX).replace(/^["“](.*)["”]$/, "$1").trim();
  if (!say) return null;
  return { say, because: oneLine(d?.because, 300), done: d?.done === true };
}

const words = (t: string) => new Set(String(t).toLowerCase().replace(/[^a-z0-9À-ɏ\s]/g, " ").split(/\s+/).filter(w => w.length > 2));

/** A turn that says again what a recent turn of the same twin said: nine words in ten the same. */
export function echoes(say: string, before: string[]): boolean {
  const a = words(say);
  if (a.size < 5) return false;
  return before.some(t => {
    const b = words(t);
    if (b.size < 5) return false;
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    return n / Math.min(a.size, b.size) >= 0.9;
  });
}

/* ---------- a folder, read for the lab ---------- */

/** A workspace's own personal folder, or null. */
async function personalIn(ctx: any, space: string) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  return head.brains.find((b: any) => b.type === "personal" && readSpace(b.space) === space) ?? null;
}

const profileText = (row: any) => (Array.isArray(row?.profile?.parts) ? row.profile.parts : [])
  .map((p: any) => `${p.title}: ${(p.points ?? []).join(" ")}`).join("\n").slice(0, PROFILE_MAX);

/** What a twin speaks from: its notes, the people in them, its profile. */
export async function sideOf(ctx: any, space: string): Promise<(Side & { brain: string }) | null> {
  const pb = await personalIn(ctx, space);
  if (!pb) return null;
  const held: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: any = await ctx.runQuery(internal.store.conceptsOfBrain, { space, brain: pb.slug, cursor });
    held.push(...p.concepts);
    if (!p.next) break;
    cursor = p.next;
  }
  const own = held.filter(c => c.tag !== "contact"), people = held.filter(c => c.tag === "contact");
  const row = await ctx.runQuery(internal.store.interviewGet, { space, brain: pb.slug });
  const n = notesText(own, OWN_MAX);
  return { space, name: labName(space), brain: pb.slug, profile: profileText(row), notes: n.text, used: n.used,
    people: people.length ? notesText(people, PEOPLE_MAX).text : "" };
}

/** The panel's view of a personal folder: counts and the newest titles, from the slim cards. */
export async function folderOf(ctx: any, space: string) {
  const head = await ctx.runQuery(internal.store.spaceHead, { space });
  const pb = head.brains.find((b: any) => b.type === "personal" && readSpace(b.space) === space);
  const base = { space, name: labName(space) };
  if (!pb) return { ...base, brain: null, notes: 0, people: 0, open: 0, profile: false, newest: [] as string[], model: null };
  const cards: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: any = await ctx.runQuery(internal.store.cardsPage, { brain: pb.slug, cursor, ready: head.ready });
    cards.push(...p.cards);
    if (p.done) break;
    cursor = p.cursor;
  }
  const own = cards.filter(c => c.tag !== "contact"), people = cards.filter(c => c.tag === "contact");
  const row = await ctx.runQuery(internal.store.interviewGet, { space, brain: pb.slug });
  const models = await ctx.runQuery(internal.store.modelsOf, { space });
  const newest = [...own].sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? ""))).slice(0, 6).map(c => String(c.title));
  return { ...base, brain: pb.slug, notes: own.length, people: people.length, open: people.reduce((n, c) => n + (c.open || 0), 0),
    profile: Array.isArray(row?.profile?.parts) && row.profile.parts.length > 0, newest, model: models?.chat ?? null };
}

/* ---------- the calls ---------- */

const callView = (l: any) => ({ id: l._id, title: l.title, topic: l.topic, status: l.status, turns: l.turns ?? 0, until: l.until ?? 0,
  starter: l.starter, note: l.note ?? null, error: l.error ?? null, created: l.created, updated: l.updated });

/** Every call, the newest first. */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("labs").order("desc").take(40)).map(callView),
});

/** One call and the turns after a given one, so a poll carries only what is new. */
export const read = internalQuery({
  args: { id: v.string(), after: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l) return null;
    const turns = (await ctx.db.query("labTurns").withIndex("by_lab", (q: any) => q.eq("lab", id)).collect())
      .filter((t: any) => t.n > (a.after ?? 0))
      .map((t: any) => ({ n: t.n, from: t.from, text: t.text, ...(t.because ? { because: t.because } : {}), at: t.at, ...(t.done ? { done: true } : {}) }));
    return { ...callView(l), a: l.a, b: l.b, gen: l.gen, turnRows: turns };
  },
});

/** A new call, not started. */
export const make = internalMutation({
  args: { topic: v.string(), starter: v.string() },
  handler: async (ctx, a) => {
    const topic = oneLine(a.topic, TOPIC_MAX) || LAB_TOPIC;
    const starter = inLab(a.starter) ? a.starter : LAB_SPACES[0];
    const now = Date.now();
    const id = await ctx.db.insert("labs", { title: topic.length > 56 ? topic.slice(0, 55) + "…" : topic, topic, a: LAB_SPACES[0], b: LAB_SPACES[1], starter,
      status: "idle", turns: 0, until: 0, gen: 0, last: 0, created: now, updated: now });
    return callView(await ctx.db.get(id));
  },
});

/**
 * What the admin presses.
 *   go      on, for the next LAB_RUN turns (or a stalled call woken)
 *   step    on, for one turn
 *   pause   off, to go on from here
 *   stop    off for good
 * A Go or a Step schedules the first turn at once; each turn schedules the next.
 */
export const control = internalMutation({
  args: { id: v.string(), action: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l) throw new Error("that call is gone");
    const now = Date.now();
    if (a.action === "pause") {
      if (l.status === "running") await ctx.db.patch(l._id, { status: "paused", note: "Paused by you.", gen: (l.gen ?? 0) + 1, updated: now });
    } else if (a.action === "stop") {
      if (l.status !== "ended") await ctx.db.patch(l._id, { status: "ended", note: "Stopped by you.", gen: (l.gen ?? 0) + 1, updated: now });
    } else if (a.action === "go" || a.action === "step") {
      if (l.status === "ended") throw new Error("that call is over. Start a new one.");
      const stalled = l.status === "running" && now - (l.updated ?? 0) > LAB_STALE_MS;
      if (l.status === "running" && !stalled) return callView(l);
      if ((l.turns ?? 0) >= LAB_TURN_MAX) throw new Error(`a call holds ${LAB_TURN_MAX} turns at most. Start a new one.`);
      const gen = (l.gen ?? 0) + 1, until = Math.min(LAB_TURN_MAX, (l.turns ?? 0) + (a.action === "step" ? 1 : LAB_RUN));
      await ctx.db.patch(l._id, { status: "running", until, gen, note: undefined, error: undefined, updated: now });
      await ctx.scheduler.runAfter(0, internal.lab.step, { id: a.id, gen });
    } else throw new Error("that is not something a call does");
    return callView(await ctx.db.get(l._id));
  },
});

/** A call and its turns, gone. A running call is stopped first. */
export const remove = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l) return { ok: true };
    for (const t of await ctx.db.query("labTurns").withIndex("by_lab", (q: any) => q.eq("lab", id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(l._id);
    return { ok: true };
  },
});

/** The admin's own line, read by the next twin to speak. */
export const say = internalMutation({
  args: { id: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l) throw new Error("that call is gone");
    if (l.status === "ended") throw new Error("that call is over. Start a new one.");
    const text = oneLine(a.text, SAY_MAX);
    if (!text) throw new Error("write what you want to say");
    if ((l.last ?? 0) >= LAB_TURN_MAX * 3) throw new Error("that call is long enough. Start a new one.");
    const n = (l.last ?? 0) + 1, at = Date.now();
    await ctx.db.insert("labTurns", { lab: l._id, n, from: "admin", text, at });
    await ctx.db.patch(l._id, { last: n, updated: at });
    return { n, from: "admin", text, at };
  },
});

/**
 * A turn lands. It is kept only while the call is still the run that asked for
 * it: a pause or a stop since is final, and the turn is dropped. The call then
 * goes on, waits, or ends, by what it just said.
 */
export const land = internalMutation({
  args: { id: v.string(), gen: v.number(), from: v.string(), say: v.string(), because: v.string(), done: v.boolean() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l || l.status !== "running" || l.gen !== a.gen) return { kept: false, next: false };
    const n = (l.last ?? 0) + 1, turns = (l.turns ?? 0) + 1, at = Date.now();
    /* Its own recent words, to see whether it says the same again. */
    const mine = (await ctx.db.query("labTurns").withIndex("by_lab", (q: any) => q.eq("lab", id)).collect())
      .filter((t: any) => t.from === a.from).slice(-3).map((t: any) => t.text);
    await ctx.db.insert("labTurns", { lab: l._id, n, from: a.from, text: a.say, ...(a.because ? { because: a.because } : {}), at, ...(a.done ? { done: true } : {}) });
    const patch: any = { last: n, turns, updated: at };
    let next = false;
    if (a.done) { patch.status = "ended"; patch.note = `${labName(a.from)}'s twin says the call is done.`; }
    else if (echoes(a.say, mine)) { patch.status = "paused"; patch.note = `${labName(a.from)}'s twin is repeating itself. Say something to steer it, then go on.`; }
    else if (turns >= LAB_TURN_MAX) { patch.status = "ended"; patch.note = `The call reached its ${LAB_TURN_MAX} turns.`; }
    else if (turns >= (l.until ?? 0)) { patch.status = "paused"; patch.note = `${turns} turns so far. Go on, or step one at a time.`; }
    else next = true;
    await ctx.db.patch(l._id, patch);
    return { kept: true, next };
  },
});

/** A call that cannot go on says why and waits, when it is still the run that asked. */
export const settle = internalMutation({
  args: { id: v.string(), gen: v.number(), status: v.string(), note: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("labs", a.id);
    const l = id ? await ctx.db.get(id) : null;
    if (!l || l.status !== "running" || l.gen !== a.gen) return { ok: false };
    await ctx.db.patch(l._id, { status: a.status, note: a.note, error: a.error, updated: Date.now() });
    return { ok: true };
  },
});

/**
 * One turn of a running call: the next twin to speak reads its own folder and
 * the latest turns, and says its piece. Whatever goes wrong, the call waits
 * with the reason, so it never sits "running" with nothing coming.
 */
export async function labStep(ctx: any, id: string, gen: number) {
  const call = await ctx.runQuery(internal.lab.read, { id, after: 0 });
  if (!call || call.status !== "running" || call.gen !== gen) return { skipped: true };
  const stop = (status: string, error: string) => ctx.runMutation(internal.lab.settle, { id, gen, status, error });
  try {
    const rate = await ctx.runMutation(internal.store.mcpRate, { who: "lab:turns", max: LAB_DAY, windowMs: 24 * 60 * 60 * 1000 });
    if (!rate.allowed) { await stop("paused", `The lab has used its ${LAB_DAY} turns for today. It goes on tomorrow.`); return { limited: true }; }
    const first = call.starter;
    const speaker = call.turns % 2 === 0 ? first : otherSide(first);
    const me = await sideOf(ctx, speaker);
    if (!me || me.used < 3) { await stop("paused", `${labName(speaker)}'s personal folder holds too few notes to speak from. Talk to it first, then go on.`); return { thin: true }; }
    const other = { space: otherSide(speaker), name: labName(otherSide(speaker)), profile: "", notes: "", people: "", used: 0 };
    /* The latest turns only: the call itself grows, what a twin reads does not. */
    const lines: Line[] = call.turnRows.slice(-READ_BACK).map((t: any) => ({ from: t.from, text: t.text }));
    const models = await ctx.runQuery(internal.store.modelsOf, { space: speaker });
    const { text } = await ask([
      { role: "system", content: LAB_RULES },
      { role: "user", content: labPrompt({ me, other, topic: call.topic, lines }) },
    ], { json: true, maxTokens: 700, model: models?.chat || undefined, timeout: 90000, temperature: 0.8 });
    const turn = readLabTurn(text, me.name);
    if (!turn) { await stop("paused", `${me.name}'s twin sent nothing readable. Go on to try again.`); return { empty: true }; }
    const landed = await ctx.runMutation(internal.lab.land, { id, gen, from: speaker, say: turn.say, because: turn.because, done: turn.done });
    if (landed.next) await ctx.scheduler.runAfter(LAB_DELAY_MS, internal.lab.step, { id, gen });
    return landed;
  } catch (e: any) {
    await stop("paused", String(e?.message ?? e).slice(0, 300)).catch(() => {});
    return { failed: true };
  }
}

export const step = internalAction({
  args: { id: v.string(), gen: v.number() },
  handler: async (ctx, a) => await labStep(ctx, a.id, a.gen),
});
