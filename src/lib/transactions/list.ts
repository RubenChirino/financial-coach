import "server-only";

import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, categories, institutions, requisitions, transactions } from "@/db/schema";

export interface TransactionRow {
  id: number;
  bookingDate: Date;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
  categoryId: number | null;
  categorySlug: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  categoryNameEs: string | null;
  categoryNameEn: string | null;
  needsReview: boolean;
  accountName: string;
  ibanLast4: string | null;
  institutionName: string;
  /** Non-null when this row is one leg of a detected internal transfer. */
  transferGroupId: string | null;
}

const PAGE_SIZE = 50;

export async function listTransactions(opts: {
  /** Owner whose transactions to list — every query is scoped to this user. */
  userId: number;
  cursor?: { bookingDate: number; id: number } | null;
  accountId?: number;
  categoryId?: number;
  needsReviewOnly?: boolean;
  limit?: number;
  /** Full-text search across merchant name and raw description (case-insensitive). */
  query?: string;
  /**
   * Filter to specific calendar days (YYYY-MM-DD). When non-empty, pagination
   * is disabled — the result set is small by definition (≤ 7 days at most).
   */
  dates?: string[];
}): Promise<{ rows: TransactionRow[]; nextCursor: { bookingDate: number; id: number } | null }> {
  const conds = [eq(transactions.userId, opts.userId)];
  if (opts?.accountId) conds.push(eq(transactions.accountId, opts.accountId));
  if (opts?.categoryId) conds.push(eq(transactions.categoryId, opts.categoryId));
  if (opts?.needsReviewOnly) conds.push(eq(transactions.needsReview, true));
  if (opts?.query?.trim()) {
    const pattern = `%${opts.query.trim().toLowerCase()}%`;
    conds.push(
      or(
        sql`lower(${transactions.merchantName}) LIKE ${pattern}`,
        sql`lower(${transactions.rawDescription}) LIKE ${pattern}`,
      ) ?? sql`1=1`,
    );
  }
  if (opts?.dates?.length) {
    // Match rows whose booking_date falls on one of the selected UTC calendar days.
    conds.push(
      inArray(
        sql<string>`strftime('%Y-%m-%d', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`,
        opts.dates,
      ),
    );
  }
  if (opts?.cursor && !opts?.dates?.length) {
    conds.push(
      or(
        lte(transactions.bookingDate, new Date(opts.cursor.bookingDate)),
        and(
          eq(transactions.bookingDate, new Date(opts.cursor.bookingDate)),
          lte(transactions.id, opts.cursor.id),
        ),
      ) ?? sql`1=1`,
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      needsReview: transactions.needsReview,
      transferGroupId: transactions.transferGroupId,
      categoryId: categories.id,
      categorySlug: categories.slug,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      categoryNameEs: categories.nameEs,
      categoryNameEn: categories.nameEn,
      accountName: accounts.name,
      ibanLast4: accounts.ibanLast4,
      institutionName: institutions.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(requisitions, eq(requisitions.id, accounts.requisitionId))
    .innerJoin(institutions, eq(institutions.id, requisitions.institutionId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit((opts?.limit ?? PAGE_SIZE) + 1);

  const pageSize = opts?.limit ?? PAGE_SIZE;
  const slice = rows.slice(0, pageSize);
  const extra = rows[pageSize];
  const nextCursor = extra ? { bookingDate: extra.bookingDate.getTime(), id: extra.id } : null;

  return { rows: slice, nextCursor };
}

export async function getTransactionStats(userId: number) {
  const result = await db
    .select({
      count: sql<number>`count(*)`,
      needsReview: sql<number>`sum(case when ${transactions.needsReview} then 1 else 0 end)`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return result[0] ?? { count: 0, needsReview: 0 };
}
