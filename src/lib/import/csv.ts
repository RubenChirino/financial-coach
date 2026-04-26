/**
 * CSV transaction parser — pure, no I/O.
 *
 * Accepts a fixed column layout so users always get the same format error in
 * the same place. The canonical schema:
 *
 *   date,amount,currency,merchant,description
 *   2026-01-05,-11.99,EUR,Netflix,Netflix Monthly Subscription
 *
 *   - `date` — ISO 8601 YYYY-MM-DD (the boundary the UI treats as "booking date").
 *   - `amount` — signed decimal in the account's currency; negative = outflow.
 *                Parsed as a string to avoid float rounding at sub-cent level.
 *   - `currency` — ISO 4217 (3 letters). Defaults to EUR if the column is blank.
 *   - `merchant` — human-readable name; may be empty.
 *   - `description` — free-text description; may be empty.
 *
 * Design notes
 * ------------
 * - We hand-roll a minimal RFC-4180 reader rather than pulling a dep in. The
 *   corner cases users actually hit are: CRLF line endings, quoted fields with
 *   commas, and embedded double-quotes. Everything more exotic (multi-line
 *   quoted cells, alternative separators) is out of scope — error out instead.
 * - Per-row errors are returned alongside successful rows so the UI can
 *   surface "23 imported, 2 skipped (see details)" instead of failing the
 *   whole file on a single bad row.
 * - The parser is intentionally case-insensitive on header names so a user
 *   exporting from an accounting tool with "Date,Amount,…" doesn't have to
 *   re-type the header.
 */

export interface ParsedCsvRow {
  /** 1-indexed line number in the source file, after the header row. Useful for errors. */
  lineNumber: number;
  date: Date;
  /** Signed integer cents. Negative = outflow. */
  amountCents: number;
  currency: string;
  merchant: string | null;
  description: string;
}

export interface CsvRowError {
  lineNumber: number;
  raw: string;
  message: string;
}

export interface ParseCsvResult {
  rows: ParsedCsvRow[];
  errors: CsvRowError[];
  headerError: string | null;
}

const REQUIRED_HEADERS = ["date", "amount", "currency", "merchant", "description"] as const;
type Header = (typeof REQUIRED_HEADERS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^-?\d+(?:\.\d+)?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Parse an amount like "-11.99" or "1800" to signed cents.
 *
 * String-based so 0.1 + 0.2 ≠ 0.30000000000000004 never enters the pipeline.
 * Rejects anything with more than 2 decimals to avoid silently losing precision
 * — sub-cent amounts in a personal-finance app are always a typo.
 */
export function amountToCents(raw: string): number {
  const trimmed = raw.trim();
  if (!AMOUNT_RE.test(trimmed)) throw new Error(`invalid amount "${raw}"`);
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart = "0", fracPart = ""] = abs.split(".");
  if (fracPart.length > 2) throw new Error(`too many decimals in "${raw}"`);
  const frac = `${fracPart}00`.slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(frac || "0", 10);
  if (!Number.isFinite(cents)) throw new Error(`invalid amount "${raw}"`);
  return negative ? -cents : cents;
}

/** RFC-4180-ish single-line splitter: handles quoted commas and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
}

/**
 * Validate and decode a single already-split row. Returns a `ParsedCsvRow`
 * on success or a `CsvRowError` on any validation failure — never throws.
 * Kept separate from `parseCsv` so the latter stays a flat pipeline instead
 * of nesting all the per-cell checks in one big function.
 */
function parseRow(
  cells: string[],
  idx: Record<Header, number>,
  lineNumber: number,
  raw: string,
): ParsedCsvRow | CsvRowError {
  if (cells.length < REQUIRED_HEADERS.length) {
    return {
      lineNumber,
      raw,
      message: `expected ${REQUIRED_HEADERS.length} columns, got ${cells.length}`,
    };
  }

  const dateStr = (cells[idx.date] ?? "").trim();
  const amountStr = (cells[idx.amount] ?? "").trim();
  const currencyStr = (cells[idx.currency] ?? "").trim().toUpperCase() || "EUR";
  const merchantStr = (cells[idx.merchant] ?? "").trim();
  const descriptionStr = (cells[idx.description] ?? "").trim();

  if (!DATE_RE.test(dateStr)) {
    return { lineNumber, raw, message: `invalid date "${dateStr}" (expected YYYY-MM-DD)` };
  }
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return { lineNumber, raw, message: `invalid date "${dateStr}"` };
  }

  let amountCents: number;
  try {
    amountCents = amountToCents(amountStr);
  } catch (err) {
    return {
      lineNumber,
      raw,
      message: err instanceof Error ? err.message : `invalid amount "${amountStr}"`,
    };
  }

  if (!CURRENCY_RE.test(currencyStr)) {
    return {
      lineNumber,
      raw,
      message: `invalid currency "${currencyStr}" (expected 3 letters like EUR, USD)`,
    };
  }

  if (!descriptionStr && !merchantStr) {
    return {
      lineNumber,
      raw,
      message: "both merchant and description are empty — need at least one",
    };
  }

  return {
    lineNumber,
    date,
    amountCents,
    currency: currencyStr,
    merchant: merchantStr || null,
    description: descriptionStr || merchantStr || "(no description)",
  };
}

function isParsedRow(r: ParsedCsvRow | CsvRowError): r is ParsedCsvRow {
  return "date" in r;
}

/**
 * Parse the whole file. Never throws — malformed rows go into `errors`.
 * If the header itself is invalid, `headerError` is set and no rows are returned.
 */
export function parseCsv(input: string): ParseCsvResult {
  // Strip BOM; Excel loves adding one.
  const cleaned = input.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l, i, arr) => {
    // Drop trailing blank lines but keep blanks mid-file so row numbers stay
    // meaningful in error messages.
    if (l.trim() === "" && i === arr.length - 1) return false;
    return true;
  });

  if (lines.length === 0) {
    return { rows: [], errors: [], headerError: "empty file" };
  }

  const rawHeader = splitCsvLine(lines[0]!).map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !rawHeader.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [],
      headerError: `missing required column(s): ${missing.join(", ")}. Expected header: ${REQUIRED_HEADERS.join(",")}`,
    };
  }

  // Build name→index map so the input can list columns in any order.
  const idx: Record<Header, number> = {} as Record<Header, number>;
  for (const h of REQUIRED_HEADERS) idx[h] = rawHeader.indexOf(h);

  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue; // skip blank rows silently
    const parsed = parseRow(splitCsvLine(raw), idx, i, raw);
    if (isParsedRow(parsed)) rows.push(parsed);
    else errors.push(parsed);
  }

  return { rows, errors, headerError: null };
}
