"use server";

import { db } from "@/db/client";
import { recurringSubscriptions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { detectRecurringSubscriptions } from "./detect";

export interface ActionResult {
  ok: boolean;
  error?: string;
  detected?: number;
}

/**
 * Trigger recurring detection from the UI. Auth-gated. Idempotent.
 *
 * Revalidates the dashboard + subscriptions pages so newly-found subs show up
 * without a manual reload.
 */
export async function runRecurringDetectionAction(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  const detected = await detectRecurringSubscriptions({ userId: session.userId });
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true, detected: detected.length };
}

/**
 * Manually toggle a subscription's active state. Useful when the detector
 * misclassifies a one-off as recurring, or when the user cancels a service
 * but the detector hasn't picked up the gap yet.
 */
export async function setSubscriptionActiveAction(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  await db
    .update(recurringSubscriptions)
    .set({ isActive })
    .where(
      and(eq(recurringSubscriptions.id, id), eq(recurringSubscriptions.userId, session.userId)),
    );
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}
