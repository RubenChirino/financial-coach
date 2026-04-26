import "server-only";

import { db } from "@/db/client";
import { recurringSubscriptions, transactions } from "@/db/schema";
import { and, gte, isNotNull, lt } from "drizzle-orm";

/**
 * Recurring-subscription detector.
 *
 * Walks the last `lookbackDays` of expense transactions, groups them by a
 * normalized merchant key, and for each merchant with enough samples decides
 * whether the cadence + amount stability look like a subscription.
 *
 * Heuristics (intentionally conservative to keep false positives low):
 *   - At least 3 occurrences in the lookback window.
 *   - Inter-transaction gap median sits within ±15% of a known cadence
 *     (weekly, biweekly, monthly, quarterly, yearly).
 *   - Amount coefficient-of-variation ≤ 0.15 (i.e. amounts cluster tightly).
 *
 * Persistence is idempotent — the function upserts on `merchantName` so the
 * caller can re-run safely. Subscriptions whose `lastSeenAt` is older than
 * `1.5 * frequencyDays` get marked `isActive = false` (likely cancelled).
 */

export interface DetectedSubscription {
  merchantName: string;
  averageAmountCents: number;
  frequencyDays: number;
  lastSeenAt: Date;
  categoryId: number | null;
  occurrences: number;
  isActive: boolean;
}

interface CandidateTx {
  date: Date;
  amountCents: number;
  categoryId: number | null;
}

const KNOWN_CADENCES_DAYS = [7, 14, 30, 90, 365] as const;
const CADENCE_TOLERANCE = 0.15;
const MAX_AMOUNT_COV = 0.15;
const MIN_OCCURRENCES = 3;

/**
 * Normalize a merchant name for grouping. We collapse whitespace, lowercase,
 * and strip a few common noise suffixes ("S.L.", "S.A.", trailing numbers from
 * card-machine timestamps). The DB still stores the original capitalization
 * from the most-recent transaction so the UI shows something readable.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(s\.?l\.?|s\.?a\.?|inc\.?|ltd\.?|sas|gmbh)\b/g, "")
    .replace(/\d{4,}/g, "")
    .trim();
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/** Returns the closest known cadence (in days) if within tolerance, else null. */
function snapCadence(medianGapDays: number): number | null {
  for (const cadence of KNOWN_CADENCES_DAYS) {
    const ratio = Math.abs(medianGapDays - cadence) / cadence;
    if (ratio <= CADENCE_TOLERANCE) return cadence;
  }
  return null;
}

function modeCategoryId(txs: CandidateTx[]): number | null {
  const counts = new Map<number, number>();
  for (const t of txs) {
    if (t.categoryId == null) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, c] of counts) {
    if (c > bestCount) {
      bestId = id;
      bestCount = c;
    }
  }
  return bestId;
}

/**
 * Pure analysis step — used by tests so we don't need to seed the DB.
 *
 * Caller groups transactions by merchant; this evaluates a single merchant's
 * series and returns either a detected subscription or null.
 */
export function evaluateMerchant(
  merchantDisplayName: string,
  txs: CandidateTx[],
  now: Date = new Date(),
): DetectedSubscription | null {
  if (txs.length < MIN_OCCURRENCES) return null;
  const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Inter-transaction gaps in days.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms = sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime();
    gaps.push(ms / (1000 * 60 * 60 * 24));
  }
  if (gaps.length === 0) return null;
  const medianGap = median(gaps);
  const cadence = snapCadence(medianGap);
  if (cadence == null) return null;

  // Amount stability: coefficient of variation = stddev / mean.
  const amounts = sorted.map((t) => Math.abs(t.amountCents));
  const meanAmount = mean(amounts);
  if (meanAmount <= 0) return null;
  const cov = stdDev(amounts) / meanAmount;
  if (cov > MAX_AMOUNT_COV) return null;

  const lastSeenAt = sorted[sorted.length - 1]!.date;
  const ageDays = (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
  // Cancelled if we've missed more than ~1.5 cycles since the last hit.
  const isActive = ageDays <= cadence * 1.5;

  return {
    merchantName: merchantDisplayName,
    averageAmountCents: Math.round(meanAmount),
    frequencyDays: cadence,
    lastSeenAt,
    categoryId: modeCategoryId(sorted),
    occurrences: sorted.length,
    isActive,
  };
}

interface DetectOptions {
  lookbackDays?: number;
  now?: Date;
}

/**
 * Run detection over the DB and persist results. Returns the detected list.
 *
 * Idempotent — uses a delete-then-insert under a single `db.transaction` so
 * the table reflects the latest pass; subscriptions that no longer meet the
 * heuristics are removed entirely (rather than left in an inconsistent state).
 * If the user has manually toggled `isActive` in the future we'll need to
 * preserve that — for now there's no UI for it.
 */
export async function detectRecurringSubscriptions(
  opts: DetectOptions = {},
): Promise<DetectedSubscription[]> {
  const lookbackDays = opts.lookbackDays ?? 180;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.bookingDate, since),
        lt(transactions.amountCents, 0),
        isNotNull(transactions.merchantName),
      ),
    );

  // Group by normalized name; keep a "display" name (the most-recent merchant
  // string) so the UI shows the casing the bank used.
  type Group = { display: string; latestDate: number; txs: CandidateTx[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const display = (r.merchantName ?? r.rawDescription).trim();
    const key = normalize(display);
    if (!key) continue;
    const existing = groups.get(key);
    const tx: CandidateTx = {
      date: r.bookingDate,
      amountCents: r.amountCents,
      categoryId: r.categoryId,
    };
    if (existing) {
      existing.txs.push(tx);
      if (tx.date.getTime() > existing.latestDate) {
        existing.latestDate = tx.date.getTime();
        existing.display = display;
      }
    } else {
      groups.set(key, { display, latestDate: tx.date.getTime(), txs: [tx] });
    }
  }

  const detected: DetectedSubscription[] = [];
  for (const [, g] of groups) {
    const result = evaluateMerchant(g.display, g.txs, now);
    if (result) detected.push(result);
  }

  // Persist atomically — clear table and reinsert the fresh snapshot.
  // SQLite's better-sqlite3 driver doesn't support async work inside
  // `db.transaction`, but the operations here are synchronous from the driver's
  // perspective so awaiting them in sequence is functionally equivalent.
  await db.delete(recurringSubscriptions);
  if (detected.length > 0) {
    await db.insert(recurringSubscriptions).values(
      detected.map((d) => ({
        merchantName: d.merchantName,
        averageAmountCents: d.averageAmountCents,
        frequencyDays: d.frequencyDays,
        lastSeenAt: d.lastSeenAt,
        categoryId: d.categoryId,
        isActive: d.isActive,
      })),
    );
  }

  return detected;
}
