import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { CryptoError, decrypt, deriveKey, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { INACTIVITY_MS, SESSION_COOKIE } from "./constants";

export { INACTIVITY_MS, SESSION_COOKIE };

/**
 * Session store — persisted to SQLite.
 *
 * The earlier implementation kept sessions in a process-local `Map`. That
 * works fine in production (one Node process, stable lifetime) but was the
 * root cause of the "enter correct PIN, get bounced back to /lock" bug in
 * dev: Next.js HMR re-evaluates the module, the Map is reset, and the
 * cookie the browser just received becomes orphaned. First post-restart
 * request redirects to /lock → user re-enters PIN → same thing happens on
 * the next HMR trigger.
 *
 * Now we persist session rows in the DB and derive the cookie value from a
 * cryptographically-random token. Security posture:
 *   - The raw token is stored hashed (SHA-256) so DB theft alone doesn't
 *     yield a usable cookie.
 *   - The PIN-derived encryption key is wrapped with an APP_SECRET-derived
 *     key, so unwrapping requires knowledge of APP_SECRET (which lives in
 *     `.env`, outside the DB).
 *   - Inactivity expiry still applies (INACTIVITY_MS); stale rows are
 *     deleted on access and can be pruned on sign-out.
 *
 * Threat model note: this is no weaker than the in-memory version for the
 * "stolen laptop" case — anyone with both the DB and .env already had the
 * ability to read ciphertext via `deriveEncryptionKey(PIN,...)` if they
 * could also guess the PIN. What we explicitly don't protect against is a
 * leak of DB + APP_SECRET to a remote attacker: they can decrypt active
 * sessions' encryption keys. The PIN still gates *creating* new sessions.
 */

export interface SessionData {
  userId: number;
  encryptionKey: Buffer;
  createdAt: number;
  lastActivityAt: number;
}

function now(): number {
  return Date.now();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let wrapKeyCache: Buffer | null = null;

/**
 * Key used to wrap per-session encryption keys at rest. Derived once from
 * APP_SECRET + a fixed label so multiple sessions share the same wrapping
 * key — we're not trying to be fancy here, just to avoid plaintext on disk.
 */
function wrapKey(): Buffer {
  if (wrapKeyCache) return wrapKeyCache;
  const { APP_SECRET } = env();
  wrapKeyCache = deriveKey(APP_SECRET, "financial-coach::session-wrap::v1");
  return wrapKeyCache;
}

function wrapEncryptionKey(ek: Buffer): string {
  return encrypt(ek.toString("base64"), wrapKey());
}

function unwrapEncryptionKey(wrapped: string): Buffer | null {
  try {
    const b64 = decrypt(wrapped, wrapKey());
    return Buffer.from(b64, "base64");
  } catch (err) {
    if (err instanceof CryptoError) return null;
    throw err;
  }
}

export async function createSession(userId: number, encryptionKey: Buffer): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const nowDate = new Date();
  await db.insert(sessions).values({
    tokenHash,
    userId,
    wrappedKey: wrapEncryptionKey(encryptionKey),
    createdAt: nowDate,
    lastActivityAt: nowDate,
  });
  return token;
}

export async function getSessionByToken(token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) return null;

  const lastActivity = row.lastActivityAt.getTime();
  if (now() - lastActivity > INACTIVITY_MS) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  const encryptionKey = unwrapEncryptionKey(row.wrappedKey);
  if (!encryptionKey) {
    // APP_SECRET rotated or row corrupted — kill the session so the user
    // re-authenticates with a fresh wrapping.
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  const nowDate = new Date();
  await db
    .update(sessions)
    .set({ lastActivityAt: nowDate })
    .where(eq(sessions.tokenHash, tokenHash));

  return {
    userId: row.userId,
    encryptionKey,
    createdAt: row.createdAt.getTime(),
    lastActivityAt: nowDate.getTime(),
  };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function destroyAllSessions(): Promise<void> {
  await db.delete(sessions);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentSession(): Promise<SessionData | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return getSessionByToken(token);
}
