# Phase 7 — Full UI/UX Redesign ("Coin") — Progress

> **Archived log (2026-04).** This is a point-in-time record of the Phase 7
> "Coin" redesign, kept for historical context — it is *not* a description of
> the current system. Several "deferred"/"next phase" notes below were addressed
> in later work (the insights engine, privacy wiring, per-user budgets, etc.).
> For the system as it stands today, read [`../ARCHITECTURE.md`](../ARCHITECTURE.md);
> for the feature list, the [README](../README.md).

Source of truth for the redesign work. Updated as sub-phases land.

## Scope

Port the Airtable-inspired design handoff (`/design`) into the live codebase, following existing patterns (Next.js 15 App Router, server actions, Drizzle, next-intl, Biome). Introduces three net-new features: Goals, an Insights engine, and full preferences (dark mode / privacy / display currency).

## Decisions captured at kick-off (2026-04-20)

- **PIN length:** loosening to 4 digits (was 6+). Rate-limiting and device ownership are the real defenses, not entropy. Backend PBKDF2 config unchanged.
- **Dashboard variants:** ship Bento (default) in 7d. Command + Focus variants deferred to 7d.1 behind a Settings toggle.
- **Schema migrations:** one per sub-phase that needs it (7g Goals, 7h Insights, 7i `users.preferences`) — smaller, reviewable migrations.
- **Dark mode:** tokens land in 7a so everything downstream can respect them; toggle + persistence land in 7i alongside privacy/currency.

## Sub-phase tracker

| # | Scope | Status |
|---|---|---|
| 7a | Design tokens + theme foundation | ✅ done |
| 7b | App shell refresh | ✅ done |
| 7c | 4-digit PIN redesign | ✅ done |
| 7d | Dashboard (Bento) + SVG charts | ✅ done |
| 7e | AI Coach digest + chat | ✅ done |
| 7f | Budgets + Transactions + Add-Bank modal | ✅ done |
| 7g | Goals feature (net-new) | ✅ done |
| 7h | Insights engine (net-new) | ✅ done |
| 7i | Privacy + currency + LLM selector + export + banks page | ✅ done |
| 7j | CI + CHANGELOG + README + Node 24 bump | ✅ done |

## Log

### 2026-04-20 — Phase 7 kick-off

- Read the full design handoff (9 files + styles.css).
- Proposed and agreed the phase plan above.
- Created this progress doc.
- Updated the in-session todo list to reflect 7a–7j.

### 7a — Design tokens + theme foundation ✅

_Completed 2026-04-20._

**Shipped:**

- Copied `Inter-VariableFont_opsz_wght.ttf` + italic variant into `public/fonts/` and registered both via `@font-face` with `font-display: swap` in `globals.css`.
- Added the full Coin design-token set to `:root` (brand/creative, surfaces, text hierarchy with rgba opacity, border tiers, type scale, 4px spacing, radii, shadows, motion).
- Remapped the existing shadcn tokens (`--background`, `--primary`, `--card`, …) onto Coin palette values so every existing shadcn component inherits the brand immediately, without per-component edits.
- Wrote a proper dark-mode block that rebalances surfaces (navy-charcoal `#0c1220`/`#131a2b`) while keeping the blue/pink brand hues — dark-mode is "ready to light up" once the toggle lands in 7i.
- Surfaced Coin tokens to Tailwind via `@theme inline` — `bg-brand`, `bg-brand-soft`, `bg-creative`, `text-text-tertiary`, etc. all available as utility classes.
- Added utilities: `.tnum` (tabular-nums), `.balance-hidden` (8px blur for privacy mode with `user-select: none` + smooth transition), `.coin-card`, `.coin-display`, `.coin-label`, `.coin-caption` component helpers.
- Kept `prefers-reduced-motion` handling from prior styles.

**Quality gates:**
- `tsc --noEmit` — clean
- `biome check src --write` — clean (1 auto-format applied)
- `vitest run` — **117/117** across 13 files
- `next build` — compiled in 2.1s, all 8 static routes rendered

**Files touched:**
- `public/fonts/Inter-VariableFont_opsz_wght.ttf` (new)
- `public/fonts/Inter-Italic-VariableFont_opsz_wght.ttf` (new)
- `src/app/globals.css` (rewritten with design tokens + dark-mode + utilities)
- `docs/phase-7-progress.md` (this file)

