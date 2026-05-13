# Handoff: AI Financial Coach (Coin) — Full UI/UX Redesign

## Overview

This is a complete UI/UX redesign of an existing AI Financial Coach mobile/web app. The product helps a user connect their banks, see a unified financial picture, get proactive AI-driven insights about their spending, and manage per-category budgets. The redesign replaces a plain, minimal dashboard with a richer, information-dense "bento"-style experience featuring a proactive AI coach at the center.

The package contains a fully clickable high-fidelity React prototype covering 7 screens plus onboarding.

---

## About the Design Files

**The files in this bundle are design references created in HTML/JSX.** They are prototypes showing intended look and behavior — not production code to copy directly.

Your task is to **recreate these designs in your target codebase's existing environment** (React web, React Native, SwiftUI, Flutter, Vue, etc.) using its established patterns, component library, state management, and data layer. If no environment exists yet, pick the most appropriate framework for the product (React + TypeScript + Tailwind or a design-system-in-a-box like shadcn/ui is a strong default for a responsive web app like this).

Do **not** ship the HTML as-is. Use it as a pixel-accurate spec.

---

## Fidelity

**High-fidelity.** All colors, typography, spacing, radii, shadows, and interactions are final and intended to be matched pixel-for-pixel. Mock data in `data.jsx` is illustrative — wire your real backend in its place.

---

## Design System / Tokens

The design follows an **Airtable-inspired** system. All tokens are defined in `colors_and_type.css`.

### Colors

| Token | Hex | Purpose |
|---|---|---|
| `--brand-primary` | `#5389FF` | Primary action (buttons, active states, selected rows, focus ring) |
| `--brand-primary-hover` | `#3E76F2` | Primary hover (8% darker) |
| `--brand-primary-soft` | `#D4E6FF` | Secondary fills, ghost-button hover, dividers |
| `--brand-primary-border` | `#86ADFF` | Input focus borders, subtle accents |
| `--creative-pink` | `#FFD1DC` | "Creative" accent — user-generated, AI outputs, new/generate CTAs |
| `--creative-pink-hover` | `#FFBDCD` | Creative hover |
| `--creative-pink-text` | `#8B2D43` | Dark text on pink |
| `--surface-app` | `#EFF5FE` | Main app background |
| `--surface-sidebar` | `#E2EEFE` | Sidebar + hover states |
| `--surface-card` | `#FFFFFF` | Bento card fill |
| `--text-primary` | `#0F1421` | Primary text |
| `--text-secondary` | `rgba(15,20,33,0.70)` | Secondary text |
| `--text-tertiary` | `rgba(15,20,33,0.55)` | Captions, meta |
| `--border-default` | `#D4E6FF` | Default borders |
| `--border-strong` | `#86ADFF` | Emphasized borders |

Semantic colors: success `#10B981` / `#059669` / `#166534`, warn `#F59E0B` / `#92400E`, danger `#EF4444` / `#DC2626`.

### Dark mode override
| Token | Value |
|---|---|
| `--surface-app` | `#0B1020` |
| `--surface-sidebar` | `#131A2E` |
| `--surface-card` | `#1A2238` |
| `--text-primary` | `#F0F4FF` |
| `--border-default` | `#2A3654` |
| `--border-strong` | `#3E4D78` |

### Typography

**Family:** Inter (variable font, 100-900). Tabular-nums (`font-variant-numeric: tabular-nums`) on all balances, amounts, counts.

| Role | Size / Line-height / Weight |
|---|---|
| Display | 32/40, 600, letter-spacing −0.015em |
| H1 | 24/32, 600, −0.01em |
| H2 | 18/24, 600, −0.005em |
| H3 | 16/22, 600 |
| Body | 14/20, 400 |
| UI label | 13/16, 500 |
| Caption | 12/16, 400, 55% opacity |

Hero/display numbers override: 28–56px, weight 600, −0.02em.

### Spacing (4px base)
4, 8, 12, 16, 20, 24, 32, 40, 48. Card padding 16 or 20. Bento gutter 16.

