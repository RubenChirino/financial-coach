# Security & threat model

> Architectural context for everything below is in
> [`../ARCHITECTURE.md` §7](../ARCHITECTURE.md#7-security-architecture). This
> document is the threat model itself.

## Goals

1. **Local-first.** Financial data never leaves the user's machine without
   explicit consent.
2. **Encrypted at rest.** Anyone with read access to the database file alone
   cannot recover bank tokens or API keys without the user's PIN (local mode) or
   `APP_SECRET` (hosted mode).
3. **Minimized LLM exposure.** Even when a cloud LLM is used, raw transaction
   descriptions are never sent — only redacted, rounded aggregates.
4. **Read-only bank access.** The app cannot initiate payments even if
   compromised.
5. **Per-user isolation (hosted mode).** One user can never read or mutate
   another user's data, and the isolation fails *closed*.

## Trust boundaries

The app makes exactly three kinds of outbound call, all server-side:

| Destination          | What crosses the boundary                                         |
| -------------------- | ----------------------------------------------------------------- |
| Database             | Full data, but secrets are AES-256-GCM ciphertext (file or Turso) |
| Bank-data provider   | OAuth handshake + read-only AIS requests (no payment scopes)      |
| LLM provider         | Redacted, rounded aggregates only — never transaction rows        |

The browser talks only to the app server. The CSP `connect-src` is `'self'`
(plus the local Ollama port in local mode), so a hypothetical XSS payload has no
exfiltration channel.

## Threat model

| Threat | Mitigation |
|---|---|
| Attacker with filesystem read on the SQLite file | Secret columns AES-256-GCM encrypted; key derived from PIN + `APP_SECRET` + per-user salt via scrypt (N=2^16). The file alone yields ciphertext only. |
| Weak / guessed PIN | scrypt KDF makes brute force expensive; encryption *also* requires `APP_SECRET` (in `.env`, outside the DB); PIN-unlock attempts are rate-limited with exponential backoff. |
| Online PIN brute force | In-process backoff limiter: free retries for typos, escalating lockouts (5s → 15s → 30s → 60s → 5min) on top of scrypt's ~100ms cost. |
| Shoulder surfing / left machine unlocked | 15-minute inactivity timeout; PIN required to unlock; session token stored hashed. |
| Stolen session cookie (local) | Cookie holds a random token; the DB stores only its SHA-256 hash; the wrapped encryption key needs `APP_SECRET` to unwrap; rotating `APP_SECRET` invalidates all sessions. |
| Stolen session JWT (hosted) | 24h max lifetime with 6h sliding refresh (vs. the 30-day Auth.js default) — short because the session reads bank data. |
| Cross-user data access (hosted) | Every user-owned table has a `user_id`; every query is scoped to the session's user; the client never supplies a user id. New `user_id` columns default to `0` (no real user) so un-backfilled rows are invisible to everyone — **fail-closed**. |
| Read-only "try it" guest writing data | Guest sessions are flagged; write paths call `assertWritable()` and reject guests; guest accounts are ephemeral (session cookie) and purged after 24h. |
| CSRF on cookie-authenticated endpoints | Server Actions are CSRF-protected by Next.js. Plain `/api/*` handlers (backup-restore, chat) call `guardCsrf()` to pin `Origin`/`Referer`/`Sec-Fetch-Site` to same-origin before any write. |
| XSS / injected script | Strict per-request CSP: `script-src` uses a nonce + `'strict-dynamic'` (no `'unsafe-inline'`); `connect-src 'self'` blocks exfiltration; `frame-ancestors 'none'`, `object-src 'none'`, locked-down `Permissions-Policy`. |
| Prompt injection from a transaction description | Redaction strips IBANs, cards, emails, phones, DNI/NIE, postal codes, and long digit runs before any LLM call; only rounded aggregates + redacted merchant names reach the model — never raw rows. |
| Runaway/abusive LLM spend | Per-user chat rate limit (20 turns/min) enforced before any DB read or model call; cloud providers gated behind one-time explicit consent. |
| LAN adversary | Server binds to `127.0.0.1`; `HOST=0.0.0.0` emits a conspicuous startup warning. |
| Hostile cloud LLM provider | Explicit per-provider consent modal (local mode); only redacted aggregates sent; consent timestamp recorded. |
| Supply-chain attack on dependencies | Biome + typecheck + `pnpm audit` + CodeQL + Dependabot in CI; lockfile committed. |
| Credentials in git | `gitleaks` in pre-commit hook and CI; `.env*` and `data/` in `.gitignore`; PR template requires confirmation. |
| Payment initiation abuse | Only PSD2 AIS scopes requested (`balances details transactions`); never PIS. Applies to GoCardless and TrueLayer alike. |
| Stored provider credentials (TrueLayer / GoCardless keys) | Encrypted AES-256-GCM in `provider_credentials` with the per-user key; never written to `.env` or logs. |

## Hosted-mode tradeoff (read this before deploying)

In OAuth/hosted mode there is no user-held PIN, so the at-rest key derives from
`APP_SECRET` + per-user salt alone (with an `oauth::` domain-separation prefix).
The consequence: **a full server compromise — database *and* `APP_SECRET`
together — can decrypt hosted users' data.** PIN/local mode is strictly stronger
because the PIN (which the server never stores in plaintext) is also required.

This is an accepted, documented tradeoff for the "share an instance with family"
use case. If your threat model includes a full host compromise, run local mode.

## Non-goals

- Protection against a compromised OS user account reading process memory.
- Protection if the user runs the app on hardware they do not control.
- Protection against a malicious or compromised bank-data API response (we trust
  the vendor for the data path; we audit what we persist).
- Protection of hosted-mode data against an attacker holding both the database
  and `APP_SECRET` (see the tradeoff above).

## Reporting

See [`../SECURITY.md`](../SECURITY.md).
