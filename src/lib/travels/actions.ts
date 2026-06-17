"use server";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getUser, updateUserHomeLocation } from "@/lib/auth/user";
import { getLanguageModel, providerInfo } from "@/lib/llm/provider";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateCity, getCityLabels, upsertCity } from "./city";
import { countryName } from "./countries";
import { listTravels } from "./detect";
import { type CityBatchResult, countTravelCities, resolveCityBatch } from "./sync";

export interface CityActionResult {
  ok: boolean;
  city?: string | null;
  error?: string;
}

const MAX_CITY_LEN = 60;

async function loadUser(userId: number) {
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

/** Save a user-typed city for a trip. Empty/blank clears nothing — use a value. */
export async function setCityAction(tripKey: string, city: string): Promise<CityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const trimmed = city.trim();
  if (!trimmed || trimmed.length > MAX_CITY_LEN) {
    return { ok: false, error: "invalidCity" };
  }

  await upsertCity(tripKey, trimmed, "user");
  revalidatePath("/travels");
  return { ok: true, city: trimmed };
}

/**
 * Guess a trip's city with the LLM and cache it. Gated by the same cloud
 * consent rule as the advisor chat. Never overwrites a city the user typed.
 */
export async function guessCityAction(tripKey: string): Promise<CityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const user = await loadUser(session.userId);
  if (!user) return { ok: false, error: "userNotFound" };
  if (!user.homeCountry) return { ok: false, error: "homeNotSet" };

  const prefs = { provider: user.llmProvider, model: user.llmModel };
  const info = providerInfo(prefs);
  if (!info.isLocal && user.cloudLlmConsentAt == null) {
    return { ok: false, error: "cloudConsentRequired" };
  }

  // A city the user set by hand always wins — don't spend an LLM call.
  const existing = await getCityLabels([tripKey]);
  if (existing.get(tripKey)?.source === "user") {
    return { ok: true, city: existing.get(tripKey)?.city ?? null };
  }

  const trip = (await listTravels({ homeCountry: user.homeCountry, homeCity: user.homeCity })).find(
    (t) => t.tripKey === tripKey,
  );
  if (!trip) return { ok: false, error: "tripNotFound" };

  const { model } = getLanguageModel(prefs);
  const city = await generateCity({
    model,
    country: countryName(trip.countryCode, "en"),
    currency: trip.currency,
    merchantNames: trip.merchantNames,
  });

  if (city) await upsertCity(tripKey, city, "ai");
  revalidatePath("/travels");
  return { ok: true, city };
}

export interface TravelCountResult {
  ok: boolean;
  count?: number;
  error?: string;
}

/** How many places the "detect trips" run will scan — sizes the progress bar. */
export async function countTravelCitiesAction(): Promise<TravelCountResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  const user = await loadUser(session.userId);
  if (!user?.homeCountry) return { ok: true, count: 0 };
  try {
    return { ok: true, count: await countTravelCities(user.homeCountry) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

export interface TravelBatchResult extends Partial<CityBatchResult> {
  ok: boolean;
  error?: string;
}

/**
 * Resolve one forward batch of places to countries (caching them) so newly
 * detected foreign payments surface as trips. Called in a loop by the
 * background "detect trips" card. Uses the LLM when available/consented; the
 * home country biases it so home-country towns aren't sent abroad.
 */
export async function resolveTravelCitiesBatchAction(opts: {
  afterKey?: string;
  limit?: number;
}): Promise<TravelBatchResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const user = await loadUser(session.userId);
  if (!user) return { ok: false, error: "userNotFound" };
  if (!user.homeCountry) return { ok: true, scanned: 0, resolved: 0, hasMore: false };

  const prefs = { provider: user.llmProvider, model: user.llmModel };
  const info = providerInfo(prefs);
  const aiAllowed = info.isLocal || user.cloudLlmConsentAt != null;
  const model = aiAllowed ? getLanguageModel(prefs).model : null;

  try {
    const res = await resolveCityBatch({
      afterKey: opts.afterKey,
      limit: opts.limit,
      model,
      homeCountry: user.homeCountry,
    });
    if (!res.hasMore) revalidatePath("/travels");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

export interface HomeLocationResult {
  ok: boolean;
  error?: string;
}

/** Persist the user's home city + country (ISO alpha-2). Country is required. */
export async function setHomeLocationAction(
  city: string,
  countryCode: string,
): Promise<HomeLocationResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const cc = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return { ok: false, error: "invalidCountry" };
  const trimmedCity = city.trim().slice(0, MAX_CITY_LEN) || null;

  const user = await getUser();
  if (!user) return { ok: false, error: "userNotFound" };

  await updateUserHomeLocation(user.id, trimmedCity, cc);
  revalidatePath("/travels");
  revalidatePath("/settings");
  return { ok: true };
}
