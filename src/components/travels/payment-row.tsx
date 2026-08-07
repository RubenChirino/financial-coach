"use client";

import { ChevronDown, MapPin } from "lucide-react";
import { useState } from "react";
import { ConvertedAmount } from "@/components/converted-amount";

export interface PaymentRowLabels {
  description: string;
  city: string;
  date: string;
  amount: string;
}

/**
 * A single payment in a trip's payment list. Collapsed it shows merchant / date
 * / amount; clicking expands the row to reveal the full (untruncated) bank
 * description, the parsed city, the exact date and the amount — the common
 * "inspect this transaction" interaction.
 */
export function PaymentRow({
  title,
  description,
  city,
  dateShort,
  dateFull,
  amountCents,
  currency,
  intlLocale,
  labels,
}: {
  title: string;
  description: string;
  city: string | null;
  dateShort: string;
  dateFull: string;
  amountCents: number;
  currency: string;
  intlLocale: string;
  labels: PaymentRowLabels;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg py-1.5 text-left transition-colors hover:bg-[color:var(--bg-hover)]"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[color:var(--text-tertiary)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
        <div className="flex-1 min-w-0 truncate text-[13px] font-medium">{title}</div>
        <div className="text-[11px] text-[color:var(--text-tertiary)]">{dateShort}</div>
        <div className="tnum text-[13px] font-semibold whitespace-nowrap">
          <ConvertedAmount cents={amountCents} currency={currency} intlLocale={intlLocale} />
        </div>
      </button>

      {open ? (
        <dl className="ml-6 mt-1 mb-2 space-y-1.5 rounded-lg bg-[color:var(--surface-app)] p-3 text-[12px]">
          <DetailField label={labels.description}>
            <span className="break-words text-[color:var(--text-secondary)]">{description}</span>
          </DetailField>
          {city ? (
            <DetailField label={labels.city}>
              <span className="inline-flex items-center gap-1 text-[color:var(--text-secondary)]">
                <MapPin className="h-3 w-3" />
                {city}
              </span>
            </DetailField>
          ) : null}
          <DetailField label={labels.date}>
            <span className="text-[color:var(--text-secondary)]">{dateFull}</span>
          </DetailField>
          <DetailField label={labels.amount}>
            <span className="tnum font-semibold">
              <ConvertedAmount cents={amountCents} currency={currency} intlLocale={intlLocale} />
            </span>
          </DetailField>
        </dl>
      ) : null}
    </li>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-medium uppercase tracking-[0.04em] text-[10px] text-[color:var(--text-tertiary)]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
