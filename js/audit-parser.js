// Read a UC San Diego TSS (uAchieve) degree audit, already turned into text lines.
// The audit marks status with icons that do not survive copying or printing, so a
// requirement is treated as unmet when its block contains a "NEEDS:" line.

import { makeCourse, mergeCourses } from "./courses.js";

const COURSE_LINE = /^(FA|WI|SP|SU|S1|S2|S3)(\d{2}) ([A-Z]{2,5})( ?- ?| )(\d{1,3}[A-Z]{0,3}) (\d+\.\d{1,2})(?: ([Tt]?(?:[A-DF][+-]?|P|NP|S|U|IP|W|I|NR|RD|PL)))?(?: (.*))?$/;
const NOISE = [
  /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} [AP]M My Audit/i,
  /^https?:\/\//i,
  /^Open All Sections/i,
  /^Legend$/i, /^- (Complete|Planned|In Progress|Unfulfilled)$/i,
  /^UC San Diego 9500 Gilman/i, /^Copyright ©/i, /^Terms & Conditions$/i,
];
const SECTION = /^>> (MAJOR|MINOR|COLLEGE|UNIVERSITY) REQUIREMENTS <<\s*(.*)$/i;

function clean(line) {
  return line.replace(/\s+/g, " ").trim();
}

/** Parse audit lines. Returns meta, requirement blocks, every course found, and the unapplied electives. */
export function parseAudit(rawLines) {
  const lines = rawLines.map(clean).filter((l) => l && !NOISE.some((re) => re.test(l)));
  // Deliberately no name or student number: the report never needs them.
  const meta = {
    preparedOn: null, programCode: null, catalog: null,
    majorCode: null, majorTitle: null, collegeName: null, collegeStatus: null, collegeCatalog: null,
    unitsEarned: null, upperDivUnitsEarned: null, recognized: false,
  };
  const blocks = [];
  const courses = [];
  let section = "header";
  let block = null;
  let req = null;
  let lastNeeds = null;

  const startBlock = (title) => {
    block = { section, title, earned: null, needs: null, requirements: [], courses: [], notes: [] };
    blocks.push(block);
    req = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1] || "";

    // Header fields
    let m;
    if ((m = l.match(/TSS Program (\S+)/))) meta.programCode = m[1];
    if ((m = l.match(/TSS Catalog (Fall|Winter|Spring|Summer) (\d{4})/i))) meta.catalog = `${m[1]} ${m[2]}`;
    if ((m = l.match(/^UNT (\d{2}\/\d{2}\/\d{4})/))) meta.preparedOn = m[1];
    if (/UNT Audit Results|AT LEAST ONE REQUIREMENT|ALL REQUIREMENTS (HAVE BEEN|ARE) (SATISFIED|COMPLETE)/i.test(l)) meta.recognized = true;

    if ((m = l.match(SECTION))) {
      section = m[1].toLowerCase();
      if (section === "college" && m[2]) meta.collegeCatalog = m[2].trim();
      block = null; req = null;
      continue;
    }
    if ((m = l.match(/^\(([A-Z0-9]{2,6})\) (.+)$/)) && section === "major" && !meta.majorCode) {
      meta.majorCode = m[1]; meta.majorTitle = m[2]; continue;
    }
    if (/COLLEGE GENERAL EDUCATION$/i.test(l) && section === "college") {
      meta.collegeName = l.replace(/ GENERAL EDUCATION$/i, "").trim(); continue;
    }
    if (section === "college" && /^(GENERAL TRANSFER STATUS|IGETC.*|UC RECIPROCITY.*|.*RECIPROCITY.*|FIRST[- ]YEAR.*|FRESHMAN.*)$/i.test(l) && !meta.collegeStatus) {
      meta.collegeStatus = l; continue;
    }

    // Course line
    if ((m = l.match(COURSE_LINE))) {
      const [, q, yy, subj, sep, num, units, grade, title] = m;
      const hasDash = sep.includes("-");
      const c = makeCourse({
        term: `${q}${yy}`, code: `${subj} ${num}`, units, grade: grade || "", title: title || "",
        origin: grade && grade.startsWith("t") ? "transfer" : (grade && grade.startsWith("T") ? "transfer-articulated" : "ucsd"),
        source: "audit",
      });
      if (c) {
        c.auditFormat = hasDash ? "ucsd-code" : "plain";
        courses.push(c);
        if (req) req.courses.push(c); else if (block) block.courses.push(c);
      }
      continue;
    }

    // Numbered requirement
    if ((m = l.match(/^(\d{1,2})\) (.+)$/))) {
      if (!block) startBlock("(untitled)");
      req = { n: Number(m[1]), title: m[2].trim(), needs: null, courseList: "", notes: [], courses: [] };
      block.requirements.push(req);
      continue;
    }

    // Totals
    if ((m = l.match(/^EARNED:\s*([\d.]+)\s*(Units?|requirements?)/i))) {
      const target = req || block;
      if (target) target.earned = `${m[1]} ${m[2]}`;
      if (/Units?/i.test(m[2])) {
        if (meta.unitsEarned == null && block && /UC GPA|minimum of 180/i.test(block.title + " " + block.notes.join(" "))) meta.unitsEarned = Number(m[1]);
        if (block && /Upper Division Units/i.test(block.title)) meta.upperDivUnitsEarned = Number(m[1]);
      }
      continue;
    }
    if ((m = l.match(/^NEEDS:\s*([\d.]+)\s*(Units?|Courses?|requirements?)/i))) {
      lastNeeds = `${m[1]} ${m[2]}`;
      if (req && !/requirements?/i.test(m[2])) req.needs = lastNeeds;
      else if (block) block.needs = lastNeeds;
      continue;
    }
    if ((m = l.match(/^COURSES:\s*(.*)$/))) {
      if (req) req.courseList += (req.courseList ? " " : "") + m[1];
      continue;
    }

    // Headings: a known standalone block, a "... Requirements" title, or a line followed by a
    // block-level summary ("EARNED: 3 requirements"). Inside a requirement or at the top of a
    // block that has no summary yet, a line followed by NEEDS is just an explanatory note.
    const knownHeading =
      /^(Elective Courses|Minimum Upper Division Units|Maximum of 25% Pass\/No Pass|UC GPA|\d+ Upper Division Unit Requirement)$/i.test(l) ||
      /Requirements( and Major GPA)?$/i.test(l);
    const summaryNext = /^(EARNED|NEEDS):.*requirements?\b/i.test(next);
    const unitsNext = /^(EARNED|NEEDS):/i.test(next) && !/^\d/.test(l);
    const blockIsFresh = block && block.requirements.length === 0 && block.earned == null && block.needs == null;
    const looksLikeHeading = knownHeading || (summaryNext && !blockIsFresh) || (unitsNext && !req && !blockIsFresh);
    if ((looksLikeHeading && section !== "header") || /^UC GPA$/.test(l)) {
      startBlock(l);
      continue;
    }

    // Anything else is a note. A wrapped requirement title continues on the next line.
    if (req && req.notes.length === 0 && req.courses.length === 0 && !req.needs && /^[a-z(]/.test(l)) {
      req.title += " " + l;
    } else if (req && req.courseList && req.notes.length === 0 && /\b[A-Z]{2,5}[-*]\s?(\d|\[)/.test(l)) {
      req.courseList += " " + l;
    } else if (req) {
      req.notes.push(l);
    } else if (block) {
      block.notes.push(l);
    } else if (/You need a minimum of 180 units/i.test(l)) {
      startBlock("UC GPA");
      block.notes.push(l);
    }
  }

  for (const b of blocks) {
    for (const r of b.requirements) {
      r.met = r.needs == null;
      r.listedCodes = parseCourseList(r.courseList);
    }
  }
  const electives = (blocks.find((b) => /^Elective Courses$/i.test(b.title)) || { courses: [] }).courses;
  if (meta.majorCode || blocks.some((b) => b.requirements.length)) meta.recognized = true;
  return { meta, blocks, courses: mergeCourses(courses), unappliedCourses: electives };
}

