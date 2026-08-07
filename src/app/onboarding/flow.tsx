"use client";

import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PinDots } from "@/components/pin/pin-dots";
import { PinPad } from "@/components/pin/pin-pad";
import { Button } from "@/components/ui/button";
import { setupPinAction } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

interface Dict {
  app: { name: string; tagline: string };
  welcome: { title: string; subtitle: string };
  language: { title: string; subtitle: string; spanish: string; english: string };
  languageCaption: string;
  pin: {
    setTitle: string;
    setSubtitle: string;
    confirmTitle: string;
    confirmSubtitle: string;
    mismatch: string;
  };
  done: { title: string; subtitle: string; goDashboard: string };
  common: { continue: string; back: string };
}

type Step = "lang" | "pinSet" | "pinConfirm" | "done";
const PIN_LENGTH = 4;

export function OnboardingFlow({ dict, initialLocale }: { dict: Dict; initialLocale: Locale }) {
  const [step, setStep] = useState<Step>("lang");
  const [language, setLanguage] = useState<Locale>(initialLocale);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function finishPin(finalPin: string) {
    const fd = new FormData();
    fd.set("pin", finalPin);
    fd.set("confirm", finalPin);
    fd.set("language", language);
    startTransition(async () => {
      const result = await setupPinAction(fd);
      if (!result.ok) {
        setError(result.error ?? "error");
        // Reset both PINs so the user starts fresh.
        setPin1("");
        setPin2("");
        setStep("pinSet");
        return;
      }
      setError(null);
      setStep("done");
    });
  }

  function onDigit(digit: number, which: "set" | "confirm") {
    setError(null);
    if (which === "set") {
      if (pin1.length >= PIN_LENGTH) return;
      const next = pin1 + digit;
      setPin1(next);
      if (next.length === PIN_LENGTH) {
        // Auto-advance to the confirm step.
        setTimeout(() => {
          setPin2("");
          setStep("pinConfirm");
        }, 200);
      }
    } else {
      if (pin2.length >= PIN_LENGTH) return;
      const next = pin2 + digit;
      setPin2(next);
      if (next.length === PIN_LENGTH) {
        setTimeout(() => {
          if (next === pin1) {
            finishPin(next);
          } else {
            setError(dict.pin.mismatch);
            setPin2("");
          }
        }, 180);
      }
    }
  }

  function onBackspace(which: "set" | "confirm") {
    setError(null);
    if (which === "set") setPin1(pin1.slice(0, -1));
    else setPin2(pin2.slice(0, -1));
  }

  return (
    <div className="min-h-dvh bg-[color:var(--surface-app)] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md coin-card p-8">
        <Brand name={dict.app.name} tagline={dict.app.tagline} />
        <Steps step={step} />

        {step === "lang" && (
          <LanguageScreen
            dict={dict}
            value={language}
            onChange={setLanguage}
            onNext={() => setStep("pinSet")}
          />
        )}

        {step === "pinSet" && (
          <PinStep
            title={dict.pin.setTitle}
            subtitle={dict.pin.setSubtitle}
            pin={pin1}
            length={PIN_LENGTH}
            error={null}
            disabled={isPending}
            onDigit={(d) => onDigit(d, "set")}
            onBackspace={() => onBackspace("set")}
            onBack={() => setStep("lang")}
            backLabel={dict.common.back}
          />
        )}

        {step === "pinConfirm" && (
          <PinStep
            title={dict.pin.confirmTitle}
            subtitle={dict.pin.confirmSubtitle}
            pin={pin2}
            length={PIN_LENGTH}
            error={error}
            disabled={isPending}
            onDigit={(d) => onDigit(d, "confirm")}
            onBackspace={() => onBackspace("confirm")}
            onBack={() => {
              setPin1("");
              setPin2("");
              setError(null);
              setStep("pinSet");
            }}
            backLabel={dict.common.back}
          />
        )}

        {step === "done" && <Done dict={dict} onGo={() => router.replace("/")} />}
      </div>
    </div>
  );
}

