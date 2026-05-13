/**
 * GoCardless Bank Account Data API (formerly Nordigen) — type definitions.
 * Docs: https://bankaccountdata.gocardless.com/api-docs/
 */

export interface TokenResponse {
  access: string;
  access_expires: number;
  refresh: string;
  refresh_expires: number;
}

export interface Institution {
  id: string;
  name: string;
  bic?: string;
  transaction_total_days: string;
  countries: string[];
  logo: string;
}

export interface Agreement {
  id: string;
  created: string;
  institution_id: string;
  max_historical_days: number;
  access_valid_for_days: number;
  access_scope: string[];
  accepted?: string | null;
}

export interface RequisitionCreateInput {
  redirect: string;
  institution_id: string;
  reference: string;
  agreement?: string;
  user_language?: "ES" | "EN";
}

export interface Requisition {
  id: string;
  created: string;
  redirect: string;
  status:
    | "CR" // Created
    | "GC" // Giving consent
    | "UA" // Undergoing authentication
    | "RJ" // Rejected
    | "SA" // Selecting accounts
    | "GA" // Granting access
    | "LN" // Linked
    | "SU" // Suspended
    | "EX"; // Expired
  institution_id: string;
  agreement: string;
  reference: string;
  accounts: string[];
  user_language: string;
  link: string;
}

export interface AccountDetails {
  account: {
    resourceId?: string;
    iban?: string;
    bban?: string;
    currency: string;
    ownerName?: string;
    name?: string;
    product?: string;
    cashAccountType?: string;
  };
}

export interface AccountBalance {
  balanceAmount: { amount: string; currency: string };
  balanceType: string;
  referenceDate?: string;
}

export interface AccountBalances {
  balances: AccountBalance[];
}

export interface GoCardlessTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  proprietaryBankTransactionCode?: string;
  bankTransactionCode?: string;
}

export interface TransactionsResponse {
  transactions: {
    booked: GoCardlessTransaction[];
    pending: GoCardlessTransaction[];
  };
}

export interface GoCardlessErrorBody {
  summary?: string;
  detail?: string;
  status_code?: number;
  type?: string;
  [key: string]: unknown;
}
