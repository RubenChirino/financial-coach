"use client";

import { convertAndFormat, useCurrencyStore } from "@/lib/currency/store";
import { usePrivacy } from "@/lib/privacy/use-privacy";
import { cn } from "@/lib/utils";

/**
 * Renders a monetary amount, converting from the stored base currency to the
 * currently selected display currency using the live ECB rate. Honours privacy
 * mode (blur) like `PrivacyAmount`. Drop-in replacement for pre-formatted
 * amount strings on server-rendered pages: pass raw cents + stored currency.
 *
 * @param cents        Amount in the smallest unit (e.g. euro-cents).
 * @param currency     ISO 4217 code of the stored currency (e.g. "EUR").
 * @param intlLocale   BCP 47 locale (e.g. "es-ES", "en-US") for formatting.
 * @param signDisplay  Intl sign display; "always" renders +€x for positives.
 * @param round        Round to whole units (KPI-style "€1,495").
 */
export function ConvertedAmount({
  cents,
  currency,
  intlLocale,
  signDisplay,
  round,
  className,
}: {
  cents: number;
  currency: string;
  intlLocale: string;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  round?: boolean;
  className?: string;
}) {
  const { displayCurrency, rate } = useCurrencyStore();
  const [privacy] = usePrivacy();

  const formatted = convertAndFormat(cents, currency, intlLocale, displayCurrency, rate, {
    signDisplay,
    round,
  });

  return (
    <span className={cn(privacy && "balance-hidden", className)} aria-hidden={privacy || undefined}>
      {formatted}
    </span>
  );
}
