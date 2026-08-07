"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CurrencyState {
  /** Currently displayed currency (ISO 4217). Defaults to the user's profile currency. */
  displayCurrency: string;
  /** Conversion rate: 1 unit of baseCurrency = `rate` units of displayCurrency. */
  rate: number;
  /** Whether the rate is being fetched. */
  fetching: boolean;
  /** Set the displayed currency and fetch the live rate if different from base. */
  setDisplayCurrency: (currency: string, baseCurrency?: string) => Promise<void>;
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      displayCurrency: "EUR",
      rate: 1,
      fetching: false,

      async setDisplayCurrency(currency: string, baseCurrency = "EUR") {
        const { displayCurrency: current, rate } = get();
        // Skip only when nothing would change. A non-base currency with rate=1
        // means "selection restored from localStorage but rate never fetched"
        // (only the selection is persisted) — the mount-time refresh must
        // proceed in that case or every reload renders unconverted values.
        if (current === currency && (currency === baseCurrency || rate !== 1)) return;

        set({ displayCurrency: currency, fetching: true });

        if (currency === baseCurrency) {
          set({ rate: 1, fetching: false });
          return;
        }

        try {
          const res = await fetch(
            `/api/exchange-rate?from=${encodeURIComponent(baseCurrency)}&to=${encodeURIComponent(currency)}`,
          );
          if (!res.ok) throw new Error("rate fetch failed");
          const data = (await res.json()) as { rate: number };
          set({ rate: data.rate, fetching: false });
        } catch {
          // Keep previous rate on error, don't crash the UI.
          set({ fetching: false });
        }
      },
    }),
    {
      name: "coin-currency-display",
      // Only persist the selection, not the rate (re-fetch on next load).
      partialize: (s) => ({ displayCurrency: s.displayCurrency }),
    },
  ),
);

export interface ConvertFmtOptions {
  /** Intl sign display: "always" renders +€x for positives. Default "auto". */
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  /** Round to whole units (KPI-style "€1,495" instead of "€1,495.00"). */
  round?: boolean;
}

/**
 * Hook: returns a formatter bound to the current display-currency selection.
 * `fmt(cents, fromCurrency, opts?)` converts a stored amount to the selected
 * display currency (live ECB rate) and formats it for the given locale.
 * Components using it re-render automatically when the user flips the EUR/USD
 * toggle.
 */
export function useConvertedFmt(
  intlLocale: string,
): (cents: number, fromCurrency: string, opts?: ConvertFmtOptions) => string {
  const displayCurrency = useCurrencyStore((s) => s.displayCurrency);
  const rate = useCurrencyStore((s) => s.rate);
  return (cents, fromCurrency, opts) =>
    convertAndFormat(cents, fromCurrency, intlLocale, displayCurrency, rate, opts);
}

/**
 * Convert a cents value from the base currency to the currently selected
 * display currency, then format it.
 *
 * @param cents  Raw amount in the smallest unit (e.g. EUR cents).
 * @param fromCurrency  ISO code of the stored currency (e.g. "EUR").
 * @param intlLocale  BCP 47 locale string used for number formatting.
 */
export function convertAndFormat(
  cents: number,
  fromCurrency: string,
  intlLocale: string,
  displayCurrency: string,
  rate: number,
  opts?: ConvertFmtOptions,
): string {
  const toCurrency = displayCurrency;
  const appliedRate = fromCurrency === toCurrency ? 1 : rate;
  const converted = (cents / 100) * appliedRate;
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: toCurrency,
    signDisplay: opts?.signDisplay ?? "auto",
    ...(opts?.round ? { maximumFractionDigits: 0 } : {}),
  }).format(converted);
}
