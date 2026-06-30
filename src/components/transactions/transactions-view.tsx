"use client";

import { CategoryPicker } from "@/app/transactions/category-picker";
import { CategoryIcon } from "@/components/category-icon";
import { PrivacyAmount } from "@/components/privacy-amount";
import { Button } from "@/components/ui/button";
import { type CategoryOption, loadMoreTransactionsAction } from "@/lib/transactions/actions";
import type { TransactionRow } from "@/lib/transactions/list";
import { unlinkTransferAction } from "@/lib/transfers/actions";
import { cn } from "@/lib/utils";
import { ArrowDownLeft, ArrowLeftRight, Loader2, SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

export interface TxLabels {
  searchPlaceholder: string;
  allBanks: string;
  allCategories: string;
  clear: string;
  moneyIn: string;
  moneyOut: string;
  netFlow: string;
  today: string;
  yesterday: string;
  uncategorized: string;
  reviewBadge: string;
  noMatch: string;
  filterAll: string;
  filterReview: string;
  loadMore: string;
  loadingMore: string;
  endOfList: string;
}

export interface TransactionsViewProps {
  rows: TransactionRow[];
  initialNextCursor: { bookingDate: number; id: number } | null;
  categoryOptions: CategoryOption[];
  locale: "es" | "en";
  /** ISO locale like "es-ES" / "en-US". */
  intlLocale: string;
  /** Fallback currency when rows are empty. */
  fallbackCurrency: string;
  reviewOnly: boolean;
  /** Pre-fills the search input (e.g. when navigating from the global topbar search). */
  initialSearch?: string;
  labels: TxLabels;
}

function formatAmount(cents: number, currency: string, intlLocale: string): string {
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatSigned(cents: number, currency: string, intlLocale: string): string {
  const s = formatAmount(Math.abs(cents), currency, intlLocale);
  if (cents > 0) return `+${s}`;
  if (cents < 0) return `-${s}`;
  return s;
}

function rowMatches(r: TransactionRow, bankFilter: string, catFilter: string, q: string): boolean {
  if (bankFilter !== "all" && r.institutionName !== bankFilter) return false;
  if (catFilter !== "all") {
    const id = catFilter === "none" ? null : Number(catFilter);
    if (r.categoryId !== id) return false;
  }
  if (q) {
    const hay = `${r.merchantName ?? ""} ${r.rawDescription}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function TransactionRowItem({
  row,
  locale,
  intlLocale,
  categoryOptions,
  uncategorizedLabel,
  reviewLabel,
  transferLabel,
  transferRemoveLabel,
}: {
  row: TransactionRow;
  locale: "es" | "en";
  intlLocale: string;
  categoryOptions: CategoryOption[];
  uncategorizedLabel: string;
  reviewLabel: string;
  transferLabel: string;
  transferRemoveLabel: string;
}) {
  const categoryName = locale === "es" ? row.categoryNameEs : row.categoryNameEn;
  const isIncome = row.amountCents > 0;
  const hasCategory = row.categoryIcon && row.categoryColor;
  const isTransfer = Boolean(row.transferGroupId);
  const [unlinking, startUnlink] = useTransition();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // Swipe → open category picker for this row.
      const trigger = rowRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="dialog"]',
      );
      trigger?.click();
    }
  }

  return (
    <div
      ref={rowRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="flex items-center gap-3.5 border-t border-[color:var(--border-default)] px-5 py-3.5 transition-colors hover:bg-[color:var(--brand-primary-soft)] touch-pan-y"
    >
      {hasCategory ? (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: `${row.categoryColor}22`,
            color: row.categoryColor ?? undefined,
          }}
          aria-hidden
        >
          <CategoryIcon icon={row.categoryIcon ?? ""} className="h-4 w-4" strokeWidth={2} />
        </div>
      ) : (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: isIncome ? "#DCFCE7" : "var(--surface-app)",
            color: isIncome ? "#166534" : "var(--text-tertiary)",
          }}
          aria-hidden
        >
          <ArrowDownLeft className="h-4 w-4" strokeWidth={2.5} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13.5px] font-semibold">
          {row.merchantName ?? row.rawDescription.slice(0, 48)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[color:var(--text-tertiary)]">
          <CategoryPicker
            txId={row.id}
            currentCategoryId={row.categoryId}
            currentSlug={row.categorySlug}
            currentIcon={row.categoryIcon}
            currentColor={row.categoryColor}
            currentName={categoryName}
            needsReview={row.needsReview}
            options={categoryOptions}
            locale={locale}
            placeholderLabel={uncategorizedLabel}
            reviewLabel={reviewLabel}
          />
          <span className="truncate">{row.institutionName}</span>
          {row.ibanLast4 ? <span>· …{row.ibanLast4}</span> : null}
          {isTransfer ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-primary-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[color:var(--brand-primary)]"
              title={transferLabel}
            >
              <ArrowLeftRight className="h-3 w-3" strokeWidth={2} />
              {transferLabel}
              <button
                type="button"
                onClick={() =>
                  startUnlink(async () => {
                    await unlinkTransferAction(row.id);
                  })
                }
                disabled={unlinking}
                aria-label={transferRemoveLabel}
                title={transferRemoveLabel}
                className="ml-0.5 rounded-full p-0.5 hover:bg-[color:var(--brand-primary)]/15 disabled:opacity-50"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={cn("tnum text-[14.5px] font-semibold whitespace-nowrap")}
        style={{
          color: isIncome ? "#059669" : "var(--text-primary)",
        }}
      >
        <PrivacyAmount
          value={`${isIncome ? "+" : ""}${formatAmount(row.amountCents, row.currency, intlLocale)}`}
        />
      </div>
    </div>
  );
}

export function TransactionsView(props: TransactionsViewProps) {
  const t = useTranslations("transactions");
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [extraRows, setExtraRows] = useState<TransactionRow[]>([]);
  const [cursor, setCursor] = useState<{ bookingDate: number; id: number } | null>(
    props.initialNextCursor,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();

  const allRows = useMemo(() => [...props.rows, ...extraRows], [props.rows, extraRows]);

  const banks = useMemo(() => {
    const set = new Set(allRows.map((r) => r.institutionName));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => rowMatches(r, bankFilter, catFilter, q));
  }, [allRows, search, bankFilter, catFilter]);

  function loadMore() {
    if (!cursor || isLoading) return;
    setLoadError(null);
    startLoading(async () => {
      try {
        const result = await loadMoreTransactionsAction(cursor, {
          needsReviewOnly: props.reviewOnly,
        });
        setExtraRows((prev) => [...prev, ...result.rows]);
        setCursor(result.nextCursor);
      } catch {
        setLoadError("error");
      }
    });
  }

  const totals = useMemo(() => {
    let inCents = 0;
    let outCents = 0;
    const currency = filtered[0]?.currency ?? allRows[0]?.currency ?? props.fallbackCurrency;
    for (const r of filtered) {
      // Internal transfers move money between the user's own accounts — they're
      // neither income nor expense, so keep them out of the Money in/out totals.
      if (r.transferGroupId) continue;
      if (r.amountCents > 0) inCents += r.amountCents;
      else outCents += Math.abs(r.amountCents);
    }
    return {
      currency,
      inCents,
      outCents,
      netCents: inCents - outCents,
    };
  }, [filtered, allRows, props.fallbackCurrency]);

  // Group by booking day (local calendar day).
  const groups = useMemo(() => {
    const map = new Map<string, TransactionRow[]>();
    for (const r of filtered) {
      const d = r.bookingDate instanceof Date ? r.bookingDate : new Date(r.bookingDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    const keys = Array.from(map.keys()).sort().reverse();
    return keys.map((k) => ({ date: k, rows: map.get(k) ?? [] }));
  }, [filtered]);

  const fmtGroupDate = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    const today = new Date();
    const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
    if (iso === todayKey) return props.labels.today;
    const yd = new Date(today);
    yd.setUTCDate(yd.getUTCDate() - 1);
    const ydKey = `${yd.getUTCFullYear()}-${String(yd.getUTCMonth() + 1).padStart(2, "0")}-${String(yd.getUTCDate()).padStart(2, "0")}`;
    if (iso === ydKey) return props.labels.yesterday;
    const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
    return new Intl.DateTimeFormat(props.intlLocale, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(date);
  };

  function clearFilters() {
    setSearch("");
    setBankFilter("all");
    setCatFilter("all");
  }

  const anyFilter = search !== "" || bankFilter !== "all" || catFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="coin-card p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
            {props.labels.moneyIn}
          </div>
          <div
            className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]"
            style={{ color: "#059669" }}
          >
            <PrivacyAmount
              value={`+${formatAmount(totals.inCents, totals.currency, props.intlLocale)}`}
            />
          </div>
        </div>
        <div className="coin-card p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
            {props.labels.moneyOut}
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]">
            <PrivacyAmount
              value={`-${formatAmount(totals.outCents, totals.currency, props.intlLocale)}`}
            />
          </div>
        </div>
        <div className="coin-card p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
            {props.labels.netFlow}
          </div>
          <div
            className="tnum mt-1 text-[22px] font-semibold tracking-[-0.015em]"
            style={{ color: totals.netCents >= 0 ? "#059669" : "#DC2626" }}
          >
            <PrivacyAmount
              value={formatSigned(totals.netCents, totals.currency, props.intlLocale)}
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="coin-card p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex flex-1 min-w-[240px] items-center gap-1.5 rounded-lg bg-[color:var(--surface-app)] px-3 py-2">
            <SearchX
              className="h-3.5 w-3.5 text-[color:var(--text-tertiary)] rotate-180"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={props.labels.searchPlaceholder}
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-tertiary)]"
            />
          </div>
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-[13px] text-[color:var(--text-primary)]"
          >
            <option value="all">{props.labels.allBanks}</option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-[13px] text-[color:var(--text-primary)]"
          >
            <option value="all">{props.labels.allCategories}</option>
            <option value="none">{props.labels.uncategorized}</option>
            {props.categoryOptions.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {props.locale === "es" ? o.nameEs : o.nameEn}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-[color:var(--border-default)] text-[12px]">
              <Link
                href="/transactions"
                className={cn(
                  "px-3 py-1.5",
                  props.reviewOnly
                    ? "text-[color:var(--text-secondary)]"
                    : "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)] font-medium",
                )}
              >
                {props.labels.filterAll}
              </Link>
              <Link
                href="/transactions?review=1"
                className={cn(
                  "border-l border-[color:var(--border-default)] px-3 py-1.5",
                  props.reviewOnly
                    ? "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)] font-medium"
                    : "text-[color:var(--text-secondary)]",
                )}
              >
                {props.labels.filterReview}
              </Link>
            </div>
            {anyFilter ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-1 px-2 text-[12px]"
              >
                <X className="h-3 w-3" /> {props.labels.clear}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)]">
          {t("countLine", { count: filtered.length, banks: banks.length })}
        </div>
      </div>

      {/* Grouped list */}
      {groups.length === 0 ? (
        <div className="coin-card p-14 text-center">
          <SearchX className="mx-auto mb-3 h-7 w-7 text-[color:var(--text-tertiary)]" aria-hidden />
          <p className="text-[13px] text-[color:var(--text-secondary)]">{props.labels.noMatch}</p>
        </div>
      ) : (
        <div className="coin-card overflow-hidden p-0">
          {groups.map((g) => {
            const daySum = g.rows.reduce((acc, r) => acc + r.amountCents, 0);
            const dayCurrency = g.rows[0]?.currency ?? totals.currency;
            return (
              <div key={g.date}>
                <div className="flex items-center justify-between border-t border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-secondary)] first:border-t-0">
                  <span>{fmtGroupDate(g.date)}</span>
                  <span className="tnum">
                    <PrivacyAmount value={formatSigned(daySum, dayCurrency, props.intlLocale)} />
                  </span>
                </div>
                {g.rows.map((r) => (
                  <TransactionRowItem
                    key={r.id}
                    row={r}
                    locale={props.locale}
                    intlLocale={props.intlLocale}
                    categoryOptions={props.categoryOptions}
                    uncategorizedLabel={props.labels.uncategorized}
                    reviewLabel={props.labels.reviewBadge}
                    transferLabel={t("transferBadge")}
                    transferRemoveLabel={t("transferRemove")}
                  />
                ))}
              </div>
            );
          })}
          {/* Pagination footer */}
          <div className="border-t border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-5 py-3 text-center">
            {cursor ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={isLoading}
                className="gap-1.5"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {props.labels.loadingMore}
                  </>
                ) : (
                  props.labels.loadMore
                )}
              </Button>
            ) : (
              <span className="text-[11.5px] text-[color:var(--text-tertiary)]">
                {props.labels.endOfList}
              </span>
            )}
            {loadError ? (
              <p className="mt-1 text-[11px] text-[color:var(--error)]">{loadError}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
