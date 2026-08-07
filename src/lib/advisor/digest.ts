import "server-only";

import {
  getAccountsTotal,
  getMonthSummary,
  getNeedsReviewCount,
  getTopCategoriesThisMonth,
} from "@/lib/dashboard/summary";

/**
 * Resolve a subset of ICU message syntax that the digest uses.
 *
 * next-intl's `t("key")` (called without the required variables) returns the
 * raw ICU template string, e.g.:
 *   "{count, plural, =1 {1 active subscription} other {# active subscriptions}} totalling {amount}/month."
 *
 * We then do manual `.replace("{count}", n)` in buildDigest, but that literal
 * string never appears inside an ICU plural clause — causing the raw template
 * to leak through to the UI.
 *
 * This helper:
 * 1. Resolves `{count, plural, =1 {...} other {...}}` → correct plural form,
 *    replacing `#` with the numeric count.
 * 2. Then replaces any remaining `{count}` simple variable.
 *
 * Only handles the `=1 / other` pattern used in the digest message keys.
 * Everything else passes through unchanged.
 */
function applyCount(template: string, count: number): string {
  // Match: {count, plural, =1 {…one…} other {…other…}}
  // The inner braces may themselves contain text but no nested `{…}`.
  const resolved = template.replace(
    /\{count\s*,\s*plural\s*,\s*=1\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_match, oneForm: string, otherForm: string) =>
      count === 1 ? oneForm : otherForm.replace("#", String(count)),
  );
  // Fall back: plain {count} variable (no plural clause).
  return resolved.replace("{count}", String(count));
}

import {
  getActiveSubscriptionsTotals,
  listRecurringSubscriptions,
  monthlyEquivalentCents,
} from "@/lib/recurring/list";
import { getTransactionStats } from "@/lib/transactions/list";

export type DigestItemKind = "warning" | "positive" | "suggestion" | "neutral";

export interface DigestItem {
  /** Stable key — used as React key + telemetry, never shown to user. */
  key: string;
  kind: DigestItemKind;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}

export interface DigestStat {
  key: string;
  label: string;
  value: string;
  /** Tailwind-friendly hex/var — used for the icon swatch tint only. */
  color: string;
  iconKey: "savings" | "subs" | "alerts" | "confidence";
}

export interface DigestPayload {
  generatedAt: string;
  headline: string;
  /** Always 0–3 items, even when there's nothing notable to flag. */
  items: DigestItem[];
  stats: DigestStat[];
  /** Whether there's enough data to bother showing a digest at all. */
  isEmpty: boolean;
}

/**
 * Strings injected by the caller (server component already has the right
 * locale via `getTranslations("advisor.digest")`).
 */
export interface DigestStrings {
  headlineSaving: string;
  headlineFlat: string;
  headlineEmpty: string;
  itemReviewTitle: string;
  itemReviewBody: string;
  itemReviewAction: string;
  itemSubsTitle: string;
  itemSubsBody: string;
  itemSubsAction: string;
  itemTopCatTitle: string;
  itemTopCatBody: string;
  itemTopCatAction: string;
  itemAllGoodTitle: string;
  itemAllGoodBody: string;
  itemAllGoodAction: string;
  statSavings: string;
  statSubs: string;
  statAlerts: string;
  statConfidence: string;
  confidenceLow: string;
  confidenceMedium: string;
  confidenceHigh: string;
}

/**
 * Build a 1-day digest from existing data. Deterministic, pure-derivation —
 * no LLM call. The proper rule-based `insights` engine lands in 7h and will
 * supersede this; until then, this gives the Coach digest tab something
 * truthful to render.
 *
 * Numeric inputs use the canonical helpers from `dashboard/summary` so the
 * advisor never disagrees with the dashboard.
 */
