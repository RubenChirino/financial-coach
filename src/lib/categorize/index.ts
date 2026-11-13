import "server-only";

import { and, asc, eq, gt, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import {
  type LlmHandle,
  type LlmRefusalCode,
  llmRefusalCode,
  resolveModelForUser,
} from "@/lib/llm/gateway";
import { cleanMerchant, keywordCategory } from "./heuristics";
import { categorizeWithLlm, type LlmCategorizeResult, MERCHANTS_PER_CALL } from "./llm";
import {
  deriveRulePattern,
  insertAiRuleIfAbsent,
  loadRules,
  matchRule,
  type RuleRow,
} from "./rules";

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

interface PendingTx {
  id: number;
  merchantName: string | null;
  rawDescription: string;
  amountCents: number;
  currency: string;
}

/**
 * Rows still needing categorization: never assigned, or flagged for review —
 * except a low-confidence LLM answer, which stays flagged for the user rather
 * than being sent back to the model (the same question gets the same answer).
 */
const pendingWhere = (userId: number) =>
  and(
    eq(transactions.userId, userId),
    or(
      isNull(transactions.categoryId),
      and(
        eq(transactions.needsReview, true),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "llm")),
      ),
    ),
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

export interface RecorrectResult {
  corrected: number;
  requeued: number;
}

/**
 * Re-evaluate already-categorized transactions and fix deterministic mistakes
 * (no LLM). For each row the user did not pick by hand (`category_source` is
 * not "user"):
 *   - if a rule or well-known-merchant keyword now maps it to a *different*
 *     category → reassign it (e.g. an Anthropic charge wrongly in "fees" → it
 *     becomes "subscriptions", a café → "coffee").
 *   - if it was rule-assigned but now matches NO rule/keyword, it
 *     was a false catch-all match (the old "comision" fee rule) → clear it and
 *     flag for review so the LLM re-categorizes it on the next batch.
 *
 * Manual picks are never touched.
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
        categorySource: transactions.categorySource,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  ]);

  // Decide every row in memory, grouped by outcome, then apply the groups as
  // set-based updates in one atomic batch.
  const assign = new Map<string, Assignment>();
  const requeue: number[] = [];

  for (const tx of rows) {
    if (tx.categorySource === "user") continue; // authoritative manual pick

    const rule = matchRule(tx, rules);
    if (rule) {
      if (rule.categoryId !== tx.categoryId) addTo(assign, tx.id, rule.categoryId, "rule");
      continue;
    }

    const kwSlug = keywordCategory(
      cleanMerchant(tx.merchantName, tx.rawDescription),
      tx.amountCents,
    );
    if (kwSlug) {
      const catId = idBySlug.get(kwSlug);
      if (catId && catId !== tx.categoryId) addTo(assign, tx.id, catId, "keyword");
      continue;
    }

    // No deterministic match. A rule-assigned row with no rule matching now
    // was a false "comision" fee match → re-queue for the LLM.
    if (tx.categorySource === "rule" && tx.categoryId != null) requeue.push(tx.id);
  }

  // Every update re-checks the owner and skips rows the user picked by hand
  // since the read, so a concurrent manual choice wins.
  const now = new Date();
  const statements = [
    ...assignStatements(userId, assign, notManual, now),
    ...chunk(requeue, IDS_PER_UPDATE).map((ids) =>
      db
        .update(transactions)
        .set({
          categoryId: null,
          needsReview: true,
          confidence: null,
          categorySource: null,
          updatedAt: now,
        })
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), notManual)),
    ),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);

  const corrected = [...assign.values()].reduce((n, g) => n + g.ids.length, 0);
  return { corrected, requeued: requeue.length };
}

/** Rows the user has not categorized by hand. */
const notManual = or(isNull(transactions.categorySource), ne(transactions.categorySource, "user"));

/** Rows still pending — the guard every automatic categorization re-checks. */
const stillPending = or(isNull(transactions.categoryId), eq(transactions.needsReview, true));

interface Assignment {
  categoryId: number;
  source: "rule" | "keyword";
  ids: number[];
}

function addTo(
  groups: Map<string, Assignment>,
  id: number,
  categoryId: number,
  source: Assignment["source"],
) {
  const key = `${categoryId}:${source}`;
  const group = groups.get(key) ?? { categoryId, source, ids: [] };
  group.ids.push(id);
  groups.set(key, group);
}

