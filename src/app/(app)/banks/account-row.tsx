"use client";

import { Loader2, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { ConvertedAmount } from "@/components/converted-amount";
import { useToast } from "@/components/toaster";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { deleteAccountAction } from "@/lib/accounts/actions";

interface Props {
  id: number;
  name: string;
  ibanLast4: string | null;
  balanceCents: number;
  currency: string;
  intlLocale: string;
}

export function AccountRow({ id, name, ibanLast4, balanceCents, currency, intlLocale }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const tCommon = useTranslations("common");
  const tBank = useTranslations("bank");
  const [pending, start] = useTransition();

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: tBank("deleteAccountTitle"),
      description: tBank("deleteAccountBody", { name }),
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteAccountAction(id);
      if (!res.ok) {
        toast.error({ title: tBank("deleteAccountError") });
        return;
      }
      toast.success({ title: tBank("deleteAccountDone"), description: name });
      router.refresh();
    });
  }

  return (
    <li>
      <div className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[color:var(--brand-primary-soft)]">
        <Link
          href={`/transactions?accountId=${id}`}
          className="flex min-w-0 flex-1 items-center gap-4"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-app)] text-[color:var(--text-tertiary)]">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{name}</div>
            {ibanLast4 ? (
              <div className="text-[11px] text-[color:var(--text-tertiary)]">••{ibanLast4}</div>
            ) : null}
          </div>
          <div className="tnum shrink-0 text-[14px] font-semibold">
            <ConvertedAmount cents={balanceCents} currency={currency} intlLocale={intlLocale} />
          </div>
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          title={tBank("deleteAccountTitle")}
          aria-label={tBank("deleteAccountTitle")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--text-tertiary)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </li>
  );
}
