"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { updateDigestOptInAction } from "@/lib/settings/actions";
import { cn } from "@/lib/utils";

/** Opt in/out of the periodic email digest of insights. */
export function DigestToggle({ initial, email }: { initial: boolean; email: string }) {
  const t = useTranslations("settings");
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      try {
        await updateDigestOptInAction(next);
      } catch {
        setOn(!next); // revert on failure
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-[13px] text-[color:var(--text-secondary)]">
        {t("digestTo", { email })}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("digestToggle")}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
          on ? "bg-[color:var(--brand-primary)]" : "bg-[color:var(--surface-app)]",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            on ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
