"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { ConvertedAmount } from "@/components/converted-amount";
import { cn } from "@/lib/utils";

/**
 * Clickable category row for the budgets list. Updates `?id=` in place so the
 * detail panel re-renders server-side without a full navigation.
 */
export function CategoryRow({
  id,
  name,
  icon,
  color,
  spentCents,
  budgetCents,
  currency,
  intlLocale,
  noBudgetLabel,
  pct,
  over,
  selected,
  locale: _locale,
  leftLabel,
  overSuffix,
}: {
  id: number;
  name: string;
  icon: string;
  color: string;
  spentCents: number;
  /** Null = no budget set for this category. */
  budgetCents: number | null;
  currency: string;
  intlLocale: string;
  noBudgetLabel: string;
  pct: number;
  over: boolean;
  selected: boolean;
  locale: "es" | "en";
  leftLabel: string;
  overSuffix: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // The detail panel re-renders server-side on `?id=` change — a network
  // round-trip with no inherent UI feedback. Wrap the navigation in a
  // transition so we can show the row as loading (and optimistically selected)
  // while it resolves, otherwise the click feels like a no-op.
  const [isPending, startTransition] = useTransition();

  function select() {
    const next = new URLSearchParams(sp.toString());
    next.set("id", String(id));
    startTransition(() => {
      router.replace(`/categories?${next.toString()}`, { scroll: false });
    });
  }

  // Treat a pending click as selected straight away so the highlight responds
  // to the tap instantly, before the server round-trip completes.
  const active = selected || isPending;

  return (
    <button
      type="button"
      onClick={select}
      aria-busy={isPending}
      className={cn(
        "group flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3 text-left transition-colors",
        active ? "bg-[color:var(--brand-primary-soft)]" : "hover:bg-[color:var(--surface-app)]",
      )}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: `${color}22`, color }}
        aria-hidden
      >
        <CategoryIcon icon={icon} className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-[13.5px] font-semibold">{name}</div>
            {isPending ? (
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-[color:var(--brand-primary)]"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="tnum whitespace-nowrap text-[12.5px] font-semibold">
            <ConvertedAmount cents={spentCents} currency={currency} intlLocale={intlLocale} />
            <span className="font-normal text-[color:var(--text-tertiary)]">
              {" "}
              /{" "}
              {budgetCents != null ? (
                <ConvertedAmount
                  cents={budgetCents}
                  currency={currency}
                  intlLocale={intlLocale}
                  round
                />
              ) : (
                noBudgetLabel
              )}
            </span>
          </div>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-app)]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, pct))}%`,
              background: over ? "#EF4444" : color,
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10.5px]">
          <span className="text-[color:var(--text-tertiary)]">
            {Math.round(pct)}% {leftLabel}
          </span>
          <span
            className={cn(
              over ? "font-semibold text-[#DC2626]" : "text-[color:var(--text-tertiary)]",
            )}
          >
            {over ? (
              <>
                <ConvertedAmount
                  cents={spentCents - (budgetCents ?? 0)}
                  currency={currency}
                  intlLocale={intlLocale}
                />{" "}
                {overSuffix}
              </>
            ) : budgetCents != null ? (
              <ConvertedAmount
                cents={Math.max(0, budgetCents - spentCents)}
                currency={currency}
                intlLocale={intlLocale}
              />
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
}
