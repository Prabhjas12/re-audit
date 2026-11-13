// Turn an evaluation into HTML (for the page, for printing, and for the command-line report)
// and into copy-ready advising messages.

import { STATUS } from "./engine.js";

export const STATUS_LABEL = {
  [STATUS.DONE]: "Done",
  [STATUS.IN_PROGRESS]: "In progress",
  [STATUS.FIX]: "Ask to apply",
  [STATUS.PETITION]: "Petition",
  [STATUS.NEED]: "Still needed",
};
const STATUS_HELP = {
  [STATUS.DONE]: "Satisfied, and the official audit agrees.",
  [STATUS.IN_PROGRESS]: "Satisfied once your current or planned classes finish.",
  [STATUS.FIX]: "Your record already satisfies this, but the official audit doesn't show it. Ask advising to apply it.",
  [STATUS.PETITION]: "Satisfied only if advising approves a transfer class for it.",
  [STATUS.NEED]: "You still need to take something.",
};
const ORDER = [STATUS.NEED, STATUS.PETITION, STATUS.FIX, STATUS.IN_PROGRESS, STATUS.DONE];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function badge(status) {
  return `<span class="badge s-${status.toLowerCase()}" title="${esc(STATUS_HELP[status])}">${esc(STATUS_LABEL[status])}</span>`;
}

function courseChip(a) {
  const c = a.course;
  const bits = [c.term, c.grade || (c.status === "planned" ? "planned" : c.status === "in-progress" ? "in progress" : "")].filter(Boolean).join(", ");
  const tag = a.via === "petition" ? `<span class="tag petition">petition</span>`
    : a.via === "transfer-likely" && !a.alreadyOnAudit ? `<span class="tag likely">ask to apply</span>`
    : c.origin === "transfer" ? `<span class="tag xfer">transfer</span>` : "";
  const school = c.origin === "transfer" ? " (transfer)" : c.origin === "transfer-articulated" ? " (transfer credit)" : "";
  return `<span class="chip${c.status !== "completed" ? " pending" : ""}" title="${esc(c.title + school)}"><b>${esc(c.code)}</b> <small>${esc(bits)}</small>${tag}</span>`;
}

function requirementRow(r) {
  const applied = r.applied.length ? r.applied.map(courseChip).join(" ") : `<span class="muted">None yet</span>`;
  const todo = [];
  if (r.status === STATUS.FIX) todo.push("Ask advising to apply these classes.");
  if (r.status === STATUS.PETITION) todo.push("Petition the transfer class, or take an approved class instead.");
  for (const m of r.missing) todo.push(esc(m.text));
  if (r.status === STATUS.NEED && r.help && !r.missing.length) todo.push(esc(r.help));
  for (const n of r.notes) todo.push(`<span class="note">${esc(n)}</span>`);
  if (r.status === STATUS.PETITION) {
    for (const a of r.applied.filter((x) => x.via === "petition" && x.entry && x.entry.why)) {
      todo.push(`<span class="note">${esc(a.course.code)}: ${esc(a.entry.why)}</span>`);
    }
  }
  const official = r.official ? (r.official.met ? "Met" : `Needs ${esc(r.official.needs || "")}`) : "—";
  return `<tr class="r-${r.status.toLowerCase()}">
    <td class="req"><div class="req-title">${esc(r.title)}</div><div class="progress">${esc(r.progress || "")}${r.choice && r.status !== STATUS.NEED ? ` · ${esc(r.choice)}` : ""}</div></td>
    <td class="status">${badge(r.status)}<div class="official">Official audit: ${official}</div></td>
    <td class="applied">${applied}</td>
    <td class="todo">${todo.map((t) => `<div>${t}</div>`).join("")}</td>
  </tr>`;
}

function checkRow(ch) {
  if (!ch.status) return "";
  return `<tr class="r-${ch.status.toLowerCase()}"><td class="req"><div class="req-title">${esc(ch.title)}</div></td>
    <td class="status">${badge(ch.status)}${ch.official ? `<div class="official">Official audit: ${ch.official.met ? "Met" : "Needs " + esc(ch.official.needs || "")}</div>` : ""}</td>
    <td colspan="2" class="todo">${esc(ch.detail || "")}</td></tr>`;
}

function programSection(p) {
  const counts = countStatuses(p.requirements.concat(p.checks.filter((c) => c.status)));
  return `<section class="program" id="prog-${esc(p.id)}">
    <h3>${esc(p.title)}${p.variant ? ` <small>· ${esc(p.variant.title)}</small>` : ""}</h3>
    <div class="mini-counts">${ORDER.filter((s) => counts[s]).map((s) => `${badge(s)} ${counts[s]}`).join(" ")}</div>
    <table class="reqs">
      <thead><tr><th>Requirement</th><th>Status</th><th>Classes applied</th><th>What to do</th></tr></thead>
      <tbody>${p.requirements.map(requirementRow).join("")}${p.checks.map(checkRow).join("")}</tbody>
    </table>
  </section>`;
}

function countStatuses(items) {
  const c = {};
  for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
  return c;
}