**Notes for downstream phases:**
- Dark-mode tokens are in place but untoggled — `.dark` class flips everything when 7i ships the preference toggle.
- Prefer Tailwind arbitrary values like `bg-(--brand-primary)` or the named utilities `bg-brand`/`text-text-tertiary` when writing new components in 7b+.
- The old shadcn OKLCH palette is replaced — if any component visually regressed unexpectedly, trace it back to the `--primary`/`--background` remap and override locally.

### 7b — App shell refresh ✅

_Completed 2026-04-20._

**Shipped:**

- Rewrote `src/components/app-shell.tsx` to match the Coin design:
  - Desktop: 260px sticky sidebar + 64px sticky topbar, CSS-grid layout (`md:grid-cols-[260px_1fr]`).
  - Sidebar: gradient brand mark (`#5389FF → #86ADFF`), "Main" / "Account" sections, user chip footer (local-user friendly labels — no fake email), lang + theme toggles kept here.
  - Topbar: page title + subtitle (props with app-name fallback), EUR/USD segmented currency, search affordance with ⌘K, privacy eye, notifications stub, lock button.
  - Mobile (< md): compact brand header + bottom-nav rail (first 5 Main entries) for thumb reach.
- New client components:
  - `src/components/shell/nav-link.tsx` — pathname-aware active state, optional prefix-match (for `/settings`-style sections), pink AI-coach badge (`> 0` only), compact mode for icon-only rails.
  - `src/components/shell/topbar-actions.tsx` — currency segmented control (visual-only, persistence lands in 7i), privacy toggle (local state, `.balance-hidden` wiring lands in 7i), notifications stub (disabled until 7h), lock button wired to `lockAction()`.
- New nav entries:
  - **AI Coach** (renamed from "advisor" label) using `Sparkles` icon to match design.
  - **Budgets** label (points to existing `/categories` route — renaming the route itself is deferred; the label is what users see).
  - **Banks & cards** → `/banks` page, which redirects to `/settings/bank` for now. Full 1st-class page rebuilt in 7f.
  - **Goals** → new `/goals` stub with `EmptyState`. CRUD + schema land in 7g.
- i18n:
  - `nav.banks`, `nav.goals`, `nav.budgets` added to both locales.
  - Full `shell.*` block (main/account/youLabel/youSub/searchPlaceholder/searchLabel/currency/showBalances/hideBalances/notifications/lock).
  - Top-level `goals.*` block (title/subtitle/emptyTitle/emptyBody).

**Quality gates:**
- `tsc --noEmit` — clean
- `biome check src` — clean (one fieldset/role-group fix applied manually; `useSemanticElements` rule happy now)
- `vitest run` — **117/117**
- `next build` — 18 routes built, new `/goals` (2.47 kB) and `/banks` (131 B redirect) included

**Files touched:**
- `src/components/app-shell.tsx` (full rewrite)
- `src/components/shell/nav-link.tsx` (new)
- `src/components/shell/topbar-actions.tsx` (new)
- `src/app/goals/page.tsx` (new stub)
- `src/app/banks/page.tsx` (new redirect)
- `src/messages/en.json` + `src/messages/es.json` (nav + shell + goals blocks)
- `docs/phase-7-progress.md`

**Notes for downstream phases:**
- `AppShell` now accepts `title` / `subtitle` / `coachUnread` props. Pages that want a proper page title in the topbar should pass `title` (defaults to app name so existing pages keep rendering their own `<h1>`).
- `coachUnread` defaults to 0 — 7h wires the real insight-count query.
- The old `LockButton` wrapper still exists but is no longer used by the shell. It's not imported anywhere now — can be removed in 7j cleanup or left as a reusable primitive.
- Mobile bottom-nav renders only the first 5 Main entries (`Dashboard / Coach / Budgets / Transactions / Subscriptions`). Banks + account-section entries need the sidebar (desktop) — acceptable trade-off for now.

### 7c — 4-digit PIN redesign ✅

_Completed 2026-04-20._

**Shipped:**

- **Backend — split schema for setup vs unlock** (`src/lib/auth/actions.ts`):
  - `PinSetupSchema` — digits only, exactly 4. Used by `setupPinAction`.
  - `PinUnlockSchema` — digits only, ≥4. Used by `unlockWithPinAction` so any legacy ≥6-digit PIN still works until that user resets. New PINs can only ever be 4 digits through the UI.
  - `hashPin` / PBKDF2 iteration count unchanged; verification path unchanged.
