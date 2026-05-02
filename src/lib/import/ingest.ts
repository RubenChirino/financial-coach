import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { accounts, institutions, requisitions, transactions } from "@/db/schema";
import { categorizeBatchByRules } from "@/lib/categorize";
import { encrypt } from "@/lib/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
 */
export async function ensureImportedAccount(opts: {
  encryptionKey: Buffer;
}): Promise<EnsureImportedAccountResult> {
  const existingInst = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.gocardlessId, IMPORTED_INSTITUTION_GCID))
    .limit(1);

  const institutionRowId =
    existingInst[0]?.id ??
    (
      await db
        .insert(institutions)
        .values({
          gocardlessId: IMPORTED_INSTITUTION_GCID,
          name: "Imported",
          logoUrl: null,
          country: "ES",
        })
        .returning({ id: institutions.id })
    )[0]?.id;

  if (!institutionRowId) throw new Error("failed to ensure imported institution");

  const existingReq = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(
      and(
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

  const existingAcc = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.requisitionId, requisitionRowId))
    .limit(1);

  const accountRowId =
    existingAcc[0]?.id ??
    (
      await db
        .insert(accounts)
        .values({
          requisitionId: requisitionRowId,
          gocardlessAccountId: encrypt(IMPORTED_ACCOUNT_PLACEHOLDER, opts.encryptionKey),
          ibanLast4: null,
          name: "Imported Transactions",
          ownerName: null,
          balanceCents: 0,
          currency: "EUR",
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
  ruleMatched: number;
}

/**
 * Insert parsed rows into the transactions table, deduping by a stable content
 * hash. After insert we run the deterministic rule-based categorizer against
 * the fresh rows only — staying LLM-free here so the /import action is
 * offline-safe and cheap. Uncategorized rows fall into the normal
 * "needs review" flow and can be categorized later via Settings → Categorize.
 *
 * Finally we recompute the synthetic account's balance as the running total of
 * all its transactions so the dashboard's "total balance" card reflects the
 * import without needing a bank API call.
 */
export async function importParsedRows(
  rows: ParsedCsvRow[],
  opts: { accountRowId: number; currency?: string },
): Promise<ImportParsedRowsResult> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0, ruleMatched: 0 };

  const allCandidates = rows.map((r) => ({
    externalId: dedupeIdFor({
      date: r.date,
      amountCents: r.amountCents,
      currency: r.currency,
      merchant: r.merchant,
      description: r.description,
    }),
    row: r,
  }));

  // Dedupe within the batch itself: bank exports often contain identical rows
  // (e.g. two 2.00 fees on the same day) which would otherwise collide on the
  // global UNIQUE(gocardless_transaction_id) constraint during insert.
  const seenInBatch = new Set<string>();
  const candidates: typeof allCandidates = [];
  let intraBatchDuplicates = 0;
  for (const c of allCandidates) {
    if (seenInBatch.has(c.externalId)) {
      intraBatchDuplicates++;
      continue;
    }
    seenInBatch.add(c.externalId);
    candidates.push(c);
  }

  // Check globally, not just on this account: the UNIQUE constraint on
  // gocardless_transaction_id spans the whole table.
  const existing = await db
    .select({ id: transactions.gocardlessTransactionId })
    .from(transactions)
    .where(
      inArray(
        transactions.gocardlessTransactionId,
        candidates.map((c) => c.externalId),
      ),
    );
  const existingIds = new Set(existing.map((r) => r.id));
  const fresh = candidates.filter((c) => !existingIds.has(c.externalId));

  const insertedIds: number[] = [];
  if (fresh.length > 0) {
    const inserted = await db
      .insert(transactions)
      .values(
        fresh.map((c) => ({
          accountId: opts.accountRowId,
          gocardlessTransactionId: c.externalId,
          bookingDate: c.row.date,
          valueDate: null,
          amountCents: c.row.amountCents,
          currency: c.row.currency,
          merchantName: c.row.merchant,
          rawDescription: c.row.description,
          needsReview: true,
        })),
      )
      .returning({ id: transactions.id });
    for (const r of inserted) insertedIds.push(r.id);
  }

  const ruleMatched = await categorizeBatchByRules(insertedIds);

  // Recompute balance from the sum of transactions on this account. Imported
  // accounts have no authoritative balance source, so the sum is it.
  const totalRow = await db
    .select({
      sum: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.accountId, opts.accountRowId));
  const newBalance = Number(totalRow[0]?.sum ?? 0);

  const updateSet: { balanceCents: number; lastSyncedAt: Date; currency?: string } = {
    balanceCents: newBalance,
    lastSyncedAt: new Date(),
  };
  if (opts.currency) updateSet.currency = opts.currency;

  await db.update(accounts).set(updateSet).where(eq(accounts.id, opts.accountRowId));

  return {
    inserted: fresh.length,
    duplicates: intraBatchDuplicates + (candidates.length - fresh.length),
    ruleMatched,
  };
}
