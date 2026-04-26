import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { FileSpreadsheet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ImportForm } from "./import-form";
import { SampleDataButton } from "./sample-data-button";

export const dynamic = "force-dynamic";

/**
 * CSV import page — "try without a bank" entry point.
 *
 * The header format is documented inline in the help card rather than linked
 * out: users who land here typically already have a CSV in hand and need to
 * know if it'll work in a single glance. The sample-data button below is the
 * zero-friction path for evaluators.
 */
export default async function ImportPage() {
  if (!(await getCurrentSession())) redirect("/lock");

  const t = await getTranslations("import");

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" />
              {t("formatTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t("formatBody")}</p>
            <pre className="rounded-md border bg-muted/50 p-3 text-xs overflow-x-auto">
              {`date,amount,currency,merchant,description
2026-01-05,-11.99,EUR,Netflix,Netflix Monthly Subscription
2026-01-15,1800.00,EUR,Acme Corp,Salary January 2026`}
            </pre>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
              <li>{t("hintDate")}</li>
              <li>{t("hintAmount")}</li>
              <li>{t("hintCurrency")}</li>
              <li>{t("hintDedupe")}</li>
              <li>{t("hintAi")}</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("uploadTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportForm
              labels={{
                pasteLabel: t("pasteLabel"),
                pastePlaceholder: t("pastePlaceholder"),
                orPickFile: t("orPickFile"),
                submit: t("submit"),
                submitting: t("submitting"),
                successTitle: t("successTitle"),
                successBody: t("successBody"),
                duplicatesSuffix: t("duplicatesSuffix"),
                categorizedSuffix: t("categorizedSuffix"),
                errorsTitle: t("errorsTitle"),
                errorLine: t("errorLine"),
                genericError: t("genericError"),
                viewTransactions: t("viewTransactions"),
                emptyError: t("emptyError"),
                fileTooLargeError: t("fileTooLargeError"),
                headerErrorPrefix: t("headerErrorPrefix"),
                modeLabel: t("modeLabel"),
                modeAuto: t("modeAuto"),
                modeAutoHint: t("modeAutoHint"),
                modeAi: t("modeAi"),
                modeAiHint: t("modeAiHint"),
                modeStrict: t("modeStrict"),
                modeStrictHint: t("modeStrictHint"),
                aiUsedTitle: t("aiUsedTitle"),
                aiUsedBody: t("aiUsedBody"),
                aiUnavailableError: t("aiUnavailableError"),
                allRowsFailedError: t("allRowsFailedError"),
                aiSpecLabel: t("aiSpecLabel"),
                cloudConsentRequiredError: t("cloudConsentRequiredError"),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("sampleTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("sampleBody")}</p>
            <SampleDataButton
              label={t("sampleCta")}
              busyLabel={t("submitting")}
              successLabel={t("sampleDone")}
              errorLabel={t("genericError")}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
