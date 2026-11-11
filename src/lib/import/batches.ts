import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, importBatches, transactions } from "@/db/schema";

/**
 * "running": the import is in progress. "interrupted": it has been running for
 * longer than any import takes, so the process died part-way; the rows it
 * inserted are whole and categorized, and the user can undo the batch or
 * re-import the same file to add exactly the missing rows.
 */
export type ImportBatchState = "complete" | "running" | "interrupted";

/** A running batch older than this is shown as interrupted. */
export const INTERRUPTED_AFTER_MS = 15 * 60 * 1000;

export interface ImportBatchRow {
  id: number;
  filename: string | null;
  rowsParsed: number;
  /** For a batch that is not complete: the rows actually in the database. */
  rowsInserted: number;
  rowsDuplicate: number;
  createdAt: Date;
  state: ImportBatchState;
}

export function importBatchState(
  status: "running" | "complete",
  createdAt: Date,
  now: Date = new Date(),
): ImportBatchState {
  if (status === "complete") return "complete";
  return now.getTime() - createdAt.getTime() > INTERRUPTED_AFTER_MS ? "interrupted" : "running";
}

export async function listImportBatches(userId: number): Promise<ImportBatchRow[]> {
  const rows = await db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      rowsParsed: importBatches.rowsParsed,
      // Finalize writes the count when the batch completes; until then (or if
      // it never does) count the rows that made it in. Written with qualified
      // names: Drizzle leaves columns unqualified in a single-table select,
      // which would bind the subquery's `id` to `transactions.id`.
      rowsInserted: sql<number>`case when "import_batches"."status" = 'complete' then "import_batches"."rows_inserted" else (select count(*) from "transactions" where "transactions"."import_batch_id" = "import_batches"."id") end`,
      rowsDuplicate: importBatches.rowsDuplicate,
      createdAt: importBatches.createdAt,
      status: importBatches.status,
    })
    .from(importBatches)
    .where(eq(importBatches.userId, userId))
    .orderBy(desc(importBatches.createdAt));
  const now = new Date();
  return rows.map(({ status, ...r }) => ({
    ...r,
    rowsInserted: Number(r.rowsInserted),
    state: importBatchState(status, r.createdAt, now),
  }));
}

export async function deleteImportBatch(
  userId: number,
  batchId: number,
): Promise<{ deleted: number }> {
  // Delete all transactions linked to this batch first (FK onDelete=set null
  // won't cascade-delete, it just nulls the FK — we want the rows gone). Scoped
  // by userId so one user can never delete another's transactions.
  const result = await db
    .delete(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.importBatchId, batchId)))
    .returning({ id: transactions.id, accountId: transactions.accountId });

  // Recompute and persist the balance for every affected account.
  // The balance field is a cached sum — it doesn't auto-update when rows are deleted.
  const affectedAccountIds = [
    ...new Set(result.map((r) => r.accountId).filter(Boolean)),
  ] as number[];
  for (const accountId of affectedAccountIds) {
    const sumRow = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)));
    await db
      .update(accounts)
      .set({ balanceCents: Number(sumRow[0]?.total ?? 0) })
      .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)));
  }

  // Delete the batch record itself.
  await db
    .delete(importBatches)
    .where(and(eq(importBatches.userId, userId), eq(importBatches.id, batchId)));

  return { deleted: result.length };
}

/** Live transaction count for a batch (useful for confirming the delete). */
export async function getBatchTransactionCount(userId: number, batchId: number): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.importBatchId, batchId)));
  return Number(r[0]?.n ?? 0);
}
