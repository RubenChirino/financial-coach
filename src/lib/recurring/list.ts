import "server-only";

import { db } from "@/db/client";
import { categories, recurringSubscriptions } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";

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

export async function listRecurringSubscriptions(userId: number): Promise<SubscriptionRow[]> {
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
    // Subscriptions UI is for spending only — recurring inflows (payroll etc.)
    // are stored with negative `averageAmountCents` and feed the forecast,
    // but they don't belong in the "subscriptions" list which the user reads
    // as "things charging me". Filter them out here.
    .where(
      and(
        eq(recurringSubscriptions.userId, userId),
        gt(recurringSubscriptions.averageAmountCents, 0),
      ),
    )
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

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpcomingRenewal {
  id: number;
  merchantName: string;
  amountCents: number;
  frequencyDays: number;
  nextChargeAt: Date;
  daysUntil: number;
  categoryColor: string | null;
  categoryIcon: string | null;
}

/**
 * Active subscriptions whose next expected charge falls within `withinDays`.
 * The next charge is `lastSeenAt + frequencyDays`, rolled forward by whole
 * cycles until it lands in the future (so a sub last seen a cycle ago still
 * projects to its upcoming date). Sorted soonest-first.
 */
export async function getUpcomingRenewals(
  userId: number,
  opts?: { withinDays?: number },
): Promise<UpcomingRenewal[]> {
  const withinDays = Math.max(1, Math.min(opts?.withinDays ?? 35, 95));
  const subs = await listRecurringSubscriptions(userId);
  const now = Date.now();
  const out: UpcomingRenewal[] = [];
  for (const s of subs) {
    if (!s.isActive || s.frequencyDays <= 0) continue;
    const cycleMs = s.frequencyDays * DAY_MS;
    let next = s.lastSeenAt.getTime() + cycleMs;
    while (next < now) next += cycleMs;
    const daysUntil = Math.ceil((next - now) / DAY_MS);
    if (daysUntil > withinDays) continue;
    out.push({
      id: s.id,
      merchantName: s.merchantName,
      amountCents: s.averageAmountCents,
      frequencyDays: s.frequencyDays,
      nextChargeAt: new Date(next),
      daysUntil,
      categoryColor: s.categoryColor,
      categoryIcon: s.categoryIcon,
    });
  }
  out.sort((a, b) => a.nextChargeAt.getTime() - b.nextChargeAt.getTime());
  return out;
}

export interface SubscriptionsTotals {
  activeCount: number;
  monthlyTotalCents: number;
}

export async function getActiveSubscriptionsTotals(userId: number): Promise<SubscriptionsTotals> {
  const rows = await db
    .select({
      averageAmountCents: recurringSubscriptions.averageAmountCents,
      frequencyDays: recurringSubscriptions.frequencyDays,
      isActive: recurringSubscriptions.isActive,
    })
    .from(recurringSubscriptions)
    .where(
      and(
        eq(recurringSubscriptions.userId, userId),
        eq(recurringSubscriptions.isActive, true),
        // Outflows only — see comment in `listRecurringSubscriptions`.
        gt(recurringSubscriptions.averageAmountCents, 0),
      ),
    );
  let total = 0;
  for (const r of rows) total += monthlyEquivalentCents(r.averageAmountCents, r.frequencyDays);
  return { activeCount: rows.length, monthlyTotalCents: total };
}
