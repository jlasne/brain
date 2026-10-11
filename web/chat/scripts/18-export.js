/* 18-export.js: Export: every folder as one markdown file. */

/* ============ export ============ */
async function exportAll(){
  /* The app holds names and summary lines. The whole concepts are read here,
     brain by brain, only when an export is asked for. */
  const whole = {};
  for (const b of S.brains){
    try {
      const all = []; let cursor = null;
      do {
        const r = await api("/api/export", { brain: b.slug, cursor });
        all.push(...(r.concepts || [])); cursor = r.next || null;
      } while (cursor);
      whole[b.slug] = all.sort((x,y)=>(x.n||0)-(y.n||0));
    }
    catch (_) { whole[b.slug] = conceptsOf(b.slug); }
  }
  /* A cell of a table: one line, with no bar that would split it. */
  const cell = t => String(t ?? "").replace(/[|\n\r]+/g, " ").trim();
  const out = ["# MAP\n\n| Brain | Name | Type | Concepts | Scope |\n|---|---|---|---|---|"];
  for (const b of S.brains) out.push(`| brain-${b.type}-${b.slug} | ${cell(b.name)} | ${b.type} | ${conceptsOf(b.slug).length} | ${cell(b.scope)} |`);
  out.push("\n# SOURCES\n\n| Id | Date | Author | Title | Link | Brains |\n|---|---|---|---|---|---|");
  for (const s of S.sources) out.push(`| ${s.sid} | ${s.date||""} | ${cell(s.author)} | ${cell(s.title)} | ${s.link||""} | ${(s.brains||[]).join(", ")} |`);
  for (const b of S.brains){
    out.push(`\n# brain-${b.type}-${b.slug}/SUMMARY.md\n\n**Scope:** ${b.scope}\n`);
    for (const c of whole[b.slug]) out.push(`- ${c.title}: ${c.summaryLine||c.position||"no position yet"}. \`${pad2(c.n||1)}-${c.slug||conceptSlug(c.title)}.md\``);
    for (const c of whole[b.slug]){
      out.push(`\n## brain-${b.type}-${b.slug}/${pad2(c.n||1)}-${c.slug||conceptSlug(c.title)}.md\n`);
      /* Its title and line, word for word, so Restore gives them back as they were. */
      out.push(`**Title:** ${cell(c.title)}\n**Summary:** ${cell(c.summaryLine)}\n`);
      out.push(`### Position\n\n${c.position||"none yet"}\n`);
      out.push(`### Evidence\n\n${(c.evidence||[]).map(e=>`- ${e.date||"?"}, ${e.author||"?"}: ${e.claim||""}`).join("\n")||"- none"}\n`);
      out.push(`### Data\n\n${(c.data||[]).map(x=>"- "+x).join("\n")||"- none"}\n`);
      out.push(`### Open conflicts\n\n${(c.conflicts||[]).map(x=>`- ${x.a} (${x.aDate}) against ${x.b} (${x.bDate}). They differ because ${x.why}.`).join("\n")||"- none"}\n`);
      out.push(`### Sources\n\n${(c.sources||[]).map(x=>"- `notes/"+x+".md`").join("\n")||"- none"}\n`);
      const kind = new Map((c.kinds||[]).map(k => [k.to, k.type]));
      const links = (c.related||[]).filter(r => /^[a-z0-9-]+\/[a-z0-9-]+$/.test(r)).map(r => `- ${kind.get(r) || "related"}: ${r}`);
      if (links.length) out.push(`### Links\n\n${links.join("\n")}\n`);
      if ((c.aliases||[]).length) out.push(`### Also called\n\n${c.aliases.map(a => "- " + cell(a)).join("\n")}\n`);
      out.push(`### Updated\n\n${c.updated||""}\n`);
    }
  }
  const md = out.join("\n");
  const name = `${(S.spaceName || "brains").toLowerCase()}-brains-${new Date().toISOString().slice(0,10)}.md`;
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  push("ai", b => { b.innerHTML = rich(
    `**Exported** \`${esc(name)}\`: ${S.brains.length} brain${S.brains.length===1?"":"s"}, ` +
    `${S.concepts.length} concept${S.concepts.length===1?"":"s"}, ${S.sources.length} source${S.sources.length===1?"":"s"}, ` +
    `${Math.round(md.length/1000)}k characters of markdown.`); });
  bottom();
}
