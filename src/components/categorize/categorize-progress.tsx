"use client";

import {
  type CategorizeStatus,
  categorizedCount,
  useCategorizeStore,
} from "@/lib/categorize/store";
import { CheckCircle2, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function StatusIcon({ status }: { status: CategorizeStatus }) {
  if (status === "running")
    return <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand-primary)]" />;
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  return <TriangleAlert className="h-5 w-5 text-amber-500" />;
}

/**
 * Floating, page-persistent progress card for the background categorization run.
 *
 * Mounted once at the app root so it survives navigation. While running it shows
 * a progress bar plus rotating reassurance messages (large accounts take a
 * while — this signals "working, not broken"). On completion it refreshes the
 * route so freshly-categorized rows appear, then auto-dismisses.
 */
export function CategorizeProgress() {
  const t = useTranslations("transactions");
  const router = useRouter();
  const status = useCategorizeStore((s) => s.status);
  const total = useCategorizeStore((s) => s.total);
  const done = useCategorizeStore((s) => s.done);
  const errors = useCategorizeStore((s) => s.errors);
  const corrected = useCategorizeStore((s) => s.corrected);
  const errorMsg = useCategorizeStore((s) => s.error);
  const dismiss = useCategorizeStore((s) => s.dismiss);
  const count = useCategorizeStore(categorizedCount);

  const [msgIndex, setMsgIndex] = useState(0);

  // Rotate reassurance messages while running.
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setMsgIndex((i) => i + 1), 3500);
    return () => clearInterval(id);
  }, [status]);

  // On completion: refresh so new categories render, then auto-dismiss.
  useEffect(() => {
    if (status !== "done") return;
    router.refresh();
    const id = setTimeout(() => dismiss(), 6000);
    return () => clearTimeout(id);
  }, [status, router, dismiss]);

  if (status === "idle") return null;

  const messages = [
    t("catProgressMsg1"),
    t("catProgressMsg2"),
    t("catProgressMsg3"),
    t("catProgressMsg4"),
  ];
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const titleKey =
    status === "running"
      ? "catProgressTitle"
      : status === "done"
        ? "catDoneTitle"
        : "catErrorTitle";
  const errorText =
    errorMsg === "guestReadOnly" ? t("guestNudge") : (errorMsg ?? t("categorizeToastError"));

  return (
    <div className="w-full">
      <div className="coin-card border border-[color:var(--border-default)] p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <StatusIcon status={status} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-[color:var(--brand-primary)]" />
              {t(titleKey)}
            </div>

            {status === "running" ? (
              <>
                <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                  {total > 0 ? t("catProgressCount", { done, total }) : t("catProgressMsg1")}
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
                {t("catDoneDetail", { count })}
                {corrected > 0 ? ` · ${t("catDoneCorrected", { count: corrected })}` : ""}
                {errors > 0 ? ` · ${t("catDoneErrors", { count: errors })}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{errorText}</p>
            )}
          </div>

          {status !== "running" ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("catClose")}
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
