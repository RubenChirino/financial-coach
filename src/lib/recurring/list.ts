import "server-only";

import { db } from "@/db/client";
import { categories, recurringSubscriptions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export interface SubscriptionRow {
  id: number;
  merchantName: string;
  averageAmountCents: number;
  frequencyDays: number;
  lastSeenAt: Date;
  isActive: boolean;
  categoryId: number | null;
  categoryNameEs: string | null;
  categoryNameEn: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
}

export async function listRecurringSubscriptions(): Promise<SubscriptionRow[]> {
  const rows = await db
    .select({
      id: recurringSubscriptions.id,
      merchantName: recurringSubscriptions.merchantName,
      averageAmountCents: recurringSubscriptions.averageAmountCents,
      frequencyDays: recurringSubscriptions.frequencyDays,
      lastSeenAt: recurringSubscriptions.lastSeenAt,
      isActive: recurringSubscriptions.isActive,
      categoryId: recurringSubscriptions.categoryId,
      categoryNameEs: categories.nameEs,
      categoryNameEn: categories.nameEn,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
    })
    .from(recurringSubscriptions)
    .leftJoin(categories, eq(categories.id, recurringSubscriptions.categoryId))
    // Active first, then by amount-per-month descending.
    .orderBy(
      desc(recurringSubscriptions.isActive),
      desc(recurringSubscriptions.averageAmountCents),
    );
  return rows;
}

/**
 * Normalise to a monthly cents figure. Weekly = ×4.345, biweekly = ×2.172,
 * monthly = ×1, quarterly = ×0.333, yearly = ×0.0833.
 *
 * We expose this as a function (not just inline math) so the dashboard widget
 * and the advisor context use the exact same arithmetic.
 */
export function monthlyEquivalentCents(averageAmountCents: number, frequencyDays: number): number {
  if (frequencyDays <= 0) return 0;
  const perMonth = 30 / frequencyDays;
  return Math.round(averageAmountCents * perMonth);
}

export interface SubscriptionsTotals {
  activeCount: number;
  monthlyTotalCents: number;
}

export async function getActiveSubscriptionsTotals(): Promise<SubscriptionsTotals> {
  const rows = await db
    .select({
      averageAmountCents: recurringSubscriptions.averageAmountCents,
      frequencyDays: recurringSubscriptions.frequencyDays,
      isActive: recurringSubscriptions.isActive,
    })
    .from(recurringSubscriptions)
    .where(eq(recurringSubscriptions.isActive, true));
  let total = 0;
  for (const r of rows) total += monthlyEquivalentCents(r.averageAmountCents, r.frequencyDays);
  return { activeCount: rows.length, monthlyTotalCents: total };
}
