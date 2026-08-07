"use client";

import {
  ArrowLeft,
  CalendarRange,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Grid3X3,
  Landmark,
  List,
  Loader2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { type ExportDataResult, exportDataAction } from "@/lib/export/actions";
import { buildCsv, buildExportPdf, downloadBlob } from "@/lib/export/build-files";
import { cn } from "@/lib/utils";

type ExportKind = "transactions" | "heatmap";
type ExportFormat = "csv" | "pdf";
type RangeKey = "today" | "3d" | "1w" | "1m" | "3m" | "1y" | "custom";
type Step = "accounts" | "kind" | "range" | "format";

const RANGE_KEYS: readonly RangeKey[] = ["today", "3d", "1w", "1m", "3m", "1y", "custom"];

export interface ExportAccountOption {
  id: number;
  label: string;
}

interface Props {
  accounts: ExportAccountOption[];
  currency: string;
  intlLocale: string;
  locale: "es" | "en";
}

/** Header trigger — owns the open state, renders the wizard when open. */
export function ExportButton(props: Props) {
  const t = useTranslations("transactions");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Download className="h-3.5 w-3.5" /> {t("export.button")}
      </Button>
      {open ? <ExportDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Resolve a range key (+ custom inputs) into a UTC [from, to] window in ms. */
function resolveRange(
  key: RangeKey,
  customFrom: string,
  customTo: string,
): { fromMs: number; toMs: number } | null {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const endOfToday = Date.UTC(y, m, d, 23, 59, 59, 999);

  const startDaysAgo = (days: number) => Date.UTC(y, m, d - days);
  switch (key) {
    case "today":
      return { fromMs: Date.UTC(y, m, d), toMs: endOfToday };
    case "3d":
      return { fromMs: startDaysAgo(3), toMs: endOfToday };
    case "1w":
      return { fromMs: startDaysAgo(7), toMs: endOfToday };
    case "1m":
      return { fromMs: Date.UTC(y, m - 1, d), toMs: endOfToday };
    case "3m":
      return { fromMs: Date.UTC(y, m - 3, d), toMs: endOfToday };
    case "1y":
      return { fromMs: Date.UTC(y - 1, m, d), toMs: endOfToday };
    case "custom": {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(customFrom) || !re.test(customTo)) return null;
      const [fy, fm, fd] = customFrom.split("-").map(Number);
      const [ty, tm, td] = customTo.split("-").map(Number);
      const fromMs = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
      const toMs = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1, 23, 59, 59, 999);
      if (fromMs > toMs) return null;
      return { fromMs, toMs };
    }
  }
}

interface FileLabels {
  brandName: string;
  title: string;
  rangeLine: string;
  accountsLine: string;
  generatedLine: string;
  moneyIn: string;
  moneyOut: string;
  netFlow: string;
  colDate: string;
  colMerchant: string;
  colDescription: string;
  colCategory: string;
  colAccount: string;
  colInstitution: string;
  colAmount: string;
  colCurrency: string;
  pageLabel: (page: number, total: number) => string;
}

/** Build the chosen file from the server payload and trigger the download. */
async function buildAndDownload(opts: {
  res: ExportDataResult;
  kind: ExportKind;
  format: ExportFormat;
  locale: "es" | "en";
  fmt: (cents: number) => string;
  labels: FileLabels;
  filename: string;
}): Promise<void> {
  const { res, kind, format, locale, fmt, labels, filename } = opts;
  const txRows = res.transactions ?? [];
  const hmRows = res.heatmap ?? [];

  const totals =
    kind === "transactions"
      ? txRows.reduce(
          (acc, r) => {
            if (r.amountCents >= 0) acc.in += r.amountCents;
            else acc.out += -r.amountCents;
            return acc;
          },
          { in: 0, out: 0 },
        )
      : hmRows.reduce(
          (acc, r) => {
            acc.in += r.receivedCents;
            acc.out += r.spentCents;
            return acc;
          },
          { in: 0, out: 0 },
        );
  const net = totals.in - totals.out;

  if (format === "csv") {
    const blob =
      kind === "transactions"
        ? buildCsv(
            [
              labels.colDate,
              labels.colMerchant,
              labels.colDescription,
              labels.colCategory,
              labels.colAccount,
              labels.colInstitution,
              labels.colAmount,
              labels.colCurrency,
            ],
            txRows.map((r) => [
              r.date,
              r.merchant,
              r.description,
              locale === "es" ? r.categoryEs : r.categoryEn,
              r.account,
              r.institution,
              (r.amountCents / 100).toFixed(2),
              r.currency,
            ]),
          )
        : buildCsv(
            [labels.colDate, labels.moneyIn, labels.moneyOut, labels.netFlow],
            hmRows.map((r) => [
              r.date,
              (r.receivedCents / 100).toFixed(2),
              (r.spentCents / 100).toFixed(2),
              (r.netCents / 100).toFixed(2),
            ]),
          );
    downloadBlob(blob, `${filename}.csv`);
    return;
  }

  const blob = await buildExportPdf({
    brandName: labels.brandName,
    title: labels.title,
    rangeLine: labels.rangeLine,
    accountsLine: labels.accountsLine,
    generatedLine: labels.generatedLine,
    summary: [
      { label: labels.moneyIn, value: `+${fmt(totals.in)}`, tone: "pos" },
      { label: labels.moneyOut, value: `-${fmt(totals.out)}`, tone: "neutral" },
      { label: labels.netFlow, value: fmt(net), tone: net >= 0 ? "pos" : "neg" },
    ],
    columns:
      kind === "transactions"
        ? [
            { header: labels.colDate },
            { header: labels.colMerchant },
            { header: labels.colCategory },
            { header: labels.colAccount },
            { header: labels.colAmount, align: "right" },
          ]
        : [
            { header: labels.colDate },
            { header: labels.moneyIn, align: "right" },
            { header: labels.moneyOut, align: "right" },
            { header: labels.netFlow, align: "right" },
          ],
    rows:
      kind === "transactions"
        ? txRows.map((r) => ({
            cells: [
              r.date,
              r.merchant || r.description.slice(0, 60),
              locale === "es" ? r.categoryEs : r.categoryEn,
              r.account,
              fmt(r.amountCents),
            ],
            tones: [
              undefined,
              undefined,
              undefined,
              undefined,
              r.amountCents >= 0 ? "pos" : undefined,
            ],
          }))
        : hmRows.map((r) => ({
            cells: [r.date, `+${fmt(r.receivedCents)}`, `-${fmt(r.spentCents)}`, fmt(r.netCents)],
            tones: [undefined, "pos", undefined, r.netCents >= 0 ? "pos" : "neg"],
          })),
    pageLabel: labels.pageLabel,
  });
  downloadBlob(blob, `${filename}.pdf`);
}

// ─── Step UI pieces ───────────────────────────────────────────────────────────

function OptionCard({
  selected,
  onClick,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
        selected
          ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)]"
          : "border-[color:var(--border-default)] hover:bg-[color:var(--surface-app)]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {hint ? (
          <span className="block text-[11.5px] text-[color:var(--text-tertiary)]">{hint}</span>
        ) : null}
      </span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" /> : null}
    </button>
  );
}

