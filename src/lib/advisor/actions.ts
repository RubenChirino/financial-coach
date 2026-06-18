"use server";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { providerInfo } from "@/lib/llm/provider";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteConversation as dbDeleteConversation } from "./conversations";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function deleteConversationAction(conversationId: number): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  await dbDeleteConversation(conversationId);
  revalidatePath("/advisor");
  return { ok: true };
}

/**
 * Record the user's one-time consent to send (redacted) financial summaries to
 * a cloud LLM provider. Stored as a timestamp; the chat route gates on this
 * being non-null when `LLM_PROVIDER` is anything other than `ollama`.
 *
 * Idempotent: re-calling does not move the timestamp forward.
 */
export async function grantCloudLlmConsentAction(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  const existing = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!existing) return { ok: false, error: "userNotFound" };
  if (existing.cloudLlmConsentAt) {
    return { ok: true };
  }
  await db.update(users).set({ cloudLlmConsentAt: new Date() }).where(eq(users.id, session.userId));
  revalidatePath("/advisor");
  return { ok: true };
}

export async function revokeCloudLlmConsentAction(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  await db.update(users).set({ cloudLlmConsentAt: null }).where(eq(users.id, session.userId));
  revalidatePath("/advisor");
  return { ok: true };
}

export interface ProviderState {
  provider: "ollama" | "anthropic" | "openai" | "google";
  model: string;
  isLocal: boolean;
  consentNeeded: boolean;
}

export async function getAdvisorProviderStateAction(): Promise<ProviderState> {
  const session = await getCurrentSession();
  let u: typeof users.$inferSelect | undefined;
  if (session) {
    u = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  }
  const prefs = u ? { provider: u.llmProvider, model: u.llmModel } : undefined;
  const info = providerInfo(prefs);
  const consentNeeded = !info.isLocal && !!session && !u?.cloudLlmConsentAt;
  return {
    provider: info.provider,
    model: info.model,
    isLocal: info.isLocal,
    consentNeeded,
  };
}
