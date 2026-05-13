"use client";

import { CategoryIcon } from "@/components/category-icon";
import { PrivacyAmount } from "@/components/privacy-amount";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Clickable category row for the budgets list. Updates `?id=` in place so the
 * detail panel re-renders server-side without a full navigation.
 */
export function CategoryRow({
  id,
  name,
  icon,
  color,
  spentFormatted,
  budgetFormatted,
  pct,
  over,
  remainingFormatted,
  overByFormatted,
  selected,
  locale: _locale,
  leftLabel,
  overSuffix,
}: {
  id: number;
  name: string;
  icon: string;
  color: string;
  spentFormatted: string;
  budgetFormatted: string;
  pct: number;
  over: boolean;
  remainingFormatted: string;
  overByFormatted: string;
  selected: boolean;
  locale: "es" | "en";
  leftLabel: string;
  overSuffix: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function select() {
    const next = new URLSearchParams(sp.toString());
    next.set("id", String(id));
    router.replace(`/categories?${next.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={select}
      className={cn(
        "group flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3 text-left transition-colors",
        selected ? "bg-[color:var(--brand-primary-soft)]" : "hover:bg-[color:var(--surface-app)]",
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
          <div className="truncate text-[13.5px] font-semibold">{name}</div>
          <div className="tnum whitespace-nowrap text-[12.5px] font-semibold">
            <PrivacyAmount value={spentFormatted} />
            <span className="font-normal text-[color:var(--text-tertiary)]">
              {" "}
              / <PrivacyAmount value={budgetFormatted} />
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
                <PrivacyAmount value={overByFormatted} /> {overSuffix}
              </>
            ) : (
              <PrivacyAmount value={remainingFormatted} />
            )}
          </span>
        </div>
      </div>
    </button>
  );
}
