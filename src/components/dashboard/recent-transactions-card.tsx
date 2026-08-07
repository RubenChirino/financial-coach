import { ArrowDownLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { ConvertedAmount } from "@/components/converted-amount";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RecentTransactionRow {
  id: number;
  merchant: string;
  subLabel: string; // "Category · Institution"
  amountCents: number;
  currency: string;
  categoryIcon: string | null;
  categoryColor: string | null;
}

export function RecentTransactionsCard({
  title,
  seeAllLabel,
  emptyLabel,
  rows,
  intlLocale,
}: {
  title: string;
  seeAllLabel: string;
  emptyLabel: string;
  rows: RecentTransactionRow[];
  intlLocale: string;
}) {
  return (
    <section className="coin-card flex h-full flex-col p-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-[12px]">
          <Link href="/transactions">
            {seeAllLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[color:var(--text-secondary)]">
          {emptyLabel}
        </p>
      ) : (
        <ul>
          {rows.map((r, i) => {
            const positive = r.amountCents > 0;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 py-2.5",
                  i > 0 && "border-t border-[color:var(--border-default)]",
                )}
              >
                <div
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]"
                  style={{
                    background:
                      r.categoryColor != null
                        ? `${r.categoryColor}22`
                        : positive
                          ? "#DCFCE7"
                          : "var(--brand-primary-soft)",
                    color: r.categoryColor ?? (positive ? "#166534" : "var(--brand-primary)"),
                    fontSize: 16,
                  }}
                  aria-hidden
                >
                  {r.categoryIcon ? (
                    <CategoryIcon icon={r.categoryIcon} className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4" strokeWidth={2.5} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{r.merchant}</div>
                  <div className="truncate text-[11px] text-[color:var(--text-tertiary)]">
                    {r.subLabel}
                  </div>
                </div>
                <div
                  className={cn(
                    "tnum text-[13px] font-semibold shrink-0",
                    positive && "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  <ConvertedAmount
                    cents={r.amountCents}
                    currency={r.currency}
                    intlLocale={intlLocale}
                    signDisplay="exceptZero"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
