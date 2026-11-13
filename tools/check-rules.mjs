#!/usr/bin/env node
// Validate every rule file: required fields, unique ids, patterns that compile,
// variants that point at real requirements, transfer entries that point at real programs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compilePattern } from "../js/patterns.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

const index = load("index.json");
const programFiles = [index.university, ...index.majors.map((m) => m.file), ...index.colleges.map((c) => c.file)];
const programs = new Map();

for (const file of programFiles) {
  let p;
  try { p = load(file); } catch (e) { err(file, `can't read: ${e.message}`); continue; }
  programs.set(p.id, p);
  for (const f of ["id", "kind", "title", "groups", "policy"]) if (p[f] == null) err(file, `missing "${f}"`);
  if (!p.sources || !p.sources.length) err(file, "add at least one source");
  const ids = new Set();
  for (const g of p.groups || []) for (const r of g.requirements || []) {
    if (!r.id) err(file, `requirement without id in "${g.title}"`);
    if (ids.has(r.id)) err(file, `duplicate requirement id "${r.id}"`);
    ids.add(r.id);
    const kinds = ["slots", "count", "units", "oneOf", "auditOnly", "manual"].filter((k) => r[k] != null);
    if (kinds.length !== 1 && !(kinds.includes("count") && r.distinctSubjects !== undefined && kinds.length === 1)) {
      if (kinds.length !== 1) err(file, `requirement "${r.id}" needs exactly one of slots/count/units/oneOf/auditOnly/manual (has ${kinds.join(", ") || "none"})`);
    }
    if ((r.count || r.units) && !r.options && !r.transferTitleMatch) err(file, `requirement "${r.id}" needs "options"`);
    const pats = [
      ...(r.options || []), ...(r.except || []), ...(r.suggest || []),
      ...(r.slots || []).flat(), ...(r.oneOf || []).flatMap((o) => o.slots.flat()),
    ];
    for (const pat of pats) { try { compilePattern(pat); } catch (e) { err(file, `requirement "${r.id}": ${e.message}`); } }
    if (r.audit) { try { new RegExp(r.audit); } catch { err(file, `requirement "${r.id}": bad audit regex`); } }
  }
  for (const [key, v] of Object.entries(p.variants || {})) {
    for (const id of v.requirements) if (!ids.has(id)) err(file, `variant "${key}" lists unknown requirement "${id}"`);
  }
}

for (const t of index.transfer) {
  let tbl;
  try { tbl = load(t.file); } catch (e) { err(t.file, `can't read: ${e.message}`); continue; }
  if (tbl.school !== t.school) err(t.file, `school "${tbl.school}" doesn't match index "${t.school}"`);
  for (const c of tbl.courses || []) {
    if (!c.code || !c.counts) err(t.file, `entry needs "code" and "counts"`);
    for (const x of c.counts || []) {
      const prog = programs.get(x.program);
      if (!prog) { err(t.file, `${c.code}: unknown program "${x.program}"`); continue; }
      const found = prog.groups.some((g) => g.requirements.some((r) => r.id === x.requirement));
      if (!found) err(t.file, `${c.code}: "${x.program}" has no requirement "${x.requirement}"`);
      if (!["likely", "petition"].includes(x.confidence)) err(t.file, `${c.code}: confidence must be "likely" or "petition"`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${programFiles.length} program files and ${index.transfer.length} transfer table(s) look good`);
