// Course patterns used in rule files.
//   "DSC 102"      exact course (also matches the online "R" version, DSC 102R)
//   "DSC 100-196"  numeric range, any suffix (DSC 190, DSC 148, DSC 152A ...)
//   "HILD 2A-2C"   letter range on one number (HILD 2A, 2B, 2C)
//   "LTWR *"       every course in a subject
//   "LT* 1-50"     any subject starting with LT, numbers 1-50

import { parseCode } from "./courses.js";

const cache = new Map();

export function compilePattern(p) {
  if (cache.has(p)) return cache.get(p);
  const s = p.toUpperCase().replace(/\s+/g, " ").trim();
  let m;
  let fn = null;
  if ((m = s.match(/^([A-Z]{1,5})(\*?) \*$/))) {
    const [, subj, star] = m;
    fn = (c) => (star ? c.subject.startsWith(subj) : c.subject === subj);
  } else if ((m = s.match(/^([A-Z]{1,5})(\*?) (\d{1,3})([A-Z]{0,3})-(\d{1,3})([A-Z]{0,3})$/))) {
    const [, subj, star, n1, s1, n2, s2] = m;
    const subjOk = (c) => (star ? c.subject.startsWith(subj) : c.subject === subj);
    if (s1 && s2 && n1 === n2) {
      // letter range: HILD 2A-2C, MUS 95C-95W
      const lo = s1, hi = s2, num = Number(n1);
      fn = (c) => subjOk(c) && c.num === num && baseSuffix(c).length === lo.length && baseSuffix(c) >= lo && baseSuffix(c) <= hi;
    } else {
      const lo = Number(n1), hi = Number(n2);
      fn = (c) => subjOk(c) && c.num >= lo && c.num <= hi;
    }
  } else {
    const target = parseCode(s);
    if (target) {
      fn = (c) => c.subject === target.subject && c.num === target.num &&
        (c.suffix === target.suffix || (c.suffix === target.suffix + "R"));
    }
  }
  if (!fn) throw new Error(`Bad course pattern "${p}"`);
  fn.exact = Boolean(parseCode(s)) && !/[*]|\d-\d|[A-Z]-\d/.test(s.replace(/^[A-Z]+\s/, ""));
  cache.set(p, fn);
  return fn;
}

// "DSC 10R" → "" ; "HILD 2AR" → "A" (online versions keep their letter)
function baseSuffix(c) {
  return c.suffix.endsWith("R") && c.suffix.length > 1 ? c.suffix.slice(0, -1) : c.suffix === "R" ? "" : c.suffix;
}

export function matchesAny(course, patterns) {
  if (!patterns || !patterns.length) return false;
  return patterns.some((p) => compilePattern(p)(course));
}

/** True when a course matches only through a range or wildcard ("CSE 100-199"), not a named course. */
export function matchesOnlyBroadly(course, patterns) {
  let broad = false;
  for (const p of patterns || []) {
    const fn = compilePattern(p);
    if (!fn(course)) continue;
    if (fn.exact) return false;
    broad = true;
  }
  return broad;
}

/** Short human list of the first few options: "DSC 148, CSE 158 or CSE 158R". */
export function describeOptions(options, max = 6) {
  const list = (options || []).slice(0, max);
  const more = (options || []).length - list.length;
  if (list.length === 0) return "";
  if (list.length === 1) return list[0] + (more > 0 ? ` (+${more} more)` : "");
  return list.slice(0, -1).join(", ") + " or " + list[list.length - 1] + (more > 0 ? ` (+${more} more)` : "");
}
