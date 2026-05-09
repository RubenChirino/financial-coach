import "server-only";

import { db } from "@/db/client";
import { recurringSubscriptions, transactions } from "@/db/schema";
import { detectRecurringSubscriptions } from "@/lib/recurring/detect";
import { listRecurringSubscriptions, monthlyEquivalentCents } from "@/lib/recurring/list";
import { and, eq, gte, lt, sql } from "drizzle-orm";

/**
 * Forecasting strategy
 * --------------------
 * We deliberately avoid ML/regression here — with only a few months of
 * personal banking data the variance is too high for any fancy model to add
 * real signal, and the user has to *trust* the number. Instead we layer
 * three transparent components the UI can explain in one paragraph:
 *
 *   Fixed income
 *     Detected recurring inflows (payroll-style deposits with stable
 *     amount + monthly cadence). When nothing was detected we fall back to
 *     the trailing-3-month average, but we keep the two figures separate
 *     so the user can see how "predictable" their income is.
 *
 *   Fixed outflows
 *     Detected recurring outflows from the subscriptions table — Netflix,
 *     gym, mortgage. These are the most certain part of next month's bill.
 *
 *   Habitual outflows
 *     Merchants the user pays often (e.g. groceries) where each charge
 *     varies but the *monthly total* at that merchant is stable across
 *     several months. We use the median monthly total as the predictable
 *     baseline. This is what catches the Mercadona pattern that the
 *     per-transaction recurring detector cannot.
 *
 *   Variable outflows
 *     Trailing-average residual = avg monthly spend − fixed − habitual,
 *     floored at 0.
 *
 *   Projected spending = fixed + habitual + variable.
 *   Projected savings  = projected income − projected spending.
 *
 * The function returns the per-month projection AND every input that fed
 * into it so the UI can show the user *why* the number is what it is.
 * Honest forecasts beat black-box ones in a coaching app.
 */

export interface HabitualMerchant {
  merchant: string;
  monthlyMedianCents: number;
  monthsSeen: number;
}

export interface RecurringInflow {
  source: string;
  monthlyEquivCents: number;
  frequencyDays: number;
}

export interface ForecastInputs {
  trailingMonths: number;
  avgMonthlyIncomeCents: number;
  avgMonthlyExpenseCents: number;
  avgMonthlyVariableExpenseCents: number;
  recurringMonthlyOutCents: number;
  recurringMonthlyInCents: number;
  habitualMonthlyOutCents: number;
  /** Per-historical-month breakdown so the UI can show the trend. */
  history: { month: string; incomeCents: number; expenseCents: number; netCents: number }[];
  /** Top recurring outflows (already monthly-normalized). */
  recurringSubscriptions: {
    merchant: string;
    monthlyEquivCents: number;
    frequencyDays: number;
  }[];
  /** Detected recurring inflows (payroll-style deposits). */
  recurringInflows: RecurringInflow[];
  /** Habitual variable merchants — frequent but per-tx amount fluctuates. */
  habitualMerchants: HabitualMerchant[];
}

export interface ForecastMonth {
  /** YYYY-MM */
  month: string;
  projectedIncomeCents: number;
  projectedExpenseCents: number;
  projectedNetCents: number;
}

export interface SpendingForecast {
  generatedAt: string;
  currency: string;
  months: ForecastMonth[];
  inputs: ForecastInputs;
  /** Cumulative net (savings or shortfall) across the projected window. */
  cumulativeNetCents: number;
  /**
   * `low` when we have <2 months of data, `medium` when 2-3, `high` when ≥4.
   * Surfaced in the UI so the user calibrates their trust.
   */
  confidence: "low" | "medium" | "high";
}

const DEFAULT_HORIZON_MONTHS = 3;
const TRAILING_WINDOW_MONTHS = 3;
const MAX_LOOKBACK_MONTHS = 12;
const HABITUAL_MIN_MONTHS = 2;
const HABITUAL_MIN_MONTHLY_CENTS = 3000; // €30 floor — drop noise
const HABITUAL_MAX_COV = 0.6;

