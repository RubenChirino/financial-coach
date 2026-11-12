import "server-only";

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db } from "@/db/client";
import { accounts, goals, insightDismissals, requisitions, transactions } from "@/db/schema";
import {
  getMonthSummary,
  getNeedsReviewCount,
  getTopCategoriesThisMonth,
} from "@/lib/dashboard/summary";
import { listRecurringSubscriptions } from "@/lib/recurring/list";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

/**
 * Insight rules.
 *
 * Insights are computed on read and never stored: `computeInsights` is
 * read-only, so rendering the dashboard writes nothing. Each rule gives every
 * insight a key that names what it is about:
 *
 *   needs_review                              transactions waiting for review
 *   overspend:<categoryId>:<YYYY-MM>          a budget exceeded this month
 *   on_track:<YYYY-MM>                        saving this month
 *   low_balance:<accountId>                   a linked account under €100
 *   goal_near:<goalId>                        a goal 80–99 % funded
 *   recurring_increase:<subscriptionId>:<cents>  a subscription's price rose
 *
 * Dismissing stores the key (`insight_dismissals`) and hides it for 30 days.
 * A key that changes — a new month, a new price — is a new insight and shows
 * again. Dashboard, notifications bell and email digest all read
 * `listActiveInsights` = computed − dismissed.
 *
 * No LLM calls. Text lives in `messages/*.json` under `insights`.
 */

export type InsightKind =
  | "overspend"
  | "needs_review"
  | "recurring_increase"
  | "low_balance"
  | "on_track"
  | "goal_near";
export type InsightSeverity = "info" | "warning" | "positive";

export interface InsightView {
  key: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}

/** How long a dismissal hides its key. */
export const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** A key is at most this long (keys are built from ids and numbers). */
export const MAX_INSIGHT_KEY_LENGTH = 120;

interface Hit {
  key: string;
  kind: InsightKind;
  severity: InsightSeverity;
  href: string;
  values?: Record<string, string | number>;
}

interface RuleContext {
  userId: number;
  locale: "es" | "en";
  /** `YYYY-MM` of `now` in UTC, the month the summary queries use. */
  month: string;
}

const intlLocale = (locale: RuleContext["locale"]) => (locale === "es" ? "es-ES" : "en-GB");

function money(cents: number, ctx: RuleContext, currency = "EUR", fractionDigits = 0): string {
  return (cents / 100).toLocaleString(intlLocale(ctx.locale), {
    style: "currency",
    currency,
    maximumFractionDigits: fractionDigits,
  });
}

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

async function ruleNeedsReview(ctx: RuleContext): Promise<Hit[]> {
  const count = await getNeedsReviewCount(ctx.userId);
  if (count === 0) return [];
  return [
    {
      key: "needs_review",
      kind: "needs_review",
      severity: "warning",
      href: "/transactions?review=1",
      values: { count },
    },
  ];
}

async function ruleOverspend(ctx: RuleContext): Promise<Hit[]> {
  const cats = await getTopCategoriesThisMonth(ctx.userId, 12, 0);
  return cats
    .filter((c) => c.budgetMonthlyCents && c.spentCents > c.budgetMonthlyCents)
    .map((c) => {
      const budget = c.budgetMonthlyCents as number;
      return {
        key: `overspend:${c.categoryId}:${ctx.month}`,
        kind: "overspend",
        severity: "warning",
        href: "/categories",
        values: {
          name: ctx.locale === "es" ? c.nameEs : c.nameEn,
          pct: Math.round(((c.spentCents - budget) / budget) * 100),
        },
      };
    });
}

async function ruleOnTrack(ctx: RuleContext): Promise<Hit[]> {
  const thisMonth = await getMonthSummary(ctx.userId, 0);
  if (thisMonth.netCents <= 0) return [];
  return [
    {
      key: `on_track:${ctx.month}`,
      kind: "on_track",
      severity: "positive",
      href: "/goals",
      values: { saved: money(thisMonth.netCents, ctx, thisMonth.currency || "EUR") },
    },
  ];
}

const LOW_BALANCE_CENTS = 10_000; // €100

async function ruleLowBalance(ctx: RuleContext): Promise<Hit[]> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, balanceCents: accounts.balanceCents })
    .from(accounts)
    .innerJoin(requisitions, eq(accounts.requisitionId, requisitions.id))
    .where(
      and(
        eq(accounts.userId, ctx.userId),
        eq(requisitions.status, "linked"),
        lt(accounts.balanceCents, LOW_BALANCE_CENTS),
        gte(accounts.balanceCents, 0),
      ),
    );
  return rows.map((a) => ({
    key: `low_balance:${a.id}`,
    kind: "low_balance",
    severity: "warning",
    href: "/banks",
    values: { name: a.name, balance: money(a.balanceCents, ctx) },
  }));
}

