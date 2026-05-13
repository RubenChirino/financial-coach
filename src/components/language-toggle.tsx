"use client";
import { Button } from "@/components/ui/button";
import { changeLanguageAction } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LanguageToggle({ current }: { current: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: Locale = current === "es" ? "en" : "es";
  const label = next === "es" ? "ES" : "EN";

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await changeLanguageAction(next);
          router.refresh();
        })
      }
      className="gap-2"
      aria-label={`Switch language to ${label}`}
    >
      <Languages className="h-4 w-4" />
      <span className="tabular text-xs font-semibold">{label}</span>
    </Button>
  );
}
