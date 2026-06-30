import "server-only";

import { db } from "@/db/client";
import { accounts, insights, requisitions, transactions } from "@/db/schema";
import {
  getMonthSummary,
  getNeedsReviewCount,
  getTopCategoriesThisMonth,
} from "@/lib/dashboard/summary";
import { listRecurringSubscriptions } from "@/lib/recurring/list";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";

/**
 * Insight rule engine (Phase 7h).
 *
 * Call `runInsightEngine(locale)` after a bank sync or on first dashboard
 * load. The engine is idempotent: it deletes all non-dismissed insights and
 * re-derives them from the current DB state. Dismissed insights survive.
 *
 * Design principles:
 *   - No LLM calls — purely rule-based, fast, offline-capable.
 *   - Titles/bodies are pre-rendered in the user's active locale so the
 *     client component needs no translation context.
 *   - Severity: "warning" (needs action), "positive" (good news), "info".
 */

type InsightKind = (typeof insights.$inferInsert)["kind"];
type Severity = (typeof insights.$inferInsert)["severity"];

interface RuleResult {
  kind: InsightKind;
  entityId?: number | null;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  severity: Severity;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

async function ruleNeedsReview(userId: number, locale: string): Promise<RuleResult[]> {
  const count = await getNeedsReviewCount(userId);
  if (count === 0) return [];
  const es = locale === "es";
  return [
    {
      kind: "needs_review",
      title: es
        ? `${count} movimiento${count === 1 ? "" : "s"} sin revisar`
        : `${count} transaction${count === 1 ? "" : "s"} need review`,
      body: es
        ? "Algunos movimientos importados aún no tienen categoría. Clasificarlos mejora los análisis."
        : "Some imported transactions are uncategorised. Categorising them improves your budget analysis.",
      actionLabel: es ? "Revisar ahora" : "Review now",
      actionHref: "/transactions?review=1",
      severity: "warning",
    },
  ];
}

async function ruleOverspend(userId: number, locale: string): Promise<RuleResult[]> {
  const cats = await getTopCategoriesThisMonth(userId, 12, 0);
  const results: RuleResult[] = [];
  const es = locale === "es";
  for (const c of cats) {
    if (!c.budgetMonthlyCents || c.spentCents <= c.budgetMonthlyCents) continue;
    const overshootPct = Math.round(
      ((c.spentCents - c.budgetMonthlyCents) / c.budgetMonthlyCents) * 100,
    );
    const name = es ? c.nameEs : c.nameEn;
    results.push({
      kind: "overspend",
      entityId: c.categoryId,
      title: es ? `Presupuesto de ${name} superado` : `${name} budget exceeded`,
      body: es
        ? `Has gastado un ${overshootPct}% más de lo presupuestado en ${name} este mes.`
        : `You've spent ${overshootPct}% over your ${name} budget this month.`,
      actionLabel: es ? "Ver presupuestos" : "View budgets",
      actionHref: "/categories",
      severity: "warning",
    });
  }
  return results;
}

async function ruleOnTrack(userId: number, locale: string): Promise<RuleResult[]> {
  const thisMonth = await getMonthSummary(userId, 0);
  if (thisMonth.netCents <= 0) return [];
  const es = locale === "es";
  const saved = (thisMonth.netCents / 100).toLocaleString(es ? "es-ES" : "en-GB", {
    style: "currency",
    currency: thisMonth.currency || "EUR",
    maximumFractionDigits: 0,
  });
  return [
    {
      kind: "on_track",
      title: es ? "¡Vas bien este mes!" : "You're on track this month!",
      body: es
        ? `Llevas ${saved} ahorrados este mes. Sigue así.`
        : `You've saved ${saved} so far this month. Keep it up!`,
      actionLabel: es ? "Ver objetivos" : "View goals",
      actionHref: "/goals",
      severity: "positive",
    },
  ];
}

async function ruleLowBalance(userId: number, locale: string): Promise<RuleResult[]> {
  const LOW_THRESHOLD_CENTS = 10000; // €100
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, balanceCents: accounts.balanceCents })
    .from(accounts)
    .innerJoin(requisitions, eq(accounts.requisitionId, requisitions.id))
    .where(
      and(
        eq(accounts.userId, userId),
        eq(requisitions.status, "linked"),
        lt(accounts.balanceCents, LOW_THRESHOLD_CENTS),
        gte(accounts.balanceCents, 0),
      ),
    );
  const results: RuleResult[] = [];
  const es = locale === "es";
  for (const a of rows) {
    const bal = (a.balanceCents / 100).toLocaleString(es ? "es-ES" : "en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
    results.push({
      kind: "low_balance",
      entityId: a.id,
      title: es ? `Saldo bajo en ${a.name}` : `Low balance in ${a.name}`,
      body: es
        ? `El saldo de ${a.name} es ${bal}. Considera hacer una transferencia.`
        : `Your ${a.name} balance is ${bal}. Consider transferring funds.`,
      actionLabel: es ? "Ver cuentas" : "View accounts",
      actionHref: "/banks",
      severity: "warning",
    });
  }
  return results;
}

