/**
 * Pure-SVG sparkline — tiny, server-renderable line chart. No external deps,
 * no interactivity. Width/height are explicit so the parent controls layout.
 *
 * Ported from the Coin design handoff (dashboard.jsx::Sparkline).
 */
export interface SparklineProps {
  values: number[];
  color?: string;
  fillColor?: string;
  width?: number;
  height?: number;
  /** Whether to render the translucent area fill under the line. */
  fill?: boolean;
  strokeWidth?: number;
  "aria-label"?: string;
}

export function Sparkline({
  values,
  color = "var(--brand-primary)",
  fillColor,
  width = 130,
  height = 52,
  fill = true,
  strokeWidth = 2,
  "aria-label": ariaLabel,
}: SparklineProps) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true" focusable="false">
        <title>{ariaLabel ?? "Sparkline"}</title>
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      focusable="false"
      style={{ display: "block" }}
    >
      <title>{ariaLabel ?? "Sparkline"}</title>
      {fill && <path d={area} fill={fillColor ?? color} fillOpacity={0.12} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
