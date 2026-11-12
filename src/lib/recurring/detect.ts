import "server-only";

import { and, eq, gte, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db/client";
import { recurringSubscriptions, transactions } from "@/db/schema";

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
 * Persistence reconciles by series key (see `seriesKeyFor`): a series found
 * again keeps its row and id, with its derived fields updated; the user's own
 * pause/resume (`user_status`) is never overwritten; a series no longer found
 * is deleted unless the user set a status on it. One batch per run.
 */

export interface DetectedSubscription {
  /** Direction + normalized merchant; identifies the series across runs. */
  seriesKey: string;
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

/**
 * The series key of a merchant name and an amount's direction: `-` for money
 * out, `+` for money in, then the normalized name. Null when nothing is left
 * after normalizing.
 */
export function seriesKeyFor(merchant: string, amountCents: number): string | null {
  const base = normalize(merchant);
  return base ? `${amountCents >= 0 ? "+" : "-"}${base}` : null;
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
): Omit<DetectedSubscription, "seriesKey"> | null {
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
 * Idempotent: rows are reconciled by series key (`reconcile` below), so ids
 * are stable across runs and the user's pause/resume survives them.
 *
 * `lookbackDays` defaults to 270 (~9 months), not the cadence span itself.
 * `MIN_OCCURRENCES` is evaluated only on transactions inside this window, so a
 * monthly subscription that quietly lapsed needs at least 3 of its charges to
 * still fall within it — with a 180-day window, a series whose last charge was
 * more than ~150 days ago keeps only 1-2 charges in range and silently stops
 * being detected at all (not just marked inactive). 270 days gives a monthly
 * series several months of slack after it stops before it drops out of view
 * entirely; it still won't catch quarterly/yearly cadences reliably (those
 * need a much longer window to accumulate 3 occurrences) — pass a larger
 * `lookbackDays` explicitly if that's needed.
 */
export async function detectRecurringSubscriptions(
  opts: DetectOptions,
): Promise<DetectedSubscription[]> {
  const { userId } = opts;
  const lookbackDays = opts.lookbackDays ?? 270;
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
    const key = seriesKeyFor(display, r.amountCents);
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
  for (const [seriesKey, g] of groups) {
    const result = evaluateMerchant(g.display, g.txs, now);
    if (result) detected.push({ seriesKey, ...result });
  }

  await reconcile(userId, detected);
  return detected;
}

/**
 * Bring the user's rows in line with `detected`, in one batch:
 *  1. rows from before series keys get theirs (keeping their id) when their
 *     series was found again;
 *  2. every detected series is upserted on `(user_id, series_key)`; the
 *     effective `is_active` is the user's status when set, else detection's;
 *  3. rows whose series was not found are deleted, unless the user set a
 *     status on them.
 */
async function reconcile(userId: number, detected: DetectedSubscription[]): Promise<void> {
  const keys = new Set(detected.map((d) => d.seriesKey));
  const existing = await db
    .select({
      id: recurringSubscriptions.id,
      seriesKey: recurringSubscriptions.seriesKey,
      merchantName: recurringSubscriptions.merchantName,
      averageAmountCents: recurringSubscriptions.averageAmountCents,
    })
    .from(recurringSubscriptions)
    .where(eq(recurringSubscriptions.userId, userId));

  // 1. Stored convention: positive average = money out, so negate for the key.
  const taken = new Set(existing.flatMap((r) => (r.seriesKey ? [r.seriesKey] : [])));
  const adoptKey: BatchItem<"sqlite">[] = [];
  for (const r of existing) {
    if (r.seriesKey) continue;
    const key = seriesKeyFor(r.merchantName, -r.averageAmountCents);
    if (!key || !keys.has(key) || taken.has(key)) continue;
    taken.add(key);
    adoptKey.push(
      db
        .update(recurringSubscriptions)
        .set({ seriesKey: key })
        .where(
          and(
            eq(recurringSubscriptions.userId, userId),
            eq(recurringSubscriptions.id, r.id),
            isNull(recurringSubscriptions.seriesKey),
          ),
        ),
    );
  }

  // 2.
  const upserts = detected.map((d) =>
    db
      .insert(recurringSubscriptions)
      .values({
        userId,
        seriesKey: d.seriesKey,
        merchantName: d.merchantName,
        averageAmountCents: d.averageAmountCents,
        frequencyDays: d.frequencyDays,
        lastSeenAt: d.lastSeenAt,
        categoryId: d.categoryId,
        isActive: d.isActive,
      })
      .onConflictDoUpdate({
        target: [recurringSubscriptions.userId, recurringSubscriptions.seriesKey],
        set: {
          merchantName: d.merchantName,
          averageAmountCents: d.averageAmountCents,
          frequencyDays: d.frequencyDays,
          lastSeenAt: d.lastSeenAt,
          categoryId: d.categoryId,
          isActive: sql`case when "recurring_subscriptions"."user_status" is null then excluded."is_active" else "recurring_subscriptions"."user_status" = 'active' end`,
        },
      }),
  );

  // 3.
  const vanished = db
    .delete(recurringSubscriptions)
    .where(
      and(
        eq(recurringSubscriptions.userId, userId),
        isNull(recurringSubscriptions.userStatus),
        keys.size > 0
          ? or(
              isNull(recurringSubscriptions.seriesKey),
              notInArray(recurringSubscriptions.seriesKey, [...keys]),
            )
          : undefined,
      ),
    );

  const [first, ...rest] = [...adoptKey, ...upserts];
  await db.batch(first ? [first, ...rest, vanished] : [vanished]);
}
