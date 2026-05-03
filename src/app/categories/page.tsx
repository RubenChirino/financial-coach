import { AppShell } from "@/components/app-shell";
import { CategoryRow } from "@/components/budgets/category-row";
import { CategoryIcon } from "@/components/category-icon";
import { EmptyState } from "@/components/empty-state";
import { PrivacyAmount } from "@/components/privacy-amount";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { listCategoriesWithSpend } from "@/lib/categories/list";
import type { CategoryWithSpend } from "@/lib/categories/list";
import { getAccountsTotal, getMonthSummary } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { listTransactions } from "@/lib/transactions/list";
import { ArrowRight, PieChart, Settings2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BudgetInput } from "./budget-input";

export const dynamic = "force-dynamic";

/** Round a cents value to the nearest whole-number currency for "big" stats. */
function fmtRound(cents: number, currency: string, intlLocale: string): string {
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Percent change from `prev` → `curr`, rounded. Returns null when `prev` is 0
 * (no base to compare against).
 */
function deltaPct(prev: number, curr: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

/** Resolve the selected category from `?id=`, falling back to the first row. */
function resolveSelected<T extends { id: number }>(rows: T[], rawId: string | undefined): T | null {
  const requestedId = rawId ? Number(rawId) : null;
  if (requestedId != null && Number.isFinite(requestedId)) {
    const match = rows.find((r) => r.id === requestedId);
    if (match) return match;
  }
  return rows[0] ?? null;
}

/**
 * Build the coach-tip body string. Extracted to keep the page function's
 * cognitive complexity under the biome threshold.
 */
function buildCoachTipBody(
  sel: {
    nameEs: string;
    nameEn: string;
    budgetMonthlyCents: number | null;
    spentThisMonthCents: number;
  },
  ctx: {
    locale: "es" | "en";
    currency: string;
    intlLocale: string;
    t: (k: string, v?: Record<string, string | number>) => string;
  },
): string {
  const selName = (ctx.locale === "es" ? sel.nameEs : sel.nameEn).toLowerCase();
  const budgetCents = sel.budgetMonthlyCents ?? 0;
  const isOver = budgetCents > 0 && sel.spentThisMonthCents > budgetCents;
  if (isOver) {
    return ctx.t("coachTipOver", {
      name: selName,
      amount: formatAmount(sel.spentThisMonthCents - budgetCents, ctx.currency, ctx.intlLocale),
    });
  }
  if (budgetCents > 0) {
    return ctx.t("coachTipUnder", {
      amount: formatAmount(budgetCents - sel.spentThisMonthCents, ctx.currency, ctx.intlLocale),
      name: selName,
    });
  }
  return ctx.t("coachTipNoBudget", { name: selName });
}

/**
 * Build the prop bag for one CategoryRow. Extracted to a module-level helper
 * so the page's `rows.map(...)` call doesn't inflate the component's
 * cognitive-complexity budget.
 */
function categoryRowProps(
  c: CategoryWithSpend,
  ctx: {
    selectedId: number;
    currency: string;
    intlLocale: string;
    locale: "es" | "en";
    leftLabel: string;
    overSuffix: string;
    noBudgetLabel: string;
  },
) {
  const name = ctx.locale === "es" ? c.nameEs : c.nameEn;
  const budget = c.budgetMonthlyCents ?? 0;
  const pct = budget > 0 ? (c.spentThisMonthCents / budget) * 100 : 0;
  const over = budget > 0 && c.spentThisMonthCents > budget;
  const remainingFormatted =
    budget > 0
      ? formatAmount(Math.max(0, budget - c.spentThisMonthCents), ctx.currency, ctx.intlLocale)
      : "";
  const budgetFormatted =
    budget > 0 ? fmtRound(budget, ctx.currency, ctx.intlLocale) : ctx.noBudgetLabel;
  return {
    id: c.id,
    name,
    icon: c.icon,
    color: c.color,
    spentFormatted: formatAmount(c.spentThisMonthCents, ctx.currency, ctx.intlLocale),
    budgetFormatted,
    pct,
    over,
    remainingFormatted,
    overByFormatted: formatAmount(c.spentThisMonthCents - budget, ctx.currency, ctx.intlLocale),
    selected: c.id === ctx.selectedId,
    locale: ctx.locale,
    leftLabel: ctx.leftLabel,
    overSuffix: ctx.overSuffix,
  };
}

/**
 * Small delta pill for the summary cards.
 * `goodWhenDown` flips the color semantics (e.g. spending less = positive).
 */
function DeltaPill({
  pct,
  vsLabel,
  goodWhenDown = false,
}: {
  pct: number;
  vsLabel: string;
  goodWhenDown?: boolean;
}) {
  const isGood = goodWhenDown ? pct <= 0 : pct >= 0;
  const UpIcon = isGood ? TrendingUp : TrendingDown;
  return (
    <div
      className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: isGood ? "#DCFCE7" : "#FEE2E2",
        color: isGood ? "#166534" : "#991B1B",
      }}
    >
      <UpIcon className="h-3 w-3" strokeWidth={2.5} />
      {pct >= 0 ? "+" : ""}
      {pct}% {vsLabel}
    </div>
  );
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");
  const sp = (await searchParams) ?? {};

  const [t, tCommon, locale, rows, monthSummary, lastMonthSummary, accountsTotal] =
    await Promise.all([
      getTranslations("categories"),
      getTranslations("common"),
      getLocale(),
      listCategoriesWithSpend(),
      getMonthSummary(0),
      getMonthSummary(-1),
      getAccountsTotal(),
    ]);
  const intlLocale = locale === "en" ? "en-US" : "es-ES";
  const currency = accountsTotal.currency;

  if (rows.length === 0) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          </header>
          <EmptyState Icon={PieChart} title={t("empty")} />
        </div>
      </AppShell>
    );
  }

  const totalBudget = rows.reduce((s, c) => s + (c.budgetMonthlyCents ?? 0), 0);
  const totalSpent = rows.reduce((s, c) => s + c.spentThisMonthCents, 0);
  const totalIncome = monthSummary.incomeCents;
  const saved = Math.max(0, totalIncome - totalSpent);
  const pctSaved = totalIncome > 0 ? (saved / totalIncome) * 100 : 0;
  const pctBudget = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

  const incomeDeltaPct = deltaPct(lastMonthSummary.incomeCents, totalIncome);
  const spentDeltaPct = deltaPct(Math.abs(lastMonthSummary.expenseCents), totalSpent);

  const selected = resolveSelected(rows, sp.id);
  if (!selected) {
    // shouldn't happen — rows.length > 0 is asserted above, but keep the type flow sane.
    redirect("/categories");
  }

  const selectedName = locale === "es" ? selected.nameEs : selected.nameEn;
  const selectedBudget = selected.budgetMonthlyCents ?? 0;
  const selectedPct =
    selectedBudget > 0 ? (selected.spentThisMonthCents / selectedBudget) * 100 : 0;
  const selectedOver = selectedBudget > 0 && selected.spentThisMonthCents > selectedBudget;

  // Recent transactions in the selected category (max 6, this month only is a fair
  // approximation — listTransactions filters by categoryId, grouping is skipped here).
  const { rows: selectedTxs } = await listTransactions({
    categoryId: selected.id,
    limit: 6,
  });

  const now = new Date();
  const monthLabel = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(
    now,
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">{monthLabel}</p>
          </div>
        </header>

        {/* Summary strip */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="coin-card p-5">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
              {t("incomeThisMonth")}
            </div>
            <div className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]">
              <PrivacyAmount value={formatAmount(totalIncome, currency, intlLocale)} />
            </div>
            {incomeDeltaPct != null ? (
              <DeltaPill pct={incomeDeltaPct} vsLabel={t("vsLastMonth")} />
            ) : null}
          </div>

          <div className="coin-card p-5">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
              {t("spent")}
            </div>
            <div className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]">
              <PrivacyAmount value={formatAmount(totalSpent, currency, intlLocale)} />
            </div>
            {spentDeltaPct != null ? (
              <DeltaPill pct={spentDeltaPct} vsLabel={t("vsLastMonth")} goodWhenDown />
            ) : null}
            {totalBudget > 0 ? (
              <>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-app)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pctBudget}%`,
                      background: "var(--brand-primary)",
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-[color:var(--text-tertiary)]">
                  {Math.round(pctBudget)}%{" "}
                  {t("ofBudgetTotal", {
                    amount: fmtRound(totalBudget, currency, intlLocale),
                  })}
                </div>
              </>
            ) : null}
          </div>

          <div
            className="coin-card p-5 text-white"
            style={{
              background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
            }}
          >
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] opacity-85">
              {t("savedThisMonth")}
            </div>
            <div className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]">
              <PrivacyAmount value={formatAmount(saved, currency, intlLocale)} />
            </div>
            <div className="mt-0.5 text-[11.5px] opacity-90">
              {t("savingsRate", { pct: Math.round(pctSaved) })}
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${Math.min(100, pctSaved)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Two-col: categories list + detail */}
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          {/* Categories list */}
          <div className="coin-card min-w-0 p-2.5">
            <div className="flex items-center justify-between px-2.5 py-2.5">
              <h3 className="text-[14px] font-semibold">{t("allCategories")}</h3>
              <span className="text-[11.5px] text-[color:var(--text-tertiary)]">
                {t("categoryCount", { count: rows.length })}
              </span>
            </div>
            <div className="space-y-0.5">
              {rows.map((c) => (
                <CategoryRow
                  key={c.id}
                  {...categoryRowProps(c, {
                    selectedId: selected.id,
                    currency,
                    intlLocale,
                    locale,
                    leftLabel: t("used"),
                    overSuffix: t("overSuffix"),
                    noBudgetLabel: t("noBudget"),
                  })}
                />
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <div className="min-w-0 space-y-4">
            <div className="coin-card min-w-0 overflow-hidden p-5">
              <div className="flex items-center gap-3.5">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[20px]"
                  style={{ background: `${selected.color}22`, color: selected.color }}
                  aria-hidden
                >
                  <CategoryIcon icon={selected.icon} className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[18px] font-semibold tracking-[-0.01em]">
                    {selectedName}
                  </div>
                  <div className="text-[11.5px] text-[color:var(--text-tertiary)]">
                    {monthLabel}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[color:var(--text-secondary)]">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-[12px] font-medium">{tCommon("edit")}</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {t("spent")}
                  </div>
                  <div className="tnum mt-0.5 text-[18px] font-semibold">
                    <PrivacyAmount
                      value={formatAmount(selected.spentThisMonthCents, currency, intlLocale)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {t("budget")}
                  </div>
                  <div className="mt-0.5">
                    <BudgetInput
                      categoryId={selected.id}
                      initialBudgetCents={selected.budgetMonthlyCents}
                      currency={currency}
                      locale={intlLocale}
                      placeholder={t("setBudgetPlaceholder")}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {selectedOver ? t("overByLabel") : t("remaining")}
                  </div>
                  <div
                    className="tnum mt-0.5 text-[18px] font-semibold"
                    style={{ color: selectedOver ? "#DC2626" : "#059669" }}
                  >
                    <PrivacyAmount
                      value={formatAmount(
                        Math.abs(selectedBudget - selected.spentThisMonthCents),
                        currency,
                        intlLocale,
                      )}
                    />
                  </div>
                </div>
              </div>

              {selectedBudget > 0 ? (
                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-app)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, selectedPct)}%`,
                      background: selectedOver ? "#EF4444" : selected.color,
                    }}
                  />
                </div>
              ) : null}

              <hr className="my-5 border-t border-[color:var(--border-default)]" />

              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
                {t("recentIn", { category: selectedName.toLowerCase() })}
              </div>
              {selectedTxs.length === 0 ? (
                <p className="mt-2.5 text-[12.5px] text-[color:var(--text-tertiary)]">
                  {t("noTxThisMonth")}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-[color:var(--border-default)]">
                  {selectedTxs.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-3 py-2.5">
                      <div className="flex-1 min-w-0 truncate text-[13px] font-medium">
                        {tx.merchantName ?? tx.rawDescription.slice(0, 48)}
                      </div>
                      <div className="text-[11px] text-[color:var(--text-tertiary)]">
                        {new Intl.DateTimeFormat(intlLocale, {
                          day: "2-digit",
                          month: "2-digit",
                        }).format(tx.bookingDate)}
                      </div>
                      <div className="tnum text-[13px] font-semibold whitespace-nowrap">
                        <PrivacyAmount
                          value={formatAmount(tx.amountCents, tx.currency, intlLocale)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Coach tip card (pink) */}
            <div
              className="coin-card p-5"
              style={{
                background: "var(--creative-pink)",
                color: "var(--creative-pink-text)",
              }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" strokeWidth={2.5} />
                <div className="text-[11px] font-bold uppercase tracking-[0.08em]">
                  {t("coachTipEyebrow")}
                </div>
              </div>
              <p className="mt-2 text-[14px] font-semibold leading-snug">
                {buildCoachTipBody(selected, { locale, currency, intlLocale, t })}
              </p>
              <Button
                asChild
                className="mt-3 bg-white/90 text-[#4a1225] hover:bg-white dark:bg-white/15 dark:text-[color:var(--creative-pink-text)] dark:hover:bg-white/25"
              >
                <Link href="/advisor?tab=chat">
                  {t("askCoach")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
