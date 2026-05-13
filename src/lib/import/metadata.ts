/**
 * Best-effort extractor for account-level metadata that banks include in the
 * top of an export (above the transaction rows): IBAN, current balance,
 * currency. We don't fail if a piece is missing — the caller falls back to
 * generic behavior.
 *
 * Scope: scans only the first 30 non-blank lines so we never mistake a
 * transaction's running-balance value for the account's current balance.
 */

export interface ImportedAccountMeta {
  iban: string | null;
  balanceCents: number | null;
  currency: string | null;
}

const IBAN_RE = /\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/;

// Money + currency code, e.g. "2.832,29 EUR", "1,500.00 USD", "100 GBP".
// The currency suffix is the disambiguator: transaction running-balance cells
// in CSV-converted XLS files don't carry a currency code, only the metadata
// header does.
const BALANCE_RE =
  /["']?([0-9]+(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?)["']?\s*(EUR|USD|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK|PLN|MXN|BRL|RON|HUF|CZK)\b/i;

export function extractAccountMetadata(text: string): ImportedAccountMeta {
  const head = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 30)
    .join("\n");

  const ibanMatch = head.match(IBAN_RE);
  const iban = ibanMatch ? ibanMatch[1]!.toUpperCase() : null;

  const balanceMatch = head.match(BALANCE_RE);
  const currency = balanceMatch ? balanceMatch[2]!.toUpperCase() : null;
  const balanceCents = balanceMatch ? parseLooseAmount(balanceMatch[1]!) : null;

  return { iban, balanceCents, currency };
}

/**
 * Parse a number written in either EU ("2.832,29") or US ("2,832.29") format
 * to integer cents. Returns null on anything ambiguous.
 */
function parseLooseAmount(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Rightmost separator is the decimal mark.
    if (lastDot > lastComma) {
      normalized = s.replace(/,/g, "");
    } else {
      normalized = s.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma >= 0) {
    // Single separator: 2 digits after → decimal; 3 digits → thousands.
    const frac = s.length - lastComma - 1;
    normalized = frac === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const frac = s.length - lastDot - 1;
    normalized = frac === 3 ? s.replace(/\./g, "") : s;
  } else {
    normalized = s;
  }

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
