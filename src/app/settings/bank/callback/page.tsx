import { AppShell } from "@/components/app-shell";
import { ToastOnMount } from "@/components/toast-on-mount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { finalizeBankLinkAction, syncAllAccountsAction } from "@/lib/gocardless/actions";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BankCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; error?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");
  const sp = await searchParams;
  const t = await getTranslations("bank.callback");

  if (sp.error) {
    return (
      <Result title={t("failed")} description={sp.error} success={false} tAgain={t("tryAgain")} />
    );
  }
  if (!sp.ref) {
    return (
      <Result
        title={t("failed")}
        description={t("missingRef")}
        success={false}
        tAgain={t("tryAgain")}
      />
    );
  }

  const finalize = await finalizeBankLinkAction(sp.ref);
  if (!finalize.ok) {
    return (
      <Result
        title={t("failed")}
        description={finalize.error}
        success={false}
        tAgain={t("tryAgain")}
      />
    );
  }

  const count = finalize.data?.accountCount ?? 0;
  let syncedInserted = 0;
  if (count > 0) {
    const syncRes = await syncAllAccountsAction();
    if (syncRes.ok && syncRes.data) syncedInserted = syncRes.data.inserted;
  }

  return (
    <Result
      title={t("linked")}
      description={t("linkedDetail", { accounts: count, inserted: syncedInserted })}
      success
      tAgain={t("done")}
      toastTitle={t("toastTitle")}
      toastDescription={t("toastDescription", { accounts: count, inserted: syncedInserted })}
    />
  );
}

function Result({
  title,
  description,
  success,
  tAgain,
  toastTitle,
  toastDescription,
}: {
  title: string;
  description: string;
  success: boolean;
  tAgain: string;
  toastTitle?: string;
  toastDescription?: string;
}) {
  return (
    <AppShell>
      {success && toastTitle ? (
        <ToastOnMount title={toastTitle} description={toastDescription} variant="success" />
      ) : null}
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle
              className={success ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
            >
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings/bank">{tAgain}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
