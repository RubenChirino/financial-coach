"use server";

import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface SetBudgetResult {
  ok: boolean;
  error?: string;
}

/**
 * Store a monthly budget as integer cents. `null` clears the budget.
 * Rejects negatives — budgets are always positive amounts.
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

  await db
    .update(categories)
    .set({ budgetMonthlyCents: budgetCents })
    .where(eq(categories.id, categoryId));

  revalidatePath("/categories");
  revalidatePath("/");
  return { ok: true };
}
