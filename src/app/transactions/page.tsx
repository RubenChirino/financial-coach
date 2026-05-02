import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { SpendingHeatmap } from "@/components/transactions/spending-heatmap";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { getLocale } from "@/lib/i18n/locale";
import { listCategoryOptionsAction } from "@/lib/transactions/actions";
import { getSpendingHeatmap } from "@/lib/transactions/heatmap";
import { listTransactions } from "@/lib/transactions/list";
import { Download, ListMinus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CategorizeNowButton } from "./categorize-now-button";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ review?: string; q?: string; heatmapYear?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");

  const sp = (await searchParams) ?? {};
  const reviewOnly = sp.review === "1";
  const searchQuery = sp.q?.trim() ?? "";
  const requestedYear = Number.parseInt(sp.heatmapYear ?? "", 10);
  const heatmapYearArg: number | "auto" =
    Number.isFinite(requestedYear) && requestedYear >= 1900 && requestedYear <= 2100
      ? requestedYear
      : "auto";

  const [t, tNav, locale, { rows, nextCursor }, options, accountsTotal, heatmap] = await Promise.all([
    getTranslations("transactions"),
    getTranslations("nav"),
    getLocale(),
    listTransactions({ needsReviewOnly: reviewOnly, query: searchQuery || undefined }),
    listCategoryOptionsAction(),
    getAccountsTotal(),
    getSpendingHeatmap(heatmapYearArg),
  ]);
  const intlLocale = locale === "en" ? "en-US" : "es-ES";

  const bankSet = new Set(rows.map((r) => r.institutionName));

  return (
    <AppShell>
      <PullToRefresh>
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {searchQuery ? t("searchResultsFor", { query: searchQuery }) : t("title")}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
                {t("countLine", { count: rows.length, banks: bankSet.size })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href="/api/export/transactions" download>
                  <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
                </a>
              </Button>
              <CategorizeNowButton label={t("categorizeNow")} busyLabel={t("categorizing")} />
            </div>
          </header>

          {rows.length === 0 ? (
            <EmptyState
              Icon={ListMinus}
              title={t("empty")}
              description={t("emptyHint")}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button asChild>
                    <Link href="/settings/bank">{t("connectBank")}</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/import">{tNav("import")}</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <div id="heatmap">
                <SpendingHeatmap
                  data={heatmap}
                  intlLocale={intlLocale}
                  currency={accountsTotal.currency}
                  pathname="/transactions"
                  defaultOpen={heatmapYearArg !== "auto"}
                  searchParams={{
                    ...(reviewOnly ? { review: "1" } : {}),
                    ...(searchQuery ? { q: searchQuery } : {}),
                  }}
                  labels={{
                    title: t("heatmapTitle"),
                    subtitle: t("heatmapSubtitle"),
                    monthNames: [
                      t("monthJan"),
                      t("monthFeb"),
                      t("monthMar"),
                      t("monthApr"),
                      t("monthMay"),
                      t("monthJun"),
                      t("monthJul"),
                      t("monthAug"),
                      t("monthSep"),
                      t("monthOct"),
                      t("monthNov"),
                      t("monthDec"),
                    ],
                    dayInitials: [
                      t("dayMon"),
                      t("dayTue"),
                      t("dayWed"),
                      t("dayThu"),
                      t("dayFri"),
                      t("daySat"),
                      t("daySun"),
                    ],
                    savedLabel: t("heatmapSaved"),
                    overspentLabel: t("heatmapOverspent"),
                    spentOnDay: t("heatmapSpentOnDay"),
                    receivedOnDay: t("heatmapReceivedOnDay"),
                    noActivity: t("heatmapNoActivity"),
                    futureDay: t("heatmapFuture"),
                    prevYear: t("heatmapPrevYear"),
                    nextYear: t("heatmapNextYear"),
                  }}
                />
              </div>
            <TransactionsView
              rows={rows}
              initialNextCursor={nextCursor}
              categoryOptions={options}
              locale={locale}
              intlLocale={intlLocale}
              fallbackCurrency={accountsTotal.currency}
              reviewOnly={reviewOnly}
              initialSearch={searchQuery}
              labels={{
                searchPlaceholder: t("searchPlaceholder"),
                allBanks: t("allBanks"),
                allCategories: t("allCategories"),
                clear: t("clear"),
                moneyIn: t("moneyIn"),
                moneyOut: t("moneyOut"),
                netFlow: t("netFlow"),
                today: t("today"),
                yesterday: t("yesterday"),
                uncategorized: t("uncategorized"),
                reviewBadge: t("needsReviewBadge"),
                noMatch: t("noMatch"),
                filterAll: t("filterAll"),
                filterReview: t("filterReview"),
                loadMore: t("loadMore"),
                loadingMore: t("loadingMore"),
                endOfList: t("endOfList"),
              }}
            />
            </>
          )}
        </div>
      </PullToRefresh>
    </AppShell>
  );
}
