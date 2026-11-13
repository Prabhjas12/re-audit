import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseCode, parseTerm, parseGrade, meetsMinGrade, markRepeats, makeCourse, mergeCourses } from "../js/courses.js";
import { compilePattern, matchesAny } from "../js/patterns.js";
import { itemsToLines } from "../js/pdf-lines.js";
import { parseAudit } from "../js/audit-parser.js";
import { parseHistory } from "../js/history-parser.js";
import { runReAudit } from "../js/pipeline.js";
import { advisingMessages } from "../js/report.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const loadJson = async (p) => JSON.parse(read(join("rules", p)));
const sampleAudit = () => read("samples/sample-audit.txt").split("\n");
const sampleHistory = () => read("samples/sample-history.txt");

test("course codes in audit and TSS formats", () => {
  assert.equal(parseCode("MATH-020A").code, "MATH 20A");
  assert.equal(parseCode("CSE- 011").code, "CSE 11");
  assert.equal(parseCode("DSC 10R").code, "DSC 10R");
  assert.equal(parseCode("CSE 13S").num, 13);
  assert.equal(parseCode("not a course"), null);
});

test("terms", () => {
  assert.equal(parseTerm("FA22").term, "FA22");
  assert.equal(parseTerm("Fall Quarter 2024").term, "FA24");
  assert.ok(parseTerm("WI25").order < parseTerm("SP25").order);
  assert.ok(parseTerm("SP25").order < parseTerm("FA25").order);
});

test("transfer grade prefixes", () => {
  assert.deepEqual(parseGrade("TA-"), { grade: "A-", transfer: "articulated", raw: "TA-" });
  assert.deepEqual(parseGrade("tP"), { grade: "P", transfer: "unarticulated", raw: "tP" });
  assert.equal(parseGrade("B+").transfer, null);
});

test("minimum grades", () => {
  assert.ok(meetsMinGrade("C-", "C-", { letterRequired: true }));
  assert.ok(!meetsMinGrade("D", "C-", { letterRequired: true }));
  assert.ok(!meetsMinGrade("P", "C-", { letterRequired: true }));
  assert.ok(meetsMinGrade("P", "D-", { letterRequired: false }));
});

test("patterns", () => {
  const c = (code) => parseCode(code);
  assert.ok(compilePattern("DSC 100-196")(c("DSC 148")));
  assert.ok(!compilePattern("DSC 100-196")(c("DSC 199")));
  assert.ok(compilePattern("HILD 2A-2C")(c("HILD 2B")));
  assert.ok(!compilePattern("HILD 2A-2C")(c("HILD 2D")));
  assert.ok(compilePattern("MUS 95C-95W")(c("MUS 95G")));
  assert.ok(compilePattern("DSC 10")(c("DSC 10R")), "online R version counts");
  assert.ok(!compilePattern("DSC 10")(c("DSC 100")));
  assert.ok(compilePattern("LT* 1-50")(c("LTEN 29")));
  assert.ok(matchesAny(c("LTWR 8A"), ["LTWR *"]));
});

test("pdf text pieces regroup into lines", () => {
  const items = [
    { str: "MA", x: 155, y: 500, w: 14 }, { str: "T", x: 168, y: 500, w: 6 }, { str: "H", x: 174, y: 500, w: 7 },
    { str: "-020", x: 180, y: 500, w: 21 }, { str: "A", x: 201, y: 500, w: 6 }, { str: " ", x: 207, y: 500, w: 120 },
    { str: "5.00", x: 327, y: 500.4, w: 19 },
    { str: "FA", x: 124, y: 500, w: 11 }, { str: "22", x: 134, y: 500, w: 11 }, { str: " ", x: 145, y: 500, w: 9 },
  ];
  const lines = itemsToLines(items);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].replace(/\s+/g, " "), "FA22 MATH-020A 5.00");
});

test("audit parser finds requirements and statuses", () => {
  const a = parseAudit(sampleAudit());
  assert.equal(a.meta.majorCode, "EN31");
  assert.equal(a.meta.collegeName, "SIXTH COLLEGE");
  assert.equal(a.meta.collegeStatus, "GENERAL TRANSFER STATUS");
  assert.equal(a.meta.catalog, "Fall 2026");
  const sixth = a.blocks.find((b) => b.section === "college" && b.requirements.length);
  assert.equal(sixth.requirements.length, 10);
  const elr = sixth.requirements.find((r) => /Experiential/.test(r.title));
  assert.equal(elr.met, false, "an explanatory line must not swallow the NEEDS line");
  const sr = sixth.requirements.find((r) => /Structured Reasoning/.test(r.title));
  assert.equal(sr.met, true);
  const it = sixth.requirements.find((r) => /Information Technology/.test(r.title));
  assert.equal(it.met, false);
  const writ = a.courses.find((c) => c.code === "WRIT 1");
  assert.equal(writ.origin, "transfer");
  const math = a.courses.find((c) => c.code === "MATH 20B");
  assert.equal(math.origin, "transfer-articulated");
  assert.equal(a.unappliedCourses.length, 11);
});

