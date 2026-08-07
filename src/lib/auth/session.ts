import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import {
  CryptoError,
  decrypt,
  deriveKey,
  deriveOAuthEncryptionKey,
  encrypt,
  generateSalt,
} from "@/lib/crypto";
import { env } from "@/lib/env";
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
  /** True for an ephemeral, read-only "try it" guest session (OAuth mode). */
  isGuest?: boolean;
}

function now(): number {
  return Date.now();
}

/** Thrown by `assertWritable()` when a read-only guest attempts a mutation. */
export class GuestReadOnlyError extends Error {
  constructor() {
    super("guestReadOnly");
    this.name = "GuestReadOnlyError";
  }
}

/** True when the current session is a read-only guest. */
export async function isGuestSession(): Promise<boolean> {
  return !!(await getCurrentSession())?.isGuest;
}

/**
 * Guard for write paths: throws `GuestReadOnlyError` for guest sessions so a
 * read-only guest can never mutate the shared data. Actions that return a
 * result object should prefer `isGuestSession()` + a typed error instead.
 */
export async function assertWritable(): Promise<void> {
  if (await isGuestSession()) throw new GuestReadOnlyError();
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

/** Cookie without `maxAge` → a session cookie the browser drops when it closes. */
async function setEphemeralSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Start an ephemeral, read-only guest session (OAuth mode "try it" flow).
 *
 * Creates a throwaway `users` row (`isGuest = true`) and a DB session, then
 * sets a session-only cookie so the access disappears when the browser closes.
 * Guests can't write (see `assertWritable`), so the row never accumulates data;
 * stale guest rows are best-effort purged on each new guest. Returns nothing —
 * the caller redirects into the app.
 */
export async function enterGuestMode(): Promise<void> {
  await purgeStaleGuests();

  const encryptionSalt = generateSalt();
  const inserted = await db
    .insert(users)
    .values({ encryptionSalt, isGuest: true, name: "Guest" })
    .returning({ id: users.id });
  const userId = inserted[0]!.id;

  const key = deriveOAuthEncryptionKey(env().APP_SECRET, encryptionSalt);
  const token = await createSession(userId, key);
  await setEphemeralSessionCookie(token);
}

/** Delete guest accounts (and, via cascade, their sessions) older than the TTL. */
async function purgeStaleGuests(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - GUEST_TTL_MS);
    await db.delete(users).where(and(eq(users.isGuest, true), lt(users.createdAt, cutoff)));
  } catch (err) {
    console.warn("guest purge failed", err);
  }
}

export async function getCurrentSession(): Promise<SessionData | null> {
  // OAuth mode: defer to Auth.js's JWT session. The userId travels on the
  // token; we derive the encryption key on-demand from APP_SECRET + the
  // user's stored encryptionSalt (no PIN, no DB session row).
  if (env().AUTH_MODE === "oauth") {
    const oauth = await getOAuthSession();
    if (oauth) return oauth;
    // No OAuth session — fall back to a guest session. In OAuth mode the
    // SESSION_COOKIE is only ever set by "Go as Guest", so any session found
    // here is a guest.
    const store = await cookies();
    const guest = await getSessionByToken(store.get(SESSION_COOKIE)?.value);
    return guest ? { ...guest, isGuest: true } : null;
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return getSessionByToken(token);
}

/**
 * OAuth-mode equivalent of `getSessionByToken`. Reads Auth.js's JWT-decoded
 * session, fetches the user's `encryptionSalt` from the DB, derives the
 * per-user AES key, and returns a `SessionData` shaped identically to the
 * PIN-mode path so downstream callers (server actions, API routes, pages)
 * don't need to branch.
 *
 * Returns null when:
 *   - no Auth.js session cookie / unauthenticated
 *   - the JWT carries no `userId` (shouldn't happen if signIn callback ran)
 *   - the referenced user row was deleted between JWT issue and now
 */
async function getOAuthSession(): Promise<SessionData | null> {
  // Lazy import: the oauth-config module triggers Auth.js initialization and
  // requires AUTH_SECRET + provider creds. Importing it at module top would
  // crash local-mode boot.
  const { auth } = await import("./oauth-config");
  const authSession = await auth();
  const userId = authSession?.user?.userId;
  if (typeof userId !== "number") return null;

  const row = await db
    .select({ encryptionSalt: users.encryptionSalt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userRow = row[0];
  if (!userRow) return null;

  const { APP_SECRET } = env();
  const encryptionKey = deriveOAuthEncryptionKey(APP_SECRET, userRow.encryptionSalt);
  const now = Date.now();
  return {
    userId,
    encryptionKey,
    createdAt: now,
    lastActivityAt: now,
  };
}
