import "server-only";

import { db } from "@/db/client";
import { cityCountries } from "@/db/schema";
import { type LanguageModel, generateText } from "ai";
import { inArray } from "drizzle-orm";
import { cityKey } from "./parse-location";

export interface ResolvedCity {
  /** ISO-3166 alpha-2, or null when the value isn't a real place. */
  countryCode: string | null;
  /** First-level subdivision (Spanish autonomous community), or null. */
  region: string | null;
  cityLabel: string | null;
}

/**
 * Read cached city resolutions for the given normalized keys. Returned map only
 * contains keys that exist in the cache (including ones resolved to a null
 * country, so callers know not to ask again).
 */
export async function getCachedCities(keys: string[]): Promise<Map<string, ResolvedCity>> {
  const out = new Map<string, ResolvedCity>();
  if (keys.length === 0) return out;
  const rows = await db
    .select({
      key: cityCountries.cityKey,
      cc: cityCountries.countryCode,
      region: cityCountries.region,
      label: cityCountries.cityLabel,
    })
    .from(cityCountries)
    .where(inArray(cityCountries.cityKey, keys));
  for (const r of rows) {
    out.set(r.key, { countryCode: r.cc, region: r.region, cityLabel: r.label });
  }
  return out;
}

/** Bulk upsert resolved cities into the cache. */
export async function cacheCities(
  entries: {
    key: string;
    label: string | null;
    countryCode: string | null;
    region: string | null;
    source: "ai" | "manual";
  }[],
): Promise<void> {
  for (const e of entries) {
    await db
      .insert(cityCountries)
      .values({
        cityKey: e.key,
        cityLabel: e.label,
        countryCode: e.countryCode,
        region: e.region,
        source: e.source,
      })
      .onConflictDoUpdate({
        target: cityCountries.cityKey,
        set: {
          cityLabel: e.label,
          countryCode: e.countryCode,
          region: e.region,
          source: e.source,
          updatedAt: new Date(),
        },
      });
  }
}

export interface AiPlace {
  countryCode: string | null;
  region: string | null;
}

/** The 17 + 2 Spanish autonomous communities — a fixed list keeps the region
 * label consistent across calls so the home-region comparison is reliable. */
const ES_COMMUNITIES = [
  "Andalucía",
  "Aragón",
  "Asturias",
  "Islas Baleares",
  "Canarias",
  "Cantabria",
  "Castilla-La Mancha",
  "Castilla y León",
  "Cataluña",
  "Comunidad Valenciana",
  "Extremadura",
  "Galicia",
  "La Rioja",
  "Madrid",
  "Región de Murcia",
  "Navarra",
  "País Vasco",
  "Ceuta",
  "Melilla",
];

/** Coerce one `{country, region}` entry from the model's JSON into an AiPlace. */
function parsePlace(raw: unknown): AiPlace {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ccRaw = typeof obj.country === "string" ? obj.country : null;
  const countryCode = ccRaw && /^[A-Za-z]{2}$/.test(ccRaw) ? ccRaw.toUpperCase() : null;
  const region = typeof obj.region === "string" && obj.region.trim() ? obj.region.trim() : null;
  return { countryCode, region };
}

/**
 * Ask the LLM to map a batch of place names to a country (ISO-3166 alpha-2) and,
 * for Spanish places, the autonomous community (so we can spot domestic trips
 * outside the user's home community). Returns a map keyed by normalized cityKey.
 *
 * One call per ~50 places; resilient to malformed output (returns what parsed).
 */
export async function resolveCitiesWithAi(
  model: LanguageModel,
  cities: string[],
  homeCountry?: string,
): Promise<Map<string, AiPlace>> {
  const result = new Map<string, AiPlace>();
  const unique = [...new Set(cities)].filter(Boolean);
  if (unique.length === 0) return result;

  const homeCc = homeCountry?.trim().toUpperCase();
  const homeBias =
    homeCc && /^[A-Z]{2}$/.test(homeCc)
      ? `\nThe card holder lives in ${homeCc}. Many place names exist in several countries (e.g. Córdoba, Santiago, León, Valencia, Mérida); if a place is a real city/town in ${homeCc}, use ${homeCc}. Only use a foreign code when the place is clearly NOT in ${homeCc}.`
      : "";

  const BATCH = 50;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const prompt = `For each place name below (taken from card-payment descriptions), return its country and, for places in Spain (ES), its autonomous community.
- "country": ISO-3166 alpha-2 code, or null if the item is NOT a real place (a website, brand, or random text).
- "region": for Spanish places, EXACTLY one of: ${ES_COMMUNITIES.join(", ")}. For non-Spanish places, null.${homeBias}
Return ONLY a JSON object mapping each input string to {"country": "XX"|null, "region": "..."|null}. No prose.

Items:
${JSON.stringify(batch)}`;

    try {
      const { text } = await generateText({ model, prompt, temperature: 0, maxOutputTokens: 2500 });
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      for (const city of batch) {
        result.set(cityKey(city), parsePlace(parsed[city]));
      }
    } catch {
      // Leave this batch unresolved; the sync pass treats missing keys as "not
      // yet known" so a later sync can retry.
    }
  }
  return result;
}
