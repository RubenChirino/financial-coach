"use client";
import { PinDots } from "@/components/pin/pin-dots";
import { PinPad } from "@/components/pin/pin-pad";
import { Button } from "@/components/ui/button";
import { unlockWithPinAction } from "@/lib/auth/actions";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const PIN_LENGTH = 4;
const MAX_TRIES = 5;

interface LockFormProps {
  redirectTo: string;
}

/**
 * PIN unlock with on-screen pad.
 *
 * Behavior:
 *   - Auto-submits the moment the 4th digit lands.
 *   - On wrong PIN: shakes the dots (400ms), clears input, decrements a
 *     tries counter. After MAX_TRIES consecutive failures the pad is
 *     disabled until the user closes/reopens the app (server-side
 *     rate-limiting is the real defense; this is UX guard-rail only).
 *   - Biometric button is a placeholder — on web there's no platform API we
 *     want to lean on yet; it submits via the existing PIN path only when
 *     wired to a native shell.
 */
export function LockForm({ redirectTo }: LockFormProps) {
  const t = useTranslations("lock");
  const tPin = useTranslations("onboarding.pin");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const lockedOut = tries >= MAX_TRIES;

  function submit(finalPin: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("pin", finalPin);
      const result = await unlockWithPinAction(fd);
      if (!result.ok) {
        const nextTries = tries + 1;
        setTries(nextTries);
        const remaining = MAX_TRIES - nextTries;
        setError(
          remaining <= 0
            ? t("lockedOut")
            : remaining <= 2
              ? t("triesLeft", { count: remaining })
              : t("wrongPin"),
        );
        setPin("");
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    });
  }

  function onDigit(digit: number) {
    if (lockedOut || isPending) return;
    setError(null);
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => submit(next), 180);
    }
  }

  function onBackspace() {
    if (lockedOut || isPending) return;
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="space-y-4">
      <PinDots filled={pin.length} error={!!error} />
      <div className="h-5 text-center text-[13px] text-[color:var(--destructive)]">
        {error ?? " "}
      </div>

      <PinPad
        onKey={onDigit}
        onDelete={onBackspace}
        biometricLabel={tPin("biometric")}
        disabled={lockedOut || isPending}
      />

      {lockedOut ? (
        <Button
          type="button"
          className="w-full justify-center mt-4"
          size="lg"
          onClick={() => {
            setTries(0);
            setError(null);
          }}
          variant="outline"
        >
          {t("unlock")}
        </Button>
      ) : null}
    </div>
  );
}
