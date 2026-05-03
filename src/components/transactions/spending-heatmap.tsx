"use client";

import type { SpendingHeatmap } from "@/lib/transactions/heatmap";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

export interface SpendingHeatmapLabels {
  title: string;
  subtitle: string;
  monthNames: string[];
  dayInitials: string[];
  savedLabel: string;
  overspentLabel: string;
  spentOnDay: string;
  receivedOnDay: string;
  noActivity: string;
  futureDay: string;
  prevYear: string;
  nextYear: string;
  selectedCount: string; // "{n} days selected"
  clearSelection: string; // "Clear"
}

export function SpendingHeatmap({
  data,
  labels,
  intlLocale,
  currency,
  pathname,
  searchParams,
  defaultOpen = false,
  initialSelectedDates = [],
}: {
  data: SpendingHeatmap;
  labels: SpendingHeatmapLabels;
  intlLocale: string;
  currency: string;
  pathname: string;
  searchParams: Record<string, string | undefined>;
  defaultOpen?: boolean;
  initialSelectedDates?: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelectedDates));
  // Track the last individually-toggled date for shift-click range selection
  const lastClickedRef = useRef<string | null>(null);

  const today = new Date();
  const todayUTC = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );

  const years = data.availableYears.length > 0 ? data.availableYears : [data.year];
  const minYear = Math.min(...years, data.year);
  const maxYear = Math.max(...years, today.getUTCFullYear());
  const prevYearLink =
    data.year > minYear ? buildYearLink(pathname, searchParams, data.year - 1) : null;
  const nextYearLink =
    data.year < maxYear ? buildYearLink(pathname, searchParams, data.year + 1) : null;

  const pushDates = useCallback(
    (next: Set<string>) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(searchParams)) {
        if (v && k !== "dates") params.set(k, v);
      }
      if (next.size > 0) {
        params.set("dates", [...next].sort().join(","));
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const toggleDate = useCallback(
    (dateStr: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(dateStr)) next.delete(dateStr);
        else next.add(dateStr);
        lastClickedRef.current = dateStr;
        pushDates(next);
        return next;
      });
    },
    [pushDates],
  );

  const clearAll = useCallback(() => {
    setSelected(new Set());
    pushDates(new Set());
  }, [pushDates]);

  const fmt = new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2.5">
          <ChevronDown className="h-4 w-4 -rotate-90 text-[color:var(--text-secondary)] transition-transform group-open:rotate-0" />
          <div>
            <h2 className="text-base font-semibold tracking-tight">{labels.title}</h2>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              {labels.subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                clearAll();
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-primary-soft)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--brand-primary)] hover:opacity-80"
            >
              {labels.selectedCount.replace("{n}", String(selected.size))}
              <X className="h-3 w-3" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <YearNavButton href={prevYearLink} ariaLabel={labels.prevYear}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </YearNavButton>
            <span className="min-w-[3.5rem] text-center text-sm font-medium tabular-nums">
              {data.year}
            </span>
            <YearNavButton href={nextYearLink} ariaLabel={labels.nextYear}>
              <ChevronRight className="h-3.5 w-3.5" />
            </YearNavButton>
          </div>
        </div>
      </summary>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-4 pb-4 md:grid-cols-3 lg:grid-cols-4">
        {data.months.map((m) => (
          <MonthGrid
            key={m.month}
            year={data.year}
            month={m.month}
            days={m.days}
            netCents={m.netCents}
            maxDailySpendCents={data.maxDailySpendCents}
            maxMonthlySavingCents={data.maxMonthlySavingCents}
            todayUTC={todayUTC}
            monthName={labels.monthNames[m.month] ?? ""}
            dayInitials={labels.dayInitials}
            savedLabel={labels.savedLabel}
            overspentLabel={labels.overspentLabel}
            spentOnDayLabel={labels.spentOnDay}
            receivedOnDayLabel={labels.receivedOnDay}
            noActivityLabel={labels.noActivity}
            futureLabel={labels.futureDay}
            fmt={fmt}
            dateFmt={dateFmt}
            selected={selected}
            onToggle={toggleDate}
          />
        ))}
      </div>
    </details>
  );
}

function buildYearLink(
  pathname: string,
  searchParams: Record<string, string | undefined>,
  year: number,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== "heatmapYear" && k !== "dates") params.set(k, v);
  }
  params.set("heatmapYear", String(year));
  return `${pathname}?${params.toString()}#heatmap`;
}

function YearNavButton({
  href,
  ariaLabel,
  children,
}: {
  href: string | null;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        aria-label={ariaLabel}
        aria-disabled
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--border-default)] text-[color:var(--text-tertiary)] opacity-40"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--border-default)] text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]"
    >
      {children}
    </Link>
  );
}