- **Reusable primitives** in `src/components/pin/`:
  - `pin-dots.tsx` — 4 circular dots, fills left-to-right with brand colour, destructive tint + shake on error, `aria-live` for screen readers.
  - `pin-pad.tsx` — 3×4 grid (1-9, optional Face-ID slot, 0, delete). Supports real keyboard input (0-9 + Backspace) while ignoring events targeting other `<input>` / `contentEditable` fields. Tap buttons are `min-h 60px` for touch.
- **Onboarding flow rewrite** (`src/app/onboarding/flow.tsx` + `page.tsx`):
  - Merged the old 4-step (welcome → lang → pin → done) into the design's 3-step (lang → pinSet → pinConfirm, with `done` as terminal celebration).
  - OnboardingBrand header with gradient mark matches app shell.
  - `Steps` component renders 3 progress pills.
  - Language screen: flag options (🇬🇧 English / 🇪🇸 Spanish) with sub-captions, selected state, bottom caption "You can change this in Settings".
  - PIN screens: auto-advance on 4th digit, mismatch error clears pin2 and surfaces the shake, back button repeats to earlier step.
- **Lock screen rewrite** (`src/app/lock/page.tsx` + `form.tsx`):
  - Brand header + "Welcome back" micro-copy.
  - PinPad auto-submits on 4th digit, decrements `tries` counter on failure (showing "Incorrect PIN. N tries left." once remaining ≤2), fully disables input after 5 consecutive failures with an "Unlock" reset button (server-side limits are the real gate, this is UX).
- **i18n:**
  - Rewrote `onboarding.pin.*` for set / confirm phases, added `onboarding.pin.biometric`, `onboarding.languageCaption`.
  - Rewrote `lock.*` with `welcomeBack`, ICU-plural `triesLeft {count, plural, …}`, `lockedOut`, `forgotPin` + `forgotBody` (copy for a future reset flow), dropped obsolete `placeholder`.
  - Both `en.json` + `es.json` updated.
- **Motion token:** `.pin-shake` keyframe animation in `globals.css` with `prefers-reduced-motion: reduce` fallback.

**Quality gates:**
- `tsc --noEmit` — clean
- `biome check src` — clean (several auto-formats applied during iteration)
- `vitest run` — **117/117**
- `next build` — `/lock` 2.56 kB (was 1.61 kB), `/onboarding` 4.09 kB (was 3.7 kB), everything else unchanged

**Files touched:**
- `src/lib/auth/actions.ts` (PinSetupSchema + PinUnlockSchema split)
- `src/components/pin/pin-dots.tsx` (new)
- `src/components/pin/pin-pad.tsx` (new)
- `src/app/onboarding/flow.tsx` (full rewrite to PinPad-based flow)
- `src/app/onboarding/page.tsx` (dict shape updated)
- `src/app/lock/form.tsx` (full rewrite, tries counter, ICU plural)
- `src/app/lock/page.tsx` (brand header + welcome-back copy)
- `src/app/globals.css` (pin-shake keyframe under `@layer components`)
- `src/messages/en.json` + `src/messages/es.json`

**Notes for downstream phases:**
- The biometric slot on the unlock pad is currently a placeholder. A native shell (Tauri/Electron + platform biometric API) would wire it via `onBiometric={() => onUnlocked()}` after a successful platform check. Out of scope for web-only.
- The "Forgot PIN?" copy exists (`lock.forgotBody`) but no UI hook yet — 7i's "delete all data" / reset flow will consume it.
- Legacy 6-digit installs can still log in until they choose to reset (PinUnlockSchema accepts ≥4). They cannot set a new 6-digit PIN once reset.

### 7d — Dashboard Bento redesign + SVG charts ✅

_Completed 2026-04-21._

**Goal recap:** rebuild `src/app/page.tsx` as the Coin Bento dashboard — 12-col grid, `TotalBalanceCard` (net-worth + sparkline + 3 KPIs), `CoachBriefCard` (pink→blue gradient), accounts grid, `MonthlyFlowCard` (Bars), `DonutCard`, `RecentTransactions`, `CategoriesCard`, wide `InsightCard`. Port the three chart primitives into `src/components/charts/`. Command + Focus variants deferred to 7d.1.

**Shipped:**

- **Chart primitives** in `src/components/charts/` — all pure/server-renderable, no client JS:
  - `sparkline.tsx` — SVG line + translucent area fill, accepts any `values[]` array, fully sized via props. Short-circuits to an empty SVG with a `<title>` when `values.length < 2` so the a11y rule is satisfied even in the degenerate case.
  - `donut.tsx` — stroked-circle donut where each segment is a `<circle>` with computed `strokeDasharray`/`strokeDashoffset`. No arc math. Supports a `center` slot (React node) for the "total" overlay, and an optional `aria-label`.
  - `bars.tsx` — pure HTML grid (no SVG) — each bar is a `<div>` with a percentage height. Pre-formatted tooltip strings come from the caller to keep locale/currency handling out of the chart.
