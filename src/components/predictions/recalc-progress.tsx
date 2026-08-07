"use client";

import { CheckCircle2, Loader2, TrendingUp, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { RECALC_STEPS, useRecalcStore } from "@/lib/predictions/recalc-store";

/**
 * Floating, page-persistent progress card for the background "recalculate
 * predictions" run. Mirrors the categorization / detect-trips cards and stacks
 * alongside them. On completion it refreshes the route so the fresh forecast
 * renders, then auto-dismisses.
 */
export function RecalcPredictionsProgress() {
  const t = useTranslations("predictions");
  const router = useRouter();
  const status = useRecalcStore((s) => s.status);
  const stepIndex = useRecalcStore((s) => s.stepIndex);
  const subsDetected = useRecalcStore((s) => s.subsDetected);
  const errorMsg = useRecalcStore((s) => s.error);
  const dismiss = useRecalcStore((s) => s.dismiss);

  useEffect(() => {
    if (status !== "done") return;
    router.refresh();
    const id = setTimeout(() => dismiss(), 6000);
    return () => clearTimeout(id);
  }, [status, router, dismiss]);

  if (status === "idle") return null;

  const stepLabels: Record<(typeof RECALC_STEPS)[number], string> = {
    transfers: t("recalcStepTransfers"),
    recurring: t("recalcStepRecurring"),
    forecast: t("recalcStepForecast"),
  };
  const currentStep = RECALC_STEPS[Math.min(stepIndex, RECALC_STEPS.length - 1)] ?? "forecast";
  // Show progress for the step *in flight*: 0/3 done at step 0 reads as 15% so
  // the bar never looks stuck at zero while the first step works.
  const pct = Math.min(100, Math.round(((stepIndex + 0.45) / RECALC_STEPS.length) * 100));

  return (
    <div className="w-full">
      <div className="coin-card border border-[color:var(--border-default)] p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {status === "running" ? (
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand-primary)]" />
            ) : status === "done" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <TriangleAlert className="h-5 w-5 text-amber-500" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <TrendingUp className="h-3.5 w-3.5 text-[color:var(--brand-primary)]" />
              {status === "running"
                ? t("recalcTitle")
                : status === "done"
                  ? t("recalcDoneTitle")
                  : t("recalcErrorTitle")}
            </div>

            {status === "running" ? (
              <>
                <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                  {t("recalcStepCount", { step: stepIndex + 1, total: RECALC_STEPS.length })}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-app)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--brand-primary)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-[color:var(--text-tertiary)]">
                  {stepLabels[currentStep]}
                </p>
              </>
            ) : status === "done" ? (
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                {t("recalcDoneDetail", { count: subsDetected })}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                {errorMsg === "guestReadOnly"
                  ? t("recalcGuestNudge")
                  : (errorMsg ?? t("recalcErrorTitle"))}
              </p>
            )}
          </div>

          {status !== "running" ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("recalcClose")}
              className="shrink-0 rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--bg-hover)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
