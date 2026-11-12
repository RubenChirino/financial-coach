"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * A page that throws renders this inside the shell, so navigation keeps
 * working. The error's message is not shown: in production Next replaces it
 * with a generic one, and server details must not reach the browser anyway.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h2 className="text-lg font-semibold">{t("pageErrorTitle")}</h2>
      <p className="text-sm text-[color:var(--text-tertiary)]">{t("pageErrorBody")}</p>
      {error.digest ? (
        <p className="font-mono text-[11px] text-[color:var(--text-tertiary)]">{error.digest}</p>
      ) : null}
      <Button type="button" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
