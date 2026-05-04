"use client";

import { CategoryIcon } from "@/components/category-icon";
import type { CategoryOption } from "@/lib/transactions/actions";
import { setTransactionCategoryAction } from "@/lib/transactions/actions";
import { cn } from "@/lib/utils";
import { Check, Loader2, Tag, X } from "lucide-react";
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
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
      await setTransactionCategoryAction(props.txId, nextId);
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
    </div>
  );
}
