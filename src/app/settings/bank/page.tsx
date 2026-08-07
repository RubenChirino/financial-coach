import { Building2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { hasBankCredentialsAction, listBankConnectionsAction } from "@/lib/gocardless/actions";
import { hasDemoConnectionsAction } from "@/lib/providers/demo/actions";
import { hasTrueLayerCredentialsAction } from "@/lib/truelayer/actions";
import { ConnectionRow } from "./connection-row";
import { BankCredentialsCard } from "./credentials-card";
import { ProviderPanel } from "./provider-panel";
import { SyncButton } from "./sync-button";
import { TrueLayerCard } from "./truelayer-card";

export const dynamic = "force-dynamic";

export default async function BankSettingsPage() {
  if (!(await getCurrentSession())) redirect("/lock");
  const [t, tCommon, hasCreds, connections, hasDemo, hasTrueLayer] = await Promise.all([
    getTranslations("bank"),
    getTranslations("common"),
    hasBankCredentialsAction(),
    listBankConnectionsAction(),
    hasDemoConnectionsAction(),
    hasTrueLayerCredentialsAction(),
  ]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>

        <ProviderPanel
          tabs={{
            gocardless: t("providers.gocardless"),
            truelayer: t("providers.truelayer"),
            demo: t("providers.demo"),
          }}
          labels={{
            demoTitle: t("demo.title"),
            demoSubtitle: t("demo.subtitle"),
            demoHint: t("demo.hint"),
            seedBbva: t("demo.seedBbva"),
            seedSantander: t("demo.seedSantander"),
            wipe: t("demo.wipe"),
            wipeConfirm: t("demo.wipeConfirm"),
            seeded: t("demo.seeded"),
            wiped: t("demo.wiped"),
          }}
          hasDemoConnections={hasDemo}
          gocardlessPanel={<BankCredentialsCard hasCredentials={hasCreds} />}
          truelayerPanel={<TrueLayerCard hasCredentials={hasTrueLayer} />}
        />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{t("connections")}</CardTitle>
              <CardDescription>{t("connectionsHint")}</CardDescription>
            </div>
            <div className="flex gap-2">
              {connections.length > 0 ? <SyncButton label={t("syncAll")} /> : null}
              <Button asChild disabled={!hasCreds}>
                <Link href={hasCreds ? "/settings/bank/link" : "#"}>{t("addBank")}</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <EmptyState
                Icon={Building2}
                title={t("noConnections")}
                description={
                  hasCreds ? t("noConnectionsHintReady") : t("noConnectionsHintSetupKeys")
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {connections.map((c) => (
                  <ConnectionRow
                    key={c.requisitionId}
                    connection={c}
                    statusLabel={t(`status.${c.status}` as Parameters<typeof t>[0])}
                    deleteLabel={tCommon("delete")}
                    accountsLabel={t("accounts")}
                    lastSyncLabel={t("lastSynced")}
                    neverSyncedLabel={t("neverSynced")}
                    demoLabel={t("providers.demoBadge")}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
