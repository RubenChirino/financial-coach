"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setHomeLocationAction } from "@/lib/travels/actions";

export interface HomeLocationLabels {
  cityLabel: string;
  cityPlaceholder: string;
  countryLabel: string;
  save: string;
  saved: string;
}

/**
 * Edit the user's home city + country. Used both in Settings and in the
 * Travels first-run prompt (pre-filled with the auto-detected guess).
 */
export function HomeLocationForm({
  initialCity,
  initialCountry,
  countryOptions,
  labels,
  saveLabel,
}: {
  initialCity: string | null;
  initialCountry: string | null;
  countryOptions: { code: string; name: string }[];
  labels: HomeLocationLabels;
  /** Override the button text (e.g. "Confirm" on the first-run prompt). */
  saveLabel?: string;
}) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity ?? "");
  const [country, setCountry] = useState(initialCountry ?? countryOptions[0]?.code ?? "ES");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await setHomeLocationAction(city, country);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[color:var(--text-secondary)]">
          {labels.cityLabel}
        </span>
        <Input
          value={city}
          onChange={(e) => setCity(e.currentTarget.value)}
          placeholder={labels.cityPlaceholder}
          className="h-9 w-44"
          aria-label={labels.cityLabel}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="home-country"
          className="text-[12px] font-medium text-[color:var(--text-secondary)]"
        >
          {labels.countryLabel}
        </label>
        <select
          id="home-country"
          value={country}
          onChange={(e) => setCountry(e.currentTarget.value)}
          className="h-9 w-52 rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 text-sm text-[color:var(--text-primary)]"
        >
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" onClick={save} disabled={pending} className="h-9">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {saved ? <Check className="h-4 w-4" /> : null}
        {saveLabel ?? labels.save}
      </Button>
    </div>
  );
}