function todoList(result) {
  const items = [];
  for (const p of result.programs) {
    for (const r of p.requirements) {
      if (r.status !== STATUS.NEED) continue;
      const what = !r.missing.length ? r.help || "See advising"
        : r.missing.some((m) => m.alt) ? r.missing.map((m) => m.text).join("; or ")
        : r.missing.map((m) => m.text).join("; and ");
      items.push(`<li><b>${esc(r.title)}</b> <span class="muted">(${esc(shortProgram(p))})</span>: ${esc(what)}</li>`);
    }
    for (const ch of p.checks) {
      if (ch.status === STATUS.NEED) items.push(`<li><b>${esc(ch.title)}</b> <span class="muted">(${esc(shortProgram(p))})</span>: ${esc(ch.detail)}</li>`);
    }
  }
  return items;
}

function shortProgram(p) {
  return p.kind === "major" ? "major" : p.kind === "college" ? "college GE" : "university";
}

/** Advising messages: one for college advising (college + university), one for the major department. */
export function advisingMessages(out) {
  const { result, selected } = out;
  const msgs = [];
  const missing = result.missingFromAudit;
  const missingLine = missing.length
    ? `My degree audit isn't showing ${missing.length} of my UC San Diego classes yet (${missing.slice(0, 8).map((c) => c.code).join(", ")}${missing.length > 8 ? ", and others" : ""}). Could you take a look when you have a chance?`
    : "";

  const collect = (kinds) => {
    const apply = [], petition = [];
    for (const p of result.programs.filter((x) => kinds.includes(x.kind))) {
      for (const r of p.requirements) {
        if (r.status === STATUS.FIX) {
          const cs = r.applied.filter((a) => !a.alreadyOnAudit).map((a) => describeCourse(a, result));
          if (cs.length) apply.push(`${listJoin(cs)} to ${plainTitle(r.title)}`);
        }
        if (r.status === STATUS.PETITION) {
          const cs = r.applied.filter((a) => a.via === "petition").map((a) => describeCourse(a, result));
          if (cs.length) petition.push(`${listJoin(cs)} toward ${plainTitle(r.title)}`);
        }
      }
    }
    return { apply, petition };
  };

  const college = result.programs.find((p) => p.kind === "college");
  const c = collect(["college", "university"]);
  const needElr = college && college.requirements.find((r) => r.id === "elr" && r.status === STATUS.NEED);
  if (c.apply.length || c.petition.length || missingLine) {
    const lines = [`Hi, I'm a ${college ? college.title.replace(/ General Education$/, "") : "UC San Diego"} student${selected.major ? ` (${selected.major.code})` : ""}.`];
    if (missingLine) lines.push(missingLine);
    let n = 1;
    if (c.apply.length) {
      lines.push("These classes are already on my record. Could you apply them?");
      for (const x of c.apply) lines.push(`(${n++}) ${x}`);
    }
    if (c.petition.length) {
      lines.push("I'd also like to petition these transfer classes:");
      for (const x of c.petition) lines.push(`(${n++}) ${x}`);
    }
    if (needElr) lines.push(`(${n++}) Which Experiential Learning options would work for me, and is there a proposal deadline?`);
    lines.push("Thank you!", "[Your name], TSN [your Triton Student Number]");
    msgs.push({ to: college ? college.advisor : "College academic advising (vac.ucsd.edu)", body: lines.join("\n") });
  }

  const major = result.programs.find((p) => p.kind === "major");
  const m = collect(["major"]);
  if (major && (m.apply.length || missingLine)) {
    const lines = ["Hi,"];
    lines.push(missingLine || "Some of my classes don't seem to be applied to my major on my degree audit yet.");
    if (m.apply.length) {
      lines.push("Once they show up, these should apply to the major:");
      m.apply.forEach((x, i) => lines.push(`(${i + 1}) ${x}`));
    }
    lines.push("Thank you!", "[Your name], TSN [your Triton Student Number]");
    msgs.push({ to: major.advisor || "Your major department (vac.ucsd.edu)", body: lines.join("\n") });
  }
  return msgs;
}

