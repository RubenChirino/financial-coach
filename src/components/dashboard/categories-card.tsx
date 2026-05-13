import { CategoryIcon } from "@/components/category-icon";
import { PrivacyAmount } from "@/components/privacy-amount";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export interface CategorySpendRow {
  categoryId: number;
  name: string;
  icon: string;
  color: string;
  spentFormatted: string;
  budgetFormatted: string | null;
  /** 0–100, clamped. */
  pct: number;
  over: boolean;
}

export function CategoriesCard({
  title,
  viewAllLabel,
  rows,
  emptyLabel,
}: {
  title: string;
  viewAllLabel: string;
  rows: CategorySpendRow[];
  emptyLabel: string;
}) {
  return (
    <section className="coin-card p-6 h-full">
      <div className="mb-3.5 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-[12px]">
          <Link href="/categories">
            {viewAllLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[color:var(--text-secondary)]">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-3.5">
          {rows.map((r) => {
            const pct = Math.min(100, Math.max(0, r.pct));
            return (
              <li key={r.categoryId}>
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]"
                    style={{ backgroundColor: `${r.color}22`, color: r.color }}
                    aria-hidden
                  >
                    <CategoryIcon icon={r.icon} className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">{r.name}</span>
                  <span className="tnum shrink-0 text-[12px] font-semibold">
                    <PrivacyAmount value={r.spentFormatted} />
                    {r.budgetFormatted ? (
                      <span className="font-normal text-[color:var(--text-tertiary)]">
                        {" / "}
                        <PrivacyAmount value={r.budgetFormatted} />
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--brand-primary-soft)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: r.over ? "#EF4444" : r.color,
                    }}
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
