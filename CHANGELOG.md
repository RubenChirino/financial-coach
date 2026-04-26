# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (Phase 7 — Coin UI/UX Redesign)

#### 7a — Design tokens + theme foundation
- Full Coin design-token set in `globals.css`: brand/creative palette, surface tiers, text hierarchy with rgba opacity, border tiers, type scale, 4px spacing, radii, shadows, motion tokens.
- Remapped shadcn tokens onto Coin palette so all existing components inherit the brand without per-component edits.
- Dark-mode block: navy-charcoal surfaces (`#0c1220`/`#131a2b`) with blue/pink brand hues preserved.
- Coin tokens surfaced to Tailwind via `@theme inline` (`bg-brand`, `text-text-tertiary`, etc.).
- Inter Variable font (`font-display: swap`).
- `.balance-hidden` utility (8px blur, `user-select: none`, smooth transition).

#### 7b — App shell refresh
- Desktop 260 px sticky sidebar + 64 px sticky topbar (CSS-grid layout).
- Mobile compact brand header + bottom-nav rail for thumb reach.
- Pathname-aware `NavLink` client component with active state and pink AI-coach unread badge.
- `TopbarActions` client component: privacy eye toggle, lock button, language switch.
- New nav entries: Banks & Cards, Goals, Budgets (mapped to existing `/categories`).

#### 7c — 4-digit PIN redesign
- Reusable `PinDots` + `PinPad` primitives with keyboard support and error shake animation.
- 3-step onboarding flow: language → set PIN → confirm PIN.
- Lock screen with brand header, auto-submit on 4th digit, tries counter (ICU plural), lockout after 5 failures.
- `PinSetupSchema` (exactly 4 digits) / `PinUnlockSchema` (≥ 4 for legacy compat).

#### 7d — Bento dashboard + SVG charts
- Pure-server chart primitives: `Sparkline` (SVG line+area), `Donut` (stroked circles), `Bars` (CSS grid).
- Dashboard cards: `TotalBalanceCard`, `CoachBriefCard`, `BankTile` + `AddBankTile`, `MonthlyFlowCard`, `DonutCard`, `RecentTransactionsCard`, `CategoriesCard`, `InsightCard`.
- `getMonthlyFlowHistory()` and `listAccountsWithInstitutions()` data helpers.
- Net-worth delta pill (vs. last month), 6-month reconstructed sparkline.

#### 7e — AI Coach (digest + chat redesign)
- Digest tab: gradient hero brief, insight list, 4-up stats strip (Potential savings / Subscriptions / Alerts / Confidence).
- `buildDigest()` heuristic engine: uncategorized warning, subscription suggestion, month-over-month spend warning, positive fallback.
- Chat tab: 2-pane layout — "Coach has context on" sidebar + suggestion chips + conversation list (left); gradient avatar header + streaming bubbles + typing dots (right).
- `?tab=chat|digest` URL param preserves tab on navigation; `?c=` conversation ID preserved across tab switches.

#### 7f — Budgets + Transactions + Add-Bank redesign
- Transactions: summary strip (In/Out/Net), grouped-by-day list, filter bar (search, bank, category, review toggle), CSV export link.
- Budgets (`/categories`): 3-card summary strip with savings-rate gradient card, two-col layout with live detail panel, inline budget editor, "Recent in category" list, contextual Coach tip CTA.
- Add-Bank: 2-step institution picker (pick → confirm) with permission list (read ✓, no payment ✗).

#### 7g — Goals feature
- Goals schema: `goals` table (name, emoji, targetCents, savedCents, deadline, categoryId, notes).
- CRUD server actions: create, update, delete goal.
- Goals page with summary strip (total saved / target / goals count), goal cards with progress bar, add/edit/delete sheet.
- GoCardless requisition migration: `listGoalsAction`, `updateGoalAction`.

#### 7h — Insights engine
- `insights` table: kind, title, body, severity, actionHref, dismissedAt, generatedAt.
- Rule runners: uncategorized transactions, budget overrun, on-track savings, low balance, near-complete goal.
- Idempotent `generateInsightsAction` (upsert by kind+entityId, clears stale rows).
- Dashboard multi-insight list with severity sort; dismiss action with optimistic UI.