- **Dashboard cards** in `src/components/dashboard/`:
  - `total-balance-card.tsx` — hero card with net-worth display (tnum), sparkline on the right, optional delta pill (up/down colour), KPI strip (Income / Expenses / Saved).
  - `coach-brief-card.tsx` — pink→blue gradient hero with a circular white blob, gradient brand mark, eyebrow, headline (with optional inline white-chip `highlight` span), body, and two CTA buttons (primary links to `/advisor`, ghost also links to `/advisor` for now).
  - `bank-tile.tsx` — account card with institution logo (or initial fallback), account label + last-4, formatted balance, chevron, honours `privacy` prop. Exports `AddBankTile` as a dashed-border CTA. Both link to `/transactions?accountId=N` / `/settings/bank`.
  - `monthly-flow-card.tsx` — Bars chart inside a card with title/subtitle and an Income/Expenses legend.
  - `donut-card.tsx` — Donut + top-3 legend list. Empty state when no expenses this month.
  - `recent-transactions-card.tsx` — last 5 transactions with category icon/colour swatch (or a green `ArrowDownLeft` for positive/income txs), merchant, "Category · Institution" sub-line, signed amount. Link to `/transactions`.
  - `categories-card.tsx` — top-4 categories with icon bubble, name, spent-of-budget, and a progress bar that flips red when over budget.
  - `insight-card.tsx` — single-insight row with kind-specific tint (warning / positive / suggestion / neutral). Fed by a heuristic in the page for now; 7h's real engine will produce many of these.
- **Summary helpers** (`src/lib/dashboard/summary.ts`):
  - `getMonthlyFlowHistory(months, locale)` — walks N months with UTC ranges, pre-formats the short month label via `Intl.DateTimeFormat` server-side so Bars can render without hydration. Trailing period stripped ("abr." → "abr") for the Spanish locale.
  - `listAccountsWithInstitutions()` — joins `accounts` → `requisitions` → `institutions` and returns tiles sorted by balance desc.
- **Page rewrite** (`src/app/page.tsx`):
  - Added `getMonthSummary(-1)` to the parallel fetch so we can compute the vs-last-month delta pill truthfully. Pct is relative to `|last-month|`, returns `null` when last-month is exactly zero (renders without the pill rather than a divide-by-zero).
  - Sparkline trace is synthesised from current total balance + past-month net deltas (walks backwards 6 months). Documented in-file that it's not a persistent daily snapshot, but directionally truthful.
  - Brief copy is derived deterministically from the data: positive headline when this month's net is positive, neutral otherwise; body rotates through needs-review → active-subscriptions → generic. The string pipeline keeps the 7h/real-insight work as a drop-in replacement.
  - Primary insight card picks one signal (needs-review > 0 > over-budget category > positive savings), or renders nothing.
  - Kept the existing empty state (no accounts → EmptyState + Connect bank) — AppShell now gets proper `title` / `subtitle` here too.
- **i18n:** added `dashboard.netWorth`, `vsLastMonth`, `saved`, `yourAccounts`, `addAccount`, `addAccountHint`, `monthlyFlow` + `monthlyFlowSub`, `monthSpend` + `monthSpendSub`, `thisMonth`, `uncategorizedShort`, `briefEyebrow` + headline/body variants + CTAs, and a nested `insight.*` block for review / over-budget / on-track title+body+action triples. English and Spanish both updated.

**Quality gates:**
- `tsc --noEmit` — clean
- `biome check src` — clean (fixed `noSvgWithoutTitle` on Donut + Sparkline by adding `<title>` elements, fixed a `useTemplate` nit in the page)
- `vitest run` — **117/117** across 13 files (no new tests this phase — the new helpers are thin read queries over existing fixtures; unit-test land in 7h along with the insights engine)
- `next build` — `/ ` now 2.49 kB (was 2.45 kB baseline), shared JS unchanged at 102 kB, all 17 routes green. Had to `pnpm rebuild better-sqlite3` once for the Node 24 ABI mismatch — unrelated to this phase.

