# Setup guide (for non-programmers)

This guide walks you through installing Financial Coach from scratch, step by step. No prior coding experience assumed. If you already have Node.js, pnpm, and a shell, jump straight to ["Configure the app"](#4-configure-the-app).

Estimated time: 20–30 minutes, most of it waiting for the LLM model to download.

> **Before you start:** you need 10–20 GB of free disk space (most of it goes to the language model in step 3) and a reasonably modern laptop. See [system requirements](README.md#system-requirements) in the README for RAM.

---

## Table of contents

1. [Install Node.js and pnpm](#1-install-nodejs-and-pnpm)
2. [Download the project](#2-download-the-project)
3. [Install Ollama + the language model](#3-install-ollama--the-language-model)
4. [Configure the app](#4-configure-the-app)
5. [First run](#5-first-run)
6. [Connect a bank (optional)](#6-connect-a-bank-optional)
7. [Using a cloud LLM instead of Ollama (optional)](#7-using-a-cloud-llm-optional)
8. [Deploying to Vercel (optional)](#8-deploying-to-vercel-optional)
9. [Troubleshooting](#troubleshooting)

---

## 1. Install Node.js and pnpm

### macOS

1. Open **Terminal** (Applications → Utilities → Terminal, or press `⌘+Space` and type "terminal").
2. Install [Homebrew](https://brew.sh) if you don't have it. Paste this into the terminal and press Enter:
   ```sh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Install Node.js and pnpm:
   ```sh
   brew install node@24 pnpm
   ```
4. Verify:
   ```sh
   node --version   # should print v20.x.x or newer (v24 recommended)
   pnpm --version   # should print 9.x.x or 10.x.x
   ```

### Windows

1. Download and run the Node.js 20+ installer from [nodejs.org](https://nodejs.org/) (24 LTS recommended). Accept all the defaults.
2. Open **PowerShell** (Start menu → type "PowerShell").
3. Install pnpm:
   ```powershell
   npm install -g pnpm
   ```
4. Verify:
   ```powershell
   node --version
   pnpm --version
   ```

### Linux (Debian / Ubuntu)

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -   # or setup_20.x for Node 20
sudo apt install -y nodejs
sudo npm install -g pnpm
```

---

## 2. Download the project

### Option A — Git (recommended, easy updates)

```sh
git clone https://github.com/rubenchirino/financial-coach
cd financial-coach
```

### Option B — ZIP download

1. Open [github.com/rubenchirino/financial-coach](https://github.com/rubenchirino/financial-coach) in your browser.
2. Click the green **Code** button → **Download ZIP**.
3. Unzip it somewhere easy to find (e.g. your Documents folder).
4. Open a terminal in that folder:
   - **macOS**: right-click the folder in Finder → Services → **New Terminal at Folder**.
   - **Windows**: open the folder in File Explorer, right-click → **Open in Terminal** (or Shift+right-click → **Open PowerShell window here**).
   - **Linux**: `cd` into it.

---

## 3. Install Ollama + the language model

Ollama runs the AI model **on your computer**, so your financial data never leaves your machine. This is the default and recommended setup. If you'd rather use Claude/OpenAI/Gemini in the cloud, skip this section and read [section 7](#7-using-a-cloud-llm-optional) instead.

### 3a. Install Ollama

- **macOS / Windows**: download and run the installer from [ollama.com/download](https://ollama.com/download).
- **Linux**:
  ```sh
  curl -fsSL https://ollama.com/install.sh | sh
  ```

After installing, verify it's running. Open a terminal and type:

```sh
ollama --version
```

You should see a version number. On macOS and Windows, Ollama also runs as a background app (check the menu bar / system tray for the llama icon). You can leave it running.

### 3b. Download the recommended model

The default model is **Qwen 2.5 14B Instruct** (quantized 4-bit). It's a good balance of quality and disk/RAM usage, and handles Spanish well. In a terminal:

```sh
ollama pull qwen2.5:14b-instruct-q4_K_M
```

This downloads about **9 GB**. Go grab a coffee.

When it finishes, test it works:

```sh
ollama run qwen2.5:14b-instruct-q4_K_M "Say hello in Spanish"
```

It should reply something like "¡Hola!". Type `/bye` to exit. **You don't need to run this every time** — the app talks to Ollama automatically; we're just testing the install.

> **Lower RAM?** If your machine has 8 GB or less, use the smaller Llama 3.1 8B:
> ```sh
> ollama pull llama3.1:8b-instruct-q4_K_M
> ```
> Then, in step 4, set `OLLAMA_MODEL=llama3.1:8b-instruct-q4_K_M` in your `.env.local`.

---

## 4. Configure the app

### 4a. Install project dependencies

In the project folder, run:

```sh
pnpm install
```

This downloads the libraries the app depends on (~200 MB). Takes 1–2 minutes.

### 4b. Create your `.env.local` file

This file holds your app's secret keys. **It is private. Never share it, never commit it.**

```sh
cp .env.example .env.local
```

Now open `.env.local` in a text editor (TextEdit on macOS, Notepad on Windows, any editor works). You need to fill in **at minimum** the `APP_SECRET`. The others are optional until you connect a bank or use a cloud LLM.

#### Generate `APP_SECRET` (required)

This is the master seed that gets combined with your PIN to encrypt everything. Generate it once and never change it — if you lose it, your data becomes unrecoverable.

- **macOS / Linux**:
  ```sh
  openssl rand -hex 32
  ```
- **Windows PowerShell**:
  ```powershell
  -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  ```

Copy the output (a 64-character string of hex digits) into `.env.local`:

```
APP_SECRET=paste_your_generated_value_here
```

> **Keep a backup.** If your `.env.local` or the `data/` folder is deleted, you lose access to your financial data. Copy both to an encrypted USB stick or a password-manager note. The PIN alone isn't enough — you need the APP_SECRET too.

### 4c. Apply the database migrations

This creates the empty SQLite database at `data/financial-coach.db`:

```sh
pnpm db:migrate
```

You should see:

```
✓ migrations applied; database at /path/to/financial-coach/data/financial-coach.db
```

---

## 5. First run

### Start the app

```sh
pnpm start:prod
```

> `pnpm start:prod` does a production build first, then launches the server. During development you can use `pnpm dev` instead — it's faster to restart but uses more memory.

You'll see something like:

```
▲ Next.js 16.x.x
- Local:    http://127.0.0.1:3000
✓ Ready in 1200ms
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.

### Create your PIN

The app will walk you through:
1. **Welcome screen** → click Continue
2. **Language** → pick Spanish or English
3. **PIN** → choose a 6+ digit PIN and confirm it

> Your PIN locks the app. It's combined with `APP_SECRET` to derive the at-rest encryption key. **Pick something you won't forget** — there's no reset. (But if you do forget, see [Troubleshooting → "I forgot my PIN"](#i-forgot-my-pin).)

After the PIN step you land on the empty dashboard. From here you can connect a bank (section 6) or explore the UI with no data.

### Next time you run the app

```sh
cd financial-coach
pnpm start:prod
```

Or use the one-click launchers: `start.command` (macOS), `start.sh` (Linux/WSL), `start.bat` (Windows).

---

## 6. Connect a bank (optional)

> This requires a free GoCardless account. Their Bank Account Data API covers most European banks.

### 6a. Create a GoCardless account

1. Go to [bankaccountdata.gocardless.com](https://bankaccountdata.gocardless.com) and sign up. Use your real email — they send a verification link.
2. After logging in, go to **User Secrets** in the sidebar.
3. Click **Create new user secret**. Give it a name like "financial-coach local".
4. You'll get **two values**: `secret_id` and `secret_key`. Copy them both immediately — GoCardless only shows `secret_key` once.

### 6b. Paste the keys into `.env.local`

Open `.env.local` and fill in:

```
GOCARDLESS_SECRET_ID=paste_secret_id
GOCARDLESS_SECRET_KEY=paste_secret_key
```

Save the file, then restart the app (`Ctrl+C` in the terminal, then `pnpm start:prod` again).

### 6c. Link your bank inside the app

1. Log in with your PIN.
2. Go to **Settings → Bank → Add bank**.
3. Pick your country and bank from the list.
4. You'll be redirected to your bank's login page. Authorize **read-only** access (Financial Coach never requests payment scopes).
5. After consenting, you land back on the app. Click **Sync transactions** — you'll see them populate after a few seconds.

**Free tier limits**: GoCardless gives you 50 account-connections per day for free. That's way more than enough for personal use. If you need more, their Production tier is €0.013 per connection.

Full walkthrough with screenshots: [`docs/bank-setup.md`](docs/bank-setup.md).

### 6d. Alternative: connect via TrueLayer (Santander ES and others)

The app also supports **TrueLayer** as an Open Banking provider. It's a good
fit if you bank with **Santander España** or another bank where TrueLayer's
Live coverage is better than GoCardless. Keys are stored encrypted in your
local DB (AES-256-GCM with your PIN) — no values go in `.env.local`.

#### 1. Create a TrueLayer account and app

1. Go to [console.truelayer.com](https://console.truelayer.com) and **Sign up**. Verify your email.
2. **Apps → Create app**. Name it (e.g. `financial-coach-local`), pick the *Personal / non-commercial* tier.
3. Enable the **Data API** product (account info + transactions). Payments is not needed.
4. Copy the **Client ID** (starts with `sandbox-…` for sandbox apps) and **Client Secret**.

#### 2. Configure the redirect URI

In your TrueLayer app's **Settings → Allowed redirect URIs**, add the exact callback URL:

```
http://localhost:3000/settings/bank/truelayer/callback
```

For production, also add your `https://…/settings/bank/truelayer/callback` URL. The string must match byte-for-byte (port, scheme, no trailing slash).

#### 3. Pick the environment

- **Sandbox** — instant, free, returns *Mock Bank / Santander (Demo)*. Ideal to verify the flow first.
- **Live** — real banks (Santander ES, BBVA, Revolut, Monzo, etc.). Requires submitting your app for **Live access** in the Console; for personal use it's typically granted within a couple of days. Live keys are different values from Sandbox.

#### 4. Paste the keys into the app

1. Open the app at `http://localhost:3000`, log in with your PIN.
2. Go to **Settings → Bank** and switch to the **TrueLayer** tab.
3. Paste **Client ID** and **Client Secret**.
4. Set **Environment** to `Sandbox (test data)` or `Live` to match your keys.
5. Click **Save** — you'll see *"Stored AES-256-GCM encrypted in your local database."*

#### 5. Add the bank connection

1. In the **Connections** card click **Add bank**.
2. You're redirected to TrueLayer's consent screen.
   - **Sandbox**: pick **Mock Bank** (or *Santander Sandbox*) and use the test credentials TrueLayer shows.
   - **Live**: search **"Santander España"**, log in with your real online-banking credentials, complete SCA via the Santander app or SMS OTP, and approve the read-only scopes (accounts + transactions + balance + 90-day history).
3. TrueLayer redirects back to `…/settings/bank/truelayer/callback`. The app exchanges the code for tokens (encrypted at rest) and creates the Connection row.
4. Click **Sync** on the Connections card to pull accounts, balances, and up to **90 days** of transactions. They'll appear under **Transactions** and roll up into the **Dashboard**.

#### Keeping the consent fresh

TrueLayer Live consent for AIS lasts **90 days** (PSD2 limit). When it expires, click **Add bank** again on the same institution and re-confirm in the Santander app to extend.

#### Common gotchas

- **`redirect_uri mismatch`** — the URI in the TrueLayer Console must match the one the app calls from, exactly. Add both `http://localhost:3000/...` for dev and your production URL.
- **`invalid_client`** — the secret was copied with a trailing space, or you mixed Sandbox keys with `Live` environment (or vice versa).
- **Santander ES isn't in the Sandbox list** — that's expected; Sandbox only has Mock Bank. Use Live for the real Santander.
- **No transactions appear after sync** — check the `Last synced` timestamp on the connection row; if it shows an error chip, expand it for the cause. Sandbox accounts only return a fixed set of demo transactions.

---

## 7. Using a cloud LLM (optional)

Prefer Claude, GPT-4, or Gemini over a local model? The app redacts IBANs, card numbers, emails, phone numbers, DNIs, and long digit sequences before anything leaves your machine, but the **amounts, merchants, categories and your questions** still get sent to the provider. You'll see a one-time consent dialog before the first message.

### Anthropic Claude

1. Sign up at [console.anthropic.com](https://console.anthropic.com). You'll get $5 of free credit.
2. Go to **Settings → API Keys** → **Create key**.
3. Paste into `.env.local`:
   ```
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-4-6
   ```

### OpenAI

1. Sign up at [platform.openai.com](https://platform.openai.com). Add a payment method (no free tier as of 2026).
2. Go to **API keys** → **Create new secret key**.
3. Paste into `.env.local`:
   ```
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o
   ```

### Google Gemini

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and create a key. There's a generous free tier.
2. Paste into `.env.local`:
   ```
   LLM_PROVIDER=google
   GOOGLE_GENERATIVE_AI_API_KEY=...
   GOOGLE_MODEL=gemini-2.5-flash
   ```

Restart the app after changing `.env.local`. You can always switch back to Ollama by setting `LLM_PROVIDER=ollama`.

Full comparison: [`docs/llm-providers.md`](docs/llm-providers.md).

---

## 8. Deploying to Vercel (optional)

Want to share an instance with family or close friends without each of them
installing Node + Ollama? You can deploy Financial Coach to Vercel with a
hosted libSQL (Turso) database and OAuth sign-in.

> Hosted mode is multi-user. Each OAuth identity gets its own isolated
> account; no PIN is required.

### 8a. Provision a Turso database

1. Sign up at [turso.tech](https://turso.tech) (generous free tier).
2. Install the CLI and create the DB:
   ```sh
   brew install tursodatabase/tap/turso     # or see turso.tech/docs for other OSes
   turso auth login
   turso db create financial-coach
   turso db show financial-coach --url      # → DATABASE_URL
   turso db tokens create financial-coach   # → TURSO_AUTH_TOKEN
   ```
3. Apply migrations against the remote DB:
   ```sh
   DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=ey... pnpm db:migrate
   ```
4. **If you are migrating an existing single-user database** to multi-user
   hosting, claim the pre-existing data for your account once (migration `0013`
   leaves un-owned rows invisible until you do — this is the fail-closed design):
   ```sh
   DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=ey... OWNER_EMAIL=you@example.com \
     pnpm tsx scripts/backfill-ownership.ts
   ```
   The script is idempotent (safe to re-run) and a no-op on a fresh database.

### 8b. Generate `AUTH_SECRET` and set hosted-mode envs

```sh
openssl rand -hex 32   # AUTH_SECRET
```

In your Vercel project's **Environment Variables** panel:

```
AUTH_MODE=oauth
AUTH_SECRET=...
APP_SECRET=...                # same value as local mode; encrypts at-rest secrets
DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=ey...
NEXT_PUBLIC_SITE_URL=https://your-domain.vercel.app
```

### 8c. Create OAuth clients

Pick whichever providers you want enabled — the sign-in page only shows
providers whose client ID/secret are set.

| Provider  | Console                                                            | Callback URL                                                  |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Google    | [Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) | `https://{your-domain}/api/auth/callback/google`              |
| Microsoft | [Microsoft Entra](https://entra.microsoft.com/) → App registrations | `https://{your-domain}/api/auth/callback/microsoft-entra-id`  |
| GitHub    | [GitHub → Developer settings → OAuth Apps](https://github.com/settings/developers) | `https://{your-domain}/api/auth/callback/github`              |

Paste the resulting `_CLIENT_ID` / `_CLIENT_SECRET` pairs into Vercel env
vars (`GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID` + `MICROSOFT_TENANT_ID=common`,
`GITHUB_CLIENT_ID`, …).

### 8d. LLM provider in hosted mode

Vercel's serverless runtime can't reach a local Ollama daemon. The resolver
automatically falls back to **Gemini** in hosted mode regardless of
`LLM_PROVIDER`. Set:

```
GOOGLE_GENERATIVE_AI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
```

Free Gemini tier is enough for personal use.

### 8e. Deploy

```sh
vercel deploy --prod
```

Open the deployment URL, click **Sign in**, pick a provider, and you're in.
Connect a bank from Settings exactly like in local mode.

---

## Troubleshooting

### "command not found: pnpm"

Your shell doesn't know where pnpm is installed. Close and reopen the terminal. If that doesn't fix it:

- **macOS / Linux**: `export PATH="$PATH:$(npm prefix -g)/bin"` and try again.
- **Windows**: restart PowerShell. If still failing, reinstall Node.js with the **"Add to PATH"** option checked.

### "APP_SECRET must be at least 32 chars"

You started the app before filling in `APP_SECRET` in `.env.local`. Follow [step 4b](#4b-create-your-envlocal-file) — the value must be 32+ characters. Use `openssl rand -hex 32` to generate one.

### "Cannot connect to Ollama" / "Could not reach the AI"

The most common cause is that the Ollama daemon is not running. `ollama pull`
only **downloads** a model — it does not start the server. You must also have
the daemon running before the app can use it.

**Quick diagnosis:**

```sh
curl http://localhost:11434/api/tags
```

- If it prints a JSON list of models → daemon is up, skip to the model section below.
- If it says *"connection refused"* → the daemon isn't running; start it first.

**Start the daemon:**

| Platform | How |
|---|---|
| macOS (app install) | Open **Ollama** from Applications or Spotlight. The llama icon appears in the menu bar. |
| macOS / Linux (manual) | Run `ollama serve` in a dedicated terminal tab and leave it open. |
| Windows | Click the Ollama tray icon, or run `ollama serve` in PowerShell. |
| Linux (systemd) | `sudo systemctl start ollama` |

Once the daemon is up, **refresh the Financial Coach page** — the error should clear immediately.

**Make it auto-start (macOS):** Open the menu-bar Ollama icon → **Settings** → tick **"Launch at login"**. The daemon then starts with your Mac and you never need to think about it.

### "Model not found: qwen2.5:14b-instruct-q4_K_M"

The daemon is running but the model hasn't been downloaded yet, or `OLLAMA_MODEL`
in `.env.local` names a model you haven't pulled.

```sh
ollama list                              # see what's already installed
ollama pull qwen2.5:14b-instruct-q4_K_M # download the default model (~9 GB)
```

To use a different (smaller) model, pull it and update `.env.local`:

```
OLLAMA_MODEL=llama3.2:3b   # example — much smaller, less capable
```

Restart the app after editing `.env.local`.

### "Port 3000 is already in use"

Another app has claimed port 3000. Either close it, or tell Financial Coach to use a different port:

```sh
PORT=3018 pnpm start:prod
```

Then open [http://127.0.0.1:3018](http://127.0.0.1:3018).

### "SQLITE_BUSY: database is locked"

Another copy of the app is still running. Close all terminal windows running `pnpm start`, wait a few seconds, then try again. If persistent, delete `data/financial-coach.db-wal` and `data/financial-coach.db-shm` (**not** the `.db` file itself) and restart.

### "Could not connect to libSQL" (hosted mode)

The app uses `@libsql/client` to talk to Turso. If you see connection errors after deploy:

- Confirm `DATABASE_URL` starts with `libsql://` (not `https://`).
- Confirm `TURSO_AUTH_TOKEN` is set and not expired (`turso db tokens create financial-coach` to mint a new one).
- Re-run `DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate` against the remote DB — a fresh Turso instance has no schema.

### "I enter my PIN but the page just reloads"

If you're on a build from before **2026-04-20**, this was a known bug caused by in-memory session storage getting wiped on dev-server reloads. It's fixed — pull the latest and run `pnpm db:migrate` to apply the new `sessions` table migration, then retry.

If you're on the fixed build and still seeing it: make sure your browser allows cookies from `127.0.0.1`. Private/incognito windows sometimes block them.

### I forgot my PIN

There's no "reset password" — that's the security model. Your only options:

1. **Delete everything and start over**: remove the `data/` folder and `.env.local`, then redo [step 4b](#4b-create-your-envlocal-file) onwards. You'll lose all cached transactions and categorization, but you can re-sync from your bank.
2. **Restore from backup** if you kept one (the `.env.local` + the `data/` folder together).

### The app asks for GoCardless consent on every sync

GoCardless requires re-authorization every 90 days (EU regulation, not an app limitation). When your consent expires, go to **Settings → Bank** and re-link.

### Still stuck?

- Check existing issues: [github.com/rubenchirino/financial-coach/issues](https://github.com/rubenchirino/financial-coach/issues)
- File a new issue with your OS, Node version (`node --version`), and the exact error message. **Don't paste `.env.local` contents or transaction data** — the bug report is public.

---

## What next

- **No bank yet?** Use **Demo mode** from the welcome screen — it loads synthetic transactions so you can poke around without any API keys. You can also import a real bank statement (`.csv` or `.xlsx`) from **Settings → Import**.
- **Explore the features.** Once you have data, the app surfaces a forecast (**Predictions**), trips abroad (**Travels**), concrete money-saving suggestions (**Opportunities**), a spending heatmap, and the AI **Coach** — all grounded in your own numbers.
- **Keep a safety net.** There's no PIN reset by design, so export an encrypted backup from **Settings → Backup** and store it somewhere safe alongside your `APP_SECRET`.
- **Curious about the security model?** Read [`docs/security.md`](docs/security.md) — it covers threat model, encryption details, and what "local-first" actually means.
- **Want to understand or contribute to the code?** Start with [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full system design, then [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.
