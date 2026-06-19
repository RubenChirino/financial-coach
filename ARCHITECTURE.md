# Architecture

> A deep, opinionated tour of how Financial Coach is built — and *why* it is
> built that way. It doubles as a case study in making sound architectural
> decisions for a real product: at each fork in the road you'll find not just
> the choice we made but the alternatives we weighed and the reasoning that
> separated them.

If you only want to *run* the app, read [SETUP.md](SETUP.md). If you want to
*contribute*, read [CONTRIBUTING.md](CONTRIBUTING.md). If you want to
*understand* the system — or learn how a senior engineer reasons about one —
read on.

---

## Table of contents

1. [First principles](#1-first-principles)
2. [The two runtime modes](#2-the-two-runtime-modes)
3. [System context](#3-system-context)
4. [Technology choices (and the roads not taken)](#4-technology-choices-and-the-roads-not-taken)
5. [Request lifecycle](#5-request-lifecycle)
6. [The data layer](#6-the-data-layer)
7. [Security architecture](#7-security-architecture)
8. [The AI subsystem](#8-the-ai-subsystem)
9. [Bank aggregation](#9-bank-aggregation)
10. [The categorization pipeline](#10-the-categorization-pipeline)
11. [Derived intelligence](#11-derived-intelligence)
12. [Frontend architecture](#12-frontend-architecture)
13. [Quality & delivery](#13-quality--delivery)
14. [Cross-cutting lessons](#14-cross-cutting-lessons)
15. [Where things live](#15-where-things-live)

---

## 1. First principles

Every non-trivial decision in this codebase descends from four principles.
When two principles conflict (they sometimes do), the one higher in this list
wins. Naming them explicitly is what keeps a year of incremental features from
drifting into incoherence.

1. **Privacy is a property, not a feature.** Financial data is among the most
   sensitive a person owns. The default posture is that nothing leaves the
   user's machine. Every outbound byte must be deliberate, minimal, redacted,
   and consented to. This is why the app binds to `127.0.0.1`, why PII is
   stripped before *any* LLM call (even a local one), and why the LLM only ever
   sees rounded aggregates instead of transaction rows.

2. **Local-first, cloud-optional.** The reference deployment is a single binary
   on your laptop talking to a SQLite file. Everything else — multi-user
   hosting, Turso, OAuth — is an *additive* mode layered on the same code, never
   a different application. One schema, one set of business logic, two ways to
   run it.

3. **The blast radius of a bug is bounded by design.** A finance app that can
   leak PII or rack up paid API calls has to assume any single layer can fail.
   Hence: read-only bank scopes (the app *cannot* move money even if fully
   compromised), encryption at rest keyed by a secret that isn't in the
   database, per-user data scoping that fails *closed*, and rate limits in front
   of every paid path.

4. **Honest software.** The AI coach never invents numbers and never gives
   regulated investment advice. Forecasts are transparent arithmetic the user
   can verify, not a black-box model. When the app doesn't know something, it
   says so. Trust is the entire value proposition; one hallucinated balance
   destroys it.

Hold these four in mind and most of what follows will read as inevitable rather
than arbitrary.

---

## 2. The two runtime modes

The single most important structural decision is that the app runs in two modes
from **one codebase**, switched by the `AUTH_MODE` environment variable.

| Dimension        | `AUTH_MODE=local` (default)            | `AUTH_MODE=oauth` (hosted)                       |
| ---------------- | -------------------------------------- | ------------------------------------------------ |
| Users            | Exactly one                            | Many (one row per OAuth identity)                |
| Authentication   | 4-digit PIN, custom DB-backed sessions | Auth.js v5, Google / Microsoft / GitHub          |
| Database         | SQLite file on disk (`data/*.db`)      | libSQL / Turso (hosted SQLite over HTTP)         |
| At-rest key      | `scrypt(PIN ∷ APP_SECRET, salt)`       | `scrypt("oauth" ∷ APP_SECRET, salt)`             |
| Default LLM      | Ollama (local, free, private)          | Gemini (Ollama is unreachable from serverless)   |
| Network exposure | `127.0.0.1` only                       | Public HTTPS                                      |
| Cloud consent    | Explicit one-time modal                | Implicit (already on a cloud service)            |

> **Decision — one codebase, two modes vs. two products.**
> The tempting alternative is to ship "the local app" and "the SaaS" as separate
> codebases (or a fork). That doubles the maintenance surface and guarantees the
> two drift apart. Instead we made *mode* a runtime concern resolved at a single
> seam (`getCurrentSession()` in [`src/lib/auth/session.ts`](src/lib/auth/session.ts)).
> Downstream code — every page, every server action — receives an identical
> `SessionData` shape (`{ userId, encryptionKey, … }`) and never branches on
> mode. The cost is a little indirection in the auth layer; the payoff is that
> 99% of the application is mode-agnostic and a feature written once works in
> both worlds.

The mode boundary is deliberately *thin and low*. It lives entirely inside
`getCurrentSession()`: PIN mode reads a hashed-token cookie and looks up a DB
session row; OAuth mode defers to Auth.js's JWT and derives the key on demand.
Both return the same object. Everything above that line is blissfully unaware.

---

## 3. System context

```
                    ┌─────────────────────────────────────────────┐
                    │                  Browser                     │
                    │   React 19 UI · PWA · privacy/currency store │
                    └───────────────┬─────────────────────────────┘
                                    │  HTTPS / localhost
                                    │  (RSC payloads, Server Actions, /api)
                    ┌───────────────▼─────────────────────────────┐
                    │            Next.js 16 server                 │
                    │  proxy.ts: auth gate · CSP nonce · headers   │
                    │  ┌────────────┐  ┌────────────┐  ┌─────────┐ │
                    │  │ auth /     │  │ business   │  │ redact  │ │
                    │  │ sessions / │  │ logic      │  │ + LLM   │ │
                    │  │ crypto     │  │ (lib/*)    │  │ context │ │
                    │  └─────┬──────┘  └─────┬──────┘  └────┬────┘ │
                    └────────┼───────────────┼──────────────┼──────┘
                             │               │              │
                  ┌──────────▼───┐   ┌────────▼───────┐  ┌───▼─────────────┐
                  │  Database    │   │  Bank provider │  │  LLM provider   │
                  │  SQLite file │   │  GoCardless /  │  │  Ollama (local) │
                  │  or Turso    │   │  TrueLayer     │  │  / Claude /     │
                  │  (libSQL)    │   │  (PSD2, AIS)   │  │  OpenAI / Gemini│
                  └──────────────┘   └────────────────┘  └─────────────────┘
                                       outbound egress       outbound egress
                                       (read-only scopes)     (redacted only)
```

The browser talks only to the app server. The app server makes exactly **three**
kinds of outbound call, all from server-side code, never the browser:

1. **The database** — local file (in-process libSQL) or Turso over HTTPS.
2. **A bank data provider** — GoCardless or TrueLayer, using PSD2 *Account
   Information Service* scopes only (balances + transactions; never payments).
3. **An LLM provider** — local Ollama daemon, or a cloud API receiving only
   redacted aggregates.

There is no analytics endpoint, no telemetry, no third-party script, no ad
network. The [Content-Security-Policy](#73-defense-in-depth-csp-csrf-headers)
enforces this at the browser: `connect-src` is `'self'` (plus the local Ollama
port in local mode), so even a hypothetical XSS payload has nowhere to phone
home.

---

## 4. Technology choices (and the roads not taken)

The stack is intentionally boring where boring is a virtue and modern where
modern earns its keep. Here is the full inventory with the reasoning behind each
load-bearing choice.

### 4.1 Language & runtime — TypeScript on Node 24 LTS

TypeScript end to end, `strict` mode on. For an app whose bugs leak PII or money,
a compiler that proves "this value can't be null here" and "this currency code is
one of these literals" is worth its weight. The schema's column enums
(`"created" | "linked" | "expired" | …`) flow into the query layer and out to the
UI as exhaustive unions, so adding a status forces every `switch` to be revisited.

> **Decision — TypeScript vs. plain JS / Rust / Go.** A native language (Rust,
> Go) would give a single distributable binary, attractive for "double-click to
> run." But the product is a *web UI* with a rich, fast-moving frontend; React +
> TypeScript is the path of least resistance there, and Next.js lets the same
> language and types span client and server. The frontier of LLM tooling (the
> Vercel AI SDK, provider clients) is also TS-first. Node 24 LTS is pinned via
> `.nvmrc`; the lower bound is Node 20 (`package.json` `engines`) so Vercel's
> runtime is supported.

### 4.2 Framework — Next.js 16 (App Router) + React 19

The App Router's **React Server Components** are the backbone. Most pages are
async server components that query the database directly and render HTML — no
client-side data fetching, no loading spinners, no API surface to secure for
reads. **Server Actions** handle mutations as type-safe RPC: a form calls a
server function directly, and Next.js handles the wire protocol *and the CSRF
protection* for free.

> **Decision — RSC + Server Actions vs. SPA + REST/tRPC.** A classic
> SPA-over-REST split would mean: build and secure a JSON API, duplicate types
> across the wire, manage client cache invalidation, and ship the data-fetching
> logic to the browser. With RSC, a page that shows your dashboard is *one async
> function* that runs on the server, touches the DB, and streams HTML. The
> sensitive query never leaves the server; there's no endpoint to find. We pay
> for this with a steeper mental model (the server/client boundary is real and
> unforgiving — see [§12](#12-frontend-architecture)) and a framework that moves
> fast. We judged the security and simplicity dividend worth it for a data-dense,
> mostly-read application. Plain `/api` route handlers still exist for the few
> cases RSC can't serve: streaming LLM responses, file downloads, OAuth
> callbacks, health checks.

A Next.js 16 detail worth flagging: middleware is now conventionally a file
named [`src/proxy.ts`](src/proxy.ts) (not `middleware.ts`). It runs on every
request to gate auth and stamp a per-request CSP nonce.

### 4.3 Data — Drizzle ORM over libSQL

[Drizzle](https://orm.drizzle.team) is a thin, typed SQL builder. Schema is
declared in TypeScript ([`src/db/schema.ts`](src/db/schema.ts)); queries read
like SQL but are fully typed; migrations are generated as plain `.sql` files you
can read and audit.

> **Decision — Drizzle vs. Prisma vs. raw SQL.** Prisma is more batteries-included
> but historically shipped a Rust query engine binary (a heavier install, a
> harder fit for "runs on a laptop" and for serverless cold starts) and hides SQL
> behind a generated client. Raw SQL is maximally transparent but throws away
> compile-time safety on a codebase where a wrong column means a wrong balance.
> Drizzle threads the needle: no native binary, SQL you can see, types you can
> trust. The migration story is plain SQL we review by eye — important when a
> migration like `0013_user_scoping` rewrites ownership across nine tables.

> **Decision — libSQL/SQLite vs. Postgres.** A finance app for one person (or a
> family) does not need a multi-tenant Postgres cluster. SQLite is the most
> deployed database on earth, runs in-process with zero operational overhead, and
> *is a file you can back up by copying it*. The masterstroke is
> [libSQL](https://turso.tech): the same Drizzle schema and the same
> `@libsql/client` driver talk to either a local file *or* a hosted Turso replica
> — switching is one `DATABASE_URL` change ([`src/db/client.ts`](src/db/client.ts)
> normalizes the URL). We get the laptop story and the cloud story from one data
> layer. The trade-off — SQLite's single-writer model — is a non-issue at this
> app's concurrency, and WAL mode (set as a PRAGMA on local files) keeps reads
> non-blocking.

### 4.4 Authentication — split by mode

- **Local mode** uses a hand-rolled PIN + session system. There is no heavyweight
  auth library because there is one user and no third party. A 4-digit PIN feeds
  `scrypt`; sessions are random tokens stored *hashed* in the DB. (Why not the
  original in-memory `Map`? See [§7.2](#72-sessions).)
- **Hosted mode** uses [Auth.js v5](https://authjs.dev) (`next-auth@5`) with a
  **JWT strategy and no database adapter** — see
  [`src/lib/auth/oauth-config.ts`](src/lib/auth/oauth-config.ts).

> **Decision — Auth.js JWT vs. Auth.js DB adapter.** The DB adapter does a session
> lookup on every request. JWT sessions verify a signed token with `AUTH_SECRET`
> and need zero DB round-trips for the common path — exactly right for serverless,
> where each cold request pays for its own connections. Our own `users` table
> stays the identity source of truth; the JWT carries only the internal `userId`,
> and everything else is read from the DB when actually needed. Sessions are
> capped at 24h with a 6h sliding refresh — shorter than the Auth.js 30-day
> default because a stolen session here reads bank data, and that's the posture a
> bank itself would take.

### 4.5 The LLM layer — Vercel AI SDK + a provider seam

The [Vercel AI SDK](https://sdk.vercel.ai) (`ai` v4) gives one `streamText` /
`generateObject` interface across providers. Concrete adapters —
`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, and
`ollama-ai-provider` — are selected behind a single resolver in
[`src/lib/llm/provider.ts`](src/lib/llm/provider.ts).

> **Decision — an SDK abstraction vs. calling each vendor's REST API directly.**
> Four providers with four request/response shapes, four streaming protocols, and
> four auth schemes would be four times the surface to maintain and test. The AI
> SDK normalizes all of that, and crucially normalizes *streaming* into a protocol
> the React `useChat` hook consumes natively. The provider is chosen by merging a
> per-user DB preference with an env fallback, so a user can switch models in
> Settings with no redeploy — and hosted mode silently rewrites an "ollama"
> preference to Gemini because a serverless function can't reach a localhost
> daemon. That one resolver is where "local-first or cloud" stops being a
> deployment concern and becomes a runtime detail.

### 4.6 UI — Tailwind v4, shadcn/ui, Radix, Lucide, Recharts, Framer Motion

- **Tailwind CSS v4** for styling, driven by a design-token system ported from the
  "Coin" design handoff (`@theme inline` exposes brand tokens as utilities).
- **shadcn/ui** — not a dependency but *copied components* (`src/components/ui`)
  built on **Radix UI** primitives. You own the code, so you can theme and audit
  it; Radix supplies accessible, unstyled behavior (focus traps, ARIA, keyboard
  nav) that is genuinely hard to get right by hand.
- **Lucide** icons, **Recharts** plus a few hand-rolled pure-SVG charts
  (`src/components/charts`) that render on the server with zero client JS.
- **Framer Motion** for the small, restrained animations the design calls for.

> **Decision — shadcn/ui (copy-in) vs. a packaged component library (MUI, Chakra).**
> A packaged library is faster to start but owns your markup and fights you on
> theming and bundle size. shadcn/ui's "copy the source into your repo" model
> means the components *are* our code — we restyle freely, drop what we don't use,
> and there's no version-lock between the library's design opinions and ours. For
> a product whose entire identity is a specific visual system, owning the
> components was the right call.

### 4.7 Supporting cast

| Concern              | Library                          | Why this one                                                              |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| i18n                 | `next-intl` v4                   | ICU plurals, cookie-driven locale, first-class App Router/RSC support     |
| Theming              | `next-themes`                    | SSR-safe dark mode with no flash-of-wrong-theme (nonce-bound boot script) |
| Client state         | `zustand` v5                     | Tiny pub-sub store for privacy-blur + display currency; no provider tree  |
| Forms + validation   | `react-hook-form` + `zod`        | Uncontrolled-input performance; `zod` schemas shared by forms *and* env   |
| Schema validation    | `zod`                            | One validator for env, server-action inputs, and API bodies              |
| Spreadsheets         | `exceljs` + SheetJS (`xlsx`)     | Server-side XLSX export and import without shipping a parser to the client|
| Lint + format        | **Biome**                        | One fast Rust tool replacing ESLint + Prettier; near-zero config drift    |
| Tests                | **Vitest** + Testing Library     | Vite-native speed; `happy-dom` for component tests                        |
| E2E                  | **Playwright**                   | Cross-browser flows for the auth + sync paths                             |
| Secret scanning      | **gitleaks**                     | Pre-commit hook + CI; a finance repo must never leak a key                |

---

## 5. Request lifecycle

Three representative flows show how the pieces compose.

### 5.1 Loading a page (read)

1. The browser requests `/` (the dashboard).
2. [`src/proxy.ts`](src/proxy.ts) runs first: it checks for a session cookie
   (PIN-mode `fc_session` or an Auth.js cookie). No session and not a public path
   → redirect to `/lock`. It also mints a per-request CSP nonce, exposes it via
   the `x-nonce` header (so the root layout can read it through `headers()` and
   feed it to scripts that need to be allowed) and writes the matching
   `Content-Security-Policy` response header.
3. The dashboard page is an **async server component**. It calls
   `getCurrentSession()` once, then fires its data queries *in parallel*
   (`Promise.all`) — month summaries, account tiles, top categories, the digest.
   Each query is scoped by `userId`.
4. The server renders HTML and streams it. The client receives a painted page;
   only the genuinely interactive bits (the privacy toggle, charts that need
   hover) hydrate as client components.

No JSON API was involved, no data-fetching code shipped to the browser, and the
sensitive SQL never left the server.

### 5.2 Editing a transaction (write)

1. A client component calls a **server action** (e.g. `setTransactionCategory`)
   imported from [`src/lib/transactions/actions.ts`](src/lib/transactions/actions.ts).
2. Next.js handles the RPC and its built-in CSRF check.
3. The action re-derives the session (never trusts a client-supplied user id),
   calls `assertWritable()` to reject read-only guests, validates input with
   `zod`, writes scoped by `userId`, and calls `revalidatePath()` so the next
   render reflects the change.

The client never names a user. Ownership is always re-established server-side
from the session — the cornerstone of the multi-user isolation model.

### 5.3 Asking the coach a question (stream)

This is the one path that *must* be a route handler, because it streams tokens.
See [`src/app/api/advisor/chat/route.ts`](src/app/api/advisor/chat/route.ts):

1. **CSRF** — `guardCsrf(req)` rejects cross-origin POSTs (a malicious page must
   not be able to spend your LLM budget).
2. **Auth** — no session → 401; a read-only guest → 403.
3. **Rate limit** — `consumeQuota(chat:<userId>, 20/min)` *before* any DB read or
   model call, capping per-user spend.
4. **Consent gate** — if the resolved provider is a cloud one and the user hasn't
   consented, return 403; the UI shows a one-time modal and retries.
5. **Context** — `buildAdvisorContext()` assembles a small, **redacted** JSON
   snapshot (rounded aggregates, redacted merchant names — never rows). See
   [§8.2](#82-the-context-the-only-thing-the-model-sees).
6. **Persist-then-stream** — the user's message is saved *before* the model call
   (so a crash mid-stream doesn't lose it); `streamText` streams the reply; the
   assistant message is persisted in `onFinish`.

---

## 6. The data layer

### 6.1 Schema shape

[`src/db/schema.ts`](src/db/schema.ts) is the canonical description of the domain.
The table families:

- **Identity & auth** — `users` (holds *both* PIN-mode and OAuth-mode users, the
  unused columns simply NULL), `sessions`, `provider_credentials`.
- **Banking** — `institutions`, `requisitions` (a bank *connection*, tagged with
  its `provider`), `accounts`, `transactions`, `import_batches`.
- **Taxonomy & money rules** — `categories` (shared, system-seeded),
  `category_rules`, `budgets` (per-user).
- **Derived intelligence** — `recurring_subscriptions`, `insights`,
  `investor_profiles`, `goals`, plus the Travels caches (`travel_city_labels`,
  `city_countries`).
- **AI** — `advisor_conversations`, `advisor_messages`.
- **Ops** — `audit_log`.

A few modeling decisions are worth calling out because each encodes a principle:

> **Decision — one `users` table for two auth modes.** Rather than separate
> `local_users` and `oauth_users`, a single table carries nullable `pin_hash` /
> `pin_salt` *and* nullable `email`. The auth code chooses the path from
> `AUTH_MODE`, never from "which columns happen to be set." This keeps every
> foreign key (`transactions.userId → users.id`) uniform across modes.

> **Decision — denormalized `userId` on `transactions`.** `transactions` could
> reach its owner by joining through `accounts`. Instead the owner is copied onto
> every transaction row. The reason is that *almost every query filters by user*,
> and a single indexed `WHERE user_id = ?` beats a join on the hottest table in
> the app. The cost — keeping the copy correct on insert — is paid in exactly one
> place (the ingest path). This is a classic, deliberate denormalization: trade a
> tiny write-time invariant for a pervasive read-time win.

> **Decision — `budgets` split out of `categories`.** The category taxonomy is
> *shared* across all users (everyone's "Groceries" is the same row); a budget is
> *private*. Storing a budget on the shared category row is therefore a category
> error (pun intended). Migration `0013` moved budgets to a per-user table and
> left `categories.budget_monthly_cents` as a `@deprecated` column purely so the
> backfill had something to read from.

### 6.2 Encryption as a column type

Secrets that must round-trip but must never sit in plaintext (bank requisition
IDs, account IDs, stored API keys) use a custom Drizzle column type:

```ts
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => v,    // app encrypts before insert
  fromDriver: (v) => v,  // app decrypts after select
});
```

The column stores opaque base64 ciphertext. Encryption/decryption happens in the
application layer with the session's key, so the database file alone — without
the key — yields nothing. (See [§7.1](#71-encryption-at-rest).)

### 6.3 Migrations: a custom runner

Migrations are generated by `drizzle-kit` but **applied by a hand-written runner**
([`scripts/migrate.ts`](scripts/migrate.ts)), invoked via `pnpm db:migrate` and in
the Vercel build.

> **Decision — a custom migrator vs. `drizzle-orm/libsql/migrator`.** The built-in
> migrator emitted Postgres-flavored DDL for its bookkeeping table and batched
> multi-statement requests that Turso's strict HTTP parser rejects. Rather than
> fight the abstraction, the runner reads the same `_journal.json`, splits each
> file on drizzle's own `--> statement-breakpoint` marker, applies statements one
> at a time, and records the *same* SHA-256 hash drizzle uses — so a DB previously
> migrated by the official tool stays compatible. When a dependency's abstraction
> doesn't fit, owning the 100 lines underneath it is often cheaper than working
> around it forever.

---

## 7. Security architecture

Security here is layered so that no single failure is catastrophic. The full
threat model lives in [docs/security.md](docs/security.md); this is the
architectural shape of it.

### 7.1 Encryption at rest

[`src/lib/crypto.ts`](src/lib/crypto.ts) is small, pure, and unit-tested.

- **Cipher:** AES-256-GCM (authenticated — tampering is detected on decrypt).
- **KDF:** `scrypt` with `N = 2^16`, deliberately expensive to make brute force
  costly.
- **Key derivation:**
  - PIN mode: `key = scrypt(PIN ∷ APP_SECRET, perUserSalt)`. Both a thing the user
    *knows* (PIN) and a thing on the *server* (`APP_SECRET`, in `.env`, never in
    the DB) are required. Steal the database alone → you have ciphertext and
    nothing else.
  - OAuth mode: `key = scrypt("oauth" ∷ APP_SECRET, perUserSalt)`. There's no
    user-held secret in a hosted flow, so the key rests on `APP_SECRET` + salt.
    The `oauth::` domain-separation prefix guarantees the same secret and salt
    derive a *different* key than PIN mode would. This is the documented, weaker
    tradeoff of hosted mode: a full server compromise (DB **and** `APP_SECRET`)
    decrypts OAuth users' data. PIN mode remains strictly stronger.

> **Decision — encrypt columns, not the whole file.** Whole-database encryption
> (e.g. SQLCipher) protects everything but needs the key resident for *all*
> access, including non-sensitive reads, and complicates the "it's just a file"
> backup story. Column-level encryption keeps amounts/dates/merchants queryable
> as plaintext (they're sensitive-but-not-secret) while the genuinely secret
> material — tokens, keys, external account IDs — is opaque without the user's
> key. The threat we optimize against is *file exfiltration*, and column
> encryption defeats it for the things that matter most.

### 7.2 Sessions

Persisted in the `sessions` table ([`src/lib/auth/session.ts`](src/lib/auth/session.ts)):

- The cookie holds a 256-bit random token; the DB stores only its **SHA-256
  hash**, so DB theft doesn't yield a usable cookie.
- The per-session encryption key is **wrapped** with an `APP_SECRET`-derived key
  before storage — unwrapping needs `APP_SECRET`. Rotate `APP_SECRET` and all
  sessions die (fail-safe).
- 15-minute inactivity timeout; stale rows are deleted on access.

> **Decision — DB-backed sessions vs. the original in-memory `Map`.** Early on,
> sessions lived in a process-local `Map`. It worked in production (one stable
> process) but in dev, Next.js HMR re-evaluates modules and wiped the map,
> producing the infamous "enter the correct PIN, get bounced back to /lock" loop.
> Moving sessions to the DB fixed the dev bug *and* survives restarts, with the
> token-hash + key-wrapping design ensuring the move added no plaintext to disk.
> The lesson: state that must outlive a module's lifetime doesn't belong in a
> module.

### 7.3 Defense in depth: CSP, CSRF, headers

- **Content-Security-Policy** ([`src/proxy.ts`](src/proxy.ts)) — a strict,
  per-request **nonce + `'strict-dynamic'`** policy. Next.js emits inline
  bootstrap scripts on every page; a static `script-src 'self'` would blank the
  page, and `'unsafe-inline'` would neuter the policy. The nonce is the official
  way to keep the policy strict without breaking hydration. `connect-src` is
  `'self'` (plus the Ollama port *only in local mode*), closing the data-exfil
  vector that an XSS would otherwise have.
- **CSRF** ([`src/lib/security/csrf.ts`](src/lib/security/csrf.ts)) — Server
  Actions get CSRF protection from the framework, but plain `/api/*` handlers are
  cookie-authenticated and would otherwise be forgeable. `guardCsrf` pins
  `Origin` / `Referer` / `Sec-Fetch-Site` to same-origin for every state-changing
  route — important for `/api/backup/restore` (can wipe data) and
  `/api/advisor/chat` (costs money).
- **Static headers** ([`next.config.ts`](next.config.ts)) — `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a
  locked-down `Permissions-Policy`, COOP/CORP, and HSTS.

### 7.4 Multi-user isolation that fails closed

When the app went multi-user (migration `0013`), every user-owned table gained a
`user_id`. The column was added with `DEFAULT 0 NOT NULL` — and `0` is **not a
real user**. So any row not yet claimed by the
[`scripts/backfill-ownership.ts`](scripts/backfill-ownership.ts) pass is visible
to *nobody* rather than to everybody. Fail-closed, not fail-open. Every read and
write is scoped by the session's `userId`; the client never supplies it.

### 7.5 Rate limiting & PII redaction

- **PIN unlock** is guarded by an exponential-backoff limiter
  ([`src/lib/security/rate-limit.ts`](src/lib/security/rate-limit.ts)) — free
  retries for human typos, escalating lockouts for bots, on top of scrypt's
  inherent ~100ms cost.
- **Redaction** ([`src/lib/redact.ts`](src/lib/redact.ts)) strips IBANs, card
  numbers, emails, phones, DNI/NIE, postal codes, and long digit runs from *any*
  text bound for an LLM — local or cloud. It is intentionally over-eager: a false
  positive (over-redaction) is harmless; a false negative leaks PII.

---

## 8. The AI subsystem

### 8.1 Provider resolution

[`src/lib/llm/provider.ts`](src/lib/llm/provider.ts) resolves the effective
`(provider, model)` by merging the user's stored preference with the env default,
gated by whether the corresponding API key is actually present. The hosted-mode
rule — "treat an `ollama` preference as unset, fall through to Gemini" — lives
here, in one function. The rest of the app calls `getLanguageModel(prefs)` and
gets back a ready `LanguageModel`.

### 8.2 The context: the only thing the model sees

[`src/lib/advisor/context.ts`](src/lib/advisor/context.ts) builds the entire
universe the LLM knows about the user — and it is small by design:

- **No transaction rows ever leave this function.** Only aggregates: monthly
  income/expense/net, top categories, top merchants (redacted), budgets,
  subscriptions, goals, the forecast summary, and an optional investor profile.
- Amounts are rounded to whole units (euros, not cents) to blunt
  balance-fingerprinting.
- Merchant names pass through `redactPII` even though they rarely contain digits
  — defense in depth.
- The window is **anchored to the user's most recent month with data**, not the
  current calendar month, so a user who imported historical data months ago still
  gets a meaningful snapshot instead of all zeros.

The whole snapshot is kept under ~2 KB so it fits in every turn's prompt; it's
rebuilt fresh per request rather than cached, because the user's data may have
changed between turns.

### 8.3 Guardrails in the system prompt

[`src/lib/advisor/prompt.ts`](src/lib/advisor/prompt.ts) encodes the "honest
software" principle as hard rules the model is instructed to follow: answer in
the user's language, use *only* the snapshot's numbers (never invent), and — the
hard limit — **never recommend specific financial instruments** (tickers, named
funds, specific cryptos or brokers). The coach may explain general principles and
tailor *framing* to the user's profile, but regulated advice is off the table. A
financial app that hands out stock picks is a liability; one that teaches
principles and grounds them in your real numbers is a feature.

---

## 9. Bank aggregation

### 9.1 The provider contract

A "provider" is any source of accounts + transactions. The discriminator is
`requisitions.provider`; downstream tables (`institutions`, `accounts`,
`transactions`) are provider-agnostic and just hang off a requisition.
[`src/lib/providers/types.ts`](src/lib/providers/types.ts) defines the contract.
Three providers implement it:

- **GoCardless Bank Account Data** (PSD2/Nordigen) — the primary, broad-coverage
  Open Banking provider. Read-only AIS scopes only.
- **TrueLayer** — an alternate Open Banking provider with better Live coverage for
  some banks (Santander ES, Revolut, Monzo). Its client credentials are stored
  AES-256-GCM in the user's DB, not in env.
- **Demo** — a deterministic local seeder ([`src/lib/providers/demo/seed.ts`](src/lib/providers/demo/seed.ts))
  producing a plausible institution, account, and ~3 months of transactions.
  Lets anyone explore the entire app with zero API keys.

> **Decision — abstract the provider, not the bank.** We don't try to model every
> bank; we model the *aggregator*. Each provider's quirks (OAuth dance, token
> lifetimes, transaction normalization) are contained in its own
> `src/lib/<provider>/` folder with a `client`, `credentials`, `normalize`, and
> `sync` module. The normalize step is where vendor JSON becomes our uniform
> `NewTransaction` shape; everything past it is identical regardless of source.
> Adding a fourth provider is "implement the four modules," not "touch the whole
> app."

### 9.2 Sync and dedup

Sync pulls **booked** transactions (pending ones can change or vanish), normalizes
them, and upserts keyed by the provider's stable transaction id with fallbacks
(see each provider's `normalize.ts`). Re-running sync is therefore idempotent.
Right after a sync, the cheap deterministic categorizer (rules only, no LLM) runs
so new rows aren't uncategorized for long, and the recurring-subscription detector
refreshes.

### 9.3 CSV / XLSX import as a first-class provider

Imported statements ([`src/lib/import/`](src/lib/import)) flow into the *same*
tables under a synthetic "Imported" institution/requisition/account, so the
dashboard, transaction list, and categorizer treat them identically to
bank-synced data. XLSX is parsed server-side (SheetJS) so no parser ships to the
browser; an AI-assisted column mapper handles unfamiliar bank export formats; and
every import is grouped under an `import_batches` row so a bad upload can be
deleted as a unit.

---

## 10. The categorization pipeline

Categorizing a transaction is a cost/accuracy ladder
([`src/lib/categorize/index.ts`](src/lib/categorize/index.ts)). For each pending
row, in order:

1. **Deterministic rules** (`category_rules`) — fast, free, exact. Confidence 1.0.
2. **Well-known-merchant keywords** — a curated heuristic for the long tail of
   common merchants. Free.
3. **LLM fallback** — only for what the first two miss, with PII redacted, capped
   per run, and flagged `needsReview` when the model's confidence is low.

> **Decision — cheapest reliable signal first.** Hitting an LLM for "MERCADONA →
> Groceries" would be slow, costly, and *less* reliable than a rule. So the LLM is
> the last resort, not the first reach. Confidence is encoded so the system stays
> honest: rules/keywords are authoritative, LLM guesses below threshold go to a
> review queue, and **only a user's manual pick ever reaches confidence 100** — a
> sentinel the re-correction pass (`recorrectCategories`) refuses to overwrite.
> The batch path is cursor-based so the background "categorize everything" loop
> always terminates even if the LLM is offline (failed rows fall behind the cursor
> and are retried next run, never stalling it).

---

## 11. Derived intelligence

Five features turn raw transactions into insight. They share one governing
decision.

> **Decision — transparent heuristics over machine learning.** With only a few
> months of one person's banking data, the variance is far too high for a learned
> model to add real signal — and, more importantly, the user has to *trust* the
> number. So every derived feature is arithmetic you can explain in a sentence and
> verify by hand. This is the [§1](#1-first-principles) "honest software" principle
> applied to data science: a forecast you can audit beats a black box you can't.

- **Recurring subscriptions** ([`recurring/detect.ts`](src/lib/recurring/detect.ts))
  — groups transactions by normalized merchant, snaps inter-charge gaps to known
  cadences (weekly … yearly), and accepts a group only when amount variance is
  low. Inflows (payroll) use a tighter variance bar than outflows. Sign convention
  in the stored row lets the forecast bucket each as income vs. spending.
- **Predictions** ([`predictions/forecast.ts`](src/lib/predictions/forecast.ts)) —
  layers *fixed income* + *fixed outflows* + *habitual outflows* (stable monthly
  totals at frequent merchants) + a **median** of variable residuals. Median, not
  mean, so one moving-week or holiday doesn't poison future months. Each layer is
  separately explainable in the UI.
- **Insights** ([`insights/engine.ts`](src/lib/insights/engine.ts)) — a
  rule-based, **idempotent** engine: it deletes non-dismissed insights and
  re-derives them from current state (dismissed ones survive). Overspend, low
  balance, needs-review, on-track, goal-near. No LLM; titles/bodies are
  pre-rendered in the user's locale so the client needs no translation context.
- **Opportunities** ([`opportunities/opportunities.ts`](src/lib/opportunities/opportunities.ts))
  — five generators (subscription overlap, top overspend, goal projection,
  savings runway, emergency-fund gap), each producing a concrete euro impact from
  the user's own numbers, each returning `null` when the data is too thin to be
  honest. Paired with an enum-only investor questionnaire that personalizes the
  coach's *framing* (never its recommendations).
- **Travels** ([`travels/detect.ts`](src/lib/travels/detect.ts)) — a genuinely
  novel feature: it detects trips by clustering foreign-currency (and out-of-home
  region) payments in time, then labels each trip's city. Trips themselves are
  **recomputed on every load** — never stored — because they're a pure function of
  the transactions. The *only* things persisted are the expensive-to-derive bits:
  an LLM-or-user city label per trip (`travel_city_labels`) and a city→country
  cache (`city_countries`) so the model is asked about a place name at most once.

> **Decision — persist the derivation's expensive inputs, not its output.** For
> Travels, the trip list is cheap to recompute and would only go stale if cached.
> What's expensive is asking an LLM "what country is 'Roma'?" So we cache *that*
> answer (including "tried, not a real place") and recompute the trips freely. Know
> which part of a computation is actually costly before you reach for a cache.

---

## 12. Frontend architecture

### 12.1 The server/client boundary

The default is a **server component**. A component becomes a client component
(`"use client"`) only when it needs interactivity, browser APIs, or hooks. This
keeps the JS bundle small and the sensitive logic server-side.

> **Hard-won lesson — what can cross the boundary.** Props passed from a server
> component to a client component must be *serializable*. Two production crashes
> early on came from violating this: passing a Lucide icon *component* (a
> `forwardRef` object) and passing a translation *function* as a prop. The fixes —
> pass a pre-rendered `ReactNode` instead of a component, and have client
> components call `useTranslations()` themselves — are now patterns. React elements
> are plain data and serialize fine; functions and component classes do not. If
> you take one practical thing from this section, let it be that.

### 12.2 State management

Most state is server state (the DB) reflected through RSC. The little genuinely
*client* state — the privacy blur and the display-currency toggle — lives in
`zustand` stores ([`src/lib/privacy`](src/lib/privacy),
[`src/lib/currency`](src/lib/currency)), persisted to `localStorage`. No context
provider tree, no prop-drilling; a component subscribes to exactly the slice it
needs. `@tanstack/react-query` is available for the few client-fetched bits.

### 12.3 i18n, theming, PWA

- **i18n** — `next-intl` with full ES/EN parity (enforced socially via the PR
  checklist), ICU plurals, and a cookie-driven locale resolved in
  [`src/lib/i18n`](src/lib/i18n). Spanish is the default locale.
- **Theming** — `next-themes` with the anti-FOUC boot script bound to the CSP
  nonce, so the strict policy doesn't flash the wrong theme.
- **PWA** — a manifest + service worker make it installable on iOS/Android, with
  pull-to-refresh and route-progress affordances for an app-like feel.

---

## 13. Quality & delivery

The testing strategy is a pyramid weighted toward the layers where bugs *hurt*:

- **Unit tests (Vitest)** concentrate on the load-bearing pure logic: crypto,
  redaction, categorization rules/heuristics, recurring detection, travel location
  parsing, CSV parsing, the advisor context/prompt, currency math. These are
  fast, deterministic, and where a regression would corrupt data or leak PII.
- **Component tests** (Testing Library + `happy-dom`) cover interactive UI.
- **E2E (Playwright)** covers the critical end-to-end flows.
- A shared in-memory DB fixture ([`src/test/db-fixture.ts`](src/test/db-fixture.ts))
  lets data-layer tests run against a real (ephemeral) SQLite instance.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint →
typecheck → test → `pnpm audit` → build on every push and PR, plus a dedicated
**gitleaks** job. **CodeQL** and **Dependabot** cover code scanning and dependency
updates. A **Husky** pre-commit hook runs gitleaks locally so a secret never
reaches a commit. The lockfile is committed; supply-chain risk is treated as a
first-class threat ([§7](#7-security-architecture)).

> **Decision — Biome over ESLint + Prettier.** Two tools (lint + format) with
> overlapping concerns, plugin sprawl, and config that drifts between machines,
> versus one fast Rust binary that does both with near-zero config. For a project
> that values calm and consistency, the consolidation is worth more than the
> marginal rule coverage a maximalist ESLint setup would add.

---

## 14. Cross-cutting lessons

If you're reading this to learn how to make these calls yourself, here is the
distilled reasoning that recurs throughout the codebase:

1. **Name your principles, then let them decide.** The four principles in
   [§1](#1-first-principles) resolve the *vast* majority of "which way should this
   go?" questions without a meeting. Architecture is mostly the disciplined,
   repeated application of a few priorities.

2. **Put variability behind one seam.** Two auth modes, four LLM providers, three
   bank providers — each is a sprawling source of difference collapsed to a single
   resolution point (`getCurrentSession`, `getLanguageModel`, the provider
   contract). The rest of the app stays simple because the *complexity is
   localized*, not eliminated.

3. **Choose the cheapest reliable mechanism, escalate only when it fails.**
   Rules before keywords before LLM; deterministic heuristics before ML; a file
   before a cluster. Reaching for the powerful tool first is the most common
   over-engineering mistake.

4. **Make failure modes fail safe.** Un-backfilled rows are invisible, not
   universal. A rotated secret kills sessions, not data integrity. An offline LLM
   leaves rows pending, not corrupted. Decide what happens when each layer breaks
   *before* it breaks.

5. **Minimize what crosses every boundary.** Bytes to the network (redacted
   aggregates only), data to the client (serializable, non-sensitive), scope on
   every query (always the session's user). The boundary is where security and
   correctness are won or lost.

6. **Own the 100 lines when the abstraction doesn't fit.** The custom migrator
   and the custom session store both replaced a library that *almost* worked.
   Knowing when to drop down a level — and when not to — is a senior skill.

7. **Optimize for trust, because trust is the product.** Honest forecasts,
   no invented numbers, no regulated advice, explicit consent, local-first
   defaults. In a finance app, a single breach of trust costs more than any
   feature can earn back.

---

## 15. Where things live

```
src/
├── proxy.ts                  # Next 16 middleware: auth gate + per-request CSP nonce
├── app/                      # App Router: pages (RSC), layouts, API route handlers
│   ├── api/                  #   streaming chat, auth, backup, export, exchange-rate, health
│   ├── (pages)/              #   dashboard, transactions, categories, subscriptions,
│   │                         #   advisor, goals, predictions, opportunities, travels,
│   │                         #   import, banks, settings, onboarding, lock
│   └── layout.tsx            #   root: theme + intl providers, PWA register
├── components/               # UI. ui/ = shadcn primitives; the rest are feature components
│   ├── ui/  charts/  dashboard/  advisor/  travels/  shell/  pin/ …
├── db/
│   ├── schema.ts             # the canonical domain model
│   ├── client.ts             # libSQL connection (file or Turso), URL normalization
│   ├── migrations/           # generated .sql + meta/_journal.json
│   └── seed-*.ts             # default categories & rules
├── lib/                      # all business logic — server-only, framework-agnostic
│   ├── auth/                 #   PIN, sessions, OAuth config, guest mode
│   ├── crypto.ts redact.ts   #   encryption + PII stripping (pure, tested)
│   ├── env.ts                #   zod-validated, fail-fast env
│   ├── llm/                  #   provider resolver (the AI seam)
│   ├── advisor/              #   context builder, system prompt, conversations, digest
│   ├── gocardless/ truelayer/ providers/demo/   # bank providers (client/credentials/normalize/sync)
│   ├── import/               #   CSV/XLSX ingest + AI column mapper + batches
│   ├── categorize/           #   rules → keywords → LLM ladder
│   ├── recurring/ predictions/ insights/ opportunities/ travels/   # derived intelligence
│   ├── dashboard/ transactions/ categories/ goals/ accounts/       # read/write helpers per feature
│   ├── security/             #   csrf, rate-limit
│   ├── i18n/ currency/ privacy/ format/ settings/                  # cross-cutting
│   └── ...
├── messages/                 # en.json / es.json (next-intl)
└── test/                     # vitest setup + in-memory DB fixture

scripts/                      # migrate, seed-dev, backfill-ownership, launchers
docs/                         # security, bank-setup, llm-providers, phase logs
```

---

*This document describes the system as built. When you change the system,
change this document — an architecture doc that lies is worse than none. For the
running threat model see [docs/security.md](docs/security.md); for setup see
[SETUP.md](SETUP.md); for the contribution workflow see
[CONTRIBUTING.md](CONTRIBUTING.md).*
