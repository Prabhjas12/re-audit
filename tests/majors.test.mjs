// Each major: a made-up student who finished everything comes out all Done,
// and an empty record comes out all Still needed. Catches typos in the course lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runReAudit } from "../js/pipeline.js";
import { parseAudit } from "../js/audit-parser.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loadJson = async (p) => JSON.parse(readFileSync(join(root, "rules", p), "utf8"));
const asHistory = (codes, term = "FA24", grade = "A") => codes.map((c) => `${term} ${c} 4 ${grade}`).join("\n");

const COMPLETE = {
  CS26: ["CSE 11", "CSE 12", "CSE 15L", "CSE 20", "CSE 21", "CSE 30", "CSE 8A", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 18",
         "PHYS 2A", "BILD 1", "CSE 103", "CSE 100", "CSE 101", "CSE 110", "CSE 120", "CSE 123", "CSE 124", "CSE 105", "CSE 106",
         "CSE 130", "CSE 151A", "CSE 158", "CSE 167", "CSE 140", "CSE 141", "CSE 150A", "CSE 152A", "CSE 156", "CSE 127"],
  MA30: ["MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 20E", "CSE 11", "CSE 15L", "CSE 12", "MATH 109",
         "MATH 103A", "MATH 103B", "CSE 105", "CSE 100", "CSE 101", "MATH 180A", "MATH 184", "MATH 170A", "MATH 171A",
         "CSE 110", "MATH 187A", "CSE 120", "MATH 102"],
  CG35: ["MATH 20A", "MATH 20B", "MATH 18", "COGS 1", "COGS 10", "COGS 13", "COGS 14A", "COGS 14B", "COGS 17", "COGS 18",
         "COGS 100", "COGS 101A", "COGS 101B", "COGS 107A", "COGS 107B", "COGS 109", "COGS 118A", "COGS 118B",
         "COGS 180", "COGS 181", "COGS 185", "COGS 188"],
  EN25: ["MATH 20A", "MATH 20B", "MATH 20C", "ECON 1", "ECON 3", "ECON 100A", "ECON 100B", "ECON 110A", "ECON 110B",
         "ECON 120A", "ECON 120B", "ECON 120C", "ECON 100C", "ECON 101", "ECON 102", "ECON 109", "ECON 130"],
  BI35: ["BILD 1", "BILD 2", "BILD 3", "BILD 4", "BILD 5", "CHEM 6A", "CHEM 6B", "CHEM 6C", "CHEM 7L", "CHEM 40A", "CHEM 40B",
         "MATH 20A", "MATH 20B", "MATH 11", "PHYS 2A", "PHYS 2B", "PHYS 2C", "PHYS 2BL", "BIBC 102", "BICD 100", "BICD 110",
         "BIMM 100", "BIPN 100", "BIPN 102", "BIMM 110", "BICD 140", "BIMM 101", "BIMM 120", "BIPN 106"],
  DS25: ["MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "COGS 9", "DSC 10", "DSC 20", "DSC 30", "DSC 40A", "DSC 40B", "DSC 80",
         "BILD 1", "BILD 3", "MATH 189", "DSC 100", "DSC 102", "DSC 106", "DSC 140A", "DSC 140B", "DSC 148", "MATH 183",
         "DSC 180A", "DSC 180B", "DSC 190", "COGS 108", "COGS 118C", "CSE 158", "DSC 170"],
  CS25: ["CSE 11", "CSE 12", "CSE 29", "CSE 30", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 18", "PHYS 2A", "PHYS 2B", "PHYS 2C",
         "ECE 109", "ECE 35", "ECE 45", "CSE 140", "CSE 141", "ECE 101", "ECE 108", "ECE 111", "CSE 145",
         "CSE 100", "CSE 101", "CSE 105", "CSE 110", "CSE 120", "CSE 123", "CSE 151A", "ECE 102", "ECE 103", "ECE 140A"],
  EC27: ["ECE 5", "ECE 25", "ECE 30", "ECE 35", "ECE 45", "ECE 65", "ECE 15", "MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 20E",
         "PHYS 2A", "PHYS 2B", "PHYS 2C", "ECE 100", "ECE 101", "ECE 107", "ECE 109", "ECE 171A", "ECE 174", "ECE 175A", "ECE 175B", "ECE 115"],
  MC27: ["MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 20E", "PHYS 2A", "PHYS 2B", "PHYS 2C", "CHEM 6A",
         "MAE 3", "MAE 8", "MAE 11", "MAE 20", "MAE 30A", "MAE 30B", "MAE 40", "MAE 101A", "MAE 101B", "MAE 101C", "MAE 105", "MAE 107", "MAE 131A",
         "MAE 160", "MAE 143A", "MAE 143B", "MAE 150", "MAE 156A", "MAE 156B", "MAE 170", "MAE 171A", "MAE 104", "MAE 110", "MAE 113", "MAE 118", "MAE 180A"],
  MA27: ["MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 20E", "CSE 11", "MATH 109", "MATH 102", "MATH 140A", "MATH 140B",
         "MATH 180A", "MATH 110", "MATH 130", "MATH 171A", "MATH 171B", "MATH 100A", "MATH 100B", "MATH 103A", "MATH 154"],
  MA35: ["MATH 18", "MATH 20A", "MATH 20B", "MATH 20C", "MATH 20D", "MATH 20E", "CSE 11", "MATH 109", "MATH 102", "MATH 140A", "MATH 140B",
         "MATH 180A", "MATH 180B", "MATH 180C", "MATH 181A", "MATH 181B", "MATH 189", "MATH 181E", "MATH 100A", "MATH 170A", "MATH 184"],
  BI31: ["BILD 1", "BILD 2", "BILD 3", "BILD 4", "BILD 5", "CHEM 6A", "CHEM 6B", "CHEM 6C", "CHEM 7L", "CHEM 40A", "CHEM 40B", "MATH 20A", "MATH 20B",
         "MATH 11", "PHYS 2A", "PHYS 2B", "PHYS 2C", "PHYS 2BL", "BIBC 102", "BICD 100", "BIEB 102", "BIMM 100", "BIPN 100",
         "BICD 110", "BIMM 110", "BIPN 102", "BIEB 150", "BIBC 120"],
  BI37: ["BILD 1", "BILD 3", "BILD 4", "BILD 5", "CHEM 6A", "CHEM 6B", "CHEM 6C", "CHEM 7L", "CHEM 40A", "CHEM 40B", "MATH 20A", "MATH 20B",
         "MATH 11", "PHYS 2A", "PHYS 2B", "PHYS 2C", "PHYS 2BL", "BIBC 100", "BIBC 102", "BICD 100", "BICD 110", "BIMM 100",
         "BIMM 110", "BIMM 114", "BICD 130", "BIMM 101", "BIMM 120", "BIPN 100"],
  BI38: ["BILD 1", "BILD 2", "BILD 3", "BILD 4", "BILD 5", "CHEM 6A", "CHEM 6B", "CHEM 6C", "CHEM 7L", "CHEM 40A", "CHEM 40B", "MATH 20A", "MATH 20B",
         "MATH 11", "PHYS 2A", "PHYS 2B", "PHYS 2C", "PHYS 2BL", "BIBC 102", "BICD 100", "BIMM 100", "BIPN 100", "BIPN 140",
         "BIPN 142", "BIPN 144", "BIPN 146", "BIPN 145", "BIPN 102", "BIMM 110"],
  CG33: ["MATH 20A", "MATH 20B", "MATH 18", "COGS 1", "COGS 10", "COGS 13", "COGS 14A", "COGS 14B", "COGS 17", "COGS 18", "COGS 100", "COGS 101A",
         "COGS 101B", "COGS 107A", "COGS 107B", "COGS 108", "COGS 120", "COGS 121", "COGS 123", "COGS 125", "COGS 127", "COGS 187A"],
  CG25: ["MATH 10A", "MATH 10B", "MATH 10C", "COGS 1", "DSGN 1", "COGS 13", "COGS 14A", "COGS 17", "COGS 18", "COGS 100", "COGS 101A", "COGS 101B",
         "COGS 107A", "COGS 107B", "COGS 108", "COGS 109", "COGS 120", "COGS 121", "COGS 123", "COGS 150", "COGS 180"],
  PC25: ["BILD 1", "CHEM 6A", "MATH 18", "CSE 11", "PSYC 60", "PSYC 70", "PSYC 100", "PSYC 101", "PSYC 102", "PSYC 104",
         "PSYC 105", "PSYC 106", "PSYC 108", "PSYC 110", "PSYC 122", "PSYC 124", "PSYC 130", "PSYC 140"],
  PC35: ["BILD 1", "BILD 3", "CHEM 6A", "MATH 20A", "PHIL 10", "CSE 11", "PSYC 60", "PSYC 70", "MGT 16", "MGT 18", "MGT 52", "MGT 153",
         "PSYC 104", "PSYC 105", "PSYC 100", "PSYC 101", "MGT 100", "MGT 160", "MGT 164", "PSYC 148", "PSYC 137", "PSYC 143", "PSYC 110"],
  EN30: ["MATH 20A", "MATH 20B", "MATH 20C", "ECON 1", "ECON 3", "ECON 5", "MGT 16", "MGT 71", "MGT 45", "ECON 100A", "ECON 100B", "ECON 110B",
         "ECON 120A", "ECON 120B", "MGT 100", "MGT 160", "MGT 162", "MGT 164", "MGT 180", "ECON 101", "MGT 103", "ECON 109"],
  EN31: ["MATH 20A", "MATH 20B", "MATH 20C", "ECON 1", "ECON 3", "ECON 5", "ECON 100A", "ECON 100B", "ECON 100C", "ECON 110A", "ECON 110B",
         "ECON 120A", "ECON 120B", "ECON 120C", "ECON 101", "ECON 109", "ECON 130", "ECON 131", "ECON 138"],
  PS25: ["POLI 10", "POLI 11", "POLI 12", "POLI 30", "POLI 100A", "POLI 100B", "POLI 102C", "POLI 104A", "POLI 110A", "POLI 112A", "POLI 120A",
         "POLI 130B", "POLI 140A", "POLI 142A", "POLI 150A", "POLI 160AA"],
  CM26: ["COMM 10", "COMM 100A", "COMM 100B", "COMM 100C", "COMM 190", "COMM 120", "COMM 124", "COMM 101", "COMM 102C", "COMM 103D",
         "COMM 106I", "COMM 110T", "COMM 140"],
  SO25: ["SOCI 1", "SOCI 2", "SOCI 60", "SOCI 10", "SOCI 100", "SOCI 103M", "SOCI 111", "SOCI 113", "SOCI 117", "SOCI 118", "SOCI 120T",
         "SOCI 125", "SOCI 126", "SOCI 127", "SOCI 130", "SOCI 136"],
};

