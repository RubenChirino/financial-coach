import "server-only";

import { db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";

export interface HeatmapDay {
  /** 1-indexed day of the month. */
  day: number;
  spentCents: number;
  receivedCents: number;
}

export interface HeatmapMonth {
  /** 0-indexed month (0 = January). */
  month: number;
  /** Always sized to the number of days in the month. */
  days: HeatmapDay[];
  totalSpentCents: number;
  totalReceivedCents: number;
  /** received − spent. Positive = saved, negative = overspent. */
  netCents: number;
}

export interface SpendingHeatmap {
  year: number;
  months: HeatmapMonth[];
  /** Used to normalize per-day red intensity. */
  maxDailySpendCents: number;
  /** Used to normalize per-month green intensity. */
  maxMonthlySavingCents: number;
  /** Years that have at least one transaction, ascending. Drives navigation. */
  availableYears: number[];
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Aggregate the year's transactions into a per-day and per-month heatmap shape.
 * Scoped to `userId` so each user only ever sees their own spending.
 *
 * Pass `"auto"` to pick the most recent year that has transactions (falling back
 * to the current year if the table is empty).
 */
export async function getSpendingHeatmap(
  userId: number,
  yearArg: number | "auto",
): Promise<SpendingHeatmap> {
  const availableYears = await getYearsWithTransactions(userId);
  const currentYear = new Date().getUTCFullYear();
  const year =
    yearArg === "auto"
      ? availableYears.length > 0
        ? Math.max(...availableYears)
        : currentYear
      : yearArg;
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const rows = await db
    .select({
      ts: transactions.bookingDate,
      amount: transactions.amountCents,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.bookingDate, start),
        lt(transactions.bookingDate, end),
      ),
    );

  const months: HeatmapMonth[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    days: Array.from({ length: daysInMonth(year, m) }, (_, d) => ({
      day: d + 1,
      spentCents: 0,
      receivedCents: 0,
    })),
    totalSpentCents: 0,
    totalReceivedCents: 0,
    netCents: 0,
  }));

  for (const r of rows) {
    const d = new Date(r.ts);
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const month = months[m];
    if (!month) continue;
    const cell = month.days[day - 1];
    if (!cell) continue;
    if (r.amount < 0) {
      const out = -r.amount;
      cell.spentCents += out;
      month.totalSpentCents += out;
    } else {
      cell.receivedCents += r.amount;
      month.totalReceivedCents += r.amount;
    }
  }

  let maxDailySpend = 0;
  let maxMonthlySaving = 0;
  for (const m of months) {
    m.netCents = m.totalReceivedCents - m.totalSpentCents;
    if (m.netCents > maxMonthlySaving) maxMonthlySaving = m.netCents;
    for (const d of m.days) {
      if (d.spentCents > maxDailySpend) maxDailySpend = d.spentCents;
    }
  }

  return {
    year,
    months,
    maxDailySpendCents: maxDailySpend,
    maxMonthlySavingCents: maxMonthlySaving,
    availableYears,
  };
}

async function getYearsWithTransactions(userId: number): Promise<number[]> {
  const rows = await db
    .select({ ts: transactions.bookingDate })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(eq(transactions.userId, userId));
  const years = new Set<number>();
  for (const r of rows) years.add(new Date(r.ts).getUTCFullYear());
  return [...years].sort((a, b) => a - b);
}
