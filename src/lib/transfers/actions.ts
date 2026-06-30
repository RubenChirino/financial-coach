"use server";

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { detectTransfers } from "./detect";

export interface TransferActionResult {
  ok: boolean;
  error?: string;
  detected?: number;
}

function revalidateMoneyViews() {
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/categories");
  revalidatePath("/predictions");
}

/**
 * Re-run internal transfer detection for the current user. Idempotent; safe to
 * call repeatedly. Used by the "re-scan transfers" affordance.
 */
export async function runTransferDetectionAction(): Promise<TransferActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  const detected = await detectTransfers({ userId: session.userId });
  revalidateMoneyViews();
  return { ok: true, detected };
}

/** Resolve the leg ids sharing a transaction's transfer group (1 or 2 rows). */
async function legsInGroup(userId: number, txId: number): Promise<number[]> {
  const row = await db
    .select({ groupId: transactions.transferGroupId })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, txId)))
    .limit(1);
  const groupId = row[0]?.groupId ?? null;
  if (!groupId) return [txId];
  const legs = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, groupId)));
  return legs.map((l) => l.id);
}

/**
 * User says "this is NOT a transfer". Clears the link on both legs and marks
 * them manual so the auto-detector won't re-link them on the next pass.
 */
export async function unlinkTransferAction(txId: number): Promise<TransferActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  const ids = await legsInGroup(session.userId, txId);
  for (const id of ids) {
    await db
      .update(transactions)
      .set({ transferGroupId: null, transferManual: true, updatedAt: new Date() })
      .where(and(eq(transactions.userId, session.userId), eq(transactions.id, id)));
  }
  revalidateMoneyViews();
  return { ok: true };
}

/**
 * User confirms an auto-detected pair. Marks both legs manual so the link is
 * locked in and survives re-detection.
 */
export async function confirmTransferAction(txId: number): Promise<TransferActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  const ids = await legsInGroup(session.userId, txId);
  for (const id of ids) {
    await db
      .update(transactions)
      .set({ transferManual: true, updatedAt: new Date() })
      .where(and(eq(transactions.userId, session.userId), eq(transactions.id, id)));
  }
  revalidateMoneyViews();
  return { ok: true };
}
