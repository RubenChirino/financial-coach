import "server-only";

import { db } from "@/db/client";
import { budgets, categories, transactions } from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

export interface CategoryWithSpend {
  id: number;
  slug: string;
  nameEs: string;
  nameEn: string;
  icon: string;
  color: string;
  budgetMonthlyCents: number | null;
  sortOrder: number;
  spentThisMonthCents: number;
  txCount: number;
}

function monthStart(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function listCategoriesWithSpend(userId: number): Promise<CategoryWithSpend[]> {
  const { start, end } = monthStart();
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      nameEs: categories.nameEs,
      nameEn: categories.nameEn,
      icon: categories.icon,
      color: categories.color,
      budgetMonthlyCents: budgets.monthlyCents,
      sortOrder: categories.sortOrder,
      spentThisMonthCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 and ${transactions.bookingDate} >= ${start.getTime()} and ${transactions.bookingDate} < ${end.getTime()} then -${transactions.amountCents} else 0 end), 0)`,
      txCount: sql<number>`count(case when ${transactions.bookingDate} >= ${start.getTime()} and ${transactions.bookingDate} < ${end.getTime()} then 1 else null end)`,
    })
    .from(categories)
    .leftJoin(
      transactions,
      and(
        eq(transactions.categoryId, categories.id),
        eq(transactions.userId, userId),
        gte(transactions.bookingDate, start),
        lt(transactions.bookingDate, end),
      ),
    )
    .leftJoin(budgets, and(eq(budgets.categoryId, categories.id), eq(budgets.userId, userId)))
    .groupBy(categories.id)
    .orderBy(categories.sortOrder, categories.nameEs);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameEs: r.nameEs,
    nameEn: r.nameEn,
    icon: r.icon,
    color: r.color,
    budgetMonthlyCents: r.budgetMonthlyCents ?? null,
    sortOrder: r.sortOrder,
    spentThisMonthCents: Number(r.spentThisMonthCents) || 0,
    txCount: Number(r.txCount) || 0,
  }));
}
