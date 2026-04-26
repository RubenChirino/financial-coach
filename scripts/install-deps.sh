#!/usr/bin/env bash
# First-run installer. Shared by setup.command (macOS) and setup.sh (Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf "\n\033[1;32m➤\033[0m  %s\n" "$*"; }
warn() { printf "\n\033[1;33m!\033[0m  %s\n" "$*"; }

# ---- Node 24 ---------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 24 ]]; then
    warn "node $(node -v) detected; this app needs Node 24+."
    warn "install via nvm (https://github.com/nvm-sh/nvm):  nvm install 24 && nvm use 24"
    exit 1
  fi
else
  warn "node is not installed. Install Node 24 LTS from https://nodejs.org or via nvm."
  exit 1
fi

# ---- pnpm via corepack -----------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  say "activating pnpm via corepack…"
  corepack enable
  corepack prepare pnpm@9.15.4 --activate
fi

# ---- .env.local ------------------------------------------------------------
if [[ ! -f .env.local ]]; then
  say "creating .env.local from template…"
  cp .env.example .env.local
  APP_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  # BSD sed (macOS) and GNU sed (Linux) both accept -i '' on macOS, -i on Linux.
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^APP_SECRET=.*|APP_SECRET=${APP_SECRET}|" .env.local
  else
    sed -i "s|^APP_SECRET=.*|APP_SECRET=${APP_SECRET}|" .env.local
  fi
  warn "edit .env.local to add your GoCardless keys (see docs/bank-setup.md)"
fi

# ---- npm deps --------------------------------------------------------------
say "installing dependencies…"
pnpm install

# ---- optional: Ollama ------------------------------------------------------
if grep -qE "^LLM_PROVIDER=ollama" .env.local 2>/dev/null; then
  if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama not installed. For local LLM, install it:"
    if [[ "$(uname)" == "Darwin" ]]; then
      warn "  brew install ollama"
    else
      warn "  curl -fsSL https://ollama.com/install.sh | sh"
    fi
    warn "Then: ollama pull qwen2.5:14b-instruct-q4_K_M"
  fi
fi

# ---- migrate ---------------------------------------------------------------
say "running database migrations…"
pnpm db:migrate

say "all set. Start the app with ./start.sh (Linux) or ./start.command (macOS)."
