import "server-only";

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { asc, eq } from "drizzle-orm";
import { currencyToCountryCode, flagFromCode } from "./countries";
import { type ResolvedCity, getCachedCities } from "./locations";
import { isOnlinePayment } from "./online-merchants";
import { cityKey, explicitCityCountries, parseLocation } from "./parse-location";

/** A single payment that belongs to a detected trip. */
export interface TravelTransaction {
  id: number;
  bookingDate: Date;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
  /** City parsed from the description, when present. */
  city: string | null;
}

/** A detected trip: a cluster of payments in one place, close in time. */
export interface Travel {
  /** Stable id for `?id=` + city-label FK. */
  tripKey: string;
  countryCode: string;
  /**
   * Autonomous community / region for a *domestic* trip (outside the home
   * region but inside the home country); null for a foreign trip.
   */
  region: string | null;
  flag: string;
  /** Dominant city parsed from the trip's payments, or null. */
  city: string | null;
  /** Representative currency for formatting the total (usually the home one). */
  currency: string;
  startDate: Date;
  endDate: Date;
  /** Sum of money spent (outflows), positive cents, in `currency`. */
  totalSpentCents: number;
  txCount: number;
  /** Distinct merchant names — input for the LLM city label guess. */
  merchantNames: string[];
  transactions: TravelTransaction[];
}

/** Max gap (days) between consecutive payments before we split trips. */
export const TRIP_GAP_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const epochDay = (d: Date) => Math.floor(d.getTime() / MS_PER_DAY);

interface Candidate extends TravelTransaction {
  countryCode: string;
  /** Region for a domestic trip; null for foreign. */
  region: string | null;
  /** Grouping key: foreign → country, domestic → region. */
  placeKey: string;
}

/**
 * Resolve a payment's country (uppercase ISO code), or null when unknown.
 * Order: explicit code in the text → the user's own self-learned city map →
 * the AI cache → a foreign transaction currency.
 */
function resolveCountryCode(args: {
  loc: { city: string | null; countryCode: string | null };
  currency: string;
  homeCurrency: string;
  explicit: Map<string, string>;
  cache: Map<string, ResolvedCity>;
}): string | null {
  const { loc, currency, homeCurrency, explicit, cache } = args;
  if (loc.countryCode) return loc.countryCode.toUpperCase();
  if (loc.city) {
    const key = cityKey(loc.city);
    const cc = explicit.get(key) ?? cache.get(key)?.countryCode;
    if (cc) return cc.toUpperCase();
  }
  if (currency !== homeCurrency) {
    const cc = currencyToCountryCode(currency);
    if (cc) return cc.toUpperCase();
  }
  return null;
}

interface ClassifyCtx {
  homeCountry: string;
  homeCurrency: string;
  homeRegion: string | null;
  explicit: Map<string, string>;
  cache: Map<string, ResolvedCity>;
}

/**
 * Classify one payment as an "away from home" candidate (foreign country, or a
 * different home-country region) or null when it's home spending / unknown /
 * online.
 */
function classifyPayment(
  row: { merchantName: string | null; rawDescription: string; currency: string } & Omit<
    TravelTransaction,
    "city"
  >,
  loc: { city: string | null; countryCode: string | null },
  ctx: ClassifyCtx,
): Candidate | null {
  if (isOnlinePayment(row.merchantName, row.rawDescription)) return null;
  const cc = resolveCountryCode({
    loc,
    currency: row.currency,
    homeCurrency: ctx.homeCurrency,
    explicit: ctx.explicit,
    cache: ctx.cache,
  });
  if (!cc) return null;

  if (cc !== ctx.homeCountry) {
    return { ...row, city: loc.city, countryCode: cc, region: null, placeKey: `C:${cc}` };
  }
  // Domestic: only a trip when we know both regions and they differ.
  if (!ctx.homeRegion || !loc.city) return null;
  const region = ctx.cache.get(cityKey(loc.city))?.region ?? null;
  if (!region || region === ctx.homeRegion) return null;
  return { ...row, city: loc.city, countryCode: cc, region, placeKey: `R:${region}` };
}

