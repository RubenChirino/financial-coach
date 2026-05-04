"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SidebarContext } from "./sidebar-context";

interface SidebarShellProps {
  /** App brand name string rendered inside the sidebar. */
  appName: string;
  /** App tagline rendered below the brand name. */
  appTagline: string;
  /** Section heading for the main nav group. */
  mainLabel: string;
  /** Pre-rendered NavLink elements for the main group. */
  mainNav: ReactNode;
  /** Section heading for the account nav group. */
  accountLabel: string;
  /** Pre-rendered NavLink elements for the account group. */
  accountNav: ReactNode;
  /**
   * Footer content (user chip + locale/theme toggles).
   * Hidden when collapsed — the toggle button takes the bottom slot instead.
   */
  footer: ReactNode;
  /** The main content column (topbar + page body + mobile bottom nav). */
  children: ReactNode;
}

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Client wrapper that owns the desktop sidebar collapse state and provides it
 * via `SidebarContext`.  The server-rendered `AppShell` passes nav entries
 * and footer as ReactNode props so translations stay on the server.
 */
export function SidebarShell({
  appName,
  appTagline,
  mainLabel,
  mainNav,
  accountLabel,
  accountNav,
  footer,
  children,
}: SidebarShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Hydrate from localStorage after mount to avoid SSR mismatch flash.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setCollapsed(true);
    } catch {
      // localStorage may be unavailable in some environments.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <div
        className={cn(
          "min-h-dvh bg-[color:var(--surface-app)] text-[color:var(--text-primary)] md:grid",
          collapsed ? "md:grid-cols-[52px_1fr]" : "md:grid-cols-[260px_1fr]",
        )}
        style={{ transition: "grid-template-columns 200ms ease" }}
      >
        {/* ─── Desktop sidebar ─── */}
        <aside
          className={cn(
            "hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-hidden",
            "md:border-r md:border-[color:var(--border-default)] md:bg-[color:var(--surface-sidebar)]",
            collapsed ? "md:px-1.5 md:py-4" : "md:px-3.5 md:py-5",
          )}
          style={{ transition: "padding 200ms ease, width 200ms ease" }}
        >
          {/* Brand */}
          <div
            className={cn(
              "flex items-center pb-5",
              collapsed ? "justify-center" : "gap-2.5 px-2.5",
            )}
          >
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white shadow-[0_2px_6px_rgba(83,137,255,0.3)]"
              style={{ background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)" }}
            >
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-[15px] font-bold leading-tight tracking-tight">{appName}</div>
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--text-tertiary)]">
                  {appTagline}
                </div>
              </div>
            )}
          </div>

          {/* Main nav */}
          {!collapsed && (
            <div className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {mainLabel}
            </div>
          )}
          <div className={cn("space-y-0.5", collapsed && "flex flex-col items-center")}>
            {mainNav}
          </div>

          {/* Account nav */}
          {!collapsed ? (
            <div className="px-2.5 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {accountLabel}
            </div>
          ) : (
            <div className="my-3 h-px w-8 self-center bg-[color:var(--border-default)]" />
          )}
          <div className={cn("space-y-0.5", collapsed && "flex flex-col items-center")}>
            {accountNav}
          </div>

          {/* Footer (user chip + locale/theme toggles) — hidden when collapsed */}
          {!collapsed && <div className="mt-auto">{footer}</div>}

          {/* Collapse / expand toggle */}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center justify-center rounded-lg p-2",
              "text-[color:var(--text-tertiary)] transition-colors",
              "hover:bg-[color:var(--brand-primary-soft)] hover:text-[color:var(--text-primary)]",
              collapsed ? "mt-auto" : "mt-2 self-end",
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </aside>

        {/* ─── Main content column ─── */}
        {children}
      </div>
    </SidebarContext.Provider>
  );
}
