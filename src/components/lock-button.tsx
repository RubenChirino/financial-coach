"use client";
import { Lock } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { lockAction } from "@/lib/auth/actions";

export function LockButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isPending}
      onClick={() => startTransition(() => lockAction())}
      aria-label="Lock session"
    >
      <Lock className="h-4 w-4" />
    </Button>
  );
}
