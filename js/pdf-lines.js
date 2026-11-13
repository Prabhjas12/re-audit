// Turn a PDF into text lines with pdf.js. Works in the browser and in Node.
// Chrome-printed audits split text into many tiny pieces, so pieces are regrouped
// into lines by their y position and joined left to right by x position.

/** Group positioned text pieces into lines. items: [{ str, x, y, w }] for one page. */
export function itemsToLines(items, { yTolerance = 2.5 } = {}) {
  const rows = [];
  const sorted = items
    .filter((it) => it.str !== undefined && it.str !== null)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    let row = rows.find((r) => Math.abs(r.y - it.y) <= yTolerance);
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    const its = row.items.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = null;
    for (const it of its) {
      const s = it.str;
      if (s === "") continue;
      if (/^\s+$/.test(s)) {
        // A wide blank separates columns; keep it as a double space.
        out += it.w > 8 ? "  " : " ";
        prevEnd = it.x + it.w;
        continue;
      }
      if (prevEnd !== null && it.x - prevEnd > 1.5 && !/\s$/.test(out)) out += " ";
      out += s;
      prevEnd = it.x + it.w;
    }
    return out.replace(/\s+$/, "");
  }).filter((l) => l.trim() !== "");
}

/** Read every page of a PDF (ArrayBuffer/Uint8Array) into lines using a loaded pdf.js module. */
export async function pdfToLines(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
    lines.push(...itemsToLines(items));
  }
  await doc.destroy();
  return lines;
}
