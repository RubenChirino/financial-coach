"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { headingFor } from "./headings";

/** The current route's title and subtitle, for the mobile and desktop topbars. */
export function ShellTitle({ hasData, compact }: { hasData: boolean; compact?: boolean }) {
  const t = useTranslations();
  const { title, subtitle } = headingFor(usePathname(), hasData);
  return (
    <>
      <div
        className={
          compact
            ? "truncate text-sm font-semibold"
            : "truncate text-[20px] font-semibold leading-tight tracking-tight"
        }
      >
        {t(title)}
      </div>
      <div
        className={
          compact
            ? "truncate text-[11px] text-[color:var(--text-tertiary)]"
            : "truncate text-[12px] text-[color:var(--text-tertiary)]"
        }
      >
        {t(subtitle)}
      </div>
    </>
  );
}
