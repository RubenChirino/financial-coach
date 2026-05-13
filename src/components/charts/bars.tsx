export interface BarDatum {
  /** Short label under the bar (pre-localized by caller). */
  label: string;
  /** Inflow amount (cents) for this period. */
  incomeCents: number;
  /** Outflow amount (cents) for this period — should be a positive number. */
  expenseCents: number;
}

export interface BarsProps {
  data: BarDatum[];
  height?: number;
  incomeColor?: string;
  expenseColor?: string;
  incomeLabel: string; // for tooltip/aria — "Income"
  expenseLabel: string; // for tooltip/aria — "Expenses"
  /** Pre-formatted strings for tooltips. Parallel to `data`. */
  formatted?: { income: string; expense: string }[];
}

/**
 * Two-bar-per-period column chart. Pure HTML/CSS (no SVG needed — each bar is
 * a `<div>` with a percentage height), so it scales cleanly inside any card.
 *
 * Ported from the Coin design handoff (dashboard.jsx::Bars).
 */
export function Bars({
  data,
  height = 140,
  incomeColor = "var(--brand-primary)",
  expenseColor = "var(--creative-pink)",
  incomeLabel,
  expenseLabel,
  formatted,
}: BarsProps) {
  const max = Math.max(1, ...data.flatMap((d) => [d.incomeCents, d.expenseCents]));

  return (
    <div
      role="img"
      aria-label={`${incomeLabel} / ${expenseLabel}`}
      className="grid items-end"
      style={{
        gridTemplateColumns: `repeat(${data.length}, 1fr)`,
        columnGap: 10,
        height,
      }}
    >
      {data.map((d, i) => {
        const inPct = (d.incomeCents / max) * 100;
        const outPct = (d.expenseCents / max) * 100;
        const tip = formatted?.[i];
        return (
          <div key={d.label} className="flex flex-col items-center gap-1 h-full justify-end">
            <div className="flex gap-[3px] items-end h-full">
              <div
                className="w-[10px] rounded-[3px] transition-all duration-300"
                style={{ height: `${inPct}%`, background: incomeColor }}
                title={tip ? `${incomeLabel}: ${tip.income}` : undefined}
              />
              <div
                className="w-[10px] rounded-[3px] transition-all duration-300"
                style={{ height: `${outPct}%`, background: expenseColor }}
                title={tip ? `${expenseLabel}: ${tip.expense}` : undefined}
              />
            </div>
            <div className="text-[11px] font-medium text-[color:var(--text-tertiary)]">
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
