// Course records: parsing codes, terms and grades, and merging course lists.
// Shared by the website and the command-line tool. No browser or Node APIs here.

const QUARTER_ORDER = { WI: 1, SP: 2, S1: 3, SU: 3, S2: 4, S3: 5, FA: 6 };
const QUARTER_WORDS = {
  WINTER: "WI", SPRING: "SP", FALL: "FA", AUTUMN: "FA",
  SUMMER: "SU", "SUMMER SESSION 1": "S1", "SUMMER SESSION I": "S1",
  "SUMMER SESSION 2": "S2", "SUMMER SESSION II": "S2", "SUMMER SESSION 3": "S3",
};

const GRADE_POINTS = {
  "A+": 4.0, A: 4.0, "A-": 3.7, "B+": 3.3, B: 3.0, "B-": 2.7,
  "C+": 2.3, C: 2.0, "C-": 1.7, "D+": 1.3, D: 1.0, "D-": 0.7, F: 0,
};
const PASS_GRADES = new Set(["P", "S", "CR"]);
const FAIL_GRADES = new Set(["NP", "U", "NC", "F"]);
const PENDING_GRADES = new Set(["", "IP", "WIP", "PL", "PLANNED", "ENROLLED", "INPROGRESS", "IN PROGRESS", "NR", "RD", "I"]);
const WITHDRAWN = new Set(["W", "WD", "DR", "DROPPED"]);

/** Parse a course code such as "MATH-020A", "CSE- 011", "DSC 10R", "LT* 1". */
export function parseCode(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/\s+/g, " ").trim();
  const m = s.match(/^([A-Z]{2,5})\s*-?\s*0*(\d{1,3})([A-Z]{0,3})$/);
  if (!m) return null;
  const subject = m[1];
  const num = parseInt(m[2], 10);
  const suffix = m[3] || "";
  return { subject, num, suffix, number: `${num}${suffix}`, code: `${subject} ${num}${suffix}` };
}

/** Upper-division = numbered 100–199 (UC convention, also used for UC transfer work). */
export function isUpperDivision(course) {
  return course && course.num >= 100 && course.num <= 199;
}

/** "FA22" / "Fall 2022" / "2022 Fall" / "Fall Quarter 2022" → { term: "FA22", order: 2022.6 } */
export function parseTerm(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/\s+/g, " ").trim();
  let m = s.match(/^(FA|WI|SP|SU|S1|S2|S3)\s?(\d{2}|\d{4})$/);
  if (m) return makeTerm(m[1], m[2]);
  m = s.match(/^(WINTER|SPRING|FALL|AUTUMN|SUMMER(?: SESSION (?:1|2|3|I|II))?)(?: QUARTER| SEMESTER| TERM)?,? (\d{4})$/);
  if (m) return makeTerm(QUARTER_WORDS[m[1]], m[2]);
  m = s.match(/^(\d{4}) (WINTER|SPRING|FALL|AUTUMN|SUMMER)(?: QUARTER| SEMESTER| TERM)?$/);
  if (m) return makeTerm(QUARTER_WORDS[m[2]], m[1]);
  return null;
}

function makeTerm(q, y) {
  const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  return { term: `${q}${String(year).slice(2)}`, order: year + (QUARTER_ORDER[q] || 0) / 10, year, quarter: q };
}

/** Find a term anywhere in a string. Returns { term, index, length } or null. */
export function findTerm(text) {
  const s = String(text).toUpperCase();
  const patterns = [
    /\b(FA|WI|SP|SU|S1|S2|S3)\s?(\d{2})\b/,
    /\b(WINTER|SPRING|FALL|AUTUMN|SUMMER(?: SESSION (?:1|2|3|I|II))?)(?: QUARTER| SEMESTER| TERM)?,? (\d{4})\b/,
    /\b(\d{4}) (WINTER|SPRING|FALL|AUTUMN|SUMMER)(?: QUARTER| SEMESTER| TERM)?\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const t = parseTerm(m[0]);
      if (t) return { ...t, index: m.index, length: m[0].length };
    }
  }
  return null;
}

/**
 * Normalize a grade as printed on the audit. Transfer grades carry a prefix:
 * "TA-" (upper-case T) = transfer course articulated to a UC San Diego course;
 * "tA-" (lower-case t) = transfer course with no UC San Diego equivalent.
 */
export function parseGrade(raw) {
  const original = raw == null ? "" : String(raw).trim();
  let g = original;
  let transfer = null;
  if (/^T[A-DF][+-]?$|^T(P|NP|S|U)$/.test(g)) { transfer = "articulated"; g = g.slice(1); }
  else if (/^t[A-DF][+-]?$|^t(P|NP|S|U)$/.test(g)) { transfer = "unarticulated"; g = g.slice(1); }
  g = g.toUpperCase();
  return { grade: g, transfer, raw: original };
}

export function gradeStatus(grade) {
  const g = (grade || "").toUpperCase().trim();
  if (WITHDRAWN.has(g)) return "withdrawn";
  if (PENDING_GRADES.has(g)) return "in-progress";
  if (FAIL_GRADES.has(g)) return "failed";
  if (g in GRADE_POINTS || PASS_GRADES.has(g)) return "completed";
  return "unknown";
}

