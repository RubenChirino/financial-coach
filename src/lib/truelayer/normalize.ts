import type { TrueLayerTransaction } from "./types";

/**
 * Convert a decimal number-or-string amount (e.g. `-12.34`, `12`) to integer
 * cents without floating-point drift. TrueLayer returns `amount` as a JSON
 * number, but we coerce via string to keep sub-cent parsing exact.
 */
export function decimalToCents(amount: number | string): number {
  const str = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(str)) {
    throw new Error(`invalid amount: ${amount}`);
  }
  const negative = str.startsWith("-");
  const abs = negative ? str.slice(1) : str;
  const [intPart = "0", fracPart = ""] = abs.split(".");
  const frac = `${fracPart}00`.slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(frac || "0", 10);
  return negative ? -cents : cents;
}

export interface NormalizedTrueLayerTransaction {
  externalId: string;
  bookingDate: Date;
  valueDate: Date | null;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
}

/**
 * Normalize a TrueLayer transaction into our provider-agnostic shape.
 *
 * Sign convention: TrueLayer encodes direction in the sign of `amount` AND in
 * `transaction_type`. A DEBIT with positive amount is still an outflow — we
 * normalize so credits are positive and debits negative, matching GoCardless.
 */
export function normalizeTrueLayerTransaction(
  tx: TrueLayerTransaction,
  accountHint: string,
): NormalizedTrueLayerTransaction | null {
  if (!tx.timestamp || tx.amount === undefined || tx.amount === null) return null;

  const raw = decimalToCents(tx.amount);
  // If the provider flags a DEBIT but the number arrived positive, flip it.
  const direction = tx.transaction_type?.toUpperCase();
  const amountCents =
    direction === "DEBIT" ? -Math.abs(raw) : direction === "CREDIT" ? Math.abs(raw) : raw;

  const rawDescription =
    (tx.description ?? "").trim() || tx.transaction_category || "(no description)";
  const merchantName = tx.merchant_name?.trim() || null;

  const externalId =
    tx.transaction_id ||
    tx.normalised_provider_transaction_id ||
    tx.provider_transaction_id ||
    `${accountHint}:${tx.timestamp}:${tx.amount}:${rawDescription.slice(0, 32)}`;

  const bookingDate = new Date(tx.timestamp);

  return {
    externalId: `tl_${externalId}`,
    bookingDate,
    valueDate: null,
    amountCents,
    currency: tx.currency || "GBP",
    merchantName,
    rawDescription,
  };
}