/** Set-based updates for deterministic assignments, scoped to the owner and `guard`. */
function assignStatements(
  userId: number,
  groups: Map<string, Assignment>,
  guard: SQL | undefined,
  now: Date,
) {
  return [...groups.values()].flatMap((g) =>
    chunk(g.ids, IDS_PER_UPDATE).map((ids) =>
      db
        .update(transactions)
        .set({
          categoryId: g.categoryId,
          needsReview: false,
          confidence: g.source === "rule" ? RULE_CONFIDENCE : KEYWORD_CONFIDENCE,
          categorySource: g.source,
          updatedAt: now,
        })
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), guard)),
    ),
  );
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

/** Why the LLM step did not run: a gateway refusal, or the provider failed. */
export type LlmSkipReason = LlmRefusalCode | "unavailable";

export interface BatchResult {
  processed: number;
  ruleMatched: number;
  keywordMatched: number;
  llmMatched: number;
  /** Rows the model was asked about but did not categorize. */
  errors: number;
  /** Rows left pending because the LLM step did not run (see `llmSkipped`). */
  skipped: number;
  /**
   * Why the LLM step did not run, so the UI can ask for consent — and so the
   * caller stops asking a provider that is down. Rules and keywords still ran
   * for every row.
   */
  llmSkipped: LlmSkipReason | null;
  /** LLM calls this batch made (one per up-to-25 merchants). */
  llmCalls: number;
  /** Highest transaction id seen this batch — pass back as `afterId` to continue. */
  lastId: number;
  /** True when a full batch was returned (more may remain). */
  hasMore: boolean;
}

/** Below this confidence an LLM answer is kept but flagged for review. */
const LLM_REVIEW_BELOW = 0.7;
/** At or above this confidence an LLM answer becomes an "ai" rule for its merchant. */
const AI_RULE_MIN_CONFIDENCE = 0.85;

/**
 * The key rows are grouped by before reaching the LLM: the cleaned merchant
 * (or, without one, the description) and the sign — a refund is asked about
 * apart from a charge.
 */
function merchantKey(tx: PendingTx): string {
  const name = cleanMerchant(tx.merchantName, tx.rawDescription).toLowerCase().trim();
  return `${tx.amountCents < 0 ? "out" : "in"}:${name || tx.rawDescription.toLowerCase().trim()}`;
}

/**
 * Categorize a single forward batch of pending transactions (id > afterId).
 *
 * Rules and keywords first, applied as one batch. The rest is grouped by
 * merchant and sent to the LLM `MERCHANTS_PER_CALL` merchants per call; each
 * answer is applied as one batch — every row of each merchant, plus an "ai"
 * rule for a confident answer, so that merchant never reaches the LLM again.
 *
 * The first failed call stops the LLM step for the batch (`llmSkipped:
 * "unavailable"`), and the caller passes `skipLlm` for the rest of the run:
 * an unreachable provider costs one call, not one per row.
 *
 * Cursor-based so the background loop always makes progress and terminates:
 * rows left pending fall behind the advancing cursor and are picked up by the
 * next full run.
 */
export async function categorizePendingBatch(opts: {
  userId: number;
  afterId?: number;
  limit?: number;
  skipLlm?: boolean;
}): Promise<BatchResult> {
  const { userId } = opts;
  const afterId = opts.afterId ?? 0;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const [rules, idBySlug, cats, pending] = await Promise.all([
    loadRules(userId),
    loadCategoryIdsBySlug(),
    loadCategoryHints(),
    db
      .select(PENDING_COLUMNS)
      .from(transactions)
      .where(and(pendingWhere(userId), gt(transactions.id, afterId)))
      .orderBy(asc(transactions.id))
      .limit(limit),
  ]);

  const result: BatchResult = {
    processed: pending.length,
    ruleMatched: 0,
    keywordMatched: 0,
    llmMatched: 0,
    errors: 0,
    skipped: 0,
    llmSkipped: null,
    llmCalls: 0,
    lastId: pending.at(-1)?.id ?? afterId,
    hasMore: pending.length === limit,
  };

  // 1. Deterministic, in memory; applied as one batch.
  const deterministic = new Map<string, Assignment>();
  const byMerchant = new Map<string, PendingTx[]>();
  for (const tx of pending) {
    const match = matchDeterministic(tx, rules, idBySlug);
    if (match) {
      addTo(deterministic, tx.id, match.categoryId, match.via);
      if (match.via === "rule") result.ruleMatched++;
      else result.keywordMatched++;
      continue;
    }
    const key = merchantKey(tx);
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), tx]);
  }
  const now = new Date();
  const [first, ...rest] = assignStatements(userId, deterministic, stillPending, now);
  if (first) await db.batch([first, ...rest]);

  // 2. The LLM, per merchant.
  const groups = [...byMerchant.values()];
  if (groups.length > 0) {
    await runLlmStep({ userId, groups, cats, idBySlug, now, skipLlm: opts.skipLlm }, result);
  }
  return result;
}

