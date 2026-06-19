import "server-only";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "./session";

/**
 * The user for the current request. When a session exists (always true on
 * authenticated pages, and the only case in OAuth mode) this is strictly the
 * session's own user — never another user's row. The fallback to the sole user
 * applies only pre-session in local/PIN mode (e.g. the PIN-unlock action runs
 * before a session cookie is set), where there is exactly one user anyway.
 */
export async function getUser() {
  const session = await getCurrentSession();
  if (session) {
    const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    return rows[0] ?? null;
  }
  const rows = await db.select().from(users).limit(1);
  return rows[0] ?? null;
}

/**
 * Whether ANY user has been provisioned — a global check, independent of the
 * session, used to gate first-run onboarding in local mode.
 */
export async function userExists(): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
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

export async function updateUserHomeLocation(
  userId: number,
  homeCity: string | null,
  homeCountry: string,
): Promise<void> {
  await db
    .update(users)
    .set({ homeCity, homeCountry, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function recordCloudLlmConsent(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ cloudLlmConsentAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
