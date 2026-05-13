import "server-only";

import { db } from "@/db/client";
import { providerCredentials } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { and, eq } from "drizzle-orm";
import type { GoCardlessCredentials } from "./client";

const PROVIDER = "gocardless";

interface StoredCreds {
  secretId: string;
  secretKey: string;
}

/**
 * Loads GoCardless credentials for this user. Prefers the encrypted DB row
 * (set interactively via Settings). Falls back to env vars for the "bring
 * your own key via .env.local" flow documented in docs/bank-setup.md.
 */
export async function loadGoCardlessCredentials(
  userId: number,
  encryptionKey: Buffer,
): Promise<GoCardlessCredentials | null> {
  const row = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, PROVIDER)))
    .limit(1);

  const stored = row[0];
  if (stored) {
    const raw = decrypt(stored.encryptedKey, encryptionKey);
    const parsed = JSON.parse(raw) as StoredCreds;
    if (parsed.secretId && parsed.secretKey) {
      return { secretId: parsed.secretId, secretKey: parsed.secretKey };
    }
  }

  const { GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY } = env();
  if (GOCARDLESS_SECRET_ID && GOCARDLESS_SECRET_KEY) {
    return { secretId: GOCARDLESS_SECRET_ID, secretKey: GOCARDLESS_SECRET_KEY };
  }
  return null;
}

export async function saveGoCardlessCredentials(
  userId: number,
  encryptionKey: Buffer,
  creds: GoCardlessCredentials,
): Promise<void> {
  const payload = JSON.stringify({ secretId: creds.secretId, secretKey: creds.secretKey });
  const ciphertext = encrypt(payload, encryptionKey);
  const existing = await db
    .select({ id: providerCredentials.id })
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, PROVIDER)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(providerCredentials)
      .set({ encryptedKey: ciphertext, updatedAt: new Date() })
      .where(eq(providerCredentials.id, existing[0].id));
    return;
  }
  await db.insert(providerCredentials).values({
    userId,
    provider: PROVIDER,
    encryptedKey: ciphertext,
  });
}

export async function deleteGoCardlessCredentials(userId: number): Promise<void> {
  await db
    .delete(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, PROVIDER)));
}
