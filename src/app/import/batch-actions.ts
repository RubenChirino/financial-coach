"use server";

import { db } from "@/db/client";
import { accounts, importBatches, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { deleteImportBatch } from "@/lib/import/batches";
import { revalidatePath } from "next/cache";

export async function deleteImportBatchAction(
  batchId: number,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const { deleted } = await deleteImportBatch(batchId);
  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/");
  return { ok: true, deleted };
}

/**
 * Nuclear reset: wipes every transaction and every import batch record for this
 * installation. Intended as a "start over" escape hatch for when the user wants
 * to reimport from scratch — including rows imported before batch tracking was
 * added (which have no importBatchId and cannot be reached via per-batch delete).
 */
export async function resetAllTransactionsAction(): Promise<{
  ok: boolean;
  deletedTransactions?: number;
  error?: string;
}> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const deleted = await db.delete(transactions).returning({ id: transactions.id });
  await db.delete(importBatches);
  // Zero every stored account balance — balances are cached on the account row
  // and won't auto-clear when transactions are removed.
  await db.update(accounts).set({ balanceCents: 0 });

  revalidatePath("/");
  revalidatePath("/banks");
  revalidatePath("/import");
  revalidatePath("/transactions");

  return { ok: true, deletedTransactions: deleted.length };
}
