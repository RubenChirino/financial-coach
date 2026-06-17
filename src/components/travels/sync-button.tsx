"use client";

import { Button } from "@/components/ui/button";
import { useDetectStore } from "@/lib/travels/detect-store";
import { Loader2, RefreshCw } from "lucide-react";

export interface SyncButtonLabels {
  sync: string;
  syncing: string;
}

/**
 * Kicks off a background "detect trips" run (resolving city-only payments to
 * countries) and returns immediately. Progress is shown by the global floating
 * card (`DetectTravelsProgress`), which persists across navigation and stacks
 * with the categorization card.
 */
export function SyncButton({ labels }: { labels: SyncButtonLabels }) {
  const status = useDetectStore((s) => s.status);
  const start = useDetectStore((s) => s.start);
  const running = status === "running";

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => start()}
      disabled={running}
      className="h-9"
    >
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {running ? labels.syncing : labels.sync}
    </Button>
  );
}