export async function buildDigest(
  userId: number,
  s: DigestStrings,
  fmt: (cents: number) => string,
): Promise<DigestPayload> {
  const [accountsTotal, thisMonth, lastMonth, needsReview, topCats, subsTotals, subs, txStats] =
    await Promise.all([
      getAccountsTotal(userId),
      getMonthSummary(userId, 0),
      getMonthSummary(userId, -1),
      getNeedsReviewCount(userId),
      getTopCategoriesThisMonth(userId, 5, 0),
      getActiveSubscriptionsTotals(userId),
      listRecurringSubscriptions(userId),
      getTransactionStats(userId),
    ]);

  const isEmpty = accountsTotal.accountCount === 0 && thisMonth.txCount === 0;

  // ── Headline ─────────────────────────────────────────────────────────
  const headline = isEmpty
    ? s.headlineEmpty
    : thisMonth.netCents > 0
      ? s.headlineSaving.replace("{amount}", fmt(thisMonth.netCents))
      : s.headlineFlat;

  // ── Items (max 3) ────────────────────────────────────────────────────
  const items: DigestItem[] = [];

  if (needsReview > 0) {
    items.push({
      key: "needs-review",
      kind: "warning",
      title: s.itemReviewTitle,
      body: applyCount(s.itemReviewBody, needsReview),
      actionLabel: s.itemReviewAction,
      actionHref: "/transactions?review=1",
    });
  }

  // Subscriptions: highlight if monthly cost is non-trivial OR we just have
  // many of them (>5). The threshold is a deliberately rough proxy for
  // "worth a glance" until 7h's heuristics replace it.
  if (subsTotals.activeCount >= 3 || subsTotals.monthlyTotalCents >= 3000) {
    items.push({
      key: "subs",
      kind: "suggestion",
      title: s.itemSubsTitle,
      body: applyCount(s.itemSubsBody, subsTotals.activeCount).replace(
        "{amount}",
        fmt(subsTotals.monthlyTotalCents),
      ),
      actionLabel: s.itemSubsAction,
      actionHref: "/subscriptions",
    });
  }

  // Top category trend: when last-month had spend in the top category and
  // this month is materially higher, surface it. We don't have per-category
  // last-month numbers without an extra query, so use total expense delta.
  const topCat = topCats[0];
  if (topCat && lastMonth.expenseCents !== 0) {
    const thisExp = Math.abs(thisMonth.expenseCents);
    const lastExp = Math.abs(lastMonth.expenseCents);
    if (lastExp > 0 && thisExp > lastExp * 1.15) {
      const pct = Math.round(((thisExp - lastExp) / lastExp) * 100);
      items.push({
        key: "top-cat-trend",
        kind: "warning",
        title: s.itemTopCatTitle,
        body: s.itemTopCatBody
          .replace("{pct}", String(pct))
          .replace("{amount}", fmt(thisExp - lastExp)),
        actionLabel: s.itemTopCatAction,
        actionHref: "/categories",
      });
    }
  }

  // Padding: if we have fewer than 1 item but data exists, drop in the
  // "all good" positive note so the digest never feels empty.
  if (items.length === 0 && !isEmpty) {
    items.push({
      key: "all-good",
      kind: "positive",
      title: s.itemAllGoodTitle,
      body: s.itemAllGoodBody,
      actionLabel: s.itemAllGoodAction,
      actionHref: "/advisor?tab=chat",
    });
  }

  // ── Stats strip ──────────────────────────────────────────────────────
  // "Potential savings": rough — sum of subscriptions that haven't fired in
  // > 60 days but are still flagged active. They're prime cancel candidates.
  const now = Date.now();
  const stale = subs.filter(
    (sub) => sub.isActive && now - sub.lastSeenAt.getTime() > 60 * 24 * 60 * 60 * 1000,
  );
  const potentialSavingsCents = stale.reduce(
    (sum, sub) => sum + monthlyEquivalentCents(sub.averageAmountCents, sub.frequencyDays),
    0,
  );

  // Coach confidence — proxy for how much the advisor knows. Scales with
  // total transaction count, since the LLM context tier (3 months window)
  // benefits from density. Thresholds are pragmatic, not scientific.
  const confidence =
    txStats.count < 30
      ? s.confidenceLow
      : txStats.count < 200
        ? s.confidenceMedium
        : s.confidenceHigh;

  const stats: DigestStat[] = [
    {
      key: "savings",
      label: s.statSavings,
      value: potentialSavingsCents > 0 ? `${fmt(potentialSavingsCents)}/mo` : "—",
      color: "#10B981",
      iconKey: "savings",
    },
    {
      key: "subs",
      label: s.statSubs,
      value: String(subs.length),
      color: "#EC4899",
      iconKey: "subs",
    },
    {
      key: "alerts",
      label: s.statAlerts,
      value: String(items.filter((i) => i.kind === "warning").length),
      color: "#F59E0B",
      iconKey: "alerts",
    },
    {
      key: "confidence",
      label: s.statConfidence,
      value: confidence,
      color: "#5389FF",
      iconKey: "confidence",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    headline,
    items: items.slice(0, 3),
    stats,
    isEmpty,
  };
}

/**
 * Snapshot of what the chat side-panel shows ("Coach has context on…").
 */
export interface ChatContextSnapshot {
  accountCount: number;
  txCount: number;
  budgetCount: number;
  subscriptionCount: number;
}

export async function getChatContextSnapshot(userId: number): Promise<ChatContextSnapshot> {
  const [accountsTotal, txStats, topCats, subsTotals] = await Promise.all([
    getAccountsTotal(userId),
    getTransactionStats(userId),
    getTopCategoriesThisMonth(userId, 50, 0),
    getActiveSubscriptionsTotals(userId),
  ]);
  return {
    accountCount: accountsTotal.accountCount,
    txCount: Number(txStats.count) || 0,
    budgetCount: topCats.filter((c) => c.budgetMonthlyCents != null).length,
    subscriptionCount: subsTotals.activeCount,
  };
}
