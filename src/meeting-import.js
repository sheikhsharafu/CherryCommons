const URL_HEADERS = ["meeting_url", "meeting_link", "url", "link"];
// Keep accepting headings from older exports.
const NAME_HEADERS = ["name", "table", "table_name", "company", "company_name"];
const CAPTION_HEADERS = ["caption", "description"];

export const MEETING_FILE_TYPES = ".xlsx,.xls,.xlsm,.xlsb,.ods,.json,.csv,.tsv,.txt";
const MAX_ROWS = 500;

function normalizeHeader(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
}

function checkRowCount(count) {
  if (!count) throw new Error("The file has no meeting links.");
  if (count > MAX_ROWS) throw new Error(`Import up to ${MAX_ROWS} rows at a time.`);
}

function parseRecords(text, delimiter) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let recordLine = 1;

  function finishField() {
    fields.push(field.trim());
    field = "";
    closedQuote = false;
  }

  function finishRecord() {
    finishField();
    if (fields.some(Boolean)) records.push({ line: recordLine, fields });
    fields = [];
    recordLine = line + 1;
  }

  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\n") {
      finishRecord();
    } else if (character === '"' && !field.trim() && !closedQuote) {
      field = "";
      quoted = true;
    } else if (character === '"' || (closedQuote && !/\s/.test(character))) {
      throw new Error(`Line ${line}: invalid CSV quoting.`);
    } else {
      field += character;
    }
    if (character === "\n") line++;
  }
  if (quoted) throw new Error(`Line ${recordLine}: missing closing quote.`);
  finishRecord();
  return records;
}

function readMeetingRows(records, spreadsheet = false) {
  if (!records.length) throw new Error("The file is empty.");
  const headers = records[0].fields.map(normalizeHeader);
  const urlColumn = headers.findIndex((header) => URL_HEADERS.includes(header));
  const nameColumn = headers.findIndex((header) => NAME_HEADERS.includes(header));
  const captionColumn = headers.findIndex((header) => CAPTION_HEADERS.includes(header));
  const hasHeaders = urlColumn !== -1;
  const data = hasHeaders ? records.slice(1) : records;
  const first = records[0];
  const firstLinkColumn = spreadsheet
    ? first.fields.findIndex((field, index) => /^https:\/\//i.test(first.links[index] || field))
    : 0;

  if (!hasHeaders && (firstLinkColumn < 0 ||
      !/^https:\/\//i.test(first.links?.[firstLinkColumn] || first.fields[firstLinkColumn]))) {
    throw new Error("Use a meeting_url column or put one HTTPS meeting link on each row.");
  }
  checkRowCount(data.length);

  return data.map(({ line, fields, links }) => {
    const location = `${spreadsheet ? "Row" : "Line"} ${line}`;
    if (!spreadsheet && fields.length !== (hasHeaders ? headers.length : 1)) {
      throw new Error(`${location}: the number of fields does not match the file format.`);
    }
    if (spreadsheet && !hasHeaders && fields.some((field, index) => field && index !== firstLinkColumn)) {
      throw new Error(`${location}: use column headers when the sheet contains other information.`);
    }
    const linkColumn = hasHeaders ? urlColumn : firstLinkColumn;
    const meetingUrl = links?.[linkColumn] || fields[linkColumn];
    if (!meetingUrl) throw new Error(`${location}: a meeting link is required.`);
    return { line, location, name: fields[nameColumn], caption: fields[captionColumn], meetingUrl };
  });
}

export function readMeetingCsv(text, delimiter = ",") {
  return readMeetingRows(parseRecords(text, delimiter));
}

function readMeetingJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The file contains invalid JSON.");
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.tables ?? parsed?.meetings ?? parsed?.links;
  if (!Array.isArray(items)) throw new Error("Use a JSON array of meeting links or table objects.");
  checkRowCount(items.length);
  return items.map((item, index) => {
    const location = `Item ${index + 1}`;
    if (typeof item === "string" && item.trim()) return { location, meetingUrl: item.trim() };
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const fields = new Map(Object.entries(item).map(([key, value]) => [normalizeHeader(key), value]));
      const getText = (aliases) => {
        const value = aliases.map((alias) => fields.get(alias)).find((entry) => entry != null);
        if (value != null && typeof value !== "string") {
          throw new Error(`${location}: ${aliases[0]} must be text.`);
        }
        return value?.trim();
      };
      const meetingUrl = getText(URL_HEADERS);
      if (meetingUrl) return { location, meetingUrl, name: getText(NAME_HEADERS), caption: getText(CAPTION_HEADERS) };
    }
    throw new Error(`${location}: a meeting link is required.`);
  });
}

function readWorkbookInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workbook-worker.js", import.meta.url));
    const finish = (error, rows) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(rows);
    };
    const timeout = setTimeout(() => finish("The workbook took too long to read."), 10000);
    worker.onmessage = ({ data }) => finish(data.error, data.rows);
    worker.onerror = () => finish("Could not open the workbook reader. Reload the site and try again.");
    try {
      worker.postMessage(buffer, [buffer]);
    } catch {
      finish("Could not open the workbook.");
    }
  });
}

export async function readMeetingFile(file) {
  if (file.size > 1024 * 1024) throw new Error("Choose a file no larger than 1 MB.");
  const extension = file.name.toLowerCase().split(".").pop();
  if (!MEETING_FILE_TYPES.split(",").includes(`.${extension}`)) {
    throw new Error("Choose an Excel, ODS, JSON, CSV, TSV, or TXT file.");
  }
  if (extension === "txt") {
    const rows = (await file.text()).replace(/^\uFEFF/, "").split(/\r\n?|\n/).flatMap((line, index) =>
      line.trim() ? [{ location: `Line ${index + 1}`, meetingUrl: line.trim() }] : [],
    );
    checkRowCount(rows.length);
    return rows;
  }
  if (extension === "json") return readMeetingJson(await file.text());
  if (extension === "csv" || extension === "tsv") {
    return readMeetingCsv(await file.text(), extension === "tsv" ? "\t" : ",");
  }
  return readMeetingRows(await readWorkbookInWorker(await file.arrayBuffer()), true);
}
