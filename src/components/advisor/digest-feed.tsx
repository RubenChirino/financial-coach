import {
  AlertTriangle,
  ArrowRight,
  Bell,
  MessageCircle,
  PiggyBank,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { MarkResolvedButton } from "@/components/advisor/mark-resolved-button";
import { Button } from "@/components/ui/button";
import type { DigestPayload, DigestStat } from "@/lib/advisor/digest";
import { cn } from "@/lib/utils";

interface DigestStrings {
  eyebrow: string;
  brief: string;
  discuss: string;
  markResolved: string;
  markResolvedDone: string;
  markResolvedNone: string;
}

const KIND_TINTS: Record<
  "warning" | "positive" | "suggestion" | "neutral",
  { bg: string; fg: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  warning: { bg: "#FEF3C7", fg: "#92400E", Icon: AlertTriangle },
  positive: { bg: "#DCFCE7", fg: "#166534", Icon: TrendingUp },
  suggestion: { bg: "var(--creative-pink)", fg: "var(--creative-pink-text)", Icon: Sparkles },
  neutral: { bg: "var(--brand-primary-soft)", fg: "var(--brand-primary)", Icon: Bell },
};

const STAT_ICONS: Record<DigestStat["iconKey"], ComponentType<{ className?: string }>> = {
  savings: PiggyBank,
  subs: Repeat,
  alerts: Bell,
  confidence: ShieldCheck,
};

export function DigestFeed({
  digest,
  todayLabel,
  strings,
  emptyTitle,
  emptyBody,
  emptyAction,
  topInsightId,
}: {
  digest: DigestPayload;
  todayLabel: string;
  strings: DigestStrings;
  emptyTitle: string;
  emptyBody: string;
  emptyAction: string;
  /** ID of the highest-severity active insight — target of "Mark resolved". */
  topInsightId: number | null;
}) {
  if (digest.isEmpty) {
    return (
      <div className="coin-card p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
          <Sparkles className="h-5 w-5" strokeWidth={2} />
        </div>
        <h2 className="text-[18px] font-semibold tracking-tight">{emptyTitle}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[color:var(--text-secondary)]">
          {emptyBody}
        </p>
        <Button asChild className="mt-4">
          <Link href="/settings/bank">{emptyAction}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero brief — gradient card, eyebrow + headline + 3 numbered chips */}
      <section
        className="relative overflow-hidden rounded-2xl p-7 text-white shadow-[var(--shadow-card)]"
        style={{
          background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 60%, #FFD1DC 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-10 -right-10 h-[200px] w-[200px] rounded-full bg-white/12"
        />
        <div className="relative">
          <div className="mb-3.5 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/25">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] opacity-85">
                {strings.eyebrow}
              </div>
              <div className="text-[13px] font-semibold">
                {strings.brief} · {todayLabel}
              </div>
            </div>
          </div>
          <p className="max-w-[720px] text-[20px] font-semibold leading-snug tracking-[-0.01em]">
            {digest.headline}
          </p>

          {digest.items.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {digest.items.map((item, i) => (
                <div key={item.key} className="rounded-[10px] bg-white/15 p-3 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold opacity-80">{i + 1}</div>
                  <div className="mt-0.5 text-[13px] font-semibold">{item.title}</div>
                  <div className="mt-0.5 text-[12px] opacity-85">{item.body}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              asChild
              className="bg-white text-[color:var(--brand-primary)] hover:bg-white/90"
            >
              <Link href="/advisor?tab=chat">
                <MessageCircle className="h-3.5 w-3.5" />
                {strings.discuss}
              </Link>
            </Button>
            <MarkResolvedButton
              topInsightId={topInsightId}
              label={strings.markResolved}
              resolvedLabel={strings.markResolvedDone}
              noneLabel={strings.markResolvedNone}
            />
          </div>
        </div>
      </section>

      {/* Insight list */}
      {digest.items.length > 0 ? (
        <ul className="space-y-3">
          {digest.items.map((item) => {
            const k = KIND_TINTS[item.kind];
            const Icon = k.Icon;
            return (
              <li key={item.key} className="coin-card flex gap-3 p-5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                  style={{ background: k.bg, color: k.fg }}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">{item.title}</div>
                  <p className="mb-2.5 mt-1 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                    {item.body}
                  </p>
                  <Button asChild size="sm" className="h-8 gap-1 px-3 text-[12px]">
                    <Link href={item.actionHref}>
                      {item.actionLabel}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Stats strip — 4-up tile grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {digest.stats.map((s) => {
          const Icon = STAT_ICONS[s.iconKey];
          return (
            <div key={s.key} className="coin-card p-5">
              <div
                className={cn("mb-2.5 flex h-8 w-8 items-center justify-center rounded-[9px]")}
                style={{ background: `${s.color}22`, color: s.color }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]">
                {s.label}
              </div>
              <div className="tnum mt-0.5 text-[20px] font-semibold tracking-[-0.015em]">
                {s.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
