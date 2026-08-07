"use client";

import { AlertTriangle, CheckCircle2, Loader2, PlusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CategoryOption } from "@/lib/transactions/actions";
import { addManualTransactionAction } from "./manual-transaction-action";

export interface ManualTransactionLabels {
  sectionTitle: string;
  sectionSubtitle: string;
  typeExpense: string;
  typeIncome: string;
  dateLabel: string;
  amountLabel: string;
  currencyLabel: string;
  merchantLabel: string;
  merchantPlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  categoryLabel: string;
  categoryNone: string;
  submitButton: string;
  submitting: string;
  successMessage: string;
  errorInvalidDate: string;
  errorInvalidAmount: string;
  errorMissingDescription: string;
  errorGeneric: string;
}

interface Props {
  labels: ManualTransactionLabels;
  categories: CategoryOption[];
  locale: string;
}

type TransactionType = "expense" | "income";

export function ManualTransactionForm({ labels, categories, locale }: Props) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<TransactionType>("expense");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function humanizeError(raw: string): string {
    if (raw === "invalidDate") return labels.errorInvalidDate;
    if (raw === "invalidAmount") return labels.errorInvalidAmount;
    if (raw === "missingDescription") return labels.errorMissingDescription;
    return labels.errorGeneric;
  }

  function reset() {
    setDate(today);
    setAmount("");
    setMerchant("");
    setDescription("");
    setCategoryId(null);
    setType("expense");
    setSuccess(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setError(null);

    const parsed = Number.parseFloat(amount.replace(",", "."));
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setError(labels.errorInvalidAmount);
      return;
    }

    const amountCents = Math.round(parsed * 100) * (type === "expense" ? -1 : 1);

    startTransition(async () => {
      const res = await addManualTransactionAction({
        date,
        amountCents,
        currency,
        merchant,
        description,
        categoryId,
      });

      if (!res.ok) {
        setError(humanizeError(res.error ?? ""));
        return;
      }

      setSuccess(true);
      router.refresh();
      // Keep the date so the user can quickly add multiple entries for the same day.
      setAmount("");
      setMerchant("");
      setDescription("");
      setCategoryId(null);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Expense / Income toggle */}
      <div className="flex rounded-lg border border-[color:var(--border-default)] overflow-hidden text-sm font-medium">
        {(["expense", "income"] as TransactionType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            disabled={pending}
            className={[
              "flex-1 py-2 transition-colors",
              type === t
                ? t === "expense"
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "text-[color:var(--text-secondary)] hover:bg-[color:var(--brand-primary-soft)]",
            ].join(" ")}
          >
            {t === "expense" ? `− ${labels.typeExpense}` : `+ ${labels.typeIncome}`}
          </button>
        ))}
      </div>

      {/* Row 1: date + amount + currency */}
      <div className="grid grid-cols-[1fr_1fr_80px] gap-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
            {labels.dateLabel}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={pending}
            className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
            {labels.amountLabel}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            disabled={pending}
            className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
            {labels.currencyLabel}
          </span>
          <input
            type="text"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            disabled={pending}
            className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm uppercase shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </label>
      </div>

      {/* Row 2: merchant + description */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
            {labels.merchantLabel}
          </span>
          <input
            type="text"
            placeholder={labels.merchantPlaceholder}
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
            {labels.descriptionLabel} <span className="text-red-500">*</span>
          </span>
          <input
            type="text"
            placeholder={labels.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            disabled={pending}
            className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </label>
      </div>

      {/* Row 3: category */}
      <label className="block space-y-1">
        <span className="block text-xs font-medium text-[color:var(--text-secondary)]">
          {labels.categoryLabel}
        </span>
        <select
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          disabled={pending}
          className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">{labels.categoryNone}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {locale === "es" ? c.nameEs : c.nameEn}
            </option>
          ))}
        </select>
      </label>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {labels.successMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        {success && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[color:var(--text-tertiary)] underline-offset-2 hover:underline"
          >
            + {labels.submitButton}
          </button>
        )}
        <div className="ml-auto">
          <button
            type="submit"
            disabled={pending || !date || !amount || !description}
            className="flex items-center gap-2 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="h-4 w-4" />
            )}
            {pending ? labels.submitting : labels.submitButton}
          </button>
        </div>
      </div>
    </form>
  );
}
