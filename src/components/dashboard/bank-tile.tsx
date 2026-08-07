import { ChevronRight, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { ConvertedAmount } from "@/components/converted-amount";
import { cn } from "@/lib/utils";

export interface BankTileProps {
  institutionName: string;
  institutionLogoUrl?: string | null;
  accountLabel: string;
  last4?: string | null;
  balanceCents: number;
  currency: string;
  intlLocale: string;
  href: string;
  compact?: boolean;
}

/**
 * Single account card — institution logo/badge, account label + last-4,
 * balance. Links to the transactions view filtered by that account.
 */
export function BankTile({
  institutionName,
  institutionLogoUrl,
  accountLabel,
  last4,
  balanceCents,
  currency,
  intlLocale,
  href,
  compact,
}: BankTileProps) {
  return (
    <Link
      href={href}
      className={cn("coin-card block w-full text-left", compact ? "p-3.5" : "p-[18px]")}
    >
      <div className={cn("flex items-center gap-3", compact ? "mb-2" : "mb-3")}>
        <BankLogo name={institutionName} logoUrl={institutionLogoUrl} size={compact ? 32 : 40} />
        <div className="flex-1 min-w-0">
          <div className="truncate text-[13px] font-semibold">{institutionName}</div>
          <div className="text-[11px] text-[color:var(--text-tertiary)] truncate">
            {accountLabel}
            {last4 ? ` · ••${last4}` : ""}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-[color:var(--text-tertiary)] shrink-0" />
      </div>
      <div className="flex items-baseline justify-between">
        <div
          className={cn(
            "tnum font-semibold tracking-[-0.015em]",
            compact ? "text-[18px]" : "text-[22px]",
          )}
        >
          <ConvertedAmount cents={balanceCents} currency={currency} intlLocale={intlLocale} />
        </div>
      </div>
    </Link>
  );
}

function BankLogo({
  name,
  logoUrl,
  size,
}: {
  name: string;
  logoUrl?: string | null;
  size: number;
}) {
  if (logoUrl) {
    return (
      <div
        className="shrink-0 overflow-hidden rounded-[10px] bg-white"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  // Fallback: initial in a brand-soft rounded square.
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)] font-semibold"
      style={{ width: size, height: size, fontSize: size >= 40 ? 16 : 13 }}
      aria-hidden
    >
      {initial === "·" ? <Wallet className="h-4 w-4" /> : initial}
    </div>
  );
}

export function AddBankTile({
  href,
  title,
  subtitle,
  compact,
}: {
  href: string;
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[color:var(--border-strong)] text-center transition-colors",
        "hover:border-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-soft)]",
        compact ? "min-h-[100px] p-4" : "min-h-[140px] p-[18px]",
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </div>
      <div className="text-[13px] font-semibold text-[color:var(--text-primary)]">{title}</div>
      <div className="max-w-[180px] text-[11px] text-[color:var(--text-secondary)]">{subtitle}</div>
    </Link>
  );
}
