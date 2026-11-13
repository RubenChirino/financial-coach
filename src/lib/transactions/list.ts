import "server-only";

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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

/**
 * Keyset cursor: the LAST row of the page just returned. The next page holds
 * the rows strictly after it in `(booking_date DESC, id DESC)` order, so a
 * cursor never repeats or skips a row even when many rows share a date.
 */
export interface TransactionCursor {
  bookingDate: number;
  id: number;
}

/** Server-side filters. Every page of one listing must use the same set. */
export interface TransactionFilters {
  accountId?: number;
  categoryId?: number;
  needsReviewOnly?: boolean;
  /** Search across merchant name and raw description (case-insensitive). */
  query?: string;
}

export async function listTransactions(
  opts: TransactionFilters & {
    /** Owner whose transactions to list — every query is scoped to this user. */
    userId: number;
    cursor?: TransactionCursor | null;
    limit?: number;
    /**
     * Filter to specific calendar days (YYYY-MM-DD). When non-empty, pagination
     * is disabled — the result set is small by definition (≤ 31 days).
     */
    dates?: string[];
  },
): Promise<{ rows: TransactionRow[]; nextCursor: TransactionCursor | null }> {
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
    // Strict row comparison: (booking_date, id) < (cursor.date, cursor.id).
    const cursorDate = new Date(opts.cursor.bookingDate);
    conds.push(
      or(
        lt(transactions.bookingDate, cursorDate),
        and(eq(transactions.bookingDate, cursorDate), lt(transactions.id, opts.cursor.id)),
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
  // A row beyond the page means more exist; the cursor is the page's last row.
  const last = slice.at(-1);
  const nextCursor =
    rows.length > pageSize && last
      ? { bookingDate: last.bookingDate.getTime(), id: last.id }
      : null;

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
