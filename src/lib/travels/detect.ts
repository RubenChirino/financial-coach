import "server-only";

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { and, asc, eq, ne } from "drizzle-orm";
import { type CountryGuess, currencyToCountry } from "./currency-country";

/** A single payment that belongs to a detected trip. */
export interface TravelTransaction {
  id: number;
  bookingDate: Date;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
}

/** A detected trip: a cluster of foreign-currency payments close in time. */
export interface Travel extends CountryGuess {
  /** `${currency}:${startEpochDay}` — stable id for `?id=` + city-label FK. */
  tripKey: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  /** Sum of money spent (outflows), as a positive cents value, native currency. */
  totalSpentCents: number;
  txCount: number;
  /** Distinct merchant names — the input for the LLM city guess. */
  merchantNames: string[];
  transactions: TravelTransaction[];
}

/** Max gap (days) between consecutive foreign payments before we split trips. */
export const TRIP_GAP_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const epochDay = (d: Date) => Math.floor(d.getTime() / MS_PER_DAY);

/**
 * Detect trips from the user's transaction history.
 *
 * A trip = foreign-currency payments (currency ≠ home currency) clustered by
 * currency and by time proximity. Recurring charges are excluded so a monthly
 * foreign SaaS subscription doesn't masquerade as travel.
 *
 * Trips are NOT persisted — this recomputes on every call. The result is sorted
 * newest-first.
 */
export async function listTravels(opts?: { homeCurrency?: string }): Promise<Travel[]> {
  const homeCurrency = opts?.homeCurrency ?? (await getAccountsTotal()).currency;

  const rows = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      merchantName: transactions.merchantName,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(and(ne(transactions.currency, homeCurrency), eq(transactions.isRecurring, false)))
    .orderBy(asc(transactions.bookingDate));

  // 1. Bucket by currency — a different currency means a different country and
  //    therefore a separate trip, even if the dates overlap.
  const byCurrency = new Map<string, TravelTransaction[]>();
  for (const r of rows) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push(r);
    byCurrency.set(r.currency, list);
  }

  const travels: Travel[] = [];
  for (const [currency, txs] of byCurrency) {
    // 2. Split each currency's payments into clusters on date gaps.
    let cluster: TravelTransaction[] = [];
    const flush = () => {
      const trip = buildTrip(currency, cluster);
      if (trip) travels.push(trip);
      cluster = [];
    };
    for (const tx of txs) {
      const prev = cluster[cluster.length - 1];
      if (
        prev &&
        (tx.bookingDate.getTime() - prev.bookingDate.getTime()) / MS_PER_DAY > TRIP_GAP_DAYS
      ) {
        flush();
      }
      cluster.push(tx);
    }
    flush();
  }

  // Newest trips first.
  travels.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return travels;
}

/**
 * Turn a time-contiguous cluster of foreign payments into a Travel, or return
 * null when it doesn't look like a real trip (a lone foreign charge on a single
 * day is more likely an online purchase than travel).
 */
function buildTrip(currency: string, cluster: TravelTransaction[]): Travel | null {
  if (cluster.length === 0) return null;

  const distinctDays = new Set(cluster.map((t) => epochDay(t.bookingDate))).size;
  // Keep only clusters that look like travel: several payments, or spending
  // spread across more than one day.
  if (cluster.length < 3 && distinctDays < 2) return null;

  const startDate = cluster[0]!.bookingDate;
  const endDate = cluster[cluster.length - 1]!.bookingDate;
  const totalSpentCents = cluster.reduce(
    (sum, t) => sum + (t.amountCents < 0 ? -t.amountCents : 0),
    0,
  );
  const merchantNames = [
    ...new Set(
      cluster
        .map((t) => (t.merchantName ?? t.rawDescription).trim())
        .filter((name) => name.length > 0),
    ),
  ];

  const country = currencyToCountry(currency);
  return {
    tripKey: `${currency}:${epochDay(startDate)}`,
    currency,
    startDate,
    endDate,
    totalSpentCents,
    txCount: cluster.length,
    merchantNames,
    transactions: cluster,
    ...country,
  };
}