#### 7i — Privacy, currency, LLM selector, export
- Privacy mode: module-level pub-sub store (`useSyncExternalStore`), one-tap balance blur via `PrivacyAmount` component applied across all amount-showing surfaces (dashboard, transactions, budgets, goals, categories).
- Currency selector in Settings: `updateCurrencyAction`, 7-currency dropdown, persisted to `users.currency`.
- In-app LLM selector in Settings: provider grid (Ollama / Anthropic / OpenAI / Google) with configured/unconfigured state, model dropdown + custom model input, `updateLlmAction` backed by `users.llmProvider` + `users.llmModel`; env remains the fallback when stored prefs are invalid.
- CSV export: `GET /api/export/transactions` route handler returning UTF-8 CSV with `Content-Disposition: attachment`.
- Banks page (`/banks`): institution groups with logo, account rows, total balance hero, last-synced relative timestamp, `formatRelativeTime` helper.

#### 7j — CI + README + Node 24
- Node.js bumped to 24.15.0 (`.nvmrc`).
- CI: Next.js build cache step (`actions/cache@v4`), `NEXT_TELEMETRY_DISABLED=1`.
- CHANGELOG filled for all phases.
- README updated with full feature list, corrected roadmap, in-app LLM selector entry.

---

### Added (Phase 1 — Foundation)
- Next.js 15 + React 19 + TypeScript strict project scaffold.
- Drizzle ORM schema for users, institutions, requisitions, accounts, transactions, categories, rules, subscriptions, advisor conversations, audit log.
- AES-256-GCM + scrypt encryption primitives (`src/lib/crypto.ts`) with unit tests.
- PII redaction layer (`src/lib/redact.ts`) applied before any LLM call.
- PIN-based onboarding and session lock (15-min inactivity, httpOnly cookie).
- `next-intl` i18n with Spanish (default) and English.
- Base UI: shadcn/ui primitives (New York, neutral + emerald accent), dark mode, mobile bottom nav, PWA manifest, offline shell service worker.
- Biome (formatter + linter), Vitest, Playwright scaffolding.
- Open-source hygiene: AGPL-3.0 license, `SECURITY.md`, `CONTRIBUTING.md`, Contributor Covenant 2.1, issue/PR templates, Dependabot, CI with gitleaks.

### Added (Phase 2 — Bank integration)
- GoCardless Bank Account Data (PSD2) integration: institution list, requisition flow, account + transaction sync.
- Encrypted storage of GoCardless tokens and account IDs (AES-256-GCM, PIN-derived key).
- Demo mode: synthetic bank data requiring no API keys.
- Settings → Bank page: list connections, add bank (institution picker), sync, unlink.
- Transaction list page (initial version).

### Added (Phase 3 — Categorization + dashboard)
- Rule-based transaction categorizer: merchant regex rules, confidence score, "needs review" queue.
- LLM fallback categorizer with PII redaction applied before every prompt.
- Category CRUD (name, icon, color, budget).
- Initial dashboard: net worth, monthly income/expenses, recent transactions, top categories.

### Added (Phase 4 — AI advisor chat)
- AI advisor chat: streaming responses via Vercel AI SDK, per-conversation history stored in SQLite.
- Multi-provider LLM abstraction: Ollama (local), Anthropic Claude, OpenAI GPT, Google Gemini.
- Cloud-provider consent gate: explicit confirmation required before any data leaves the device, consent timestamp stored in DB.
- `providerInfo()` helper for UI display of current model.

### Added (Phase 5 — Subscription detection)
- Recurring subscription detection: cadence snapping (weekly / biweekly / monthly / quarterly / yearly), amount-stability heuristic.
- `subscriptions` table with `monthlyEquivalentCents`, `lastSeenAt`, `isActive`.
- Dashboard subscription widget with monthly-equivalent total.
- Subscription context injected into advisor chat prompt.

### Added (Phase 6 — Polish + CI)
- Bento dashboard layout (pre-7 iteration).
- CSV export foundation.
- GitHub Actions CI: lint, typecheck, unit tests, build, gitleaks.
- Node.js 24 LTS target.
- `start.command` / `setup.command` (macOS), `start.sh` / `setup.sh` (Linux/WSL), `start.bat` (Windows) convenience launchers.
