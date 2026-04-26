# Security & threat model

## Goals

1. **Local-first.** Financial data never leaves the user's machine without explicit consent.
2. **Encrypted at rest.** Anyone with read access to the SQLite file alone cannot recover bank tokens or API keys without the user's PIN.
3. **Minimized LLM exposure.** Even when a cloud LLM is used, raw transaction descriptions are never sent — only redacted summaries.
4. **Read-only bank access.** The app cannot initiate payments even if compromised.

## Threat model

| Threat | Mitigation |
|---|---|
| Attacker with filesystem read on `data/financial-coach.db` | Sensitive columns AES-256-GCM encrypted; key derived from PIN + `APP_SECRET` + per-user salt (scrypt N=2^16) |
| Weak / guessed PIN | scrypt KDF makes brute force expensive; encryption also requires `APP_SECRET` from `.env.local` (separate file, separate storage) |
| Shoulder surfing / left machine unlocked | Session cookie with 15-min inactivity timeout; PIN required to unlock |
| Prompt injection from a transaction description | Redaction layer strips IBANs, cards, emails, phone numbers, DNI/NIE, postal codes, and long digit runs before any LLM call; only merchant name + amount + date + category reach the model |
| LAN adversary | Server binds to 127.0.0.1; `HOST=0.0.0.0` emits a conspicuous startup warning |
| Hostile cloud LLM provider | Explicit per-provider consent modal; only redacted transaction summaries sent; consent timestamp recorded |
| Supply-chain attack on dependencies | Biome + typecheck + `pnpm audit` + CodeQL + Dependabot in CI; lockfile committed |
| Credentials in git | `gitleaks` in pre-commit hook and CI; `.env*` and `data/` in `.gitignore`; PR template requires confirmation |
| Payment initiation abuse | Only PSD2 AIS scopes requested (`balances details transactions`); never PIS |

## Non-goals

- Protection against a compromised OS user account reading process memory.
- Protection if the user runs the app on hardware they do not control.
- Protection against a malicious or compromised GoCardless API response (we trust the vendor for the data path; we audit what we persist).

## Reporting

See [`../SECURITY.md`](../SECURITY.md).
