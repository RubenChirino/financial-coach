import "server-only";

import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import {
  type LlmHandle,
  type LlmRefusalCode,
  llmRefusalCode,
  resolveModelForUser,
} from "@/lib/llm/gateway";
import { cleanMerchant, keywordCategory } from "./heuristics";
import { categorizeWithLlm } from "./llm";
import { assignCategory, categoryIdBySlug, loadRules, matchRule, type RuleRow } from "./rules";

const RULE_CONFIDENCE = 1.0;
const KEYWORD_CONFIDENCE = 95;

export interface DeterministicMatch {
  categoryId: number;
  confidence: number;
  via: "rule" | "keyword";
}

/**
 * The free, offline categorization steps: the user's rules (and the built-in
 * ones), then the well-known-merchant keywords. Pure — callers load `rules`
 * and `idBySlug` once per run. Used at ingest so rows arrive categorized.
 */
export function matchDeterministic(
  tx: { merchantName: string | null; rawDescription: string; amountCents: number },
  rules: readonly RuleRow[],
  idBySlug: ReadonlyMap<string, number>,
): DeterministicMatch | null {
  const rule = matchRule(tx, rules);
  if (rule) return { categoryId: rule.categoryId, confidence: RULE_CONFIDENCE, via: "rule" };
  const slug = keywordCategory(cleanMerchant(tx.merchantName, tx.rawDescription), tx.amountCents);
  const categoryId = slug ? idBySlug.get(slug) : undefined;
  return categoryId ? { categoryId, confidence: KEYWORD_CONFIDENCE, via: "keyword" } : null;
}

/** Every category id keyed by slug, in one query. */
export async function loadCategoryIdsBySlug(): Promise<Map<string, number>> {
  const rows = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Lazily resolves the user's model once per batch; a refusal is a value, not a throw. */
type LlmSource = () => Promise<LlmHandle | LlmRefusalCode>;

function lazyLlm(userId: number): LlmSource {
  let pending: Promise<LlmHandle | LlmRefusalCode> | null = null;
  return () => {
    pending ??= resolveModelForUser(userId, "categorize").catch((err: unknown) => {
      const code = llmRefusalCode(err);
      if (code) return code;
      throw err;
    });
    return pending;
  };
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

type Outcome = "rule" | "keyword" | "llm" | "error" | { skipped: LlmRefusalCode };

/**
 * Try to categorize one transaction: deterministic rule → well-known-merchant
 * keyword → LLM. Returns which path matched. Never throws: an LLM failure or a
 * gateway refusal (no cloud consent, quota) leaves the row pending for a later
 * run.
 */
async function categorizeOne(
  tx: PendingTx,
  ctx: { rules: RuleRow[]; cats: { slug: string; name: string }[]; llm: LlmSource },
): Promise<Outcome> {
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
    const llm = await ctx.llm();
    if (typeof llm === "string") return { skipped: llm };
    const out = await categorizeWithLlm(llm, tx, ctx.cats);
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
    const code = llmRefusalCode(err);
    if (code) return { skipped: code };
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
/** Ids per UPDATE … WHERE id IN (…), well under SQLite's bound-variable limit. */
const IDS_PER_UPDATE = 500;

export async function recorrectCategories(userId: number): Promise<RecorrectResult> {
  const [rules, idBySlug, rows] = await Promise.all([
    loadRules(userId),
    loadCategoryIdsBySlug(),
    db
      .select({
        id: transactions.id,
        merchantName: transactions.merchantName,
        rawDescription: transactions.rawDescription,
        amountCents: transactions.amountCents,
        categoryId: transactions.categoryId,
        confidence: transactions.confidence,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  ]);

  // Decide every row in memory, grouped by outcome, then apply the groups as
  // set-based updates in one atomic batch.
  const assign = new Map<string, { categoryId: number; confidence: number; ids: number[] }>();
  const requeue: number[] = [];
  const assignTo = (id: number, categoryId: number, confidence: number) => {
    const key = `${categoryId}:${confidence}`;
    const group = assign.get(key) ?? { categoryId, confidence, ids: [] };
    group.ids.push(id);
    assign.set(key, group);
  };

  for (const tx of rows) {
    if (tx.confidence === 100) continue; // authoritative manual pick

    const rule = matchRule(tx, rules);
    if (rule) {
      if (rule.categoryId !== tx.categoryId) assignTo(tx.id, rule.categoryId, RULE_CONFIDENCE);
      continue;
    }

    const kwSlug = keywordCategory(
      cleanMerchant(tx.merchantName, tx.rawDescription),
      tx.amountCents,
    );
    if (kwSlug) {
      const catId = idBySlug.get(kwSlug);
      if (catId && catId !== tx.categoryId) assignTo(tx.id, catId, KEYWORD_CONFIDENCE);
      continue;
    }

    // No deterministic match. A confidence-1 row was rule-assigned; with no rule
    // matching now it was a false "comision" fee match → re-queue for the LLM.
    if (tx.confidence === 1 && tx.categoryId != null) requeue.push(tx.id);
  }

  // Every update re-checks the owner and skips rows the user picked by hand
  // since the read (confidence 100), so a concurrent manual choice wins.
  const notManual = or(isNull(transactions.confidence), ne(transactions.confidence, 100));
  const scoped = (ids: number[]) =>
    and(eq(transactions.userId, userId), inArray(transactions.id, ids), notManual);
  const now = new Date();
  const statements = [
    ...[...assign.values()].flatMap((g) =>
      chunk(g.ids, IDS_PER_UPDATE).map((ids) =>
        db
          .update(transactions)
          .set({
            categoryId: g.categoryId,
            needsReview: false,
            confidence: g.confidence,
            updatedAt: now,
          })
          .where(scoped(ids)),
      ),
    ),
    ...chunk(requeue, IDS_PER_UPDATE).map((ids) =>
      db
        .update(transactions)
        .set({ categoryId: null, needsReview: true, confidence: null, updatedAt: now })
        .where(scoped(ids)),
    ),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);

  const corrected = [...assign.values()].reduce((n, g) => n + g.ids.length, 0);
  return { corrected, requeued: requeue.length };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
  /** Rows left pending because the LLM was refused (see `llmSkipped`). */
  skipped: number;
  /**
   * Why the LLM step was refused, so the UI can ask for consent. Rules and
   * keywords still ran for every row.
   */
  llmSkipped: LlmRefusalCode | null;
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
    skipped: 0,
    llmSkipped: null,
    lastId: afterId,
    hasMore: false,
  };

  const llm = lazyLlm(opts.userId);
  for (const tx of pending) {
    result.lastId = tx.id;
    result.processed++;
    const outcome = await categorizeOne(tx, { rules, cats, llm });
    if (outcome === "rule") result.ruleMatched++;
    else if (outcome === "keyword") result.keywordMatched++;
    else if (outcome === "llm") result.llmMatched++;
    else if (outcome === "error") result.errors++;
    else {
      result.skipped++;
      result.llmSkipped = outcome.skipped;
    }
  }

  result.hasMore = pending.length === limit;
  return result;
}

export { loadRules, type RuleRow };
