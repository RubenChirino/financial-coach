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
        const current = get().displayCurrency;
        if (current === currency) return;

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
): string {
  const toCurrency = displayCurrency;
  const appliedRate = fromCurrency === toCurrency ? 1 : rate;
  const converted = (cents / 100) * appliedRate;
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: toCurrency,
  }).format(converted);
}
