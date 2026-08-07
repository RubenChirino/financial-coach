"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  createManualAccountAction,
  type ManualAccountInput,
  type ManualAccountKind,
  type ManualAccountRow,
  updateManualAccountAction,
} from "@/lib/accounts/manual";

const KINDS: ManualAccountKind[] = ["cash", "investment", "property", "vehicle", "loan", "other"];

interface Props {
  currency: string;
  account?: ManualAccountRow | null;
  onClose: () => void;
}

/**
 * Create / edit a manual (non-bank) account: cash, investments, property,
 * vehicles, or loans. Manual balances count toward net worth; liabilities
 * (loans) are subtracted (the server stores them negative).
 */
export function ManualAccountForm({ currency, account, onClose }: Props) {
  const t = useTranslations("bank");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ManualAccountKind>(
    (account?.kind as ManualAccountKind) ?? "cash",
  );
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const amount = Number.parseFloat(String(fd.get("balance") ?? "0").replace(",", "."));
    if (!name) {
      setError(t("manual.errorName"));
      return;
    }
    if (Number.isNaN(amount)) {
      setError(t("manual.errorBalance"));
      return;
    }
    const input: ManualAccountInput = {
      name,
      kind,
      balanceCents: Math.round(amount * 100),
      currency,
    };
    setError(null);
    startTransition(async () => {
      const res = account
        ? await updateManualAccountAction(account.id, input)
        : await createManualAccountAction(input);
      if (!res.ok) {
        setError(t("manual.errorGeneric"));
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const fid = account ? `manual-${account.id}` : "manual-new";
  const initialBalance = account != null ? (Math.abs(account.balanceCents) / 100).toFixed(2) : "";

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
        className="coin-card w-full max-w-md p-6"
        aria-labelledby={`${fid}-title`}
      >
        <div className="flex items-center justify-between">
          <h2 id={`${fid}-title`} className="text-[15px] font-semibold">
            {account ? t("manual.editTitle") : t("manual.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)]"
            aria-label={t("manual.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">{t("manual.hint")}</p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor={`${fid}-name`}
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {t("manual.nameLabel")}
            </label>
            <input
              id={`${fid}-name`}
              ref={nameRef}
              name="name"
              defaultValue={account?.name ?? ""}
              placeholder={t("manual.namePlaceholder")}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${fid}-kind`}
                className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
              >
                {t("manual.kindLabel")}
              </label>
              <select
                id={`${fid}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as ManualAccountKind)}
                className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`manual.kind.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${fid}-balance`}
                className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
              >
                {t("manual.balanceLabel")} ({currency})
              </label>
              <input
                id={`${fid}-balance`}
                name="balance"
                type="number"
                step="0.01"
                defaultValue={initialBalance}
                placeholder="0.00"
                className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
              />
            </div>
          </div>

          {kind === "loan" ? (
            <p className="text-[11.5px] text-[color:var(--text-tertiary)]">
              {t("manual.loanHint")}
            </p>
          ) : null}

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--surface-app)] disabled:opacity-50"
            >
              {t("manual.cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("manual.save")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
