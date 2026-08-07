"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCategorizeStore } from "@/lib/categorize/store";

/**
 * "Categorize with AI" button on the /transactions header.
 *
 * Kicks off a background run (rules → keyword → LLM over *all* uncategorized
 * transactions) and returns immediately. Progress is shown by the global
 * floating card (`CategorizeProgress`), which persists across navigation — so
 * the button doesn't hold a spinner for the whole run.
 */
export function CategorizeNowButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const status = useCategorizeStore((s) => s.status);
  const start = useCategorizeStore((s) => s.start);
  const running = status === "running";

  return (
    <Button variant="outline" size="sm" onClick={() => start()} disabled={running}>
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {running ? busyLabel : label}
    </Button>
  );
}
