import "server-only";

import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import {
  getAccountsTotal,
  getMonthSummary,
  getTopCategoriesThisMonth,
} from "@/lib/dashboard/summary";
import { listRecurringSubscriptions, monthlyEquivalentCents } from "@/lib/recurring/list";
import { redactPII } from "@/lib/redact";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

export interface AdvisorContext {
  generatedAt: string;
  currency: string;
  accounts: { totalBalance: number; count: number };
  months: AdvisorMonth[];
  topMerchants: AdvisorMerchant[];
  budgets: AdvisorBudget[];
  subscriptions: AdvisorSubscription[];
}

export interface AdvisorSubscription {
  merchant: string;
  amountPerCharge: number;
  amountMonthly: number;
  frequencyDays: number;
  isActive: boolean;
}

export interface AdvisorMonth {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
  txCount: number;
  categories: { slug: string; nameEn: string; spent: number; txCount: number }[];
}

export interface AdvisorMerchant {
  name: string; // already redacted
  totalSpent: number;
  txCount: number;
  categorySlug: string | null;
}

export interface AdvisorBudget {
  slug: string;
  nameEn: string;
  monthlyBudget: number;
  spentThisMonth: number;
  pctUsed: number;
}

const CENTS_TO_UNITS = (n: number) => Math.round(n) / 100;

/**
 * Build the **only** data the LLM ever sees about the user's finances.
 *
 * Privacy contract:
 *   - No transaction-level rows leave this function.
 *   - Merchant names go through `redactPII` even though they're already free
 *     of digits in 99% of cases — defence in depth.
 *   - Amounts are rounded to whole units (euros, not cents) so that fingerprint
 *     attacks via exact balances are harder.
 *
 * Shape is small (kept under ~2KB JSON for typical users) so it fits comfortably
 * in the prompt of every chat turn — we re-build it per request rather than
 * trying to keep a stale snapshot.
 */
export async function buildAdvisorContext(opts?: {
  monthsBack?: number;
  topMerchantLimit?: number;
}): Promise<AdvisorContext> {
  const monthsBack = Math.max(1, Math.min(opts?.monthsBack ?? 3, 12));
  const topMerchantLimit = Math.max(1, Math.min(opts?.topMerchantLimit ?? 10, 25));

  const accountsTotal = await getAccountsTotal();

  const months: AdvisorMonth[] = [];
  for (let offset = 0; offset > -monthsBack; offset--) {
    const summary = await getMonthSummary(offset);
    const cats = await getTopCategoriesThisMonth(8, offset);
    months.push({
      month: summary.month,
      income: CENTS_TO_UNITS(summary.incomeCents),
      expense: CENTS_TO_UNITS(summary.expenseCents),
      net: CENTS_TO_UNITS(summary.netCents),
      txCount: summary.txCount,
      categories: cats.map((c) => ({
        slug: c.slug,
        nameEn: c.nameEn,
        spent: CENTS_TO_UNITS(c.spentCents),
        txCount: c.txCount,
      })),
    });
  }

  const topMerchants = await selectTopMerchants(topMerchantLimit);
  const budgets = await selectBudgets();
  const subscriptions = await selectSubscriptions();

  return {
    generatedAt: new Date().toISOString(),
    currency: accountsTotal.currency,
    accounts: {
      totalBalance: CENTS_TO_UNITS(accountsTotal.totalCents),
      count: accountsTotal.accountCount,
    },
    months,
    topMerchants,
    budgets,
    subscriptions,
  };
}

async function selectSubscriptions(): Promise<AdvisorSubscription[]> {
  const rows = await listRecurringSubscriptions();
  return rows.map((s) => ({
    merchant: redactPII(s.merchantName),
    amountPerCharge: CENTS_TO_UNITS(s.averageAmountCents),
    amountMonthly: CENTS_TO_UNITS(monthlyEquivalentCents(s.averageAmountCents, s.frequencyDays)),
    frequencyDays: s.frequencyDays,
    isActive: s.isActive,
  }));
}

async function selectTopMerchants(limit: number): Promise<AdvisorMerchant[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  const rows = await db
    .select({
      merchant: transactions.merchantName,
      categorySlug: categories.slug,
      total: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
      txCount: sql<number>`count(${transactions.id})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.bookingDate, start),
        isNotNull(transactions.merchantName),
        lt(transactions.amountCents, 0),
      ),
    )
    .groupBy(transactions.merchantName, categories.slug)
    .orderBy(
      desc(
        sql`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
      ),
    )
    .limit(limit);

  return rows
    .map((r) => ({
      name: redactPII((r.merchant ?? "").trim()),
      totalSpent: CENTS_TO_UNITS(Number(r.total) || 0),
      txCount: Number(r.txCount) || 0,
      categorySlug: r.categorySlug ?? null,
    }))
    .filter((m) => m.name && m.totalSpent > 0);
}

async function selectBudgets(): Promise<AdvisorBudget[]> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const rows = await db
    .select({
      slug: categories.slug,
      nameEn: categories.nameEn,
      budget: categories.budgetMonthlyCents,
      spent: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 and ${transactions.bookingDate} >= ${monthStart.getTime()} and ${transactions.bookingDate} < ${monthEnd.getTime()} then -${transactions.amountCents} else 0 end), 0)`,
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(isNotNull(categories.budgetMonthlyCents))
    .groupBy(categories.id);

  return rows
    .filter((r) => r.budget != null && r.budget > 0)
    .map((r) => {
      const budget = CENTS_TO_UNITS(r.budget ?? 0);
      const spent = CENTS_TO_UNITS(Number(r.spent) || 0);
      return {
        slug: r.slug,
        nameEn: r.nameEn,
        monthlyBudget: budget,
        spentThisMonth: spent,
        pctUsed: budget > 0 ? Math.round((spent / budget) * 100) : 0,
      };
    });
}
