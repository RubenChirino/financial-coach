"use client";
import { Bell, CheckCheck, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  dismissAllInsightsAction,
  dismissInsightAction,
  listInsightsAction,
  refreshInsightsAction,
} from "@/lib/insights/actions";

interface InsightRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  severity: "info" | "warning" | "positive";
}

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

/**
 * Topbar notifications bell — opens a dropdown listing active insights with a
 * count badge. A 1h interval polls `refreshInsightsAction` so the engine keeps
 * up to date without a real cron (MVP).
 */
export function NotificationsBell() {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startRefresh] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listInsightsAction();
      setItems(rows as InsightRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Hourly refresh + initial load.
  useEffect(() => {
    void reload();
    const id = setInterval(() => {
      startRefresh(async () => {
        await refreshInsightsAction();
        await reload();
      });
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const count = items.length;

  function onDismiss(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    void dismissInsightAction(id);
  }

  function onClearAll() {
    setItems([]);
    void dismissAllInsightsAction();
  }

  function onManualRefresh() {
    startRefresh(async () => {
      await refreshInsightsAction();
      await reload();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("notifications")}
        title={t("notifications")}
        className="relative"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
        {count > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[color:var(--border-default)] px-3 py-2">
            <span className="text-[13px] font-semibold">{t("notifications")}</span>
            <div className="flex items-center gap-1">
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t("notificationsClearAll")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onManualRefresh}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("notificationsRefresh")}
              </button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-[color:var(--text-tertiary)]">
                {t("notificationsEmpty")}
              </div>
            ) : (
              items.map((it) => (
                <div
                  key={it.id}
                  className="group flex gap-2 border-b border-[color:var(--border-default)] px-3 py-2.5 last:border-b-0"
                >
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        it.severity === "warning"
                          ? "var(--error)"
                          : it.severity === "positive"
                            ? "var(--success)"
                            : "var(--brand-primary)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[color:var(--text-primary)]">
                      {it.title}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
                      {it.body}
                    </div>
                    {it.actionHref ? (
                      <Link
                        href={it.actionHref}
                        onClick={() => setOpen(false)}
                        className="mt-1 inline-block text-[11.5px] font-medium text-[color:var(--brand-primary)] hover:underline"
                      >
                        {it.actionLabel} →
                      </Link>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDismiss(it.id)}
                    aria-label={t("notificationsDismiss")}
                    title={t("notificationsDismiss")}
                    className="self-start rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)] hover:text-[color:var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
