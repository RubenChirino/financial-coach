"use client";

import { Button } from "@/components/ui/button";
import { runRecurringDetectionAction } from "@/lib/recurring/actions";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RunDetectionButton({
  label,
  busyLabel,
}: {
  label: string;
  busyLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await runRecurringDetectionAction();
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {pending ? busyLabel : label}
    </Button>
  );
}
