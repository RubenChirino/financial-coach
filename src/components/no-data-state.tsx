import { Landmark, type LucideIcon, Upload } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { isGuestSession } from "@/lib/auth/session";

/**
 * The "you have no data yet" state for feature pages that are useless without
 * transactions — trip detection, subscription detection, and anything else
 * that reads the ledger.
 *
 * Those pages used to render their normal empty state plus their primary
 * action, which reads as a broken feature: a "Detect subscriptions" button
 * that can only ever find nothing, or a home-location form asked before there
 * is anything to classify. This says what is actually missing and points at
 * the ways to fix it.
 *
 * Guests get different calls to action. Connecting a bank needs a real
 * account, so offering it to a guest is a locked door — every bank action is
 * refused server-side. They get the import route (which for them means the
 * sample data) plus a note that signing in unlocks bank connections. The
 * per-page `title`/`description` are replaced too: "connect a bank or import"
 * is simply wrong advice for someone who cannot do the first half.
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
  const [t, isGuest] = await Promise.all([getTranslations("common"), isGuestSession()]);

  if (isGuest) {
    return (
      <EmptyState
        Icon={Icon}
        title={t("guestNoBankTitle")}
        description={t("guestNoBankBody")}
        action={
          <Button asChild>
            <Link href="/import">
              <Upload className="h-4 w-4" />
              {t("importTransactionsGuest")}
            </Link>
          </Button>
        }
      />
    );
  }

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
