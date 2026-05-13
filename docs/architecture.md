# Architecture

> _Fleshed out as phases land. This is a living document._

## At a glance

```
┌──────────────────────────────┐
│  Browser (localhost)         │
│  Next.js UI · PWA            │
└──────────────┬───────────────┘
               │ server actions / RSC
               ▼
┌──────────────────────────────┐
│  Next.js server (127.0.0.1)  │
│  - auth · session · crypto   │
│  - redaction · categorization│
└──────┬───────────┬───────────┘
       │           │
       ▼           ▼
┌──────────┐   ┌────────────────────┐
│ SQLite   │   │ External (egress)  │
│ (local)  │   │ - GoCardless API   │
│ data/*   │   │ - LLM provider     │
└──────────┘   └────────────────────┘
```

The browser talks only to localhost. All network egress happens from the Next.js server process and is limited to two destinations: the GoCardless Bank Account Data API (PSD2) and the user's configured LLM provider. See [`security.md`](security.md) for the full threat model.

## Data layering

- **Plaintext** (safe to log at debug): category names, aggregate counts, merchant names.
- **Sensitive-but-not-secret** (stored, never logged): transaction amounts, booking dates, merchant descriptions.
- **Secret** (stored encrypted via `customType` in Drizzle): GoCardless requisition IDs and access tokens, internal account IDs, LLM API keys. Cipher is AES-256-GCM; key is derived from the user's PIN + `APP_SECRET` + per-user salt.

## Key modules

- `src/lib/crypto.ts` — AES-256-GCM + scrypt. Pure and unit-tested.
- `src/lib/redact.ts` — PII stripping applied before any LLM call.
- `src/lib/auth/` — PIN, sessions, middleware.
- `src/lib/gocardless.ts` — bank aggregation (Phase 2).
- `src/lib/llm/` — provider abstraction (Phase 4).
- `src/db/` — Drizzle schema, migrations, seed.
