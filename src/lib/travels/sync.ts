import "server-only";

import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { esRegion } from "./es-regions";
import { cacheCities, getCachedCities, type ResolvedCity, resolveCitiesWithAi } from "./locations";
import { isOnlinePayment } from "./online-merchants";
import { cityKey, parseLocation } from "./parse-location";

interface RawTx {
  rawDescription: string;
  merchantName: string | null;
}

async function loadDescriptions(userId: number): Promise<RawTx[]> {
  return db
    .select({
      rawDescription: transactions.rawDescription,
      merchantName: transactions.merchantName,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
}

interface PendingCity {
  key: string;
  label: string;
}

/**
 * Every distinct place named in the user's (non-online) payments — both foreign
 * cities and home-country cities, because we now also need the *region* of home
 * cities to tell a domestic trip from home spending. Online charges are skipped
 * (their embedded city is a billing location, not a place visited). Sorted by
 * key for stable cursor paging.
 */
async function pendingCityKeys(userId: number): Promise<PendingCity[]> {
  const rows = await loadDescriptions(userId);
  const byKey = new Map<string, string>();
  for (const r of rows) {
    if (isOnlinePayment(r.merchantName, r.rawDescription)) continue;
    const loc = parseLocation(r.rawDescription);
    if (!loc.city) continue;
    byKey.set(cityKey(loc.city), loc.city);
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * A place still needs the LLM if it isn't already resolvable. Spanish towns in
 * the static region map are fully known (country ES + community) and never need
 * the LLM. Otherwise it's pending when uncached, or a home-country place still
 * missing its region (needed for domestic-trip detection).
 */
function needsResolution(
  label: string,
  entry: ResolvedCity | undefined,
  homeCountry: string,
): boolean {
  if (esRegion(label)) return false;
  if (!entry) return true;
  return entry.countryCode === homeCountry && entry.region == null;
}

/** Total distinct places the "detect trips" run will scan (sizes the bar). */
export async function countTravelCities(userId: number): Promise<number> {
  return (await pendingCityKeys(userId)).length;
}

export interface CityBatchResult {
  /** Places scanned this batch (resolved + already-cached). */
  scanned: number;
  /** Places newly resolved by the LLM this batch. */
  resolved: number;
  /** Highest place key seen — pass back as `afterKey` to continue. */
  lastKey: string;
  hasMore: boolean;
  aiUsed: boolean;
}

/**
 * Resolve one forward batch of places (key > afterKey) to countries and cache
 * them. Cursor-based on the sorted place keys so the background loop always
 * advances and terminates. `model` null → no AI available; the batch still
 * advances the cursor (resolving nothing) so the run completes.
 */
export async function resolveCityBatch(opts: {
  userId: number;
  afterKey?: string;
  limit?: number;
  model: LanguageModel | null;
  homeCountry: string;
}): Promise<CityBatchResult> {
  const afterKey = opts.afterKey ?? "";
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));

  const all = await pendingCityKeys(opts.userId);
  const slice = all.filter((c) => c.key > afterKey).slice(0, limit);
  if (slice.length === 0) {
    return { scanned: 0, resolved: 0, lastKey: afterKey, hasMore: false, aiUsed: false };
  }
  const lastKey = slice[slice.length - 1]!.key;

  const cached = await getCachedCities(slice.map((c) => c.key));
  const todo = slice.filter((c) => needsResolution(c.label, cached.get(c.key), opts.homeCountry));

  let resolved = 0;
  let aiUsed = false;
  if (todo.length > 0 && opts.model) {
    aiUsed = true;
    const map = await resolveCitiesWithAi(
      opts.model,
      todo.map((c) => c.label),
      opts.homeCountry,
    );
    const entries = [...map.entries()].map(([key, place]) => ({
      key,
      label: todo.find((c) => c.key === key)?.label ?? null,
      countryCode: place.countryCode,
      region: place.region,
      source: "ai" as const,
    }));
    if (entries.length > 0) await cacheCities(entries);
    resolved = entries.length;
  }

  return { scanned: slice.length, resolved, lastKey, hasMore: slice.length === limit, aiUsed };
}

export interface HomeGuess {
  city: string | null;
  countryCode: string | null;
}

/**
 * Infer the user's home base from their transactions: the most frequent country
 * (by parsed/explicit + cached city codes) and the most frequent city within
 * it. Works without AI because the home country is dominated by explicit
 * "City Cc" descriptions. Returns nulls when there's no location signal at all.
 */
export async function inferHomeLocation(userId: number): Promise<HomeGuess> {
  const rows = await loadDescriptions(userId);

  // First gather explicit codes + cities, then enrich city-only with the cache.
  const parsed = rows.map((r) => parseLocation(r.rawDescription));
  const cityOnlyKeys = [
    ...new Set(parsed.filter((p) => p.city && !p.countryCode).map((p) => cityKey(p.city!))),
  ];
  const cached = await getCachedCities(cityOnlyKeys);

  const countryCount = new Map<string, number>();
  const cityByCountry = new Map<string, Map<string, number>>();

  for (const p of parsed) {
    const cc =
      p.countryCode ?? (p.city ? (cached.get(cityKey(p.city))?.countryCode ?? null) : null);
    if (!cc) continue;
    countryCount.set(cc, (countryCount.get(cc) ?? 0) + 1);
    if (p.city) {
      const cities = cityByCountry.get(cc) ?? new Map<string, number>();
      cities.set(p.city, (cities.get(p.city) ?? 0) + 1);
      cityByCountry.set(cc, cities);
    }
  }

  const topCountry = [...countryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!topCountry) return { city: null, countryCode: null };

  const cities = cityByCountry.get(topCountry);
  const topCity = cities
    ? ([...cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
    : null;
  return { city: topCity, countryCode: topCountry };
}
