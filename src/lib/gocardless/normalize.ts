import type { GoCardlessTransaction } from "./types";

/**
 * Convert GoCardless amount strings (e.g. "-12.34") to integer cents.
 * Uses string-based parsing to avoid floating-point rounding at the
 * sub-cent level.
 */
export function toCents(amount: string): number {
  const trimmed = amount.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount: ${amount}`);
  }
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart = "0", fracPart = ""] = abs.split(".");
  const frac = `${fracPart}00`.slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(frac || "0", 10);
  return negative ? -cents : cents;
}

export interface NormalizedTransaction {
  externalId: string;
  bookingDate: Date;
  valueDate: Date | null;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
}

/**
 * Normalize a GoCardless transaction into the shape our schema expects.
 *
 * - `externalId` prefers `transactionId`, falls back to `internalTransactionId`,
 *   then to a deterministic hash of the fields (date + amount + description).
 * - For outflows we prefer the `creditorName` (who we paid); for inflows we
 *   prefer the `debtorName` (who paid us).
 * - `rawDescription` is built from the remittance-information fields; it's the
 *   only place raw text lives and is shown to the user but never sent to
 *   remote LLMs (see `redactTransaction`).
 *
 * Returns `null` if the transaction lacks a booking date or amount — those
 * are unusable for our accounting model.
 */
export function normalizeTransaction(
  tx: GoCardlessTransaction,
  accountHint: string,
): NormalizedTransaction | null {
  if (!tx.bookingDate || !tx.transactionAmount?.amount) return null;

  const amountCents = toCents(tx.transactionAmount.amount);
  const currency = tx.transactionAmount.currency || "EUR";

  const remittance =
    tx.remittanceInformationUnstructured ??
    tx.remittanceInformationUnstructuredArray?.join(" — ") ??
    "";

  const merchantName =
    amountCents < 0 ? (tx.creditorName ?? null) : amountCents > 0 ? (tx.debtorName ?? null) : null;

  const rawDescription =
    [merchantName, remittance].filter(Boolean).join(" · ") ||
    tx.bankTransactionCode ||
    tx.proprietaryBankTransactionCode ||
    "(no description)";

  const externalId =
    tx.transactionId ??
    tx.internalTransactionId ??
    `${accountHint}:${tx.bookingDate}:${tx.transactionAmount.amount}:${rawDescription.slice(0, 32)}`;

  return {
    externalId,
    bookingDate: new Date(`${tx.bookingDate}T00:00:00Z`),
    valueDate: tx.valueDate ? new Date(`${tx.valueDate}T00:00:00Z`) : null,
    amountCents,
    currency,
    merchantName,
    rawDescription,
  };
}

/**
 * Extract the most authoritative balance from a GoCardless balance list.
 * Prefers (in order): closingBooked → expected → interimBooked → authorised.
 */
export function pickPrimaryBalance<T extends { balanceType: string }>(balances: T[]): T | null {
  const order = ["closingBooked", "expected", "interimBooked", "authorised"];
  for (const t of order) {
    const found = balances.find((b) => b.balanceType === t);
    if (found) return found;
  }
  return balances[0] ?? null;
}
