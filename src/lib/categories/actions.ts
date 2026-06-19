"use server";

import { db } from "@/db/client";
import { budgets } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface SetBudgetResult {
  ok: boolean;
  error?: string;
}

/**
 * Store this user's monthly budget for a category as integer cents. `null`
 * clears the budget (deletes the row). Rejects negatives — budgets are always
 * positive amounts. Budgets are per-user, keyed by `(userId, categoryId)`.
 */
export async function setCategoryBudgetAction(
  categoryId: number,
  budgetCents: number | null,
): Promise<SetBudgetResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  if (budgetCents != null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
    return { ok: false, error: "invalidBudget" };
  }

  if (budgetCents == null) {
    await db
      .delete(budgets)
      .where(and(eq(budgets.userId, session.userId), eq(budgets.categoryId, categoryId)));
  } else {
    await db
      .insert(budgets)
      .values({ userId: session.userId, categoryId, monthlyCents: budgetCents })
      .onConflictDoUpdate({
        target: [budgets.userId, budgets.categoryId],
        set: { monthlyCents: budgetCents, updatedAt: new Date() },
      });
  }

  revalidatePath("/categories");
  revalidatePath("/");
  return { ok: true };
}
