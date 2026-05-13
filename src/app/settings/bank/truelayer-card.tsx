"use client";

import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteTrueLayerCredentialsAction,
  saveTrueLayerCredentialsAction,
  startTrueLayerLinkAction,
} from "@/lib/truelayer/actions";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * TrueLayer credentials card + "Connect bank" button.
 *
 * Mirrors the GoCardless credentials card but stores `{clientId, clientSecret,
 * environment}`. When credentials are present, a "Connect bank via TrueLayer"
 * button kicks off the OAuth consent flow — the user is redirected to
 * TrueLayer's hosted auth page and returns via `/settings/bank/truelayer/callback`.
 */
export function TrueLayerCard({ hasCredentials }: { hasCredentials: boolean }) {
  const t = useTranslations("bank.truelayer");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(!hasCredentials);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [linking, setLinking] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveTrueLayerCredentialsAction(formData);
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
      const res = await deleteTrueLayerCredentialsAction();
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

  const [country, setCountry] = useState("ES");

  function onConnect() {
    setError(null);
    setLinking(true);
    startTransition(async () => {
      const res = await startTrueLayerLinkAction(country || undefined);
      if (!res.ok || !res.data) {
        setError(res.ok ? "noLink" : res.error);
        setLinking(false);
        return;
      }
      window.location.href = res.data.link;
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
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--success)" }}>
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {t("configured")}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form action={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tl-clientId">{t("clientIdLabel")}</Label>
              <Input
                id="tl-clientId"
                name="clientId"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="sandbox-xxxx"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tl-clientSecret">{t("clientSecretLabel")}</Label>
              <Input
                id="tl-clientSecret"
                name="clientSecret"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tl-environment">{t("environmentLabel")}</Label>
              <select
                id="tl-environment"
                name="environment"
                defaultValue="sandbox"
                className="h-9 rounded-md border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 text-sm"
              >
                <option value="sandbox">{t("environmentSandbox")}</option>
                <option value="live">{t("environmentLive")}</option>
              </select>
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
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="tl-country" className="text-sm font-medium leading-none">
                {t("countryLabel")}
              </label>
              <select
                id="tl-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-9 w-full max-w-xs rounded-md border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 text-sm"
              >
                <option value="">{t("countries.all")}</option>
                {(
                  [
                    "ES",
                    "GB",
                    "FR",
                    "DE",
                    "IT",
                    "NL",
                    "IE",
                    "PL",
                    "SE",
                    "NO",
                    "DK",
                    "LT",
                    "LV",
                    "EE",
                  ] as const
                ).map((c) => (
                  <option key={c} value={c}>
                    {t(`countries.${c}`)}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted-foreground">{t("countryHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onConnect} disabled={isPending || linking}>
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : t("connect")}
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                {t("replace")}
              </Button>
              <Button variant="ghost" onClick={onDelete} disabled={isPending}>
                {tCommon("delete")}
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
