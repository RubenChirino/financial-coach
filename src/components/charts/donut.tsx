import type { ReactNode } from "react";

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
  "aria-label"?: string;
}

/**
 * Stroked-circle donut chart. Each segment is a `<circle>` with a computed
 * `strokeDasharray` + `strokeDashoffset`, so there's no arc math in user space.
 *
 * Ported from the Coin design handoff (dashboard.jsx::Donut).
 */
export function Donut({
  segments,
  size = 130,
  thickness = 14,
  center,
  "aria-label": ariaLabel,
}: DonutProps) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { role: "presentation" })}
      style={{ position: "relative", width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
        style={{ transform: "rotate(-90deg)" }}
      >
        <title>{ariaLabel ?? "Donut chart"}</title>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="var(--brand-primary-soft)"
          strokeWidth={thickness}
          fill="none"
        />
        {segments.map((seg) => {
          const len = (seg.value / total) * C;
          const gap = C - len;
          const el = (
            <circle
              key={seg.label}
              cx={cx}
              cy={cy}
              r={r}
              stroke={seg.color}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${len} ${gap}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {center ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          {center}
        </div>
      ) : null}
    </div>
  );
}