### Radii
- `--radius-sm` 6px (badges, tags)
- `--radius-md` 8px (buttons, inputs, menu items)
- `--radius-lg` 12px (cards, modals) — actual cards use 14px
- `--radius-pill` 999px (avatars, circular icon buttons)

### Shadows
- `--shadow-sm`: `0 1px 2px rgba(15,20,33,0.06)` — resting card
- `--shadow-md`: `0 4px 12px rgba(15,20,33,0.08), 0 2px 4px rgba(15,20,33,0.04)` — hover, dropdowns, modals
- `--shadow-focus`: `0 0 0 2px rgba(83,137,255,0.40)` — focus ring

### Motion
- 150ms `cubic-bezier(0.4, 0, 0.2, 1)` for color/opacity
- 200ms same easing for shadow transitions on card hover
- Press state: `transform: scale(0.97)` or `scale(0.98)` on buttons
- No spring, no bounce, no parallax. Fades only.

### Iconography
**Lucide** icons (CDN) at 1.5–2px stroke, 14–20px. Icons inherit `currentColor`.

---

## Screens / Views

### 1. Language Selection (Onboarding step 1 of 3)

**Purpose:** First-run, user picks English or Spanish.

**Layout:** Centered card (440px max-width) on a soft gradient stage (radial blues + pink in corners). 40px card padding, 20px radius, large soft shadow.

**Components:**
- Brand lockup: 38px gradient-blue square with sparkles icon + "Coin" wordmark + "AI Financial Coach" tag
- Step indicator: 3 horizontal pill segments, active = brand-primary, done = brand-primary at 40%
- Heading "Welcome to Coin" (26px/32px, 600, −0.015em)
- Lead paragraph (14px, secondary)
- Two language option buttons (🇬🇧 English, 🇪🇸 Español):
  - 14px padding, 12px radius, 1.5px border
  - 40px flag tile + title (14px/600) + subtitle (12px secondary)
  - Circle check indicator right-aligned, filled brand-primary when selected
  - Hover: border strong + background `--brand-primary-soft`
  - Selected: border brand-primary + background `--brand-primary-soft`
- Primary CTA "Continue →" full-width, 12px padding, 14px
- Footer caption "You can change this anytime in Settings."

### 2. PIN Setup (Onboarding step 2)

**Purpose:** User chooses a 4-digit PIN.

**Layout:** Same card shell as language screen. Steps indicator shows step 2/3.

**Components:**
- Heading "Set up your PIN"
- Lead "Choose a 4-digit PIN. You'll use it every time you open Coin."
- **PIN dots display** — 4 circular dots, 14px diameter, 14px gap, 2px border. Empty = transparent with `--border-strong` outline. Filled = brand-primary, scale 1.1. Error = red `#EF4444` + `shake` animation (400ms).
- **PIN pad** — 3×4 grid, max 280px, 10px gap. Keys 1-9, 0, delete icon:
  - Digit keys: aspect-ratio 1.5, 12px radius, `--surface-app` background, 20px/500 digit
  - Hover: background `--brand-primary-soft`
  - Active: `scale(0.95)` + brand-primary background + white text
  - Action keys (delete): transparent, secondary text, 13px label
- Back button (ghost)

**Behavior:**
- Each digit tap appends; auto-advances when 4 digits entered (200ms)
- Delete removes last digit
- After entering full PIN, navigate to Confirm step

### 3. PIN Confirm (Onboarding step 3)

Same as Setup but heading "Confirm your PIN" / lead "Enter the same PIN one more time to confirm."

**Behavior:** If second PIN matches first → persist + enter app. If not → error state on dots (shake + red), error message "PINs don't match. Try again.", reset PIN input.

### 4. PIN Unlock (Returning user)

**Purpose:** Authentication gate shown on every app open after initial setup.

**Layout:** Same onboard card. Adds a user chip at top.

