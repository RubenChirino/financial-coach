import "server-only";

import { getLanguageModel } from "@/lib/llm/provider";
import { redactPII } from "@/lib/redact";
import { generateObject } from "ai";
import { z } from "zod";
import type { CsvRowError, ParseCsvResult, ParsedCsvRow } from "./csv";

/**
 * AI-powered CSV mapper.
 *
 * Bank CSV exports are wildly inconsistent: semicolon delimiters in the EU,
 * `DD/MM/YYYY` dates in Spain, comma decimal separators, separate debit/credit
 * columns, header in row 4 instead of row 1, headers in any language, and so on.
 *
 * Rather than maintain a per-bank zoo of regexes, we ask the configured LLM to
 * produce a small, validated **mapping spec** describing the file's format, then
 * apply that spec deterministically (no LLM calls per row) to every line. This
 * keeps the AI surface tiny — one call per import — and the actual transforms
 * are pure, testable functions.
 *
 * Security posture
 * ----------------
 * **PII**: every sample line is run through `redactPII` before reaching the
 * model. IBANs, card numbers, phone numbers, postal codes, DNI/NIE, emails,
 * and long digit sequences are masked. The structural cues (delimiter, column
 * positions, date pattern) survive redaction unchanged so detection quality
 * isn't degraded.
 *
 * **Prompt injection**: the user's CSV contents are attacker-controlled text
 * that ends up in the LLM prompt. We don't trust the model's output at all —
 * `generateObject` constrains the response to `CsvMappingSchema`, which means
 * the most a hostile file could do is convince the model to return a *valid*
 * but *misleading* mapping (e.g. point `dateColumn` at the merchant column).
 * The result of that is rows failing per-row validation and ending up in
 * `errors` — never bypassed checks, never injected SQL (Drizzle is
 * parameterized), never executed code. The deterministic application step
 * (`applyMapping`) is the trust boundary; the LLM is treated as untrusted.
 *
 * **Cloud consent**: when the user's configured LLM provider is non-local,
 * the calling action layer enforces the same consent gate the chat endpoint
 * uses (`users.cloudLlmConsentAt`). See `actions.ts → checkCloudConsent`.
 */

// ---------- Spec ----------

const DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
  "MM-DD-YYYY",
  "MM/DD/YYYY",
  "D/M/YYYY",
  "DD/MM/YY",
  "MM/DD/YY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const CsvMappingSchema = z.object({
  /** Field separator the file uses. Most banks use "," or ";". */
  delimiter: z.enum([",", ";", "\t", "|"]),
  /** 0-based row index of the header row; rows above are junk metadata. */
  headerLineIndex: z.number().int().min(0).max(50),
  dateColumn: z.number().int().min(0),
  dateFormat: z.enum(DATE_FORMATS),
  /** Whether the amount lives in one signed column or two (debit + credit). */
  amountMode: z.enum(["single", "debit-credit"]),
  amountColumn: z.number().int().min(0).nullable(),
  debitColumn: z.number().int().min(0).nullable(),
  creditColumn: z.number().int().min(0).nullable(),
  /**
   * For single-column mode, what the **sign** of an outflow looks like:
   *  - "negative-out" — outflows are negative (the convention we store).
   *  - "positive-out" — outflows are positive (we'll flip signs).
   */
  amountSign: z.enum(["negative-out", "positive-out"]),
  /** Character used as the decimal mark inside an amount cell. */
  decimalSeparator: z.enum([".", ","]),
  /**
   * Optional thousands separator. "none" means no separator.
   *
   * Why "none" instead of "": Gemini's structured-output API rejects empty
   * strings in enum values (`enum[0]: cannot be empty`), so the schema-level
   * sentinel for "no thousands separator" must be a non-empty token. We
   * translate to `""` at the parse boundary via `normalizeThousands()`.
   */
  thousandsSeparator: z.enum(["none", ".", ",", " "]),
  /** Column carrying ISO-4217 currency. -1 if absent — we use defaultCurrency. */
  currencyColumn: z.number().int().min(-1),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  /** -1 if the file has no merchant column. */
  merchantColumn: z.number().int().min(-1),
  descriptionColumn: z.number().int().min(0),
  /** Short human-readable summary of what was detected — surfaced in the UI. */
  notes: z.string().max(280),
});
export type CsvMappingSpec = z.infer<typeof CsvMappingSchema>;

// ---------- Delimiter sniffing ----------

