/**
 * TrueLayer Data API shapes — only the fields we actually consume.
 * See https://docs.truelayer.com/docs/data-api-overview
 */

export interface TrueLayerTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string; // "Bearer"
  scope?: string;
}

export interface TrueLayerProvider {
  provider_id: string; // e.g. "ob-monzo"
  display_name: string;
  logo_url?: string;
  country: string; // ISO-3166-1 alpha-2, e.g. "GB"
}

export interface TrueLayerAccount {
  account_id: string;
  account_type: string; // "TRANSACTION", "SAVINGS", ...
  display_name: string;
  currency: string;
  account_number?: {
    iban?: string;
    number?: string;
    sort_code?: string;
    swift_bic?: string;
  };
  provider: {
    provider_id: string;
    display_name?: string;
    logo_uri?: string;
  };
}

export interface TrueLayerBalance {
  currency: string;
  available: number; // decimal, e.g. 1234.56
  current: number;
  overdraft?: number;
}

export interface TrueLayerTransaction {
  transaction_id: string;
  normalised_provider_transaction_id?: string;
  provider_transaction_id?: string;
  timestamp: string; // ISO-8601
  description: string;
  amount: number; // decimal, sign encodes direction (positive = credit, negative = debit)
  currency: string;
  transaction_type?: string; // "CREDIT" | "DEBIT"
  transaction_category?: string;
  merchant_name?: string;
  running_balance?: { amount: number; currency: string };
  meta?: Record<string, string>;
}

export interface TrueLayerListResponse<T> {
  results: T[];
  status?: string;
}
