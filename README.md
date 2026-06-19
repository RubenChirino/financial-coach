# Financial Coach

> Your personal AI financial coach — local-first, private by default, open source.

## What this is

A web app that aggregates your bank transactions via PSD2 Open Banking, categorizes them with an LLM, detects recurring subscriptions and trips abroad, forecasts your cash flow, surfaces concrete money-saving opportunities, and gives you personalized, data-grounded financial advice.

**Want to understand how it's built?** Read **[ARCHITECTURE.md](ARCHITECTURE.md)** — a detailed, decision-by-decision tour of the system (and a case study in architecting a privacy-first product).

**Two ways to run it:**

- **Local mode** (default) — single-user, PIN-gated, SQLite on disk. Your financial data never leaves your machine without your explicit consent.
- **Hosted mode** — multi-user, OAuth (Google / Microsoft / GitHub), libSQL (Turso) backend. Deploys to Vercel in minutes. Designed for sharing an instance with family or close friends.

Designed for Spanish banks first, English fully supported. Works as an installable PWA on iOS and Android.

**New here?** Start with **[SETUP.md](SETUP.md)** for a non-developer walkthrough.

**What it isn't**
- Not a bank. It reads your data, it never moves your money.
- Not investment advice. The coach won't tell you what to buy or sell.
- Not an ad-supported SaaS. No telemetry, no analytics, no third-party trackers.

## Screenshots

Screenshots are in progress. Every feature listed below is shipped and live.

## Features

