import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, importBatches, requisitions } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { formatIban } from "@/lib/format/iban";
import { upsertInstitution } from "@/lib/ingest/institutions";
import { type IngestRow, ingestTransactions } from "@/lib/ingest/pipeline";
import type { ParsedCsvRow } from "./csv";

/**
 * CSV-imported transactions live under a synthetic bank connection so the rest
 * of the app (dashboard balance, transactions list joined on accounts →
 * requisitions → institutions) keeps working without special-casing.
 *
 * The chain: institution "Imported" → requisition "imported-local" → account
 * "Imported Transactions". The requisition status is `linked` so the user can
 * see it on the bank-connections page if they want to delete everything, but
 * there's no real GoCardless-side to talk to — the `gocardless*` columns hold
 * placeholder ciphertexts that would fail if the sync worker tried to decrypt
 * them against a non-existent API. That's fine because `syncAllAccountsAction`
 * filters by `requisitions.status = "linked"` AND hits the API — we gate the
 * imported-path elsewhere, below.
 */
const IMPORTED_INSTITUTION_GCID = "IMPORTED_LOCAL";
const IMPORTED_REFERENCE = "imported-local";
const IMPORTED_ACCOUNT_PLACEHOLDER = "imported-local-account";

export interface EnsureImportedAccountResult {
  accountRowId: number;
  institutionRowId: number;
  requisitionRowId: number;
}

/**
 * Idempotent: finds the Imported institution / requisition / account if they
 * already exist, otherwise creates them. Encrypts the placeholder IDs with the
 * session key so decrypt() stays uniform across the codebase.
 *
 * When `iban` is supplied, the account is keyed by the formatted IBAN so
 * imports from different banks/cards land in distinct accounts. When omitted,
 * a single shared "Imported Transactions" fallback is used (for files that
 * don't expose any account identifier).
 */
export async function ensureImportedAccount(opts: {
  userId: number;
  encryptionKey: Buffer;
  iban?: string | null;
  currency?: string | null;
}): Promise<EnsureImportedAccountResult> {
  const { userId } = opts;
  const institutionRowId = await upsertInstitution({
    gocardlessId: IMPORTED_INSTITUTION_GCID,
    name: "Imported",
    logoUrl: null,
    country: "ES",
  });

  // Requisitions are per-user: scope by userId so two users importing don't
  // share the single "imported-local" requisition row.
  const existingReq = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(
      and(
        eq(requisitions.userId, userId),
        eq(requisitions.institutionId, institutionRowId),
        eq(requisitions.reference, IMPORTED_REFERENCE),
      ),
    )
    .limit(1);

  const requisitionRowId =
    existingReq[0]?.id ??
    (
      await db
        .insert(requisitions)
        .values({
          userId,
          institutionId: institutionRowId,
          gocardlessRequisitionId: encrypt(IMPORTED_REFERENCE, opts.encryptionKey),
          status: "linked",
          reference: IMPORTED_REFERENCE,
          link: null,
          expiresAt: null,
        })
        .returning({ id: requisitions.id })
    )[0]?.id;

  if (!requisitionRowId) throw new Error("failed to ensure imported requisition");

  const accountName = opts.iban ? formatIban(opts.iban) : "Imported Transactions";
  const ibanLast4 = opts.iban ? opts.iban.slice(-4) : null;

  // Match an existing account by the user-visible name within the imported
  // requisition. Names are deterministic (formatted IBAN or the fallback
  // string), so this gives us a stable, plaintext-searchable key without
  // needing to decrypt every `gocardlessAccountId` cipher.
  const existingAcc = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.requisitionId, requisitionRowId),
        eq(accounts.name, accountName),
      ),
    )
    .limit(1);

  const accountRowId =
    existingAcc[0]?.id ??
    (
      await db
        .insert(accounts)
        .values({
          userId,
          requisitionId: requisitionRowId,
          gocardlessAccountId: encrypt(
            opts.iban ?? IMPORTED_ACCOUNT_PLACEHOLDER,
            opts.encryptionKey,
          ),
          ibanLast4,
          name: accountName,
          ownerName: null,
          balanceCents: 0,
          currency: opts.currency ?? "EUR",
        })
        .returning({ id: accounts.id })
    )[0]?.id;

  if (!accountRowId) throw new Error("failed to ensure imported account");

  return { accountRowId, institutionRowId, requisitionRowId };
}

/**
 * Stable, deterministic ID for a CSV row so a re-upload of the same file
 * doesn't double-insert. Uses only the fields the user directly provided —
 * not the line number, which shifts when rows are added/removed.
 *
 * Format: `importCsv:<sha256-hex>` — prefixed so it can never collide with a
 * real GoCardless transaction ID (those are opaque bank strings).
 */
