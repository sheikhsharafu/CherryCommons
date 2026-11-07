/* global XLSX */
importScripts("../vendor/sheetjs/xlsx.full.min.js");

self.onmessage = ({ data }) => {
  try {
    const workbook = XLSX.read(new Uint8Array(data), { type: "array", sheets: 0, cellFormula: true, sheetStubs: true, cellHTML: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("The workbook has no worksheets.");

    const records = new Map();
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      // Read literal links without evaluating formulas.
      const formula = cell.f?.match(/^HYPERLINK\(\s*"((?:""|[^"])*)"\s*[,;)]/i);
      const link = (cell.l?.Target || formula?.[1]?.replace(/""/g, '"') || "").trim();
      const value = cell.t === "z" ? "" : String(cell.v ?? "").trim();
      if (!link && !value) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      if (!records.has(r)) {
        if (records.size >= 501) throw new Error("Import up to 500 rows at a time.");
        records.set(r, { line: r + 1, fields: [], links: [] });
      }
      const record = records.get(r);
      record.fields[c] = value;
      record.links[c] = link;
    }
    self.postMessage({ rows: [...records.values()].sort((first, second) => first.line - second.line) });
  } catch (error) {
    self.postMessage({ error: error.message || "Could not read the first worksheet." });
  }
};
