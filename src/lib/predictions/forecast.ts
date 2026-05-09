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
 * transparent components the UI can explain in one paragraph:
 *
 *   Fixed income
 *     (a) recurring inflows from the strict detector (payroll with stable
 *     amount + monthly cadence) PLUS (b) habitual income — a payer seen in
 *     2+ months whose monthly total is stable. The habitual layer catches
 *     salary that varies a few % month-to-month (variable bonuses, taxes
 *     adjustments) which the strict detector rejects.
 *
 *   Fixed outflows (recurring)
 *     Detected recurring outflows from the subscriptions table — Netflix,
 *     gym, mortgage. The most certain part of next month's bill.
 *
 *   Habitual outflows
 *     Merchants the user pays often (groceries, fuel) where each charge
 *     varies but the monthly total at that merchant is stable. Median of
 *     monthly totals is the predictable baseline. This catches the
 *     Mercadona pattern that the per-transaction detector misses.
 *
 *   Variable outflows
 *     Per-month residual = monthly spend − recurring − habitual, floored
 *     at 0. The MEDIAN of those residuals is what we project. Median (not
 *     mean) keeps a single high-spend month — moving deposit, holiday,
 *     emergency — from inflating the projection for unrelated future months.
 *
 *   Projected income   = fixed income (or median monthly income if nothing
 *                                       habitual detected).
 *   Projected spending = recurring + habitual + variable median.
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

