import "server-only";

import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { cleanMerchant, keywordCategory } from "./heuristics";
import { categorizeWithLlm } from "./llm";
import { type RuleRow, assignCategory, categoryIdBySlug, loadRules, matchRule } from "./rules";

const MAX_LLM_PER_RUN = 50;
const RULE_CONFIDENCE = 1.0;
const KEYWORD_CONFIDENCE = 95;

export interface CategorizeResult {
  processed: number;
  ruleMatched: number;
  keywordMatched: number;
  llmMatched: number;
  llmSkipped: number;
  errors: number;
}

interface PendingTx {
  id: number;
  merchantName: string | null;
  rawDescription: string;
  amountCents: number;
  currency: string;
}

/** Rows still needing categorization: never assigned, or flagged for review. */
const pendingWhere = (userId: number) =>
  and(
    eq(transactions.userId, userId),
    or(isNull(transactions.categoryId), eq(transactions.needsReview, true)),
  );

const PENDING_COLUMNS = {
  id: transactions.id,
  merchantName: transactions.merchantName,
  rawDescription: transactions.rawDescription,
  amountCents: transactions.amountCents,
  currency: transactions.currency,
};

async function loadCategoryHints(): Promise<{ slug: string; name: string }[]> {
  const rows = await db.select({ slug: categories.slug, name: categories.nameEn }).from(categories);
  return rows;
}

/**
 * Try to categorize one transaction: deterministic rule → well-known-merchant
 * keyword → LLM. Returns which path matched, or "error"/"none". Never throws —
 * an LLM failure leaves the row pending for a later run.
 */
async function categorizeOne(
  tx: PendingTx,
  ctx: { rules: RuleRow[]; cats: { slug: string; name: string }[] },
): Promise<"rule" | "keyword" | "llm" | "error"> {
  const rule = matchRule(tx, ctx.rules);
  if (rule) {
    await assignCategory(tx.id, rule.categoryId, {
      needsReview: false,
      confidence: RULE_CONFIDENCE,
    });
    return "rule";
  }

  const cleaned = cleanMerchant(tx.merchantName, tx.rawDescription);
  const kwSlug = keywordCategory(cleaned, tx.amountCents);
  if (kwSlug) {
    const catId = await categoryIdBySlug(kwSlug);
    if (catId) {
      await assignCategory(tx.id, catId, { needsReview: false, confidence: KEYWORD_CONFIDENCE });
      return "keyword";
    }
  }

  try {
    const out = await categorizeWithLlm(tx, ctx.cats);
    const catId = await categoryIdBySlug(out.categorySlug);
    if (!catId) return "error";
    await assignCategory(tx.id, catId, {
      needsReview: out.confidence < 0.7,
      // Cap below 100 so only a user's manual pick ever reaches confidence 100
      // (the marker the correction pass uses to never overwrite manual edits).
      confidence: Math.min(99, Math.round(out.confidence * 100)),
    });
    return "llm";
  } catch (err) {
    console.warn("LLM categorize failed for tx", tx.id, err);
    return "error";
  }
}

export interface RecorrectResult {
  corrected: number;
  requeued: number;
}

/**
 * Re-evaluate already-categorized transactions and fix deterministic mistakes
 * (no LLM). For each non-manual row (confidence ≠ 100):
 *   - if a rule or well-known-merchant keyword now maps it to a *different*
 *     category → reassign it (e.g. an Anthropic charge wrongly in "fees" → it
 *     becomes "subscriptions", a café → "coffee").
 *   - if it was rule-assigned (confidence 1) but now matches NO rule/keyword, it
 *     was a false catch-all match (the old "comision" fee rule) → clear it and
 *     flag for review so the LLM re-categorizes it on the next batch.
 *
 * Manual picks (confidence 100) are never touched.
 */
