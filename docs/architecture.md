# Architecture (overview)

> This is the quick map. For the full, decision-by-decision treatment — stack
> rationale, security model, the AI subsystem, and the reasoning patterns behind
> the design — read **[`../ARCHITECTURE.md`](../ARCHITECTURE.md)** at the repo root.

## At a glance

```
┌──────────────────────────────┐
│  Browser (localhost or HTTPS)│
│  Next.js UI · PWA            │
└──────────────┬───────────────┘
               │ RSC payloads · server actions · /api
               ▼
┌──────────────────────────────┐
│  Next.js 16 server           │
│  - proxy.ts: auth gate + CSP │
│  - auth · session · crypto   │
│  - redaction · categorization│
│  - LLM context + provider    │
└──────┬───────────┬───────────┘
       │           │
       ▼           ▼
┌──────────┐   ┌────────────────────────────┐
│ Database │   │ External (egress, server)  │
│ SQLite   │   │ - bank provider (GoCardless│
│  file OR │   │   / TrueLayer, read-only)  │
│ Turso    │   │ - LLM provider (redacted)  │
│ (libSQL) │   │                            │
└──────────┘   └────────────────────────────┘
```

The browser talks only to the app server. All network egress happens from the
Next.js server process and is limited to three destinations: the database
(local file or Turso), the configured bank-data provider (PSD2 *read-only*
scopes), and the user's configured LLM provider (which receives only redacted
aggregates). The full threat model is in [`security.md`](security.md).

## Two runtime modes, one codebase

`AUTH_MODE` switches the app between **local** (single-user, PIN, SQLite file,
Ollama) and **oauth** (multi-user, Auth.js, Turso, cloud LLM). The mode boundary
is thin: it lives entirely in `getCurrentSession()`
([`src/lib/auth/session.ts`](../src/lib/auth/session.ts)), which returns an
identical `SessionData` shape in both modes, so the rest of the app never
branches on mode. See [ARCHITECTURE.md §2](../ARCHITECTURE.md#2-the-two-runtime-modes).

## Data layering

- **Plaintext** (safe to log at debug): category names, aggregate counts.
- **Sensitive-but-not-secret** (stored as plaintext columns, never logged):
  transaction amounts, booking dates, merchant descriptions.
- **Secret** (stored encrypted via the `encryptedText` Drizzle column type):
  bank requisition IDs and access tokens, internal account IDs, LLM API keys.
  Cipher is AES-256-GCM; the key is derived from the user's PIN + `APP_SECRET` +
  per-user salt (or, in OAuth mode, from `APP_SECRET` + salt alone).

## Per-user isolation

Every user-owned table carries a `user_id` (migration `0013`). New columns were
added with `DEFAULT 0 NOT NULL`, and `0` is never a real user — so any row not
yet claimed by [`scripts/backfill-ownership.ts`](../scripts/backfill-ownership.ts)
is visible to **nobody** (fail-closed). Every read and write is scoped by the
session's `userId`; the client never supplies it.

## Key modules

- [`src/lib/crypto.ts`](../src/lib/crypto.ts) — AES-256-GCM + scrypt. Pure, unit-tested.
- [`src/lib/redact.ts`](../src/lib/redact.ts) — PII stripping applied before any LLM call.
- [`src/lib/auth/`](../src/lib/auth) — PIN, DB-backed sessions, OAuth config, guest mode.
- [`src/lib/llm/provider.ts`](../src/lib/llm/provider.ts) — provider resolver (Ollama / Claude / OpenAI / Gemini).
- [`src/lib/advisor/`](../src/lib/advisor) — redacted context builder, system prompt, conversations, digest.
- [`src/lib/gocardless/`](../src/lib/gocardless), [`src/lib/truelayer/`](../src/lib/truelayer), [`src/lib/providers/demo/`](../src/lib/providers/demo) — bank-data providers behind one contract.
- [`src/lib/categorize/`](../src/lib/categorize) — rules → keyword → LLM ladder.
- [`src/lib/recurring/`](../src/lib/recurring), [`predictions/`](../src/lib/predictions), [`insights/`](../src/lib/insights), [`opportunities/`](../src/lib/opportunities), [`travels/`](../src/lib/travels) — derived intelligence (transparent heuristics, no ML).
- [`src/lib/security/`](../src/lib/security) — CSRF guard, rate limiter.
- [`src/db/`](../src/db) — Drizzle schema, migrations, seed.
- [`src/proxy.ts`](../src/proxy.ts) — Next 16 middleware: auth gate + per-request CSP nonce.