export interface HabitualIncomeSource {
  source: string;
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
  /** Median of (monthly_expense − recurring − habitual), floored at 0. */
  variableMonthlyExpenseCents: number;
  recurringMonthlyOutCents: number;
  recurringMonthlyInCents: number;
  habitualMonthlyOutCents: number;
  habitualMonthlyInCents: number;
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
  /** Habitual income sources — payer present in ≥ 2 months with stable monthly totals. */
  habitualIncomes: HabitualIncomeSource[];
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

interface HabitualEntry {
  display: string;
  monthlyMedianCents: number;
  monthsSeen: number;
}

/**
 * Generic "habitual party" detector — works for both outflows (merchants we
 * pay) and inflows (payers we receive from). For each party, build a
 * per-month total over the window. Keep the party if it's seen in
 * ≥ HABITUAL_MIN_MONTHS with a median monthly total ≥ HABITUAL_MIN_MONTHLY_CENTS
 * and a CoV across monthly totals ≤ HABITUAL_MAX_COV. The predictable amount
 * per month is the MEDIAN of monthly totals — resistant to one-off outliers
 * like a big restock or a one-time bonus payment.
 *
 * Pass `direction = "out"` for spending merchants (negative tx), `"in"` for
 * income sources (positive tx).
 */
async function detectHabitualParties(
  direction: "in" | "out",
  windowStart: Date,
  windowEnd: Date,
  excludeKeys: Set<string>,
  accountId?: number,
): Promise<HabitualEntry[]> {
  const signFilter =
    direction === "out"
      ? lt(transactions.amountCents, 0)
      : sql`${transactions.amountCents} > 0`;
  const conditions = [
    gte(transactions.bookingDate, windowStart),
    lt(transactions.bookingDate, windowEnd),
    signFilter,
  ];
  const accountFilter = buildAccountFilter(accountId);
  if (accountFilter) conditions.push(accountFilter);

  const rows = await db
    .select({
      merchant: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(...conditions));

  // Group: party → month → total cents (always positive in the map)
  const byParty = new Map<string, { display: string; perMonth: Map<string, number> }>();
  for (const r of rows) {
    // For income, merchant_name is often null (the bank stores the payer in
    // the description); fall back to the raw description so we don't lose
    // payroll deposits with no merchant_name.
    const displayRaw = (r.merchant ?? r.rawDescription ?? "").trim();
    if (!displayRaw) continue;
    const key = normalizeMerchant(displayRaw);
    if (!key) continue;
    if (excludeKeys.has(key)) continue;

    const ym = `${r.bookingDate.getUTCFullYear()}-${String(r.bookingDate.getUTCMonth() + 1).padStart(2, "0")}`;
    let entry = byParty.get(key);
    if (!entry) {
      entry = { display: displayRaw, perMonth: new Map() };
      byParty.set(key, entry);
    }
    entry.perMonth.set(ym, (entry.perMonth.get(ym) ?? 0) + Math.abs(r.amountCents));
  }

  const detected: HabitualEntry[] = [];
  for (const { display, perMonth } of byParty.values()) {
    const totals = [...perMonth.values()];
    if (totals.length < HABITUAL_MIN_MONTHS) continue;
    const med = median(totals);
    if (med < HABITUAL_MIN_MONTHLY_CENTS) continue;
    const cov = stdDev(totals) / mean(totals);
    if (cov > HABITUAL_MAX_COV) continue;
    detected.push({
      display,
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

  // Habitual outflows + inflows. Look at the same trailing window as the
  // income/expense averages so the math stays consistent.
  const trailingStart = monthRange(-TRAILING_WINDOW_MONTHS).start;
  const trailingEnd = monthRange(0).start;
  const [habitualOutEntries, habitualInEntries] = await Promise.all([
    detectHabitualParties("out", trailingStart, trailingEnd, recurringMerchantKeys, accountId),
    detectHabitualParties("in", trailingStart, trailingEnd, recurringMerchantKeys, accountId),
  ]);
  const habitualMerchants: HabitualMerchant[] = habitualOutEntries.map((e) => ({
    merchant: e.display,
    monthlyMedianCents: e.monthlyMedianCents,
    monthsSeen: e.monthsSeen,
  }));
  const habitualIncomes: HabitualIncomeSource[] = habitualInEntries.map((e) => ({
    source: e.display,
    monthlyMedianCents: e.monthlyMedianCents,
    monthsSeen: e.monthsSeen,
  }));
  const habitualMonthlyOutCents = habitualMerchants.reduce(
    (s, h) => s + h.monthlyMedianCents,
    0,
  );
  const habitualMonthlyInCents = habitualIncomes.reduce(
    (s, h) => s + h.monthlyMedianCents,
    0,
  );

  const months = history.length;
  const avgMonthlyIncomeCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.incomeCents, 0) / months) : 0;
  const avgMonthlyExpenseCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.expenseCents, 0) / months) : 0;

  // Variable = monthly expense − recurring − habitual baselines (floored at 0
  // so a noisy detection can't push it negative). Use MEDIAN, not mean, so a
  // single outlier month — moving deposit, holiday, emergency — doesn't
  // inflate the projection for unrelated future months. The user's complaint
  // about an unusual high-spend April skewing the next-month projection is
  // exactly the case median solves.
  const variableExpenseSamples = history.map((m) =>
    Math.max(0, m.expenseCents - recurringMonthlyOutCents - habitualMonthlyOutCents),
  );
  const variableMonthlyExpenseCents =
    variableExpenseSamples.length > 0 ? Math.round(median(variableExpenseSamples)) : 0;

  const projectedExpenseCents =
    recurringMonthlyOutCents + habitualMonthlyOutCents + variableMonthlyExpenseCents;

  // Income projection: sum of detected recurring inflows + habitual income
  // sources is the "predictable floor" and is what we project. Fall back to
  // the MEDIAN (not mean) of monthly income when nothing was detected — same
  // outlier-robustness rationale as the spending side.
  const fixedIncomeFromDetection = recurringMonthlyInCents + habitualMonthlyInCents;
  const projectedIncomeCents =
    fixedIncomeFromDetection > 0
      ? fixedIncomeFromDetection
      : months > 0
        ? Math.round(median(history.map((m) => m.incomeCents)))
        : 0;

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
      variableMonthlyExpenseCents,
      recurringMonthlyOutCents,
      recurringMonthlyInCents,
      habitualMonthlyOutCents,
      habitualMonthlyInCents,
      history,
      recurringSubscriptions: recurringTopList.slice(0, 8),
      recurringInflows: recurringInflows.slice(0, 8),
      habitualMerchants: habitualMerchants.slice(0, 8),
      habitualIncomes: habitualIncomes.slice(0, 8),
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
  habitualMonthlyIn: number;
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
    habitualMonthlyIn: Math.round(f.inputs.habitualMonthlyInCents) / 100,
    projectedMonthlyNet: Math.round(monthly) / 100,
    cumulativeNet: Math.round(f.cumulativeNetCents) / 100,
    confidence: f.confidence,
  };
}
