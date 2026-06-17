/**
 * Extract a place (city + optional ISO country code) from a bank transaction
 * description.
 *
 * Spanish card descriptions embed the location in one of two shapes:
 *   - "Pago Movil En <merchant>, <City> <Cc>, Tarj. :*1234"   → city + country code
 *   - "Compra <merchant>, <City>, Tarjeta 5489…, Comision 0,00" → city only
 *
 * The country code (e.g. "Es", "Gb", "De") is ISO-3166 alpha-2. When only a
 * city is present, the country is resolved later (city→country cache / LLM).
 *
 * This is heuristic and tuned to the common Spanish-bank format; descriptions
 * that don't match return `{ city: null, countryCode: null }`, which simply
 * means "no location signal" — never a crash.
 */
export interface ParsedLocation {
  city: string | null;
  countryCode: string | null;
}

const EMPTY: ParsedLocation = { city: null, countryCode: null };

// "…, <City> <Cc>, Tarj…"  — capture the segment just before ", Tarj".
const CITY_CC_RE = /,\s*([^,]+?)\s+([A-Za-z]{2})\s*,\s*Tarj/i;
// "Compra <merchant>, <City>, Tarjeta…" — city is the segment before ", Tarjeta".
const COMPRA_CITY_RE = /\bCompra\b.*?,\s*([^,]+?)\s*,\s*Tarjeta/i;

// Spanish connector words that look like 2-letter ISO codes but aren't: they
// appear when the bank truncates a long place name ("San Miguel De Salinas" →
// "…San Miguel De, Tarj", "Pozuelo De Alarcón" → "…Pozuelo De, Tarj"). Treating
// "De"/"Al" as Germany/Albania would wrongly send a Spanish town abroad, so we
// reject them as country codes (real DE/AL payments still resolve via the AI
// step on the city name). Lowercase.
const CONNECTOR_CODES = new Set(["de", "al", "la", "el"]);

function cleanCity(raw: string): string | null {
  const city = raw
    .replace(/\s+/g, " ")
    .replace(/[.,;:*]+$/g, "")
    .trim();
  // Reject obvious non-cities: empty, all digits, or online-store domains.
  if (!city) return null;
  if (/^\d+$/.test(city)) return null;
  if (/\.(com|net|org|io)\b/i.test(city)) return null;
  return city;
}

export function parseLocation(description: string): ParsedLocation {
  if (!description) return EMPTY;

  const withCc = description.match(CITY_CC_RE);
  if (withCc?.[1] && withCc[2] && !CONNECTOR_CODES.has(withCc[2].toLowerCase())) {
    const city = cleanCity(withCc[1]);
    return { city, countryCode: withCc[2].toUpperCase() };
  }

  const cityOnly = description.match(COMPRA_CITY_RE);
  if (cityOnly?.[1]) {
    return { city: cleanCity(cityOnly[1]), countryCode: null };
  }

  return EMPTY;
}

/** Normalized key for the city→country cache (lowercase, single-spaced). */
export function cityKey(city: string): string {
  return city.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a city→country map from the user's OWN transactions that carry an
 * explicit country code (e.g. "Madrid Es"). This is ground truth straight from
 * the bank: it lets us resolve city-only descriptions ("…, Madrid, Tarjeta")
 * deterministically and, crucially, prevents Spanish towns whose names also
 * exist abroad (Córdoba, Santiago, León…) from being mis-resolved to a foreign
 * country. When a city was seen with more than one code, the most frequent wins.
 */
export function explicitCityCountries(parsed: ParsedLocation[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const p of parsed) {
    if (!p.city || !p.countryCode) continue;
    const key = cityKey(p.city);
    const perCode = counts.get(key) ?? new Map<string, number>();
    perCode.set(p.countryCode, (perCode.get(p.countryCode) ?? 0) + 1);
    counts.set(key, perCode);
  }
  const out = new Map<string, string>();
  for (const [key, perCode] of counts) {
    const top = [...perCode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) out.set(key, top);
  }
  return out;
}
