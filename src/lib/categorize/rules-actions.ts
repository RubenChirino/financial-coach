"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { categories, categoryRules, transactions } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { recorrectCategories } from "./index";
import { deriveRulePattern, upsertUserRule } from "./rules";

export interface RuleActionResult {
  ok: boolean;
  error?: string;
  /** Number of existing transactions re-categorised by the new rule. */
  applied?: number;
}

/**
 * Learn a rule from a manual correction: "always categorise {merchant} as
 * {category}". Creates (or updates) a per-user `contains` rule, then re-runs the
 * deterministic correction pass so existing matching rows snap to the category
 * immediately. Manual picks (confidence 100) are left untouched by that pass.
 */
export async function createRuleFromTransactionAction(
  txId: number,
  categoryId: number,
): Promise<RuleActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };

  const txRow = await db
    .select({
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, session.userId)))
    .limit(1);
  const tx = txRow[0];
  if (!tx) return { ok: false, error: "transactionNotFound" };

  const cat = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!cat[0]) return { ok: false, error: "categoryNotFound" };

  const pattern = deriveRulePattern(tx.merchantName, tx.rawDescription);
  if (!pattern) return { ok: false, error: "merchantTooShort" };

  await upsertUserRule(session.userId, pattern, categoryId);

  // Apply the new rule to history (deterministic; never touches manual picks).
  const result = await recorrectCategories(session.userId).catch(() => ({
    corrected: 0,
    requeued: 0,
  }));

  revalidatePath("/transactions");
  revalidatePath("/categories");
  revalidatePath("/");
  return { ok: true, applied: result.corrected };
}

export interface UserRule {
  id: number;
  matchPattern: string;
  categoryId: number;
  categorySlug: string;
  categoryNameEs: string;
  categoryNameEn: string;
  categoryIcon: string;
  categoryColor: string;
}

/** List the current user's learned rules, newest-priority first. */
export async function listUserRulesAction(): Promise<UserRule[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  const rows = await db
    .select({
      id: categoryRules.id,
      matchPattern: categoryRules.matchPattern,
      categoryId: categories.id,
      categorySlug: categories.slug,
      categoryNameEs: categories.nameEs,
      categoryNameEn: categories.nameEn,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
    })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.userId, session.userId))
    .orderBy(asc(categoryRules.matchPattern));
  return rows;
}

/** Delete one of the current user's learned rules. Scoped so a user can only
 * ever remove their own rules — never a shared/seeded one. */
export async function deleteUserRuleAction(ruleId: number): Promise<RuleActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, session.userId)));
  revalidatePath("/transactions");
  revalidatePath("/categories");
  return { ok: true };
}
