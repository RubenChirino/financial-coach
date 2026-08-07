import "server-only";

import { generateText, type LanguageModel } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { travelCityLabels } from "@/db/schema";

export type CitySource = "ai" | "user";

export interface CityLabel {
  city: string;
  source: CitySource;
}

/**
 * Load persisted city labels for the given trip keys in a single query.
 * Returns a Map keyed by tripKey; trips without a label are simply absent.
 */
export async function getCityLabels(
  userId: number,
  tripKeys: string[],
): Promise<Map<string, CityLabel>> {
  const result = new Map<string, CityLabel>();
  if (tripKeys.length === 0) return result;

  const rows = await db
    .select({
      tripKey: travelCityLabels.tripKey,
      city: travelCityLabels.city,
      source: travelCityLabels.source,
    })
    .from(travelCityLabels)
    .where(and(eq(travelCityLabels.userId, userId), inArray(travelCityLabels.tripKey, tripKeys)));

  for (const r of rows) {
    result.set(r.tripKey, { city: r.city, source: r.source as CitySource });
  }
  return result;
}

/**
 * Upsert a city label. A `user` source always wins, so an AI guess never
 * overwrites a city the user typed (the caller enforces this before calling
 * with `source = "ai"`).
 */
export async function upsertCity(
  userId: number,
  tripKey: string,
  city: string,
  source: CitySource,
): Promise<void> {
  await db
    .insert(travelCityLabels)
    .values({ userId, tripKey, city, source })
    .onConflictDoUpdate({
      target: [travelCityLabels.userId, travelCityLabels.tripKey],
      set: { city, source, updatedAt: new Date() },
    });
}

/**
 * Ask the LLM to name the city a trip most likely took place in, from its
 * merchant names. Returns null when the model can't tell (no hallucinated
 * guesses) or the output doesn't look like a plausible city name.
 */
export async function generateCity(args: {
  model: LanguageModel;
  country: string;
  currency: string;
  merchantNames: string[];
}): Promise<string | null> {
  const { model, country, currency, merchantNames } = args;
  if (merchantNames.length === 0) return null;

  const list = merchantNames.slice(0, 30).join("\n");
  const prompt = `These card payments were made during a single trip, in ${currency} (likely in ${country}).
Merchant names / descriptions:
${list}

What single city was this trip most likely in? Use the merchant text for clues (many include a city or area name).
Reply with ONLY the city name (no country, no punctuation, no extra words).
If you genuinely cannot tell, reply exactly: UNKNOWN`;

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0,
      maxOutputTokens: 24,
    });
    const city = text.trim().replace(/[.;,]+$/, "");
    if (!city || /unknown/i.test(city)) return null;
    // Guard against the model returning a sentence instead of a city name.
    if (city.length > 40 || city.split(/\s+/).length > 4) return null;
    return city;
  } catch {
    // LLM unreachable / errored — fall back to no city. Caller stays usable.
    return null;
  }
}