async function ruleGoalNear(ctx: RuleContext): Promise<Hit[]> {
  const near = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.userId, ctx.userId),
        sql`CAST(${goals.savedCents} AS REAL) / CAST(${goals.targetCents} AS REAL) >= 0.8`,
        sql`CAST(${goals.savedCents} AS REAL) / CAST(${goals.targetCents} AS REAL) < 1.0`,
      ),
    )
    .limit(2);
  return near.map((g) => ({
    key: `goal_near:${g.id}`,
    kind: "goal_near",
    severity: "positive",
    href: "/goals",
    values: {
      emoji: g.emoji,
      title: g.title,
      pct: Math.round((g.savedCents / g.targetCents) * 100),
    },
  }));
}

/**
 * Subscriptions whose latest charge jumped above their average — the silent
 * price hike. Needs a ≥ 15 % rise and at least €1, to ignore rounding noise.
 */
async function ruleRecurringIncrease(ctx: RuleContext): Promise<Hit[]> {
  const subs = await listRecurringSubscriptions(ctx.userId);
  const hits: Hit[] = [];
  for (const s of subs) {
    const avg = s.averageAmountCents;
    if (!s.isActive || !s.merchantName || avg <= 0) continue;
    const [latest] = await db
      .select({ amountCents: transactions.amountCents })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, ctx.userId),
          eq(transactions.merchantName, s.merchantName),
          lt(transactions.amountCents, 0),
          isNull(transactions.transferGroupId),
        ),
      )
      .orderBy(desc(transactions.bookingDate))
      .limit(1);
    const latestAbs = latest ? Math.abs(latest.amountCents) : 0;
    if (latestAbs < avg * 1.15 || latestAbs - avg < 100) continue;
    hits.push({
      key: `recurring_increase:${s.id}:${latestAbs}`,
      kind: "recurring_increase",
      severity: "warning",
      href: "/subscriptions",
      values: {
        merchant: s.merchantName,
        latest: money(latestAbs, ctx, "EUR", 2),
        average: money(avg, ctx, "EUR", 2),
        pct: Math.round(((latestAbs - avg) / avg) * 100),
      },
    });
  }
  return hits;
}

const RULES = [
  ruleNeedsReview,
  ruleOverspend,
  ruleOnTrack,
  ruleLowBalance,
  ruleGoalNear,
  ruleRecurringIncrease,
];

const SEVERITY_ORDER: Record<InsightSeverity, number> = { warning: 0, positive: 1, info: 2 };

function render(hits: Hit[], locale: RuleContext["locale"]): InsightView[] {
  const t = createTranslator({
    locale,
    messages: locale === "es" ? es : en,
    namespace: "insights",
  });
  // Keys are built from the kind, which `messages/*.json` covers for both locales.
  const text = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  return hits.map((h) => ({
    key: h.key,
    kind: h.kind,
    severity: h.severity,
    title: text(`${h.kind}.title`, h.values),
    body: text(`${h.kind}.body`, h.values),
    actionLabel: text(`${h.kind}.action`),
    actionHref: h.href,
  }));
}

/** Every insight that applies to the user now. Read-only. */
export async function computeInsights(
  userId: number,
  locale: string,
  now: Date = new Date(),
): Promise<InsightView[]> {
  const ctx: RuleContext = {
    userId,
    locale: locale === "en" ? "en" : "es",
    month: monthKey(now),
  };
  const hits = (await Promise.all(RULES.map((rule) => rule(ctx)))).flat();
  return render(hits, ctx.locale);
}

/** Computed insights minus those dismissed in the last 30 days; warnings first. */
export async function listActiveInsights(
  userId: number,
  locale: string,
  now: Date = new Date(),
): Promise<InsightView[]> {
  const [computed, dismissed] = await Promise.all([
    computeInsights(userId, locale, now),
    db
      .select({ key: insightDismissals.insightKey })
      .from(insightDismissals)
      .where(
        and(
          eq(insightDismissals.userId, userId),
          gte(insightDismissals.dismissedAt, new Date(now.getTime() - DISMISS_FOR_MS)),
        ),
      ),
  ]);
  const hidden = new Set(dismissed.map((d) => d.key));
  return computed
    .filter((i) => !hidden.has(i.key))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Dismiss insights by key. Only keys the user's rules produce right now are
 * stored — anything else is ignored. One batch: upsert the dismissals and
 * prune the user's expired ones. Returns the keys dismissed.
 */
export async function dismissInsights(
  userId: number,
  keys: readonly string[],
  locale: string,
  now: Date = new Date(),
): Promise<string[]> {
  const current = new Set((await computeInsights(userId, locale, now)).map((i) => i.key));
  const valid = [...new Set(keys)].filter((k) => current.has(k));
  const [first, ...rest] = valid;
  if (first === undefined) return [];
  const upsert = (key: string) =>
    db
      .insert(insightDismissals)
      .values({ userId, insightKey: key, dismissedAt: now })
      .onConflictDoUpdate({
        target: [insightDismissals.userId, insightDismissals.insightKey],
        set: { dismissedAt: now },
      });
  await db.batch([
    upsert(first),
    ...rest.map(upsert),
    db
      .delete(insightDismissals)
      .where(
        and(
          eq(insightDismissals.userId, userId),
          lt(insightDismissals.dismissedAt, new Date(now.getTime() - DISMISS_FOR_MS)),
        ),
      ),
  ]);
  return valid;
}
