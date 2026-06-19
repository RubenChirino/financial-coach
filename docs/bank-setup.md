# Connecting your bank

The app can pull your accounts and transactions from **four sources**, all of
which land in the same tables and behave identically across the rest of the app
(dashboard, categorization, predictions, …). Architecturally they sit behind one
provider contract — see [`../ARCHITECTURE.md` §9](../ARCHITECTURE.md#9-bank-aggregation).

| Source | Best for | Keys needed |
|---|---|---|
| **GoCardless** (this page) | Most EU/EEA + UK banks | `secret_id` / `secret_key` (free) |
| **TrueLayer** | Banks with better Live coverage there (Santander ES, Revolut, Monzo) | Client ID / Secret, stored encrypted in-app — see [SETUP.md §6d](../SETUP.md#6d-alternative-connect-via-truelayer-santander-es-and-others) |
| **Demo** | Exploring the app with synthetic data, no signup | None — just pick "Demo" from the welcome screen or Settings → Bank |
| **CSV / XLSX import** | Banks not covered, or offline-first | None — drop a statement into **Settings → Import** |

The rest of this page covers GoCardless, the primary provider.

## GoCardless

We use the **GoCardless Bank Account Data API** (formerly Nordigen) — a PSD2 aggregation provider that covers most banks in Spain and the rest of the EU/EEA and UK.

## 1. Create a free GoCardless account

1. Go to [bankaccountdata.gocardless.com](https://bankaccountdata.gocardless.com) and sign up.
2. Verify your email.
3. You land on the developer console.

## 2. Generate your API keys

1. In the console sidebar, go to **User secrets**.
2. Click **Create new**.
3. Copy the `secret_id` and `secret_key`. Treat them like passwords.

## 3. Store them in the app

You have two options — the app supports both.

**A) Inside the app (recommended).** Open **Settings → Bank**, paste the `secret_id` and `secret_key` into the "GoCardless keys" card, and hit **Save and verify**. The app makes a test call to confirm the keys work and stores them AES-256-GCM encrypted in your local SQLite DB, keyed off your PIN. If you forget your PIN, the keys cannot be recovered — you'll enter new ones.

**B) Via `.env.local`.** Useful for a quick start or unattended setups:

```bash
GOCARDLESS_SECRET_ID=your-secret-id-here
GOCARDLESS_SECRET_KEY=your-secret-key-here
```

The app reads env vars at startup as a fallback when no DB-stored credentials exist. DB-stored keys take precedence.

## 4. Link a bank

1. **Settings → Bank → Add bank** — disabled until keys are saved.
2. Pick your country (defaults to Spain; PT/FR/DE/IT/NL/GB/IE also available).
3. Search / pick your institution.
4. You're redirected to your bank. Authorize **read-only** access to balances and transactions — the API does not grant payment initiation.
5. Your bank redirects back to `/settings/bank/callback?ref=…`. The app fetches the approved account list, stores the GoCardless account IDs **encrypted**, and immediately triggers a first transaction sync.

First sync typically pulls 90 days of booked transactions per account.

## 5. Sync

- Automatic: on first link only.
- Manual: **Settings → Bank → Sync**. Re-queries every linked account and upserts new transactions. Dedup is driven by the GoCardless `transactionId` (with fallbacks — see `normalize.ts`), so running it repeatedly is safe.
- Only **booked** transactions are stored. Pending ones can change or disappear, so we ignore them.

## 6. Disconnect

**Settings → Bank → trash icon** on any connection. The app asks GoCardless to delete the requisition (best-effort) and removes the local account + its transactions.

## Access window

GoCardless grants 90-day access by default. The app requests up to 730 days of historical data where the bank permits. You'll need to re-authorize when the agreement expires; the connection's status in Settings flips to **Expired** and the Sync button stops returning new rows.

## Rate limits

GoCardless enforces **4 requests per endpoint per account per day** for transactions (check their pricing page for the latest). Manual Sync counts against this budget. Plan accordingly — syncing every 5 minutes will exhaust the quota fast.

## Troubleshooting

- **"Institution not found"** — the list is pulled live from GoCardless. If your bank isn't listed for your country, it isn't covered.
- **Status shows "Expired"** — delete the connection and re-link. The PSD2 agreement has lapsed.
- **Connection stuck on "Pending"** — the user didn't complete consent at the bank. Delete and re-link.
- **"401 forbidden" saving keys** — keys are wrong, or they've been rotated on GoCardless.
- **"Pending" vs "booked"** — the app stores booked transactions only. Pending entries can disappear or be revised.

## What's stored where

| Data                           | Where                           | Encryption                   |
| ------------------------------ | ------------------------------- | ---------------------------- |
| GoCardless `secret_id/key`     | `provider_credentials.encrypted_key` | AES-256-GCM (PIN-derived key) |
| Bank requisition ID            | `requisitions.gocardless_requisition_id` | AES-256-GCM                  |
| Bank account ID                | `accounts.gocardless_account_id` | AES-256-GCM                  |
| IBAN                           | never stored in full — only `ibanLast4` | n/a                          |
| Transactions (merchant, amount, description) | `transactions`      | cleartext in local SQLite     |

The local SQLite file itself lives at `data/financial-coach.db`. We recommend you keep `data/` out of backups unless those backups are themselves encrypted.
