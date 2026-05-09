"use client";

import type { ImportBatchRow } from "@/lib/import/batches";
import { AlertTriangle, FileText, Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteImportBatchAction, resetAllTransactionsAction } from "./batch-actions";

export interface ImportHistoryLabels {
  title: string;
  empty: string;
  pastedLabel: string;
  rowsInserted: string; // "{n} imported"
  rowsDuplicate: string; // "{n} duplicates"
  deleteButton: string;
  deleteConfirm: string; // "Delete {n} transactions from {name}?"
  deleting: string;
  deleteError: string;
  resetAll: string;
  resetAllConfirm: string;
  resetAllSuccess: string; // "{n} transactions deleted"
}

export function ImportHistory({
  batches,
  labels,
  intlLocale,
}: {
  batches: ImportBatchRow[];
  labels: ImportHistoryLabels;
  intlLocale: string;
}) {
  return (
    <div className="space-y-4">
      {batches.length === 0 ? (
        <p className="text-[12.5px] text-[color:var(--text-tertiary)]">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border-default)]">
          {batches.map((b) => (
            <BatchRow key={b.id} batch={b} labels={labels} intlLocale={intlLocale} />
          ))}
        </ul>
      )}

      {/* Reset all — always visible so users can wipe data imported before
          batch tracking was introduced (those rows have no importBatchId). */}
      <ResetAllButton labels={labels} />
    </div>
  );
}

function BatchRow({
  batch,
  labels,
  intlLocale,
}: {
  batch: ImportBatchRow;
  labels: ImportHistoryLabels;
  intlLocale: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const name = batch.filename ?? labels.pastedLabel;
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleDelete() {
    const msg = labels.deleteConfirm
      .replace("{n}", String(batch.rowsInserted))
      .replace("{name}", name);
    if (!window.confirm(msg)) return;
    setError(null);
    start(async () => {
      const res = await deleteImportBatchAction(batch.id);
      if (!res.ok) setError(labels.deleteError);
    });
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color:var(--brand-primary-soft)]">
        <FileText className="h-4 w-4 text-[color:var(--brand-primary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--text-tertiary)]">
          <span>{dateFmt.format(batch.createdAt)}</span>
          <span className="text-emerald-600 dark:text-emerald-400">
            {labels.rowsInserted.replace("{n}", String(batch.rowsInserted))}
          </span>
          {batch.rowsDuplicate > 0 && (
            <span>{labels.rowsDuplicate.replace("{n}", String(batch.rowsDuplicate))}</span>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      </div>
      {/* Allow deleting even 0-row batches — removes the history record. */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        title={labels.deleteButton}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--text-tertiary)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </li>
  );
}

function ResetAllButton({ labels }: { labels: ImportHistoryLabels }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleReset() {
    if (!window.confirm(labels.resetAllConfirm)) return;
    setResult(null);
    setError(null);
    start(async () => {
      const res = await resetAllTransactionsAction();
      if (!res.ok) {
        setError(res.error ?? "Unknown error");
      } else {
        setResult(
          labels.resetAllSuccess.replace("{n}", String(res.deletedTransactions ?? 0)),
        );
      }
    });
  }

  if (result) {
    return (
      <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">{result}</p>
    );
  }

  return (
    <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-red-600 dark:text-red-400">
            {labels.resetAll}
          </p>
          {error && (
            <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-red-500">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1.5 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400 disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {pending ? labels.deleting : labels.resetAll}
        </button>
      </div>
    </div>
  );
}