export function dedupeIdFor(row: {
  date: Date;
  amountCents: number;
  currency: string;
  merchant: string | null;
  description: string;
}): string {
  const parts = [
    row.date.toISOString().slice(0, 10),
    String(row.amountCents),
    row.currency,
    (row.merchant ?? "").trim().toLowerCase(),
    row.description.trim().toLowerCase(),
  ].join("|");
  const hash = createHash("sha256").update(parts).digest("hex").slice(0, 32);
  return `importCsv:${hash}`;
}

export interface ImportParsedRowsResult {
  inserted: number;
  duplicates: number;
  /**
   * Rows collapsed against another row in the same file. Always 0 now:
   * identical rows in one file are distinct transactions and get occurrence
   * ordinals (see `withOccurrenceOrdinals`). Kept for the import UI.
   */
  intraBatchDuplicates: number;
  /** Rows already present in this account. */
  existingDuplicates: number;
  /** Inserted rows categorized by one of the user's rules / by a keyword. */
  ruleMatched: number;
  keywordMatched: number;
  batchId: number;
  /** First parsed row (if any) — useful for debugging mis-mapped columns. */
  sampleRow?: {
    date: string;
    amountCents: number;
    currency: string;
    merchant: string | null;
    description: string;
  };
}

/**
 * Import parsed rows through the ingestion pipeline (`lib/ingest/pipeline`):
 * content-hash identities with occurrence ordinals, rules and keywords applied
 * before insert, chunked idempotent inserts, then one atomic finalize that
 * sets the balance and completes the import batch. Uncategorized rows fall
 * into the normal "needs review" flow.
 *
 * The batch row is created first as "running", so a crash mid-import leaves a
 * visible, undoable partial import; re-importing the same file adds only the
 * missing rows.
 */
export async function importParsedRows(
  rows: ParsedCsvRow[],
  opts: {
    userId: number;
    accountRowId: number;
    currency?: string;
    filename?: string;
    /**
     * When true, skip dedupe entirely: each row gets the batch id and its row
     * index appended to its hash, so every row is new. Use when the user is
     * sure the file contains genuinely-new transactions that dedupe is
     * mistakenly flagging as duplicates.
     */
    forceReimport?: boolean;
    /**
     * Authoritative current balance pulled from the export's metadata header
     * (e.g. Santander's "Saldo: 2.832,29 EUR"). When set, we trust it as the
     * account's current balance rather than recomputing from the sum of
     * imported transactions — bank exports usually contain only a recent
     * window of activity, so summing rows produces a meaningless number.
     */
    accountBalanceCents?: number | null;
  },
): Promise<ImportParsedRowsResult> {
  // Always create a batch record so import history is complete, even if all
  // rows turn out to be duplicates. Finalize fills the counts.
  const batchRow = await db
    .insert(importBatches)
    .values({
      userId: opts.userId,
      filename: opts.filename ?? null,
      rowsParsed: rows.length,
      status: "running",
    })
    .returning({ id: importBatches.id });
  const batchId = batchRow[0]?.id;
  if (!batchId) throw new Error("failed to create import batch");

  // Every row's identity is its content hash; the pipeline gives identical
  // rows in one file occurrence ordinals. Force-reimport makes every row new
  // by appending the batch id and row index instead.
  const ingestRows: IngestRow[] = rows.map((r, idx) => {
    const baseId = dedupeIdFor({
      date: r.date,
      amountCents: r.amountCents,
      currency: r.currency,
      merchant: r.merchant,
      description: r.description,
    });
    return {
      externalId: opts.forceReimport ? `${baseId}:b${batchId}:${idx}` : baseId,
      externalIdDerived: !opts.forceReimport,
      bookingDate: r.date,
      valueDate: null,
      amountCents: r.amountCents,
      currency: r.currency,
      merchantName: r.merchant,
      rawDescription: r.description,
    };
  });

  // Prefer the export's own balance header (a real "current balance" snapshot
  // from the bank). Otherwise sum the account's rows — sensible only when the
  // import is the user's full ledger, but the best available.
  const result = await ingestTransactions({
    userId: opts.userId,
    source: "csv",
    importBatchId: batchId,
    accounts: [
      {
        accountId: opts.accountRowId,
        rows: ingestRows,
        balance:
          opts.accountBalanceCents != null
            ? { mode: "set", cents: opts.accountBalanceCents }
            : { mode: "sum" },
        currency: opts.currency ?? null,
      },
    ],
  });

  // Pick a sample from the parsed rows (not just inserted ones) so the user
  // can verify column mapping even when every row was deduped.
  const first = rows[0];
  const sampleRow = first
    ? {
        date: first.date.toISOString().slice(0, 10),
        amountCents: first.amountCents,
        currency: first.currency,
        merchant: first.merchant,
        description: first.description,
      }
    : undefined;

  return {
    inserted: result.inserted,
    duplicates: result.duplicates,
    intraBatchDuplicates: 0,
    existingDuplicates: result.duplicates,
    ruleMatched: result.ruleMatched,
    keywordMatched: result.keywordMatched,
    batchId,
    sampleRow,
  };
}
