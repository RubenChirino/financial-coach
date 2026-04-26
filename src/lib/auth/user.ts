import "server-only";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getUser() {
  const rows = await db.select().from(users).limit(1);
  return rows[0] ?? null;
}

export async function userExists(): Promise<boolean> {
  return (await getUser()) !== null;
}

export async function updateUserLanguage(userId: number, language: "es" | "en"): Promise<void> {
  await db.update(users).set({ language, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateUserCurrency(userId: number, currency: string): Promise<void> {
  await db.update(users).set({ currency, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateUserLlm(
  userId: number,
  llmProvider: "ollama" | "anthropic" | "openai" | "google",
  llmModel: string,
): Promise<void> {
  await db
    .update(users)
    .set({ llmProvider, llmModel, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function recordCloudLlmConsent(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ cloudLlmConsentAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
