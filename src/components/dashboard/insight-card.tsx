import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, Calendar, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

export type InsightKind = "warning" | "positive" | "suggestion" | "neutral";

export interface InsightCardProps {
  kind: InsightKind;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  timeLabel?: string;
}

const KIND_STYLES: Record<
  InsightKind,
  { bg: string; fg: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  warning: { bg: "#FEF3C7", fg: "#92400E", Icon: AlertTriangle },
  positive: { bg: "#DCFCE7", fg: "#166534", Icon: TrendingUp },
  suggestion: { bg: "var(--creative-pink)", fg: "var(--creative-pink-text)", Icon: Sparkles },
  neutral: { bg: "var(--brand-primary-soft)", fg: "var(--brand-primary)", Icon: Calendar },
};

/**
 * Single insight row. Static copy in 7d (copy comes in via props from a
 * derived heuristic — `needsReview > 0` etc.). The real rule engine lands
 * in 7h and will populate a list of these.
 */
export function InsightCard({
  kind,
  title,
  body,
  actionLabel,
  actionHref,
  timeLabel,
}: InsightCardProps) {
  const k = KIND_STYLES[kind];
  const Icon = k.Icon;
  return (
    <section className="coin-card flex gap-3 p-6">
      <div
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]")}
        style={{ background: k.bg, color: k.fg }}
        aria-hidden
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[14px] font-semibold">{title}</div>
          {timeLabel ? (
            <div className="text-[11px] text-[color:var(--text-tertiary)]">{timeLabel}</div>
          ) : null}
        </div>
        <p className="mb-2.5 mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
          {body}
        </p>
        <Button asChild size="sm" className="h-8 gap-1 px-3 text-[12px]">
          <Link href={actionHref}>
            {actionLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
