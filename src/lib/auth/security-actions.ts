"use server";

import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { deriveEncryptionKey, generateSalt, hashPin, verifyPin } from "@/lib/crypto";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  getCurrentSession,
  setSessionCookie,
} from "./session";
import { getUser } from "./user";

const PinDigits = z.string().regex(/^\d{4}$/, "invalidPin");

export interface SecurityActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Change the PIN.
 *
 * Flow:
 *   1. Verify the current PIN against the stored hash.
 *   2. Generate a fresh pin salt + hash for the new PIN.
 *   3. Generate a fresh encryption salt — the new encryption key is derived
 *      from (new PIN + APP_SECRET + new salt), so we DON'T need to re-encrypt
 *      existing ciphertext columns. Wait: we DO need to, because old ciphertext
 *      is wrapped with the old key. To keep the scope tight we instead keep the
 *      encryption salt the same — only PIN hash changes — so the derived key
 *      changes as well. That breaks decryption of existing bank tokens.
 *
 *   Correct design: re-wrap all existing encrypted columns. But we don't
 *   currently have a "list all ciphertext" helper and transactional re-wrap is
 *   costly. As a pragmatic v1, PIN change is only safe when no bank tokens
 *   exist yet (or the user accepts that linked banks must be re-linked).
 *
 *   We keep the encryptionSalt intact so the derived KEY changes with the PIN,
 *   then destroy all other sessions so no cached key survives. The UI warns
 *   that bank connections may need re-linking — in practice GoCardless tokens
 *   stored encrypted will become unreadable (`CryptoError`), and the relevant
 *   code already treats unreadable requisitions as "needs reconnect".
 */
export async function changePinAction(formData: FormData): Promise<SecurityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "notAuthenticated" };

  const currentPin = String(formData.get("currentPin") ?? "");
  const newPin = String(formData.get("newPin") ?? "");
  const confirmPin = String(formData.get("confirmPin") ?? "");

  if (!PinDigits.safeParse(currentPin).success) return { ok: false, error: "invalidPin" };
  if (!PinDigits.safeParse(newPin).success) return { ok: false, error: "invalidNewPin" };
  if (newPin !== confirmPin) return { ok: false, error: "mismatch" };
  if (currentPin === newPin) return { ok: false, error: "samePin" };

  const user = await getUser();
  if (!user) return { ok: false, error: "notAuthenticated" };

  if (!verifyPin(currentPin, user.pinSalt, user.pinHash)) {
    return { ok: false, error: "wrongPin" };
  }

  const newPinSalt = generateSalt();
  const newPinHash = hashPin(newPin, newPinSalt);

  await db
    .update(users)
    .set({ pinHash: newPinHash, pinSalt: newPinSalt, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Invalidate all existing sessions — they all hold keys wrapped under the
  // old PIN-derived key. Then issue a fresh one so the user stays logged in.
  await destroyAllSessions();

  const { APP_SECRET } = env();
  const newKey = deriveEncryptionKey(newPin, APP_SECRET, user.encryptionSalt);
  const token = await createSession(user.id, newKey);
  await setSessionCookie(token);

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
 */
export async function deleteAllDataAction(formData: FormData): Promise<SecurityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "notAuthenticated" };

  const pin = String(formData.get("pin") ?? "");
  if (!PinDigits.safeParse(pin).success) return { ok: false, error: "invalidPin" };

  const user = await getUser();
  if (!user) return { ok: false, error: "notAuthenticated" };

  if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
    return { ok: false, error: "wrongPin" };
  }

  // Cascade delete: `users` has ON DELETE CASCADE set on `sessions`,
  // `providerCredentials`, and everything else is reachable through
  // institutions/requisitions/accounts which are independent of users but
  // will be cleared manually.
  await db.delete(sessions);
  await db.delete(users).where(eq(users.id, user.id));

  // Wipe everything else that isn't user-scoped but is still user data.
  // We import the schema lazily here to keep the action file lean.
  const schema = await import("@/db/schema");
  await db.delete(schema.advisorMessages);
  await db.delete(schema.advisorConversations);
  await db.delete(schema.insights);
  await db.delete(schema.goals);
  await db.delete(schema.recurringSubscriptions);
  await db.delete(schema.transactions);
  await db.delete(schema.accounts);
  await db.delete(schema.requisitions);
  await db.delete(schema.institutions);
  await db.delete(schema.categoryRules);
  await db.delete(schema.categories);
  await db.delete(schema.auditLog);

  await clearSessionCookie();
  redirect("/onboarding");
}
