"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";

export interface DeleteAccountResult {
  ok: boolean;
  error?: string;
}

/**
 * Delete a single account row. The FK on `transactions.account_id` is
 * `ON DELETE CASCADE`, so all of the account's transactions go with it.
 *
 * The parent requisition / institution rows are intentionally left in place:
 *  - For real bank connections, the requisition is the unit users delete from
 *    /settings/bank, and other accounts may still belong to it.
 *  - For the synthetic "Imported" requisition, leaving it lets the next file
 *    import find it via `ensureImportedAccount` instead of recreating the
 *    institution + requisition each time.
 */
export async function deleteAccountAction(accountId: number): Promise<DeleteAccountResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  // Scoped by userId so a user can only ever delete their own account.
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, session.userId), eq(accounts.id, accountId)));

  revalidatePath("/");
  revalidatePath("/banks");
  revalidatePath("/transactions");
  return { ok: true };
}
