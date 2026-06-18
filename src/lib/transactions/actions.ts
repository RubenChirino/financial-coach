"use server";

import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { type TransactionRow, listTransactions } from "@/lib/transactions/list";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface SetTxCategoryResult {
  ok: boolean;
  error?: string;
}

/**
 * Manually re-assign a category to a transaction. User-driven assignments
 * are authoritative — confidence is clamped to 100 and `needsReview` goes
 * false so the auto-categorizer won't touch it again on the next run.
 */
export async function setTransactionCategoryAction(
  txId: number,
  categoryId: number | null,
): Promise<SetTxCategoryResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  if (categoryId != null) {
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);
    if (!cat[0]) return { ok: false, error: "categoryNotFound" };
  }

  await db
    .update(transactions)
    .set({
      categoryId,
      needsReview: false,
      confidence: categoryId == null ? null : 100,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, txId));

  revalidatePath("/transactions");
  revalidatePath("/");
  return { ok: true };
}

export interface CategoryOption {
  id: number;
  slug: string;
  nameEs: string;
  nameEn: string;
  icon: string;
  color: string;
}

export interface LoadMoreResult {
  rows: TransactionRow[];
  nextCursor: { bookingDate: number; id: number } | null;
}

/**
 * Load the next page of transactions after an existing cursor.
 * Used by the transactions list "Load more" button.
 */
export async function loadMoreTransactionsAction(
  cursor: { bookingDate: number; id: number },
  opts?: { needsReviewOnly?: boolean },
): Promise<LoadMoreResult> {
  const session = await getCurrentSession();
  if (!session) return { rows: [], nextCursor: null };
  const result = await listTransactions({
    cursor,
    needsReviewOnly: opts?.needsReviewOnly,
  });
  return result;
}

export async function listCategoryOptionsAction(): Promise<CategoryOption[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      nameEs: categories.nameEs,
      nameEn: categories.nameEn,
      icon: categories.icon,
      color: categories.color,
    })
    .from(categories)
    .orderBy(categories.sortOrder, categories.nameEs);
  return rows;
}