export async function recorrectCategories(userId: number): Promise<RecorrectResult> {
  const rules = await loadRules(userId);
  const rows = await db
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      categoryId: transactions.categoryId,
      confidence: transactions.confidence,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  let corrected = 0;
  let requeued = 0;

  for (const tx of rows) {
    if (tx.confidence === 100) continue; // authoritative manual pick

    const rule = matchRule(tx, rules);
    if (rule) {
      if (rule.categoryId !== tx.categoryId) {
        await assignCategory(tx.id, rule.categoryId, { needsReview: false, confidence: 1 });
        corrected++;
      }
      continue;
    }

    const kwSlug = keywordCategory(
      cleanMerchant(tx.merchantName, tx.rawDescription),
      tx.amountCents,
    );
    if (kwSlug) {
      const catId = await categoryIdBySlug(kwSlug);
      if (catId && catId !== tx.categoryId) {
        await assignCategory(tx.id, catId, { needsReview: false, confidence: KEYWORD_CONFIDENCE });
        corrected++;
      }
      continue;
    }

    // No deterministic match. A confidence-1 row was rule-assigned; with no rule
    // matching now it was a false "comision" fee match → re-queue for the LLM.
    if (tx.confidence === 1 && tx.categoryId != null) {
      await db
        .update(transactions)
        .set({ categoryId: null, needsReview: true, confidence: null, updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
      requeued++;
    }
  }

  return { corrected, requeued };
}

/** Count transactions still needing categorization. */
export async function countPendingCategorization(userId: number): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(transactions)
    .where(pendingWhere(userId));
  return Number(rows[0]?.c ?? 0);
}

export interface BatchResult {
  processed: number;
  ruleMatched: number;
  keywordMatched: number;
  llmMatched: number;
  errors: number;
  /** Highest transaction id seen this batch — pass back as `afterId` to continue. */
  lastId: number;
  /** True when a full batch was returned (more may remain). */
  hasMore: boolean;
}

/**
 * Categorize a single forward batch of pending transactions (id > afterId).
 *
 * Cursor-based so the background loop always makes progress and terminates:
 * rows that fail (e.g. LLM offline) stay pending but fall behind the advancing
 * cursor, so they aren't retried in the same run — they'll be picked up by the
 * next full run instead of stalling the loop.
 */
export async function categorizePendingBatch(opts: {
  userId: number;
  afterId?: number;
  limit?: number;
}): Promise<BatchResult> {
  const afterId = opts.afterId ?? 0;
  const limit = Math.max(1, Math.min(opts.limit ?? 15, 100));
  const rules = await loadRules(opts.userId);
  const cats = await loadCategoryHints();

  const pending = await db
    .select(PENDING_COLUMNS)
    .from(transactions)
    .where(and(pendingWhere(opts.userId), gt(transactions.id, afterId)))
    .orderBy(asc(transactions.id))
    .limit(limit);

  const result: BatchResult = {
    processed: 0,
    ruleMatched: 0,
    keywordMatched: 0,
    llmMatched: 0,
    errors: 0,
    lastId: afterId,
    hasMore: false,
  };

  for (const tx of pending) {
    result.lastId = tx.id;
    result.processed++;
    const outcome = await categorizeOne(tx, { rules, cats });
    if (outcome === "rule") result.ruleMatched++;
    else if (outcome === "keyword") result.keywordMatched++;
    else if (outcome === "llm") result.llmMatched++;
    else result.errors++;
  }

  result.hasMore = pending.length === limit;
  return result;
}

/**
 * Categorize transactions that haven't been assigned yet (or are still flagged
 * `needsReview`). Strategy per row: deterministic rule → well-known merchant
 * keyword → LLM (PII redacted). LLM calls are capped per run by `maxLlm`;
 * multi-run flows call again. Prefer `categorizePendingBatch` for the
 * background "categorize everything" flow.
 */
export async function categorizeUncategorized(opts: {
  userId: number;
  maxLlm?: number;
}): Promise<CategorizeResult> {
  const rules = await loadRules(opts.userId);
  const cats = await loadCategoryHints();

  const pending = await db
    .select(PENDING_COLUMNS)
    .from(transactions)
    .where(pendingWhere(opts.userId));

  const result: CategorizeResult = {
    processed: 0,
    ruleMatched: 0,
    keywordMatched: 0,
    llmMatched: 0,
    llmSkipped: 0,
    errors: 0,
  };
  const maxLlm = opts?.maxLlm ?? MAX_LLM_PER_RUN;
  let llmCalls = 0;

  for (const tx of pending) {
    result.processed++;
    // Rule + keyword passes are free; only the LLM fallback is capped.
    const rule = matchRule(tx, rules);
    if (rule) {
      await assignCategory(tx.id, rule.categoryId, {
        needsReview: false,
        confidence: RULE_CONFIDENCE,
      });
      result.ruleMatched++;
      continue;
    }
    const kwSlug = keywordCategory(
      cleanMerchant(tx.merchantName, tx.rawDescription),
      tx.amountCents,
    );
    if (kwSlug) {
      const catId = await categoryIdBySlug(kwSlug);
      if (catId) {
        await assignCategory(tx.id, catId, { needsReview: false, confidence: KEYWORD_CONFIDENCE });
        result.keywordMatched++;
        continue;
      }
    }
    if (llmCalls >= maxLlm) {
      result.llmSkipped++;
      continue;
    }
    llmCalls++;
    const outcome = await categorizeOne(tx, { rules, cats });
    if (outcome === "llm") result.llmMatched++;
    else if (outcome === "keyword") result.keywordMatched++;
    else if (outcome === "rule") result.ruleMatched++;
    else result.errors++;
  }

  return result;
}

/**
 * Categorize a specific batch of transaction IDs (called right after sync).
 * Only uses rules — never hits the LLM — so sync stays fast and offline-safe.
 */
export async function categorizeBatchByRules(userId: number, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rules = await loadRules(userId);
  let matched = 0;
  for (const id of ids) {
    const row = await db
      .select({
        id: transactions.id,
        merchantName: transactions.merchantName,
        rawDescription: transactions.rawDescription,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.userId, userId),
          isNull(transactions.categoryId),
        ),
      )
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
