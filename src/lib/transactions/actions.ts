"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { deriveRulePattern } from "@/lib/categorize/rules";
import { listTransactions, type TransactionRow } from "@/lib/transactions/list";

export interface SetTxCategoryResult {
  ok: boolean;
  error?: string;
  /**
   * Present when the manual pick could become a reusable rule. The UI offers
   * "always categorise {merchant}" → `createRuleFromTransactionAction`. Absent
   * when the category was cleared or no stable merchant pattern is derivable.
   */
  suggestRule?: { merchant: string };
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

  // Read the merchant before updating so we can offer a "remember this" rule.
  const before = await db
    .select({
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, session.userId)))
    .limit(1);

  await db
    .update(transactions)
    .set({
      categoryId,
      needsReview: false,
      confidence: categoryId == null ? null : 100,
      updatedAt: new Date(),
    })
    .where(and(eq(transactions.id, txId), eq(transactions.userId, session.userId)));

  revalidatePath("/transactions");
  revalidatePath("/");

  // Offer to learn a rule only on a real assignment (not a clear), and only
  // when a stable merchant pattern can be derived from the description.
  const row = before[0];
  if (categoryId != null && row) {
    const pattern = deriveRulePattern(row.merchantName, row.rawDescription);
    if (pattern) {
      const merchant = (row.merchantName ?? row.rawDescription).trim().slice(0, 40);
      return { ok: true, suggestRule: { merchant } };
    }
  }
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
    userId: session.userId,
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
