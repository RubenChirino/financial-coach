import "server-only";

import { db } from "@/db/client";
import { goals } from "@/db/schema";
import { getMonthSummary, getTopCategoriesThisMonth } from "@/lib/dashboard/summary";
import { getSpendingForecast } from "@/lib/predictions/forecast";
import { listRecurringSubscriptions, monthlyEquivalentCents } from "@/lib/recurring/list";
import { eq } from "drizzle-orm";

/**
 * Opportunities are deterministic, data-grounded suggestions — NOT investment
 * advice. Each one has a concrete dollar impact computed from the user's own
 * numbers so the user can verify the math.
 *
 * Five generators:
 *   1. Subscription overlap        — multiple charges in the same merchant niche.
 *   2. Top overspend category      — biggest category vs. its monthly budget.
 *   3. Goal completion projection  — when each savings goal hits, given current rate.
 *   4. Cumulative-savings reframe  — what 3-month projected savings could fund.
 *   5. Emergency-fund gap          — months-of-expenses vs. industry rule-of-thumb.
 *
 * Each generator returns null when its data is too thin to be honest.
 */

export type OpportunityKind =
  | "subscription_overlap"
  | "category_overspend"
  | "goal_projection"
  | "savings_runway"
  | "emergency_gap";

export interface Opportunity {
  kind: OpportunityKind;
  /** Localized — built by the generator using the labels passed in. */
  title: string;
  body: string;
  /** Concrete monthly impact estimate in cents (signed: positive = saves money). */
  monthlyImpactCents?: number;
  /** Optional deep-link to the relevant page. */
  href?: string;
}

export interface OpportunityLabels {
  // Subscription overlap
  subOverlapTitle: string; // "{n} subscriptions in {category}"
  subOverlapBody: string; // "Cancelling one could save {amount}/mo"
  // Category overspend
  overspendTitle: string; // "{category} is {pct}% over budget"
  overspendBody: string; // "Bring it back to budget to save {amount}/mo"
  // Goal projection
  goalProjectionTitle: string; // "{goal} on track for {date}"
  goalProjectionBodyWithDeadline: string; // "Need +{amount}/mo to hit your {date} target"
  goalProjectionBodyOpenEnded: string; // "Saving {amount}/mo gets you there"
  goalProjectionStalled: string; // "Goal stalled — no current saving rate"
  // Savings runway
  savingsRunwayTitle: string;
  savingsRunwayBody: string;
  savingsRunwayDeficit: string;
  // Emergency gap
  emergencyTitle: string;
  emergencyBody: string;
  // Generic action labels (not strictly used here, but reserved for href button text)
  noOpportunities: string;
}

interface BuildOpts {
  /** Owner whose data the opportunities are computed from. */
  userId: number;
  labels: OpportunityLabels;
  fmt: (cents: number) => string;
  fmtMonth: (date: Date) => string;
}

/**
 * Pull all the pieces and assemble the opportunity list. Single entry point
 * the page calls; pure async, no side effects.
 */
export async function buildOpportunities(opts: BuildOpts): Promise<Opportunity[]> {
  const { userId } = opts;
  const [forecast, monthSummary, topCats, subs, allGoals] = await Promise.all([
    getSpendingForecast({ userId, horizonMonths: 3 }),
    getMonthSummary(userId, 0),
    getTopCategoriesThisMonth(userId, 20, 0),
    listRecurringSubscriptions(userId),
    db.select().from(goals).where(eq(goals.userId, userId)),
  ]);

  const out: Opportunity[] = [];

  const overlap = detectSubscriptionOverlap(subs, opts);
  if (overlap) out.push(overlap);

  const overspend = detectCategoryOverspend(topCats, opts);
  if (overspend) out.push(overspend);

  const runway = describeSavingsRunway(forecast, monthSummary, opts);
  if (runway) out.push(runway);

  for (const g of allGoals) {
    const goalOpp = projectGoal(g, forecast, opts);
    if (goalOpp) out.push(goalOpp);
  }

  const gap = detectEmergencyGap(forecast, monthSummary, opts);
  if (gap) out.push(gap);

  return out;
}

function detectSubscriptionOverlap(
  subs: Awaited<ReturnType<typeof listRecurringSubscriptions>>,
  { labels, fmt }: BuildOpts,
): Opportunity | null {
  // Group active subscriptions by category. Two or more in the same category
  // is the trigger — likely an overlap (e.g. 3 streaming services).
  const buckets = new Map<string, typeof subs>();
  for (const s of subs) {
    if (!s.isActive) continue;
    const key = s.categoryId == null ? "uncategorized" : String(s.categoryId);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(s);
  }

  let best: { category: string; group: typeof subs; minMonthly: number } | null = null;
  for (const [key, group] of buckets) {
    if (group.length < 2 || key === "uncategorized") continue;
    const monthlies = group.map((s) =>
      monthlyEquivalentCents(s.averageAmountCents, s.frequencyDays),
    );
    const minMonthly = Math.min(...monthlies);
    if (!best || group.length > best.group.length || minMonthly > best.minMonthly) {
      const categoryName = group[0]?.categoryNameEn ?? group[0]?.categoryNameEs ?? key;
      best = { category: categoryName, group, minMonthly };
    }
  }

  if (!best || best.minMonthly <= 0) return null;
  return {
    kind: "subscription_overlap",
    title: labels.subOverlapTitle
      .replace("{n}", String(best.group.length))
      .replace("{category}", best.category),
    body: labels.subOverlapBody.replace("{amount}", fmt(best.minMonthly)),
    monthlyImpactCents: best.minMonthly,
    href: "/subscriptions",
  };
}

