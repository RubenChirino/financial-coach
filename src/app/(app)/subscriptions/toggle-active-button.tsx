"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setSubscriptionActiveAction } from "@/lib/recurring/actions";

/**
 * Small per-row toggle that flips a subscription between active/inactive.
 *
 * The detector is heuristic — it's easy to misclassify a tuition or mortgage
 * payment as recurring and miss a cancelled Netflix. This button gives the
 * user the final say without needing to dig into the DB.
 */
export function ToggleActiveButton({
  id,
  isActive,
  pauseLabel,
  resumeLabel,
}: {
  id: number;
  isActive: boolean;
  pauseLabel: string;
  resumeLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      await setSubscriptionActiveAction(id, !isActive);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={pending}
      className="h-7 gap-1 px-2 text-[11.5px]"
      aria-label={isActive ? pauseLabel : resumeLabel}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isActive ? (
        <Pause className="h-3 w-3" />
      ) : (
        <Play className="h-3 w-3" />
      )}
      {isActive ? pauseLabel : resumeLabel}
    </Button>
  );
}
