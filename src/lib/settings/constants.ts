/** Supported display currencies (ISO 4217 codes). Safe to import from client components. */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
