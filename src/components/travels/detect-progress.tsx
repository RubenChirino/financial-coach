"use client";

import { useDetectStore } from "@/lib/travels/detect-store";
import { CheckCircle2, Loader2, Plane, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Floating, page-persistent progress card for the background "detect trips" run.
 * Mirrors the categorization card and stacks alongside it. On completion it
 * refreshes the route so newly-detected trips appear, then auto-dismisses.
 */
export function DetectTravelsProgress() {
  const t = useTranslations("travels");
  const router = useRouter();
  const status = useDetectStore((s) => s.status);
  const total = useDetectStore((s) => s.total);
  const done = useDetectStore((s) => s.done);
  const resolved = useDetectStore((s) => s.resolved);
  const errorMsg = useDetectStore((s) => s.error);
  const dismiss = useDetectStore((s) => s.dismiss);

  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setMsgIndex((i) => i + 1), 3500);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (status !== "done") return;
    router.refresh();
    const id = setTimeout(() => dismiss(), 6000);
    return () => clearTimeout(id);
  }, [status, router, dismiss]);

  if (status === "idle") return null;

  const messages = [t("detectMsg1"), t("detectMsg2"), t("detectMsg3")];
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

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
              <Plane className="h-3.5 w-3.5 text-[color:var(--brand-primary)]" />
              {status === "running"
                ? t("detectTitle")
                : status === "done"
                  ? t("detectDoneTitle")
                  : t("detectErrorTitle")}
            </div>

            {status === "running" ? (
              <>
                <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                  {total > 0 ? t("detectCount", { done, total }) : t("detectMsg1")}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-app)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--brand-primary)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-[color:var(--text-tertiary)]">
                  {messages[msgIndex % messages.length]}
                </p>
              </>
            ) : status === "done" ? (
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                {t("detectDoneDetail", { count: resolved })}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                {errorMsg === "guestReadOnly"
                  ? t("guestNudge")
                  : (errorMsg ?? t("detectErrorTitle"))}
              </p>
            )}
          </div>

          {status !== "running" ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("detectClose")}
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