function StepAccounts({
  accounts,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  accounts: ExportAccountOption[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  const t = useTranslations("transactions");
  const allSelected = selectedIds.size === accounts.length;
  return (
    <>
      <p className="text-[12.5px] text-[color:var(--text-secondary)]">{t("export.accountsHint")}</p>
      <OptionCard
        selected={allSelected}
        onClick={onToggleAll}
        icon={<Landmark className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />}
        title={t("export.accountsAll")}
      />
      {accounts.map((a) => (
        <OptionCard
          key={a.id}
          selected={selectedIds.has(a.id)}
          onClick={() => onToggle(a.id)}
          icon={<span className="w-1" aria-hidden />}
          title={a.label}
        />
      ))}
    </>
  );
}

function StepKind({ kind, onPick }: { kind: ExportKind; onPick: (k: ExportKind) => void }) {
  const t = useTranslations("transactions");
  return (
    <>
      <OptionCard
        selected={kind === "transactions"}
        onClick={() => onPick("transactions")}
        icon={<List className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />}
        title={t("export.kindTx")}
        hint={t("export.kindTxHint")}
      />
      <OptionCard
        selected={kind === "heatmap"}
        onClick={() => onPick("heatmap")}
        icon={<Grid3X3 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />}
        title={t("export.kindHeatmap")}
        hint={t("export.kindHeatmapHint")}
      />
    </>
  );
}

function StepRange({
  rangeKey,
  onPick,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  rangeKey: RangeKey;
  onPick: (k: RangeKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  const t = useTranslations("transactions");
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {RANGE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
              rangeKey === key
                ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white"
                : "border-[color:var(--border-default)] text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-app)]",
            )}
          >
            {t(`export.range_${key}`)}
          </button>
        ))}
      </div>
      {rangeKey === "custom" ? (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="export-from"
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {t("export.fromLabel")}
            </label>
            <input
              id="export-from"
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>
          <div>
            <label
              htmlFor="export-to"
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {t("export.toLabel")}
            </label>
            <input
              id="export-to"
              type="date"
              value={customTo}
              onChange={(e) => onCustomTo(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--text-tertiary)]">
          <CalendarRange className="h-3.5 w-3.5" /> {t("export.rangeHint")}
        </p>
      )}
    </>
  );
}

