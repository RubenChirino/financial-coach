"use server";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { providerInfo } from "@/lib/llm/provider";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { type CsvMappingSpec, parseCsvWithAi } from "./ai-mapper";
import { type ParseCsvResult, parseCsv } from "./csv";
import { ensureImportedAccount, importParsedRows } from "./ingest";
import { extractAccountMetadata } from "./metadata";

export interface AiDetectionInfo {
  used: boolean;
  provider?: string;
  model?: string;
  spec?: CsvMappingSpec;
  /** Set when AI was tried and threw (e.g. local Ollama daemon down). */
  error?: string;
}

export interface ImportActionOk {
  ok: true;
  data: {
    parsed: number;
    inserted: number;
    duplicates: number;
    /** Rows collapsed against another row in the same file. */
    intraBatchDuplicates: number;
    /** Rows whose hash already existed in the DB. */
    existingDuplicates: number;
    ruleMatched: number;
    rowErrors: { lineNumber: number; message: string }[];
    ai: AiDetectionInfo;
    /** First parsed row — surfaced so the user can verify column mapping. */
    sampleRow?: {
      date: string;
      amountCents: number;
      currency: string;
      merchant: string | null;
      description: string;
    };
  };
}
export interface ImportActionErr {
  ok: false;
  error: string;
  /** Populated when the strict path failed and AI fallback also couldn't help. */
  ai?: AiDetectionInfo;
}
export type ImportActionResult = ImportActionOk | ImportActionErr;

/**
 * Hard cap on uploaded CSV size. 2MB is ~20k transactions at 100 bytes/row —
 * dwarfs any realistic personal bank export (a decade of two accounts ≈ 7k
 * rows). Higher limits would let a bad paste wedge the server action.
 */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

function parseAndSummarize(text: string): ParseCsvResult {
  return parseCsv(text);
}

async function loadLlmPrefs(userId: number): Promise<{
  provider: string | null;
  model: string | null;
  cloudConsent: Date | null;
}> {
  const row = await db
    .select({
      provider: users.llmProvider,
      model: users.llmModel,
      cloudConsent: users.cloudLlmConsentAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    provider: row[0]?.provider ?? null,
    model: row[0]?.model ?? null,
    cloudConsent: row[0]?.cloudConsent ?? null,
  };
}

/**
 * Decide whether the AI CSV path is allowed to call the user's configured
 * LLM right now. Mirrors the consent gate `/api/advisor/chat` enforces:
 * any non-Ollama provider requires the user to have ticked the consent box
 * in Settings, because we'd otherwise ship redacted-but-still-private bank
 * data to a third-party API without informed opt-in.
 *
 * Returns null when the call is permitted, or an error string to surface to
 * the UI so it can prompt for consent.
 */
function checkCloudConsent(prefs: {
  provider: string | null;
  model: string | null;
  cloudConsent: Date | null;
}): string | null {
  const info = providerInfo({ provider: prefs.provider, model: prefs.model });
  if (info.isLocal) return null;
  if (prefs.cloudConsent != null) return null;
  return "cloudConsentRequired";
}

interface RunImportOptions {
  /** "auto" (default) tries strict first then AI; "ai" forces AI; "strict" forces strict. */
  mode?: "auto" | "ai" | "strict";
  /** Original filename if the user picked a file (rather than pasting). */
  filename?: string;
  /** Bypass dedup checks. Each row gets a unique id so the UNIQUE constraint passes. */
  forceReimport?: boolean;
}

type ParseOutcome =
  | { kind: "parsed"; parsed: ParseCsvResult; ai: AiDetectionInfo }
  | { kind: "error"; error: string; ai?: AiDetectionInfo };

/**
 * Resolve the file → parsed rows. Encapsulates the strict-then-AI dance so
 * `runImport` stays a flat orchestration step.
 */
async function resolveParse(
  text: string,
  mode: "auto" | "ai" | "strict",
  userId: number,
): Promise<ParseOutcome> {
  if (mode !== "ai") {
    const strict = parseAndSummarize(text);
    if (!strict.headerError) return { kind: "parsed", parsed: strict, ai: { used: false } };
    if (mode === "strict") return { kind: "error", error: `header:${strict.headerError}` };
  }

  try {
    const prefs = await loadLlmPrefs(userId);
    const consentError = checkCloudConsent(prefs);
    if (consentError) return { kind: "error", error: consentError };
    const aiResult = await parseCsvWithAi(text, prefs);
    const ai: AiDetectionInfo = {
      used: true,
      provider: aiResult.provider,
      model: aiResult.model,
      spec: aiResult.spec,
    };
    if (aiResult.headerError) {
      return { kind: "error", error: `header:${aiResult.headerError}`, ai };
    }
    return {
      kind: "parsed",
      parsed: { rows: aiResult.rows, errors: aiResult.errors, headerError: null },
      ai,
    };
  } catch (err) {
    console.error("AI CSV import failed", err);
    const message = err instanceof Error ? err.message : "unknown";
    return { kind: "error", error: "aiUnavailable", ai: { used: true, error: message } };
  }
}

async function runImport(text: string, opts: RunImportOptions = {}): Promise<ImportActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  if (text.length === 0) return { ok: false, error: "emptyFile" };
  if (text.length > MAX_CSV_BYTES) return { ok: false, error: "fileTooLarge" };

  const outcome = await resolveParse(text, opts.mode ?? "auto", session.userId);
  if (outcome.kind === "error") {
    return { ok: false, error: outcome.error, ...(outcome.ai ? { ai: outcome.ai } : {}) };
  }
  const { parsed, ai } = outcome;

  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    return { ok: false, error: "allRowsFailed", ai };
  }

  try {
    // Pull IBAN / current balance / currency from the file's header block —
    // banks like Santander put them above the transaction rows. Falls back to
    // null fields for files that don't expose any of this.
    const meta = extractAccountMetadata(text);
    const { accountRowId } = await ensureImportedAccount({
      encryptionKey: session.encryptionKey,
      iban: meta.iban,
      currency: meta.currency,
    });
    const currency = meta.currency ?? parsed.rows[0]?.currency;
    const ingest = await importParsedRows(parsed.rows, {
      accountRowId,
      currency,
      filename: opts.filename,
      forceReimport: opts.forceReimport,
      accountBalanceCents: meta.balanceCents,
    });

    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/import");

    return {
      ok: true,
      data: {
        parsed: parsed.rows.length,
        inserted: ingest.inserted,
        duplicates: ingest.duplicates,
        intraBatchDuplicates: ingest.intraBatchDuplicates,
        existingDuplicates: ingest.existingDuplicates,
        ruleMatched: ingest.ruleMatched,
        rowErrors: parsed.errors.map((e) => ({ lineNumber: e.lineNumber, message: e.message })),
        ai,
        sampleRow: ingest.sampleRow,
      },
    };
  } catch (err) {
    console.error("CSV import failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown", ai };
  }
}