function MonthGrid({
  year,
  month,
  days,
  netCents,
  maxDailySpendCents,
  maxMonthlySavingCents,
  todayUTC,
  monthName,
  dayInitials,
  savedLabel,
  overspentLabel,
  spentOnDayLabel,
  receivedOnDayLabel,
  noActivityLabel,
  futureLabel,
  fmt,
  dateFmt,
  selected,
  onToggle,
}: {
  year: number;
  month: number;
  days: import("@/lib/transactions/heatmap").HeatmapDay[];
  netCents: number;
  maxDailySpendCents: number;
  maxMonthlySavingCents: number;
  todayUTC: Date;
  monthName: string;
  dayInitials: string[];
  savedLabel: string;
  overspentLabel: string;
  spentOnDayLabel: string;
  receivedOnDayLabel: string;
  noActivityLabel: string;
  futureLabel: string;
  fmt: Intl.NumberFormat;
  dateFmt: Intl.DateTimeFormat;
  selected: Set<string>;
  onToggle: (dateStr: string) => void;
}) {
  const firstWeekdaySun = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const leadBlanks = (firstWeekdaySun + 6) % 7;
  const totalCells = leadBlanks + days.length;
  const trailBlanks = (7 - (totalCells % 7)) % 7;

  const isSavingMonth = netCents > 0;
  const monthIntensity =
    isSavingMonth && maxMonthlySavingCents > 0
      ? Math.min(1, netCents / maxMonthlySavingCents)
      : 0;
  const badgeStyle: React.CSSProperties = isSavingMonth
    ? { backgroundColor: `rgba(34, 197, 94, ${0.12 + monthIntensity * 0.35})` }
    : netCents < 0
      ? { backgroundColor: "rgba(239, 68, 68, 0.10)" }
      : {};
  const badgeText = isSavingMonth
    ? `${savedLabel} ${fmt.format(netCents / 100)}`
    : netCents < 0
      ? `${overspentLabel} ${fmt.format(-netCents / 100)}`
      : "";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--text-secondary)]">
          {monthName}
        </h3>
        {badgeText ? (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
              isSavingMonth
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
            style={badgeStyle}
          >
            {badgeText}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-7 gap-[3px] text-[9px] text-[color:var(--text-tertiary)]">
        {dayInitials.map((d, i) => (
          <span key={i} className="text-center leading-none">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: leadBlanks }).map((_, i) => (
          <span key={`lead-${i}`} className="aspect-square" />
        ))}
        {days.map((d) => {
          const cellDate = new Date(Date.UTC(year, month, d.day));
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
          const isFuture = cellDate.getTime() > todayUTC.getTime();
          const isToday = cellDate.getTime() === todayUTC.getTime();
          const isSelected = selected.has(dateStr);
          const hasActivity = !isFuture && (d.spentCents > 0 || d.receivedCents > 0);
          const intensity =
            !isFuture && d.spentCents > 0 && maxDailySpendCents > 0
              ? Math.min(1, d.spentCents / maxDailySpendCents)
              : 0;

          let title: string;
          if (isFuture) {
            title = futureLabel;
          } else if (hasActivity) {
            const parts: string[] = [];
            const dateLabel = dateFmt.format(cellDate);
            if (d.spentCents > 0)
              parts.push(
                spentOnDayLabel
                  .replace("{date}", dateLabel)
                  .replace("{amount}", fmt.format(d.spentCents / 100)),
              );
            if (d.receivedCents > 0)
              parts.push(
                receivedOnDayLabel
                  .replace("{date}", dateLabel)
                  .replace("{amount}", fmt.format(d.receivedCents / 100)),
              );
            title = parts.join("\n");
          } else {
            title = `${dateFmt.format(cellDate)} — ${noActivityLabel}`;
          }

          // Colors: selected = brand-primary ring + tint; spending = red fill;
          // future = outline only; idle = faint border.
          const bgStyle: React.CSSProperties =
            isSelected
              ? { backgroundColor: "color-mix(in srgb, var(--brand-primary) 30%, transparent)" }
              : isFuture
                ? {}
                : intensity > 0
                  ? { backgroundColor: `rgba(239, 68, 68, ${0.15 + intensity * 0.8})` }
                  : {};

          const ringClass = isSelected
            ? "ring-2 ring-[color:var(--brand-primary)] ring-offset-1 ring-offset-[color:var(--bg-elevated)]"
            : isToday
              ? "ring-1 ring-[color:var(--brand-primary)]"
              : "";

          const borderClass = isFuture
            ? "border-[color:var(--border-default)]/40 bg-transparent"
            : intensity > 0
              ? "border-transparent"
              : "border-[color:var(--border-default)] bg-[color:var(--bg-base)]";

          if (isFuture) {
            return (
              <span
                key={d.day}
                title={title}
                aria-label={title}
                className={`aspect-square rounded-[3px] border ${borderClass}`}
                style={bgStyle}
              />
            );
          }

          return (
            <button
              key={d.day}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={isSelected}
              onClick={() => onToggle(dateStr)}
              className={`aspect-square cursor-pointer rounded-[3px] border transition-all hover:scale-110 hover:z-10 ${borderClass} ${ringClass}`}
              style={bgStyle}
            />
          );
        })}
        {Array.from({ length: trailBlanks }).map((_, i) => (
          <span key={`trail-${i}`} className="aspect-square" />
        ))}
      </div>
    </div>
  );
}
