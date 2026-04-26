import { Donut, type DonutSegment } from "@/components/charts/donut";
import { PrivacyAmount } from "@/components/privacy-amount";

export interface DonutCardProps {
  title: string;
  subtitle: string;
  segments: DonutSegment[];
  totalFormatted: string;
  totalCaption: string;
  /** Top entries to list next to the donut. */
  legend: { label: string; color: string; valueFormatted: string }[];
  emptyLabel: string;
}

export function DonutCard({
  title,
  subtitle,
  segments,
  totalFormatted,
  totalCaption,
  legend,
  emptyLabel,
}: DonutCardProps) {
  const isEmpty = segments.length === 0 || segments.every((s) => s.value <= 0);
  return (
    <section className="coin-card p-6 h-full">
      <div className="mb-2.5">
        <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
        <div className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">{subtitle}</div>
      </div>
      {isEmpty ? (
        <p className="py-8 text-center text-[13px] text-[color:var(--text-secondary)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="flex items-center gap-5">
          <Donut
            segments={segments}
            size={130}
            thickness={14}
            center={
              <>
                <div className="text-[20px] font-semibold tracking-[-0.015em] tnum">
                  <PrivacyAmount value={totalFormatted} />
                </div>
                <div className="text-[11px] text-[color:var(--text-tertiary)]">{totalCaption}</div>
              </>
            }
          />
          <ul className="flex-1 space-y-2">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: l.color }}
                  aria-hidden
                />
                <span className="flex-1 truncate font-medium">{l.label}</span>
                <span className="tnum font-semibold">
                  <PrivacyAmount value={l.valueFormatted} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
