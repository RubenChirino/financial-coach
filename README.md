# Financial Coach

> Your personal AI financial coach — local-first, private by default, open source.

## What this is

A web app that aggregates your bank transactions via PSD2 Open Banking, categorizes them with an LLM, detects recurring subscriptions, and gives you personalized, data-grounded financial advice. It runs entirely on your machine. Your financial data never leaves it without your explicit consent.

Designed for Spanish banks first, English fully supported. Works as an installable PWA on iOS and Android.

**New here?** Start with **[SETUP.md](SETUP.md)** for a non-developer walkthrough.

**What it isn't**
- Not a bank. It reads your data, it never moves your money.
- Not investment advice. The coach won't tell you what to buy or sell.
- Not a cloud service. There is no account to create, nothing phones home.

## Screenshots

Screenshots are in progress. The features listed below are all shipped and functional as of Phase 7j (2026-04-24).

## Features

- **PIN-gated, encrypted vault.** AES-256-GCM + scrypt. Your PIN + `APP_SECRET` together derive the at-rest key. Sessions persist across dev restarts (SQLite-backed, SHA-256-hashed cookie tokens, PIN-derived keys wrapped at rest).
- **Bank aggregation via GoCardless PSD2.** Spanish banks first-class; most of Europe supported. Read-only access — the app never requests payment scopes. **Demo mode** lets you explore the app with synthetic data — no API keys needed.
- **Transactions + categories.** Rule-based matcher runs first (fast, deterministic); LLM fallback categorizes the rest with a confidence score and a "needs review" queue. Full merchant editor, keyboard-driven category picker.
- **Bento dashboard.** Net worth, monthly income/expenses, sparkline, top categories donut, recent activity — all auto-recomputed on sync.
- **AI advisor chat.** Grounded on your redacted transaction snapshot + detected subscriptions. Streaming responses, per-conversation history, optional cloud LLM with explicit per-provider consent. Digest tab shows auto-generated brief + insight cards before you even open chat.
- **In-app LLM selector.** Switch between Ollama, Claude, OpenAI, and Gemini from Settings — no `.env.local` edits needed. Preference is stored per-user; env remains the fallback.
- **Recurring subscription detection.** Cadence snapping (weekly / biweekly / monthly / quarterly / yearly) + amount-stability heuristic. Dashboard widget with monthly-equivalent total.
- **Goals.** Track savings targets with emoji, deadline, progress bar, and optional category linking.
- **Insights engine.** Rule-based, idempotent alerts: uncategorized transactions, budget overruns, on-track savings, low balance, and near-complete goals. Dismissible, severity-ranked.
- **Privacy mode.** One-tap balance blur across the entire UI — persisted to `localStorage`. Works globally via a React pub-sub store, no provider needed.
- **CSV export.** Download all transactions as a UTF-8 CSV from `GET /api/export/transactions`.
- **Privacy redaction (LLM).** IBANs, card numbers, DNIs, emails, phone numbers, postal codes, long digit sequences are scrubbed from every LLM prompt — local or cloud.
- **Spanish + English.** Full ICU-plural i18n, cookie-driven locale, mobile-first responsive layout, PWA manifest.

## Privacy & Security

- **Local-first.** SQLite database on your disk. No cloud sync, no telemetry, no analytics.
- **Encrypted at rest.** Bank tokens, account IDs, and LLM API keys are encrypted with a key derived from your PIN.
- **Read-only bank access.** The app never requests payment initiation scopes.
- **LLM redaction.** IBANs, card numbers, phone numbers, and emails are stripped before anything is sent to any LLM — local or cloud.
- **Explicit cloud consent.** If you choose a cloud LLM, you see exactly what data gets sent and must confirm once.
- **Binds to 127.0.0.1.** The dev server is not exposed on your network unless you opt in, and you get a warning if you do.

Read the full threat model in [`docs/security.md`](docs/security.md).

## Quickstart

> New to this? Read the full walkthrough in **[SETUP.md](SETUP.md)** — step-by-step instructions for installing Node, Ollama, and the GoCardless keys, written for non-developers.

For experienced users:

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

## System requirements

- Node.js 24 LTS and pnpm 9+
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

Configure the default provider in `.env.local` once; then switch per-user at any time from **Settings → AI Model** without touching env files again.

Full walkthrough in [`docs/llm-providers.md`](docs/llm-providers.md).

## Connect your bank

1. Create a free account at [bankaccountdata.gocardless.com](https://bankaccountdata.gocardless.com).
2. Generate `secret_id` and `secret_key`, paste them into `.env.local`.
3. Inside the app, go to Settings → Bank → Add bank, pick your institution, and authorize.

Full walkthrough with screenshots: [`docs/bank-setup.md`](docs/bank-setup.md).

## Roadmap

- [x] **Phase 1** — Foundation: scaffold, schema, crypto, PIN, i18n, base UI
- [x] **Phase 2** — Bank integration (GoCardless, account linking, transactions)
- [x] **Phase 3** — Categorization (rules + LLM) + dashboard
- [x] **Phase 4** — AI advisor chat (Ollama + Anthropic + OpenAI + Gemini) with privacy redaction
- [x] **Phase 5** — Recurring subscription detection + dashboard widget + advisor context enrichment
- [x] **Phase 6** — Final polish: bento dashboard, CSV export, CI, Node 24 LTS bump
- [x] **Phase 7** — Coin redesign: Goals, Insights engine, Privacy blur, Currency selector, In-app LLM selector, Banks page, CSV export endpoint

## Contributing

Contributions welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, branch naming, and PR etiquette. By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** See [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## License

[AGPL-3.0-or-later](LICENSE) — free to use, modify, and self-host. If you run a modified version as a network service, you must offer your users the source of that modified version.

## Acknowledgments

- [GoCardless Bank Account Data](https://gocardless.com/bank-account-data/) — PSD2 aggregation API
- [Ollama](https://ollama.com) — local LLM runtime
- [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com), [Lucide](https://lucide.dev)
- [Drizzle ORM](https://orm.drizzle.team), [Next.js](https://nextjs.org), [Vercel AI SDK](https://sdk.vercel.ai)
