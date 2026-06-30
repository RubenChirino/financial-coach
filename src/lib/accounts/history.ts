import "server-only";

import { db } from "@/db/client";
import { accounts, balanceHistory } from "@/db/schema";
import { and, asc, eq, gte, sql } from "drizzle-orm";

/** Start of the current UTC day. */
function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Snapshot every account's current balance into `balance_history`, at most once
 * per account per UTC day. Idempotent within a day — calling it repeatedly (on
 * each sync, manual edit, or cron tick) only writes the first time that day, so
 * the series stays one-point-per-day.
 *
 * Returns the number of snapshot rows written.
 */
export async function snapshotBalances(userId: number): Promise<number> {
  const todayStart = startOfTodayUTC();

  const accRows = await db
    .select({
      id: accounts.id,
      balanceCents: accounts.balanceCents,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  if (accRows.length === 0) return 0;

  // Which of this user's accounts already have a snapshot today?
  const todays = await db
    .select({ accountId: balanceHistory.accountId })
    .from(balanceHistory)
    .where(and(eq(balanceHistory.userId, userId), gte(balanceHistory.capturedAt, todayStart)));
  const already = new Set(todays.map((r) => r.accountId));

  const toInsert = accRows
    .filter((a) => !already.has(a.id))
    .map((a) => ({
      userId,
      accountId: a.id,
      balanceCents: a.balanceCents,
      currency: a.currency,
    }));
  if (toInsert.length === 0) return 0;

  await db.insert(balanceHistory).values(toInsert);
  return toInsert.length;
}

export interface NetWorthPoint {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  netCents: number;
}

export interface NetWorthSeries {
  points: NetWorthPoint[];
  currency: string;
}

/**
 * Net worth over time, one point per snapshot day. Since `snapshotBalances`
 * writes all of a user's accounts together, summing each day's snapshot rows
 * yields that day's net worth (liabilities are stored negative, so the sum is
 * already net of debts). Returns chronological points within `days`.
 */
export async function getNetWorthSeries(
  userId: number,
  opts?: { days?: number },
): Promise<NetWorthSeries> {
  const days = Math.max(7, Math.min(opts?.days ?? 180, 730));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', datetime(${balanceHistory.capturedAt} / 1000, 'unixepoch'))`,
      net: sql<number>`coalesce(sum(${balanceHistory.balanceCents}), 0)`,
      currency: sql<string | null>`max(${balanceHistory.currency})`,
    })
    .from(balanceHistory)
    .where(and(eq(balanceHistory.userId, userId), gte(balanceHistory.capturedAt, since)))
    .groupBy(sql`strftime('%Y-%m-%d', datetime(${balanceHistory.capturedAt} / 1000, 'unixepoch'))`)
    .orderBy(
      asc(sql`strftime('%Y-%m-%d', datetime(${balanceHistory.capturedAt} / 1000, 'unixepoch'))`),
    );

  return {
    points: rows.map((r) => ({ date: String(r.day), netCents: Number(r.net) || 0 })),
    currency: rows[0]?.currency ?? "EUR",
  };
}
