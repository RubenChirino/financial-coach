"use client";

import { dismissInsightAction } from "@/lib/insights/actions";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * "Mark resolved" button for the digest hero brief.
 *
 * Resolves the top insight shown in the hero (if any) by calling
 * `dismissInsightAction`. Shows inline feedback and refreshes the server
 * component so the digest re-renders without the resolved item.
 *
 * When there's no active insight to resolve the button is disabled with a
 * tooltip — we don't hide it so the hero card keeps its two-button symmetry.
 */
export function MarkResolvedButton({
  topInsightId,
  label,
  resolvedLabel,
  noneLabel,
}: {
  topInsightId: number | null;
  label: string;
  resolvedLabel: string;
  noneLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [justResolved, setJustResolved] = useState(false);

  useEffect(() => {
    if (!justResolved) return;
    const id = setTimeout(() => setJustResolved(false), 2500);
    return () => clearTimeout(id);
  }, [justResolved]);

  function onClick() {
    if (topInsightId == null) return;
    startTransition(async () => {
      await dismissInsightAction(topInsightId);
      setJustResolved(true);
      router.refresh();
    });
  }

  const disabled = topInsightId == null || isPending;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={topInsightId == null ? noneLabel : label}
      className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-white/20 px-3 text-[13px] font-semibold text-white hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : justResolved ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      {justResolved ? resolvedLabel : label}
    </button>
  );
}
