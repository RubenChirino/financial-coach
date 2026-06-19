"use server";

import { db } from "@/db/client";
import { accounts, importBatches, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { deleteImportBatch } from "@/lib/import/batches";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function deleteImportBatchAction(
  batchId: number,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  const { deleted } = await deleteImportBatch(session.userId, batchId);
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
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  // Scoped to the current user: a reset must never touch another user's data.
  const deleted = await db
    .delete(transactions)
    .where(eq(transactions.userId, session.userId))
    .returning({ id: transactions.id });
  await db.delete(importBatches).where(eq(importBatches.userId, session.userId));
  // Zero this user's stored account balances — balances are cached on the account
  // row and won't auto-clear when transactions are removed.
  await db.update(accounts).set({ balanceCents: 0 }).where(eq(accounts.userId, session.userId));

  revalidatePath("/");
  revalidatePath("/banks");
  revalidatePath("/import");
  revalidatePath("/transactions");

  return { ok: true, deletedTransactions: deleted.length };
}
