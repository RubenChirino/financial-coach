"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button for the /lock provider forms. The forms POST to a server action
 * that kicks off the OAuth redirect (or guest session) — a full round-trip with
 * no client state of its own. `useFormStatus` lets us show a spinner and disable
 * the button while the action is in flight, so a click gives immediate feedback
 * instead of looking frozen until the browser navigates.
 */
export function SubmitButton({
  icon,
  label,
  className,
}: {
  icon: ReactNode;
  label: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : icon}
      <span>{label}</span>
    </button>
  );
}