**Files touched:**
- `src/components/charts/sparkline.tsx` (new)
- `src/components/charts/donut.tsx` (new)
- `src/components/charts/bars.tsx` (new)
- `src/components/dashboard/total-balance-card.tsx` (new)
- `src/components/dashboard/coach-brief-card.tsx` (new)
- `src/components/dashboard/bank-tile.tsx` (new, exports `BankTile` + `AddBankTile`)
- `src/components/dashboard/monthly-flow-card.tsx` (new)
- `src/components/dashboard/donut-card.tsx` (new)
- `src/components/dashboard/recent-transactions-card.tsx` (new)
- `src/components/dashboard/categories-card.tsx` (new)
- `src/components/dashboard/insight-card.tsx` (new)
- `src/lib/dashboard/summary.ts` (added `getMonthlyFlowHistory` + `listAccountsWithInstitutions`)
- `src/app/page.tsx` (full rewrite to 12-col Bento)
- `src/messages/en.json` + `src/messages/es.json` (dashboard block extended)

**Notes for downstream phases:**
- **7e (Coach digest):** `CoachBriefCard` already accepts `eyebrow`/`headline`/`highlight`/`body`/`openLabel`/`askLabel` as props. When the digest pipeline lands, feed the generated markdown-to-text summary into `body` and the "save amount" into `highlight`. No card rework needed.
- **7h (Insights engine):** `InsightCard` accepts `kind`/`title`/`body`/`actionLabel`/`actionHref`. The page currently picks a single insight by heuristic; when `insights` table + query land, loop `rows.map(row => <InsightCard … />)` in the wide col-12 slot and drop the ad-hoc derivation.
- **7i (Privacy toggle):** every money-bearing card already takes a `privacy?: boolean` prop (wired to the `.balance-hidden` class). When the preference toggle lands, thread it from the `users.preferences` JSON blob into the page and down.
- **7d.1 (Command / Focus variants):** the design's `DashboardCommand` and `DashboardFocus` are deferred. Adding them is a rearrangement of the same components — no new data needed. A Settings switch picks the variant.
- **Known limitation:** the net-worth sparkline is a reconstruction, not a snapshot series. If/when a `balance_history` table lands (nightly cron of `accounts.balanceCents`), swap `sparkValues` for the real series.
- **No new tests:** the new helpers are narrow read queries over existing fixtures — adding snapshot tests for the formatted short-label would make `Intl` the unit under test, which isn't useful. Real test coverage comes with the insights engine (7h) where logic density is much higher.

### 7e — AI Coach (Digest + Chat redesign) ✅

_Completed 2026-04-21._

**Goal recap:** turn `/advisor` into a two-tab Coach surface. **Digest** tab (default) — gradient hero brief, 0–3 insight cards, 4-up stats strip (Potential savings / Subscriptions / Alerts / Coach confidence). **Chat** tab — 2-pane layout with a left "Coach has context on" panel + "Try asking" suggestion chips + recent conversations, and a right chat surface with gradient avatar header, gradient AI-avatar per assistant bubble, typing dots, brand-blue user bubbles, and a soft `--surface-app` input area. No data-shape changes — all content is derived from existing helpers (`dashboard/summary`, `recurring/list`, `transactions/list`, `advisor/conversations`). The insights engine is still deferred to 7h; 7e ships a deterministic heuristic so the tab has truthful content today.

**Shipped:**

- **Digest derivation** (`src/lib/advisor/digest.ts` — new):
  - `buildDigest(strings, fmt)` returns `DigestPayload { generatedAt, headline, items: DigestItem[] (max 3), stats: DigestStat[] (4 tiles), isEmpty }`. Items have a `kind` (`warning | positive | suggestion | neutral`) that drives the icon-swatch tint on the client.
  - Heuristics — `needsReview > 0` → warning card; ≥3 active subs OR ≥30 €/mo → suggestion; this-month expense > 1.15× last-month → warning with computed pct + delta; otherwise a positive "all good" fallback so the digest never feels empty.
  - "Potential savings" stat = sum of monthly-equivalent for subs last seen >60 days ago (cancel candidates). "Coach confidence" is tiered on total tx count (`<30` low, `<200` medium, else high).
  - `getChatContextSnapshot()` returns the `{accountCount, txCount, budgetCount, subscriptionCount}` shown in the chat left panel.
