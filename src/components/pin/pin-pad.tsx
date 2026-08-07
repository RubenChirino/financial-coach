"use client";
import { Delete, ScanFace } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface PinPadProps {
  onKey: (digit: number) => void;
  onDelete: () => void;
  /** Shown only on the unlock screen; clicking it bypasses the pad. */
  onBiometric?: () => void;
  biometricLabel?: string;
  /** Blocks all input (e.g. while server action is in-flight). */
  disabled?: boolean;
  /** Enables keyboard bindings (0-9 keys, Backspace). Defaults to true. */
  enableKeyboard?: boolean;
}

/**
 * 3×4 digit pad matching the Coin design. Keys are large (min-h 60px) so
 * they work on touch. Keyboard input is forwarded too — the dots respond to
 * real typing on desktop while the pad still shows tap feedback.
 */
export function PinPad({
  onKey,
  onDelete,
  onBiometric,
  biometricLabel,
  disabled = false,
  enableKeyboard = true,
}: PinPadProps) {
  useEffect(() => {
    if (!enableKeyboard || disabled) return;
    function handle(e: KeyboardEvent) {
      // Ignore when focus is on an editable text field.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        onKey(Number(e.key));
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        onDelete();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onKey, onDelete, enableKeyboard, disabled]);

  return (
    <div className="grid grid-cols-3 gap-3">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <PadButton key={n} onClick={() => onKey(n)} disabled={disabled} ariaLabel={`${n}`}>
          <span className="text-[22px] font-semibold tabular-nums">{n}</span>
        </PadButton>
      ))}

      {onBiometric ? (
        <PadButton
          onClick={onBiometric}
          disabled={disabled}
          ariaLabel={biometricLabel ?? "Biometric unlock"}
          muted
        >
          <ScanFace className="h-[20px] w-[20px]" strokeWidth={2} />
        </PadButton>
      ) : (
        <div aria-hidden />
      )}

      <PadButton onClick={() => onKey(0)} disabled={disabled} ariaLabel="0">
        <span className="text-[22px] font-semibold tabular-nums">0</span>
      </PadButton>

      <PadButton onClick={onDelete} disabled={disabled} ariaLabel="Delete" muted>
        <Delete className="h-[20px] w-[20px]" strokeWidth={2} />
      </PadButton>
    </div>
  );
}

function PadButton({
  onClick,
  disabled,
  ariaLabel,
  children,
  muted = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "flex h-[60px] items-center justify-center rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] text-[color:var(--text-primary)] transition-all",
        "hover:bg-[color:var(--brand-primary-soft)] hover:border-[color:var(--brand-primary-border)] active:scale-[0.97]",
        "disabled:opacity-40 disabled:pointer-events-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface-app)]",
        muted &&
          "bg-transparent border-transparent text-[color:var(--text-tertiary)] hover:bg-[color:var(--brand-primary-soft)]",
      )}
    >
      {children}
    </button>
  );
}
