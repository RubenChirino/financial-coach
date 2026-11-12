"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkChoiceView } from "@/lib/accounts/link";
import { resolveAccountLinkAction } from "@/lib/accounts/link-actions";

function label(name: string, ibanLast4: string | null): string {
  return ibanLast4 ? `${name} ••${ibanLast4}` : name;
}

/**
 * Accounts from a new bank consent that might continue an account the user
 * already has. Each waits, unsynced, until the user picks "same as X" or
 * "new account" — so a re-linked bank's history is never counted twice.
 */
export function LinkChoicesCard({ choices }: { choices: LinkChoiceView[] }) {
  const t = useTranslations("bank.relink");
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  function resolve(choiceId: number, targetAccountId: number | null) {
    startTransition(async () => {
      const res = await resolveAccountLinkAction(choiceId, targetAccountId);
      if (res.ok) {
        toast.success({
          title: t("resolved"),
          description: t("imported", { count: res.inserted }),
        });
      } else {
        toast.error({ title: t("failed"), description: res.error });
      }
      router.refresh();
    });
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {choices.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <p className="text-sm">
              {t("question", {
                account: label(c.account.name, c.account.ibanLast4),
                bank: c.institutionName,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {c.candidates.map((cand) => (
                <Button
                  key={cand.id}
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => resolve(c.id, cand.id)}
                >
                  {t("sameAs", { account: label(cand.name, cand.ibanLast4) })}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => resolve(c.id, null)}
              >
                {t("newAccount")}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
