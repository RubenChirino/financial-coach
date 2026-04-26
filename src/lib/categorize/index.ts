import "server-only";

import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { categorizeWithLlm } from "./llm";
import { type RuleRow, assignCategory, categoryIdBySlug, loadRules, matchRule } from "./rules";

const MAX_LLM_PER_RUN = 50;
const RULE_CONFIDENCE = 1.0;

export interface CategorizeResult {
  processed: number;
  ruleMatched: number;
  llmMatched: number;
  llmSkipped: number;
  errors: number;
}

/**
 * Categorize transactions that haven't been assigned yet (or are still flagged
 * `needsReview`). Strategy:
 *
 *   1. Deterministic rule match → mark as assigned, `needsReview=false`,
 *      `confidence=1.0`. Fast, free, privacy-preserving.
 *   2. If no rule matches AND the LLM provider is available, fall back to
 *      `categorizeWithLlm` (redacts PII before calling). Assign with
 *      `needsReview=true` if confidence < 0.7 — user review is cheap, wrong
 *      categories poison the dashboards.
 *   3. On LLM error (Ollama unreachable, API down, etc.): leave the
 *      transaction alone so it gets retried next run. We do NOT invent a
 *      category just because the LLM was offline.
 *
 * The function caps LLM calls per run to keep local categorization snappy
 * and cloud bills small. Multi-run flows simply call it again.
 */
export async function categorizeUncategorized(opts?: {
  maxLlm?: number;
}): Promise<CategorizeResult> {
  const rules = await loadRules();
  const catRows = await db.select({ slug: categories.slug }).from(categories);
  const slugs = catRows.map((c) => c.slug);

  const pending = await db
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(or(isNull(transactions.categoryId), eq(transactions.needsReview, true)));

  const result: CategorizeResult = {
    processed: 0,
    ruleMatched: 0,
    llmMatched: 0,
    llmSkipped: 0,
    errors: 0,
  };
  const maxLlm = opts?.maxLlm ?? MAX_LLM_PER_RUN;

  const unmatched: {
    id: number;
    merchantName: string | null;
    rawDescription: string;
    amountCents: number;
    currency: string;
  }[] = [];

  for (const tx of pending) {
    result.processed++;
    const rule = matchRule(tx, rules);
    if (rule) {
      await assignCategory(tx.id, rule.categoryId, {
        needsReview: false,
        confidence: RULE_CONFIDENCE,
      });
      result.ruleMatched++;
    } else {
      unmatched.push(tx);
    }
  }

  for (let i = 0; i < unmatched.length; i++) {
    if (i >= maxLlm) {
      result.llmSkipped += unmatched.length - i;
      break;
    }
    const tx = unmatched[i]!;
    try {
      const out = await categorizeWithLlm(tx, slugs);
      const catId = await categoryIdBySlug(out.categorySlug);
      if (!catId) {
        result.errors++;
        continue;
      }
      await assignCategory(tx.id, catId, {
        needsReview: out.confidence < 0.7,
        confidence: Math.round(out.confidence * 100),
      });
      result.llmMatched++;
    } catch (err) {
      console.warn("LLM categorize failed for tx", tx.id, err);
      result.errors++;
    }
  }

  return result;
}

/**
 * Categorize a specific batch of transaction IDs (called right after sync).
 * Only uses rules — never hits the LLM — so sync stays fast and offline-safe.
 */
export async function categorizeBatchByRules(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rules = await loadRules();
  let matched = 0;
  for (const id of ids) {
    const row = await db
      .select({
        id: transactions.id,
        merchantName: transactions.merchantName,
        rawDescription: transactions.rawDescription,
      })
      .from(transactions)
      .where(and(eq(transactions.id, id), isNull(transactions.categoryId)))
      .limit(1);
    const tx = row[0];
    if (!tx) continue;
    const rule = matchRule(tx, rules);
    if (rule) {
      await assignCategory(tx.id, rule.categoryId, {
        needsReview: false,
        confidence: RULE_CONFIDENCE,
      });
      matched++;
    }
  }
  return matched;
}

export type { RuleRow };