**Components:**
- User chip: 44px avatar (pink gradient) + "Welcome back, Ana" + email (ana@example.com)
- Heading "Enter your PIN"
- Lead "Unlock Coin to see your latest balances and insights."
- PIN dots + pad (same styling)
- **Biometric key** — bottom-left of the pad, scan-face icon, triggers unlock directly
- Footer links: "Forgot PIN?" · "Not you?" (ghost buttons)

**Behavior:**
- 3 tries before lockout (not fully implemented, shows "X tries left")
- On "Not you?" → clear state, restart onboarding from language screen

### 5. Dashboard (3 variations, switchable via Tweaks)

**Shared chrome:**
- **Sidebar** (260px fixed): Brand lockup, nav items (Dashboard, AI Coach with pink badge count, Budgets, Transactions, Banks & cards), Account section (Goals, Settings, Help), user chip footer
  - Active item: white card background with brand-primary text and shadow-sm
  - Hover: `--brand-primary-soft` background
- **Topbar** (64px): Title + subtitle, currency segmented control (€/$), 280px search with ⌘K hint, icon buttons (privacy eye, bell with pink dot, lock)

**Page head:** Greeting "Good {morning/afternoon/evening}, Ana" + date line + Export/Ask coach buttons.

#### Variant A — "Bento" (default)
12-column bento grid, 16px gutter:
- `col-8` Total balance card (white): label, 38px balance, +3.8% pill, sparkline, 3-stat footer (Income/Expenses/Saved)
- `col-4` Coach brief card (pink→blue gradient with decorative circle): AI daily brief, "Open brief" + "Ask coach" CTAs
- `col-12` Accounts section: header + "Add account" button + responsive auto-fill grid of 5 bank tiles + dashed "Add a bank" tile
- `col-7` Monthly flow card: bar chart (6 months, income-blue vs expenses-pink) with legend
- `col-5` Donut card: April spend breakdown, 130px donut + top-3 category list
- `col-7` Recent activity: last 5 transactions, grouped visually
- `col-5` Spending by category: top-4 categories with color-tinted progress bars
- `col-12` Full-width insight card (warning/positive/suggestion/neutral variants — see Components)

#### Variant B — "Command"
- `col-12` Full-width gradient blue total balance card (same structure, white-on-blue)
- `col-8` Accounts 2×2 grid + monthly flow below
- `col-4` Stacked: Coach brief + Donut
- `col-6` + `col-6` Recent activity + Categories

#### Variant C — "Focus"
- Full-bleed hero card with soft pink→blue gradient tint: 56px net-worth number, success pill, "Add account" + "Ask the coach" big CTAs; to the right a nested white "Today's focus" card with the top insight
- Horizontal accounts strip (compact tiles)
- `col-5` Donut + `col-7` Monthly flow
- `col-7` Recent activity + `col-5` Categories

### 6. AI Coach (2 tabs)

**Purpose:** Central AI advisor — proactive digest + conversational chat with full account context.

#### Tab: Daily digest
- **Hero brief card** — blue→pink gradient, decorative circle, sparkles badge + "Your AI coach — Daily brief · April 20" meta, 22px headline, 3 numbered inline summary tiles (translucent white), primary + ghost CTAs
- **Insight card list** — each card shows a colored 36px icon tile (warning amber / positive green / suggestion pink / neutral blue), title + time, body, primary action + Dismiss
- **Stats strip** — 4 small cards: Potential savings (€19/mo, green piggy-bank), Subscriptions tracked (7, pink repeat), Alerts this week (4, amber bell), Coach confidence (High, blue shield)

#### Tab: Chat
Two-column layout (320px context panel + flex chat pane):
- **Context panel:** "Coach has context on" list (5 connected accounts, 248 transactions, 9 categories, 2 goals, 7 subscriptions) + "Try asking" suggestion chips + encryption footer
- **Chat pane:**
  - Header: gradient avatar + "Coach" + online dot + "analyzing your accounts"
  - Stream: AI bubbles (`--brand-primary-soft` background, brand text, 14px radius, top-left 4px) with gradient avatar; user bubbles (brand-primary fill, white text, top-right 4px), right-aligned
  - Typing indicator: 3 bouncing dots, 1.2s stagger
  - Input row: paperclip, text input (10px radius, focus ring), send button
