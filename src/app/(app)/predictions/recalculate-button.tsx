"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRecalcStore } from "@/lib/predictions/recalc-store";

/**
 * Kicks off the background "recalculate predictions" pipeline (transfers →
 * recurring → forecast). The run lives in a module-scope store, so it keeps
 * going if the user navigates away; progress shows in the floating card.
 */
export function RecalculateButton() {
  const t = useTranslations("predictions");
  const status = useRecalcStore((s) => s.status);
  const start = useRecalcStore((s) => s.start);
  const running = status === "running";

  return (
    <Button type="button" variant="outline" onClick={() => void start()} disabled={running}>
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {running ? t("recalcRunning") : t("recalcButton")}
    </Button>
  );
}
