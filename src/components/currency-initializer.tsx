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

  useEffect(() => {
    if (displayCurrency && displayCurrency !== baseCurrency) {
      // Silently re-fetch the rate; don't change the selected currency.
      setDisplayCurrency(displayCurrency, baseCurrency);
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
