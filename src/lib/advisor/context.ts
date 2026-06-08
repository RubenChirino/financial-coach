import "server-only";

import { db } from "@/db/client";
import { categories, goals, transactions } from "@/db/schema";
import {
  getAccountsTotal,
  getMonthSummary,
  getTopCategoriesThisMonth,
} from "@/lib/dashboard/summary";
import {
  type InvestorProfile,
  getInvestorProfile,
  summarizeProfileForLlm,
} from "@/lib/opportunities/profile";
import {
  type ForecastSummary,
  getSpendingForecast,
  summarizeForecast,
} from "@/lib/predictions/forecast";
import { listRecurringSubscriptions, monthlyEquivalentCents } from "@/lib/recurring/list";
import { redactPII } from "@/lib/redact";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

export interface AdvisorContext {
  generatedAt: string;
  currency: string;
  /**
   * The most recent month (YYYY-MM) for which the user actually has transactions.
   * The spending sections below are anchored to this month, NOT the current
   * calendar month — otherwise a user whose imported data ends a few months ago
   * would get an all-zero snapshot and the coach would wrongly claim it has no
   * data. Null only when there are no transactions at all.
   */
  dataThrough: string | null;
  accounts: { totalBalance: number; count: number };
  months: AdvisorMonth[];
  topMerchants: AdvisorMerchant[];
  budgets: AdvisorBudget[];
  subscriptions: AdvisorSubscription[];
  goals: AdvisorGoal[];
  /** Null if the user hasn't filled in the questionnaire yet. */
  investorProfile: ReturnType<typeof summarizeProfileForLlm> | null;
  forecast: ForecastSummary | null;
}

export interface AdvisorGoal {
  title: string;
  emoji: string;
  target: number;
  saved: number;
  pctComplete: number;
  remainingMonths: number | null;
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

/** First day (UTC) of the month `offset` months from the current month. */
function monthStartUTC(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/**
 * How many months back the user's most recent transaction is, as a non-positive
 * offset relative to the current month (0 = current month has data, -2 = latest
 * data is two months old). Returns 0 when there are no transactions or the
 * latest one is in the current/future month, so the snapshot defaults to the
 * usual "current month" anchor.
 */
async function latestDataMonthOffset(): Promise<number> {
  const rows = await db
    .select({ latest: sql<number | null>`max(${transactions.bookingDate})` })
    .from(transactions);
  const ms = rows[0]?.latest;
  if (ms == null) return 0;
  const latest = new Date(Number(ms));
  const now = new Date();
  const offset =
    (latest.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (latest.getUTCMonth() - now.getUTCMonth());
  return Math.min(0, offset);
}

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
  /** Required to load the user's investor profile. Optional — pass when known. */
  userId?: number;
}): Promise<AdvisorContext> {
  const monthsBack = Math.max(1, Math.min(opts?.monthsBack ?? 3, 12));
  const topMerchantLimit = Math.max(1, Math.min(opts?.topMerchantLimit ?? 10, 25));

  const accountsTotal = await getAccountsTotal();

  // Anchor every spending window to the user's most recent month of data instead
  // of "today". If the latest transaction is months old (common after a one-off
  // CSV import of historical data), a fixed last-3-calendar-months window would
  // be empty and the coach would falsely report it has no data to work with.
  const anchorOffset = await latestDataMonthOffset();

  const months: AdvisorMonth[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const offset = anchorOffset - i;
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

  const [topMerchants, budgets, subscriptions, advisorGoals, profile, forecast] = await Promise.all(
    [
      selectTopMerchants(topMerchantLimit, anchorOffset),
      selectBudgets(anchorOffset),
      selectSubscriptions(),
      selectGoals(),
      opts?.userId != null
        ? getInvestorProfile(opts.userId)
        : Promise.resolve<InvestorProfile | null>(null),
      getSpendingForecast({ horizonMonths: 3 }).catch(() => null),
    ],
  );

  return {
    generatedAt: new Date().toISOString(),
    currency: accountsTotal.currency,
    dataThrough: months.find((m) => m.txCount > 0)?.month ?? null,
    accounts: {
      totalBalance: CENTS_TO_UNITS(accountsTotal.totalCents),
      count: accountsTotal.accountCount,
    },
    months,
    topMerchants,
    budgets,
    subscriptions,
    goals: advisorGoals,
    investorProfile: profile ? summarizeProfileForLlm(profile) : null,
    forecast: forecast ? summarizeForecast(forecast) : null,
  };
}

async function selectGoals(): Promise<AdvisorGoal[]> {
  const rows = await db
    .select({
      title: goals.title,
      emoji: goals.emoji,
      targetCents: goals.targetCents,
      savedCents: goals.savedCents,
      deadline: goals.deadline,
    })
    .from(goals);
  const now = Date.now();
  return rows.map((r) => {
    const target = CENTS_TO_UNITS(r.targetCents);
    const saved = CENTS_TO_UNITS(r.savedCents);
    const pct = r.targetCents > 0 ? Math.round((r.savedCents / r.targetCents) * 100) : 0;
    const remainingMonths = r.deadline
      ? Math.max(0, Math.round((r.deadline.getTime() - now) / (1000 * 60 * 60 * 24 * 30)))
      : null;
    return {
      title: r.title,
      emoji: r.emoji,
      target,
      saved,
      pctComplete: pct,
      remainingMonths,
    };
  });
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

async function selectTopMerchants(limit: number, anchorOffset = 0): Promise<AdvisorMerchant[]> {
  // 3-month window ending at (and including) the anchor month.
  const start = monthStartUTC(anchorOffset - 2);
  const end = monthStartUTC(anchorOffset + 1);

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
        lt(transactions.bookingDate, end),
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

async function selectBudgets(anchorOffset = 0): Promise<AdvisorBudget[]> {
  const monthStart = monthStartUTC(anchorOffset);
  const monthEnd = monthStartUTC(anchorOffset + 1);

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
