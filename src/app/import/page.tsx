import { AppShell } from "@/components/app-shell";
import { TourButton } from "@/components/tour-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/locale";
import { listImportBatches } from "@/lib/import/batches";
import { listCategoryOptionsAction } from "@/lib/transactions/actions";
import { FileSpreadsheet, History, PenLine } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ImportForm } from "./import-form";
import { ImportHistory } from "./import-history";
import { ManualTransactionForm } from "./manual-transaction-form";
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
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const [t, locale, batches, categories] = await Promise.all([
    getTranslations("import"),
    getLocale(),
    listImportBatches(session.userId),
    listCategoryOptionsAction(),
  ]);
  const intlLocale = locale === "en" ? "en-US" : "es-ES";

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <TourButton
            label={locale === "es" ? "¿Cómo funciona?" : "How it works"}
            steps={[
              {
                title: locale === "es" ? "Importar transacciones" : "Import transactions",
                description:
                  locale === "es"
                    ? "Puedes importar transacciones desde cualquier banco aunque no esté conectado directamente. Solo necesitas un fichero CSV o Excel (.xls/.xlsx) exportado desde tu banco."
                    : "You can import transactions from any bank even if it isn't directly connected. You just need a CSV or Excel (.xls/.xlsx) file exported from your bank.",
              },
              {
                element: "#import-format-card",
                title: locale === "es" ? "Formato canónico" : "Canonical format",
                description:
                  locale === "es"
                    ? "Si tu CSV ya tiene estos 5 campos, se importa directamente sin IA. Pero no te preocupes si tu banco usa un formato diferente — el modo Auto lo detecta solo."
                    : "If your CSV already has these 5 fields, it imports directly without AI. But don't worry if your bank uses a different format — Auto mode detects it automatically.",
                side: "bottom",
              },
              {
                element: "#import-upload-card",
                title: locale === "es" ? "Subir el fichero" : "Upload the file",
                description:
                  locale === "es"
                    ? "Pega el CSV directamente, o pulsa 'Elegir fichero' para subir un CSV o Excel. Hay tres modos: Auto (recomendado), Siempre IA (para formatos muy raros), y Solo estricto (sin IA)."
                    : "Paste the CSV directly, or click 'Pick a file' to upload a CSV or Excel file. Three modes: Auto (recommended), Always AI (for unusual formats), and Strict only (no AI).",
                side: "bottom",
              },
              {
                element: "#import-sample-card",
                title: locale === "es" ? "Datos de ejemplo" : "Sample data",
                description:
                  locale === "es"
                    ? "¿Quieres explorar la app sin tus datos reales? Importa las transacciones de ejemplo para ver cómo funciona todo con datos ficticios."
                    : "Want to explore the app without your real data? Import the sample transactions to see how everything works with fictional data.",
                side: "top",
              },
            ]}
          />
        </header>

        <Card id="import-format-card">
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

        <Card id="import-upload-card">
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
                rateLimitedError: t("rateLimitedError"),
                forceReimportLabel: t("forceReimportLabel"),
                forceReimportHint: t("forceReimportHint"),
                parsedSampleTitle: t("parsedSampleTitle"),
                parsedSampleHint: t("parsedSampleHint"),
                duplicatesBreakdownIntra: t("duplicatesBreakdownIntra"),
                duplicatesBreakdownExisting: t("duplicatesBreakdownExisting"),
                zeroInsertedHint: t("zeroInsertedHint"),
              }}
            />
          </CardContent>
        </Card>

        {/* Manual transaction entry */}
        <Card id="import-manual-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4" />
              {t("manualTitle")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("manualSubtitle")}</p>
          </CardHeader>
          <CardContent>
            <ManualTransactionForm
              categories={categories}
              locale={locale}
              labels={{
                sectionTitle: t("manualTitle"),
                sectionSubtitle: t("manualSubtitle"),
                typeExpense: t("manualTypeExpense"),
                typeIncome: t("manualTypeIncome"),
                dateLabel: t("manualDateLabel"),
                amountLabel: t("manualAmountLabel"),
                currencyLabel: t("manualCurrencyLabel"),
                merchantLabel: t("manualMerchantLabel"),
                merchantPlaceholder: t("manualMerchantPlaceholder"),
                descriptionLabel: t("manualDescriptionLabel"),
                descriptionPlaceholder: t("manualDescriptionPlaceholder"),
                categoryLabel: t("manualCategoryLabel"),
                categoryNone: t("manualCategoryNone"),
                submitButton: t("manualSubmit"),
                submitting: t("manualSubmitting"),
                successMessage: t("manualSuccess"),
                errorInvalidDate: t("manualErrorInvalidDate"),
                errorInvalidAmount: t("manualErrorInvalidAmount"),
                errorMissingDescription: t("manualErrorMissingDescription"),
                errorGeneric: t("manualErrorGeneric"),
              }}
            />
          </CardContent>
        </Card>

        <Card id="import-sample-card">
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

        {/* Import history */}
        <Card id="import-history-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {t("historyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ImportHistory
              batches={batches}
              intlLocale={intlLocale}
              labels={{
                title: t("historyTitle"),
                empty: t("historyEmpty"),
                pastedLabel: t("historyPasted"),
                rowsInserted: t("historyInserted"),
                rowsDuplicate: t("historyDuplicate"),
                deleteButton: t("historyDelete"),
                deleteConfirm: t("historyDeleteConfirm"),
                deleting: t("historyDeleting"),
                deleteError: t("historyDeleteError"),
                resetAll: t("historyResetAll"),
                resetAllConfirm: t("historyResetAllConfirm"),
                resetAllSuccess: t("historyResetAllSuccess"),
              }}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
