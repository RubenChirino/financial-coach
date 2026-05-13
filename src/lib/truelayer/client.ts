import "server-only";

import type {
  TrueLayerAccount,
  TrueLayerBalance,
  TrueLayerListResponse,
  TrueLayerTokenResponse,
  TrueLayerTransaction,
} from "./types";

export const TL_SANDBOX_AUTH_URL = "https://auth.truelayer-sandbox.com";
export const TL_SANDBOX_API_URL = "https://api.truelayer-sandbox.com";
export const TL_LIVE_AUTH_URL = "https://auth.truelayer.com";
export const TL_LIVE_API_URL = "https://api.truelayer.com";

/**
 * Scopes we request on the consent link. `offline_access` is required to get
 * a refresh_token so we can keep syncing after the 1-hour access_token TTL.
 */
export const TL_SCOPES = ["info", "accounts", "balance", "transactions", "offline_access"];

export class TrueLayerError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `TrueLayer API error (${status})`);
    this.name = "TrueLayerError";
    this.status = status;
    this.body = body;
  }
}

export interface TrueLayerCredentials {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
}

export interface TrueLayerConnectionTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms timestamp when the access token expires. */
  expiresAt: number;
}

interface ClientOptions {
  authUrl?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Low-level TrueLayer Data API client.
 *
 * Unlike the GoCardless client there is no app-wide token — each connected
 * bank has its own access/refresh token pair issued at consent time. Callers
 * therefore pass in the current token set and may receive a refreshed one
 * back via {@link refreshAccessToken} that they must persist.
 */
export class TrueLayerClient {
  readonly credentials: TrueLayerCredentials;
  readonly authUrl: string;
  readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(credentials: TrueLayerCredentials, options?: ClientOptions) {
    this.credentials = credentials;
    const sandbox = credentials.environment === "sandbox";
    this.authUrl = options?.authUrl ?? (sandbox ? TL_SANDBOX_AUTH_URL : TL_LIVE_AUTH_URL);
    this.apiUrl = options?.apiUrl ?? (sandbox ? TL_SANDBOX_API_URL : TL_LIVE_API_URL);
    this.fetchImpl = options?.fetch ?? fetch;
  }

  /**
   * Build the hosted-consent URL the user is redirected to.
   *
   * TrueLayer returns the user to `redirectUri?code=...&state=...` after they
   * finish the bank authentication flow.
   *
   * Pass `country` to pre-filter TrueLayer's bank picker to institutions from
   * that country (e.g. "ES" → Santander España, BBVA, CaixaBank…).
   * Defaults to showing both UK and major EU banks so the user can pick.
   */
  buildAuthUrl(opts: {
    redirectUri: string;
    state: string;
    providers?: string[];
    country?: string;
  }): string {
    const sandbox = this.credentials.environment === "sandbox";
    let providers = opts.providers;
    if (!providers) {
      if (sandbox) {
        providers = ["uk-cs-mock"];
      } else if (opts.country) {
        providers = TrueLayerClient.providersForCountry(opts.country);
      } else {
        // Show UK + most common EU countries so the picker isn't UK-only.
        providers = [
          "uk-ob-all",
          "uk-oauth-all",
          "es-ob-all",
          "ie-ob-all",
          "nl-ob-all",
          "fr-ob-all",
          "de-ob-all",
          "it-ob-all",
          "pl-ob-all",
        ];
      }
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.credentials.clientId,
      scope: TL_SCOPES.join(" "),
      redirect_uri: opts.redirectUri,
      state: opts.state,
      providers: providers.join(" "),
    });
    if (sandbox) params.set("enable_mock", "true");
    return `${this.authUrl}/?${params.toString()}`;
  }

  /**
   * Map an ISO-3166-1 alpha-2 country code to the TrueLayer provider bucket(s)
   * that cover institutions in that country.
   */
  static providersForCountry(country: string): string[] {
    const map: Record<string, string[]> = {
      GB: ["uk-ob-all", "uk-oauth-all"],
      ES: ["es-ob-all"],
      IE: ["ie-ob-all"],
      NL: ["nl-ob-all"],
      FR: ["fr-ob-all"],
      DE: ["de-ob-all"],
      IT: ["it-ob-all"],
      PL: ["pl-ob-all"],
      LT: ["lt-ob-all"],
      LV: ["lv-ob-all"],
      EE: ["ee-ob-all"],
      NO: ["no-ob-all"],
      SE: ["se-ob-all"],
      DK: ["dk-ob-all"],
    };
    return map[country.toUpperCase()] ?? ["uk-ob-all", "uk-oauth-all"];
  }

  /** Exchange an authorization code for an access + refresh token pair. */
  async exchangeCode(code: string, redirectUri: string): Promise<TrueLayerTokenResponse> {
    return this.tokenCall({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
  }

  /** Trade the refresh_token for a fresh access_token (and usually a rotated refresh_token). */
  async refreshAccessToken(refreshToken: string): Promise<TrueLayerTokenResponse> {
    return this.tokenCall({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async tokenCall(payload: Record<string, string>): Promise<TrueLayerTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      ...payload,
    });
    const res = await this.fetchImpl(`${this.authUrl}/connect/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new TrueLayerError(res.status, await safeJson(res), "token exchange failed");
    }
    return (await res.json()) as TrueLayerTokenResponse;
  }

  async listAccounts(accessToken: string): Promise<TrueLayerAccount[]> {
    const data = await this.dataGet<TrueLayerListResponse<TrueLayerAccount>>(
      "/data/v1/accounts",
      accessToken,
    );
    return data.results;
  }

  async getBalance(accessToken: string, accountId: string): Promise<TrueLayerBalance | null> {
    const data = await this.dataGet<TrueLayerListResponse<TrueLayerBalance>>(
      `/data/v1/accounts/${encodeURIComponent(accountId)}/balance`,
      accessToken,
    );
    return data.results[0] ?? null;
  }

  async getTransactions(
    accessToken: string,
    accountId: string,
    opts?: { from?: string; to?: string },
  ): Promise<TrueLayerTransaction[]> {
    const qs = new URLSearchParams();
    if (opts?.from) qs.set("from", opts.from);
    if (opts?.to) qs.set("to", opts.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const data = await this.dataGet<TrueLayerListResponse<TrueLayerTransaction>>(
      `/data/v1/accounts/${encodeURIComponent(accountId)}/transactions${suffix}`,
      accessToken,
    );
    return data.results;
  }

  private async dataGet<T>(path: string, accessToken: string): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!res.ok) {
      throw new TrueLayerError(res.status, await safeJson(res));
    }
    return (await res.json()) as T;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}
