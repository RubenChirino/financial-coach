#!/usr/bin/env bash
# Shared launcher logic used by start.command (macOS) and start.sh (Linux/WSL).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]]; then
  printf "\n\033[33m✗\033[0m  .env.local is missing. Copy .env.example to .env.local and fill it in.\n\n"
  printf "   cp .env.example .env.local\n\n"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  printf "\n\033[33m✗\033[0m  pnpm is not installed. Run ./setup.sh (Linux) or ./setup.command (macOS) first.\n\n"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  printf "\n➤  installing dependencies (first run)…\n"
  pnpm install
fi

if [[ ! -f data/financial-coach.db ]]; then
  printf "\n➤  running database migrations…\n"
  pnpm db:migrate
fi

# If the user configured Ollama, nudge them if it isn't running.
if grep -qE "^LLM_PROVIDER=ollama" .env.local 2>/dev/null; then
  OLLAMA_URL=$(grep -E "^OLLAMA_BASE_URL=" .env.local | cut -d= -f2- || true)
  OLLAMA_URL=${OLLAMA_URL:-http://127.0.0.1:11434}
  if ! curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
    printf "\n\033[33m!\033[0m  Ollama is configured but not responding at %s\n" "$OLLAMA_URL"
    printf "   Start it with:  ollama serve\n\n"
  fi
fi

HOST=${HOST:-127.0.0.1}
PORT=${PORT:-3000}
URL="http://${HOST}:${PORT}"

printf "\n➤  starting Financial Coach at %s\n\n" "$URL"

# Open browser (best effort, non-fatal).
(
  sleep 2
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
) &

# Prefer a production start if already built; otherwise dev.
if [[ -d .next ]] && [[ -f .next/BUILD_ID ]]; then
  exec pnpm start
else
  exec pnpm dev
fi
