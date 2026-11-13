// One entry point for the website and the command-line tool:
// audit lines + pasted history → parsed data, chosen rule sets, and evaluation.

import { parseAudit } from "./audit-parser.js";
import { parseHistory } from "./history-parser.js";
import { mergeCourses } from "./courses.js";
import { evaluate } from "./engine.js";

/**
 * @param {object} o
 *   auditLines   lines from pdfToLines() (or null)
 *   historyText  text pasted from TSS My Academic History (or "")
 *   loadJson     async (pathInsideRules) => object
 *   overrides    { major, college, collegeVariant, school } chosen by the student, all optional
 */
export async function runReAudit({ auditLines = null, historyText = "", loadJson, overrides = {} }) {
  const warnings = [];
  const index = await loadJson("index.json");
  const audit = auditLines && auditLines.length ? parseAudit(auditLines) : null;
  const history = historyText && historyText.trim() ? parseHistory(historyText) : { courses: [], schools: [], events: {}, format: null, warnings: [] };
  warnings.push(...history.warnings);

  if (audit && !audit.meta.recognized) warnings.push("This PDF doesn't look like a TSS degree audit. Save the audit page from TSS as a PDF and try again.");
  if (!audit && !history.courses.length) throw new Error("Add your audit PDF, paste your academic history, or both.");

  // Major
  const majorCode = overrides.major || (audit && audit.meta.majorCode) || null;
  const programCode = ((audit && audit.meta.programCode) || "").toUpperCase();
  const majorEntry = index.majors.find((m) => m.code === majorCode) ||
    (!overrides.major && programCode && index.majors.find((m) => m.tssCode && programCode.endsWith(m.tssCode.replace(/-/g, "")))) || null;
  if (majorCode && !majorEntry && !programCode) warnings.push(`Your major (${majorCode}) isn't in this tool yet, so only college and university requirements are checked. See CONTRIBUTING.md to add it.`);
  if (majorCode && !majorEntry && programCode) warnings.push(`Your major (${majorCode}) isn't in this tool yet, so only college and university requirements are checked. See CONTRIBUTING.md to add it.`);
  if (!majorCode && !majorEntry) warnings.push("No major found, or it isn't in this tool yet. Pick it from the list to check major requirements.");

  // College
  const collegeName = (overrides.college || (audit && audit.meta.collegeName) || "").toUpperCase();
  const collegeEntry = index.colleges.find((c) => collegeName.includes(c.name)) || null;
  if (collegeName && !collegeEntry) warnings.push(`${titleCase(collegeName)} isn't in this tool yet, so its GE requirements aren't checked. See CONTRIBUTING.md to add it.`);
  if (!collegeName) warnings.push("No college found. Pick it from the list to check GE requirements.");

  // Previous school
  const schoolId = overrides.school !== undefined ? overrides.school : (history.schools[0] && history.schools[0].id) || null;
  const schoolEntry = schoolId ? index.transfer.find((t) => t.school === schoolId) || null : null;
  if (history.schools.length && !schoolEntry && schoolId) {
    warnings.push(`There's no transfer table for ${history.schools[0].name} yet. Transfer classes TSS already matched to UC San Diego courses still count; the rest stay as electives.`);
  }

  const [university, major, college, transfer] = await Promise.all([
    loadJson(index.university),
    majorEntry ? loadJson(majorEntry.file) : null,
    collegeEntry ? loadJson(collegeEntry.file) : null,
    schoolEntry ? loadJson(schoolEntry.file) : null,
  ]);

  if (major && audit && audit.meta.catalog && major.catalogYears && !catalogCovered(major.catalogYears, audit.meta.catalog)) {
    warnings.push(`Your audit uses the ${audit.meta.catalog} catalog, but these ${major.title} rules were checked against ${major.catalogYears.join(", ")}. Most requirements match, but double-check anything marked NEED.`);
  }
  if (audit && !history.courses.length) {
    warnings.push("Without your academic history, this only sees the classes printed on the audit. Paste your history too so every class on your record is included.");
  }

  const courses = mergeCourses(audit ? audit.courses : [], history.courses);
  const variants = {};
  if (overrides.collegeVariant && college) variants[college.id] = overrides.collegeVariant;

  const result = evaluate({
    courses, audit, historyEvents: history.events, programs: [major, college, university], transfer, variants,
  });
  return {
    audit, history, result, warnings,
    selected: {
      major: major ? { code: majorEntry.code, title: major.title } : null,
      college: college ? { id: college.id, title: college.title, variant: result.programs.find((p) => p.id === college.id)?.variant } : null,
      school: transfer ? { id: transfer.school, name: transfer.name } : null,
    },
    index,
  };
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

// "Fall 2026" belongs to the 2026-27 catalog; "Winter 2027" and "Spring 2027" do too.
function catalogCovered(years, catalog) {
  if (years.includes(catalog)) return true;
  const m = /^(Fall|Winter|Spring|Summer) (\d{4})$/.exec(catalog);
  if (!m) return false;
  const start = m[1] === "Fall" ? +m[2] : +m[2] - 1;
  return years.includes(`${start}-${String(start + 1).slice(2)}`);
}
