import "server-only";

import { db } from "@/db/client";
import { categories, goals, transactions } from "@/db/schema";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

/**
 * Given a goal that is linked to a category with a monthly budget, compute
 * how much was "saved" toward the goal by underspending against that budget.
 *
 * Month bucket = calendar UTC month between goal creation and now. For each
 * month we credit `max(0, budget - abs(expense_cents))` toward the goal.
 *
 * If the category has no budget, there's no baseline to measure underspend
 * against — we return `null` and the caller should leave `savedCents` alone.
 */
async function computeSavedFromCategory(
  _goalId: number,
  categoryId: number,
  startedAt: Date,
  targetCents: number,
): Promise<number | null> {
  // Look up the category's monthly budget.
  const catRow = await db
    .select({ budget: categories.budgetMonthlyCents })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  const budget = catRow[0]?.budget ?? null;
  if (!budget || budget <= 0) return null;

  // Normalize the starting month to its first day in UTC.
  const start = new Date(
    Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const now = new Date();
  const endExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );

  // Pull monthly sums of expense (negative) amounts for this category.
  const rows = await db
    .select({
      year: sql<number>`CAST(strftime('%Y', booking_date / 1000, 'unixepoch') AS INTEGER)`,
      month: sql<number>`CAST(strftime('%m', booking_date / 1000, 'unixepoch') AS INTEGER)`,
      spentAbs: sql<number>`CAST(COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS INTEGER)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, categoryId),
        gte(transactions.bookingDate, start),
        lt(transactions.bookingDate, endExclusive),
      ),
    )
    .groupBy(sql`strftime('%Y-%m', booking_date / 1000, 'unixepoch')`);

  const spentByMonth = new Map<string, number>();
  for (const r of rows) spentByMonth.set(`${r.year}-${r.month}`, r.spentAbs);

  // Walk every month from start → now and accumulate underspend savings.
  let saved = 0;
  const cursor = new Date(start);
  while (cursor.getTime() < endExclusive.getTime()) {
    const key = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth() + 1}`;
    const spent = spentByMonth.get(key) ?? 0;
    const delta = Math.max(0, budget - spent);
    saved += delta;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Capped at target — overflow is meaningless for the progress bar. Also
  // guard against the goal's manually-set saved value being higher than the
  // computed value: auto-track always wins for category-linked goals so the
  // UI stays deterministic.
  return Math.min(saved, targetCents);
}

/**
 * Recompute `savedCents` for every goal that has a linked category + budgeted
 * target. Goals without a category (or with no budget on the linked category)
 * are left alone — their progress continues to be manually bumped.
 *
 * Returns the number of rows that were actually updated so the caller can
 * show a toast like "3 goals updated".
 */
export async function recomputeAllGoalsProgress(): Promise<number> {
  const rows = await db
    .select({
      id: goals.id,
      categoryId: goals.categoryId,
      targetCents: goals.targetCents,
      savedCents: goals.savedCents,
      createdAt: goals.createdAt,
    })
    .from(goals)
    .where(isNotNull(goals.categoryId));

  let updated = 0;
  for (const g of rows) {
    if (!g.categoryId) continue;
    const computed = await computeSavedFromCategory(g.id, g.categoryId, g.createdAt, g.targetCents);
    if (computed == null) continue;
    if (computed === g.savedCents) continue;
    await db
      .update(goals)
      .set({ savedCents: computed, updatedAt: new Date() })
      .where(eq(goals.id, g.id));
    updated += 1;
  }
  return updated;
}
