# LLM providers

The app talks to four LLM providers through one common interface (the
[Vercel AI SDK](https://sdk.vercel.ai)). Pick one; you can switch any time —
from `.env.local`, or in-app from **Settings → AI Model** without touching env
files. The resolver lives in
[`src/lib/llm/provider.ts`](../src/lib/llm/provider.ts).

| Provider   | Where it runs | Cost | Privacy | Setup effort | Hosted (Vercel) |
|------------|---------------|------|---------|--------------|-----------------|
| Ollama     | Your machine  | Free | Data never leaves your machine | Install + pull a model | ❌ unreachable from serverless |
| Anthropic  | Cloud         | $    | Redacted aggregates sent | API key | ✅ |
| OpenAI     | Cloud         | $    | Redacted aggregates sent | API key | ✅ |
| Google     | Cloud         | $ (free tier) | Redacted aggregates sent | API key | ✅ (auto-fallback) |

**Redaction applies to every provider equally.** Before any context is sent —
even to Ollama running on `localhost` — IBANs, card numbers, emails, phone
numbers, national IDs, postal codes, and long digit runs are stripped, and the
model only ever sees **rounded aggregates** (monthly totals, top categories, top
merchants), never raw transaction rows. See
[`src/lib/redact.ts`](../src/lib/redact.ts) and
[`src/lib/advisor/context.ts`](../src/lib/advisor/context.ts).

## Choosing a provider and model

There are two layers:

1. **Env default** — `LLM_PROVIDER` plus the per-provider `*_MODEL` in
   `.env.local`. This is the fallback used when a user has no stored preference.
2. **Per-user preference** — set in **Settings → AI Model**. Stored in the DB and
   takes precedence over the env default, *as long as that provider's API key is
   configured in the environment*. So you keep the keys in `.env.local` once, and
   switch provider/model freely from the UI.

The selector offers these presets per provider (any model string the provider
supports also works):

- **Ollama:** `qwen2.5:14b-instruct-q4_K_M` (default), `llama3.1:8b`,
  `llama3.2:3b`, `mistral:7b`, `gemma3:12b`
- **Anthropic:** `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-5`,
  `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Google:** `gemini-2.5-flash` (default), `gemini-2.0-flash`, `gemini-1.5-pro`,
  `gemini-1.5-flash`

## Ollama (default, recommended for privacy)

```bash
# Install (macOS)
brew install ollama
ollama serve                               # leave this running

# In another shell: pull a model
ollama pull qwen2.5:14b-instruct-q4_K_M    # 16 GB+ RAM — best quality, good Spanish
# or, on a smaller machine:
ollama pull llama3.1:8b-instruct-q4_K_M    # 8 GB RAM — still solid
```

In `.env.local`:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M
```

## Anthropic (Claude)

Get a key at [console.anthropic.com](https://console.anthropic.com).

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## OpenAI

Get a key at [platform.openai.com](https://platform.openai.com).

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

## Google (Gemini)

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
There's a generous free tier.

```bash
LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
```

## Hosted mode (Vercel) — automatic Gemini fallback

A serverless function can't reach a local Ollama daemon. When `AUTH_MODE=oauth`,
the resolver treats any `ollama` preference (env *or* per-user) as unset and
falls through to the env-configured cloud provider — defaulting to **Gemini**,
whose free tier and HTTP-only API suit serverless. Set
`GOOGLE_GENERATIVE_AI_API_KEY` + `GOOGLE_MODEL` for a hosted deploy. New OAuth
users are provisioned with Gemini and implicit cloud consent (they're already on
a cloud service — same trust boundary).

## Cloud-provider consent (local mode)

The first time the app runs with a *cloud* provider selected in local mode, you
see a modal that lists exactly what gets sent (category totals, top merchants,
redacted/rounded summaries — never raw descriptions, never IBANs). You confirm
once; the consent timestamp is stored in the local database. Switching back to
Ollama needs no consent; switching back to a cloud provider re-prompts.

## What the coach will and won't do

The system prompt ([`src/lib/advisor/prompt.ts`](../src/lib/advisor/prompt.ts))
enforces "honest software" guardrails on every turn:

- Answers in the user's language; uses **only** the snapshot's numbers (never
  invents figures).
- **Hard limit:** never recommends specific instruments (tickers, named
  funds/ETFs, specific cryptocurrencies, brokers). That is regulated advice.
- It *can* explain general principles (compound interest, diversification,
  emergency funds, priority order of debt → emergency fund → goals → investing)
  and tailor the *framing* to the user's investor profile when present.