- **Tab nav** (`src/components/advisor/coach-tabs.tsx` — new, client): pure-link tabs via URLSearchParams (`?tab=chat` or omit). `aria-current="page"` on the active tab, brand-primary underline. Preserves `?c=` when switching so a deep-linked conversation stays selected. No client state lives here on purpose — switching tabs re-runs the server component (digest fetches fresh data, chat picks up new messages).
- **Digest feed** (`src/components/advisor/digest-feed.tsx` — new, server): empty state (sparkles avatar + Connect-bank CTA when `isEmpty`); gradient hero brief (`linear-gradient(135deg, #5389FF 0%, #86ADFF 60%, #FFD1DC 100%)`) with eyebrow + "Brief · today" line + headline + 3 numbered glass-morph chips (first three items) + "Discuss with coach" / "Mark resolved" CTAs; insight list with kind-tinted icon swatches; 4-up stats strip using PiggyBank / Repeat / Bell / ShieldCheck.
- **Chat redesign** (`src/app/advisor/advisor-chat.tsx` — rewritten, client): kept **all** streaming plumbing (`useChat` from `ai/react`, `X-Conversation-Id` capture, 403-consent flow, `grantCloudLlmConsentAction`, `deleteConversationAction`, `errorMsg`, scroll-to-bottom effect with biome-ignore). New 2-pane layout:
  - Left `aside.coin-card`: "Coach has context on" header + 4 context rows (Landmark/ArrowLeftRight/PieChart/Repeat), "Try asking" suggestion chips (calls `chat.append({role: 'user', content: suggestion})`), recent conversations list with hover-reveal delete, "New chat" link, encrypted footer.
  - Right `section.coin-card`: gradient avatar header ("Coach · Online"), chat stream with gradient `Sparkles` avatar per assistant message + brand-blue user bubbles, animated typing dots while awaiting the first token, textarea input with Enter-to-send on `--surface-app` bg.
  - Updated `window.history.replaceState` to preserve `tab=chat` when the server hands back a new `?c=` so a refresh stays on the chat tab.
- **Page rewrite** (`src/app/advisor/page.tsx`): parses `?tab=`, renders shared header + `<CoachTabs>`. Digest branch calls `buildDigest()` with an `intlLocale`-aware `fmt` and a `Intl.DateTimeFormat` day label. Chat branch fetches `listConversations()` + `getChatContextSnapshot()` in parallel, keeps the existing `?c=` → initial-messages flow, passes the expanded `labels` block + `context` snapshot + three localized suggestion strings into `<AdvisorChat>`.
- **i18n:** added `advisor.digest.*` (eyebrow, brief, discuss, markResolved, headlineSaving/Flat/Empty with `{amount}` placeholder, item title/body/action triples for review/subs/topCat/allGood with ICU plurals, stat labels, confidence tiers, empty-state) and `advisor.chat.*` (`tabDigest`/`tabChat`, coachName, online, contextOn, contextAccounts/Transactions/Budgets/Subs with ICU plurals + `=0` branch, tryAsking, suggestion1..3, encrypted, conversationsHeading). English and Spanish both updated.

**Quality gates:**
- `tsc --noEmit` — clean
- `biome check src` — clean after autoformat (grouped ternary in `digest.ts`, import order in `advisor-chat.tsx`, inline array in `page.tsx`, one `cn()` collapse)
- `vitest run` — **117/117** across 13 files (no new tests — `buildDigest` is a thin derivation layer over helpers that already have unit coverage; real rule tests land with the 7h insights engine)
- `next build` — `/advisor` now **26.3 kB / 155 kB** First Load (was 7.81 kB). Growth is the `DigestFeed` card shell + expanded chat 2-pane layout + lucide icons; still well under the 200 kB/app-shell budget. All 17 routes green.

**Files touched:**
- `src/lib/advisor/digest.ts` (new — `buildDigest`, `getChatContextSnapshot`, `DigestPayload` / `DigestItem` / `DigestStat` / `ChatContextSnapshot` / `DigestStrings` types)
- `src/components/advisor/coach-tabs.tsx` (new)
- `src/components/advisor/digest-feed.tsx` (new)
- `src/app/advisor/advisor-chat.tsx` (rewritten, all chat plumbing preserved)
- `src/app/advisor/page.tsx` (rewritten for `?tab=` awareness)
- `src/messages/en.json` + `src/messages/es.json` (added `advisor.digest.*` + `advisor.chat.*` blocks)

