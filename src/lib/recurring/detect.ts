import "server-only";

import { db } from "@/db/client";
import { recurringSubscriptions, transactions } from "@/db/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";

/**
 * Recurring-subscription detector.
 *
 * Walks the last `lookbackDays` of transactions, groups them by a normalized
 * merchant key (separately for inflows and outflows so the same name can hold
 * both), and for each group with enough samples decides whether the cadence +
 * amount stability look like a recurring charge or recurring deposit.
 *
 * Heuristics (intentionally conservative to keep false positives low):
 *   - At least 3 occurrences in the lookback window.
 *   - Inter-transaction gap median sits within ±15% of a known cadence
 *     (weekly, biweekly, monthly, quarterly, yearly).
 *   - Amount coefficient-of-variation ≤ 0.15 for outflows, ≤ 0.05 for
 *     inflows (payroll deposits are exceptionally stable; we don't want to
 *     accidentally mark "received cash from a friend" as a salary).
 *
 * Sign convention in the persisted row (preserved for backwards-compat with
 * the original "expense subscription" model): `averageAmountCents` is
 * POSITIVE for recurring outflows (e.g. Netflix) and NEGATIVE for recurring
 * inflows (e.g. payroll). The forecast layer reads the sign to bucket each
 * row into income vs spending.
 *
 * Persistence is idempotent — the function delete-and-reinserts under a
 * single transaction so the table reflects the latest pass.
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
const MAX_AMOUNT_COV_OUT = 0.15;
// Salary-style deposits are very stable; tighter CoV avoids classifying ad-hoc
// transfers from friends/family as "recurring income".
const MAX_AMOUNT_COV_IN = 0.05;
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
 * Caller groups transactions by merchant AND sign (don't mix inflows with
 * outflows — they're independent series); this evaluates a single series and
 * returns either a detected subscription or null.
 *
 * The returned `averageAmountCents` is POSITIVE for outflow series and
 * NEGATIVE for inflow series (this is the existing storage convention; the
 * forecast layer reads the sign to know which bucket to add the value to).
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

  // The series is single-signed per the caller contract. Persisted convention:
  // positive = outflow, negative = inflow — so we flip the source sign.
  const isInflow = sorted[0]!.amountCents > 0;
  const storedSign = isInflow ? -1 : 1;

  // Amount stability: coefficient of variation = stddev / mean (on absolute
  // values so the sign convention doesn't break the math).
  const amounts = sorted.map((t) => Math.abs(t.amountCents));
  const meanAmount = mean(amounts);
  if (meanAmount <= 0) return null;
  const cov = stdDev(amounts) / meanAmount;
  const maxCov = isInflow ? MAX_AMOUNT_COV_IN : MAX_AMOUNT_COV_OUT;
  if (cov > maxCov) return null;

  const lastSeenAt = sorted[sorted.length - 1]!.date;
  const ageDays = (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
  // Cancelled if we've missed more than ~1.5 cycles since the last hit.
  const isActive = ageDays <= cadence * 1.5;

  return {
    merchantName: merchantDisplayName,
    averageAmountCents: Math.round(meanAmount) * storedSign,
    frequencyDays: cadence,
    lastSeenAt,
    categoryId: modeCategoryId(sorted),
    occurrences: sorted.length,
    isActive,
  };
}

interface DetectOptions {
  /** Owner whose transactions/subscriptions this pass operates on. */
  userId: number;
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
  opts: DetectOptions,
): Promise<DetectedSubscription[]> {
  const { userId } = opts;
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
        eq(transactions.userId, userId),
        gte(transactions.bookingDate, since),
        isNotNull(transactions.merchantName),
      ),
    );

  // Group by normalized merchant name AND sign — a series mixing inflows and
  // outflows under the same merchant (e.g. a refund) would corrupt the cadence
  // / stability stats. Keying with a sign suffix keeps them independent.
  type Group = { display: string; latestDate: number; txs: CandidateTx[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (r.amountCents === 0) continue;
    const display = (r.merchantName ?? r.rawDescription).trim();
    const baseKey = normalize(display);
    if (!baseKey) continue;
    const key = `${r.amountCents >= 0 ? "+" : "-"}${baseKey}`;
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

  // Persist — clear THIS USER's rows and reinsert their fresh snapshot.
  // Scoped to `userId` so a pass for one user never wipes another's
  // subscriptions. Sequenced rather than wrapped in a transaction; libSQL's
  // HTTP-mode client treats individual statements as autocommitting, and the
  // delete-then-insert window is short.
  await db.delete(recurringSubscriptions).where(eq(recurringSubscriptions.userId, userId));
  if (detected.length > 0) {
    await db.insert(recurringSubscriptions).values(
      detected.map((d) => ({
        userId,
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
