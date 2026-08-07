"use client";

import { Check, Loader2, MapPin, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guessCityAction, setCityAction } from "@/lib/travels/actions";

export interface CityEditorLabels {
  cityLabel: string;
  placeholder: string;
  guess: string;
  guessing: string;
  save: string;
  saved: string;
  aiSourceNote: string;
  consentNote: string;
}

/**
 * Inline city editor for a trip. Transactions have no city data, so the city is
 * either AI-guessed (✨) or typed by the user — and a user edit always wins.
 */
export function CityEditor({
  tripKey,
  initialCity,
  initialSource,
  aiAvailable,
  labels,
}: {
  tripKey: string;
  initialCity: string | null;
  initialSource: "ai" | "user" | null;
  /** False when a cloud LLM is configured but consent hasn't been granted. */
  aiAvailable: boolean;
  labels: CityEditorLabels;
}) {
  const [city, setCity] = useState(initialCity ?? "");
  const [source, setSource] = useState<"ai" | "user" | null>(initialSource);
  const [saved, setSaved] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [savePending, startSave] = useTransition();
  const [guessPending, startGuess] = useTransition();

  function save() {
    const trimmed = city.trim();
    if (!trimmed) return;
    startSave(async () => {
      const res = await setCityAction(tripKey, trimmed);
      if (res.ok) {
        setSource("user");
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  function guess() {
    setNeedsConsent(false);
    startGuess(async () => {
      const res = await guessCityAction(tripKey);
      if (res.ok) {
        if (res.city) {
          setCity(res.city);
          setSource("ai");
        }
      } else if (res.error === "cloudConsentRequired") {
        setNeedsConsent(true);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
        <MapPin className="h-3 w-3" />
        {labels.cityLabel}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={city}
          onChange={(e) => setCity(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder={labels.placeholder}
          className="h-8 w-44"
          aria-label={labels.cityLabel}
        />
        <Button type="button" size="sm" variant="secondary" onClick={save} disabled={savePending}>
          {savePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {labels.save}
        </Button>
        {aiAvailable ? (
          <Button type="button" size="sm" variant="ghost" onClick={guess} disabled={guessPending}>
            {guessPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {guessPending ? labels.guessing : labels.guess}
          </Button>
        ) : null}
        {saved ? <Check className="h-4 w-4 text-emerald-500" /> : null}
      </div>
      {source === "ai" && city.trim() ? (
        <p className="mt-1.5 text-[11px] text-[color:var(--text-tertiary)]">
          {labels.aiSourceNote}
        </p>
      ) : null}
      {needsConsent ? (
        <p className="mt-1.5 text-[11px] text-[color:var(--creative-pink-text)]">
          {labels.consentNote}
        </p>
      ) : null}
    </div>
  );
}