function StepFormat({
  format,
  onPick,
}: {
  format: ExportFormat;
  onPick: (f: ExportFormat) => void;
}) {
  const t = useTranslations("transactions");
  return (
    <>
      <OptionCard
        selected={format === "csv"}
        onClick={() => onPick("csv")}
        icon={
          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />
        }
        title={t("export.formatCsv")}
        hint={t("export.formatCsvHint")}
      />
      <OptionCard
        selected={format === "pdf"}
        onClick={() => onPick("pdf")}
        icon={<FileText className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />}
        title={t("export.formatPdf")}
        hint={t("export.formatPdfHint")}
      />
    </>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function ExportDialog({
  accounts,
  currency,
  intlLocale,
  locale,
  onClose,
}: Props & { onClose: () => void }) {
  const t = useTranslations("transactions");
  const multiAccount = accounts.length > 1;
  const steps: Step[] = multiAccount
    ? ["accounts", "kind", "range", "format"]
    : ["kind", "range", "format"];

  const [stepIdx, setStepIdx] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(accounts.map((a) => a.id)),
  );
  const [kind, setKind] = useState<ExportKind>("transactions");
  const [rangeKey, setRangeKey] = useState<RangeKey>("1m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[stepIdx] ?? "format";
  const isLast = stepIdx === steps.length - 1;

  const canContinue =
    step === "accounts"
      ? selectedIds.size > 0
      : step === "range"
        ? resolveRange(rangeKey, customFrom, customTo) !== null
        : true;

  function toggleAccount(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goTo(delta: number) {
    setError(null);
    setStepIdx((i) => i + delta);
  }

  async function onExport() {
    const range = resolveRange(rangeKey, customFrom, customTo);
    if (!range) {
      setError(t("export.errorRange"));
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const allSelected = selectedIds.size === accounts.length;
      const res = await exportDataAction({
        kind,
        accountIds: multiAccount && !allSelected ? [...selectedIds] : null,
        fromMs: range.fromMs,
        toMs: range.toMs,
      });
      if (!res.ok) {
        setError(t("export.errorGeneric"));
        return;
      }
      const rowCount = (res.transactions ?? res.heatmap ?? []).length;
      if (rowCount === 0) {
        setError(t("export.errorEmpty"));
        return;
      }

      const cur = res.currency ?? currency;
      const fmt = (cents: number) =>
        new Intl.NumberFormat(intlLocale, { style: "currency", currency: cur }).format(cents / 100);
      const dateFmt = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" });
      const fromIso = new Date(range.fromMs).toISOString().slice(0, 10);
      const toIso = new Date(range.toMs).toISOString().slice(0, 10);

      await buildAndDownload({
        res,
        kind,
        format,
        locale,
        fmt,
        filename: `financial-coach-${kind}-${fromIso}_${toIso}`,
        labels: {
          brandName: "Financial Coach",
          title: kind === "transactions" ? t("export.pdfTitleTx") : t("export.pdfTitleHeatmap"),
          rangeLine: `${dateFmt.format(new Date(range.fromMs))} – ${dateFmt.format(new Date(range.toMs))}`,
          accountsLine: (res.accountLabels ?? []).join("  ·  ") || t("export.accountsAll"),
          generatedLine: t("export.generatedLine", {
            date: new Intl.DateTimeFormat(intlLocale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date()),
          }),
          moneyIn: t("moneyIn"),
          moneyOut: t("moneyOut"),
          netFlow: t("netFlow"),
          colDate: t("export.colDate"),
          colMerchant: t("export.colMerchant"),
          colDescription: t("export.colDescription"),
          colCategory: t("export.colCategory"),
          colAccount: t("export.colAccount"),
          colInstitution: t("export.colInstitution"),
          colAmount: t("export.colAmount"),
          colCurrency: t("export.colCurrency"),
          pageLabel: (page, total) => t("export.pageOf", { page, total }),
        },
      });
      onClose();
    } catch {
      setError(t("export.errorGeneric"));
    } finally {
      setExporting(false);
    }
  }

  const modal = (
    // biome-ignore lint/a11y/noStaticElementInteractions: decorative scrim; the <dialog> inside carries the semantics and Escape handling, and an interactive role here would wrongly enter the tab order.
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        className="coin-card static w-full max-w-md p-6"
        aria-labelledby="export-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 id="export-title" className="text-[15px] font-semibold">
              {t("export.title")}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-[color:var(--text-tertiary)]">
              {t("export.stepOf", { step: stepIdx + 1, total: steps.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)]"
            aria-label={t("export.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          {step === "accounts" ? (
            <StepAccounts
              accounts={accounts}
              selectedIds={selectedIds}
              onToggle={toggleAccount}
              onToggleAll={() =>
                setSelectedIds(
                  selectedIds.size === accounts.length
                    ? new Set()
                    : new Set(accounts.map((a) => a.id)),
                )
              }
            />
          ) : null}
          {step === "kind" ? <StepKind kind={kind} onPick={setKind} /> : null}
          {step === "range" ? (
            <StepRange
              rangeKey={rangeKey}
              onPick={setRangeKey}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFrom={setCustomFrom}
              onCustomTo={setCustomTo}
            />
          ) : null}
          {step === "format" ? <StepFormat format={format} onPick={setFormat} /> : null}
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between gap-2">
          {stepIdx > 0 ? (
            <button
              type="button"
              onClick={() => goTo(-1)}
              disabled={exporting}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[13px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("export.back")}
            </button>
          ) : (
            <span />
          )}
          {isLast ? (
            <button
              type="button"
              onClick={() => void onExport()}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? t("export.exporting") : t("export.exportNow")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(1)}
              disabled={!canContinue}
              className="rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:opacity-50"
            >
              {t("export.continue")}
            </button>
          )}
        </div>
      </dialog>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
