import "server-only";

import { db } from "@/db/client";
import { transactions } from "@/db/schema";

/**
 * Transaction identity.
 *
 * A transaction is identified by `(account_id, external_id)` and the unique
 * index `transactions_account_external_uniq` enforces it. Every insert goes
 * through {@link insertTransactionsIdempotent}, so the index — never a prior
 * read — decides what is a duplicate, and duplicates are only ever counted
 * against the caller's own account.
 */

/**
 * Rows per INSERT statement. A transaction row binds ~12 parameters, so 500
 * rows stay far below SQLite's 32,766 bound-variable limit (a single INSERT
 * of ~3,000 rows used to fail).
 */
export const INSERT_CHUNK_ROWS = 500;

export type NewTransactionRow = typeof transactions.$inferInsert;

export interface IdentifiedRow {
  externalId: string;
  /**
   * True when `externalId` was computed from the row's content (CSV hash, a
   * bank row without a provider id) rather than issued by the provider.
   */
  externalIdDerived?: boolean;
}

/**
 * Content-derived ids collide when a source legitimately contains identical
 * rows — two €2.00 coffees on the same day. The first occurrence keeps its id
 * unchanged (so ids already stored stay valid); the n-th occurrence (n ≥ 2)
 * becomes `id#n`. Deterministic in input order, so replaying the same input
 * yields the same ids and dedupes against what is already stored.
 *
 * Provider-issued ids are left untouched: a repeated provider id is the same
 * transaction, and the unique index collapses it.
 */
export function withOccurrenceOrdinals<T extends IdentifiedRow>(rows: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (!row.externalIdDerived) return row;
    const n = (seen.get(row.externalId) ?? 0) + 1;
    seen.set(row.externalId, n);
    return n === 1 ? row : { ...row, externalId: `${row.externalId}#${n}` };
  });
}

/**
 * Insert rows, skipping any whose `(account_id, external_id)` already exists.
 * Chunked so input size is unbounded. Returns only the rows actually inserted
 * (`RETURNING` reports nothing for a conflict), which is what callers count.
 */
export async function insertTransactionsIdempotent(
  rows: readonly NewTransactionRow[],
): Promise<{ id: number; externalId: string }[]> {
  const inserted: { id: number; externalId: string }[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    const out = await db
      .insert(transactions)
      .values(chunk)
      .onConflictDoNothing({
        target: [transactions.accountId, transactions.externalId],
      })
      .returning({ id: transactions.id, externalId: transactions.externalId });
    inserted.push(...out);
  }
  return inserted;
}