for (const [code, courses] of Object.entries(COMPLETE)) {
  test(`${code}: a complete record satisfies every major requirement`, async () => {
    const out = await runReAudit({ historyText: asHistory(courses), loadJson, overrides: { major: code } });
    const major = out.result.programs.find((p) => p.kind === "major");
    assert.ok(major, "major rules loaded");
    // "manual" requirements (labs, ECE technical electives) can't be checked from a course list.
    const open = major.requirements.filter((r) => r.type !== "manual" && r.status !== "DONE").map((r) => `${r.id} (${r.progress})`);
    assert.deepEqual(open, [], `still open: ${open.join(", ")}`);
  });
  test(`${code}: an empty record needs everything`, async () => {
    const out = await runReAudit({ historyText: "FA24 PHYS 99 4 A", loadJson, overrides: { major: code } });
    const major = out.result.programs.find((p) => p.kind === "major");
    assert.ok(major.requirements.every((r) => r.status === "NEED"));
  });
}

test("CS26: a multi-tag course (CSE 140) is placed where it helps", async () => {
  // Without CSE 124, 127 and 141, Systems can only reach 12 units with CSE 140; Theory has enough without it.
  const courses = COMPLETE.CS26.filter((c) => !["CSE 124", "CSE 141", "CSE 127"].includes(c));
  const out = await runReAudit({ historyText: asHistory(courses), loadJson, overrides: { major: "CS26" } });
  const major = out.result.programs.find((p) => p.kind === "major");
  const systems = major.requirements.find((r) => r.id === "systems");
  assert.equal(systems.status, "DONE");
  assert.ok(systems.applied.some((a) => a.course.code === "CSE 140"));
});

