import "server-only";

import { and, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db/client";
import { accounts, importBatches, transactions } from "@/db/schema";
import { snapshotBalances } from "@/lib/accounts/history";
import { loadCategoryIdsBySlug, loadRules, matchDeterministic } from "@/lib/categorize";
import { detectRecurringSubscriptions } from "@/lib/recurring/detect";
import { detectTransfers } from "@/lib/transfers/detect";
import {
  insertTransactionsIdempotent,
  type NewTransactionRow,
  withOccurrenceOrdinals,
} from "./identity";

/**
 * The ingestion pipeline: the only code that inserts transactions.
 *
 * Every source (CSV/Excel, GoCardless, TrueLayer, demo, manual entry) reduces
 * to "fetch + normalize" and hands its rows to `ingestTransactions`, which:
 *
 *  1. checks every target account belongs to the user;
 *  2. gives content-derived ids an occurrence ordinal, and on an account a
 *     re-link adopted, drops rows the previous consent already stored under
 *     another id (`dropRelinkOverlap`);
 *  3. categorizes in memory (rules, then keywords), so rows land categorized;
 *  4. inserts in chunks, each one `INSERT … ON CONFLICT DO NOTHING RETURNING`;
 *  5. finalizes in one atomic batch: account balance and `last_synced_at`,
 *     import-batch counts and `status = 'complete'`;
 *  6. refreshes derived data (`refreshDerivedData`) — the same for every source.
 *
 * Guarantees:
 *  - Idempotent: replaying the same input inserts nothing.
 *  - Convergent recovery: if the process dies after k chunks, those rows are
 *    whole and categorized, the batch stays "running", `last_synced_at` has
 *    not moved, and replaying the same input inserts exactly the missing rows.
 *  - Concurrency-safe: overlapping runs can't duplicate; counts come from
 *    `RETURNING`, never from a prior read.
 */

export type IngestSource = "csv" | "gocardless" | "truelayer" | "demo" | "manual";

export interface IngestRow {
  externalId: string;
  /** True when `externalId` was computed from content (gets an ordinal). */
  externalIdDerived?: boolean;
  bookingDate: Date;
  valueDate?: Date | null;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
  /** Category chosen by the source (demo seed, manual entry). Skips step 3. */
  categoryId?: number | null;
  confidence?: number | null;
  needsReview?: boolean;
  isRecurring?: boolean;
}

/**
 * What finalize does to the account balance:
 *  - "keep": leave it (bank balances are set at link time),
 *  - "set": an authoritative figure (a CSV export's balance header),
 *  - "sum": the running total of the account's rows (manual entry, CSVs
 *    without a balance header).
 */
export type BalanceUpdate = { mode: "keep" } | { mode: "set"; cents: number } | { mode: "sum" };

export interface AccountIngest {
  accountId: number;
  rows: readonly IngestRow[];
  balance?: BalanceUpdate;
  /** Updates the account's currency when set. */
  currency?: string | null;
}

export interface IngestInput {
  userId: number;
  source: IngestSource;
  accounts: readonly AccountIngest[];
  /** Import-history row this run belongs to; finalize completes it. */
  importBatchId?: number;
}

export interface IngestResult {
  inserted: number;
  /** Rows already present in their account. */
  duplicates: number;
  insertedIds: number[];
  /** Inserted rows categorized by a rule / by a keyword. */
  ruleMatched: number;
  keywordMatched: number;
}

export class AccountNotOwned extends Error {
  constructor(readonly accountIds: number[]) {
    super(`accounts not owned by user: ${accountIds.join(", ")}`);
    this.name = "AccountNotOwned";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Re-fetch this much before the last successful sync, so a failed run's gap is refilled. */
export const SYNC_OVERLAP_DAYS = 10;
/** History fetched on the first sync, and the furthest back any sync reaches. */
export const SYNC_MAX_DAYS = 90;

/**
 * Where a bank fetch starts: `last_synced_at − 10 days`, never earlier than
 * 90 days ago (the window every sync used before). `last_synced_at` only
 * moves when a run finalizes, so a run that failed is fetched again.
 */
export function syncWindowStart(lastSyncedAt: Date | null, now: Date = new Date()): Date {
  const floor = now.getTime() - SYNC_MAX_DAYS * DAY_MS;
  if (!lastSyncedAt) return new Date(floor);
  return new Date(Math.max(lastSyncedAt.getTime() - SYNC_OVERLAP_DAYS * DAY_MS, floor));
}

/** Step 1. Returns each account's `relinked_through` (null unless a re-link adopted it). */
async function assertOwnsAccounts(
  userId: number,
  accountIds: number[],
): Promise<Map<number, Date | null>> {
  if (accountIds.length === 0) return new Map();
  const owned = await db
    .select({ id: accounts.id, relinkedThrough: accounts.relinkedThrough })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
  const relinked = new Map(owned.map((r) => [r.id, r.relinkedThrough]));
  const missing = accountIds.filter((id) => !relinked.has(id));
  if (missing.length > 0) throw new AccountNotOwned(missing);
  return relinked;
}

/**
 * Re-link continuity (see `src/lib/accounts/link.ts`). After a new consent
 * adopted an account, the bank may report the overlap under new transaction
 * ids. Rows booked on or before `through` whose id is not stored are matched
 * against stored rows of the account whose id the input does not contain
 * (those came from the previous consent): same booking date and amount,
 * preferring the same description. Each stored row matches at most one
 * incoming row, so a genuinely new row with the same date and amount as an
 * old one still goes in. Rows whose id is stored are left to the unique index.
 */
async function dropRelinkOverlap(
  accountId: number,
  rows: readonly IngestRow[],
  through: Date,
): Promise<IngestRow[]> {
  const guarded = rows.filter((r) => r.bookingDate.getTime() <= through.getTime());
  if (guarded.length === 0) return [...rows];
  const from = new Date(
    guarded.reduce((min, r) => Math.min(min, r.bookingDate.getTime()), Number.POSITIVE_INFINITY),
  );
  const stored = await db
    .select({
      externalId: transactions.gocardlessTransactionId,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.bookingDate, from),
        lte(transactions.bookingDate, through),
      ),
    );

  const incomingIds = new Set(rows.map((r) => r.externalId));
  const storedIds = new Set(stored.map((s) => s.externalId));
  const key = (date: Date, cents: number) => `${date.getTime()}|${cents}`;
  const previous = new Map<string, { rawDescription: string; used: boolean }[]>();
  for (const s of stored) {
    if (incomingIds.has(s.externalId)) continue;
    const k = key(s.bookingDate, s.amountCents);
    const bucket = previous.get(k) ?? [];
    bucket.push({ rawDescription: s.rawDescription, used: false });
    previous.set(k, bucket);
  }

  const candidates = guarded.filter((r) => !storedIds.has(r.externalId));
  const dropped = new Set<IngestRow>();
  for (const sameText of [true, false]) {
    for (const r of candidates) {
      if (dropped.has(r)) continue;
      const match = previous
        .get(key(r.bookingDate, r.amountCents))
        ?.find((p) => !p.used && (!sameText || p.rawDescription === r.rawDescription));
      if (match) {
        match.used = true;
        dropped.add(r);
      }
    }
  }
  return rows.filter((r) => !dropped.has(r));
}

type Categorized = Pick<
  NewTransactionRow,
  "categoryId" | "confidence" | "needsReview" | "categorySource"
> & {
  via: "rule" | "keyword" | null;
};

async function makeCategorizer(userId: number): Promise<(row: IngestRow) => Categorized> {
  const [rules, idBySlug] = await Promise.all([loadRules(userId), loadCategoryIdsBySlug()]);
  return (row) => {
    if (row.categoryId != null) {
      // A category the source chose (manual entry, demo seed) is the user's.
      return {
        categoryId: row.categoryId,
        confidence: row.confidence ?? null,
        needsReview: row.needsReview ?? false,
        categorySource: "user",
        via: null,
      };
    }
    const match = matchDeterministic(row, rules, idBySlug);
    if (!match) {
      return {
        categoryId: null,
        confidence: null,
        needsReview: true,
        categorySource: null,
        via: null,
      };
    }
    return {
      categoryId: match.categoryId,
      confidence: match.confidence,
      needsReview: false,
      categorySource: match.via,
      via: match.via,
    };
  };
}

function balanceSet(part: AccountIngest): SQL | number | undefined {
  const balance = part.balance ?? { mode: "keep" };
  if (balance.mode === "set") return balance.cents;
  if (balance.mode === "sum") {
    return sql`(select coalesce(sum(${transactions.amountCents}), 0) from ${transactions} where ${transactions.accountId} = ${part.accountId})`;
  }
  return undefined;
}

/** Steps 1–6. See the module comment for the guarantees. */
export async function ingestTransactions(input: IngestInput): Promise<IngestResult> {
  const { userId } = input;
  const accountIds = [...new Set(input.accounts.map((a) => a.accountId))];
  const relinkedThrough = await assertOwnsAccounts(userId, accountIds);

  const categorize = await makeCategorizer(userId);
  const result: IngestResult = {
    inserted: 0,
    duplicates: 0,
    insertedIds: [],
    ruleMatched: 0,
    keywordMatched: 0,
  };

  for (const part of input.accounts) {
    let rows = withOccurrenceOrdinals(part.rows);
    const through = relinkedThrough.get(part.accountId);
    if (through) {
      const kept = await dropRelinkOverlap(part.accountId, rows, through);
      result.duplicates += rows.length - kept.length;
      rows = kept;
    }
    const viaByExternalId = new Map<string, Categorized["via"]>();
    const values: NewTransactionRow[] = rows.map((row) => {
      const { via, ...category } = categorize(row);
      viaByExternalId.set(row.externalId, via);
      return {
        userId,
        accountId: part.accountId,
        importBatchId: input.importBatchId ?? null,
        gocardlessTransactionId: row.externalId,
        bookingDate: row.bookingDate,
        valueDate: row.valueDate ?? null,
        amountCents: row.amountCents,
        currency: row.currency,
        merchantName: row.merchantName,
        rawDescription: row.rawDescription,
        isRecurring: row.isRecurring ?? false,
        ...category,
      };
    });

    const inserted = await insertTransactionsIdempotent(values);
    result.inserted += inserted.length;
    result.duplicates += values.length - inserted.length;
    for (const r of inserted) {
      result.insertedIds.push(r.id);
      const via = viaByExternalId.get(r.externalId);
      if (via === "rule") result.ruleMatched++;
      else if (via === "keyword") result.keywordMatched++;
    }
  }

  await finalize(input, result);

  await refreshDerivedData(userId, { newRows: result.inserted > 0, source: input.source });
  return result;
}

/** Step 5: everything that marks the run as done, in one atomic batch. */
async function finalize(input: IngestInput, result: IngestResult): Promise<void> {
  const now = new Date();
  const statements: BatchItem<"sqlite">[] = input.accounts.map((part) => {
    const balanceCents = balanceSet(part);
    return db
      .update(accounts)
      .set({
        lastSyncedAt: now,
        ...(balanceCents !== undefined ? { balanceCents } : {}),
        ...(part.currency ? { currency: part.currency } : {}),
      })
      .where(and(eq(accounts.userId, input.userId), eq(accounts.id, part.accountId)));
  });
  if (input.importBatchId != null) {
    statements.push(
      db
        .update(importBatches)
        .set({
          rowsInserted: result.inserted,
          rowsDuplicate: result.duplicates,
          status: "complete",
        })
        .where(
          and(eq(importBatches.userId, input.userId), eq(importBatches.id, input.importBatchId)),
        ),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

export interface DerivedDataResult {
  recurring: number | null;
  transfers: number;
  snapshots: number;
  failed: ("recurring" | "transfers" | "snapshot")[];
}

/**
 * Step 6, shared by every source and by the scheduled job: recurring
 * subscriptions, then internal transfers, then today's balance snapshot.
 *
 * Each step is a function of committed rows, so a failure is logged and left
 * for the next ingest or cron run to repair; it never fails the ingest.
 *
 * Recurring detection runs when rows were inserted, and on the daily job (so
 * data from before automatic detection is picked up, and a series that
 * stopped turns inactive). It reconciles by series key, so ids and the
 * user's pause/resume survive every run.
 */
export async function refreshDerivedData(
  userId: number,
  opts: { newRows: boolean; source?: IngestSource | "cron" },
): Promise<DerivedDataResult> {
  const out: DerivedDataResult = { recurring: null, transfers: 0, snapshots: 0, failed: [] };
  const step = async <T>(name: DerivedDataResult["failed"][number], fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      out.failed.push(name);
      console.warn(`post-ingest ${name} failed (non-fatal)`, opts.source ?? "", err);
      return null;
    }
  };

  if (opts.newRows || opts.source === "cron") {
    const detected = await step("recurring", () => detectRecurringSubscriptions({ userId }));
    out.recurring = detected ? detected.length : null;
  }
  out.transfers = (await step("transfers", () => detectTransfers({ userId }))) ?? 0;
  out.snapshots = (await step("snapshot", () => snapshotBalances(userId))) ?? 0;
  return out;
}
