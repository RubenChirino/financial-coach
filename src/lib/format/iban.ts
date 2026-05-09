/**
 * Format an IBAN for display: 2-letter country code, then 2-digit checksum,
 * then groups of 4. Example:
 *   "ES9400493084282114175588" → "ES 94 0049 3084 2821 1417 5588"
 *
 * Returns the input unchanged if it doesn't look like a plausible IBAN
 * (so partial values, IDs, etc. pass through harmlessly).
 */
export function formatIban(raw: string): string {
  if (!raw) return raw;
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  if (!isLikelyIban(cleaned)) return raw;

  const country = cleaned.slice(0, 2);
  const checksum = cleaned.slice(2, 4);
  const body = cleaned.slice(4);
  const groups = body.match(/.{1,4}/g) ?? [];
  return [country, checksum, ...groups].join(" ");
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

export function isLikelyIban(value: string): boolean {
  return IBAN_RE.test(value.replace(/\s+/g, "").toUpperCase());
}
