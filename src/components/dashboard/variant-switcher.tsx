import { cn } from "@/lib/utils";
import Link from "next/link";

export type DashboardVariant = "default" | "command" | "focus";

/**
 * Tiny segmented-control linking between the three dashboard layouts.
 *
 * - **default**: balanced bento (current app).
 * - **command**: dense power-user view — everything visible, less whitespace.
 * - **focus**: a single-question view — coach brief + top insight only.
 *
 * Server-rendered as plain `<Link>`s so state lives in the URL, survives
 * reloads, and is bookmark-friendly. No client JS.
 */
export function VariantSwitcher({
  active,
  labels,
}: {
  active: DashboardVariant;
  labels: { default: string; command: string; focus: string };
}) {
  const items: Array<{ key: DashboardVariant; href: string; label: string }> = [
    { key: "default", href: "/", label: labels.default },
    { key: "command", href: "/?variant=command", label: labels.command },
    { key: "focus", href: "/?variant=focus", label: labels.focus },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-[color:var(--border-default)] text-[12px]">
      {items.map((i, idx) => (
        <Link
          key={i.key}
          href={i.href}
          className={cn(
            "px-3 py-1.5 transition-colors",
            idx > 0 && "border-l border-[color:var(--border-default)]",
            active === i.key
              ? "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)] font-medium"
              : "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-app)]",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