function describeCourse(a, result) {
  const c = a.course;
  if (c.origin !== "transfer") return c.code;
  const title = (a.entry && a.entry.title) || (c.title ? titleCase(c.title) : "");
  return `${c.code}${title ? ` (${title})` : ""}${result.transferSchool ? ` from ${result.transferSchool}` : ""}`;
}
function listJoin(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function plainTitle(t) {
  return t.replace(/\s*\([^)]*\)\s*$/, "");
}
function titleCase(s) {
  return s.replace(/\s*[:]\s*$/, "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\b(And|Of|To|In|The|For)\b/g, (w) => w.toLowerCase());
}

function courseTable(result) {
  const rows = result.courses.map((c) => {
    const uses = result.usage.get(c.id) || [];
    let where = uses.map((u) => `${u.requirement}${u.via === "petition" ? " (petition)" : ""}`).join("; ");
    if (!where) {
      if (c.repeatOf) where = `Replaced by ${c.repeatOf}`;
      else if (c.status === "withdrawn") where = "Withdrawn";
      else if (c.status === "failed") where = "Not passed";
      else where = "Units only";
    }
    const origin = c.origin === "ucsd" ? "UC San Diego" : c.origin === "transfer-articulated" ? "Transfer (UCSD equivalent)" : `Transfer${result.transferSchool ? ", " + result.transferSchool : ""}`;
    const onAudit = c.sources.includes("audit") ? "yes" : c.origin === "ucsd" && c.status === "completed" ? `<span class="warn">no</span>` : "no";
    return `<tr class="${c.repeatOf || c.status === "withdrawn" || c.status === "failed" ? "dim" : ""}">
      <td>${esc(c.term || "")}</td><td><b>${esc(c.code)}</b></td><td class="title">${esc(c.title)}</td><td class="num">${c.units ?? ""}</td>
      <td>${esc(c.grade || (c.status === "planned" ? "planned" : c.status === "in-progress" ? "in progress" : ""))}</td>
      <td>${esc(origin)}</td><td>${onAudit}</td><td>${esc(where)}</td></tr>`;
  }).join("");
  return `<table class="courses"><thead><tr><th>Term</th><th>Course</th><th>Title</th><th>Units</th><th>Grade</th><th>From</th><th>On audit</th><th>Where it lands</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sources(result) {
  const items = [];
  for (const p of result.programs) {
    for (const s of p.sources) items.push(`<li>${esc(p.title)}: ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</li>`);
  }
  const notes = result.programs.flatMap((p) => p.notes.map((n) => `<li>${esc(n)}</li>`));
  return `<ul class="sources">${items.join("")}</ul><ul class="notes">${notes.join("")}</ul>`;
}

/** The full results section. */
export function renderReport(out, { generatedAt = new Date() } = {}) {
  const { result, selected, warnings, audit } = out;
  const all = result.programs.flatMap((p) => p.requirements);
  const counts = countStatuses(all);
  const u = result.units;
  const todo = todoList(result);
  const msgs = advisingMessages(out);
  const fixCount = (counts[STATUS.FIX] || 0);
  const headline = result.missingFromAudit.length
    ? `${result.missingFromAudit.length} of your UC San Diego classes aren't on your audit yet. Counting ${result.missingFromAudit.length === 1 ? "it" : "them"}, ${fixCount} requirement${fixCount === 1 ? "" : "s"} the audit shows as unmet ${fixCount === 1 ? "looks" : "look"} already satisfied.`
    : fixCount ? `${fixCount} requirement${fixCount === 1 ? "" : "s"} the official audit shows as unmet ${fixCount === 1 ? "is" : "are"} already satisfied by classes on your record.`
    : "Here's how your classes line up with your requirements.";

  return `<div class="report">
  <header class="report-head">
    <div>
      <h2>Your second-look audit</h2>
      <p class="meta">${[selected.major && selected.major.title, selected.college && selected.college.title.replace(/ General Education$/, ""), selected.college?.variant?.title, selected.school && `transfer from ${selected.school.name}`, audit?.meta.catalog && `catalog ${audit.meta.catalog}`].filter(Boolean).map(esc).join(" · ")}</p>
      <p class="meta">Generated ${esc(generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }))}${audit?.meta.preparedOn ? ` from an audit prepared ${esc(audit.meta.preparedOn)}` : ""}. Unofficial: your advisors and the official audit have the final word.</p>
    </div>
  </header>
  ${warnings.length ? `<div class="warnings">${warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</div>` : ""}
  <p class="headline">${esc(headline)}</p>
  <div class="cards">
    ${ORDER.map((s) => `<div class="card c-${s.toLowerCase()}"><div class="n">${counts[s] || 0}</div><div class="l">${badge(s)}</div><div class="h">${esc(STATUS_HELP[s])}</div></div>`).join("")}
  </div>
  <div class="units">
    <div><span class="big">${fmt(u.earned)}</span> units earned <span class="muted">of 180</span></div>
    <div><span class="big">${fmt(u.projected)}</span> with current and planned classes</div>
    <div><span class="big">${fmt(u.ud.earned)}</span> upper-division earned <span class="muted">of 60</span> · ${fmt(u.ud.projected)} projected</div>
  </div>

  <h3 class="section">What's left to take</h3>
  ${todo.length ? `<ul class="todo-list">${todo.join("")}</ul>` : `<p>Nothing! Everything is done, in progress, or waiting on advising.</p>`}

  ${msgs.length ? `<h3 class="section">Messages for advising</h3>
  <p class="muted">Copy these into the Virtual Advising Center (vac.ucsd.edu). Add your name and TSN, and edit anything that's off.</p>
  ${msgs.map((m, i) => `<div class="message"><div class="to">To: ${esc(m.to)}</div><pre id="msg-${i}">${esc(m.body)}</pre><button class="copy" data-copy="msg-${i}" type="button">Copy message</button></div>`).join("")}` : ""}

  <h3 class="section">Requirement by requirement</h3>
  ${result.programs.map(programSection).join("")}

  <h3 class="section">Every class and where it lands</h3>
  ${courseTable(result)}

  <details class="sources-box"><summary>Sources and notes</summary>${sources(result)}</details>
</div>`;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}
