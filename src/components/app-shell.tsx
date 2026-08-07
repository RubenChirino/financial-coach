import { eq } from "drizzle-orm";
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
import { SidebarShell } from "@/components/shell/sidebar-shell";
import { TopbarActions } from "@/components/shell/topbar-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/locale";

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
  /** Page title shown in the topbar (defaults to app name). */
  title?: string;
  /** Optional sub-line under the title (e.g. a greeting or current scope). */
  subtitle?: string;
  /** Unread insights badge on the AI Coach entry. Wired in 7h. */
  coachUnread?: number;
}

/**
 * Coin-branded app shell: collapsible 260px sidebar + 64px sticky topbar.
 *
 * Layout:
 *   - ≥ md: CSS-grid managed by `SidebarShell` (client) — 260px when expanded,
 *     52px icon-only when collapsed. State is persisted to localStorage.
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

  // Account chip: guest, OAuth (with provider avatar/name), or local.
  const session = await getCurrentSession();
  const account = session
    ? await db.query.users.findFirst({ where: eq(users.id, session.userId) })
    : null;
  const isGuest = !!session?.isGuest;
  const accountName = isGuest
    ? tShell("guestLabel")
    : (account?.name ?? account?.email ?? tShell("youLabel"));
  const accountSub = isGuest ? tShell("guestSub") : (account?.email ?? tShell("youSub"));
  const accountImage = isGuest ? null : (account?.image ?? null);

  const mainNav = MAIN.map(({ href, tKey, Icon, matchPrefix }) => (
    <NavLink
      key={href}
      href={href}
      label={tNav(tKey)}
      icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}
      matchPrefix={matchPrefix}
      badge={tKey === "advisor" ? coachUnread : undefined}
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
