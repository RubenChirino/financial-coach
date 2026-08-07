import { CalendarClock, Repeat } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon } from "@/components/category-icon";
import { ConvertedAmount } from "@/components/converted-amount";
import { EmptyState } from "@/components/empty-state";
import { NoDataState } from "@/components/no-data-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasFinancialData } from "@/lib/accounts/has-data";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import {
  getActiveSubscriptionsTotals,
  getUpcomingRenewals,
  listRecurringSubscriptions,
  monthlyEquivalentCents,
  type SubscriptionRow,
  type UpcomingRenewal,
} from "@/lib/recurring/list";
import { RunDetectionButton } from "./run-detection-button";
import { ToggleActiveButton } from "./toggle-active-button";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const [t, locale, subs, totals, accountsTotal, renewals, hasData] = await Promise.all([
    getTranslations("subscriptions"),
    getLocale(),
    listRecurringSubscriptions(session.userId),
    getActiveSubscriptionsTotals(session.userId),
    getAccountsTotal(session.userId),
    getUpcomingRenewals(session.userId, { withinDays: 35 }),
    hasFinancialData(session.userId),
  ]);
  const intlLocale = locale === "es" ? "es-ES" : "en-US";

  const active = subs.filter((s) => s.isActive);
  const inactive = subs.filter((s) => !s.isActive);
  const currency = accountsTotal.currency;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          {hasData ? (
            <RunDetectionButton label={t("runDetection")} busyLabel={t("running")} />
          ) : null}
        </header>

        {!hasData ? (
          <NoDataState Icon={Repeat} title={t("noDataTitle")} description={t("noDataBody")} />
        ) : subs.length === 0 ? (
          <EmptyState
            Icon={Repeat}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={<RunDetectionButton label={t("runDetection")} busyLabel={t("running")} />}
          />
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("monthlyTotal")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">
                  <ConvertedAmount
                    cents={totals.monthlyTotalCents}
                    currency={currency}
                    intlLocale={intlLocale}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("activeCount", { count: totals.activeCount })}
                </p>
              </CardContent>
            </Card>

            {renewals.length > 0 ? (
              <RenewalsCard
                renewals={renewals}
                locale={locale}
                intlLocale={intlLocale}
                currency={currency}
                t={t}
              />
            ) : null}

            {active.length > 0 ? (
              <Section
                title={t("active")}
                rows={active}
                locale={locale}
                intlLocale={intlLocale}
                currency={currency}
                t={t}
              />
            ) : null}

            {inactive.length > 0 ? (
              <Section
                title={t("inactive")}
                rows={inactive}
                locale={locale}
                intlLocale={intlLocale}
                currency={currency}
                t={t}
                muted
              />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<"subscriptions">>>;

interface SectionProps {
  title: string;
  rows: SubscriptionRow[];
  locale: "es" | "en";
  intlLocale: string;
  currency: string;
  t: Translator;
  muted?: boolean;
}

function frequencyLabel(days: number, t: Translator): string {
  if (days <= 7) return t("freqWeekly");
  if (days <= 14) return t("freqBiweekly");
  if (days <= 31) return t("freqMonthly");
  if (days <= 100) return t("freqQuarterly");
  return t("freqYearly");
}

function dueLabel(daysUntil: number, t: Translator): string {
  if (daysUntil <= 0) return t("dueToday");
  if (daysUntil === 1) return t("dueTomorrow");
  return t("dueInDays", { days: daysUntil });
}

function RenewalsCard({
  renewals,
  intlLocale,
  currency,
  t,
}: {
  renewals: UpcomingRenewal[];
  locale: "es" | "en";
  intlLocale: string;
  currency: string;
  t: Translator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden />
          {t("upcomingTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {renewals.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex items-center gap-3">
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm"
                  style={{
                    backgroundColor: r.categoryColor ? `${r.categoryColor}22` : "rgba(0,0,0,0.05)",
                    color: r.categoryColor ?? "currentColor",
                  }}
                  aria-hidden
                >
                  <CategoryIcon icon={r.categoryIcon ?? "Repeat"} className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.merchantName}</div>
                  <div className="text-xs text-muted-foreground">
                    {dueLabel(r.daysUntil, t)} · {formatDate(r.nextChargeAt, intlLocale)}
                  </div>
                </div>
              </div>
              <div className="font-semibold tabular-nums">
                <ConvertedAmount
                  cents={r.amountCents}
                  currency={currency}
                  intlLocale={intlLocale}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Section({ title, rows, locale, intlLocale, currency, t, muted }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((s) => {
            const monthly = monthlyEquivalentCents(s.averageAmountCents, s.frequencyDays);
            const catName = locale === "es" ? s.categoryNameEs : s.categoryNameEn;
            return (
              <li
                key={s.id}
                className={`flex items-center justify-between gap-3 py-3 ${muted ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm"
                    style={{
                      backgroundColor: s.categoryColor
                        ? `${s.categoryColor}22`
                        : "rgba(0,0,0,0.05)",
                      color: s.categoryColor ?? "currentColor",
                    }}
                    aria-hidden
                  >
                    <CategoryIcon icon={s.categoryIcon ?? "Repeat"} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.merchantName}</div>
                    <div className="text-xs text-muted-foreground">
                      {frequencyLabel(s.frequencyDays, t)}
                      {catName ? ` · ${catName}` : ""}
                      {" · "}
                      {t("lastSeen", { date: formatDate(s.lastSeenAt, intlLocale) })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">
                      <ConvertedAmount
                        cents={s.averageAmountCents}
                        currency={currency}
                        intlLocale={intlLocale}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {t.rich("monthlyEquivalent", {
                        amt: () => (
                          <ConvertedAmount
                            cents={monthly}
                            currency={currency}
                            intlLocale={intlLocale}
                          />
                        ),
                      })}
                    </div>
                  </div>
                  <ToggleActiveButton
                    id={s.id}
                    isActive={s.isActive}
                    pauseLabel={t("pause")}
                    resumeLabel={t("resume")}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