function Brand({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-[0_2px_6px_rgba(83,137,255,0.3)]"
        style={{
          background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)",
        }}
      >
        <Sparkles className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-bold tracking-tight">{name}</div>
        <div className="text-[11px] text-[color:var(--text-tertiary)] truncate">{tagline}</div>
      </div>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["lang", "pinSet", "pinConfirm"];
  // `done` is a terminal state outside the stepper — treat it like all-filled.
  const idx = step === "done" ? order.length : order.indexOf(step);
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {order.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-1 flex-1 rounded-full transition-all",
            i < idx
              ? "bg-[color:var(--brand-primary)]"
              : i === idx
                ? "bg-[color:var(--brand-primary)]"
                : "bg-[color:var(--brand-primary-soft)]",
          )}
        />
      ))}
    </div>
  );
}

function LanguageScreen({
  dict,
  value,
  onChange,
  onNext,
}: {
  dict: Dict;
  value: Locale;
  onChange: (l: Locale) => void;
  onNext: () => void;
}) {
  const options: { code: Locale; flag: string; title: string; sub: string }[] = [
    {
      code: "en",
      flag: "🇬🇧",
      title: dict.language.english,
      sub: "United Kingdom / United States",
    },
    {
      code: "es",
      flag: "🇪🇸",
      title: dict.language.spanish,
      sub: "España / Latinoamérica",
    },
  ];

  return (
    <div className="space-y-3">
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
        {dict.welcome.title}
      </h1>
      <p className="text-[14px] text-[color:var(--text-secondary)]">{dict.welcome.subtitle}</p>

      <div className="pt-1 space-y-2">
        {options.map((o) => (
          <button
            key={o.code}
            type="button"
            onClick={() => onChange(o.code)}
            aria-pressed={value === o.code}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
              value === o.code
                ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)]"
                : "border-[color:var(--border-default)] hover:border-[color:var(--brand-primary-border)]",
            )}
          >
            <span className="text-2xl leading-none" aria-hidden>
              {o.flag}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold">{o.title}</span>
              <span className="block text-[12px] text-[color:var(--text-tertiary)] truncate">
                {o.sub}
              </span>
            </span>
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                value === o.code
                  ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white"
                  : "border-[color:var(--border-default)]",
              )}
              aria-hidden
            >
              {value === o.code ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
          </button>
        ))}
      </div>

      <Button onClick={onNext} size="lg" className="w-full justify-center">
        {dict.common.continue}
        <ArrowRight className="h-4 w-4" />
      </Button>

      <p className="pt-3 text-center text-[12px] text-[color:var(--text-tertiary)]">
        {dict.languageCaption}
      </p>
    </div>
  );
}

function PinStep({
  title,
  subtitle,
  pin,
  length,
  error,
  disabled,
  onDigit,
  onBackspace,
  onBack,
  backLabel,
}: {
  title: string;
  subtitle: string;
  pin: string;
  length: number;
  error: string | null;
  disabled?: boolean;
  onDigit: (d: number) => void;
  onBackspace: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="text-[14px] text-[color:var(--text-secondary)]">{subtitle}</p>

      <PinDots filled={pin.length} length={length} error={!!error} />
      <div className="h-5 text-center text-[13px] text-[color:var(--destructive)]">
        {error ?? " "}
      </div>

      <PinPad onKey={onDigit} onDelete={onBackspace} disabled={disabled} />

      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        className="w-full justify-center mt-2"
        disabled={disabled}
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
    </div>
  );
}

function Done({ dict, onGo }: { dict: Dict; onGo: () => void }) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
        <Check className="h-7 w-7" strokeWidth={2.5} />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-[20px] font-semibold tracking-tight">{dict.done.title}</h2>
        <p className="text-[13px] text-[color:var(--text-secondary)]">{dict.done.subtitle}</p>
      </div>
      <Button onClick={onGo} size="lg" className="w-full justify-center">
        {dict.done.goDashboard}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
