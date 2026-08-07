import "server-only";

import { asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, categoryRules, transactions } from "@/db/schema";
import { cleanMerchant } from "./heuristics";

export type MatchType = "merchant_exact" | "contains" | "regex";

/** A learned rule's pattern must be at least this long to be reliable. */
const MIN_PATTERN_LEN = 3;

/**
 * Derive the pattern a "always categorise this merchant" rule should match on.
 * Uses the same merchant cleaning the categorizer applies, so the learned rule
 * keys off the readable merchant (e.g. "mercadona") rather than the noisy raw
 * description. Returns null when nothing usable remains (too short to be safe).
 */
export function deriveRulePattern(
  merchantName: string | null,
  rawDescription: string,
): string | null {
  const pattern = cleanMerchant(merchantName, rawDescription).toLowerCase().trim();
  if (pattern.length < MIN_PATTERN_LEN) return null;
  return pattern;
}

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
  const haystack = `${input.merchantName ?? ""} ${input.rawDescription ?? ""}`
    .trim()
    .toLowerCase()
    // Drop the ubiquitous ", Comision 0,00" zero-fee footer that Spanish-bank
    // descriptions append to EVERY card payment — otherwise the "comision" fee
    // rule matches everything and floods unrelated merchants into bank fees.
    // A real, non-zero commission ("comision 3,50", "comision mantenimiento")
    // is left intact and still matches.
    .replace(/comisi[oó]n\s*0[.,]00/g, " ");

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(r, merchant, haystack)) return r;
  }
  return null;
}

/**
 * Load the rules that apply to a user: the shared built-in rules (`user_id IS
 * NULL`) PLUS that user's own learned rules. User rules are inserted with a
 * lower `priority` number, so `matchRule`'s priority sort makes a personal
 * correction win over a generic default.
 */
export async function loadRules(userId: number): Promise<RuleRow[]> {
  const rows = await db
    .select({
      id: categoryRules.id,
      matchPattern: categoryRules.matchPattern,
      matchType: categoryRules.matchType,
      categoryId: categoryRules.categoryId,
      priority: categoryRules.priority,
    })
    .from(categoryRules)
    .where(or(isNull(categoryRules.userId), eq(categoryRules.userId, userId)))
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
