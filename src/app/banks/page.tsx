import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PrivacyAmount } from "@/components/privacy-amount";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/user";
import { getAccountsTotal, listInstitutionGroups } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { Landmark, Plus, Settings2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SyncButton } from "../settings/bank/sync-button";
import { AccountRow } from "./account-row";
import { ManualAccountButton } from "./manual-account-button";

export const dynamic = "force-dynamic";

export default async function BanksPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const [t, locale, groups, accountsTotal, user] = await Promise.all([
    getTranslations("bank"),
    getLocale(),
    listInstitutionGroups(session.userId),
    getAccountsTotal(session.userId),
    getUser(),
  ]);

  const intlLocale = locale === "es" ? "es-ES" : "en-GB";
  const currency = user?.currency ?? accountsTotal.currency;

  const totalFormatted = formatAmount(accountsTotal.totalCents, currency, intlLocale);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("accountsCount", { count: accountsTotal.accountCount })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SyncButton label={t("syncAll")} />
            <ManualAccountButton currency={currency} />
            <Button asChild>
              <Link href="/settings/bank">
                <Plus className="h-3.5 w-3.5" />
                {t("addBank")}
              </Link>
            </Button>
          </div>
        </header>

        {/* Total balance hero */}
        {accountsTotal.accountCount > 0 ? (
          <div className="coin-card p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
              {t("totalBalance")}
            </div>
            <div className="tnum mt-1.5 text-[36px] font-semibold leading-none tracking-[-0.02em]">
              <PrivacyAmount value={totalFormatted} />
            </div>
            <div className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">
              {t("accountsCount", { count: accountsTotal.accountCount })}
            </div>
          </div>
        ) : null}

        {/* No accounts empty state */}
        {groups.length === 0 ? (
          <EmptyState
            Icon={Landmark}
            title={t("noConnections")}
            description={t("noConnectionsHintReady")}
            action={
              <Button asChild>
                <Link href="/settings/bank">{t("addBank")}</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const groupTotal = group.accounts.reduce((s, a) => s + a.balanceCents, 0);
              const groupTotalFormatted = formatAmount(
                groupTotal,
                group.accounts[0]?.currency ?? currency,
                intlLocale,
              );
              const syncedAgo = group.lastSyncedAt
                ? formatRelativeTime(group.lastSyncedAt, intlLocale)
                : t("neverSynced");

              return (
                <section key={group.requisitionId} className="coin-card overflow-hidden">
                  {/* Institution header */}
                  <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border-default)] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <InstitutionLogo
                        name={group.institutionName}
                        logoUrl={group.institutionLogoUrl}
                      />
                      <div>
                        <div className="text-[14px] font-semibold">{group.institutionName}</div>
                        <div className="text-[11.5px] text-[color:var(--text-tertiary)]">
                          {t("lastSynced")}: {syncedAgo}
                          {group.provider === "demo" ? (
                            <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              Demo
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tnum text-[15px] font-semibold">
                        <PrivacyAmount value={groupTotalFormatted} />
                      </div>
                      <div className="text-[11px] text-[color:var(--text-tertiary)]">
                        {t("accountsCount", { count: group.accounts.length })}
                      </div>
                    </div>
                  </div>

                  {/* Account rows */}
                  <ul className="divide-y divide-[color:var(--border-default)]">
                    {group.accounts.map((acc) => (
                      <AccountRow
                        key={acc.id}
                        id={acc.id}
                        name={acc.name}
                        ibanLast4={acc.ibanLast4}
                        balanceFormatted={formatAmount(acc.balanceCents, acc.currency, intlLocale)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {/* Manage link */}
        {groups.length > 0 ? (
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-[12px]">
              <Link href="/settings/bank">
                <Settings2 className="h-3.5 w-3.5" />
                {t("manageConnections")}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

/** Institution logo or initial fallback — same style as BankTile. */
function InstitutionLogo({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  if (logoUrl) {
    return (
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-[10px] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" width={36} height={36} className="h-full w-full object-cover" />
      </div>
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color:var(--brand-primary-soft)] text-[13px] font-semibold text-[color:var(--brand-primary)]"
      aria-hidden
    >
      {initial}
    </div>
  );
}

/** Format a date relative to now — e.g. "2 hours ago" / "hace 2 horas". */
function formatRelativeTime(date: Date, intlLocale: string): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const fmt = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  if (diffMins < 60) return fmt.format(-diffMins, "minute");
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return fmt.format(-diffHours, "hour");
  return fmt.format(-Math.floor(diffHours / 24), "day");
}
