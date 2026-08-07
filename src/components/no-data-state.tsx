import { Landmark, type LucideIcon, Upload } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/**
 * The "you have no data yet" state for feature pages that are useless without
 * transactions — trip detection, subscription detection, and anything else
 * that reads the ledger.
 *
 * Those pages used to render their normal empty state plus their primary
 * action, which reads as a broken feature: a "Detect subscriptions" button
 * that can only ever find nothing, or a home-location form asked before there
 * is anything to classify. This says what is actually missing and points at
 * the two ways to fix it.
 *
 * `title`/`description` stay per-page so the copy can name the feature; the
 * two calls to action are shared, since the answer is always the same.
 */
export async function NoDataState({
  Icon,
  title,
  description,
}: {
  Icon: LucideIcon;
  title: string;
  description: string;
}) {
  const t = await getTranslations("common");
  return (
    <EmptyState
      Icon={Icon}
      title={title}
      description={description}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/settings/bank">
              <Landmark className="h-4 w-4" />
              {t("connectBank")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/import">
              <Upload className="h-4 w-4" />
              {t("importTransactions")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
