"use client";

import { cn } from "@/lib/utils";
import { MessageCircle, Newspaper } from "lucide-react";
import Link from "next/link";

export type CoachTab = "digest" | "chat";

/**
 * Underlined-tab bar — pure-link navigation so the tab change re-runs the
 * server component (digest fetches fresh data, chat picks up new messages
 * from URL ?c= param). No client state lives here on purpose.
 */
export function CoachTabs({
  active,
  digestLabel,
  chatLabel,
  /** Optional preserve param when switching (e.g. ?c=42 in the chat tab). */
  preserveSearchParams,
}: {
  active: CoachTab;
  digestLabel: string;
  chatLabel: string;
  preserveSearchParams?: Record<string, string>;
}) {
  const buildHref = (tab: CoachTab) => {
    const params = new URLSearchParams();
    if (tab !== "digest") params.set("tab", tab);
    if (preserveSearchParams) {
      for (const [k, v] of Object.entries(preserveSearchParams)) {
        if (k !== "tab") params.set(k, v);
      }
    }
    const qs = params.toString();
    return qs ? `/advisor?${qs}` : "/advisor";
  };

  return (
    <nav
      className="mb-5 flex items-center gap-0 border-b border-[color:var(--border-default)]"
      aria-label="Coach tabs"
    >
      {(
        [
          { k: "digest", label: digestLabel, Icon: Newspaper },
          { k: "chat", label: chatLabel, Icon: MessageCircle },
        ] as const
      ).map((t) => {
        const isActive = active === t.k;
        return (
          <Link
            key={t.k}
            href={buildHref(t.k)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors",
              "border-b-2 -mb-px",
              isActive
                ? "border-[color:var(--brand-primary)] text-[color:var(--brand-primary)]"
                : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]",
            )}
          >
            <t.Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
