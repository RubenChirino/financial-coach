import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { TourButton } from "@/components/tour-button";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { listAccountsWithInstitutions } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { getSpendingForecast } from "@/lib/predictions/forecast";
import { TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");

  const [t, tNav, locale, accounts] = await Promise.all([
    getTranslations("predictions"),
    getTranslations("nav"),
    getLocale(),
    listAccountsWithInstitutions(),
  ]);

  const intlLocale = locale === "en" ? "en-US" : "es-ES";
  const params = await searchParams;
  const requested = params.accountId ? Number.parseInt(params.accountId, 10) : null;
  const selectedAccount =
    requested && Number.isFinite(requested)
      ? accounts.find((a) => a.id === requested) ?? null
      : null;

  // Multi-account UX: until the user picks one, show the account picker
  // instead of an aggregated forecast — different accounts often have
  // wildly different income/spend patterns and averaging them is misleading.
  const showAccountPicker = accounts.length >= 2 && selectedAccount === null;

  const forecast = await getSpendingForecast({
    horizonMonths: 3,
    accountId: selectedAccount?.id,
  });

  const fmt = (cents: number) => formatAmount(cents, forecast.currency, intlLocale);
  const fmtMonth = (yyyymm: string): string => {
    const [y, m] = yyyymm.split("-").map((p) => Number.parseInt(p, 10));
    if (!y || !m) return yyyymm;
    return new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(y, m - 1, 1)),
    );
  };

  if (showAccountPicker) {
    return (
      <AppShell title={t("title")} subtitle={t("subtitle")}>
        <div className="mx-auto max-w-3xl space-y-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t("heading")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("accountSelectorLabel")}
            </p>
          </header>
          <ul className="space-y-2">
            {accounts.map((acc) => (
              <li key={acc.id}>
                <Link
                  href={`/predictions?accountId=${acc.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-4 transition-colors hover:bg-[color:var(--brand-primary-soft)]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{acc.accountName}</div>
                    <div className="text-[11.5px] text-[color:var(--text-tertiary)]">
                      {acc.institutionName}
                      {acc.ibanLast4 ? ` · ••${acc.ibanLast4}` : ""}
                    </div>
                  </div>
                  <div className="tnum text-[13.5px] font-medium">
                    {formatAmount(acc.balanceCents, acc.currency, intlLocale)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </AppShell>
    );
  }

  if (forecast.inputs.trailingMonths === 0) {
    return (
      <AppShell title={t("title")} subtitle={t("subtitle")}>
        <div className="mx-auto max-w-4xl">
          <EmptyState
            Icon={TrendingUp}
            title={t("emptyTitle")}
            description={t("emptyHint")}
            action={
              <Button asChild>
                <Link href="/import">{tNav("import")}</Link>
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  const cumulativePositive = forecast.cumulativeNetCents >= 0;
  const fixedIncomeCents =
    forecast.inputs.recurringMonthlyInCents > 0
      ? forecast.inputs.recurringMonthlyInCents
      : forecast.inputs.avgMonthlyIncomeCents;

  return (
    <AppShell title={t("title")} subtitle={t("subtitle")}>
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("heading")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("explainer")}
            </p>
          </div>
          <TourButton
            label={locale === "es" ? "¿Cómo funciona?" : "How it works"}
            prevBtnText="←"
            nextBtnText="→"
            doneBtnText="✓"
            steps={[
              {
                title: locale === "es" ? "¿Qué son las Predicciones?" : "What are Predictions?",
                description: locale === "es"
                  ? "Esta página proyecta tus ingresos, gastos y ahorro para los próximos meses usando tus transacciones históricas. No usamos IA — los números vienen directamente de tus datos."
                  : "This page projects your income, spending, and savings for the next few months using your historical transactions. No AI is involved — the numbers come straight from your data.",
              },
              {
                element: "#pred-cumulative",
                title: locale === "es" ? "Ahorro acumulado previsto" : "Projected cumulative savings",
                description: locale === "es"
                  ? "La suma total de lo que esperamos que ahorres (o pierdas) en el horizonte de predicción. Verde = estás en camino de ahorrar; rojo = el gasto supera al ingreso."
                  : "The total sum of what we expect you to save (or lose) over the forecast window. Green = on track to save; red = spending exceeds income.",
                side: "bottom",
              },
              {
                element: "#pred-inputs",
                title: locale === "es" ? "Ingresos y gastos fijos" : "Fixed income & spending",
                description: locale === "es"
                  ? "Separamos lo predecible (nómina, suscripciones, gasto habitual en supermercado) de lo variable. Cuanto mayor sea la parte fija, más fiable es la previsión."
                  : "We split the predictable part (payroll, subscriptions, habitual grocery spend) from the variable. The bigger the fixed share, the more reliable the projection.",
                side: "top",
              },
            ]}
          />
        </header>

        {selectedAccount ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] px-4 py-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t("accountSelectorLabel")}
              </div>
              <div className="text-[13.5px] font-medium">{selectedAccount.accountName}</div>
            </div>
            {accounts.length >= 2 ? (
              <Link
                href="/predictions"
                className="text-[12px] font-medium text-[color:var(--brand-primary)] hover:underline"
              >
                {t("accountSelectorAll")}
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Headline cumulative */}
        <section
          id="pred-cumulative"
          className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-5"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t("cumulativeLabel", { months: forecast.months.length })}
          </div>
          <div
            className={`mt-1 text-3xl font-semibold tabular-nums ${
              cumulativePositive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {cumulativePositive ? "+" : ""}
            {fmt(forecast.cumulativeNetCents)}
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border-default)] px-2 py-0.5 text-[11px] text-[color:var(--text-secondary)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                forecast.confidence === "high"
                  ? "bg-emerald-500"
                  : forecast.confidence === "medium"
                    ? "bg-amber-500"
                    : "bg-red-500"
              }`}
            />
            {t(`confidence_${forecast.confidence}` as never)}
            <span className="text-[color:var(--text-tertiary)]">
              · {t("basedOnMonths", { months: forecast.inputs.trailingMonths })}
            </span>
          </div>
        </section>

        {/* Per-month projections */}
        <section id="pred-months" className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {forecast.months.map((m) => {
            const positive = m.projectedNetCents >= 0;
            return (
              <div
                key={m.month}
                className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-4"
              >
                <div className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                  {fmtMonth(m.month)}
                </div>
                <div
                  className={`mt-1 text-xl font-semibold tabular-nums ${
                    positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {positive ? "+" : ""}
                  {fmt(m.projectedNetCents)}
                </div>
                <dl className="mt-3 space-y-1 text-[12px]">
                  <div className="flex items-center justify-between">
                    <dt className="text-[color:var(--text-tertiary)]">{t("incomeLine")}</dt>
                    <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{fmt(m.projectedIncomeCents)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[color:var(--text-tertiary)]">{t("expenseLine")}</dt>
                    <dd className="tabular-nums text-red-600 dark:text-red-400">
                      −{fmt(m.projectedExpenseCents)}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </section>

        {/* Methodology / inputs */}
        <section
          id="pred-inputs"
          className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-5"
        >
          <h2 className="text-base font-semibold tracking-tight">{t("inputsTitle")}</h2>
          <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">{t("inputsHint")}</p>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            <InputRow
              label={t("inputFixedIncome")}
              value={`+${fmt(fixedIncomeCents)}`}
              valueColor="text-emerald-600 dark:text-emerald-400"
            />
            <InputRow
              label={t("inputAvgIncome")}
              value={`+${fmt(forecast.inputs.avgMonthlyIncomeCents)}`}
              valueColor="text-emerald-600 dark:text-emerald-400"
            />
            <InputRow
              label={t("inputRecurringOut")}
              value={`−${fmt(forecast.inputs.recurringMonthlyOutCents)}`}
              valueColor="text-red-600 dark:text-red-400"
            />
            <InputRow
              label={t("inputHabitualOut")}
              value={`−${fmt(forecast.inputs.habitualMonthlyOutCents)}`}
              valueColor="text-red-600 dark:text-red-400"
            />
            <InputRow
              label={t("inputVariableOut")}
              value={`−${fmt(forecast.inputs.avgMonthlyVariableExpenseCents)}`}
              valueColor="text-[color:var(--text-secondary)]"
            />
            <InputRow
              label={t("inputAvgExpense")}
              value={`−${fmt(forecast.inputs.avgMonthlyExpenseCents)}`}
              valueColor="text-[color:var(--text-secondary)]"
            />
          </dl>

          {forecast.inputs.recurringInflows.length > 0 ? (
            <div className="mt-5 border-t border-[color:var(--border-default)] pt-4">
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t("topRecurringInflowsTitle")}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {forecast.inputs.recurringInflows.map((s) => (
                  <li
                    key={s.source}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="truncate">{s.source}</span>
                    <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{fmt(s.monthlyEquivCents)}
                      {t("monthlySuffix")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-5 border-t border-[color:var(--border-default)] pt-4">
              <p className="text-[12px] text-[color:var(--text-tertiary)]">
                {t("noRecurringIncomeDetected")}
              </p>
            </div>
          )}

          {forecast.inputs.recurringSubscriptions.length > 0 ? (
            <div className="mt-5 border-t border-[color:var(--border-default)] pt-4">
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t("topRecurringTitle")}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {forecast.inputs.recurringSubscriptions.map((s) => (
                  <li
                    key={s.merchant}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="truncate">{s.merchant}</span>
                    <span className="tabular-nums text-[color:var(--text-secondary)]">
                      {fmt(s.monthlyEquivCents)}
                      {t("monthlySuffix")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {forecast.inputs.habitualMerchants.length > 0 ? (
            <div className="mt-5 border-t border-[color:var(--border-default)] pt-4">
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t("topHabitualTitle")}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-[color:var(--text-tertiary)]">
                {t("habitualHint")}
              </p>
              <ul className="mt-2 space-y-1.5">
                {forecast.inputs.habitualMerchants.map((h) => (
                  <li
                    key={h.merchant}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="truncate">{h.merchant}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-[color:var(--text-tertiary)]">
                        {t("monthsSeenSuffix", { n: h.monthsSeen })}
                      </span>
                      <span className="tabular-nums text-[color:var(--text-secondary)]">
                        {fmt(h.monthlyMedianCents)}
                        {t("monthlySuffix")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* History strip */}
        {forecast.inputs.history.length > 0 ? (
          <section
            id="pred-history"
            className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-5"
          >
            <h2 className="text-base font-semibold tracking-tight">{t("historyTitle")}</h2>
            <ul className="mt-3 space-y-2">
              {forecast.inputs.history.map((m) => (
                <li
                  key={m.month}
                  className="flex items-center justify-between gap-3 border-b border-[color:var(--border-default)]/40 pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="text-[13px] font-medium">{fmtMonth(m.month)}</span>
                  <div className="flex items-center gap-4 text-[12px] tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{fmt(m.incomeCents)}
                    </span>
                    <span className="text-red-600 dark:text-red-400">−{fmt(m.expenseCents)}</span>
                    <span
                      className={`font-medium ${
                        m.netCents >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {m.netCents >= 0 ? "+" : ""}
                      {fmt(m.netCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-[11.5px] text-[color:var(--text-tertiary)]">{t("disclaimer")}</p>
      </div>
    </AppShell>
  );
}

function InputRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[color:var(--text-tertiary)]">{label}</dt>
      <dd className={`tabular-nums font-medium ${valueColor}`}>{value}</dd>
    </div>
  );
}