- **Canned responses** keyed by keywords: dining, lisbon/trip/afford, subscriptions/cancel, goal/save — see `coach.jsx` for full text.

### 7. Budgets & Categories

**Layout:** Summary row (3-col bento) + two-column main (1.3fr list / 1fr detail).

**Summary row:**
- Income card: label + €3,890 + "+20% vs. March" trend
- Spent card: €2,395 + "−8.5%" trend + progress bar of budget
- Saved card: green gradient, white text, €1,495 + "24% savings rate · best in 2026" + bar against 20% goal

**Category list** (scrollable, 9 categories): each row = 38px color-tinted icon tile + name + spent/budget + progress bar (red if over-budget, category color otherwise) + "X% used" / "€Y left" / "€Z over". Selected = `--brand-primary-soft` background.

**Detail panel** (for selected category):
- Header card: 48px icon + name + Edit button + 3 stats (Spent/Budget/Remaining or Over-by) + thick 10px progress bar + recent 6 transactions in that category
- Coach tip card: full pink `--creative-pink` fill, sparkles badge, contextual nudge (over-budget tip vs on-track pace), dark CTA "Ask coach"

### 8. Transactions

**Layout:**
- Summary bento row: Money in (green), Money out, Net flow
- Filter card: search (merchant), bank select, category select, Clear button
- **Grouped list** — date headers (`--surface-app` background, uppercase) with daily subtotal; each transaction row = category icon (or green income icon) + merchant (14/600) + category pill + bank name + optional note + amount (15/600, green if positive) + AI sparkle icon button
- Row hover: `--brand-primary-soft` background

Date formatting: "Today" / "Yesterday" / "Weekday, Mon D".

### 9. Add Bank modal (3 steps)

**Trigger:** From any "Add account" button or dashed Add-bank tile.

**Shell:** 520px max-width card centered on `rgba(15,20,33,0.4) + backdrop-filter: blur(4px)` scrim. Click scrim to close. Step indicator in header ("Step X of 3 · secure via Open Banking").

- **Step 1 — Search/pick:** Search input + 2-col grid of bank tiles (Sabadell, Bankinter, Openbank, N26, Wise, Abanca, Unicaja, Kutxabank). Each tile = 34px brand logo + name. Hover: brand-primary border + soft fill.
- **Step 2 — Permissions:** Selected bank chip, consent paragraph, 3 permission rows (✓ Read balance, ✓ Read 90d transactions, ✗ No money movement), "Continue to {bank}" primary button. Click → 1400ms loading ("Connecting…") → step 3.
- **Step 3 — Success:** Green 64px check avatar, "{bank} connected" heading, "We're syncing your last 90 days…" copy, "Back to dashboard" primary CTA. On close, bank is appended to connected list with random balance/last4.

---

## Interactions & Behavior

- **Routing:** In-memory (`route` state); persisted to `localStorage` so refresh stays on the current page.
- **Screen gate:** `screen` state = `'lang' | 'pinSet' | 'pinConfirm' | 'app' | 'lock'`. Also persisted.
- **PIN:** stored in `localStorage` (for prototype only — use secure storage / biometric keychain in prod).
- **Lock:** topbar lock button resets `screen` to `'lock'` without clearing PIN.
- **Chat:** Canned keyword-matching responses with 900ms fake typing delay. Replace with real LLM call in prod.
- **Privacy mode:** Wraps balance values with `.balance-hidden` class which applies `filter: blur(8px)` and disables text selection. Toggleable from Tweaks panel and topbar eye icon.
- **Currency toggle:** Global `EUR`/`USD` switcher changes only the symbol (no FX conversion in prototype).
- **Hover states:**
  - Cards: shadow-sm → shadow-md
  - Buttons: 8% darker fill (primary) / `--brand-primary-soft` (ghost) / brand-primary border (outline)
  - Nav items: `--brand-primary-soft` background
  - Transaction rows: `--brand-primary-soft` background
