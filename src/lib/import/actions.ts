"use server";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth/session";
import { llmRefusalCode, resolveModelForUser } from "@/lib/llm/gateway";
import { type CsvMappingSpec, parseCsvWithAi, parseCsvWithSpec } from "./ai-mapper";
import { type ParseCsvResult, parseCsv } from "./csv";
import { type ExcelToCsvResult, excelToCsv } from "./excel";
import { ensureImportedAccount, importParsedRows } from "./ingest";
import { findRememberedMapping, rememberMapping } from "./mappings";
import { extractAccountMetadata } from "./metadata";

export interface AiDetectionInfo {
  used: boolean;
  provider?: string;
  model?: string;
  spec?: CsvMappingSpec;
  /** Set when AI was tried and threw (e.g. local Ollama daemon down). */
  error?: string;
  /** The mapping was remembered from an earlier import of this format: no model call. */
  remembered?: boolean;
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

interface RunImportOptions {
  /** "auto" (default) tries strict first then AI; "ai" forces AI; "strict" forces strict. */
  mode?: "auto" | "ai" | "strict";
  /** Original filename if the user picked a file (rather than pasting). */
  filename?: string;
  /** Bypass dedup checks. Each row gets a unique id so the UNIQUE constraint passes. */
  forceReimport?: boolean;
  /**
   * Let a read-only guest through. The ONLY caller that may set this is
   * `importSampleDataAction`, which imports a fixed, repo-bundled CSV of
   * fictional transactions into the guest's own throwaway row. Never set it
   * on a path that carries user-supplied text — that would hand guests a
   * general write primitive.
   */
  allowGuest?: boolean;
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

  // A format this user imported before: the remembered mapping, no model call.
  // Not when the user forced AI detection — that is how a wrong mapping is
  // replaced (the fresh answer overwrites the remembered one).
  const remembered = mode === "auto" ? await findRememberedMapping(userId, text) : null;
  if (remembered) {
    const again = parseCsvWithSpec(text, remembered.spec);
    if (!again.headerError && again.rows.length > 0) {
      return {
        kind: "parsed",
        parsed: { rows: again.rows, errors: again.errors, headerError: null },
        ai: {
          used: true,
          remembered: true,
          provider: remembered.provider,
          model: remembered.model,
          spec: again.spec,
        },
      };
    }
  }

  try {
    // Consent and the per-user quota are enforced by the gateway.
    const llm = await resolveModelForUser(userId, "csv-mapping");
    const aiResult = await parseCsvWithAi(llm, text);
    const ai: AiDetectionInfo = {
      used: true,
      provider: aiResult.provider,
      model: aiResult.model,
      spec: aiResult.spec,
    };
    if (aiResult.headerError) {
      return { kind: "error", error: `header:${aiResult.headerError}`, ai };
    }
    // A mapping that read rows is worth remembering for this bank's next export.
    if (aiResult.rows.length > 0) {
      await rememberMapping(userId, text, {
        spec: aiResult.spec,
        provider: aiResult.provider,
        model: aiResult.model,
      }).catch((err) => console.warn("could not remember the CSV mapping", err));
    }
    return {
      kind: "parsed",
      parsed: { rows: aiResult.rows, errors: aiResult.errors, headerError: null },
      ai,
    };
  } catch (err) {
    const refusal = llmRefusalCode(err);
    if (refusal) return { kind: "error", error: refusal };
    console.error("AI CSV import failed", err);
    const message = err instanceof Error ? err.message : "unknown";
    return { kind: "error", error: "aiUnavailable", ai: { used: true, error: message } };
  }
}

async function runImport(text: string, opts: RunImportOptions = {}): Promise<ImportActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest && !opts.allowGuest) return { ok: false, error: "guestReadOnly" };

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
      userId: session.userId,
      encryptionKey: session.encryptionKey,
      iban: meta.iban,
      currency: meta.currency,
    });
    const currency = meta.currency ?? parsed.rows[0]?.currency;
    const ingest = await importParsedRows(parsed.rows, {
      userId: session.userId,
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
 * Convert an uploaded Excel file (.xls, .xlsx) to CSV text on the server; see
 * `excelToCsv` for how cells are written. The file arrives as a `File` in
 * `FormData` — multipart, so a 2 MB file stays ~2 MB on the wire and fits
 * the server-action body limit, where base64 would add a third.
 */
export async function excelToCsvAction(form: FormData): Promise<ExcelToCsvResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "invalidEncoding" };
  if (file.size === 0) return { ok: false, error: "emptyFile" };
  if (file.size > MAX_CSV_BYTES) return { ok: false, error: "fileTooLarge" };
  return excelToCsv(new Uint8Array(await file.arrayBuffer()));
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

  // Guests are allowed here, and only here. Guest mode exists so someone can
  // evaluate the app, and every page is empty until transactions exist — the
  // empty states even tell them to import, which they otherwise cannot do.
  //
  // The exception is deliberately narrow: this action takes no arguments and
  // reads a fixed CSV of fictional transactions from the repo, so nothing
  // attacker-supplied reaches the importer. Rows land on the guest's own
  // `userId`, guest accounts are purged after 24h, and guest creation is
  // rate-limited per IP. Every other write path stays closed to guests.

  const path = join(process.cwd(), "docs", "sample-transactions.csv");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    console.error("sample CSV read failed", path, err);
    return { ok: false, error: "sampleDataMissing" };
  }

  return runImport(text, { mode: "strict", allowGuest: true });
}
