import { getTranslations } from "next-intl/server";

/** Shown inside the shell while a page's data loads. */
export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-[color:var(--brand-primary-soft)]" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-[color:var(--brand-primary-soft)]"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-[color:var(--brand-primary-soft)]" />
    </div>
  );
}
