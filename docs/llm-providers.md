# LLM providers

> _Phase 4 lands full configuration UI. For Phase 1 the provider is configured via `.env.local` only._

The app supports four providers via a common interface. Pick one; you can switch later.

| Provider   | Where it runs | Cost | Privacy | Setup effort |
|------------|---------------|------|---------|--------------|
| Ollama     | Your machine  | Free | Data never leaves | Install + pull model |
| Anthropic  | Cloud         | $    | Redacted data sent | API key |
| OpenAI     | Cloud         | $    | Redacted data sent | API key |
| Google     | Cloud         | $    | Redacted data sent | API key |

**Redaction applies to all providers equally.** Before any context is sent — even to Ollama running on `localhost` — IBANs, card numbers, emails, phone numbers, and national IDs are stripped. See `src/lib/redact.ts`.

## Ollama (default, recommended for privacy)

```bash
# Install (macOS)
brew install ollama
ollama serve                            # leave this running

# In another shell: pull a model
ollama pull qwen2.5:14b-instruct-q4_K_M    # 16 GB+ RAM — best quality
# or:
ollama pull llama3.1:8b-instruct-q4_K_M    # 8 GB RAM — still solid
```

In `.env.local`:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M
```

## Anthropic (Claude)

Get a key at [console.anthropic.com](https://console.anthropic.com). Claude Sonnet 4.6 is the recommended model — excellent Spanish and reasoning.

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

Get a key at [ai.google.dev](https://ai.google.dev).

```bash
LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
```

## Cloud-provider consent

The first time the app runs with any cloud provider selected, you see a modal that lists exactly what gets sent (category totals, top merchants, redacted transaction summaries — never raw descriptions, never IBANs). You must confirm once; the consent timestamp is stored in the local database.

If you ever switch back to Ollama, no further consent is needed. If you later switch back to a cloud provider, you are re-prompted.
