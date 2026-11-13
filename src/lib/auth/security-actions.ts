"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  CryptoError,
  derivePinKek,
  generateSalt,
  hashPin,
  verifyPin,
  wrapDataKey,
} from "@/lib/crypto";
import { env } from "@/lib/env";
import { pinKeySource, readDataKey } from "./keys";
import {
  clearSessionCookie,
  getCurrentSession,
  replaceSessionsIfPinHash,
  setSessionCookie,
} from "./session";
import { getUser } from "./user";
import { wipeLocalInstallation } from "./wipe";

const PinDigits = z.string().regex(/^\d{4}$/, "invalidPin");

export interface SecurityActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Change the PIN without touching any ciphertext (envelope encryption, see
 * `./keys.ts`): the data key stays the same and is only re-wrapped under the
 * new PIN's KEK, so bank links and every encrypted column stay readable.
 *
 * Flow:
 *   1. Verify the current PIN against the stored hash.
 *   2. Unwrap the data key with the current PIN's KEK (a legacy user's data
 *      key is the one derived from the current PIN).
 *   3. One batch: set the new PIN hash, salt and wrapped key — guarded by the
 *      old PIN hash — then replace this user's sessions with a new one. The
 *      session statements are guarded by the new hash, so if a concurrent
 *      change won, nothing in the batch applies.
 */
export async function changePinAction(formData: FormData): Promise<SecurityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "notAuthenticated" };
  // PIN-mode only. `destroyAllSessions()` below is global — in a multi-user
  // (oauth) deployment it would sign every other user out. See the note on
  // `deleteAllDataAction` for why we gate on the mode rather than on whether
  // this particular caller happens to have a PIN.
  if (env().AUTH_MODE === "oauth" || session.isGuest) {
    return { ok: false, error: "notAvailable" };
  }

  const currentPin = String(formData.get("currentPin") ?? "");
  const newPin = String(formData.get("newPin") ?? "");
  const confirmPin = String(formData.get("confirmPin") ?? "");

  if (!PinDigits.safeParse(currentPin).success) return { ok: false, error: "invalidPin" };
  if (!PinDigits.safeParse(newPin).success) return { ok: false, error: "invalidNewPin" };
  if (newPin !== confirmPin) return { ok: false, error: "mismatch" };
  if (currentPin === newPin) return { ok: false, error: "samePin" };

  const user = await getUser();
  if (!user) return { ok: false, error: "notAuthenticated" };

  // OAuth users don't have a PIN to change. This action is only wired into
  // the PIN settings UI which is hidden in oauth mode, but be defensive in
  // case it's ever called directly.
  if (!user.pinHash || !user.pinSalt) {
    return { ok: false, error: "pinNotConfigured" };
  }

  if (!verifyPin(currentPin, user.pinSalt, user.pinHash)) {
    return { ok: false, error: "wrongPin" };
  }

  let dataKey: Buffer;
  try {
    dataKey = readDataKey(pinKeySource(user, currentPin));
  } catch (err) {
    if (!(err instanceof CryptoError)) throw err;
    console.error("data key unavailable for user", user.id, err.message);
    return { ok: false, error: "keyUnavailable" };
  }

  const newPinSalt = generateSalt();
  const newPinHash = hashPin(newPin, newPinSalt);
  const wrappedDek = wrapDataKey(
    dataKey,
    derivePinKek(newPin, env().APP_SECRET, user.encryptionSalt),
    user.id,
  );
  const next = replaceSessionsIfPinHash(user.id, dataKey, newPinHash);
  const [changed] = await db.batch([
    db
      .update(users)
      .set({ pinHash: newPinHash, pinSalt: newPinSalt, wrappedDek, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.pinHash, user.pinHash)))
      .returning({ id: users.id }),
    next.revoke,
    next.insert,
  ]);
  // The PIN changed between verification and the batch: nothing applied.
  if (changed.length === 0) return { ok: false, error: "wrongPin" };

  await setSessionCookie(next.token);

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Nuclear "delete all my data" action.
 *
 * Requires the current PIN as a confirmation gate. Deletes the user row
 * (cascades through all foreign keys — accounts, transactions, institutions
 * via requisitions, goals, insights, categories rules, advisor conversations,
 * sessions). Clears the session cookie. Redirects to /onboarding.
 *
 * SINGLE-USER (local/PIN) MODE ONLY. The cleanup pass at the bottom issues
 * unscoped `DELETE FROM <table>` statements — correct on a self-hosted install
 * where the one user *is* the database, catastrophic on a shared oauth
 * deployment where it would erase every other user's financial history. The
 * PIN check alone is not a sufficient guard: it only holds while no PIN-bearing
 * row can exist in an oauth database, which a local→hosted migration would
 * break. Gate on the mode, exactly like `/api/backup` and `/api/backup/restore`.
 */
export async function deleteAllDataAction(formData: FormData): Promise<SecurityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "notAuthenticated" };
  if (env().AUTH_MODE === "oauth" || session.isGuest) {
    return { ok: false, error: "notAvailable" };
  }

  const pin = String(formData.get("pin") ?? "");
  if (!PinDigits.safeParse(pin).success) return { ok: false, error: "invalidPin" };

  const user = await getUser();
  if (!user) return { ok: false, error: "notAuthenticated" };

  // OAuth users have no PIN — this delete-everything action is gated behind
  // the PIN settings UI which is hidden in oauth mode. Defensive check.
  if (!user.pinHash || !user.pinSalt) {
    return { ok: false, error: "pinNotConfigured" };
  }

  if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
    return { ok: false, error: "wrongPin" };
  }

  await wipeLocalInstallation(user.id);

  await clearSessionCookie();
  redirect("/onboarding");
}
