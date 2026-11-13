import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  CryptoError,
  deriveEncryptionKey,
  deriveOAuthEncryptionKey,
  deriveOAuthKek,
  derivePinKek,
  unwrapDataKey,
  wrapDataKey,
} from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Data-key resolution (envelope encryption).
 *
 * Every user's columns are encrypted with one data key (DEK). It is stored
 * only wrapped, in `users.wrapped_dek`, under a key-encryption key (KEK):
 *  - PIN mode: `derivePinKek(pin, APP_SECRET, encryption_salt)` (scrypt);
 *  - OAuth mode and guests: `deriveOAuthKek(APP_SECRET, encryption_salt)` (HKDF).
 *
 * States of `wrapped_dek`:
 *  - set: unwrap it. A failure is an error (`CryptoError`) — never a fallback
 *    to the legacy derivation, which would hand out a key that decrypts nothing.
 *  - NULL (users from before envelope encryption): the DEK *is* the key the
 *    legacy derivation yields, so existing ciphertext and open sessions stay
 *    valid. The first successful unlock wraps it and stores it with
 *    `UPDATE … WHERE wrapped_dek IS NULL`; a concurrent first wrap loses that
 *    race and unwraps what the winner stored, so every caller converges.
 *
 * New users and guests get a random DEK at creation (`initialKey` below).
 */

export interface KeySource {
  userId: number;
  wrappedDek: string | null;
  /** Wraps / unwraps this user's DEK. */
  kek: Buffer;
  /** The DEK to adopt while `wrappedDek` is NULL: the legacy key, or a random one. */
  initialKey: () => Buffer;
}

/** The DEK without writing anything: unwrap it, or the initial key while unwrapped. */
export function readDataKey(source: KeySource): Buffer {
  if (source.wrappedDek) return unwrapDataKey(source.wrappedDek, source.kek, source.userId);
  return source.initialKey();
}

/**
 * The DEK, wrapping and storing it first if the user has none stored yet.
 * Throws `CryptoError` when a stored key does not unwrap.
 */
export async function resolveDataKey(source: KeySource): Promise<Buffer> {
  if (source.wrappedDek) return readDataKey(source);

  const dek = source.initialKey();
  const stored = await db
    .update(users)
    .set({ wrappedDek: wrapDataKey(dek, source.kek, source.userId) })
    .where(and(eq(users.id, source.userId), isNull(users.wrappedDek)))
    .returning({ id: users.id });
  if (stored.length > 0) return dek;

  // Another request stored a key first: use that one.
  const [row] = await db
    .select({ wrappedDek: users.wrappedDek })
    .from(users)
    .where(eq(users.id, source.userId))
    .limit(1);
  if (!row?.wrappedDek) throw new CryptoError("data key missing");
  return unwrapDataKey(row.wrappedDek, source.kek, source.userId);
}

interface KeyedUser {
  id: number;
  encryptionSalt: string;
  wrappedDek: string | null;
}

/** Key source for a PIN-mode user, given the PIN they just proved. */
export function pinKeySource(user: KeyedUser, pin: string): KeySource {
  const { APP_SECRET } = env();
  return {
    userId: user.id,
    wrappedDek: user.wrappedDek,
    kek: derivePinKek(pin, APP_SECRET, user.encryptionSalt),
    initialKey: () => deriveEncryptionKey(pin, APP_SECRET, user.encryptionSalt),
  };
}

/** Key source for an OAuth-mode user or a guest. */
export function oauthKeySource(user: KeyedUser): KeySource {
  const { APP_SECRET } = env();
  return {
    userId: user.id,
    wrappedDek: user.wrappedDek,
    kek: deriveOAuthKek(APP_SECRET, user.encryptionSalt),
    initialKey: () => deriveOAuthEncryptionKey(APP_SECRET, user.encryptionSalt),
  };
}
