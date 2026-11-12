"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth/session";
import { deleteImportBatch, resetAllTransactions } from "@/lib/import/batches";

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
  const { deleted } = await resetAllTransactions(session.userId);

  revalidatePath("/");
  revalidatePath("/banks");
  revalidatePath("/import");
  revalidatePath("/transactions");

  return { ok: true, deletedTransactions: deleted };
}
