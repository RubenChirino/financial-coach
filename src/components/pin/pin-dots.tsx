import { cn } from "@/lib/utils";

interface PinDotsProps {
  /** Number of entered digits (0..length). */
  filled: number;
  /** Total number of digits expected. Defaults to 4 for the Coin PIN policy. */
  length?: number;
  /** Wrong-PIN state — dots turn destructive + trigger shake. */
  error?: boolean;
}

/**
 * Row of dots indicating how many PIN digits have been entered so far.
 * Pure presentational — state lives in the parent so the pad can own input.
 */
export function PinDots({ filled, length = 4, error = false }: PinDotsProps) {
  return (
    <div
      className={cn("flex items-center justify-center gap-4 py-2", error && "pin-shake")}
      role="status"
      aria-label={`PIN: ${filled} of ${length} digits entered`}
    >
      {Array.from({ length }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, ordered
          key={i}
          className={cn(
            "h-3 w-3 rounded-full transition-all duration-200",
            i < filled
              ? error
                ? "bg-[color:var(--destructive)] scale-110"
                : "bg-[color:var(--brand-primary)] scale-110"
              : "border border-[color:var(--border-strong)] bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
