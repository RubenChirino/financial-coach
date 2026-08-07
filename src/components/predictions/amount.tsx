"use client";

import { useConvertedFmt } from "@/lib/currency/store";
import { usePrivacy } from "@/lib/privacy/use-privacy";
import { cn } from "@/lib/utils";

/**
 * Predictions-page amount: converts to the selected display currency and
 * keeps the page's visual sign conventions ("+", "−") and suffixes ("/mo")
 * around the number. Honours privacy blur.
 */
export function PredAmount({
  cents,
  currency,
  intlLocale,
  prefix = "",
  suffix = "",
  className,
}: {
  cents: number;
  currency: string;
  intlLocale: string;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const fmt = useConvertedFmt(intlLocale);
  const [privacy] = usePrivacy();
  return (
    <span className={cn(privacy && "balance-hidden", className)} aria-hidden={privacy || undefined}>
      {`${prefix}${fmt(cents, currency)}${suffix}`}
    </span>
  );
}