/**
 * Detect trips: payments away from home, clustered by place and time proximity.
 *
 * A payment counts as a trip when it is either:
 *   - in a different COUNTRY than home, or
 *   - in the home country but a different REGION (autonomous community) than the
 *     user's home region — e.g. a Madrid resident's spending in Galicia or País
 *     Vasco.
 *
 * Foreign payments are grouped by country; domestic ones by region (so a Camino
 * de Santiago across several Galician towns reads as one "Galicia" trip).
 * Online charges and recurring charges are excluded. Trips are recomputed on
 * every call (not persisted) and returned newest-first.
 */
export async function listTravels(opts: {
  homeCountry: string;
  homeCity?: string | null;
  homeCurrency?: string;
}): Promise<Travel[]> {
  const homeCountry = opts.homeCountry.toUpperCase();
  const homeCurrency = opts.homeCurrency ?? (await getAccountsTotal()).currency;

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
    .where(eq(transactions.isRecurring, false))
    .orderBy(asc(transactions.bookingDate));

  const parsedByRow = rows.map((r) => parseLocation(r.rawDescription));
  // Ground truth from the user's own explicit "City Cc" rows — trusted above the
  // AI cache so a Spanish town that also exists abroad (Córdoba, León, Santiago…)
  // is never mis-flagged as a trip.
  const explicit = explicitCityCountries(parsedByRow);
  // Cache covers every parsed city (we need the region of home-country cities to
  // separate domestic trips from home spending), plus the home city itself.
  const allCityKeys = new Set(parsedByRow.filter((p) => p.city).map((p) => cityKey(p.city!)));
  const homeCityKey = opts.homeCity ? cityKey(opts.homeCity) : null;
  if (homeCityKey) allCityKeys.add(homeCityKey);
  const cache = await getCachedCities([...allCityKeys]);
  const homeRegion = homeCityKey ? (cache.get(homeCityKey)?.region ?? null) : null;

  // Keep only "away from home" payments, tagged with their place.
  const ctx: ClassifyCtx = { homeCountry, homeCurrency, homeRegion, explicit, cache };
  const away: Candidate[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cand = classifyPayment(rows[i]!, parsedByRow[i]!, ctx);
    if (cand) away.push(cand);
  }

  // Bucket by place, then split each into clusters on date gaps.
  const byPlace = new Map<string, Candidate[]>();
  for (const c of away) {
    const list = byPlace.get(c.placeKey) ?? [];
    list.push(c);
    byPlace.set(c.placeKey, list);
  }

  const travels: Travel[] = [];
  for (const txs of byPlace.values()) {
    let cluster: Candidate[] = [];
    const flush = () => {
      const trip = buildTrip(cluster);
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

  travels.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return travels;
}

/** Most frequent value in a list, or null when empty. */
function mostFrequent<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function buildTrip(cluster: Candidate[]): Travel | null {
  if (cluster.length === 0) return null;

  const distinctDays = new Set(cluster.map((t) => epochDay(t.bookingDate))).size;
  // Travel looks like several payments, or spending across more than one day —
  // this filters out one-off charges (e.g. a single purchase away from home).
  if (cluster.length < 3 && distinctDays < 2) return null;

  const { countryCode, region } = cluster[0]!;
  const startDate = cluster[0]!.bookingDate;
  const endDate = cluster[cluster.length - 1]!.bookingDate;
  const totalSpentCents = cluster.reduce((s, t) => s + (t.amountCents < 0 ? -t.amountCents : 0), 0);
  const city = mostFrequent(cluster.map((t) => t.city).filter((c): c is string => !!c));
  const currency = mostFrequent(cluster.map((t) => t.currency)) ?? "EUR";
  const merchantNames = [
    ...new Set(
      cluster.map((t) => (t.merchantName ?? t.rawDescription).trim()).filter((n) => n.length > 0),
    ),
  ];

  return {
    tripKey: `${region ?? countryCode}:${epochDay(startDate)}`,
    countryCode,
    region,
    flag: flagFromCode(countryCode),
    city,
    currency,
    startDate,
    endDate,
    totalSpentCents,
    txCount: cluster.length,
    merchantNames,
    transactions: cluster.map(({ countryCode: _cc, region: _r, placeKey: _p, ...t }) => t),
  };
}
