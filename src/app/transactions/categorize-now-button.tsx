"use client";

import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { categorizeNowAction } from "@/lib/gocardless/actions";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * "Categorize with AI" button on the /transactions header.
 *
 * Calls `categorizeNowAction()` and surfaces the result as a toast — without
 * this, errors (Ollama unreachable, missing API key, etc.) silently disappear
 * and users assume the button is broken.
 *
 * Toast strings are looked up via `useTranslations` directly so the page
 * doesn't need to pass a callback (forbidden across the server→client
 * boundary).
 */
export function CategorizeNowButton({
  label,
  busyLabel,
}: {
  label: string;
  busyLabel: string;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const { success, error: toastErr } = useToast();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await categorizeNowAction();
      if (!result.ok) {
        toastErr({ title: t("categorizeToastError"), description: result.error });
      } else {
        const count = (result.data?.ruleMatched ?? 0) + (result.data?.llmMatched ?? 0);
        success({
          title: t("categorizeToastTitle"),
          description: t("categorizeToastDetail", { count }),
        });
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {pending ? busyLabel : label}
    </Button>
  );
}
