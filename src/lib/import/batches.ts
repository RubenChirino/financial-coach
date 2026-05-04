import "server-only";

import { db } from "@/db/client";
import { accounts, importBatches, transactions } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export interface ImportBatchRow {
  id: number;
  filename: string | null;
  rowsParsed: number;
  rowsInserted: number;
  rowsDuplicate: number;
  createdAt: Date;
}

export async function listImportBatches(): Promise<ImportBatchRow[]> {
  const rows = await db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      rowsParsed: importBatches.rowsParsed,
      rowsInserted: importBatches.rowsInserted,
      rowsDuplicate: importBatches.rowsDuplicate,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt));
  return rows;
}

export async function deleteImportBatch(batchId: number): Promise<{ deleted: number }> {
  // Delete all transactions linked to this batch first (FK onDelete=set null
  // won't cascade-delete, it just nulls the FK — we want the rows gone).
  const result = await db
    .delete(transactions)
    .where(eq(transactions.importBatchId, batchId))
    .returning({ id: transactions.id, accountId: transactions.accountId });

  // Recompute and persist the balance for every affected account.
  // The balance field is a cached sum — it doesn't auto-update when rows are deleted.
  const affectedAccountIds = [...new Set(result.map((r) => r.accountId).filter(Boolean))] as number[];
  for (const accountId of affectedAccountIds) {
    const sumRow = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    await db
      .update(accounts)
      .set({ balanceCents: Number(sumRow[0]?.total ?? 0) })
      .where(eq(accounts.id, accountId));
  }

  // Delete the batch record itself.
  await db.delete(importBatches).where(eq(importBatches.id, batchId));

  return { deleted: result.length };
}

/** Live transaction count for a batch (useful for confirming the delete). */
export async function getBatchTransactionCount(batchId: number): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.importBatchId, batchId));
  return Number(r[0]?.n ?? 0);
}
