#!/usr/bin/env node
// Command-line version: same engine as the website, writes a standalone HTML report.
//
//   npm install
//   node tools/re-audit.mjs --audit "My Audit.pdf" --history history.txt --out report.html
//
// Options: --major DS25  --college SIXTH  --variant transfer-general  --school UCSC|none  --json

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pdfToLines } from "../js/pdf-lines.js";
import { runReAudit } from "../js/pipeline.js";
import { renderReport, advisingMessages, STATUS_LABEL } from "../js/report.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.audit && !args.history)) {
  console.log(`Usage: node tools/re-audit.mjs --audit audit.pdf [--history history.txt] [--out report.html]
  --audit     TSS degree audit saved as PDF (or a .txt of its lines)
  --history   text copied from TSS My Academic History
  --out       where to write the HTML report (default: re-audit-report.html)
  --major --college --variant --school   override what's detected
  --json      print the raw result as JSON instead`);
  process.exit(args.help ? 0 : 1);
}

let auditLines = null;
if (args.audit) {
  if (/\.pdf$/i.test(args.audit)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(() => {
      console.error("Run `npm install` first (needs pdfjs-dist).");
      process.exit(1);
    });
    auditLines = await pdfToLines(pdfjs, new Uint8Array(readFileSync(args.audit)));
  } else {
    auditLines = readFileSync(args.audit, "utf8").split("\n");
  }
}
const historyText = args.history ? readFileSync(args.history, "utf8") : "";
const loadJson = async (p) => JSON.parse(readFileSync(join(root, "rules", p), "utf8"));

const out = await runReAudit({
  auditLines, historyText, loadJson,
  overrides: {
    major: args.major, college: args.college, collegeVariant: args.variant,
    school: args.school === "none" ? null : args.school,
  },
});

if (args.json) {
  console.log(JSON.stringify(out.result, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
  process.exit(0);
}

const css = readFileSync(join(root, "css", "style.css"), "utf8");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Re-Audit report</title><style>${css}</style></head><body><main class="wrap" style="padding-top:24px">
${renderReport(out)}
</main></body></html>`;
const dest = args.out || "re-audit-report.html";
writeFileSync(dest, html);

// Short terminal summary
for (const w of out.warnings) console.log(`! ${w}`);
for (const p of out.result.programs) {
  console.log(`\n${p.title}${p.variant ? ` (${p.variant.title})` : ""}`);
  for (const r of p.requirements) console.log(`  ${STATUS_LABEL[r.status].padEnd(13)} ${r.title}  ${r.progress || ""}`);
}
const u = out.result.units;
console.log(`\nUnits: ${u.earned} earned, ${u.projected} with current and planned classes. Upper-division: ${u.ud.earned} earned, ${u.ud.projected} projected.`);
console.log(`${advisingMessages(out).length} advising message(s) drafted. Report written to ${dest}`);

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--json") o.json = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
  }
  return o;
}