function monthRange(offsetFromCurrent: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offsetFromCurrent;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, label };
}

function buildAccountFilter(accountId: number | undefined) {
  return accountId != null ? eq(transactions.accountId, accountId) : undefined;
}

/**
 * Pull income/expense per historical month, ordered oldest → newest. Excludes
 * the in-progress current month so a partial month doesn't pull averages down.
 */
async function getMonthlyHistory(
  wantMonths: number,
  accountId?: number,
): Promise<{ month: string; incomeCents: number; expenseCents: number; netCents: number }[]> {
  const currentMonthStart = monthRange(0).start;
  const lookbackStart = monthRange(-MAX_LOOKBACK_MONTHS).start;

  const conditions = [
    gte(transactions.bookingDate, lookbackStart),
    lt(transactions.bookingDate, currentMonthStart),
  ];
  const accountFilter = buildAccountFilter(accountId);
  if (accountFilter) conditions.push(accountFilter);

  const rows = await db
    .select({
      month: sql<string>`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`,
      income: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(sql`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`)
    .orderBy(sql`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`);

  const all = rows
    .map((r) => ({
      month: String(r.month),
      incomeCents: Number(r.income) || 0,
      expenseCents: Number(r.expense) || 0,
      netCents: (Number(r.income) || 0) - (Number(r.expense) || 0),
    }))
    .filter((r) => r.incomeCents > 0 || r.expenseCents > 0);

  return all.slice(-wantMonths);
}

async function getCurrency(accountId?: number): Promise<string> {
  const accountFilter = buildAccountFilter(accountId);
  const r = await db
    .select({ c: sql<string | null>`max(${transactions.currency})` })
    .from(transactions)
    .where(accountFilter ?? sql`1 = 1`);
  return r[0]?.c ?? "EUR";
}

/**
 * Find merchants the user spends at often where each charge varies but the
 * monthly total is stable. Examples: groceries, fuel, restaurants.
 *
 * Algorithm: for each merchant, build a per-month total over the trailing
 * window. Keep the merchant if it's seen in ≥ HABITUAL_MIN_MONTHS, the median
 * monthly total ≥ HABITUAL_MIN_MONTHLY_CENTS, and the CoV across monthly
 * totals ≤ HABITUAL_MAX_COV. The "predictable" amount per month is the median
 * (resistant to one-off outliers like a big restock).
 */
async function detectHabitualMerchants(
  windowStart: Date,
  windowEnd: Date,
  excludeMerchantKeys: Set<string>,
  accountId?: number,
): Promise<HabitualMerchant[]> {
  const conditions = [
    gte(transactions.bookingDate, windowStart),
    lt(transactions.bookingDate, windowEnd),
    lt(transactions.amountCents, 0),
  ];
  const accountFilter = buildAccountFilter(accountId);
  if (accountFilter) conditions.push(accountFilter);

  const rows = await db
    .select({
      merchant: transactions.merchantName,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(...conditions));

  // Group: merchant → month → total cents (positive)
  const byMerchant = new Map<string, { display: string; perMonth: Map<string, number> }>();
  for (const r of rows) {
    if (!r.merchant) continue;
    const display = r.merchant.trim();
    const key = normalizeMerchant(display);
    if (!key) continue;
    if (excludeMerchantKeys.has(key)) continue;

    const ym = `${r.bookingDate.getUTCFullYear()}-${String(r.bookingDate.getUTCMonth() + 1).padStart(2, "0")}`;
    let entry = byMerchant.get(key);
    if (!entry) {
      entry = { display, perMonth: new Map() };
      byMerchant.set(key, entry);
    }
    entry.perMonth.set(ym, (entry.perMonth.get(ym) ?? 0) + Math.abs(r.amountCents));
  }

  const detected: HabitualMerchant[] = [];
  for (const { display, perMonth } of byMerchant.values()) {
    const totals = [...perMonth.values()];
    if (totals.length < HABITUAL_MIN_MONTHS) continue;
    const med = median(totals);
    if (med < HABITUAL_MIN_MONTHLY_CENTS) continue;
    const cov = stdDev(totals) / mean(totals);
    if (cov > HABITUAL_MAX_COV) continue;
    detected.push({
      merchant: display,
      monthlyMedianCents: Math.round(med),
      monthsSeen: totals.length,
    });
  }

  detected.sort((a, b) => b.monthlyMedianCents - a.monthlyMedianCents);
  return detected;
}

/**
 * Same merchant-key normalization as the recurring detector — kept in sync so
 * the "exclude merchants already counted as recurring" hand-off works.
 */
function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(s\.?l\.?|s\.?a\.?|inc\.?|ltd\.?|sas|gmbh)\b/g, "")
    .replace(/\d{4,}/g, "")
    .trim();
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Build a multi-month forecast. Both inputs and projections are returned so
 * the caller can explain the math to the user. Pass `accountId` to scope all
 * stats to a single account; omit to forecast across the whole household.
 */
export async function getSpendingForecast(opts?: {
  horizonMonths?: number;
  accountId?: number;
}): Promise<SpendingForecast> {
  const horizon = Math.max(1, Math.min(opts?.horizonMonths ?? DEFAULT_HORIZON_MONTHS, 6));
  const accountId = opts?.accountId;

  // One-shot hydration: if the recurring table is empty (e.g. the user
  // imported transactions before the auto-detect-on-import wiring landed),
  // run detection once so the forecast surfaces fixed income / subscriptions
  // immediately. Subsequent calls skip this because the table is populated.
  const subCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(recurringSubscriptions);
  if (Number(subCount[0]?.n ?? 0) === 0) {
    try {
      await detectRecurringSubscriptions();
    } catch (err) {
      console.warn("on-demand recurring detection failed (non-fatal)", err);
    }
  }

  const [history, subscriptions, currency] = await Promise.all([
    getMonthlyHistory(TRAILING_WINDOW_MONTHS, accountId),
    listRecurringSubscriptions(),
    getCurrency(accountId),
  ]);

  // Recurring monthly equivalents from the subscriptions table.
  // Convention: averageAmountCents > 0 = outflow, < 0 = inflow.
  const activeSubs = subscriptions.filter((s) => s.isActive);
  let recurringMonthlyOutCents = 0;
  let recurringMonthlyInCents = 0;
  const recurringTopList: ForecastInputs["recurringSubscriptions"] = [];
  const recurringInflows: RecurringInflow[] = [];
  const recurringMerchantKeys = new Set<string>();
  for (const s of activeSubs) {
    const monthlyEquiv = monthlyEquivalentCents(s.averageAmountCents, s.frequencyDays);
    recurringMerchantKeys.add(normalizeMerchant(s.merchantName));
    if (s.averageAmountCents < 0) {
      recurringMonthlyInCents += -monthlyEquiv;
      recurringInflows.push({
        source: s.merchantName,
        monthlyEquivCents: -monthlyEquiv,
        frequencyDays: s.frequencyDays,
      });
    } else {
      recurringMonthlyOutCents += monthlyEquiv;
      recurringTopList.push({
        merchant: s.merchantName,
        monthlyEquivCents: monthlyEquiv,
        frequencyDays: s.frequencyDays,
      });
    }
  }
  recurringTopList.sort((a, b) => b.monthlyEquivCents - a.monthlyEquivCents);
  recurringInflows.sort((a, b) => b.monthlyEquivCents - a.monthlyEquivCents);

  // Habitual variable merchants (groceries-style). Look at the same trailing
  // window as the income/expense averages so the math stays consistent.
  const trailingStart = monthRange(-TRAILING_WINDOW_MONTHS).start;
  const trailingEnd = monthRange(0).start;
  const habitualMerchants = await detectHabitualMerchants(
    trailingStart,
    trailingEnd,
    recurringMerchantKeys,
    accountId,
  );
  const habitualMonthlyOutCents = habitualMerchants.reduce(
    (s, h) => s + h.monthlyMedianCents,
    0,
  );

  const months = history.length;
  const avgMonthlyIncomeCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.incomeCents, 0) / months) : 0;
  const avgMonthlyExpenseCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.expenseCents, 0) / months) : 0;

  // Variable = total expense − recurring − habitual baselines (per month,
  // floored at 0 so a noisy detection doesn't push it negative).
  const variableExpenseSamples = history.map((m) =>
    Math.max(0, m.expenseCents - recurringMonthlyOutCents - habitualMonthlyOutCents),
  );
  const avgMonthlyVariableExpenseCents =
    variableExpenseSamples.length > 0
      ? Math.round(
          variableExpenseSamples.reduce((s, v) => s + v, 0) / variableExpenseSamples.length,
        )
      : 0;

  const projectedExpenseCents =
    recurringMonthlyOutCents + habitualMonthlyOutCents + avgMonthlyVariableExpenseCents;
  // Income projection: prefer the detected recurring inflows when they exist
  // (they're the "predictable" floor); otherwise fall back to the historical
  // average so the forecast still works for users without a stable salary.
  const projectedIncomeCents =
    recurringMonthlyInCents > 0
      ? Math.max(recurringMonthlyInCents, avgMonthlyIncomeCents)
      : avgMonthlyIncomeCents;

  const projectedMonths: ForecastMonth[] = [];
  let cumulative = 0;
  for (let i = 1; i <= horizon; i++) {
    const { label } = monthRange(i);
    const net = projectedIncomeCents - projectedExpenseCents;
    cumulative += net;
    projectedMonths.push({
      month: label,
      projectedIncomeCents,
      projectedExpenseCents,
      projectedNetCents: net,
    });
  }

  let confidence: SpendingForecast["confidence"];
  if (months >= 4) confidence = "high";
  else if (months >= 2) confidence = "medium";
  else confidence = "low";

  return {
    generatedAt: new Date().toISOString(),
    currency,
    months: projectedMonths,
    cumulativeNetCents: cumulative,
    confidence,
    inputs: {
      trailingMonths: months,
      avgMonthlyIncomeCents,
      avgMonthlyExpenseCents,
      avgMonthlyVariableExpenseCents,
      recurringMonthlyOutCents,
      recurringMonthlyInCents,
      habitualMonthlyOutCents,
      history,
      recurringSubscriptions: recurringTopList.slice(0, 8),
      recurringInflows: recurringInflows.slice(0, 8),
      habitualMerchants: habitualMerchants.slice(0, 8),
    },
  };
}