export function isLetterGrade(grade) {
  return (grade || "").toUpperCase() in GRADE_POINTS;
}

/** Does this grade meet a minimum letter grade? Pass grades never meet a letter-grade minimum. */
export function meetsMinGrade(grade, minGrade, { letterRequired = false } = {}) {
  const g = (grade || "").toUpperCase();
  if (PASS_GRADES.has(g)) return !letterRequired;
  if (!(g in GRADE_POINTS)) return false;
  if (!minGrade) return GRADE_POINTS[g] > 0;
  return GRADE_POINTS[g] >= GRADE_POINTS[minGrade.toUpperCase()];
}

export function gradePoints(grade) {
  const g = (grade || "").toUpperCase();
  return g in GRADE_POINTS ? GRADE_POINTS[g] : null;
}

/** Earns units: completed with a passing grade (D- or better, or P). */
export function earnsUnits(course) {
  if (course.status !== "completed") return false;
  const g = course.grade;
  return PASS_GRADES.has(g) || (g in GRADE_POINTS && GRADE_POINTS[g] > 0);
}

/**
 * Build a course record.
 * origin: "ucsd" | "transfer-articulated" (counts as the UCSD course it maps to)
 *       | "transfer" (another school's own course code; only counts through the transfer table)
 */
export function makeCourse({ term, code, units, grade, title = "", origin = "ucsd", school = null, source = "audit" }) {
  const c = parseCode(code);
  if (!c) return null;
  const t = term ? parseTerm(term) : null;
  const g = parseGrade(grade);
  let o = origin;
  if (g.transfer === "articulated") o = "transfer-articulated";
  if (g.transfer === "unarticulated") o = "transfer";
  const u = units == null || units === "" ? null : Number(units);
  return {
    ...c,
    term: t ? t.term : null,
    termOrder: t ? t.order : null,
    units: Number.isFinite(u) ? u : null,
    grade: g.grade,
    gradeRaw: g.raw,
    status: gradeStatus(g.grade),
    title: (title || "").trim(),
    origin: o,
    school,
    sources: [source],
  };
}

/** Stable identity of an attempt (same course, same term). */
export function attemptKey(c) {
  return `${c.origin === "transfer" ? "T:" : ""}${c.code}|${c.term || "?"}`;
}

/**
 * Merge course lists (audit + pasted history). Same course in the same term = one attempt;
 * the record with more detail wins and sources are combined.
 */
export function mergeCourses(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      if (!c) continue;
      const k = attemptKey(c);
      const prev = byKey.get(k);
      if (!prev) { byKey.set(k, { ...c, sources: [...c.sources] }); continue; }
      const merged = { ...prev };
      for (const f of ["units", "title", "grade", "gradeRaw", "school"]) {
        if ((merged[f] == null || merged[f] === "") && c[f] != null && c[f] !== "") merged[f] = c[f];
      }
      if (prev.status !== "completed" && c.status === "completed") {
        merged.grade = c.grade; merged.gradeRaw = c.gradeRaw; merged.status = c.status;
      }
      merged.sources = [...new Set([...prev.sources, ...c.sources])];
      byKey.set(k, merged);
    }
  }
  // A course with no term that matches a termed attempt of the same course is the same attempt.
  const all = [...byKey.values()];
  const termless = all.filter((c) => !c.term);
  const termed = all.filter((c) => c.term);
  const result = [...termed];
  for (const c of termless) {
    const twin = termed.find((t) => t.code === c.code && t.origin === c.origin);
    if (twin) twin.sources = [...new Set([...twin.sources, ...c.sources])];
    else result.push(c);
  }
  return result.sort((a, b) => (a.termOrder ?? 9999) - (b.termOrder ?? 9999) || a.code.localeCompare(b.code));
}

/**
 * Mark repeated attempts. When a course was taken more than once and an earlier attempt
 * was a D/F/NP, only the best attempt counts (UC repeat policy). Courses passed with
 * C- or better more than once are assumed repeatable for credit and all attempts count.
 */
export function markRepeats(courses) {
  const groups = new Map();
  for (const c of courses) {
    const k = `${c.origin === "transfer" ? "T:" : ""}${c.code}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) {
    for (const c of list) c.repeatOf = null;
    if (list.length < 2) continue;
    const good = list.filter((c) => c.status === "completed" && meetsMinGrade(c.grade, "C-"));
    if (good.length === list.length) continue; // repeatable course, all count
    const rank = (c) => {
      if (c.status === "completed") {
        const p = gradePoints(c.grade);
        return p == null ? (c.grade === "P" ? 2.0 : 0) : p;
      }
      if (c.status === "in-progress") return 1.5; // a retake in progress beats a D
      return -1;
    };
    const best = [...list].sort((a, b) => rank(b) - rank(a) || (b.termOrder ?? 0) - (a.termOrder ?? 0))[0];
    for (const c of list) {
      if (c === best) continue;
      c.repeatOf = best.code + (best.term ? ` (${best.term})` : "");
      c.repeatBestStatus = best.status;
    }
  }
  return courses;
}

export const _internals = { GRADE_POINTS, PASS_GRADES };
