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
    ruleMatched: number;
    rowErrors: { lineNumber: number; message: string }[];
    ai: AiDetectionInfo;
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
    const { accountRowId } = await ensureImportedAccount({
      encryptionKey: session.encryptionKey,
    });
    const currency = parsed.rows[0]?.currency;
    const ingest = await importParsedRows(parsed.rows, { accountRowId, currency });

    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/import");

    return {
      ok: true,
      data: {
        parsed: parsed.rows.length,
        inserted: ingest.inserted,
        duplicates: ingest.duplicates,
        ruleMatched: ingest.ruleMatched,
        rowErrors: parsed.errors.map((e) => ({ lineNumber: e.lineNumber, message: e.message })),
        ai,
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
): Promise<ImportActionResult> {
  return runImport(text, { mode });
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
