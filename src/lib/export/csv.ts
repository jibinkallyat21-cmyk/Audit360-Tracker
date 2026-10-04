/** Cells that spreadsheet programs would treat as formulas (but plain numbers and dates are left alone). */
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER_OR_DATE = /^[+-]?\d+([.,]\d+)?$|^\d{4}-\d{2}-\d{2}/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Neutralise formula injection for text that someone typed; the original stays in the database.
  if (typeof value === "string" && FORMULA.test(text) && !NUMBER_OR_DATE.test(text))
    text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a UTF-8 byte-order mark so Excel opens non-English text correctly. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
