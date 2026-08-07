import { Download, ListMinus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { TourButton } from "@/components/tour-button";
import { SpendingHeatmap } from "@/components/transactions/spending-heatmap";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { getLocale } from "@/lib/i18n/locale";
import { listCategoryOptionsAction } from "@/lib/transactions/actions";
import { getSpendingHeatmap } from "@/lib/transactions/heatmap";
import { getTransactionStats, listTransactions } from "@/lib/transactions/list";
import { CategorizeNowButton } from "./categorize-now-button";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ review?: string; q?: string; heatmapYear?: string; dates?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const sp = (await searchParams) ?? {};
  const reviewOnly = sp.review === "1";
  const searchQuery = sp.q?.trim() ?? "";

  // Parse ?dates=YYYY-MM-DD,YYYY-MM-DD — validate each token is a proper ISO date.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const selectedDates: string[] = (sp.dates ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => DATE_RE.test(d))
    .slice(0, 31); // sanity cap
  const requestedYear = Number.parseInt(sp.heatmapYear ?? "", 10);
  const heatmapYearArg: number | "auto" =
    Number.isFinite(requestedYear) && requestedYear >= 1900 && requestedYear <= 2100
      ? requestedYear
      : "auto";

  const [t, tNav, locale, { rows, nextCursor }, options, accountsTotal, heatmap, stats] =
    await Promise.all([
      getTranslations("transactions"),
      getTranslations("nav"),
      getLocale(),
      listTransactions({
        userId: session.userId,
        needsReviewOnly: reviewOnly,
        query: searchQuery || undefined,
        dates: selectedDates.length ? selectedDates : undefined,
      }),
      listCategoryOptionsAction(),
      getAccountsTotal(session.userId),
      getSpendingHeatmap(session.userId, heatmapYearArg),
      getTransactionStats(session.userId),
    ]);
  // The list above is only the FIRST PAGE — show the real total in the header
  // (otherwise users think their import didn't work).
  const totalCount = Number(stats.count) || rows.length;
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
                {t("countLine", { count: totalCount, banks: bankSet.size })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <TourButton
                label={locale === "es" ? "¿Cómo funciona?" : "How it works"}
                steps={[
                  {
                    title: locale === "es" ? "Tus transacciones" : "Your transactions",
                    description:
                      locale === "es"
                        ? "Aquí verás todas tus transacciones ordenadas por fecha. Puedes buscar, filtrar por banco o categoría, y revisar las pendientes de categorizar."
                        : "Here you'll see all your transactions sorted by date. You can search, filter by bank or category, and review ones pending categorisation.",
                  },
                  {
                    element: "#heatmap",
                    title: locale === "es" ? "Mapa de calor de gasto" : "Spending heatmap",
                    description:
                      locale === "es"
                        ? "El calendario muestra cuánto gastaste cada día del año. Días más rojos = más gasto. Meses verdes = ahorraste ese mes. Haz clic en un día para ver solo sus transacciones."
                        : "The calendar shows how much you spent each day of the year. Darker red = more spending. Green months = you saved that month. Click a day to filter transactions to just that day.",
                    side: "bottom",
                  },
                  {
                    title: locale === "es" ? "Selección de días" : "Day selection",
                    description:
                      locale === "es"
                        ? "Puedes seleccionar varios días a la vez — pulsa para activar/desactivar. La lista de abajo se filtrará automáticamente. Para volver a ver todo, pulsa 'Limpiar' en el banner azul."
                        : "You can select multiple days at once — click to toggle. The list below filters automatically. To see all transactions again, click 'Clear' in the blue banner.",
                  },
                ]}
              />
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
                  defaultOpen={heatmapYearArg !== "auto" || selectedDates.length > 0}
                  initialSelectedDates={selectedDates}
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
                    selectedCount: t("heatmapSelectedCount"),
                    clearSelection: t("heatmapClearSelection"),
                  }}
                />
              </div>
              {selectedDates.length > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary-soft)] px-3 py-2 text-[12.5px]">
                  <span className="text-[color:var(--brand-primary)]">
                    {t("heatmapDateFilter").replace("{n}", String(selectedDates.length))}
                  </span>
                  <Link
                    href={`/transactions${reviewOnly ? "?review=1" : ""}${searchQuery ? `${reviewOnly ? "&" : "?"}q=${encodeURIComponent(searchQuery)}` : ""}`}
                    className="font-medium text-[color:var(--brand-primary)] hover:underline"
                  >
                    {t("heatmapClearSelection")}
                  </Link>
                </div>
              )}
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
