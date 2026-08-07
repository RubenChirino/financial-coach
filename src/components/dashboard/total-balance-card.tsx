"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { PrivacyAmount } from "@/components/privacy-amount";
import { convertAndFormat, useCurrencyStore } from "@/lib/currency/store";
import { cn } from "@/lib/utils";

export interface TotalBalanceCardProps {
  netWorthLabel: string;
  netWorthCents: number;
  baseCurrency: string;
  intlLocale: string;
  sparkValues: number[];
  delta: {
    /** Formatted percentage incl. sign, e.g. "+3.8%" / "−1.2%". */
    pctFormatted: string;
    up: boolean;
  } | null;
  vsLastMonthLabel: string;
  kpis: {
    key: string;
    label: string;
    /** Raw cents for conversion. */
    valueCents: number;
  }[];
}

/**
 * Hero card for the Bento dashboard — large net-worth display, sparkline,
 * delta pill, and a row of three KPI cells.
 *
 * Client component so it can react to the live currency store when the user
 * switches between EUR and USD in the topbar.
 */
export function TotalBalanceCard({
  netWorthLabel,
  netWorthCents,
  baseCurrency,
  intlLocale,
  sparkValues,
  delta,
  vsLastMonthLabel,
  kpis,
}: TotalBalanceCardProps) {
  const { displayCurrency, rate } = useCurrencyStore();

  const displayNetWorth = convertAndFormat(
    netWorthCents,
    baseCurrency,
    intlLocale,
    displayCurrency,
    rate,
  );

  return (
    <section className="coin-card p-6 h-full">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]">
            {netWorthLabel}
          </div>
          <div className="tnum mt-1 text-[38px] leading-[44px] font-semibold tracking-[-0.02em]">
            <PrivacyAmount value={displayNetWorth} />
          </div>
          {delta ? (
            <div className="mt-2 flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[12px] font-semibold",
                  delta.up
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
                )}
              >
                {delta.up ? (
                  <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
                ) : (
                  <TrendingDown className="h-3 w-3" strokeWidth={2.5} />
                )}
                {delta.pctFormatted}
              </span>
              <span className="text-[12px] text-[color:var(--text-tertiary)]">
                {vsLastMonthLabel}
              </span>
            </div>
          ) : null}
        </div>
        <div className="shrink-0">
          <Sparkline values={sparkValues} width={130} height={52} />
        </div>
      </div>

      <hr className="my-5 border-[color:var(--border-default)]" />

      <div className="grid grid-cols-3 gap-3">
        {kpis.map((k) => {
          const displayValue = convertAndFormat(
            k.valueCents,
            baseCurrency,
            intlLocale,
            displayCurrency,
            rate,
            { round: true },
          );
          return (
            <div key={k.key}>
              <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]">
                {k.label}
              </div>
              <div className="tnum mt-0.5 text-[17px] font-semibold">
                <PrivacyAmount value={displayValue} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
