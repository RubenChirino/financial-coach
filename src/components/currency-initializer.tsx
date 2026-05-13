"use client";

import { useCurrencyStore } from "@/lib/currency/store";
import { useEffect } from "react";

/**
 * Invisible initializer that re-fetches the live exchange rate on mount when
 * a non-EUR display currency is stored in localStorage.
 *
 * Mount this once near the top of the layout so all `ConvertedAmount`
 * components have a fresh rate before they render.
 */
export function CurrencyInitializer({ baseCurrency }: { baseCurrency: string }) {
  const { displayCurrency, setDisplayCurrency } = useCurrencyStore();

  // Only run on mount — silent re-fetch of the live rate without touching the
  // user-selected display currency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    if (displayCurrency && displayCurrency !== baseCurrency) {
      setDisplayCurrency(displayCurrency, baseCurrency);
    }
  }, []);

  return null;
}