const CANDIDATE_DELIMS = [",", ";", "\t", "|"] as const;

/**
 * Pick the delimiter by counting candidate occurrences across the first N
 * non-blank lines and choosing the one with the highest stable count
 * (variance close to zero across rows). Used both as a fallback and as a hint
 * we feed to the LLM so it doesn't have to figure it out from scratch.
 */
export function sniffDelimiter(text: string): "," | ";" | "\t" | "|" {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return ",";

  let best: (typeof CANDIDATE_DELIMS)[number] = ",";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const delim of CANDIDATE_DELIMS) {
    const counts = lines.map((l) => splitRow(l, delim).length);
    const median = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    if (median < 2) continue;
    const variance = counts.reduce((s, c) => s + (c - median) ** 2, 0) / Math.max(1, counts.length);
    // Reward many columns; penalize variance.
    const score = median - variance * 2;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

/** RFC-4180-ish row splitter, parameterized by delimiter. */
export function splitRow(line: string, delim: string): string[] {
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
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur === "") {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ---------- Sample for the LLM ----------

interface SamplePayload {
  delimiterGuess: "," | ";" | "\t" | "|";
  /** Up to 30 lines, each redacted, including any junk header rows. */
  lines: string[];
  totalLines: number;
}

export function buildSample(text: string, maxLines = 25): SamplePayload {
  const cleaned = text.replace(/^\uFEFF/, "");
  const all = cleaned.split(/\r?\n/);
  const nonEmpty: string[] = [];
  for (const l of all) {
    if (l.trim() !== "") nonEmpty.push(l);
    if (nonEmpty.length >= maxLines) break;
  }
  const delimiterGuess = sniffDelimiter(cleaned);
  // Redact each line as raw text — this catches IBANs, card numbers, phones
  // before they hit the LLM. The structural cues (delimiter, column positions,
  // date formats) survive redaction unchanged.
  const lines = nonEmpty.map((l) => redactPII(l));
  return {
    delimiterGuess,
    lines,
    totalLines: all.filter((l) => l.trim() !== "").length,
  };
}

// ---------- LLM call ----------

const SYSTEM_PROMPT = `You are a CSV format detector for a personal-finance app.
Given a bank export sample, return a JSON mapping that describes how to extract:
date, amount (signed, negative = outflow), currency, merchant, description.

Rules:
- Column indices are 0-based, counted *after splitting on the detected delimiter*.
- If amount is in two columns (debit + credit), set amountMode="debit-credit"
  and fill debitColumn + creditColumn; leave amountColumn=null.
- If amount is one signed column, set amountMode="single" and amountColumn;
  leave debitColumn=null and creditColumn=null.
- For amountSign: most banks use negative for outflows. Pick "positive-out"
  ONLY if you can clearly see expense rows have positive numbers (e.g. a
  "Debit" or "Cargo" column with positive values).
- Choose the closest dateFormat from the allowed list. European banks usually
  use DD/MM/YYYY or DD-MM-YYYY.
- decimalSeparator and thousandsSeparator: DETERMINE THESE FROM THE ACTUAL
  AMOUNT VALUES IN THE SAMPLE — never from the language of the merchant text.
  Look at the rightmost separator in each amount: if amounts look like
  "-4.50" or "-21.00" or "1,234.56" the decimal is "." and thousands is ","
  (or "none" if no thousands separator appears). If amounts look like "-4,50"
  or "-21,00" or "1.234,56" the decimal is "," and thousands is "." (or
  "none"). Use the literal string "none" — NOT an empty string — when there
  is no thousands separator. When in doubt, count
  fractional digits — exactly 2 digits after a separator means that's the
  decimal mark. XLS files converted to CSV typically use "." decimal even
  for European banks, because the spreadsheet stored them as numbers.
- currencyColumn=-1 if no currency column exists; set defaultCurrency to the
  most likely 3-letter code (EUR for Spanish/European banks, GBP for UK, etc.).
- merchantColumn=-1 if there is no clear merchant/payee column — descriptions
  are mandatory.
- headerLineIndex is the 0-based index of the row that contains column titles.
  Bank exports often have 1-3 metadata lines (account holder, date range)
  above the header — skip them.
- "notes" is a one-sentence human summary of what you detected, in English.`;

export async function inferMapping(
  text: string,
  prefs?: { provider?: string | null; model?: string | null },
): Promise<{ spec: CsvMappingSpec; provider: string; model: string }> {
  const { model, info } = getLanguageModel(prefs ?? undefined);
  const sample = buildSample(text);

  const prompt = [
    `Detected delimiter (best guess): ${describeDelim(sample.delimiterGuess)}`,
    `Total non-blank lines in file: ${sample.totalLines}`,
    "",
    "First lines (PII redacted):",
    ...sample.lines.map((l, i) => `[${i}] ${l}`),
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: CsvMappingSchema,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    maxRetries: 1,
  });

  return { spec: object, provider: info.provider, model: info.model };
}

function describeDelim(d: "," | ";" | "\t" | "|"): string {
  switch (d) {
    case ",":
      return "comma (,)";
    case ";":
      return "semicolon (;)";
    case "\t":
      return "tab (\\t)";
    case "|":
      return "pipe (|)";
  }
}

// ---------- Apply spec → ParsedCsvRow[] ----------

const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Convert any number string allowed by a `CsvMappingSpec` to signed cents.
 *
 * Handles:
 *  - thousands separators (`1.234,56` or `1,234.56`)
 *  - parentheses for negatives `(11,99)` (common in accounting exports)
 *  - leading sign and trailing currency-letter (`-11.99 EUR`, `11,99-`)
 *
 * Returns NaN if it can't be parsed cleanly — the caller turns that into a
 * `CsvRowError` so the row is skipped, not silently zeroed.
 */
/**
 * Translate the schema-level sentinel back to the runtime token that
 * `parseAmountWithSpec` expects internally. See the comment on
 * `CsvMappingSchema.thousandsSeparator` for why this exists.
 */
function normalizeThousands(t: CsvMappingSpec["thousandsSeparator"]): "" | "." | "," | " " {
  return t === "none" ? "" : t;
}

export function parseAmountWithSpec(
  raw: string,
  decimal: "." | ",",
  thousands: "" | "." | "," | " ",
): number {
  let s = raw.trim();
  if (!s) return Number.NaN;

  // Parentheses → negative.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Trailing minus (some Spanish banks: "11,99-").
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  // Leading sign.
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Strip a trailing currency code or symbol so "11,99 EUR" still parses.
  s = s.replace(/\s*[A-Z€$£¥]{1,3}$/i, "").trim();
  s = s.replace(/^[€$£¥]\s*/, "");

  if (thousands && thousands !== decimal) {
    s = s.split(thousands).join("");
  }
  if (decimal === ",") {
    s = s.replace(",", ".");
  }
  // Anything left that isn't a digit, dot, or sign is invalid.
  if (!/^\d+(?:\.\d+)?$/.test(s)) return Number.NaN;

  const [intPart = "0", fracPart = ""] = s.split(".");
  if (fracPart.length > 4) return Number.NaN;
  // Round to 2 decimals to handle exotic 3-4 decimal exports.
  const padded = `${fracPart}00`.slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(padded || "0", 10);
  if (!Number.isFinite(cents)) return Number.NaN;
  return negative ? -cents : cents;
}

/**
 * Parse a date according to the inferred format. We support a fixed set of
 * common patterns rather than a general-purpose parser — false confidence is
 * worse than a clear "row skipped" error.
 */
export function parseDateWithSpec(raw: string, format: DateFormat): Date | null {
  const s = raw.trim().replace(/^["']|["']$/g, "");
  if (!s) return null;

  const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (!m) return null;
  const [, a, b, c] = m as unknown as [string, string, string, string];

  let year: number;
  let month: number;
  let day: number;

  switch (format) {
    case "YYYY-MM-DD":
    case "YYYY/MM/DD":
      year = Number.parseInt(a, 10);
      month = Number.parseInt(b, 10);
      day = Number.parseInt(c, 10);
      break;
    case "DD-MM-YYYY":
    case "DD/MM/YYYY":
    case "DD.MM.YYYY":
    case "D/M/YYYY":
      day = Number.parseInt(a, 10);
      month = Number.parseInt(b, 10);
      year = Number.parseInt(c, 10);
      break;
    case "MM-DD-YYYY":
    case "MM/DD/YYYY":
      month = Number.parseInt(a, 10);
      day = Number.parseInt(b, 10);
      year = Number.parseInt(c, 10);
      break;
    case "DD/MM/YY":
      day = Number.parseInt(a, 10);
      month = Number.parseInt(b, 10);
      year = 2000 + Number.parseInt(c, 10);
      break;
    case "MM/DD/YY":
      month = Number.parseInt(a, 10);
      day = Number.parseInt(b, 10);
      year = 2000 + Number.parseInt(c, 10);
      break;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type RowFailure = { lineNumber: number; raw: string; message: string };

/** Compute signed cents for a row given the spec. Returns NaN on invalid. */
function extractAmount(cells: string[], spec: CsvMappingSpec): number | RowFailure["message"] {
  if (spec.amountMode === "single") {
    const col = spec.amountColumn ?? -1;
    if (col < 0) return "missing amount column in mapping";
    const raw = cells[col] ?? "";
    const cents = parseAmountWithSpec(
      raw,
      spec.decimalSeparator,
      normalizeThousands(spec.thousandsSeparator),
    );
    if (!Number.isFinite(cents)) return `invalid amount "${raw}"`;
    return spec.amountSign === "positive-out" ? -cents : cents;
  }

  const debitRaw = cells[spec.debitColumn ?? -1] ?? "";
  const creditRaw = cells[spec.creditColumn ?? -1] ?? "";
  const thousands = normalizeThousands(spec.thousandsSeparator);
  const debit = parseAmountWithSpec(debitRaw, spec.decimalSeparator, thousands);
  const credit = parseAmountWithSpec(creditRaw, spec.decimalSeparator, thousands);
  const debitVal = Number.isFinite(debit) ? Math.abs(debit) : 0;
  const creditVal = Number.isFinite(credit) ? Math.abs(credit) : 0;
  if (debitVal === 0 && creditVal === 0) {
    return `no amount in debit/credit columns ("${debitRaw}" / "${creditRaw}")`;
  }
  // Outflow = negative; inflow = positive. If both are filled (rare), the
  // larger one wins — banks should never emit that, but cope gracefully.
  return creditVal >= debitVal ? creditVal : -debitVal;
}

function extractCurrency(cells: string[], spec: CsvMappingSpec): string {
  if (spec.currencyColumn < 0) return spec.defaultCurrency.toUpperCase();
  const cur = (cells[spec.currencyColumn] ?? "").trim().toUpperCase();
  return CURRENCY_RE.test(cur) ? cur : spec.defaultCurrency.toUpperCase();
}

function extractParties(
  cells: string[],
  spec: CsvMappingSpec,
): { merchant: string | null; description: string } {
  const merchant =
    spec.merchantColumn >= 0 ? (cells[spec.merchantColumn] ?? "").trim() || null : null;
  const description = (cells[spec.descriptionColumn] ?? "").trim();
  return { merchant, description };
}

/** Convert a single line into a `ParsedCsvRow` or a row-level failure. */
function applyMappingToLine(
  raw: string,
  lineNumber: number,
  spec: CsvMappingSpec,
): ParsedCsvRow | RowFailure {
  const cells = splitRow(raw, spec.delimiter).map((c) => c.trim());

  const dateCell = cells[spec.dateColumn] ?? "";
  const date = parseDateWithSpec(dateCell, spec.dateFormat);
  if (!date) return { lineNumber, raw, message: `invalid date "${dateCell}"` };

  const amountResult = extractAmount(cells, spec);
  if (typeof amountResult === "string") {
    return { lineNumber, raw, message: amountResult };
  }

  const { merchant, description } = extractParties(cells, spec);
  if (!merchant && !description) {
    return {
      lineNumber,
      raw,
      message: "both merchant and description are empty — need at least one",
    };
  }

  return {
    lineNumber,
    date,
    amountCents: amountResult,
    currency: extractCurrency(cells, spec),
    merchant,
    description: description || merchant || "(no description)",
  };
}

/**
 * Walk every row of the file using the AI's mapping spec. Returns the same
 * shape as `parseCsv` so it drops straight into the existing ingest pipeline.
 */
export function applyMapping(text: string, spec: CsvMappingSpec): ParseCsvResult {
  const cleaned = text.replace(/^\uFEFF/, "");
  const allLines = cleaned.split(/\r?\n/);

  if (spec.headerLineIndex >= allLines.length) {
    return { rows: [], errors: [], headerError: "headerLineIndex out of range" };
  }

  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];

  for (let i = spec.headerLineIndex + 1; i < allLines.length; i++) {
    const raw = allLines[i] ?? "";
    if (raw.trim() === "") continue;
    const result = applyMappingToLine(raw, i - spec.headerLineIndex, spec);
    if ("date" in result) rows.push(result);
    else errors.push(result);
  }

  return { rows, errors, headerError: null };
}

// ---------- Top-level entry ----------

export interface ParseCsvWithAiResult extends ParseCsvResult {
  spec: CsvMappingSpec;
  provider: string;
  model: string;
}

/**
 * Look at actual values in the amount column(s) and infer which character is
 * the decimal separator. The LLM is unreliable here: when merchant text is
 * Spanish (e.g. "Compra", "Comision") it assumes EU number format ("," decimal,
 * "." thousands), but XLS exports converted via SheetJS always emit en-US
 * numbers ("-4.50", "1,234.56"). Voting on fractional-digit counts beats
 * locale guessing.
 */
function detectSeparatorsFromSamples(
  samples: string[],
): { decimal: "." | ","; thousands: CsvMappingSpec["thousandsSeparator"] } | null {
  let dotDecimal = 0;
  let commaDecimal = 0;
  let dotThousands = 0;
  let commaThousands = 0;

  for (const raw of samples) {
    const s = raw
      .trim()
      .replace(/[()]/g, "")
      .replace(/^[+-]/, "")
      .replace(/[-+]$/, "")
      .replace(/\s*[A-Z€$£¥]{1,3}$/i, "")
      .replace(/^[€$£¥]\s*/, "")
      .trim();
    if (!s) continue;

    const dotIdx = s.lastIndexOf(".");
    const commaIdx = s.lastIndexOf(",");

    if (dotIdx >= 0 && commaIdx >= 0) {
      // Rightmost separator is the decimal mark.
      if (dotIdx > commaIdx) {
        dotDecimal++;
        commaThousands++;
      } else {
        commaDecimal++;
        dotThousands++;
      }
      continue;
    }

    const sep = dotIdx >= 0 ? "." : commaIdx >= 0 ? "," : null;
    if (!sep) continue;
    const idx = sep === "." ? dotIdx : commaIdx;
    const frac = s.length - idx - 1;

    // 2 fractional digits → decimal mark. 3 → thousands. 1 → likely decimal.
    if (frac === 2 || frac === 1) {
      if (sep === ".") dotDecimal++;
      else commaDecimal++;
    } else if (frac === 3) {
      if (sep === ".") dotThousands++;
      else commaThousands++;
    }
  }

  if (dotDecimal + commaDecimal === 0) return null;
  const decimal: "." | "," = dotDecimal >= commaDecimal ? "." : ",";
  const thousands: CsvMappingSpec["thousandsSeparator"] =
    decimal === "." ? (commaThousands > 0 ? "," : "none") : dotThousands > 0 ? "." : "none";
  return { decimal, thousands };
}

function correctSeparators(text: string, spec: CsvMappingSpec): CsvMappingSpec {
  const cleaned = text.replace(/^\uFEFF/, "");
  const allLines = cleaned.split(/\r?\n/);
  const samples: string[] = [];
  for (let i = spec.headerLineIndex + 1; i < allLines.length && samples.length < 100; i++) {
    const line = allLines[i];
    if (!line || line.trim() === "") continue;
    const cells = splitRow(line, spec.delimiter).map((c) => c.trim());
    if (spec.amountMode === "single") {
      const v = spec.amountColumn != null ? cells[spec.amountColumn] : undefined;
      if (v) samples.push(v);
    } else {
      const d = spec.debitColumn != null ? cells[spec.debitColumn] : undefined;
      const c = spec.creditColumn != null ? cells[spec.creditColumn] : undefined;
      if (d) samples.push(d);
      if (c) samples.push(c);
    }
  }

  const detected = detectSeparatorsFromSamples(samples);
  if (!detected) return spec;
  if (
    detected.decimal === spec.decimalSeparator &&
    detected.thousands === spec.thousandsSeparator
  ) {
    return spec;
  }
  return {
    ...spec,
    decimalSeparator: detected.decimal,
    thousandsSeparator: detected.thousands,
  };
}

/**
 * Full flow: ask the LLM to infer the format, then deterministically apply it.
 * The action layer typically calls strict `parseCsv` first and only falls
 * back here if the strict parser couldn't read the header.
 */
export async function parseCsvWithAi(
  text: string,
  prefs?: { provider?: string | null; model?: string | null },
): Promise<ParseCsvWithAiResult> {
  const { spec: rawSpec, provider, model } = await inferMapping(text, prefs);
  const spec = correctSeparators(text, rawSpec);
  const result = applyMapping(text, spec);
  return { ...result, spec, provider, model };
}