**Notes for downstream phases:**
- **7h (Insights engine):** the `buildDigest` heuristic and the `DigestItem` shape are intentionally the same surface the real engine will produce (`key/kind/title/body/actionLabel/actionHref`). When the `insights` table + rule runners land, swap the heuristic body in `buildDigest` for `listInsightsForToday()` and keep the rest (headline, stats, empty state) unchanged. The dashboard `InsightCard` uses the same shape — one engine feeds both surfaces.
- **7i (Privacy toggle):** the digest stats strip doesn't yet honour `privacy` (the "Potential savings" value is a money string). When the preference toggle lands, thread `privacy?: boolean` into `DigestFeed` and apply `.balance-hidden` to the stat value + any money-bearing chip body. The chat surface doesn't display user money values itself, but the left-panel context counts are neutral integers and need no gating.
- **Mark resolved CTA** in the hero brief is disabled/placeholder — it needs an `insights.resolvedAt` column from 7h before it becomes actionable. Kept the affordance visible so the design matches.
- **Digest "freshness":** `generatedAt` is returned but not displayed. 7h can surface "last updated Xh ago" once the engine has a real run cadence; today it'd always say "just now" which adds no value.
- **Suggestions are static:** `suggestion1..3` are hardcoded strings. A later pass can make them situational (e.g. if `subsCount > 0` → "Which subscriptions could I cancel?") but that adds noise without the insights engine's confidence signal, so deferred.


---

## Phase 7f — Budgets + Transactions + Add-Bank redesign ✅ (2026-04-21)

### Shipped

**`/transactions` — full rewrite**
- New client component `src/components/transactions/transactions-view.tsx` replaces the
  stacked card list. Three-card summary strip at the top (Money in / Money out /
  Net flow) with signed colors (`#059669` green for income/positive net,
  `#DC2626` red for negative net). Money-out value stays neutral dark so the eye
  goes to the positive savings story.
- Filter bar: search input (merchant/raw-description substring, case-insensitive),
  bank dropdown built from the row set, category dropdown (all / uncategorized /
  per-category), and the All/Review toggle relocated from the header into the bar.
  A Clear button appears only when any filter is active.
- List now grouped by booking day with a sticky-looking header row showing "Today"
  / "Yesterday" / `weekday, MMM d` + the day's net total (signed). No more card
  chrome on individual rows — they're compact items inside one `coin-card`.
- `countLine` is an ICU-plural hint ("n transactions · across m accounts") that
  updates live as filters change.
- `rowMatches()` pure filter predicate + `TransactionRowItem` sub-component extracted to
  keep biome's `noExcessiveCognitiveComplexity` happy (was 32 → now well under 20).

**`/categories` — rebuilt as Budgets page**
- Three-card summary strip: Income this month (+ delta pill vs. last month), Spent
  (+ delta pill; "goodWhenDown" semantics so a drop is green, plus total-budget
  progress bar), and a gradient-green Savings card (`#10B981 → #059669`) with
  savings rate + mini fill bar on white/25 track.
- Two-col layout `grid lg:grid-cols-[1.3fr_1fr]` — scrollable category list on the
  left (`CategoryRow` client component updates `?id=` via `router.replace(..., { scroll: false })`
  so the server-rendered detail panel re-renders without a full navigation), detail
  panel on the right.
- Detail panel: selected category header with icon + Settings2 "Edit" affordance;
  Spent / Budget (inline `BudgetInput`) / Remaining or Over-by trio; full-width
  progress bar (switches to `#EF4444` when over); "Recent in {category}" list
  (max 6 via new `listTransactions({ categoryId, limit })` arg); pink "Coach tip"
  card with contextual copy (`coachTipOver` / `coachTipUnder` / `coachTipNoBudget`)
  and an "Ask coach" CTA jumping to `/advisor?tab=chat`.
- `deltaPct()`, `resolveSelected()`, `buildCoachTipBody()`, `categoryRowProps()`,
  and a `DeltaPill` server sub-component extracted to module scope to bring page
  cognitive complexity from **43 → under 20**.

**Add-Bank (`/settings/bank/link`) — restyled institution picker**
- Rewrote `institution-picker.tsx` as a 2-step client flow (`step: "pick" | "confirm"`).
  Pick step: coin-card header with Landmark icon + "Step 1 of 2 · Secure via Open
  Banking" indicator, search + country dropdown, 2-col bank grid with
  brand-soft hover states.
- Confirm step: bank logo/name + `openBankingSecure` subtitle, rich-interpolated
  `confirmBody` ("Coin will be able to **read** your balance…") with permission
  list (Eye/Search permitted = `#059669` green, XCircle denied = `#DC2626` red),
  error block, Back + "Continue to {bank}" buttons with `Loader2` spinner on submit.

**i18n**
- Added `transactions.searchPlaceholder / allBanks / allCategories / clear / moneyIn /
  moneyOut / netFlow / today / yesterday / noMatch / exportCsv / countLine` keys in both
  locales.
