"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  type DemoActionResult,
  seedDemoBankAction,
  wipeDemoDataAction,
} from "@/lib/providers/demo/actions";
import { cn } from "@/lib/utils";

type Tab = "gocardless" | "truelayer" | "demo";

/**
 * Segmented switch + panel that lets the user pick which bank provider to use.
 *
 * - **GoCardless** (default): the original EU/UK Open Banking integration.
 * - **TrueLayer**: UK-first Open Banking via OAuth consent flow.
 * - **Demo**: fake seeded bank so the rest of the app has data to show
 *   without any real connection.
 */
export function ProviderPanel({
  tabs,
  labels,
  hasDemoConnections,
  gocardlessPanel,
  truelayerPanel,
}: {
  tabs: { gocardless: string; truelayer: string; demo: string };
  labels: {
    demoTitle: string;
    demoSubtitle: string;
    demoHint: string;
    seedBbva: string;
    seedSantander: string;
    wipe: string;
    wipeConfirm: string;
    seeded: string;
    wiped: string;
  };
  hasDemoConnections: boolean;
  gocardlessPanel: React.ReactNode;
  truelayerPanel: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("gocardless");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const tCommon = useTranslations("common");

  function handleResult<T>(res: DemoActionResult<T>, successMsg: string) {
    if (res.ok) {
      setMessage(successMsg);
      setError(null);
      toast.success({ title: successMsg });
      router.refresh();
    } else {
      setError(res.error);
      setMessage(null);
      toast.error({ title: res.error });
    }
  }

  function seed(bank: "bbva" | "santander") {
    startTransition(async () => {
      const res = await seedDemoBankAction(bank);
      handleResult(res, labels.seeded);
    });
  }

  async function wipe() {
    const ok = await confirm({
      title: labels.wipe,
      description: labels.wipeConfirm,
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await wipeDemoDataAction();
      handleResult(res, labels.wiped);
    });
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Bank provider"
        className="inline-flex rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-1"
      >
        {(["gocardless", "truelayer", "demo"] as const).map((id) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "bg-[color:var(--brand-primary)] text-white"
                  : "text-[color:var(--text-secondary)] hover:bg-[color:var(--brand-primary-soft)]",
              )}
            >
              {tabs[id]}
            </button>
          );
        })}
      </div>

      {tab === "gocardless" ? (
        gocardlessPanel
      ) : tab === "truelayer" ? (
        truelayerPanel
      ) : (
        <div className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{labels.demoTitle}</div>
              <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                {labels.demoSubtitle}
              </p>
              <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                {labels.demoHint}
              </p>
            </div>
          </div>

          {error ? (
            <div
              className="mt-4 rounded-md px-3 py-2 text-[12.5px]"
              style={{
                background: "var(--error-soft)",
                color: "var(--error)",
                border: "1px solid var(--error-border)",
              }}
            >
              {error}
            </div>
          ) : null}
          {message ? (
            <div
              className="mt-4 rounded-md px-3 py-2 text-[12.5px]"
              style={{
                background: "var(--success-soft)",
                color: "var(--success)",
                border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)",
              }}
            >
              {message}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={() => seed("bbva")} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : labels.seedBbva}
            </Button>
            <Button variant="outline" onClick={() => seed("santander")} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : labels.seedSantander}
            </Button>
            {hasDemoConnections ? (
              <Button variant="ghost" onClick={wipe} disabled={isPending} className="text-rose-600">
                {labels.wipe}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
