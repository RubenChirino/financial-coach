import "server-only";

import type {
  AccountBalances,
  AccountDetails,
  GoCardlessErrorBody,
  Institution,
  Requisition,
  RequisitionCreateInput,
  TokenResponse,
  TransactionsResponse,
} from "./types";

export const GC_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export class GoCardlessError extends Error {
  readonly status: number;
  readonly body: GoCardlessErrorBody | string | null;

  constructor(status: number, body: GoCardlessErrorBody | string | null, message?: string) {
    super(message ?? `GoCardless API error (${status})`);
    this.name = "GoCardlessError";
    this.status = status;
    this.body = body;
  }
}

interface TokenState {
  access: string;
  refresh: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export interface GoCardlessCredentials {
  secretId: string;
  secretKey: string;
}

/**
 * Low-level GoCardless Bank Account Data client.
 *
 * Caches the access token in-memory for the lifetime of the instance.
 * Create one per request/task; do NOT persist across the app lifecycle
 * (the credentials come from the user's encrypted store).
 */
export class GoCardlessClient {
  private readonly credentials: GoCardlessCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: TokenState | null = null;

  constructor(
    credentials: GoCardlessCredentials,
    options?: { baseUrl?: string; fetch?: typeof fetch },
  ) {
    this.credentials = credentials;
    this.baseUrl = options?.baseUrl ?? GC_BASE_URL;
    this.fetchImpl = options?.fetch ?? fetch;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.accessExpiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
      return this.token.access;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/token/new/`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        secret_id: this.credentials.secretId,
        secret_key: this.credentials.secretKey,
      }),
    });
    if (!res.ok) {
      throw new GoCardlessError(res.status, await safeJson(res), "failed to obtain token");
    }
    const data = (await res.json()) as TokenResponse;
    this.token = {
      access: data.access,
      refresh: data.refresh,
      accessExpiresAt: now + data.access_expires * 1000,
      refreshExpiresAt: now + data.refresh_expires * 1000,
    };
    return this.token.access;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new GoCardlessError(res.status, await safeJson(res));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async listInstitutions(country: string): Promise<Institution[]> {
    const cc = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) throw new Error("country must be a 2-letter ISO code");
    return this.request<Institution[]>(`/institutions/?country=${cc}`);
  }

  async getInstitution(id: string): Promise<Institution> {
    return this.request<Institution>(`/institutions/${encodeURIComponent(id)}/`);
  }

  async createRequisition(input: RequisitionCreateInput): Promise<Requisition> {
    return this.request<Requisition>("/requisitions/", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getRequisition(id: string): Promise<Requisition> {
    return this.request<Requisition>(`/requisitions/${encodeURIComponent(id)}/`);
  }

  async deleteRequisition(id: string): Promise<void> {
    await this.request<void>(`/requisitions/${encodeURIComponent(id)}/`, { method: "DELETE" });
  }

  async getAccountDetails(accountId: string): Promise<AccountDetails> {
    return this.request<AccountDetails>(`/accounts/${encodeURIComponent(accountId)}/details/`);
  }

  async getAccountBalances(accountId: string): Promise<AccountBalances> {
    return this.request<AccountBalances>(`/accounts/${encodeURIComponent(accountId)}/balances/`);
  }

  async getAccountTransactions(
    accountId: string,
    opts?: { dateFrom?: string; dateTo?: string },
  ): Promise<TransactionsResponse> {
    const qs = new URLSearchParams();
    if (opts?.dateFrom) qs.set("date_from", opts.dateFrom);
    if (opts?.dateTo) qs.set("date_to", opts.dateTo);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<TransactionsResponse>(
      `/accounts/${encodeURIComponent(accountId)}/transactions/${suffix}`,
    );
  }
}

async function safeJson(res: Response): Promise<GoCardlessErrorBody | string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as GoCardlessErrorBody;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}
