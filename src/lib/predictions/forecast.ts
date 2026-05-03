import "server-only";

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { listRecurringSubscriptions, monthlyEquivalentCents } from "@/lib/recurring/list";
import { and, gte, lt, sql } from "drizzle-orm";

/**
 * Forecasting strategy
 * --------------------
 * We deliberately avoid ML/regression here — with only a few months of personal
 * banking data the variance is too high for any fancy model to add real signal,
 * and the user has to *trust* the number. Instead we use a transparent two-part
 * model the UI can explain in one paragraph:
 *
 *   Projected income(month)   = trailing-3-month average of positive flows
 *                              + recurring inflows detected from the
 *                                subscriptions table (rare but happens —
 *                                payroll, alimony, fixed transfers).
 *
 *   Projected spending(month) = sum(active recurring outflows, normalized to
 *                                   monthly equivalent)
 *                              + trailing-3-month average of *non-recurring*
 *                                outflows (the variable component).
 *
 *   Projected savings(month)  = projected income − projected spending.
 *
 * "Non-recurring" is computed by subtracting a per-month recurring baseline
 * from total spending in each historical month, never letting the variable
 * component go negative. That handles the case where the heuristic flagged a
 * one-off as recurring without distorting the projection.
 *
 * The function returns the per-month projection AND the inputs (averages,
 * recurring totals) so the UI can show the user *why* the number is what it is.
 * Honest forecasts beat black-box ones in a coaching app.
 */

export interface ForecastInputs {
  trailingMonths: number;
  avgMonthlyIncomeCents: number;
  avgMonthlyExpenseCents: number;
  avgMonthlyVariableExpenseCents: number;
  recurringMonthlyOutCents: number;
  recurringMonthlyInCents: number;
  /** Per-historical-month breakdown so the UI can show the trend. */
  history: { month: string; incomeCents: number; expenseCents: number; netCents: number }[];
  /** Top recurring outflows (already monthly-normalized). */
  recurringSubscriptions: {
    merchant: string;
    monthlyEquivCents: number;
    frequencyDays: number;
  }[];
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

function monthRange(offsetFromCurrent: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offsetFromCurrent;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, label };
}

/**
 * Pull income/expense per historical month, ordered oldest → newest.
 *
 * Strategy: look back up to MAX_LOOKBACK_MONTHS from today. If the trailing
 * window is empty (e.g. user imported data from 6 months ago and hasn't synced
 * since), we fall back to ALL available transaction months so older imports
 * still yield a forecast. We then take the N most-recent complete months.
 */
const MAX_LOOKBACK_MONTHS = 12;

async function getMonthlyHistory(
  wantMonths: number,
): Promise<{ month: string; incomeCents: number; expenseCents: number; netCents: number }[]> {
  // Exclude the current in-progress month so averages aren't skewed by a
  // partial month.
  const currentMonthStart = monthRange(0).start;
  const lookbackStart = monthRange(-MAX_LOOKBACK_MONTHS).start;

  const rows = await db
    .select({
      month: sql<string>`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`,
      income: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(gte(transactions.bookingDate, lookbackStart), lt(transactions.bookingDate, currentMonthStart)))
    .groupBy(sql`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`)
    .orderBy(sql`strftime('%Y-%m', datetime(${transactions.bookingDate} / 1000, 'unixepoch'))`);

  // Take the N most-recent months with any transactions.
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

async function getCurrency(): Promise<string> {
  const r = await db
    .select({ c: sql<string | null>`max(${transactions.currency})` })
    .from(transactions);
  return r[0]?.c ?? "EUR";
}

/**
 * Build a multi-month forecast. Both inputs and projections are returned so the
 * caller can explain the math to the user.
 */
export async function getSpendingForecast(opts?: {
  horizonMonths?: number;
}): Promise<SpendingForecast> {
  const horizon = Math.max(1, Math.min(opts?.horizonMonths ?? DEFAULT_HORIZON_MONTHS, 6));

  const [history, subscriptions, currency] = await Promise.all([
    getMonthlyHistory(TRAILING_WINDOW_MONTHS),
    listRecurringSubscriptions(),
    getCurrency(),
  ]);

  // Recurring monthly equivalents from the subscriptions table.
  const activeSubs = subscriptions.filter((s) => s.isActive);
  let recurringMonthlyOutCents = 0;
  let recurringMonthlyInCents = 0;
  const recurringTopList: ForecastInputs["recurringSubscriptions"] = [];
  for (const s of activeSubs) {
    const monthlyEquiv = monthlyEquivalentCents(s.averageAmountCents, s.frequencyDays);
    if (s.averageAmountCents < 0) {
      // Subscriptions store charges as positive values. Outflows are the norm.
      // (Defensive — if any negative slipped in, treat it as inflow.)
      recurringMonthlyInCents += -monthlyEquiv;
    } else {
      recurringMonthlyOutCents += monthlyEquiv;
    }
    recurringTopList.push({
      merchant: s.merchantName,
      monthlyEquivCents: Math.abs(monthlyEquiv),
      frequencyDays: s.frequencyDays,
    });
  }
  recurringTopList.sort((a, b) => b.monthlyEquivCents - a.monthlyEquivCents);

  const months = history.length;
  const avgMonthlyIncomeCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.incomeCents, 0) / months) : 0;
  const avgMonthlyExpenseCents =
    months > 0 ? Math.round(history.reduce((s, m) => s + m.expenseCents, 0) / months) : 0;

  // Variable = total expense − recurring baseline (floored at 0 so a noisy
  // recurring detection doesn't push the variable component negative).
  const variableExpenseSamples = history.map((m) =>
    Math.max(0, m.expenseCents - recurringMonthlyOutCents),
  );
  const avgMonthlyVariableExpenseCents =
    variableExpenseSamples.length > 0
      ? Math.round(
          variableExpenseSamples.reduce((s, v) => s + v, 0) / variableExpenseSamples.length,
        )
      : 0;

  const projectedExpenseCents = recurringMonthlyOutCents + avgMonthlyVariableExpenseCents;
  const projectedIncomeCents = Math.max(avgMonthlyIncomeCents, recurringMonthlyInCents);

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
      history,
      recurringSubscriptions: recurringTopList.slice(0, 8),
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
    projectedMonthlyNet: Math.round(monthly) / 100,
    cumulativeNet: Math.round(f.cumulativeNetCents) / 100,
    confidence: f.confidence,
  };
}

