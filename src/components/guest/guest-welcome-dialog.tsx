"use client";

import { Button } from "@/components/ui/button";
import { Eye, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface GuestWelcomeLabels {
  title: string;
  body: string;
  cta: string;
}

/**
 * One-time notice shown right after entering guest mode (dashboard `?guest=1`).
 * Explains that guest mode is read-only and nothing is saved. Dismissing strips
 * the query param so a refresh doesn't show it again.
 */
export function GuestWelcomeDialog({
  show,
  labels,
}: {
  show: boolean;
  labels: GuestWelcomeLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(show);

  if (!open) return null;

  function dismiss() {
    setOpen(false);
    router.replace("/");
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md coin-card border border-[color:var(--border-default)] p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
            <Eye className="h-5 w-5" />
          </div>
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold">
            <Sparkles className="h-4 w-4 text-[color:var(--brand-primary)]" />
            {labels.title}
          </h2>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[color:var(--text-secondary)]">
          {labels.body}
        </p>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={dismiss}>
            {labels.cta}
          </Button>
        </div>
      </div>
    </div>
  );
}
