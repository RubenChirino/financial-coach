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

/**
 * Undo an import: its transactions, its batch record, and the cached balance
 * of every account it touched — one atomic batch, scoped to `userId` so one
 * user can never delete another's rows.
 *
 * The balance update runs first and sums each account's rows minus this
 * batch's, so the set of affected accounts and the new balances come from
 * the same snapshot as the delete (no read before the batch).
 */
export async function deleteImportBatch(
  userId: number,
  batchId: number,
): Promise<{ deleted: number }> {
  const [, deleted] = await db.batch([
    // The balance is a cached sum — it doesn't follow deleted rows. Qualified
    // names: the subquery's columns must bind to `transactions`, the outer
    // `accounts.id` to the row being updated.
    db.run(sql`update "accounts" set "balance_cents" = (
        select coalesce(sum("transactions"."amount_cents"), 0) from "transactions"
        where "transactions"."account_id" = "accounts"."id"
          and "transactions"."import_batch_id" is not ${batchId}
      )
      where "accounts"."user_id" = ${userId}
        and "accounts"."id" in (
          select "transactions"."account_id" from "transactions"
          where "transactions"."user_id" = ${userId} and "transactions"."import_batch_id" = ${batchId}
        )`),
    // The FK is ON DELETE SET NULL, which would orphan the rows rather than
    // remove them — so they are deleted explicitly.
    db
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.importBatchId, batchId)))
      .returning({ id: transactions.id }),
    db
      .delete(importBatches)
      .where(and(eq(importBatches.userId, userId), eq(importBatches.id, batchId))),
  ]);
  return { deleted: deleted.length };
}

/**
 * "Start over": every transaction and import batch of `userId`, and their
 * accounts' cached balances zeroed — one atomic batch. Reaches rows imported
 * before batch tracking existed, which per-batch undo cannot.
 */
export async function resetAllTransactions(userId: number): Promise<{ deleted: number }> {
  const [deleted] = await db.batch([
    db
      .delete(transactions)
      .where(eq(transactions.userId, userId))
      .returning({ id: transactions.id }),
    db.delete(importBatches).where(eq(importBatches.userId, userId)),
    db.update(accounts).set({ balanceCents: 0 }).where(eq(accounts.userId, userId)),
  ]);
  return { deleted: deleted.length };
}