- Added `categories.incomeThisMonth / vsLastMonth / spent / ofBudgetTotal /
  savedThisMonth / savingsRate / allCategories / categoryCount / used / overSuffix /
  remaining / overByLabel / recentIn / noTxThisMonth / coachTipEyebrow / coachTipOver /
  coachTipUnder / coachTipNoBudget / askCoach` keys in both locales.
- Added `bank.connectNewAccount / stepOf / openBankingSecure / popularInCountry /
  confirmBody / permRead / permHistory / permNoMove / back / continueTo` keys in both
  locales. `confirmBody` uses `<strong>…</strong>` markup for `t.rich`.

### Fixes applied during quality gates
- **`/lock` crash in production (`next start`).** `LockPage` was building a
  `labels` object containing `triesLeft: (count) => tLock(...)` and passing it
  across Server → Client. RSC can't serialize closures. Removed the labels prop;
  `LockForm` now calls `useTranslations("lock")` + `useTranslations("onboarding.pin")`
  directly (the `NextIntlClientProvider` is already mounted at the root layout).
- **Dashboard crash on empty-state render.** `NavLink` (client component) was
  receiving `Icon: LucideIcon` — passing the lucide `forwardRef` component
  *class* across the boundary fails with `{$$typeof, render, displayName}` not
  serializable. Renamed the prop to `icon: ReactNode` and changed both sidebar
  and mobile bottom-nav callsites in `AppShell` to pre-render the element
  (`icon={<Icon className="h-[17px] w-[17px]" strokeWidth={2} />}`). React
  elements are plain data objects, so they serialize fine; only the
  component constructor was the problem.

### Quality gates

- `pnpm exec tsc --noEmit` — clean
- `pnpm exec biome check src` — clean (after refactoring `transactions-view`
  and `categories/page` for `noExcessiveCognitiveComplexity`, dropping an
  `autoFocus` that triggered `noAutofocus`, and wiring the extracted
  `TransactionRowItem` into the main body)
- `pnpm test -- --run` — 117/117 pass across 13 files
- `pnpm build` — compiles and emits routes; `/transactions` now 5.79 kB,
  `/categories` 3.83 kB, `/settings/bank/link` 4.56 kB, all under the
  existing budget

### Files touched

- `src/components/transactions/transactions-view.tsx` — NEW
- `src/app/transactions/page.tsx` — rewritten to hydrate TransactionsView with
  labels + category options + accounts total
- `src/components/budgets/category-row.tsx` — NEW
- `src/app/categories/page.tsx` — rewritten as Budgets page
- `src/app/settings/bank/link/institution-picker.tsx` — rewritten with 2-step flow
- `src/lib/transactions/list.ts` — added `categoryId?` and `limit?` filter opts
  so the categories detail pane can fetch its own small window without a
  parallel query helper
- `src/messages/en.json`, `src/messages/es.json` — i18n additions
- `src/app/lock/page.tsx`, `src/app/lock/form.tsx` — fix for Server→Client
  function-prop serialization
- `src/components/app-shell.tsx`, `src/components/shell/nav-link.tsx` — fix
  for Server→Client forwardRef-component-prop serialization

### Notes for next phases

- **7g (Goals):** the coach tip CTA in `/categories` links to `/advisor?tab=chat`
  but a natural next click is "show me goals related to this category." Goals
  schema arrives in 7g — revisit the Coach tip action then.
- **7h (Insights engine):** the "Over budget" coach tip + over-budget dashboard
  insight are both rule-based today. When the insights engine lands, replace
  the heuristic with `insights.find(i => i.categoryId === ... && i.kind === "overspend")`
  and keep the same surface.
- **7i (Privacy/export):** the three Budgets summary cards (Income, Spent,
  Saved-gradient) render money values directly — they all need `.balance-hidden`
  wiring when the privacy toggle lands. Same for the TransactionsView summary
  strip and per-row amounts.
- **Transactions export CSV:** page header has the link scaffold but no
  endpoint yet. Revisit in 7i when export format is settled.
- **CategoryPicker in rows:** still uses the old select-dropdown UI. The Coin
  design has a lighter tag-style picker but it's a bigger subcomponent
  rewrite and doesn't block 7f; logged for a 7j polish pass.
- **Serialization pitfalls are a pattern now.** Both crashes this phase came
  from the same root cause (non-serializable values crossing Server → Client).
  Worth a CI lint step in 7j: a simple rg for `Icon: LucideIcon` + any
  function-typed prop in a `"use client"` file's prop interface would catch
  the class before prod.
