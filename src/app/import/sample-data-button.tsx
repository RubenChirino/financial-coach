"use client";

import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { importSampleDataAction } from "@/lib/import/actions";

/**
 * One-click "try with sample data" button. Runs the same server action as the
 * paste flow, but seeded with the bundled `docs/sample-transactions.csv`.
 */
export function SampleDataButton({
  label,
  busyLabel,
  successLabel,
  errorLabel,
}: {
  label: string;
  busyLabel: string;
  successLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { inserted: number; duplicates: number }>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await importSampleDataAction();
      if (!res.ok) {
        setError(errorLabel);
        return;
      }
      setDone({ inserted: res.data.inserted, duplicates: res.data.duplicates });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={handleClick} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {pending ? busyLabel : label}
      </Button>
      {done ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {successLabel
              .replace("{inserted}", String(done.inserted))
              .replace("{duplicates}", String(done.duplicates))}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
