/**
 * Bank data provider contract.
 *
 * A "provider" is any source the app can read bank accounts + transactions
 * from. Today the app has two:
 *   - `gocardless`: real Open Banking via GoCardless Bank Account Data (PSD2).
 *   - `demo`:      local seeder producing fake but plausible institutions,
 *                  accounts, and ~3 months of transactions. Useful when the
 *                  GoCardless portal is closed to new signups, for demos,
 *                  and for first-run previews before entering real keys.
 *
 * `requisitions.provider` is the discriminator. All downstream tables
 * (institutions, accounts, transactions) stay provider-agnostic — they just
 * hang off a requisition row, and the rest of the app reads them uniformly.
 *
 * A future "truelayer" provider will plug into the same contract.
 */
export type ProviderId = "gocardless" | "demo" | "truelayer" | "manual";

export interface ProviderDescriptor {
  id: ProviderId;
  /** i18n key under `bank.providers.<id>` for display name. */
  labelKey: string;
  /** Whether this provider talks to a remote API (needs credentials + OAuth). */
  remote: boolean;
}

export const PROVIDERS: readonly ProviderDescriptor[] = [
  { id: "gocardless", labelKey: "gocardless", remote: true },
  { id: "demo", labelKey: "demo", remote: false },
] as const;
