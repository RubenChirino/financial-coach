"use client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavLinkProps {
  href: string;
  label: string;
  /**
   * Pre-rendered icon element (e.g. `<LayoutDashboard className="..." />`).
   * Must be a React node, NOT a component class — passing a component across
   * the Server → Client boundary fails to serialize (forwardRef components
   * are `{$$typeof, render, displayName}` which RSC can't stringify).
   */
  icon: ReactNode;
  badge?: number | null;
  matchPrefix?: boolean;
  compact?: boolean;
}

/**
 * Sidebar nav entry. Highlights itself when the current pathname matches
 * exactly (or with `matchPrefix` for section roots like `/settings`).
 * Uses Coin design tokens surfaced through globals.css.
 */
export function NavLink({
  href,
  label,
  icon,
  badge,
  matchPrefix = false,
  compact = false,
}: NavLinkProps) {
  const pathname = usePathname() ?? "/";
  const active = matchPrefix ? href !== "/" && pathname.startsWith(href) : pathname === href;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={compact ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
        "text-[color:var(--text-secondary)] hover:bg-[color:var(--brand-primary-soft)] hover:text-[color:var(--text-primary)]",
        active &&
          "bg-[color:var(--surface-card)] text-[color:var(--brand-primary)] shadow-[0_1px_2px_rgba(15,20,33,0.06)] hover:bg-[color:var(--surface-card)]",
        compact && "justify-center px-0",
      )}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {!compact && <span className="truncate">{label}</span>}
      {!compact && badge && badge > 0 ? (
        <span className="ml-auto rounded-full bg-[color:var(--creative-pink)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--creative-pink-text)]">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
