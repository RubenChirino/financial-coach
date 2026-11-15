/**
 * A merchant name normalized for grouping: lowercased, whitespace collapsed,
 * company suffixes ("S.L.", "S.A.", "Inc", "GmbH"…) and long digit runs
 * (card-terminal ids, timestamps) removed.
 *
 * The recurring detector groups series by it and the forecast uses it to
 * leave out merchants already counted as recurring, so the two must agree:
 * that is why there is one copy.
 */
export function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(s\.?l\.?|s\.?a\.?|inc\.?|ltd\.?|sas|gmbh)\b/g, "")
    .replace(/\d{4,}/g, "")
    .trim();
}
