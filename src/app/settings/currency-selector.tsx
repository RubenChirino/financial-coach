"use client";

import { updateCurrencyAction } from "@/lib/settings/actions";
import { SUPPORTED_CURRENCIES } from "@/lib/settings/constants";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function CurrencySelector({
  current,
  label,
  hintLabel,
}: {
  current: string;
  label: string;
  hintLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    startTransition(async () => {
      await updateCurrencyAction(value);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="currency-select"
        className="text-sm font-medium text-[color:var(--text-primary)]"
      >
        {label}
      </label>
      <select
        id="currency-select"
        value={current}
        onChange={onChange}
        disabled={isPending}
        className="w-fit rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-sm text-[color:var(--text-primary)] disabled:opacity-50"
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <p className="text-xs text-[color:var(--text-tertiary)]">{hintLabel}</p>
    </div>
  );
}
