import { LanguageToggle } from "@/components/language-toggle";
import { NavLink } from "@/components/shell/nav-link";
import { TopbarActions } from "@/components/shell/topbar-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { getLocale } from "@/lib/i18n/locale";
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  PieChart,
  Repeat,
  Settings,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

interface NavEntry {
  href: string;
  tKey: string;
  Icon: LucideIcon;
  badge?: number;
  matchPrefix?: boolean;
}

const MAIN: readonly NavEntry[] = [
  { href: "/", tKey: "dashboard", Icon: LayoutDashboard },
  { href: "/advisor", tKey: "advisor", Icon: Sparkles, matchPrefix: true },
  { href: "/categories", tKey: "budgets", Icon: PieChart, matchPrefix: true },
  { href: "/transactions", tKey: "transactions", Icon: ArrowLeftRight },
  { href: "/subscriptions", tKey: "subscriptions", Icon: Repeat },
  { href: "/banks", tKey: "banks", Icon: Landmark, matchPrefix: true },
] as const;

const ACCOUNT: readonly NavEntry[] = [
  { href: "/goals", tKey: "goals", Icon: Target, matchPrefix: true },
  { href: "/import", tKey: "import", Icon: Upload },
  { href: "/settings", tKey: "settings", Icon: Settings, matchPrefix: true },
] as const;

interface AppShellProps {
  children: ReactNode;
  /** Page title shown in the topbar (defaults to app name). */
  title?: string;
  /** Optional sub-line under the title (e.g. a greeting or current scope). */
  subtitle?: string;
  /** Unread insights badge on the AI Coach entry. Wired in 7h. */
  coachUnread?: number;
}

/**
 * Coin-branded app shell: 260px sidebar + 64px sticky topbar.
 *
 * Layout:
 *   - ≥ md: CSS-grid with a 260px rail on the left.
 *   - < md: sidebar collapses to a bottom-nav-style rail on small screens.
 *
 * Server-rendered; interactive children (`NavLink`, `TopbarActions`,
 * `ThemeToggle`, `LanguageToggle`, `LockButton`) are client components.
 */
export async function AppShell({ children, title, subtitle, coachUnread = 0 }: AppShellProps) {
  const [tNav, tApp, tShell, locale] = await Promise.all([
    getTranslations("nav"),
    getTranslations("app"),
    getTranslations("shell"),
    getLocale(),
  ]);

  const resolvedTitle = title ?? tApp("name");
  const resolvedSubtitle = subtitle ?? tApp("tagline");

  return (
    <div className="min-h-dvh bg-[color:var(--surface-app)] text-[color:var(--text-primary)] md:grid md:grid-cols-[260px_1fr]">
      {/* ─── Sidebar (desktop + tablet) ─── */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto md:border-r md:border-[color:var(--border-default)] md:bg-[color:var(--surface-sidebar)] md:px-3.5 md:py-5">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2.5 pb-5">
          <div
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-white shadow-[0_2px_6px_rgba(83,137,255,0.3)]"
            style={{
              background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)",
            }}
          >
            <Sparkles className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-tight tracking-tight">{tApp("name")}</div>
            <div className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)] truncate">
              {tApp("tagline")}
            </div>
          </div>
        </div>

        {/* Main nav */}
        <div className="px-2.5 pt-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
          {tShell("main")}
        </div>
        <div className="space-y-1">
          {MAIN.map(({ href, tKey, Icon, matchPrefix }) => (
            <NavLink
              key={href}
              href={href}
              label={tNav(tKey)}
              icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
              matchPrefix={matchPrefix}
              badge={tKey === "advisor" ? coachUnread : undefined}
            />
          ))}
        </div>

        {/* Account nav */}
        <div className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
          {tShell("account")}
        </div>
        <div className="space-y-1">
          {ACCOUNT.map(({ href, tKey, Icon, matchPrefix }) => (
            <NavLink
              key={href}
              href={href}
              label={tNav(tKey)}
              icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
              matchPrefix={matchPrefix}
            />
          ))}
        </div>

        {/* Footer: user chip + locale/theme quick toggles */}
        <div className="mt-auto border-t border-[color:var(--border-default)] pt-3">
          <div className="flex items-center gap-2.5 rounded-[10px] p-2.5 hover:bg-[color:var(--brand-primary-soft)]">
            <div
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
              style={{
                background: "linear-gradient(135deg, #FFD1DC, #FFBDCD)",
                color: "#8B2D43",
              }}
            >
              <LifeBuoy className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight">
                {tShell("youLabel")}
              </div>
              <div className="truncate text-[11px] text-[color:var(--text-tertiary)]">
                {tShell("youSub")}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 px-1">
            <LanguageToggle current={locale} />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ─── Main column ─── */}
      <div className="flex min-w-0 flex-col">
        {/* Mobile brand row (visible < md). The desktop topbar is sticky below. */}
        <header className="flex h-14 items-center justify-between gap-2 border-b border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-4 md:hidden">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{
                background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)",
              }}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{resolvedTitle}</div>
              {resolvedSubtitle ? (
                <div className="truncate text-[11px] text-[color:var(--text-tertiary)]">
                  {resolvedSubtitle}
                </div>
              ) : null}
            </div>
          </div>
          <div className="shrink-0">
            <LanguageToggle current={locale} />
          </div>
        </header>

        {/* Desktop topbar */}
        <header className="sticky top-0 z-10 hidden h-16 items-center gap-5 border-b border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-8 md:flex">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-semibold leading-tight tracking-tight">
              {resolvedTitle}
            </div>
            {resolvedSubtitle ? (
              <div className="truncate text-[12px] text-[color:var(--text-tertiary)]">
                {resolvedSubtitle}
              </div>
            ) : null}
          </div>
          <TopbarActions />
        </header>

        {/* Page body */}
        <main className="min-w-0 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-7">{children}</main>

        {/* Mobile bottom nav (< md) */}
        <nav
          className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--border-default)] bg-[color:var(--surface-card)]/95 backdrop-blur md:hidden"
          aria-label={tShell("main")}
        >
          <div className="flex items-center justify-around">
            {MAIN.slice(0, 5).map(({ href, tKey, Icon, matchPrefix }) => (
              <NavLinkMobile
                key={href}
                href={href}
                label={tNav(tKey)}
                icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
                matchPrefix={matchPrefix}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function NavLinkMobile(props: {
  href: string;
  label: string;
  icon: ReactNode;
  matchPrefix?: boolean;
}) {
  // Keep mobile tab bar plain until we need sophistication; reuse the same
  // client component with vertical layout.
  return (
    <div className="min-h-[44px] flex-1 py-1.5 text-center">
      <NavLink {...props} compact />
      <div className="pointer-events-none -mt-1 text-[10px] text-[color:var(--text-tertiary)] truncate">
        {props.label}
      </div>
    </div>
  );
}