test("history parser reads the TSS paste", () => {
  const h = parseHistory(sampleHistory());
  assert.equal(h.format, "tss-academic-history");
  assert.deepEqual(h.schools.map((s) => s.id), ["UCSC"]);
  assert.deepEqual(h.events, { elwr: true, ahi: true });
  const bild10 = h.courses.find((c) => c.code === "BILD 10");
  assert.equal(bild10.term, "S226", "Summer Session 2 of 2025/2026 is summer 2026");
  const fall = h.courses.find((c) => c.code === "ECON 110B");
  assert.equal(fall.term, "FA26");
  assert.equal(fall.status, "in-progress");
  const mus = h.courses.find((c) => c.code === "MUS 95W");
  assert.equal(mus.passNoPass, true);
});

test("history parser reads a plain list", () => {
  const h = parseHistory("FA24 DSC 10 4 B+\nWinter 2025\nMATH 18 4 A-\nDSC-020 4.00 IP");
  assert.equal(h.format, "list");
  assert.equal(h.courses.length, 3);
  assert.equal(h.courses.find((c) => c.code === "MATH 18").term, "WI25");
  assert.equal(h.courses.find((c) => c.code === "DSC 10").grade, "B+");
});

test("repeats: a retake replaces a D, repeatable classes all count", () => {
  const list = [
    makeCourse({ term: "SP26", code: "DSC 102", units: 4, grade: "D" }),
    makeCourse({ term: "FA26", code: "DSC 102", units: 4, grade: "" }),
    makeCourse({ term: "FA25", code: "MUS 95G", units: 3, grade: "P" }),
    makeCourse({ term: "WI26", code: "MUS 95G", units: 3, grade: "P" }),
  ];
  markRepeats(list);
  assert.ok(list[0].repeatOf);
  assert.equal(list[1].repeatOf, null);
  assert.equal(list[2].repeatOf, null);
  assert.equal(list[3].repeatOf, null);
});

test("merge keeps one record per attempt", () => {
  const a = [makeCourse({ term: "FA24", code: "DSC 10", units: 4, grade: "A", source: "audit" })];
  const b = [makeCourse({ term: "FA24", code: "DSC-010", units: 4, grade: "A", title: "Principles", source: "history" })];
  const m = mergeCourses(a, b);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].sources.sort(), ["audit", "history"]);
  assert.equal(m[0].title, "Principles");
});

test("end to end on the sample student", async () => {
  const out = await runReAudit({ auditLines: sampleAudit(), historyText: sampleHistory(), loadJson });
  const by = (prog, id) => out.result.programs.find((p) => p.id === prog).requirements.find((r) => r.id === id);
  assert.deepEqual(out.warnings, [], "a Fall 2026 audit matches 2026-27 rules");
  assert.equal(by("EN31", "math").status, "DONE");
  assert.equal(by("EN31", "econ-lower").status, "FIX", "a history class satisfies what the audit missed");
  const core = by("EN31", "core");
  assert.equal(core.status, "IN_PROGRESS");
  assert.equal(core.applied.filter((a) => a.course.code === "ECON 110A").length, 1, "the D is replaced by the retake");
  assert.equal(core.applied.find((a) => a.course.code === "ECON 110A").course.term, "FA26");
  assert.equal(by("EN31", "electives").status, "NEED");
  assert.equal(out.result.units.replacedByRetake, 4);
  assert.equal(by("sixth-ge", "tcomp").status, "FIX", "WRIT 2 counts through the transfer table");
  assert.equal(by("sixth-ge", "nahr").status, "PETITION");
  assert.equal(by("sixth-ge", "sa").applied.length, 2);
  assert.equal(new Set(by("sixth-ge", "sa").applied.map((a) => a.course.subject)).size, 2);
  assert.equal(by("sixth-ge", "elr").status, "NEED");
  assert.equal(by("ucsd-university", "dei").status, "FIX");
  assert.equal(by("ucsd-university", "elwr").status, "DONE");
  // UC San Diego CSE 20 and UC Santa Cruz CSE 20 are different courses.
  const ucscCse20 = out.result.courses.find((c) => c.code === "CSE 20" && c.origin === "transfer");
  assert.ok(ucscCse20);
  const msgs = advisingMessages(out);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].body, /LAST 55/);
  assert.match(msgs[0].body, /WRIT 2/);
  assert.doesNotMatch(msgs[0].body, /WRIT 1\b/, "don't ask to apply what the audit already applied");
  assert.doesNotMatch(msgs.map((m) => m.body).join(" "), /000000000/, "messages never include the student number");
});

test("audit alone still works, with a warning", async () => {
  const out = await runReAudit({ auditLines: sampleAudit(), historyText: "", loadJson });
  assert.ok(out.warnings.some((w) => /academic history/i.test(w)));
});

test("unknown major is reported, not guessed", async () => {
  const lines = sampleAudit().map((l) => l.replace("(EN31) ECONOMICS - BS", "(XX99) UNDERWATER ROBOTICS - BS").replace("SIECONBS004", "SIXXXBS099"));
  const out = await runReAudit({ auditLines: lines, historyText: sampleHistory(), loadJson });
  assert.equal(out.selected.major, null);
  assert.ok(out.warnings.some((w) => /XX99/.test(w)));
});