function detectCategoryOverspend(
  topCats: Awaited<ReturnType<typeof getTopCategoriesThisMonth>>,
  { labels, fmt }: BuildOpts,
): Opportunity | null {
  // Largest absolute over-budget overshoot wins. Skip categories with no budget.
  let best: { name: string; overshoot: number; pct: number } | null = null;
  for (const c of topCats) {
    if (!c.budgetMonthlyCents || c.budgetMonthlyCents <= 0) continue;
    const overshoot = c.spentCents - c.budgetMonthlyCents;
    if (overshoot <= 0) continue;
    const pct = Math.round((overshoot / c.budgetMonthlyCents) * 100);
    if (!best || overshoot > best.overshoot) {
      best = { name: c.nameEn, overshoot, pct };
    }
  }
  if (!best) return null;
  return {
    kind: "category_overspend",
    title: labels.overspendTitle
      .replace("{category}", best.name)
      .replace("{pct}", String(best.pct)),
    body: labels.overspendBody.replace("{amount}", fmt(best.overshoot)),
    monthlyImpactCents: best.overshoot,
    href: "/categories",
  };
}

function describeSavingsRunway(
  forecast: Awaited<ReturnType<typeof getSpendingForecast>>,
  _monthSummary: Awaited<ReturnType<typeof getMonthSummary>>,
  { labels, fmt }: BuildOpts,
): Opportunity | null {
  if (forecast.inputs.trailingMonths < 1) return null;
  const cumulative = forecast.cumulativeNetCents;
  const months = forecast.months.length;
  if (cumulative > 0) {
    return {
      kind: "savings_runway",
      title: labels.savingsRunwayTitle.replace("{months}", String(months)),
      body: labels.savingsRunwayBody.replace("{amount}", fmt(cumulative)),
      monthlyImpactCents: Math.round(cumulative / months),
      href: "/predictions",
    };
  }
  return {
    kind: "savings_runway",
    title: labels.savingsRunwayTitle.replace("{months}", String(months)),
    body: labels.savingsRunwayDeficit.replace("{amount}", fmt(-cumulative)),
    monthlyImpactCents: Math.round(cumulative / months),
    href: "/predictions",
  };
}

function projectGoal(
  goal: typeof goals.$inferSelect,
  forecast: Awaited<ReturnType<typeof getSpendingForecast>>,
  { labels, fmt, fmtMonth }: BuildOpts,
): Opportunity | null {
  const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
  if (remainingCents === 0) return null;

  const monthlyRate = forecast.months[0]?.projectedNetCents ?? 0;

  if (monthlyRate <= 0) {
    // Savings rate ≤ 0: the goal is stalled until the user spends less.
    return {
      kind: "goal_projection",
      title: `${goal.emoji} ${goal.title}`,
      body: labels.goalProjectionStalled,
      href: "/goals",
    };
  }

  if (goal.deadline) {
    const monthsRemaining = Math.max(
      1,
      Math.round((goal.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)),
    );
    const requiredMonthly = Math.ceil(remainingCents / monthsRemaining);
    const gap = requiredMonthly - monthlyRate;
    if (gap > 0) {
      return {
        kind: "goal_projection",
        title: `${goal.emoji} ${goal.title}`,
        body: labels.goalProjectionBodyWithDeadline
          .replace("{amount}", fmt(gap))
          .replace("{date}", fmtMonth(goal.deadline)),
        href: "/goals",
      };
    }
  }

  const monthsToHit = Math.ceil(remainingCents / monthlyRate);
  const projectedDate = new Date();
  projectedDate.setUTCMonth(projectedDate.getUTCMonth() + monthsToHit);
  return {
    kind: "goal_projection",
    title: labels.goalProjectionTitle
      .replace("{goal}", `${goal.emoji} ${goal.title}`)
      .replace("{date}", fmtMonth(projectedDate)),
    body: labels.goalProjectionBodyOpenEnded.replace("{amount}", fmt(monthlyRate)),
    monthlyImpactCents: monthlyRate,
    href: "/goals",
  };
}

function detectEmergencyGap(
  forecast: Awaited<ReturnType<typeof getSpendingForecast>>,
  _monthSummary: Awaited<ReturnType<typeof getMonthSummary>>,
  { labels, fmt }: BuildOpts,
): Opportunity | null {
  // Rule-of-thumb: 3-6 months of expenses in liquid emergency fund. If we
  // know average monthly expense, surface what that target looks like.
  const avgExpense = forecast.inputs.avgMonthlyExpenseCents;
  if (avgExpense <= 0) return null;
  const sixMonths = avgExpense * 6;
  return {
    kind: "emergency_gap",
    title: labels.emergencyTitle,
    body: labels.emergencyBody
      .replace("{three}", fmt(avgExpense * 3))
      .replace("{six}", fmt(sixMonths)),
    href: "/goals",
  };
}
