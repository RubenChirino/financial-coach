"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteBankCredentialsAction, saveBankCredentialsAction } from "@/lib/gocardless/actions";

export function BankCredentialsCard({ hasCredentials }: { hasCredentials: boolean }) {
  const t = useTranslations("bank.credentials");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(!hasCredentials);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveBankCredentialsAction(formData);
      if (!res.ok) {
        setError(res.error);
        toast.error({ title: t("saveFailed"), description: res.error });
        return;
      }
      setEditing(false);
      toast.success({ title: t("saveSuccess") });
      router.refresh();
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: t("confirmDeleteTitle"),
      description: t("confirmDelete"),
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteBankCredentialsAction();
      if (!res.ok) {
        setError(res.error);
        toast.error({ title: t("deleteFailed"), description: res.error });
        return;
      }
      setEditing(true);
      toast.success({ title: t("deleteSuccess") });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>
        {hasCredentials && !editing ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {t("configured")}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form action={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="secretId">{t("secretIdLabel")}</Label>
              <Input
                id="secretId"
                name="secretId"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="secretKey">{t("secretKeyLabel")}</Label>
              <Input
                id="secretKey"
                name="secretKey"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("storedEncrypted")}</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? tCommon("loading") : t("save")}
              </Button>
              {hasCredentials ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={isPending}
                >
                  {tCommon("cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("replace")}
            </Button>
            <Button variant="ghost" onClick={onDelete} disabled={isPending}>
              {tCommon("delete")}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