- **PIN-gated, encrypted vault (local mode).** AES-256-GCM + scrypt. Your PIN + `APP_SECRET` together derive the at-rest key. Sessions persist across dev restarts (libSQL-backed, SHA-256-hashed cookie tokens, PIN-derived keys wrapped at rest).
- **OAuth sign-in (hosted mode).** Auth.js v5 with Google, Microsoft (Entra), and GitHub. Multi-user, one account per OAuth identity.
- **libSQL / Turso backend.** Same Drizzle schema runs against a local SQLite file or a hosted Turso replica — switch via `DATABASE_URL`.
- **Bank aggregation via GoCardless PSD2.** Spanish banks first-class; most of Europe supported. Read-only access — the app never requests payment scopes. **Demo mode** lets you explore the app with synthetic data — no API keys needed.
- **TrueLayer connector.** Alternate Open Banking provider with better Live coverage for some banks (Santander ES, BBVA, Revolut, Monzo). Credentials stored AES-256-GCM in your local DB.
- **CSV + XLSX import.** Drop a bank statement into the import flow — XLSX parsed server-side via SheetJS, CSV via streaming parser. Account-aware deduping, initial-balance detection.
- **Transactions + categories.** Rule-based matcher runs first (fast, deterministic); LLM fallback categorizes the rest with a confidence score and a "needs review" queue. Full merchant editor, keyboard-driven category picker.
- **Bento dashboard.** Net worth, monthly income/expenses, sparkline, top categories donut, recent activity — all auto-recomputed on sync.
- **Predictions.** A dedicated forecast page that projects next months' cash flow from transparent, explainable layers — fixed income, recurring outflows, habitual spend, and a median of the variable residual (median, not mean, so one holiday month doesn't poison the projection). No black-box ML; every number is auditable.
- **Travels.** Automatically detects trips — clusters of foreign-currency (or out-of-home-region) payments close in time — and labels each trip's city. Trips are recomputed on every load; only the hard-won city/country labels are cached (LLM-resolved once, then editable by you).
- **Opportunities.** Deterministic, data-grounded money-saving suggestions (subscription overlap, top overspend, goal projections, savings runway, emergency-fund gap), each with a concrete euro impact computed from your own numbers. An optional, enum-only investor questionnaire lets the coach tailor *framing* — never specific instrument picks.
- **Spending heatmap.** Calendar-style view of daily spend and monthly savings, with red/green intensity normalized across the year.
- **Manual entry + import history.** Add one-off cash transactions by hand; every CSV/XLSX upload is grouped into a deletable batch with an AI-assisted column mapper for unfamiliar bank export formats.
- **Multi-currency display.** Live exchange-rate conversion of the whole UI between EUR/USD (and more), persisted per-user.
- **Backup & restore.** Export an encrypted snapshot of your data and restore it later — your safety net for the "no PIN reset" security model.
- **Guest mode (hosted).** A read-only "try it" session seeded with demo data, so newcomers can explore a hosted instance without signing in or touching real accounts.
- **AI advisor chat.** Grounded on your redacted transaction snapshot + detected subscriptions. Streaming responses, per-conversation history, optional cloud LLM with explicit per-provider consent. Digest tab shows auto-generated brief + insight cards before you even open chat.
- **In-app LLM selector.** Switch between Ollama, Claude, OpenAI, and Gemini from Settings — no `.env.local` edits needed. Preference is stored per-user; env remains the fallback. In hosted mode, Gemini is the automatic fallback (serverless can't reach a local Ollama daemon).
- **Recurring subscription detection.** Cadence snapping (weekly / biweekly / monthly / quarterly / yearly) + amount-stability heuristic. Dashboard widget with monthly-equivalent total.
- **Goals.** Track savings targets with emoji, deadline, progress bar, and optional category linking.
- **Insights engine.** Rule-based, idempotent alerts: uncategorized transactions, budget overruns, on-track savings, low balance, near-complete goals. Dismissible, severity-ranked.
- **Privacy mode.** One-tap balance blur across the entire UI — persisted to `localStorage`. Works globally via a React pub-sub store, no provider needed.
- **CSV export.** Download all transactions as a UTF-8 CSV from `GET /api/export/transactions`.
- **Privacy redaction (LLM).** IBANs, card numbers, DNIs, emails, phone numbers, postal codes, long digit sequences are scrubbed from every LLM prompt — local or cloud.
- **Spanish + English.** Full ICU-plural i18n, cookie-driven locale, mobile-first responsive layout, PWA manifest.

## Privacy & Security

### Local mode
- **Local-first.** SQLite database on your disk. No cloud sync, no telemetry, no analytics.
- **Encrypted at rest.** Bank tokens, account IDs, and LLM API keys are encrypted with a key derived from your PIN.
- **Binds to 127.0.0.1.** The dev server is not exposed on your network unless you opt in, and you get a warning if you do.

### Hosted mode
- **Your Turso DB, your data.** The app stores everything in the libSQL instance you provision. No shared multi-tenant backend.
- **OAuth providers see only sign-in events.** Bank tokens and transactions never leave your DB.
- **Same redaction layer.** LLM prompts are scrubbed identically to local mode.

### Both modes
- **Read-only bank access.** The app never requests payment initiation scopes.
- **LLM redaction.** IBANs, card numbers, phone numbers, and emails are stripped before anything is sent to any LLM — local or cloud.
- **Explicit cloud consent.** If you choose a cloud LLM, you see exactly what data gets sent and must confirm once.

Read the full threat model in [`docs/security.md`](docs/security.md).

## Quickstart

> New to this? Read the full walkthrough in **[SETUP.md](SETUP.md)** — step-by-step instructions for installing Node, Ollama, the GoCardless keys, and (optionally) deploying to Vercel.

### Local

```bash
git clone https://github.com/rubenchirino/financial-coach
cd financial-coach
cp .env.example .env.local
# generate APP_SECRET (required) and paste into .env.local:
#   openssl rand -hex 32
# optionally fill in GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY
pnpm install
pnpm db:migrate
pnpm start:prod
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). Create a PIN, optionally link a bank, go.

Platform one-click options (after `pnpm install`):

- **macOS**: double-click `start.command` (or `setup.command` the first time)
- **Linux / WSL**: `./start.sh` (or `./setup.sh` first)
- **Windows**: double-click `start.bat`

### Hosted (Vercel + Turso)

1. Create a Turso database (`turso db create financial-coach`) and copy `DATABASE_URL` + `TURSO_AUTH_TOKEN`.
2. Set `AUTH_MODE=oauth`, generate `AUTH_SECRET` with `openssl rand -hex 32`.
3. Create OAuth clients for the providers you want (Google / Microsoft / GitHub) — see the walkthrough in [SETUP.md → Deploying to Vercel](SETUP.md#8-deploying-to-vercel-optional).
4. `vercel deploy` and paste the env vars into the project dashboard.

## System requirements

- Node.js **20 LTS or newer** (24 recommended if you run Ollama locally)
- pnpm 9+
- ~500 MB disk for the app and its dependencies
- RAM:
  - 4 GB if you use a cloud LLM (Claude, OpenAI, Gemini)
  - 8 GB for local Llama 3.1 8B
  - 16 GB+ for local Qwen 2.5 14B (the recommended default)

## Choose your LLM provider

|                  | Ollama (local)        | Claude / OpenAI / Gemini |
| ---------------- | --------------------- | ------------------------ |
| Cost             | Free (after setup)    | Paid per token            |
| Privacy          | Data never leaves     | Redacted data sent out    |
| Setup            | Install + pull a model | API key                   |
| Latency          | Higher locally        | Lower                     |
| Quality (ES/EN)  | Good (Qwen 2.5 14B)   | Excellent                 |
| Hosted (Vercel)  | ❌ unreachable        | ✅ (Gemini auto-fallback) |

Configure the default provider in `.env.local` once; then switch per-user at any time from **Settings → AI Model** without touching env files again.

Full walkthrough in [`docs/llm-providers.md`](docs/llm-providers.md).

## Connect your bank

1. Create a free account at [bankaccountdata.gocardless.com](https://bankaccountdata.gocardless.com).
2. Generate `secret_id` and `secret_key`, paste them into `.env.local`.
3. Inside the app, go to Settings → Bank → Add bank, pick your institution, and authorize.

Or use the TrueLayer connector if your bank has better Live coverage there — keys are stored encrypted inside the app, no env vars required. Full walkthrough with screenshots: [`docs/bank-setup.md`](docs/bank-setup.md).

## Roadmap

- [x] **Phase 1** — Foundation: scaffold, schema, crypto, PIN, i18n, base UI
- [x] **Phase 2** — Bank integration (GoCardless, account linking, transactions)
- [x] **Phase 3** — Categorization (rules + LLM) + dashboard
- [x] **Phase 4** — AI advisor chat (Ollama + Anthropic + OpenAI + Gemini) with privacy redaction
- [x] **Phase 5** — Recurring subscription detection + dashboard widget + advisor context enrichment
- [x] **Phase 6** — Final polish: bento dashboard, CSV export, CI, Node 24 LTS bump
- [x] **Phase 7** — Coin redesign: Goals, Insights engine, Privacy blur, Currency selector, In-app LLM selector, Banks page, CSV export endpoint
- [x] **Phase 8** — Hosted deployment: Auth.js OAuth (Google / Microsoft / GitHub), libSQL/Turso driver, Vercel-compat Node engine relax, hosted-mode UI, Gemini auto-fallback, XLSX import, per-account predictions
- [x] **Phase 9** — Intelligence & polish: Travels (trip detection + city labelling), Opportunities + investor profile, dedicated Predictions page, spending heatmap, multi-currency conversion, manual transaction entry, import history, encrypted backup/restore, TrueLayer connector, Demo provider, PWA install + pull-to-refresh
- [x] **Phase 10** — Multi-user hardening: per-user data isolation (fail-closed `user_id` scoping across every table), read-only Guest mode, CSRF guards on `/api/*`, strict per-request CSP nonce, per-user LLM rate limiting

## Architecture

The app is a Next.js 16 (App Router) application: server components query the database directly, server actions handle mutations, and the only outbound network calls are to your database, your bank-data provider, and your chosen LLM. Read the full, decision-by-decision breakdown in **[ARCHITECTURE.md](ARCHITECTURE.md)** — it covers the stack and the alternatives weighed for each choice, the security model, the AI subsystem, and the reasoning patterns behind a privacy-first design.

## Contributing

Contributions welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, branch naming, and PR etiquette. By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** See [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## License

[AGPL-3.0-or-later](LICENSE) — free to use, modify, and self-host. If you run a modified version as a network service, you must offer your users the source of that modified version.

## Acknowledgments

- [GoCardless Bank Account Data](https://gocardless.com/bank-account-data/) — PSD2 aggregation API
- [TrueLayer](https://truelayer.com) — Open Banking alternative
- [Turso](https://turso.tech) — hosted libSQL
- [Auth.js](https://authjs.dev) — OAuth on Next.js
- [Ollama](https://ollama.com) — local LLM runtime
- [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com), [Lucide](https://lucide.dev), [Recharts](https://recharts.org)
- [Drizzle ORM](https://orm.drizzle.team), [Next.js](https://nextjs.org), [Vercel AI SDK](https://sdk.vercel.ai)
- [next-intl](https://next-intl.dev), [Biome](https://biomejs.dev), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev)
