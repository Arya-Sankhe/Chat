/* Exact spreadsheet access over the rows the worker stored.

   Rows live as tab-separated lines with their real row numbers (see library.js), so a range
   read returns cells exactly as stored, and a query computes totals, filters and groups in
   code instead of asking the model to add up hundreds of rows by eye. */

import { HttpError } from "../http/responses.js";
import { sheetRowLines } from "./library.js";

function clean(value) {
  return String(value ?? "").trim();
}

export function columnNumber(letters) {
  return [...clean(letters).toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

export function columnLetter(index) {
  let letters = "";
  let value = Number(index);
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/** "A1:D20", "B7", "5:120" (rows) or "A:D" (columns). Null when empty; throws when malformed. */
export function parseCellRange(value) {
  const text = clean(value).toUpperCase().replace(/\$/g, "");
  if (!text) return null;
  const cell = /^([A-Z]{1,3})?(\d+)?$/;
  const [from, to = from] = text.split(":");
  const a = from.match(cell);
  const b = to.match(cell);
  if (!a || !b || (!a[1] && !a[2]) || (!b[1] && !b[2])) {
    throw new HttpError(400, "cell_range must look like A1:D20, B7, 5:120 or A:D.");
  }
  const range = {
    startColumn: a[1] ? columnNumber(a[1]) : 1,
    endColumn: b[1] ? columnNumber(b[1]) : Number.POSITIVE_INFINITY,
    startRow: a[2] ? Number(a[2]) : 1,
    endRow: b[2] ? Number(b[2]) : Number.POSITIVE_INFINITY
  };
  if (range.startColumn > range.endColumn || range.startRow > range.endRow) {
    throw new HttpError(400, "cell_range must run from top-left to bottom-right.");
  }
  return range;
}

export function sheetNames(units) {
  return [...new Set(units.map((unit) => unit.sheet).filter(Boolean))];
}

export function resolveSheet(units, sheet) {
  const names = sheetNames(units);
  const wanted = clean(sheet);
  if (!wanted) return names.length === 1 ? names[0] : "";
  const exact = names.find((name) => name === wanted)
    || names.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (!exact) throw new HttpError(400, `Sheet "${wanted}" was not found. Sheets: ${names.join(", ") || "none"}.`);
  return exact;
}

/** Rows of one sheet (or every sheet) inside a range, cells split. */
export function sheetRows(units, { sheet = "", range = null } = {}) {
  const rows = [];
  for (const unit of units) {
    if (sheet && unit.sheet !== sheet) continue;
    if (range && unit.rowEnd && unit.rowStart && (unit.rowEnd < range.startRow || unit.rowStart > range.endRow)) continue;
    const lines = sheetRowLines(unit);
    if (!lines) continue;
    for (const { row, line } of lines) {
      if (range && (row < range.startRow || row > range.endRow)) continue;
      let cells = line.split("\t");
      if (range) {
        const end = Number.isFinite(range.endColumn) ? range.endColumn : cells.length;
        cells = cells.slice(range.startColumn - 1, end);
      }
      rows.push({ sheet: unit.sheet, row, cells });
    }
  }
  return rows;
}

/** The value a cell holds: the computed result for a stored `=FORMULA => value`. */
export function cellValue(cell) {
  const text = String(cell ?? "");
  if (text.startsWith("=")) {
    const marker = text.lastIndexOf(" => ");
    return marker >= 0 ? text.slice(marker + 4) : "";
  }
  return text;
}

/** A number from "1,234.50", "$1,200", "(300)", "12%"; null when the cell is not numeric. */
export function cellNumber(cell) {
  let text = clean(cellValue(cell));
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const percent = text.endsWith("%");
  text = text.replace(/%$/, "").replace(/^[$€£¥₹]|[$€£¥₹]$/g, "").replace(/,/g, "").replace(/\s/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  let number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (percent) number /= 100;
  return negative ? -number : number;
}

function columnIndex(header, column) {
  const name = clean(column);
  if (!name) throw new HttpError(400, "A column name or letter is required.");
  const byName = header.findIndex((cell) => clean(cellValue(cell)).toLowerCase() === name.toLowerCase());
  if (byName >= 0) return byName;
  if (/^[A-Z]{1,3}$/i.test(name)) return columnNumber(name) - 1;
  throw new HttpError(400, `Column "${name}" was not found. Columns: ${header.map((cell, index) => `${columnLetter(index + 1)} ${clean(cellValue(cell))}`.trim()).join(", ")}.`);
}

function compare(op, cell, value) {
  const left = clean(cellValue(cell));
  const leftNumber = cellNumber(cell);
  const values = Array.isArray(value) ? value : [value];
  const right = clean(values[0]);
  const rightNumber = cellNumber(right);
  const numeric = leftNumber !== null && rightNumber !== null;
  switch (op) {
    case "=": case "==": case "eq":
      return numeric ? leftNumber === rightNumber : left.toLowerCase() === right.toLowerCase();
    case "!=": case "ne":
      return numeric ? leftNumber !== rightNumber : left.toLowerCase() !== right.toLowerCase();
    case ">": case "gt": return numeric && leftNumber > rightNumber;
    case ">=": case "gte": return numeric && leftNumber >= rightNumber;
    case "<": case "lt": return numeric && leftNumber < rightNumber;
    case "<=": case "lte": return numeric && leftNumber <= rightNumber;
    case "contains": return left.toLowerCase().includes(right.toLowerCase());
    case "starts_with": return left.toLowerCase().startsWith(right.toLowerCase());
    case "in": return values.some((entry) => {
      const number = cellNumber(entry);
      return leftNumber !== null && number !== null ? leftNumber === number : left.toLowerCase() === clean(entry).toLowerCase();
    });
    case "is_empty": return !left;
    case "not_empty": return Boolean(left);
    default: throw new HttpError(400, `Unknown filter operator "${op}".`);
  }
}

function aggregate(fn, cells) {
  const numbers = cells.map(cellNumber).filter((value) => value !== null);
  switch (fn) {
    case "count": return cells.filter((cell) => clean(cellValue(cell))).length;
    case "count_rows": return cells.length;
    case "count_distinct": return new Set(cells.map((cell) => clean(cellValue(cell))).filter(Boolean)).size;
    case "sum": return numbers.reduce((sum, value) => sum + value, 0);
    case "avg": return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    case "min": return numbers.length ? Math.min(...numbers) : null;
    case "max": return numbers.length ? Math.max(...numbers) : null;
    default: throw new HttpError(400, `Unknown aggregate "${fn}". Use count, count_rows, count_distinct, sum, avg, min or max.`);
  }
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
}

/**
 * Filter, group and aggregate one sheet's data rows. `headerRow` names the columns;
 * rows after it are data. Returns plain JSON for the tool result.
 */
export function querySheet(rows, { headerRow = null, filters = [], groupBy = [], aggregates = [], orderBy = null, limit = 50 } = {}) {
  const headerIndex = headerRow ? rows.findIndex((entry) => entry.row === Number(headerRow)) : 0;
  const header = headerIndex >= 0 && rows[headerIndex] ? rows[headerIndex].cells : [];
  const data = rows.filter((entry, index) => index > headerIndex);
  const max = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 50));

  const conditions = (Array.isArray(filters) ? filters : []).map((filter) => ({
    index: columnIndex(header, filter?.column),
    op: clean(filter?.op || "=").toLowerCase(),
    value: filter?.value
  }));
  const matched = data.filter((entry) => conditions.every(({ index, op, value }) => compare(op, entry.cells[index], value)));
  const columnName = (index) => clean(cellValue(header[index])) || columnLetter(index + 1);

  const groups = (Array.isArray(groupBy) ? groupBy : [groupBy]).filter(Boolean).map((column) => columnIndex(header, column));
  const metrics = (Array.isArray(aggregates) ? aggregates : []).map((entry) => {
    const fn = clean(entry?.fn || entry?.function || "count").toLowerCase();
    const index = fn === "count_rows" && !entry?.column ? null : columnIndex(header, entry?.column);
    return { fn, index, name: `${fn}(${index === null ? "*" : columnName(index)})` };
  });

  if (!metrics.length && !groups.length) {
    let list = matched;
    if (orderBy?.column) {
      const index = columnIndex(header, orderBy.column);
      list = [...list].sort((a, b) => sortValue(a.cells[index], b.cells[index]) * (orderBy.desc ? -1 : 1));
    }
    return {
      columns: header.map((cell, index) => `${columnLetter(index + 1)}: ${clean(cellValue(cell))}`),
      matched_rows: matched.length,
      rows: list.slice(0, max).map((entry) => ({ row: entry.row, cells: entry.cells })),
      ...(matched.length > max ? { more_rows: matched.length - max, note: "Raise limit or narrow the filters to see the rest." } : {})
    };
  }

  const buckets = new Map();
  for (const entry of matched) {
    const key = groups.map((index) => clean(cellValue(entry.cells[index])));
    const id = JSON.stringify(key);
    if (!buckets.has(id)) buckets.set(id, { key, rows: [] });
    buckets.get(id).rows.push(entry);
  }
  if (!groups.length && !buckets.size) buckets.set("[]", { key: [], rows: [] });
  const useMetrics = metrics.length ? metrics : [{ fn: "count_rows", index: null, name: "count_rows(*)" }];
  let results = [...buckets.values()].map(({ key, rows: groupRows }) => {
    const out = {};
    groups.forEach((index, position) => { out[columnName(index)] = key[position]; });
    for (const metric of useMetrics) {
      const cells = metric.index === null ? groupRows.map(() => "x") : groupRows.map((entry) => entry.cells[metric.index]);
      out[metric.name] = round(aggregate(metric.fn, cells));
    }
    return out;
  });
  if (orderBy?.column) {
    const key = Object.keys(results[0] || {}).find((name) => name.toLowerCase() === clean(orderBy.column).toLowerCase()) || clean(orderBy.column);
    results = results.sort((a, b) => sortValue(a[key], b[key]) * (orderBy.desc ? -1 : 1));
  }
  return {
    matched_rows: matched.length,
    groups: results.length,
    results: results.slice(0, max),
    ...(results.length > max ? { more_groups: results.length - max } : {})
  };
}

function sortValue(a, b) {
  const left = typeof a === "number" ? a : cellNumber(a);
  const right = typeof b === "number" ? b : cellNumber(b);
  if (left !== null && right !== null) return left - right;
  return clean(cellValue(a)).localeCompare(clean(cellValue(b)));
}