- **Focus:** 2px brand-primary ring at 40% opacity, 2px offset on inputs.
- **Animations:** shake on PIN error, blink on typing dots, slide-less fades only.

---

## State Management

Recommended store shape for real implementation:

```ts
type AppState = {
  // auth
  screen: 'lang' | 'pinSet' | 'pinConfirm' | 'app' | 'lock';
  lang: 'en' | 'es';
  pin: string | null; // store in secure keychain in prod

  // preferences
  currency: 'EUR' | 'USD';
  darkMode: boolean;
  privacy: boolean;
  dashboardVariant: 'bento' | 'command' | 'focus';

  // data
  banks: Bank[];
  transactions: Transaction[];
  categories: Category[]; // includes budget + spent
  insights: Insight[];
  goals: Goal[];
};
```

See `data.jsx` for canonical shapes of Bank, Transaction, Category, Insight.

**Data fetching:** Plug Open Banking / Plaid / Tink / Nordigen into the banks + transactions lists. AI coach needs a chat endpoint that receives the user's account context and streams back responses.

---

## Assets

- **Fonts:** Inter (variable + italic), included in `fonts/` — or use Google Fonts / self-host in target project.
- **Icons:** Lucide via CDN (`<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js">`). Use `lucide-react` or equivalent in prod.
- **Bank logos:** Placeholders rendered as brand-colored squares with initials. Replace with real logos (via the bank aggregator's assets) in production.

---

## Files

- `index.html` — entry point; loads tokens, styles, React 18.3.1, Babel standalone, and all JSX modules in order
- `colors_and_type.css` — design tokens (colors, typography, spacing, radii, shadows, motion)
- `styles.css` — app-specific layouts (shell, onboarding, chat, bento grid, PIN pad, tweaks panel, dark mode overrides)
- `data.jsx` — mock data (5 banks, 8 available-to-connect banks, 9 categories with budgets, 18 transactions, 4 insights, 6 months of flow data)
- `icons.jsx` — `Icon`, `BankLogo`, `CategoryIcon` helpers and `fmt()` currency formatter
- `shell.jsx` — `Sidebar` + `Topbar`
- `onboarding.jsx` — `LanguageScreen`, `PinSetScreen`, `PinUnlockScreen`, `OnboardingFlow`
- `dashboard.jsx` — 3 dashboard variants + shared cards (`TotalBalanceCard`, `BankTile`, `AddBankTile`, `CategoriesCard`, `InsightCard`, `RecentTransactions`, `MonthlyFlowCard`, `DonutCard`, `CoachBriefCard`, `Sparkline`, `Donut`, `Bars`)
- `coach.jsx` — `CoachPage`, `DigestFeed`, `ChatUI`
- `budgets.jsx` — `BudgetsPage`
- `transactions.jsx` — `TransactionsPage`, `AddBankModal`
- `app.jsx` — root component, routing, Tweaks panel

---

## Implementation recommendations

1. **Pick a framework.** React + TypeScript + Vite + Tailwind CSS (or a design-system lib like shadcn/ui or Radix + stitches) maps cleanly to this design. For native mobile, React Native + NativeWind or SwiftUI.
2. **Port tokens first.** Copy `colors_and_type.css` values into your Tailwind config or theme provider. This unlocks the rest.
3. **Build the shell before screens.** Sidebar + topbar + bento grid utility are reused everywhere.
4. **Charts:** The Sparkline, Donut, and Bars components are pure-SVG and easy to reuse — or swap for Recharts / Visx / Victory.
5. **Secure the PIN.** The prototype stores PIN in localStorage — in production, use a secure keychain (iOS Keychain, Android Keystore, WebAuthn / passkeys for web) and never persist the raw PIN.
6. **Connect real data.** Plaid (US) or Tink/Nordigen/TrueLayer (EU) for Open Banking. AI coach needs LLM + RAG over user's transactions with category/merchant/bank context.
7. **Verify accessibility.** Focus rings are present but audit tab order, ARIA labels for icon buttons, and keyboard navigation on the PIN pad and nav.
