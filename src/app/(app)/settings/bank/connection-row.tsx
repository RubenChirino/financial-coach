"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { type BankConnectionSummary, deleteBankConnectionAction } from "@/lib/gocardless/actions";

export function ConnectionRow({
  connection,
  statusLabel,
  deleteLabel,
  accountsLabel,
  lastSyncLabel,
  neverSyncedLabel,
  demoLabel,
}: {
  connection: BankConnectionSummary;
  statusLabel: string;
  deleteLabel: string;
  accountsLabel: string;
  lastSyncLabel: string;
  neverSyncedLabel: string;
  demoLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const tCommon = useTranslations("common");
  const tBank = useTranslations("bank");

  async function onDelete() {
    const ok = await confirm({
      title: deleteLabel,
      description: tBank("connectionDeleteBody", { name: connection.institutionName }),
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await deleteBankConnectionAction(connection.requisitionId);
      toast.success({
        title: tBank("connectionDeleted"),
        description: connection.institutionName,
      });
      router.refresh();
    });
  }

  const lastSyncText = connection.lastSyncedAt
    ? new Date(connection.lastSyncedAt).toLocaleString()
    : neverSyncedLabel;

  const statusClass =
    connection.status === "linked"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : connection.status === "expired" || connection.status === "revoked"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {connection.institutionLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={connection.institutionLogo} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {connection.institutionName.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{connection.institutionName}</p>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusClass}`}>
            {statusLabel}
          </span>
          {connection.provider === "demo" ? (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              {demoLabel}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {connection.accountCount} {accountsLabel} · {lastSyncLabel}: {lastSyncText}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={isPending}
        aria-label={deleteLabel}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
