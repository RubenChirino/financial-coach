"use client";

import { Button } from "@/components/ui/button";
import { syncAllAccountsAction } from "@/lib/gocardless/actions";
import { syncAllTrueLayerAccountsAction } from "@/lib/truelayer/actions";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type SyncResult = { ok: true; summary: string } | { ok: false; error: string } | null;

export function SyncButton({ label }: { label: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult>(null);
  const router = useRouter();

  // Auto-clear the status pill after 4 s.
  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(id);
  }, [result]);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      // Run both providers' sync passes in parallel — TrueLayer only touches
      // its own "truelayer" requisition rows, and the GoCardless action only
      // its own. Errors from one shouldn't block the other.
      const [gc, tl] = await Promise.all([
        syncAllAccountsAction(),
        syncAllTrueLayerAccountsAction().catch((err) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : "truelayer_failed",
        })),
      ]);

      const inserted =
        (gc.ok && gc.data ? gc.data.inserted : 0) + (tl.ok && tl.data ? tl.data.inserted : 0);
      const skipped =
        (gc.ok && gc.data ? gc.data.skipped : 0) + (tl.ok && tl.data ? tl.data.skipped : 0);

      if (!gc.ok && !tl.ok) {
        setResult({ ok: false, error: gc.error ?? "sync_failed" });
      } else {
        setResult({ ok: true, summary: `+${inserted} new · ${skipped} skipped` });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={onClick} disabled={isPending}>
        <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
        {label}
      </Button>

      {result ? (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
            result.ok
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {result.ok ? result.summary : result.error}
        </span>
      ) : null}
    </div>
  );
}