test("BI35: physiology/disease needs one of each group", async () => {
  const courses = COMPLETE.BI35.filter((c) => c !== "BIMM 110").concat(["BIPN 108"]); // three physiology, no disease
  const out = await runReAudit({ historyText: asHistory(courses), loadJson, overrides: { major: "BI35" } });
  const r = out.result.programs.find((p) => p.kind === "major").requirements.find((x) => x.id === "physiology-disease");
  assert.equal(r.status, "NEED");
  assert.match(r.missing.map((m) => m.text).join(" "), /BIMM 110|BICD 136/);
});

test("a major is recognized from the TSS program code when the heading has no old code", async () => {
  const lines = readFileSync(join(root, "samples/sample-audit.txt"), "utf8").split("\n")
    .map((l) => l.replace("TSS Program SIECONBS004", "TSS Program SICSEBS002").replace("(EN31) ECONOMICS - BS", "COMPUTER SCIENCE - BS"));
  const out = await runReAudit({ auditLines: lines, historyText: "", loadJson });
  assert.equal(out.selected.major.code, "CS26");
});

test("audit COURSES lists are read into course codes", () => {
  const a = parseAudit(readFileSync(join(root, "samples/sample-audit.txt"), "utf8").split("\n"));
  const lower = a.blocks.flatMap((b) => b.requirements).find((r) => /Economics Lower Division/.test(r.title));
  assert.deepEqual(lower.listedCodes.sort(), ["ECON 5", "POLI 5"]);
  const core = a.blocks.flatMap((b) => b.requirements).find((r) => r.title === "Core");
  for (const c of ["ECON 100A", "ECON 110B", "ECON 120B", "ECON 120C"]) assert.ok(core.listedCodes.includes(c), c);
});