async function ruleGoalNear(userId: number, locale: string): Promise<RuleResult[]> {
  // Import dynamically to avoid circular dep
  const { goals: goalsTable } = await import("@/db/schema");
  const nearGoals = await db
    .select()
    .from(goalsTable)
    .where(
      and(
        eq(goalsTable.userId, userId),
        // ≥ 80% funded
        sql`CAST(${goalsTable.savedCents} AS REAL) / CAST(${goalsTable.targetCents} AS REAL) >= 0.8`,
        sql`CAST(${goalsTable.savedCents} AS REAL) / CAST(${goalsTable.targetCents} AS REAL) < 1.0`,
      ),
    )
    .limit(2);

  const results: RuleResult[] = [];
  const es = locale === "es";
  for (const g of nearGoals) {
    const pct = Math.round((g.savedCents / g.targetCents) * 100);
    results.push({
      kind: "goal_near",
      entityId: g.id,
      title: es
        ? `${g.emoji} ¡Casi alcanzas "${g.title}"!`
        : `${g.emoji} Almost there — "${g.title}"!`,
      body: es
        ? `Llevas el ${pct}% del objetivo. Un poco más y lo habrás conseguido.`
        : `You're ${pct}% of the way to your goal. One more push!`,
      actionLabel: es ? "Ver objetivo" : "View goal",
      actionHref: "/goals",
      severity: "positive",
    });
  }
  return results;
}

/**
 * Flag subscriptions whose most recent charge jumped meaningfully above their
 * historical average — the classic silent price hike. Requires a ≥15% rise and
 * at least €1 in absolute terms to avoid rounding noise.
 */
async function ruleRecurringIncrease(userId: number, locale: string): Promise<RuleResult[]> {
  const subs = await listRecurringSubscriptions(userId);
  const es = locale === "es";
  const fmt = (cents: number) =>
    (cents / 100).toLocaleString(es ? "es-ES" : "en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });

  const results: RuleResult[] = [];
  for (const s of subs) {
    if (!s.isActive || !s.merchantName) continue;
    const avg = s.averageAmountCents;
    if (avg <= 0) continue;

    const latest = await db
      .select({ amountCents: transactions.amountCents })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.merchantName, s.merchantName),
          lt(transactions.amountCents, 0),
          isNull(transactions.transferGroupId),
        ),
      )
      .orderBy(desc(transactions.bookingDate))
      .limit(1);
    const latestAbs = latest[0] ? Math.abs(latest[0].amountCents) : 0;
    if (latestAbs < avg * 1.15 || latestAbs - avg < 100) continue;

    const pct = Math.round(((latestAbs - avg) / avg) * 100);
    results.push({
      kind: "recurring_increase",
      entityId: s.id,
      title: es ? `${s.merchantName} subió de precio` : `${s.merchantName} got more expensive`,
      body: es
        ? `El último cargo de ${s.merchantName} fue ${fmt(latestAbs)}, un ${pct}% más que su media de ${fmt(avg)}.`
        : `Your latest ${s.merchantName} charge was ${fmt(latestAbs)} — ${pct}% above its ${fmt(avg)} average.`,
      actionLabel: es ? "Ver suscripciones" : "View subscriptions",
      actionHref: "/subscriptions",
      severity: "warning",
    });
  }
  return results;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Re-run all rules and refresh the `insights` table.
 * - Existing non-dismissed rows are deleted (stale signals).
 * - New rows are inserted.
 * - Dismissed rows are pruned after 30 days.
 *
 * Safe to call multiple times; cost is a handful of SELECT + DELETE + INSERT.
 */
export async function runInsightEngine(userId: number, locale = "es"): Promise<void> {
  // 1. Prune this user's dismissed insights older than 30 days.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .delete(insights)
    .where(
      and(
        eq(insights.userId, userId),
        isNotNull(insights.dismissedAt),
        lt(insights.dismissedAt, cutoff),
      ),
    );

  // 2. Delete this user's active (non-dismissed) insights to rederive.
  await db.delete(insights).where(and(eq(insights.userId, userId), isNull(insights.dismissedAt)));

  // 3. Run all rules (each scoped to this user).
  const all = (
    await Promise.all([
      ruleNeedsReview(userId, locale),
      ruleOverspend(userId, locale),
      ruleOnTrack(userId, locale),
      ruleLowBalance(userId, locale),
      ruleGoalNear(userId, locale),
      ruleRecurringIncrease(userId, locale),
    ])
  ).flat();

  if (all.length === 0) return;

  await db.insert(insights).values(
    all.map((r) => ({
      userId,
      kind: r.kind,
      entityId: r.entityId ?? null,
      title: r.title,
      body: r.body,
      actionLabel: r.actionLabel,
      actionHref: r.actionHref,
      severity: r.severity,
    })),
  );
}

/**
 * Load this user's active (non-dismissed) insights ordered by severity.
 */
export async function listActiveInsights(userId: number) {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), isNull(insights.dismissedAt)))
    .orderBy(
      // warnings first, then positive, then info
      sql`CASE ${insights.severity}
        WHEN 'warning'  THEN 1
        WHEN 'positive' THEN 2
        ELSE 3
      END`,
      insights.createdAt,
    );
}
