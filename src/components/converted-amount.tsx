"use client";

import { convertAndFormat, useCurrencyStore } from "@/lib/currency/store";
import { usePrivacy } from "@/lib/privacy/use-privacy";

/**
 * Renders a monetary amount, converting from the stored base currency to the
 * currently selected display currency using the live ECB rate.
 *
 * @param cents        Amount in the smallest unit (e.g. euro-cents).
 * @param currency     ISO 4217 code of the stored currency (e.g. "EUR").
 * @param intlLocale   BCP 47 locale (e.g. "es-ES", "en-US") for formatting.
 */
export function ConvertedAmount({
  cents,
  currency,
  intlLocale,
}: {
  cents: number;
  currency: string;
  intlLocale: string;
}) {
  const { displayCurrency, rate } = useCurrencyStore();
  const [privacy] = usePrivacy();

  const formatted = convertAndFormat(cents, currency, intlLocale, displayCurrency, rate);

  if (privacy) {
    return (
      <span className="balance-hidden" aria-hidden>
        {formatted}
      </span>
    );
  }

  return <span>{formatted}</span>;
}
