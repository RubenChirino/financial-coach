import { type BarDatum, Bars } from "@/components/charts/bars";

export interface MonthlyFlowCardProps {
  title: string;
  subtitle: string;
  incomeLabel: string;
  expenseLabel: string;
  data: BarDatum[];
  formatted: { income: string; expense: string }[];
}

export function MonthlyFlowCard({
  title,
  subtitle,
  incomeLabel,
  expenseLabel,
  data,
  formatted,
}: MonthlyFlowCardProps) {
  return (
    <section className="coin-card p-6 h-full">
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
          <div className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">{subtitle}</div>
        </div>
        <div className="flex gap-3 text-[11px] text-[color:var(--text-secondary)]">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[color:var(--brand-primary)]" />
            {incomeLabel}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[color:var(--creative-pink)]" />
            {expenseLabel}
          </div>
        </div>
      </div>
      <Bars
        data={data}
        height={140}
        incomeLabel={incomeLabel}
        expenseLabel={expenseLabel}
        formatted={formatted}
      />
    </section>
  );
}
