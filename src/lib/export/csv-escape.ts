/**
 * Shared CSV cell escaping for the export paths (`/api/export/transactions`
 * and the client-side export wizard).
 *
 * Two separate concerns, both handled here:
 *
 *  1. **RFC 4180 quoting** — wrap in double quotes and double any embedded
 *     quote when the value contains a delimiter, quote or newline.
 *
 *  2. **Formula injection (CWE-1236)** — Excel, LibreOffice and Google Sheets
 *     evaluate any cell whose text begins with `=`, `+`, `-`, `@`, or a
 *     leading tab/CR as a *formula*, not as text. Our cells carry merchant
 *     names and raw descriptions that originate from bank feeds and imported
 *     CSVs — attacker-influenced data for anyone who can get a line into the
 *     victim's statement. A merchant literally named
 *     `=cmd|'/C calc'!A0` becomes code execution the moment the exported file
 *     is opened, entirely outside our app's sandbox.
 *
 *     Mitigation is the OWASP-recommended one: prefix the value with a single
 *     quote so the spreadsheet treats the whole cell as a literal string.
 *
 *     Plain numbers are deliberately exempt — `-1250` is an ordinary negative
 *     amount and must stay numeric so sums/pivots keep working. Only values
 *     that are *not* a bare number get neutralized.
 */

/** Chars that make a spreadsheet treat the cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A bare number (optionally signed, with `.` or `,` decimals) — safe as-is. */
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

/**
 * Neutralize a value that a spreadsheet would otherwise evaluate as a formula.
 * Returns the value unchanged when it's harmless.
 */
export function neutralizeFormula(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

/**
 * Escape one CSV cell: formula-neutralize first, then RFC 4180 quote.
 *
 * `delimiters` lets the caller declare which separators must force quoting —
 * the client-side builder also treats `;` as a delimiter because Excel in
 * several locales splits on it.
 */
export function escapeCsvCell(value: string, extraDelimiters = ""): string {
  const safe = neutralizeFormula(value);
  const needsQuotes =
    safe.includes('"') ||
    safe.includes(",") ||
    safe.includes("\n") ||
    safe.includes("\r") ||
    (extraDelimiters !== "" && [...extraDelimiters].some((d) => safe.includes(d)));
  return needsQuotes ? `"${safe.replace(/"/g, '""')}"` : safe;
}
