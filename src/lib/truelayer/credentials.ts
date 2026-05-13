import "server-only";

import { db } from "@/db/client";
import { providerCredentials } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { and, eq } from "drizzle-orm";
import type { TrueLayerCredentials } from "./client";

const PROVIDER = "truelayer";

interface StoredCreds {
  clientId: string;
  clientSecret: string;
  environment?: "sandbox" | "live";
}

/**
 * Load TrueLayer credentials for this user. Mirrors the GoCardless loader:
 * prefers the encrypted DB row, falls back to env vars for BYOK via `.env.local`.
 */
export async function loadTrueLayerCredentials(
  userId: number,
  encryptionKey: Buffer,
): Promise<TrueLayerCredentials | null> {
  const row = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, PROVIDER)))
    .limit(1);

  const stored = row[0];
  if (stored) {
    const raw = decrypt(stored.encryptedKey, encryptionKey);
    const parsed = JSON.parse(raw) as StoredCreds;
    if (parsed.clientId && parsed.clientSecret) {
      return {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        environment: parsed.environment ?? "sandbox",
      };
    }
  }

  const { TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET, TRUELAYER_ENVIRONMENT } = env();
  if (TRUELAYER_CLIENT_ID && TRUELAYER_CLIENT_SECRET) {
    return {
      clientId: TRUELAYER_CLIENT_ID,
      clientSecret: TRUELAYER_CLIENT_SECRET,
      environment: TRUELAYER_ENVIRONMENT,
    };
  }
  return null;
}

export async function saveTrueLayerCredentials(
  userId: number,
  encryptionKey: Buffer,
  creds: TrueLayerCredentials,
): Promise<void> {
  const payload = JSON.stringify({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    environment: creds.environment,
  } satisfies StoredCreds);
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

export async function deleteTrueLayerCredentials(userId: number): Promise<void> {
  await db
    .delete(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, PROVIDER)));
}
