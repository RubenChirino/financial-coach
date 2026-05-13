import "server-only";

import { db } from "@/db/client";
import { categories, categoryRules, transactions } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export type MatchType = "merchant_exact" | "contains" | "regex";

export interface RuleRow {
  id: number;
  matchPattern: string;
  matchType: MatchType;
  categoryId: number;
  priority: number;
}

export interface RuleInput {
  merchantName: string | null;
  rawDescription: string;
}

/**
 * Deterministic rule-based category matcher.
 *
 * Evaluation order:
 *   1. merchant_exact against the GoCardless merchant name (case-insensitive).
 *   2. contains against merchant name OR raw description.
 *   3. regex (Javascript flavour, case-insensitive) against merchant + description.
 *
 * Within each type, rules with lower `priority` win. Returns the first match.
 */
function ruleMatches(rule: RuleRow, merchant: string, haystack: string): boolean {
  const pat = rule.matchPattern.toLowerCase();
  if (rule.matchType === "merchant_exact") return Boolean(merchant) && merchant === pat;
  if (rule.matchType === "contains") return haystack.includes(pat);
  if (rule.matchType === "regex") {
    try {
      return new RegExp(rule.matchPattern, "i").test(haystack);
    } catch {
      // malformed regex — skip silently
      return false;
    }
  }
  return false;
}

export function matchRule(input: RuleInput, rules: RuleRow[]): RuleRow | null {
  const merchant = (input.merchantName ?? "").trim().toLowerCase();
  const haystack = `${input.merchantName ?? ""} ${input.rawDescription ?? ""}`.trim().toLowerCase();

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(r, merchant, haystack)) return r;
  }
  return null;
}

export async function loadRules(): Promise<RuleRow[]> {
  const rows = await db
    .select({
      id: categoryRules.id,
      matchPattern: categoryRules.matchPattern,
      matchType: categoryRules.matchType,
      categoryId: categoryRules.categoryId,
      priority: categoryRules.priority,
    })
    .from(categoryRules)
    .orderBy(asc(categoryRules.priority));
  return rows;
}

export async function categoryIdBySlug(slug: string): Promise<number | null> {
  const row = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row[0]?.id ?? null;
}

export async function assignCategory(
  transactionId: number,
  categoryId: number,
  opts?: { needsReview?: boolean; confidence?: number | null },
): Promise<void> {
  await db
    .update(transactions)
    .set({
      categoryId,
      needsReview: opts?.needsReview ?? false,
      confidence: opts?.confidence ?? null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, transactionId));
}
