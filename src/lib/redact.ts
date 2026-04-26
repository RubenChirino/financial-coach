/**
 * Strips personal identifiers from text before it's sent to any LLM.
 * Applied unconditionally regardless of provider (local or cloud).
 *
 * Conservative by design — false positives (over-redaction) are acceptable;
 * false negatives (leaking PII) are not.
 */

const IBAN_RE = /\b[A-Z]{2}\d{2}[\s-]?(?:[A-Z0-9][\s-]?){11,30}\b/g;
const CARD_RE = /\b(?:\d[\s-]?){13,19}\b/g;
const PHONE_RE =
  /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{3,4}[\s-]?\d{0,4}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DNI_NIE_RE = /\b[XYZ]?\d{7,8}[A-HJ-NP-TV-Z]\b/gi;
const POSTAL_RE = /\b\d{5}(?:-\d{4})?\b/g;
const LONG_DIGITS_RE = /\b\d{10,}\b/g;

export function redactPII(input: string): string {
  if (!input) return input;
  return input
    .replace(IBAN_RE, "[IBAN]")
    .replace(CARD_RE, (m) => (m.replace(/\D/g, "").length >= 13 ? "[CARD]" : m))
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(DNI_NIE_RE, "[ID]")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 9 ? "[PHONE]" : m))
    .replace(POSTAL_RE, "[POSTAL]")
    .replace(LONG_DIGITS_RE, "[NUM]");
}

export interface RedactedTransaction {
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  category: string | null;
}

export function redactTransaction(tx: {
  bookingDate: Date | string;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  rawDescription: string;
  category: string | null;
}): RedactedTransaction {
  const merchant =
    tx.merchantName?.trim() || redactPII(tx.rawDescription).slice(0, 80) || "Unknown";
  const date =
    typeof tx.bookingDate === "string" ? tx.bookingDate : tx.bookingDate.toISOString().slice(0, 10);
  return {
    date,
    amount: tx.amountCents / 100,
    currency: tx.currency,
    merchant: redactPII(merchant),
    category: tx.category,
  };
}
