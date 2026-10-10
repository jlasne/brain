/**
 * Reading an export back. Settings, Export writes every folder of a workspace as one markdown file; Restore reads that file and gives
 * back what it holds, so a backup restores in one step. Nothing here touches the database: it turns the file into folders, concepts and
 * sources, and the store adds the ones the workspace is missing.
 *
 * The file is read by its headings, so an export from before titles, names and links were written still restores: a title then comes
 * from the folder's summary list, a name from the slug.
 */

export type Restored = {
  brains: { slug: string; name: string; type: string; scope: string }[];
  concepts: { brain: string; type: string; slug: string; n: number; title: string; summaryLine: string; position: string; evidence: any[]; data: string[];
              conflicts: any[]; sources: string[]; related: string[]; kinds: { to: string; type: string }[]; aliases: string[]; updated: string }[];
  sources: { sid: string; date: string; author: string; link: string; title: string; brains: string[] }[];
};

/** The most an export may hold to be read back in one go: about 15 MB of markdown. */
export const RESTORE_CHARS = 15_000_000;

const TYPES = ["subject", "person", "personal"];
const LINK_TYPES = ["needs", "causes", "supports", "contradicts", "example", "related"];

/** A folder's name from its slug, for an export written before names were: "wealth-squidgy" reads "Wealth squidgy". */
const nameOf = (slug: string) => { const t = slug.replace(/-/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

/** "brain-subject-wealth" is the subject folder "wealth". Projects are not restored: they hold files, which an export does not. */
function folderOf(cell: string): { type: string; slug: string } | null {
  const m = /^brain-(subject|person|personal|project)-([a-z0-9-]+)$/.exec(cell.trim());
  return m && TYPES.includes(m[1]) ? { type: m[1], slug: m[2] } : null;
}

/** The cells of a markdown table row. */
const cellsOf = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(x => x.trim());

/** A table under a heading: its header row names the columns, so a column added later is read where it stands. */
function tableAt(lines: string[], from: number): Record<string, string>[] {
  let i = from;
  while (i < lines.length && !lines[i].trim().startsWith("|")) { if (/^#/.test(lines[i]) && i > from) return []; i++; }
  if (i >= lines.length) return [];
  const head = cellsOf(lines[i]).map(h => h.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const c = cellsOf(lines[i]);
    rows.push(Object.fromEntries(head.map((h, k) => [h, c[k] ?? ""])));
  }
  return rows;
}

/** The lines of a "- item" list, "- none" read as nothing. */
const itemsOf = (body: string) => body.split("\n").map(l => l.trim()).filter(l => l.startsWith("- ")).map(l => l.slice(2).trim()).filter(l => l !== "none");

export function parseExport(md: string): Restored {
  const text = String(md ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const out: Restored = { brains: [], concepts: [], sources: [] };

  /* The map: every folder, its type and its scope, and its name when the export wrote one. */
  const mapAt = lines.findIndex(l => l.trim() === "# MAP");
  const seen = new Map<string, Restored["brains"][number]>();
  if (mapAt >= 0) for (const r of tableAt(lines, mapAt + 1)) {
    const f = folderOf(r.brain ?? "");
    if (!f || seen.has(f.slug)) continue;
    const b = { slug: f.slug, name: (r.name || "").trim() || nameOf(f.slug), type: f.type, scope: (r.scope || "").trim() };
    seen.set(f.slug, b); out.brains.push(b);
  }

  /* The sources: their id, date, author, link and folders, and their title when the export wrote one. */
  const srcAt = lines.findIndex(l => l.trim() === "# SOURCES");
  if (srcAt >= 0) for (const r of tableAt(lines, srcAt + 1)) {
    const sid = (r.id ?? "").trim();
    if (!sid) continue;
    out.sources.push({ sid, date: r.date ?? "", author: r.author ?? "", link: r.link ?? "", title: r.title ?? "",
      brains: (r.brains ?? "").split(",").map(x => x.trim()).filter(Boolean) });
  }

  /* Each folder's summary list gives the titles an older export left out of the concepts themselves. */
  const listed = new Map<string, { title: string; summaryLine: string }>();
  let folder: { type: string; slug: string } | null = null;
  for (const l of lines) {
    const h = /^# (brain-[a-z]+-[a-z0-9-]+)\/SUMMARY\.md\s*$/.exec(l);
    if (h) { folder = folderOf(h[1]); continue; }
    if (/^#{1,2} /.test(l)) { folder = null; continue; }
    const m = folder && /^- (.*): (.*)\. `\d+-([a-z0-9-]+)\.md`\s*$/.exec(l);
    if (m && folder) listed.set(`${folder.slug}/${m[3]}`, { title: m[1].trim(), summaryLine: m[2].trim() });
  }

  /* The concepts: one "## brain-…/NN-slug.md" heading each, then its parts under "###". */
  const heads: number[] = [];
  lines.forEach((l, i) => { if (/^## brain-[a-z]+-[a-z0-9-]+\/\d+-[a-z0-9-]+\.md\s*$/.test(l)) heads.push(i); });
  heads.forEach((at, k) => {
    const m = /^## (brain-[a-z]+-[a-z0-9-]+)\/(\d+)-([a-z0-9-]+)\.md/.exec(lines[at])!;
    const f = folderOf(m[1]);
    if (!f) return;
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    const block = lines.slice(at + 1, end);
    /* A "# …" heading ends the concept too: the next folder's summary starts there. */
    const stop = block.findIndex(l => /^# /.test(l));
    const body = (stop >= 0 ? block.slice(0, stop) : block).join("\n");
    const part = (name: string) => {
      const r = new RegExp(`^### ${name}\\s*$`, "m").exec(body);
      if (!r) return "";
      const rest = body.slice(r.index + r[0].length);
      const next = /^### /m.exec(rest);
      return (next ? rest.slice(0, next.index) : rest).trim();
    };
    const line = (label: string) => (new RegExp(`^\\*\\*${label}:\\*\\* (.*)$`, "m").exec(body)?.[1] ?? "").trim();
    const id = `${f.slug}/${m[3]}`;
    const position = part("Position");
    const evidence = itemsOf(part("Evidence")).map(e => {
      const x = /^(.*?), (.*?): (.*)$/.exec(e);
      return x ? { date: x[1] === "?" ? "" : x[1], author: x[2] === "?" ? "" : x[2], claim: x[3] } : { date: "", author: "", claim: e };
    });
    const conflicts = itemsOf(part("Open conflicts")).map(c => {
      const x = /^(.*) \((.*?)\) against (.*) \((.*?)\)\. They differ because (.*?)\.?$/.exec(c);
      return x ? { a: x[1], aDate: x[2], b: x[3], bDate: x[4], why: x[5] } : null;
    }).filter(Boolean);
    const kinds: { to: string; type: string }[] = [];
    for (const l of itemsOf(part("Links"))) {
      const x = /^([a-z]+): ([a-z0-9-]+\/[a-z0-9-]+)$/.exec(l);
      if (x && LINK_TYPES.includes(x[1])) kinds.push({ to: x[2], type: x[1] });
    }
    out.concepts.push({
      brain: f.slug, type: f.type, slug: m[3], n: Number(m[2]) || 1,
      title: line("Title") || listed.get(id)?.title || nameOf(m[3]),
      summaryLine: line("Summary") || listed.get(id)?.summaryLine || "",
      position: position === "none yet" ? "" : position,
      evidence, data: itemsOf(part("Data")), conflicts,
      sources: itemsOf(part("Sources")).map(s => /^`notes\/(.+)\.md`$/.exec(s)?.[1] ?? "").filter(Boolean),
      related: [...new Set(kinds.map(x => x.to))],
      kinds: kinds.filter(x => x.type !== "related"),
      aliases: itemsOf(part("Also called")),
      updated: part("Updated").split("\n")[0].trim(),
    });
  });
  /* A folder whose concepts are in the file but not on the map still comes back. */
  for (const c of out.concepts) if (!seen.has(c.brain)) {
    const head = lines.find(l => new RegExp(`^## brain-([a-z]+)-${c.brain}/`).test(l)) ?? "";
    const type = /^## brain-([a-z]+)-/.exec(head)?.[1] ?? "subject";
    const b = { slug: c.brain, name: nameOf(c.brain), type: TYPES.includes(type) ? type : "subject", scope: "" };
    seen.set(c.brain, b); out.brains.push(b);
  }
  return out;
}
