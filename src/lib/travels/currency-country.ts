/**
 * Map an ISO-4217 currency code to a best-guess country.
 *
 * This is the ONLY location signal available: transactions carry no city,
 * merchant country, or coordinates, so a foreign currency is our proxy for
 * "the user was in country X". The mapping is therefore deliberately 1:1 with
 * the country most associated with each currency.
 *
 * Currencies shared by many countries (EUR, USD, XOF, …) are flagged
 * `isAmbiguous` so the UI can fall back to a region label instead of pinning a
 * single country.
 */
export interface CountryGuess {
  /** Human-readable country / region name (English; UI re-labels if needed). */
  country: string;
  /** Emoji flag, or a globe for ambiguous/unknown currencies. */
  flag: string;
  /** True when the currency spans multiple countries (EUR, USD, …). */
  isAmbiguous: boolean;
}

interface Entry {
  country: string;
  flag: string;
  ambiguous?: boolean;
}

// Common travel currencies. Kept intentionally compact — extend as needed.
const CURRENCY_COUNTRY: Record<string, Entry> = {
  EUR: { country: "Eurozone", flag: "🇪🇺", ambiguous: true },
  USD: { country: "United States", flag: "🇺🇸", ambiguous: true },
  GBP: { country: "United Kingdom", flag: "🇬🇧" },
  JPY: { country: "Japan", flag: "🇯🇵" },
  CHF: { country: "Switzerland", flag: "🇨🇭" },
  THB: { country: "Thailand", flag: "🇹🇭" },
  CNY: { country: "China", flag: "🇨🇳" },
  AUD: { country: "Australia", flag: "🇦🇺" },
  CAD: { country: "Canada", flag: "🇨🇦" },
  NZD: { country: "New Zealand", flag: "🇳🇿" },
  SEK: { country: "Sweden", flag: "🇸🇪" },
  NOK: { country: "Norway", flag: "🇳🇴" },
  DKK: { country: "Denmark", flag: "🇩🇰" },
  PLN: { country: "Poland", flag: "🇵🇱" },
  CZK: { country: "Czechia", flag: "🇨🇿" },
  HUF: { country: "Hungary", flag: "🇭🇺" },
  RON: { country: "Romania", flag: "🇷🇴" },
  BGN: { country: "Bulgaria", flag: "🇧🇬" },
  TRY: { country: "Türkiye", flag: "🇹🇷" },
  MAD: { country: "Morocco", flag: "🇲🇦" },
  EGP: { country: "Egypt", flag: "🇪🇬" },
  ZAR: { country: "South Africa", flag: "🇿🇦" },
  AED: { country: "United Arab Emirates", flag: "🇦🇪" },
  SAR: { country: "Saudi Arabia", flag: "🇸🇦" },
  INR: { country: "India", flag: "🇮🇳" },
  IDR: { country: "Indonesia", flag: "🇮🇩" },
  SGD: { country: "Singapore", flag: "🇸🇬" },
  MYR: { country: "Malaysia", flag: "🇲🇾" },
  PHP: { country: "Philippines", flag: "🇵🇭" },
  VND: { country: "Vietnam", flag: "🇻🇳" },
  KRW: { country: "South Korea", flag: "🇰🇷" },
  HKD: { country: "Hong Kong", flag: "🇭🇰" },
  TWD: { country: "Taiwan", flag: "🇹🇼" },
  MXN: { country: "Mexico", flag: "🇲🇽" },
  BRL: { country: "Brazil", flag: "🇧🇷" },
  ARS: { country: "Argentina", flag: "🇦🇷" },
  CLP: { country: "Chile", flag: "🇨🇱" },
  COP: { country: "Colombia", flag: "🇨🇴" },
  PEN: { country: "Peru", flag: "🇵🇪" },
  ISK: { country: "Iceland", flag: "🇮🇸" },
  ILS: { country: "Israel", flag: "🇮🇱" },
};

/** Resolve a currency code to a country guess. Unknown codes → globe + the code. */
export function currencyToCountry(currency: string): CountryGuess {
  const code = currency.trim().toUpperCase();
  const entry = CURRENCY_COUNTRY[code];
  if (!entry) {
    return { country: code, flag: "🌍", isAmbiguous: true };
  }
  return { country: entry.country, flag: entry.flag, isAmbiguous: entry.ambiguous ?? false };
}
