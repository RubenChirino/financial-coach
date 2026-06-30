"use client";

import { CategoryIcon } from "@/components/category-icon";
import { createRuleFromTransactionAction } from "@/lib/categorize/rules-actions";
import type { CategoryOption } from "@/lib/transactions/actions";
import { setTransactionCategoryAction } from "@/lib/transactions/actions";
import { cn } from "@/lib/utils";
import { Check, Loader2, Sparkles, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

interface Props {
  txId: number;
  currentCategoryId: number | null;
  currentSlug: string | null;
  currentIcon: string | null;
  currentColor: string | null;
  currentName: string | null;
  needsReview: boolean;
  options: CategoryOption[];
  locale: "es" | "en";
  placeholderLabel: string;
  reviewLabel: string;
}

/**
 * Tag-style category picker.
 *
 * Clicking the chip opens a small popover with a search box and a grid of
 * colored tag tiles — one per category — plus a "clear" tag. Picking a tile
 * fires the server action and closes the popover.
 *
 * The popover is a lightweight custom implementation: position via sibling
 * absolute, close on outside click / Escape. No external dep needed.
 */
export function CategoryPicker(props: Props) {
  const t = useTranslations("transactions");
  const [pending, startTransition] = useTransition();
  const [savingRule, startSaveRule] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // After a manual pick, the server may suggest learning a reusable rule.
  const [ruleOffer, setRuleOffer] = useState<{ merchant: string; categoryId: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Focus search when opening.
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(nextId: number | null) {
    setOpen(false);
    startTransition(async () => {
      const res = await setTransactionCategoryAction(props.txId, nextId);
      if (res.ok && res.suggestRule && nextId != null) {
        setRuleOffer({ merchant: res.suggestRule.merchant, categoryId: nextId });
      } else {
        setRuleOffer(null);
      }
    });
  }

  function saveRule() {
    const offer = ruleOffer;
    if (!offer) return;
    startSaveRule(async () => {
      await createRuleFromTransactionAction(props.txId, offer.categoryId);
      setRuleOffer(null);
    });
  }

  const label = props.currentName ?? props.placeholderLabel;
  const chipStyle = props.currentColor
    ? { backgroundColor: `${props.currentColor}22`, color: props.currentColor }
    : undefined;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? props.options.filter((o) =>
        (props.locale === "es" ? o.nameEs : o.nameEn).toLowerCase().includes(q),
      )
    : props.options;

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
          props.currentCategoryId == null
            ? "border-dashed border-amber-400/50 bg-amber-400/8 text-amber-600 dark:text-amber-400 hover:bg-amber-400/15"
            : "hover:bg-[color:var(--brand-primary-soft)]",
          props.needsReview && "ring-1 ring-amber-400/60",
        )}
        style={props.currentCategoryId != null ? chipStyle : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {props.currentIcon ? (
          <CategoryIcon icon={props.currentIcon} className="h-3 w-3" strokeWidth={2} />
        ) : (
          <Tag className="h-3 w-3" aria-hidden />
        )}
        <span className="truncate max-w-[10rem]">{label}</span>
        {props.needsReview ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            {props.reviewLabel}
          </span>
        ) : null}
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[280px] rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-2.5 shadow-[var(--shadow-card)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={props.placeholderLabel}
            className="mb-2 w-full rounded-md bg-[color:var(--surface-app)] px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => pick(null)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11.5px] text-muted-foreground hover:bg-[color:var(--surface-app)]",
                props.currentCategoryId == null && "bg-[color:var(--surface-app)]",
              )}
            >
              <X className="h-2.5 w-2.5" />
              {props.placeholderLabel}
            </button>
            {filtered.map((o) => {
              const active = o.id === props.currentCategoryId;
              const name = props.locale === "es" ? o.nameEs : o.nameEn;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pick(o.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium transition-colors hover:brightness-105",
                    active && "ring-1 ring-offset-1",
                  )}
                  style={{
                    backgroundColor: `${o.color}22`,
                    color: o.color,
                    borderColor: active ? o.color : "transparent",
                  }}
                >
                  <CategoryIcon icon={o.icon} className="h-3 w-3" strokeWidth={2} />
                  <span>{name}</span>
                  {active ? <Check className="h-2.5 w-2.5" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {ruleOffer && !open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[260px] rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-3 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-2">
            <Sparkles
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--brand-primary)]"
              aria-hidden
            />
            <p className="text-[12px] leading-snug text-[color:var(--text-secondary)]">
              {t("ruleOfferTitle", { merchant: ruleOffer.merchant })}
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setRuleOffer(null)}
              className="rounded-md px-2 py-1 text-[11.5px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
            >
              {t("ruleOfferDismiss")}
            </button>
            <button
              type="button"
              onClick={saveRule}
              disabled={savingRule}
              className="inline-flex items-center gap-1 rounded-md bg-[color:var(--brand-primary)] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-60"
            >
              {savingRule ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {t("ruleOfferConfirm")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