/**
 * Ask the LLM about each merchant group, `MERCHANTS_PER_CALL` per call, and
 * apply each answer as one batch. Updates `result` in place. The first failed
 * call ends the step: the rest is skipped as "unavailable".
 */
async function runLlmStep(
  ctx: {
    userId: number;
    groups: PendingTx[][];
    cats: { slug: string; name: string }[];
    idBySlug: ReadonlyMap<string, number>;
    now: Date;
    skipLlm?: boolean;
  },
  result: BatchResult,
): Promise<void> {
  const skip = (gs: PendingTx[][], reason: LlmSkipReason | null) => {
    result.skipped += gs.reduce((n, g) => n + g.length, 0);
    if (reason) result.llmSkipped = reason;
  };
  if (ctx.skipLlm) return skip(ctx.groups, null);

  let llm: LlmHandle;
  try {
    llm = await resolveModelForUser(ctx.userId, "categorize");
  } catch (err) {
    const code = llmRefusalCode(err);
    if (code) return skip(ctx.groups, code);
    throw err;
  }

  const calls = chunk(ctx.groups, MERCHANTS_PER_CALL);
  for (const [i, call] of calls.entries()) {
    let answers: Map<number, LlmCategorizeResult>;
    try {
      result.llmCalls++;
      answers = await categorizeWithLlm(
        llm,
        call.map((g) => g[0] as PendingTx),
        ctx.cats,
      );
    } catch (err) {
      const code = llmRefusalCode(err);
      if (!code) console.warn("LLM categorize failed; skipping the LLM for this run", err);
      return skip(calls.slice(i).flat(1), code ?? "unavailable");
    }
    const applied = answerStatements(ctx.userId, call, answers, ctx.idBySlug, ctx.now);
    result.llmMatched += applied.matched;
    result.errors += applied.unanswered;
    const [first, ...rest] = applied.statements;
    if (first) await db.batch([first, ...rest]);
  }
}

/**
 * The writes for one LLM answer: every row of each answered merchant (still
 * pending, never a manual pick), plus an "ai" rule for a confident answer.
 */
function answerStatements(
  userId: number,
  call: readonly PendingTx[][],
  answers: ReadonlyMap<number, LlmCategorizeResult>,
  idBySlug: ReadonlyMap<string, number>,
  now: Date,
): { statements: BatchItem<"sqlite">[]; matched: number; unanswered: number } {
  const statements: BatchItem<"sqlite">[] = [];
  let matched = 0;
  let unanswered = 0;
  for (const [j, group] of call.entries()) {
    const answer = answers.get(j);
    const categoryId = answer ? idBySlug.get(answer.categorySlug) : undefined;
    if (!answer || !categoryId) {
      unanswered += group.length;
      continue;
    }
    matched += group.length;
    const ids = group.map((t) => t.id);
    statements.push(
      db
        .update(transactions)
        .set({
          categoryId,
          needsReview: answer.confidence < LLM_REVIEW_BELOW,
          // Below 100: only the user's own pick is authoritative.
          confidence: Math.min(99, Math.round(answer.confidence * 100)),
          categorySource: "llm",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactions.userId, userId),
            inArray(transactions.id, ids),
            stillPending,
            notManual,
          ),
        ),
    );
    const first = group[0] as PendingTx;
    const pattern = deriveRulePattern(first.merchantName, first.rawDescription);
    if (pattern && answer.confidence >= AI_RULE_MIN_CONFIDENCE) {
      statements.push(insertAiRuleIfAbsent(userId, pattern, categoryId));
    }
  }
  return { statements, matched, unanswered };
}

export { loadRules, type RuleRow };
