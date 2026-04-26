"use client";

import { usePrivacy } from "@/lib/privacy/use-privacy";
import { cn } from "@/lib/utils";

/**
 * Renders a monetary amount that respects the privacy toggle.
 * When privacy is on, the value is replaced by a blurred placeholder.
 *
 * Usage:
 *   <PrivacyAmount value="€ 1,495" />
 */
export function PrivacyAmount({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [isHidden] = usePrivacy();

  if (isHidden) {
    return (
      <span className={cn("select-none blur-sm", className)} aria-hidden="true" title="••••">
        {value}
      </span>
    );
  }

  return <span className={className}>{value}</span>;
}
