import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  PieChart,
  Plane,
  Repeat,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { AccountAvatar } from "@/components/shell/account-avatar";
import { NavLink } from "@/components/shell/nav-link";
import { ShellTitle } from "@/components/shell/shell-title";
import { SidebarShell } from "@/components/shell/sidebar-shell";
import { TopbarActions } from "@/components/shell/topbar-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { hasFinancialData } from "@/lib/accounts/has-data";
import { getCurrentSession } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/user";
import { getLocale } from "@/lib/i18n/locale";
import { getVisibleInsights } from "@/lib/insights/visible";

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
  { href: "/predictions", tKey: "predictions", Icon: TrendingUp },
  { href: "/opportunities", tKey: "opportunities", Icon: Lightbulb },
  { href: "/subscriptions", tKey: "subscriptions", Icon: Repeat },
  { href: "/travels", tKey: "travels", Icon: Plane, matchPrefix: true },
  { href: "/banks", tKey: "banks", Icon: Landmark, matchPrefix: true },
] as const;

const ACCOUNT: readonly NavEntry[] = [
  { href: "/goals", tKey: "goals", Icon: Target, matchPrefix: true },
  { href: "/import", tKey: "import", Icon: Upload },
  { href: "/settings", tKey: "settings", Icon: Settings, matchPrefix: true },
] as const;

interface AppShellProps {
  children: ReactNode;
}

/**
 * Coin-branded app shell: collapsible 260px sidebar + 64px sticky topbar.
 *
 * Layout:
 *   - ≥ md: CSS-grid managed by `SidebarShell` (client) — 260px when expanded,
 *     52px icon-only when collapsed. State is persisted to localStorage.
 *   - < md: sidebar collapses to a bottom-nav-style rail on small screens.
 *
 * Server-rendered once per request by the `(app)` layout; interactive children
 * (`NavLink`, `TopbarActions`, `ShellTitle`, `ThemeToggle`, `LanguageToggle`)
 * are client components. The layout persists across client navigations, so
 * anything page-specific (the topbar heading) is derived on the client.
 */
export async function AppShell({ children }: AppShellProps) {
  const [tNav, tApp, tShell, locale] = await Promise.all([
    getTranslations("nav"),
    getTranslations("app"),
    getTranslations("shell"),
    getLocale(),
  ]);

  // Account chip: guest, OAuth (with provider avatar/name), or local.
  const [session, user] = await Promise.all([getCurrentSession(), getUser()]);
  const account = session ? user : null;
  const isGuest = !!session?.isGuest;
  const accountName = isGuest
    ? tShell("guestLabel")
    : (account?.name ?? account?.email ?? tShell("youLabel"));
  const accountSub = isGuest ? tShell("guestSub") : (account?.email ?? tShell("youSub"));
  const accountImage = isGuest ? null : (account?.image ?? null);

  // Gates the topbar's currency toggle and search: neither can do anything
  // until there is an account or a transaction behind them.
  // The bell's first list comes with the page instead of a request after
  // hydration; the dashboard computes the same list in the same render, so
  // `getVisibleInsights` (request-memoized) runs the engine once for both.
  const [hasData, insights] = session
    ? await Promise.all([
        hasFinancialData(session.userId),
        getVisibleInsights(session.userId, locale),
      ])
    : [false, []];

  const mainNav = MAIN.map(({ href, tKey, Icon, matchPrefix }) => (
    <NavLink
      key={href}
      href={href}
      label={tNav(tKey)}
      icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
      matchPrefix={matchPrefix}
    />
  ));

  const accountNav = ACCOUNT.map(({ href, tKey, Icon, matchPrefix }) => (
    <NavLink
      key={href}
      href={href}
      label={tNav(tKey)}
      icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
      matchPrefix={matchPrefix}
    />
  ));

  const footer = (
    <div className="border-t border-[color:var(--border-default)] pt-3">
      <div className="flex items-center gap-2.5 rounded-[10px] p-2.5 hover:bg-[color:var(--brand-primary-soft)]">
        <AccountAvatar src={accountImage} isGuest={isGuest} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{accountName}</div>
          <div className="truncate text-[11px] text-[color:var(--text-tertiary)]">{accountSub}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 px-1">
        <LanguageToggle current={locale} />
        <ThemeToggle />
      </div>
    </div>
  );

  return (
    <SidebarShell
      appName={tApp("name")}
      appTagline={tApp("tagline")}
      mainLabel={tShell("main")}
      mainNav={mainNav}
      accountLabel={tShell("account")}
      accountNav={accountNav}
      footer={footer}
    >
      {/* ─── Main column ─── */}
      <div className="flex min-w-0 flex-col">
        {/* Mobile brand row (visible < md). The desktop topbar is sticky below. */}
        <header className="flex h-14 items-center justify-between gap-2 border-b border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{
                background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)",
              }}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <ShellTitle hasData={hasData} compact />
            </div>
          </div>
          <div className="shrink-0">
            <LanguageToggle current={locale} />
          </div>
        </header>

        {/* Desktop topbar */}
        <header className="sticky top-0 z-10 hidden h-16 items-center gap-5 border-b border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-8 md:flex">
          <div className="min-w-0 flex-1">
            <ShellTitle hasData={hasData} />
          </div>
          <TopbarActions hasData={hasData} initialInsights={insights} />
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
    </SidebarShell>
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
