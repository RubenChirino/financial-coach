import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/user";
import { listBankConnectionsAction } from "@/lib/gocardless/actions";
import { getLocale } from "@/lib/i18n/locale";
import { getAvailableProviders } from "@/lib/llm/provider";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BackupCard } from "./backup-card";
import { CurrencySelector } from "./currency-selector";
import { LlmSelector } from "./llm-selector";
import { SecurityCard } from "./security-card";

export default async function SettingsPage() {
  if (!(await getCurrentSession())) redirect("/lock");
  const [t, user, locale, connections] = await Promise.all([
    getTranslations("settings"),
    getUser(),
    getLocale(),
    listBankConnectionsAction(),
  ]);
  const availableProviders = getAvailableProviders();
  const linked = connections.filter((c) => c.status === "linked").length;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t("language")}</CardTitle>
            <CardDescription>
              {locale === "es" ? "Español" : "English"} · use the globe button in the sidebar to
              switch.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("currency")}</CardTitle>
            <CardDescription>{t("currencyDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CurrencySelector
              current={user?.currency ?? "EUR"}
              label={t("currency")}
              hintLabel={t("currencyHint")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("llm")}</CardTitle>
            <CardDescription>{t("llmDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LlmSelector
              currentProvider={user?.llmProvider ?? "ollama"}
              currentModel={user?.llmModel ?? "qwen2.5:14b-instruct-q4_K_M"}
              available={availableProviders}
              labels={{
                providerLabel: t("llmProviderLabel"),
                modelLabel: t("llmModelLabel"),
                customModelLabel: t("llmCustomModelLabel"),
                customModelPlaceholder: t("llmCustomModelPlaceholder"),
                notConfigured: t("llmNotConfigured"),
                localBadge: t("llmLocalBadge"),
                cloudBadge: t("llmCloudBadge"),
                save: t("llmSave"),
                saved: t("llmSaved"),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{t("bank")}</CardTitle>
              <CardDescription>
                {linked > 0 ? t("bankLinkedCount", { count: linked }) : t("bankNotLinked")}
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link href="/settings/bank">{t("manage")}</Link>
            </Button>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("backupTitle")}</CardTitle>
            <CardDescription>{t("backupDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <BackupCard
              labels={{
                downloadLabel: t("backupDownload"),
                downloadHint: t("backupDownloadHint"),
                restoreLabel: t("backupRestore"),
                restoreHint: t("backupRestoreHint"),
                restoreStaged: t("backupRestoreStaged"),
                restoreFailed: t("backupRestoreFailed"),
                pickFile: t("backupPickFile"),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("security")}</CardTitle>
            <CardDescription>{t("securityDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SecurityCard
              labels={{
                changePinTitle: t("changePinTitle"),
                changePinDescription: t("changePinDescription"),
                currentPinLabel: t("currentPinLabel"),
                newPinLabel: t("newPinLabel"),
                confirmPinLabel: t("confirmPinLabel"),
                changePinSubmit: t("changePinSubmit"),
                changePinSuccess: t("changePinSuccess"),
                changePinWarning: t("changePinWarning"),
                dangerZone: t("dangerZone"),
                deleteAllTitle: t("deleteAllTitle"),
                deleteAllDescription: t("deleteAllDescription"),
                deleteAllConfirm: t("deleteAllConfirm"),
                deleteAllPinLabel: t("deleteAllPinLabel"),
                deleteAllCancel: t("deleteAllCancel"),
                deleteAllSubmit: t("deleteAllSubmit"),
                deleteAllWarning: t("deleteAllWarning"),
                error: {
                  invalidPin: t("errorInvalidPin"),
                  invalidNewPin: t("errorInvalidNewPin"),
                  mismatch: t("errorMismatch"),
                  samePin: t("errorSamePin"),
                  wrongPin: t("errorWrongPin"),
                  notAuthenticated: t("errorNotAuthenticated"),
                  generic: t("errorGeneric"),
                },
              }}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
