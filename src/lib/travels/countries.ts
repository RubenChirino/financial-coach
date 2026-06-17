/**
 * Helpers to turn an ISO-3166 alpha-2 country code into a flag emoji and a
 * localized country name. Codes come from transaction descriptions ("Es",
 * "Gb", …) or from the city→country resolution step.
 */

/** Regional-indicator flag emoji for a 2-letter code; globe for anything else. */
export function flagFromCode(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🌍";
  const A = 0x1f1e6; // regional indicator "A"
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
}

/** Localized country name via Intl; falls back to the raw code. */
export function countryName(countryCode: string, locale: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return countryCode;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Minimal currency→country fallback for foreign-currency payments with no
 * parsed location. Only the common travel currencies — null when unknown. */
const CURRENCY_CC: Record<string, string> = {
  GBP: "GB",
  USD: "US",
  JPY: "JP",
  CHF: "CH",
  THB: "TH",
  CAD: "CA",
  AUD: "AU",
  NZD: "NZ",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
  TRY: "TR",
  MAD: "MA",
  AED: "AE",
  INR: "IN",
  SGD: "SG",
  MYR: "MY",
  MXN: "MX",
  BRL: "BR",
  ISK: "IS",
};

export function currencyToCountryCode(currency: string): string | null {
  return CURRENCY_CC[currency.trim().toUpperCase()] ?? null;
}

/** Curated list of countries offered in the home-location picker. */
export const COMMON_COUNTRY_CODES = [
  "ES",
  "PT",
  "FR",
  "IT",
  "DE",
  "GB",
  "IE",
  "NL",
  "BE",
  "LU",
  "CH",
  "AT",
  "GR",
  "SE",
  "NO",
  "DK",
  "FI",
  "PL",
  "CZ",
  "HU",
  "RO",
  "BG",
  "HR",
  "IS",
  "TR",
  "MA",
  "US",
  "CA",
  "MX",
  "BR",
  "AR",
  "CL",
  "CO",
  "PE",
  "JP",
  "CN",
  "KR",
  "TW",
  "HK",
  "TH",
  "VN",
  "ID",
  "SG",
  "MY",
  "PH",
  "IN",
  "AE",
  "SA",
  "IL",
  "EG",
  "ZA",
  "AU",
  "NZ",
] as const;

/** Country options (code + localized name) for a select, sorted by name. */
export function countryOptions(locale: string): { code: string; name: string }[] {
  return COMMON_COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort(
    (a, b) => a.name.localeCompare(b.name, locale),
  );
}
