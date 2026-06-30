import { AppShell } from "@/components/app-shell";
import { AddBankTile, BankTile } from "@/components/dashboard/bank-tile";
import { CategoriesCard, type CategorySpendRow } from "@/components/dashboard/categories-card";
import { CoachBriefCard } from "@/components/dashboard/coach-brief-card";
import { DonutCard } from "@/components/dashboard/donut-card";
import { InsightsList } from "@/components/dashboard/insights-list";
import { MonthlyFlowCard } from "@/components/dashboard/monthly-flow-card";
import {
  type RecentTransactionRow,
  RecentTransactionsCard,
} from "@/components/dashboard/recent-transactions-card";
import { TotalBalanceCard } from "@/components/dashboard/total-balance-card";
import { type DashboardVariant, VariantSwitcher } from "@/components/dashboard/variant-switcher";
import { EmptyState } from "@/components/empty-state";
import { GuestWelcomeDialog } from "@/components/guest/guest-welcome-dialog";
import { Button } from "@/components/ui/button";
import { getNetWorthSeries } from "@/lib/accounts/history";
import { getCurrentSession } from "@/lib/auth/session";
import { userExists } from "@/lib/auth/user";
import {
  getAccountsTotal,
  getMonthSummary,
  getMonthlyFlowHistory,
  getNeedsReviewCount,
  getTopCategoriesThisMonth,
  listAccountsWithInstitutions,
} from "@/lib/dashboard/summary";
import { env } from "@/lib/env";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { listActiveInsights, runInsightEngine } from "@/lib/insights/engine";
import { getActiveSubscriptionsTotals } from "@/lib/recurring/list";
import { listTransactions } from "@/lib/transactions/list";
import { LineChart, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Format a cents value with an "auto round" option — for the KPI strip where
 * "€1,495" reads better than "€1,495.00". Falls through to the full formatter
 * otherwise so we respect the active locale/currency.
 */
function fmtAmount(cents: number, currency: string, locale: string, round = false): string {
  if (!round) return formatAmount(cents, currency, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Net-worth sparkline values. Prefers the real daily snapshot series once we
 * have ≥2 points; otherwise reconstructs the last few months by walking back
 * from the current balance and subtracting each prior month's net flow
 * (directionally truthful, not a true daily snapshot).
 */
function buildNetWorthSpark(
  seriesPoints: { netCents: number }[],
  totalCents: number,
  monthlyFlow: { netCents: number }[],
): number[] {
  if (seriesPoints.length >= 2) return seriesPoints.map((p) => p.netCents);
  const points: number[] = [totalCents];
  let running = totalCents;
  for (let i = monthlyFlow.length - 1; i >= 0; i--) {
    running -= monthlyFlow[i]?.netCents ?? 0;
    points.push(running);
  }
  return points.reverse();
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ variant?: string; guest?: string }>;
}) {
  // In oauth mode there is no onboarding — users are provisioned on first
  // Google/Microsoft sign-in. Send unauthenticated visitors straight to /lock.
  const isOAuth = env().AUTH_MODE === "oauth";
  if (!isOAuth && !(await userExists())) redirect("/onboarding");
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const sp = (await searchParams) ?? {};
  const variant: DashboardVariant = sp.variant === "focus" ? "focus" : "default";
  const showGuestWelcome = sp.guest === "1";

  const [t, tShell, locale] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("shell"),
    getLocale(),
  ]);
  const intlLocale = locale === "es" ? "es-ES" : "en-US";

  // The insight engine writes rows — skip it for read-only guests so viewing the
  // dashboard never mutates the shared demo data.
  if (!session.isGuest) await runInsightEngine(session.userId, locale);

  const [
    accountsTotal,
    thisMonth,
    lastMonth,
    topCategories,
    needsReview,
    recent,
    subsTotals,
    monthlyFlow,
    accountTiles,
    activeInsights,
    netWorthSeries,
  ] = await Promise.all([
    getAccountsTotal(session.userId),
    getMonthSummary(session.userId, 0),
    getMonthSummary(session.userId, -1),
    getTopCategoriesThisMonth(session.userId, 6, 0),
    getNeedsReviewCount(session.userId),
    listTransactions({ userId: session.userId }),
    getActiveSubscriptionsTotals(session.userId),
    getMonthlyFlowHistory(session.userId, 6, locale),
    listAccountsWithInstitutions(session.userId),
    listActiveInsights(session.userId),
    getNetWorthSeries(session.userId, { days: 180 }),
  ]);

  const guestDialog = (
    <GuestWelcomeDialog
      show={showGuestWelcome}
      labels={{
        title: tShell("guestWelcomeTitle"),
        body: tShell("guestWelcomeBody"),
        cta: tShell("guestWelcomeCta"),
      }}
    />
  );

  // ── Empty dashboard: no accounts yet ──────────────────────────────────
  if (accountsTotal.accountCount === 0) {
    return (
      <AppShell title={t("title")} subtitle={t("subtitle")}>
        {guestDialog}
        <div className="mx-auto max-w-6xl">
          <EmptyState
            Icon={LineChart}
            title={t("noDataTitle")}
            description={t("noDataSubtitle")}
            action={
              <Button asChild>
                <Link href="/settings/bank">{t("connectBank")}</Link>
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────
  const currency = accountsTotal.currency;
  const savedThisMonthCents = thisMonth.netCents;
  const savedLastMonthCents = lastMonth.netCents;

  // Net-worth sparkline (real snapshots when available; see helper).
  const sparkValues = buildNetWorthSpark(
    netWorthSeries.points,
    accountsTotal.totalCents,
    monthlyFlow,
  );

  // Delta vs. last month — compare this-month savings to last-month savings,
  // as a percentage of last month (absolute fallback when last month is zero).
  const delta = (() => {
    if (savedLastMonthCents === 0) return null;
    const pct = ((savedThisMonthCents - savedLastMonthCents) / Math.abs(savedLastMonthCents)) * 100;
    const sign = pct >= 0 ? "+" : "";
    return { pctFormatted: `${sign}${pct.toFixed(1)}%`, up: pct >= 0 };
  })();

  const kpis = [
    {
      key: "income",
      label: t("income"),
      valueFormatted: fmtAmount(thisMonth.incomeCents, currency, intlLocale, true),
      valueCents: thisMonth.incomeCents,
    },
    {
      key: "expenses",
      label: t("expenses"),
      valueFormatted: fmtAmount(Math.abs(thisMonth.expenseCents), currency, intlLocale, true),
      valueCents: Math.abs(thisMonth.expenseCents),
    },
    {
      key: "saved",
      label: t("saved"),
      valueFormatted: fmtAmount(savedThisMonthCents, currency, intlLocale, true),
      valueCents: savedThisMonthCents,
    },
  ];

  const monthlyFlowData = monthlyFlow.map((p) => ({
    label: p.shortLabel,
    incomeCents: p.incomeCents,
    expenseCents: p.expenseCents,
  }));
  const monthlyFlowFormatted = monthlyFlow.map((p) => ({
    income: formatAmount(p.incomeCents, currency, intlLocale),
    expense: formatAmount(p.expenseCents, currency, intlLocale),
  }));

  // Donut segments: top categories this month, expense side only.
  const donutSegments = topCategories.map((c) => ({
    value: c.spentCents,
    color: c.color,
    label: locale === "es" ? c.nameEs : c.nameEn,
  }));
  const donutTotal = topCategories.reduce((sum, c) => sum + c.spentCents, 0);
  const donutLegend = topCategories.slice(0, 3).map((c) => ({
    label: locale === "es" ? c.nameEs : c.nameEn,
    color: c.color,
    valueFormatted: formatAmount(c.spentCents, currency, intlLocale),
  }));

  // Category spend rows (Bento "Spending by category" card).
  const categoryRows: CategorySpendRow[] = topCategories.slice(0, 4).map((c) => {
    const budget = c.budgetMonthlyCents ?? 0;
    const pct = budget > 0 ? (c.spentCents / budget) * 100 : 0;
    return {
      categoryId: c.categoryId,
      name: locale === "es" ? c.nameEs : c.nameEn,
      icon: c.icon,
      color: c.color,
      spentFormatted: formatAmount(c.spentCents, currency, intlLocale),
      budgetFormatted: budget > 0 ? fmtAmount(budget, currency, intlLocale, true) : null,
      pct,
      over: budget > 0 && c.spentCents > budget,
    };
  });

  // Recent transactions for the activity card.
  const recentRows: RecentTransactionRow[] = recent.rows.slice(0, 5).map((r) => {
    const catName = r.categoryNameEs
      ? locale === "es"
        ? r.categoryNameEs
        : (r.categoryNameEn ?? r.categoryNameEs)
      : null;
    const sub = `${catName ?? t("uncategorizedShort")} · ${r.institutionName}`;
    return {
      id: r.id,
      merchant: r.merchantName ?? r.rawDescription,
      subLabel: sub,
      amountFormatted: formatAmount(Math.abs(r.amountCents), r.currency, intlLocale),
      amountCents: r.amountCents,
      categoryIcon: r.categoryIcon,
      categoryColor: r.categoryColor,
    };
  });

  // Coach brief — deterministic copy derived from available signals.
  const briefHighlight =
    savedThisMonthCents > 0 ? fmtAmount(savedThisMonthCents, currency, intlLocale, true) : null;
  const briefHeadline =
    savedThisMonthCents > 0 ? t("briefHeadlineSaving") : t("briefHeadlineNeutral");
  const briefBody =
    needsReview > 0
      ? t("briefBodyReview", { count: needsReview })
      : subsTotals.activeCount > 0
        ? t("briefBodySubs", {
            count: subsTotals.activeCount,
            amount: fmtAmount(subsTotals.monthlyTotalCents, currency, intlLocale, true),
          })
        : t("briefBodyGeneric");

  // Insights are now derived by the rule engine (Phase 7h).

  const variantSwitcher = (
    <VariantSwitcher
      active={variant}
      labels={{
        default: t("variantDefault"),
        focus: t("variantFocus"),
      }}
    />
  );

  // ── Focus variant: single-question layout ─────────────────────────────
  if (variant === "focus") {
    return (
      <AppShell title={t("title")} subtitle={t("subtitleGreeting")}>
        {guestDialog}
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex justify-end">{variantSwitcher}</div>
          <CoachBriefCard
            eyebrow={t("briefEyebrow")}
            headline={briefHeadline}
            highlight={briefHighlight ?? undefined}
            body={briefBody}
            openLabel={t("briefOpen")}
            askLabel={t("briefAsk")}
          />
          <TotalBalanceCard
            netWorthLabel={t("netWorth")}
            netWorthFormatted={formatAmount(accountsTotal.totalCents, currency, intlLocale)}
            netWorthCents={accountsTotal.totalCents}
            baseCurrency={currency}
            intlLocale={intlLocale}
            sparkValues={sparkValues}
            delta={delta}
            vsLastMonthLabel={t("vsLastMonth")}
            kpis={kpis}
          />
          {activeInsights.length > 0 ? (
            <InsightsList
              insights={activeInsights}
              titleLabel={t("insightsTitle")}
              dismissLabel={t("dismissInsight")}
            />
          ) : null}
        </div>
      </AppShell>
    );
  }

  // ── Default variant: balanced bento layout ────────────────────────────
  return (
    <AppShell title={t("title")} subtitle={t("subtitleGreeting")}>
      {guestDialog}
      <div className="mx-auto max-w-6xl">
        <div className="mb-3 flex justify-end">{variantSwitcher}</div>
        <div className="grid grid-cols-12 gap-4">
          {/* Hero row: net worth + coach brief */}
          <div className="col-span-12 lg:col-span-8">
            <TotalBalanceCard
              netWorthLabel={t("netWorth")}
              netWorthFormatted={formatAmount(accountsTotal.totalCents, currency, intlLocale)}
              netWorthCents={accountsTotal.totalCents}
              baseCurrency={currency}
              intlLocale={intlLocale}
              sparkValues={sparkValues}
              delta={delta}
              vsLastMonthLabel={t("vsLastMonth")}
              kpis={kpis}
            />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <CoachBriefCard
              eyebrow={t("briefEyebrow")}
              headline={briefHeadline}
              highlight={briefHighlight ?? undefined}
              body={briefBody}
              openLabel={t("briefOpen")}
              askLabel={t("briefAsk")}
            />
          </div>

          {/* Accounts row */}
          <div className="col-span-12">
            <div className="mb-3 mt-1 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-tight">{t("yourAccounts")}</h2>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/bank">
                  <Plus className="h-3.5 w-3.5" />
                  {t("addAccount")}
                </Link>
              </Button>
            </div>
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
            >
              {accountTiles.map((a) => (
                <BankTile
                  key={a.id}
                  institutionName={a.institutionName}
                  institutionLogoUrl={a.institutionLogoUrl}
                  accountLabel={a.accountName}
                  last4={a.ibanLast4}
                  balanceFormatted={formatAmount(a.balanceCents, a.currency, intlLocale)}
                  href={`/transactions?accountId=${a.id}`}
                />
              ))}
              <AddBankTile
                href="/settings/bank"
                title={t("addAccount")}
                subtitle={t("addAccountHint")}
              />
            </div>
          </div>

          {/* Flow + donut */}
          <div className="col-span-12 lg:col-span-7">
            <MonthlyFlowCard
              title={t("monthlyFlow")}
              subtitle={t("monthlyFlowSub")}
              incomeLabel={t("income")}
              expenseLabel={t("expenses")}
              data={monthlyFlowData}
              formatted={monthlyFlowFormatted}
            />
          </div>
          <div className="col-span-12 lg:col-span-5">
            <DonutCard
              title={t("monthSpend", { month: monthlyFlow.at(-1)?.shortLabel ?? "" })}
              subtitle={t("monthSpendSub")}
              segments={donutSegments}
              totalFormatted={fmtAmount(donutTotal, currency, intlLocale, true)}
              totalCaption={t("thisMonth")}
              legend={donutLegend}
              emptyLabel={t("noCategorySpend")}
            />
          </div>

          {/* Recent + categories */}
          <div className="col-span-12 lg:col-span-7">
            <RecentTransactionsCard
              title={t("recentActivity")}
              seeAllLabel={t("viewAll")}
              emptyLabel={t("noActivity")}
              rows={recentRows}
            />
          </div>
          <div className="col-span-12 lg:col-span-5">
            <CategoriesCard
              title={t("topCategories")}
              viewAllLabel={t("viewAll")}
              rows={categoryRows}
              emptyLabel={t("noCategorySpend")}
            />
          </div>

          {/* Insights list (Phase 7h) */}
          {activeInsights.length > 0 ? (
            <div className="col-span-12">
              <InsightsList
                insights={activeInsights}
                titleLabel={t("insightsTitle")}
                dismissLabel={t("dismissInsight")}
              />
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