/**
 * User-pasted or uploaded CSV text. Server action — `text` comes straight from
 * the form. We cap the length defensively even though Next limits body size.
 *
 * `mode`:
 *  - "auto" (default) — try the strict canonical-format parser first, fall
 *    back to AI inference if the header doesn't match.
 *  - "ai" — skip the strict parser, ask the configured LLM to infer the
 *    format. Useful when the user knows their export is non-canonical.
 *  - "strict" — disable AI; reject anything that isn't already canonical.
 */
export async function importCsvAction(
  text: string,
  mode: "auto" | "ai" | "strict" = "auto",
  filename?: string,
  forceReimport = false,
): Promise<ImportActionResult> {
  return runImport(text, { mode, filename, forceReimport });
}

/**
 * Convert an uploaded Excel file (.xls/.xlsx) to CSV text on the server.
 *
 * We do this server-side instead of in the browser because exceljs is large,
 * pulls Node.js builtins (stream, fs) that are awkward to polyfill in a
 * client bundle, and is a frequent source of CSP / chunk-loading issues in
 * production. The trade-off (one extra round-trip) is negligible vs. shipping
 * ~250 KB of code to every browser that visits /import.
 *
 * Input is a base64-encoded buffer; output is a plain CSV string that the
 * existing paste path can consume unchanged.
 */
export type ExcelToCsvResult = { ok: true; csv: string } | { ok: false; error: string };

export async function excelToCsvAction(base64: string): Promise<ExcelToCsvResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "invalidEncoding" };
  }
  if (buffer.byteLength === 0) return { ok: false, error: "emptyFile" };
  if (buffer.byteLength > MAX_CSV_BYTES) return { ok: false, error: "fileTooLarge" };

  try {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    // ExcelJS's `load()` is typed for ArrayBuffer; in Node, Buffer is a
    // subclass of Uint8Array whose .buffer may be SharedArrayBuffer per TS,
    // so copy bytes into a fresh ArrayBuffer to satisfy the signature.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    await workbook.xlsx.load(ab);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      // Vercel function logs will show this so the caller can diagnose.
      console.error("excelToCsv: workbook parsed but had no sheets", {
        sheetCount: workbook.worksheets.length,
        creator: workbook.creator,
        size: buffer.byteLength,
      });
      return { ok: false, error: "noSheet" };
    }

    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const last = row.cellCount;
      for (let i = 1; i <= last; i++) {
        cells.push(csvEscape(extractCellText(row.getCell(i).value)));
      }
      lines.push(cells.join(","));
    });
    return { ok: true, csv: lines.join("\n") };
  } catch (err) {
    console.error("excelToCsv failed", err);
    return { ok: false, error: "parseFailed" };
  }
}

function extractCellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as {
      richText?: { text: string }[];
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      error?: unknown;
    };
    if (Array.isArray(v.richText)) return v.richText.map((rt) => rt.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return extractCellText(v.result);
    if ("formula" in v) return "";
    if (typeof v.error === "string") return v.error;
  }
  return String(value);
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Onboarding shortcut: read the bundled `docs/sample-transactions.csv` from
 * disk and import it. Read from the repo root so it survives being run from
 * any cwd. Marked as best-effort — if the file is missing in a packaged
 * build, callers fall back to the regular paste flow.
 */
export async function importSampleDataAction(): Promise<ImportActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const path = join(process.cwd(), "docs", "sample-transactions.csv");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    console.error("sample CSV read failed", path, err);
    return { ok: false, error: "sampleDataMissing" };
  }

  return runImport(text, { mode: "strict" });
}