/**
 * Course codes named in an audit "COURSES:" list, e.g.
 * "MATH- 189 OR DSC- 152,100 Biological Sci: BILD- 001,003" → ["MATH 189", "DSC 152", "DSC 100", "BILD 1", "BILD 3"].
 * Title wildcards like "ENGL* [*omp*]" are ignored.
 */
export function parseCourseList(text) {
  const out = new Set();
  let subj = null;
  for (const raw of String(text || "").replace(/\(X\)/g, "").split(/[\s,]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    let m;
    if ((m = tok.match(/^([A-Z]{2,5})-(\d{1,3}[A-Z]{0,3})?$/))) {
      subj = m[1];
      if (m[2]) out.add(codeOf(subj, m[2]));
      continue;
    }
    if (/^(OR|TO|AND)$/.test(tok) || /:$/.test(tok)) continue;
    if (subj && (m = tok.match(/^(\d{1,3}[A-Z]{0,3})$/))) out.add(codeOf(subj, m[1]));
    else subj = null;
  }
  return [...out];
}
function codeOf(subj, num) {
  const m = num.match(/^0*(\d+)([A-Z]*)$/);
  return `${subj} ${Number(m[1])}${m[2]}`;
}

/** Find a requirement on the parsed audit by section and a title pattern. */
export function findAuditRequirement(audit, section, titlePattern) {
  if (!audit || !titlePattern) return null;
  const re = new RegExp(titlePattern, "i");
  for (const b of audit.blocks) {
    if (section && b.section !== section) continue;
    for (const r of b.requirements) if (re.test(r.title)) return r;
  }
  return null;
}

/** Find a block (e.g. "48 Upper Division Unit Requirement"). */
export function findAuditBlock(audit, titlePattern) {
  if (!audit || !titlePattern) return null;
  const re = new RegExp(titlePattern, "i");
  return audit.blocks.find((b) => re.test(b.title)) || null;
}
