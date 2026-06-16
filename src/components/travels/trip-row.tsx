"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Clickable trip row for the travels list. Updates `?id=` in place so the
 * detail panel re-renders server-side, mirroring the budgets category row
 * (optimistic highlight + spinner so the click never feels like a no-op).
 */
export function TripRow({
  tripKey,
  flag,
  title,
  subtitle,
  totalFormatted,
  metaLabel,
  selected,
}: {
  tripKey: string;
  flag: string;
  /** Primary line — the city if known, else the country. */
  title: string;
  /** Secondary line — date range (+ country when a city is shown). */
  subtitle: string;
  totalFormatted: string;
  /** e.g. "12 payments". */
  metaLabel: string;
  selected: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select() {
    const next = new URLSearchParams(sp.toString());
    next.set("id", tripKey);
    startTransition(() => {
      router.replace(`/travels?${next.toString()}`, { scroll: false });
    });
  }

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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color:var(--surface-app)] text-[18px]"
        aria-hidden
      >
        {flag}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-[13.5px] font-semibold">{title}</div>
            {isPending ? (
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-[color:var(--brand-primary)]"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="tnum whitespace-nowrap text-[12.5px] font-semibold">{totalFormatted}</div>
        </div>
        <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-[color:var(--text-tertiary)]">
          <span className="truncate">{subtitle}</span>
          <span className="whitespace-nowrap">{metaLabel}</span>
        </div>
      </div>
    </button>
  );
}