/**
 * Compact view of the forecast meant to be embedded into the AI Coach context.
 * Smaller surface than the full SpendingForecast — just numbers, no history.
 */
export interface ForecastSummary {
  horizonMonths: number;
  avgMonthlyIncome: number;
  avgMonthlyExpense: number;
  recurringMonthlyOut: number;
  habitualMonthlyOut: number;
  recurringMonthlyIn: number;
  projectedMonthlyNet: number;
  cumulativeNet: number;
  confidence: "low" | "medium" | "high";
}

export function summarizeForecast(f: SpendingForecast): ForecastSummary {
  const monthly = f.months[0]?.projectedNetCents ?? 0;
  return {
    horizonMonths: f.months.length,
    avgMonthlyIncome: Math.round(f.inputs.avgMonthlyIncomeCents) / 100,
    avgMonthlyExpense: Math.round(f.inputs.avgMonthlyExpenseCents) / 100,
    recurringMonthlyOut: Math.round(f.inputs.recurringMonthlyOutCents) / 100,
    habitualMonthlyOut: Math.round(f.inputs.habitualMonthlyOutCents) / 100,
    recurringMonthlyIn: Math.round(f.inputs.recurringMonthlyInCents) / 100,
    projectedMonthlyNet: Math.round(monthly) / 100,
    cumulativeNet: Math.round(f.cumulativeNetCents) / 100,
    confidence: f.confidence,
  };
}
