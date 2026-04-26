import { Sparkles } from "lucide-react";
import Link from "next/link";

export interface CoachBriefCardProps {
  eyebrow: string;
  headline: string;
  /** Optional highlight rendered on a white chip inside the headline. */
  highlight?: string;
  body: string;
  openLabel: string;
  askLabel: string;
}

/**
 * Pink → blue gradient "Today's brief" card. The gradient is a brand
 * element and stays light in both color schemes — it would lose its
 * identity if we re-tinted it for dark mode. That means every foreground
 * color on the card has to be locked to a dark navy regardless of theme,
 * otherwise dark-mode CSS tokens (`--text-primary` etc.) flip to light
 * and the headline / "Ask account" CTA become invisible against the
 * pastel background. We use explicit hex values rather than tokens so a
 * future theme tweak can't silently regress contrast here.
 */
const FG = "#0F1421";
const FG_MUTED = "rgba(15, 20, 33, 0.72)";
const FG_EYEBROW = "rgba(15, 20, 33, 0.62)";

export function CoachBriefCard({
  eyebrow,
  headline,
  highlight,
  body,
  openLabel,
  askLabel,
}: CoachBriefCardProps) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl p-6 h-full shadow-[var(--shadow-card)]"
      style={{
        background: "linear-gradient(135deg, #FFD1DC 0%, #D4E6FF 100%)",
        color: FG,
      }}
    >
      <div
        aria-hidden
        className="absolute -top-8 -right-8 h-[140px] w-[140px] rounded-full bg-white/35"
      />
      <div className="relative flex h-full flex-col justify-between">
        <div>
          <div className="mb-2.5 flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-white"
              style={{ background: "linear-gradient(135deg, #5389FF, #FFD1DC)" }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: FG_EYEBROW }}
            >
              {eyebrow}
            </div>
          </div>
          <div
            className="text-[17px] leading-snug font-semibold tracking-[-0.01em]"
            style={{ color: FG }}
          >
            {highlight ? (
              <>
                {headline}{" "}
                <span
                  className="rounded-md bg-white px-1.5 py-0.5"
                  style={{ color: FG }}
                >
                  {highlight}
                </span>
              </>
            ) : (
              headline
            )}
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed" style={{ color: FG_MUTED }}>
            {body}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/advisor"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: FG }}
          >
            {openLabel}
          </Link>
          <Link
            href="/advisor"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white"
            style={{ color: FG }}
          >
            {askLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
