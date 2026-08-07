import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth/session";
import { hasBankCredentialsAction, listInstitutionsAction } from "@/lib/gocardless/actions";
import { InstitutionPicker } from "./institution-picker";

export const dynamic = "force-dynamic";

export default async function LinkBankPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");
  if (!(await hasBankCredentialsAction())) redirect("/settings/bank");

  const sp = await searchParams;
  const country = (sp.country ?? "ES").toUpperCase();
  const [t, result] = await Promise.all([getTranslations("bank"), listInstitutionsAction(country)]);

  const institutions = result.ok ? (result.data ?? []) : [];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("pickInstitution")}</h1>
          <p className="text-sm text-muted-foreground">{t("pickInstitutionHint")}</p>
        </header>
        {!result.ok ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {result.error}
          </div>
        ) : (
          <InstitutionPicker institutions={institutions} initialCountry={country} />
        )}
      </div>
    </AppShell>
  );
}
