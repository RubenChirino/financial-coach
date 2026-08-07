"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { setCategoryBudgetAction } from "@/lib/categories/actions";

interface Props {
  categoryId: number;
  initialBudgetCents: number | null;
  currency: string;
  locale: string;
  placeholder: string;
}

/**
 * Budget as a free-form amount string. Accepts "42.50", "42,50", or empty.
 * Empty clears the budget. We store it as integer cents.
 */
export function BudgetInput({
  categoryId,
  initialBudgetCents,
  currency,
  locale,
  placeholder,
}: Props) {
  const [value, setValue] = useState(
    initialBudgetCents != null ? (initialBudgetCents / 100).toFixed(2) : "",
  );
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function commit() {
    const cleaned = value.trim().replace(/\s/g, "").replace(",", ".");
    let cents: number | null = null;
    if (cleaned !== "") {
      const n = Number.parseFloat(cleaned);
      if (!Number.isFinite(n) || n < 0) return;
      cents = Math.round(n * 100);
    }
    startTransition(async () => {
      const res = await setCategoryBudgetAction(categoryId, cents);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        inputMode="decimal"
        className="h-8 w-24 text-right tabular-nums"
        aria-label={placeholder}
      />
      <span className="text-xs text-muted-foreground">
        {new Intl.NumberFormat(locale, { style: "currency", currency })
          .formatToParts(0)
          .find((p) => p.type === "currency")?.value ?? currency}
      </span>
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : saved ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <span className="w-3.5" />
      )}
    </div>
  );
}
