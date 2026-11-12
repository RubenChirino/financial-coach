import "server-only";

import type { CellObject, WorkSheet } from "xlsx";

export type ExcelToCsvResult = { ok: true; csv: string } | { ok: false; error: string };

/**
 * Convert the first sheet of an Excel workbook (.xlsx, .xlsm or legacy .xls)
 * to CSV text for the import parsers.
 *
 * SheetJS reads both formats, so there is one path. It is installed from
 * SheetJS's own CDN tarball (the patched 0.20.x line): the npm-published
 * `xlsx@0.18.5` has two known CVEs and is no longer updated there.
 *
 * Cells are written as their underlying values, not as Excel displays them:
 *  - numbers unformatted (`1234.5`, never `1.234,50 €`), so the amount
 *    parsers see one unambiguous form;
 *  - date cells as `YYYY-MM-DD`, read from the serial number without a
 *    timezone (a `Date` object would shift a day east of UTC). Both CSV
 *    parsers accept exactly that form; a full ISO timestamp is rejected by
 *    both. A time-only cell becomes `HH:MM:SS`;
 *  - formulas as their cached result; errors as their code (`#N/A`).
 * Empty rows are skipped and each row ends at its last non-empty cell.
 */
export async function excelToCsv(bytes: Uint8Array): Promise<ExcelToCsvResult> {
  const XLSX = await import("xlsx");
  let sheet: WorkSheet | undefined;
  try {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true });
    const name = workbook.SheetNames[0];
    sheet = name ? workbook.Sheets[name] : undefined;
  } catch (err) {
    console.error("excelToCsv: parse failed", err);
    return { ok: false, error: "parseFailed" };
  }
  if (!sheet) return { ok: false, error: "noSheet" };

  const ref = sheet["!ref"];
  if (!ref) return { ok: true, csv: "" };
  const range = XLSX.utils.decode_range(ref);
  const lines: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined;
      cells.push(cell ? cellText(cell, XLSX.SSF) : "");
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length > 0) lines.push(cells.map(csvEscape).join(","));
  }
  return { ok: true, csv: lines.join("\n") };
}

type Ssf = typeof import("xlsx").SSF;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function cellText(cell: CellObject, ssf: Ssf): string {
  switch (cell.t) {
    case "s":
      return String(cell.v ?? "");
    case "b":
      return cell.v ? "true" : "false";
    case "e":
      return cell.w ?? "";
    case "d":
      return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v ?? "");
    case "n": {
      const v = cell.v as number;
      if (cell.z == null || !ssf.is_date(cell.z)) return String(v);
      const d = ssf.parse_date_code(v);
      // Serial < 1 has no date part: a time-of-day cell.
      if (Math.floor(v) === 0) return `${pad(d.H)}:${pad(d.M)}:${pad(d.S)}`;
      return `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;
    }
    default:
      return "";
  }
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
