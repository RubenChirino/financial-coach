"use client";

import { changePinAction, deleteAllDataAction } from "@/lib/auth/security-actions";
import { AlertTriangle, Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

interface SecurityLabels {
  changePinTitle: string;
  changePinDescription: string;
  currentPinLabel: string;
  newPinLabel: string;
  confirmPinLabel: string;
  changePinSubmit: string;
  changePinSuccess: string;
  changePinWarning: string;
  dangerZone: string;
  deleteAllTitle: string;
  deleteAllDescription: string;
  deleteAllConfirm: string;
  deleteAllPinLabel: string;
  deleteAllCancel: string;
  deleteAllSubmit: string;
  deleteAllWarning: string;
  error: {
    invalidPin: string;
    invalidNewPin: string;
    mismatch: string;
    samePin: string;
    wrongPin: string;
    notAuthenticated: string;
    generic: string;
  };
}

export function SecurityCard({ labels }: { labels: SecurityLabels }) {
  return (
    <div className="space-y-6">
      <ChangePinForm labels={labels} />
      <DangerZone labels={labels} />
    </div>
  );
}

function ChangePinForm({ labels }: { labels: SecurityLabels }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!showSaved) return;
    const id = setTimeout(() => setShowSaved(false), 3000);
    return () => clearTimeout(id);
  }, [showSaved]);

  function mapError(key: string | undefined): string {
    if (!key) return labels.error.generic;
    const m = labels.error as unknown as Record<string, string>;
    return m[key] ?? labels.error.generic;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await changePinAction(fd);
      if (result.ok) {
        form.reset();
        setShowSaved(true);
      } else {
        setError(mapError(result.error));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
          <KeyRound className="h-4 w-4" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[14px] font-semibold">{labels.changePinTitle}</div>
          <div className="text-[12px] text-[color:var(--text-tertiary)]">
            {labels.changePinDescription}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <PinField
          name="currentPin"
          label={labels.currentPinLabel}
          autoComplete="current-password"
        />
        <PinField name="newPin" label={labels.newPinLabel} autoComplete="new-password" />
        <PinField name="confirmPin" label={labels.confirmPinLabel} autoComplete="new-password" />
      </div>

      <p
        className="flex items-start gap-2 rounded-lg p-3 text-[12px]"
        style={{
          background: "var(--warning-soft)",
          color: "var(--warning)",
          border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)",
        }}
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{labels.changePinWarning}</span>
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {labels.changePinSubmit}
        </button>
        {showSaved ? (
          <span
            className="inline-flex items-center gap-1 text-[12.5px] font-medium"
            style={{ color: "var(--success)" }}
          >
            <Check className="h-3.5 w-3.5" />
            {labels.changePinSuccess}
          </span>
        ) : null}
        {error ? (
          <span className="text-[12.5px] font-medium" style={{ color: "var(--error)" }}>
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function PinField({
  name,
  label,
  autoComplete,
}: {
  name: string;
  label: string;
  autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-[color:var(--text-secondary)]">{label}</span>
      <input
        type="password"
        name={name}
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        minLength={4}
        required
        autoComplete={autoComplete}
        className="tnum w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-center text-lg tracking-[0.3em] text-[color:var(--text-primary)] focus:border-[color:var(--brand-primary)] focus:outline-none"
      />
    </label>
  );
}

function DangerZone({ labels }: { labels: SecurityLabels }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function mapError(key: string | undefined): string {
    if (!key) return labels.error.generic;
    const m = labels.error as unknown as Record<string, string>;
    return m[key] ?? labels.error.generic;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await deleteAllDataAction(fd);
      // Successful delete redirects; we only get here on error.
      if (result && !result.ok) setError(mapError(result.error));
    });
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "color-mix(in srgb, var(--error) 30%, transparent)",
        background: "color-mix(in srgb, var(--error) 6%, transparent)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[10px]"
          style={{
            background: "color-mix(in srgb, var(--error) 15%, transparent)",
            color: "var(--error)",
          }}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[14px] font-semibold" style={{ color: "var(--error)" }}>
            {labels.dangerZone}
          </div>
          <div
            className="text-[12px]"
            style={{ color: "color-mix(in srgb, var(--error) 80%, var(--text-secondary))" }}
          >
            {labels.deleteAllDescription}
          </div>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:opacity-90"
          style={{
            borderColor: "color-mix(in srgb, var(--error) 40%, transparent)",
            background: "transparent",
            color: "var(--error)",
          }}
        >
          {labels.deleteAllTitle}
        </button>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <p
            className="flex items-start gap-2 text-[12.5px] font-medium"
            style={{ color: "var(--error)" }}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{labels.deleteAllWarning}</span>
          </p>
          <div className="max-w-[200px]">
            <PinField name="pin" label={labels.deleteAllPinLabel} autoComplete="off" />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {labels.deleteAllSubmit}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-app)]"
            >
              {labels.deleteAllCancel}
            </button>
            {error ? (
              <span className="text-[12.5px] font-medium" style={{ color: "var(--error)" }}>
                {error}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
