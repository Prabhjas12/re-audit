// Read a course list pasted from TSS "My Academic History" (select all + copy),
// or any simple list with one course per line, e.g. "FA24 DSC 10 4 B-".

import { makeCourse, parseTerm, findTerm, mergeCourses } from "./courses.js";

// "2025/2026 Spring Quarter", "2024/2025 Summer Session 2", "2023/2024 Special Summer Sess"
const TSS_TERM = /^(\d{4})\/(\d{4}) (Fall Quarter|Winter Quarter|Spring Quarter|Summer Session 1|Summer Session 2|Summer Session 3|Summer Session|Special Summer Sess(?:ion)?)\s*$/i;
const TSS_ROW = /^([A-Z]{2,5})-(\d{1,3}[A-Z]{0,3})(?:\t|\s{2,}| )(.*)$/;
const GRADE_TOKEN = /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|NP|S|U|W|I|IP|NR|RD)$/;

const KNOWN_SCHOOLS = [
  { re: /UC Santa Cruz|Univ(ersity)? of California,? Santa Cruz|\bUCSC\b/i, id: "UCSC", name: "UC Santa Cruz" },
  { re: /UC Berkeley|Univ(ersity)? of California,? Berkeley/i, id: "UCB", name: "UC Berkeley" },
  { re: /UC Davis|Univ(ersity)? of California,? Davis/i, id: "UCD", name: "UC Davis" },
  { re: /UC Irvine|Univ(ersity)? of California,? Irvine/i, id: "UCI", name: "UC Irvine" },
  { re: /UCLA|UC Los Angeles/i, id: "UCLA", name: "UCLA" },
  { re: /UC Merced/i, id: "UCM", name: "UC Merced" },
  { re: /UC Riverside/i, id: "UCR", name: "UC Riverside" },
  { re: /UC Santa Barbara/i, id: "UCSB", name: "UC Santa Barbara" },
];

function tssTerm(m) {
  const startYear = Number(m[1]);
  const endYear = Number(m[2]);
  const kind = m[3].toLowerCase();
  if (kind.startsWith("fall")) return parseTerm(`FA${startYear}`);
  if (kind.startsWith("winter")) return parseTerm(`WI${endYear}`);
  if (kind.startsWith("spring")) return parseTerm(`SP${endYear}`);
  if (kind.endsWith("1")) return parseTerm(`S1${endYear}`);
  if (kind.endsWith("2")) return parseTerm(`S2${endYear}`);
  if (kind.endsWith("3")) return parseTerm(`S3${endYear}`);
  return parseTerm(`SU${endYear}`);
}

/**
 * Returns { courses, schools, events, format, warnings }.
 * events: university requirements TSS reports as satisfied (ELWR, AHI).
 */
export function parseHistory(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const schools = [];
  const events = { elwr: false, ahi: false };
  const warnings = [];
  for (const l of lines) {
    for (const s of KNOWN_SCHOOLS) if (s.re.test(l) && !schools.some((x) => x.id === s.id)) schools.push({ id: s.id, name: s.name });
    if (/ENTRLVL WRITNG REQT SA|ENTRY LEVEL WRITING.*SATISF/i.test(l)) events.elwr = true;
    if (/AMER HIST& ?INST REQT SAT|AMERICAN HISTORY.*SATISF/i.test(l)) events.ahi = true;
  }

  const tss = lines.some((l) => TSS_TERM.test(l.trim()));
  const courses = tss ? parseTssHistory(lines, warnings) : parseLooseList(lines, warnings);
  return { courses: mergeCourses(courses), schools, events, format: tss ? "tss-academic-history" : "list", warnings };
}

function parseTssHistory(lines, warnings) {
  const out = [];
  let term = null;
  let started = false; // ignore the "Bookings" panel above Academic History
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    let m;
    if ((m = l.match(TSS_TERM))) { term = tssTerm(m); started = true; continue; }
    if (/^(Cumulative Summary|External Work|Admissions|Degrees Awarded|Academic Events)\b/i.test(l)) { term = null; continue; }
    if (!started || !term) continue;
    if ((m = lines[i].replace(/\s+$/, "").match(TSS_ROW))) {
      const subj = m[1];
      const num = m[2];
      const title = m[3].replace(/\t/g, " ").trim();
      // Look ahead for units, then the grading option line.
      let units = null;
      let grade = "";
      let gradingOption = "";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const t = lines[j].trim();
        if (TSS_ROW.test(lines[j]) || TSS_TERM.test(t)) break;
        if (units == null && /^\d+(\.\d+)?$/.test(t)) { units = Number(t); continue; }
        if (/Grade|Pass\/No Pass|Satisfactory|Audit/i.test(t)) {
          const parts = lines[j].split("\t").map((x) => x.trim());
          gradingOption = parts[0] || "";
          const g = parts.slice(1).find((x) => GRADE_TOKEN.test(x));
          if (g) grade = g;
          else {
            const sp = t.replace(gradingOption, "").trim().split(/\s+/)[0] || "";
            if (GRADE_TOKEN.test(sp)) grade = sp;
          }
          break;
        }
      }
      const c = makeCourse({ term: term.term, code: `${subj} ${num}`, units, grade, title, origin: "ucsd", source: "history" });
      if (c) {
        c.gradingOption = gradingOption.replace(/^CNV - /, "");
        c.passNoPass = /Pass\/No Pass|Satisfactory/i.test(gradingOption);
        out.push(c);
      } else warnings.push(`Couldn't read course "${l}"`);
    }
  }
  return out;
}

// Generic: any line holding a course code, optionally with a term, units and grade.
function parseLooseList(lines, warnings) {
  const out = [];
  let carryTerm = null;
  for (const raw of lines) {
    const l = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    if (!l) continue;
    const onlyTerm = parseTerm(l);
    if (onlyTerm) { carryTerm = onlyTerm; continue; }
    // Take the term out first so "FA24" isn't read as a course code.
    const t = findTerm(l);
    const noTerm = t ? l.slice(0, t.index) + " " + l.slice(t.index + t.length) : l;
    const cm = noTerm.match(/\b(?!(?:FA|WI|SP|SU|S1|S2|S3)\b)([A-Z]{2,5}) ?-? ?(\d{1,3}[A-Z]{0,3})\b/);
    if (!cm) continue;
    const rest = noTerm.slice(0, cm.index) + " " + noTerm.slice(cm.index + cm[0].length);
    const tokens = rest.split(/\s+/).filter(Boolean);
    const unitsTok = tokens.find((x) => /^\d{1,2}(\.\d+)?$/.test(x) && Number(x) <= 12);
    const gradeTok = [...tokens].reverse().find((x) => GRADE_TOKEN.test(x.toUpperCase()) && x.length <= 2);
    const c = makeCourse({
      term: t ? t.term : carryTerm ? carryTerm.term : null,
      code: `${cm[1]} ${cm[2]}`,
      units: unitsTok ?? null,
      grade: gradeTok ? gradeTok.toUpperCase() : "",
      origin: "ucsd",
      source: "history",
    });
    if (c) out.push(c);
    else warnings.push(`Couldn't read "${l}"`);
  }
  return out;
}

