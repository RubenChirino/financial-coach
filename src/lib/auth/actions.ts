"use server";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { deriveEncryptionKey, generateSalt, hashPin, verifyPin } from "@/lib/crypto";
import { env } from "@/lib/env";
import { type Locale, isLocale } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/locale";
import { checkAttempt, recordFailure, recordSuccess } from "@/lib/security/rate-limit";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE } from "./constants";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  enterGuestMode,
  getCurrentSession,
  setSessionCookie,
} from "./session";
import { getUser, userExists } from "./user";

/**
 * PIN policy (updated 2026-04-20 for Phase 7c):
 *   - New PINs (setup): exactly 4 digits — the Coin redesign standardises
 *     on a 4-digit PinPad, and security relies on PBKDF2 + session
 *     rate-limiting rather than PIN entropy.
 *   - Unlock: digits only, >=4 characters. Looser than setup so any
 *     pre-7c user with a legacy 6+ digit PIN can still sign in (the new UI
 *     will need a pre-migration flow to collect those — until then, legacy
 *     users must reset via Settings). New users will only ever enter 4
 *     digits through the pad.
 */
const PinSetupSchema = z
  .string()
  .regex(/^\d{4}$/, "mustBeDigits")
  .length(4, "invalidLength");
const PinUnlockSchema = z.string().regex(/^\d+$/, "mustBeDigits").min(4, "invalidLength");

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function setupPinAction(formData: FormData): Promise<ActionResult> {
  const pin = String(formData.get("pin") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const language = String(formData.get("language") ?? "es");

  if (!isLocale(language)) return { ok: false, error: "invalidLanguage" };
  const parsed = PinSetupSchema.safeParse(pin);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  if (pin !== confirm) return { ok: false, error: "mismatch" };

  if (await userExists()) return { ok: false, error: "alreadySetup" };

  const pinSalt = generateSalt();
  const encryptionSalt = generateSalt();
  const pinHash = hashPin(pin, pinSalt);
  const { APP_SECRET } = env();

  const inserted = await db
    .insert(users)
    .values({
      pinHash,
      pinSalt,
      encryptionSalt,
      language: language as Locale,
      currency: "EUR",
      llmProvider: "ollama",
      llmModel: "qwen2.5:14b-instruct-q4_K_M",
    })
    .returning({ id: users.id });

  const userId = inserted[0]?.id;
  if (!userId) return { ok: false, error: "insertFailed" };

  const encryptionKey = deriveEncryptionKey(pin, APP_SECRET, encryptionSalt);
  const token = await createSession(userId, encryptionKey);
  await setSessionCookie(token);
  await setLocale(language);

  return { ok: true };
}

/**
 * Bucket name for the PIN-unlock rate limiter. Single-user app → single
 * bucket. If this ever becomes multi-user, key by user id instead.
 */
const PIN_UNLOCK_BUCKET = "pin-unlock";

export async function unlockWithPinAction(formData: FormData): Promise<ActionResult> {
  // Backoff gate: refuse to even hash the candidate PIN if the bucket is
  // locked out. This prevents an attacker from chewing CPU on PBKDF2 in a
  // tight loop — the wall-clock barrier is the actual brute-force defense
  // for a 4-digit PIN (10k combo space).
  const decision = checkAttempt(PIN_UNLOCK_BUCKET);
  if (!decision.allowed) {
    return { ok: false, error: "lockedOut" };
  }

  const pin = String(formData.get("pin") ?? "");
  const parsed = PinUnlockSchema.safeParse(pin);
  if (!parsed.success) {
    recordFailure(PIN_UNLOCK_BUCKET);
    return { ok: false, error: "wrongPin" };
  }

  const user = await getUser();
  if (!user) return { ok: false, error: "notSetup" };

  // OAuth-only users have no PIN — bail with the same generic "wrongPin"
  // error to avoid leaking which auth mode the user signed up under.
  if (!user.pinHash || !user.pinSalt) {
    recordFailure(PIN_UNLOCK_BUCKET);
    return { ok: false, error: "wrongPin" };
  }

  if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
    recordFailure(PIN_UNLOCK_BUCKET);
    return { ok: false, error: "wrongPin" };
  }

  recordSuccess(PIN_UNLOCK_BUCKET);

  const { APP_SECRET } = env();
  const encryptionKey = deriveEncryptionKey(pin, APP_SECRET, user.encryptionSalt);
  const token = await createSession(user.id, encryptionKey);
  await setSessionCookie(token);

  return { ok: true };
}

export async function lockAction(): Promise<void> {
  // OAuth-mode sign-out goes through Auth.js so it can clear the JWT cookie
  // and (in providers that support it) the upstream session. PIN-mode
  // sign-out destroys our DB session row and clears `fc_session`.
  if (env().AUTH_MODE === "oauth") {
    const { signOut } = await import("./oauth-config");
    await signOut({ redirectTo: "/lock" });
    return;
  }

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  await clearSessionCookie();
  redirect("/lock");
}

/**
 * Start an ephemeral read-only guest session and drop the user on the dashboard
 * with `?guest=1` so the "nothing is saved" notice shows. OAuth mode only.
 */
export async function enterGuestModeAction(): Promise<void> {
  if (env().AUTH_MODE !== "oauth") redirect("/lock");
  await enterGuestMode();
  redirect("/?guest=1");
}

export async function changeLanguageAction(language: string): Promise<ActionResult> {
  if (!isLocale(language)) return { ok: false, error: "invalidLanguage" };
  const session = await getCurrentSession();
  await setLocale(language);
  if (session) {
    await db
      .update(users)
      .set({ language, updatedAt: new Date() })
      .where(eq(users.id, session.userId));
  }
  return { ok: true };
}
