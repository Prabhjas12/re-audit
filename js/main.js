// Browser glue. Nothing here sends data anywhere: the page only fetches its own rule files.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.js";
import { pdfToLines } from "./pdf-lines.js";
import { parseHistory } from "./history-parser.js";
import { runReAudit } from "./pipeline.js";
import { renderReport } from "./report.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const rulesBase = new URL("../rules/", import.meta.url);
const loadJson = async (path) => {
  const r = await fetch(new URL(path, rulesBase));
  if (!r.ok) throw new Error(`Couldn't load rules/${path}`);
  return r.json();
};

const state = { auditLines: null, auditName: null };

// ---------- settings lists
(async function fillSettings() {
  try {
    const index = await loadJson("index.json");
    for (const m of index.majors) $("optMajor").append(new Option(`${m.title} (${m.code})`, m.code));
    for (const c of index.colleges) $("optCollege").append(new Option(c.title, c.name));
    for (const t of index.transfer) $("optSchool").append(new Option(t.name, t.school));
  } catch (e) {
    showError("The rule files didn't load. If you opened index.html straight from your disk, run a local server instead (see the README).");
  }
})();

// ---------- audit PDF
const drop = $("drop");
$("auditFile").addEventListener("change", (e) => e.target.files[0] && readPdf(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readPdf(f); });

async function readPdf(file) {
  hideError();
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return showError("That isn't a PDF. Save your audit from TSS as a PDF first.");
  $("dropLabel").textContent = "Reading…";
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    state.auditLines = await pdfToLines(pdfjsLib, buf);
    state.auditName = file.name;
    const looksRight = state.auditLines.some((l) => /REQUIREMENTS <<|Audit Results|TSS Program/i.test(l));
    drop.classList.add("ready");
    $("dropLabel").textContent = file.name;
    $("dropSub").textContent = looksRight ? "Audit loaded ✓" : "Loaded, but this doesn't look like a TSS audit";
  } catch (err) {
    state.auditLines = null;
    drop.classList.remove("ready");
    $("dropLabel").textContent = "Drop the PDF here or choose a file";
    showError("Couldn't read that PDF. Try saving the audit again with Print → Save as PDF.");
  }
}

// ---------- history paste preview
let previewTimer;
$("history").addEventListener("input", () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const text = $("history").value;
    if (!text.trim()) { $("historyStatus").textContent = ""; return; }
    const h = parseHistory(text);
    const terms = new Set(h.courses.map((c) => c.term).filter(Boolean));
    $("historyStatus").textContent = h.courses.length
      ? `Found ${h.courses.length} class${h.courses.length === 1 ? "" : "es"} across ${terms.size} term${terms.size === 1 ? "" : "s"}${h.schools.length ? ` · transfer from ${h.schools.map((s) => s.name).join(", ")}` : ""}`
      : "No classes found yet. Paste the whole page.";
  }, 250);
});

// ---------- run
$("run").addEventListener("click", run);
async function run() {
  hideError();
  const btn = $("run");
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const school = $("optSchool").value;
    const out = await runReAudit({
      auditLines: state.auditLines,
      historyText: $("history").value,
      loadJson,
      overrides: {
        major: $("optMajor").value || undefined,
        college: $("optCollege").value || undefined,
        collegeVariant: $("optVariant").value || undefined,
        school: school === "__none" ? null : school || undefined,
      },
    });
    $("results").innerHTML = renderReport(out);
    $("actions").hidden = false;
    $("detected").textContent = `(${[out.selected.major?.code, out.selected.college?.title.replace(/ General Education$/, ""), out.selected.college?.variant?.title, out.selected.school?.name].filter(Boolean).join(" · ") || "nothing detected"})`;
    wireCopy();
    $("actions").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    btn.disabled = false; btn.textContent = "Check my audit";
  }
}

function wireCopy() {
  for (const b of document.querySelectorAll("button.copy")) {
    b.addEventListener("click", async () => {
      const text = document.getElementById(b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch { selectText(b.dataset.copy); }
      b.textContent = "Copied ✓"; b.classList.add("copied");
      setTimeout(() => { b.textContent = "Copy message"; b.classList.remove("copied"); }, 1800);
    });
  }
}
function selectText(id) {
  const r = document.createRange(); r.selectNodeContents(document.getElementById(id));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

// ---------- sample data
$("sample").addEventListener("click", async () => {
  hideError();
  const [auditText, historyText] = await Promise.all([
    fetch(new URL("../samples/sample-audit.txt", import.meta.url)).then((r) => r.text()),
    fetch(new URL("../samples/sample-history.txt", import.meta.url)).then((r) => r.text()),
  ]);
  state.auditLines = auditText.split("\n");
  state.auditName = "sample-audit.pdf";
  drop.classList.add("ready");
  $("dropLabel").textContent = "Sample audit (made-up student)";
  $("dropSub").textContent = "Audit loaded ✓";
  $("history").value = historyText;
  $("history").dispatchEvent(new Event("input"));
  run();
});

// ---------- print / reset
// Some embedded viewers block the print dialog; offer the command-line report instead.
const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
if (framed) {
  $("print").hidden = true;
  $("actions").insertAdjacentHTML("afterbegin", `<span class="muted" style="font-size:13px">To print, open this page in its own tab or use the hosted copy from the README.</span>`);
}
$("print").addEventListener("click", () => window.print());
$("reset").addEventListener("click", () => {
  state.auditLines = null; state.auditName = null;
  $("auditFile").value = ""; $("history").value = ""; $("historyStatus").textContent = "";
  drop.classList.remove("ready");
  $("dropLabel").innerHTML = "Drop the PDF here or <u>choose a file</u>";
  $("dropSub").textContent = "Stays on your computer";
  $("results").innerHTML = ""; $("actions").hidden = true;
  for (const id of ["optMajor", "optCollege", "optVariant", "optSchool"]) $(id).value = "";
  $("detected").textContent = "(detected automatically)";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }
function hideError() { $("error").hidden = true; }
