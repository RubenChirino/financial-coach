"use client";

import { Button } from "@/components/ui/button";
import type {
  AgeRange,
  Dependents,
  EmergencyFund,
  Horizon,
  InvestorProfile,
  PrimaryGoal,
  RiskTolerance,
} from "@/lib/opportunities/profile-types";
import {
  AGE_RANGES,
  DEPENDENTS_OPTIONS,
  EMERGENCY_FUND_OPTIONS,
  HORIZONS,
  PRIMARY_GOALS,
  RISK_TOLERANCES,
} from "@/lib/opportunities/profile-types";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveInvestorProfileAction } from "./actions";

export interface ProfileFormLabels {
  intro: string;
  saveButton: string;
  saving: string;
  saved: string;
  noteLabel: string;
  notePlaceholder: string;
  errorGeneric: string;
  questions: {
    ageRange: string;
    horizon: string;
    riskTolerance: string;
    emergencyFundMonths: string;
    dependents: string;
    primaryGoal: string;
  };
  ageRange: Record<AgeRange, string>;
  horizon: Record<Horizon, string>;
  riskTolerance: Record<RiskTolerance, string>;
  emergencyFundMonths: Record<EmergencyFund, string>;
  dependents: Record<Dependents, string>;
  primaryGoal: Record<PrimaryGoal, string>;
}

const DEFAULT_PROFILE: InvestorProfile = {
  ageRange: "25_34",
  horizon: "3_7y",
  riskTolerance: "hold",
  emergencyFundMonths: "under_3",
  dependents: "none",
  primaryGoal: "emergency_fund",
  note: null,
};

export function ProfileForm({
  initial,
  labels,
}: {
  initial: InvestorProfile | null;
  labels: ProfileFormLabels;
}) {
  const [profile, setProfile] = useState<InvestorProfile>(initial ?? DEFAULT_PROFILE);
  const [pending, start] = useTransition();
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof InvestorProfile>(key: K, value: InvestorProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
    setSavedOk(false);
  }

  function submit() {
    setError(null);
    setSavedOk(false);
    start(async () => {
      const res = await saveInvestorProfileAction(profile);
      if (res.ok) setSavedOk(true);
      else setError(labels.errorGeneric);
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-[color:var(--text-tertiary)]">{labels.intro}</p>

      <Question
        label={labels.questions.ageRange}
        value={profile.ageRange}
        options={AGE_RANGES.map((v) => ({ value: v, label: labels.ageRange[v] }))}
        onChange={(v) => update("ageRange", v as AgeRange)}
      />
      <Question
        label={labels.questions.horizon}
        value={profile.horizon}
        options={HORIZONS.map((v) => ({ value: v, label: labels.horizon[v] }))}
        onChange={(v) => update("horizon", v as Horizon)}
      />
      <Question
        label={labels.questions.riskTolerance}
        value={profile.riskTolerance}
        options={RISK_TOLERANCES.map((v) => ({ value: v, label: labels.riskTolerance[v] }))}
        onChange={(v) => update("riskTolerance", v as RiskTolerance)}
      />
      <Question
        label={labels.questions.emergencyFundMonths}
        value={profile.emergencyFundMonths}
        options={EMERGENCY_FUND_OPTIONS.map((v) => ({
          value: v,
          label: labels.emergencyFundMonths[v],
        }))}
        onChange={(v) => update("emergencyFundMonths", v as EmergencyFund)}
      />
      <Question
        label={labels.questions.dependents}
        value={profile.dependents}
        options={DEPENDENTS_OPTIONS.map((v) => ({ value: v, label: labels.dependents[v] }))}
        onChange={(v) => update("dependents", v as Dependents)}
      />
      <Question
        label={labels.questions.primaryGoal}
        value={profile.primaryGoal}
        options={PRIMARY_GOALS.map((v) => ({ value: v, label: labels.primaryGoal[v] }))}
        onChange={(v) => update("primaryGoal", v as PrimaryGoal)}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="profile-note"
          className="block text-[12px] font-medium text-[color:var(--text-secondary)]"
        >
          {labels.noteLabel}
        </label>
        <textarea
          id="profile-note"
          value={profile.note ?? ""}
          onChange={(e) => update("note", e.target.value || null)}
          placeholder={labels.notePlaceholder}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-[color:var(--border-default)] bg-background px-3 py-2 text-[13px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {savedOk ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {labels.saved}
          </span>
        ) : null}
        {error ? (
          <span className="text-[12.5px] text-red-600 dark:text-red-400">{error}</span>
        ) : null}
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {pending ? labels.saving : labels.saveButton}
        </Button>
      </div>
    </div>
  );
}

function Question({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="block text-[12px] font-medium text-[color:var(--text-secondary)]">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                selected
                  ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]"
                  : "border-[color:var(--border-default)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
