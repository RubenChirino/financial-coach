"use client";

import { AlertTriangle, Calendar, Sparkles, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Insight } from "@/db/schema";
import { dismissInsightAction } from "@/lib/insights/actions";
import { cn } from "@/lib/utils";

type Severity = "info" | "warning" | "positive";

const SEVERITY_STYLES: Record<Severity, { bg: string; fg: string }> = {
  warning: { bg: "#FEF3C7", fg: "#92400E" },
  positive: { bg: "#DCFCE7", fg: "#166534" },
  info: { bg: "var(--brand-primary-soft)", fg: "var(--brand-primary)" },
};

function InsightIcon({ kind, severity }: { kind: Insight["kind"]; severity: Severity }) {
  const Icon =
    severity === "warning"
      ? AlertTriangle
      : severity === "positive"
        ? TrendingUp
        : kind === "goal_near"
          ? Sparkles
          : Calendar;
  return <Icon className="h-4 w-4" strokeWidth={2} />;
}

function InsightRow({ insight, dismissLabel }: { insight: Insight; dismissLabel: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const styles = SEVERITY_STYLES[insight.severity];

  function onDismiss() {
    setDismissed(true);
    startTransition(async () => {
      await dismissInsightAction(insight.id);
      router.refresh();
    });
  }

  return (
    <div className={cn("coin-card flex gap-3 p-4 transition-opacity", isPending && "opacity-50")}>
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: styles.bg, color: styles.fg }}
        aria-hidden
      >
        <InsightIcon kind={insight.kind} severity={insight.severity} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">{insight.title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-[color:var(--text-secondary)]">
          {insight.body}
        </p>
        <Link
          href={insight.actionHref}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--brand-primary)] hover:underline"
        >
          {insight.actionLabel} →
        </Link>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        disabled={isPending}
        aria-label={dismissLabel}
        className="shrink-0 rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)] disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface InsightsListProps {
  insights: Insight[];
  dismissLabel: string;
  titleLabel: string;
}

export function InsightsList({ insights: rows, dismissLabel, titleLabel }: InsightsListProps) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
        {titleLabel}
      </div>
      {rows.map((ins) => (
        <InsightRow key={ins.id} insight={ins} dismissLabel={dismissLabel} />
      ))}
    </div>
  );
}
