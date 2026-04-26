"use client";

import { Button } from "@/components/ui/button";
import { categorizeNowAction } from "@/lib/gocardless/actions";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function CategorizeNowButton({
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
      await categorizeNowAction();
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {pending ? busyLabel : label}
    </Button>
  );
}
