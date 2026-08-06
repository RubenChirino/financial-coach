import "server-only";

import { env } from "@/lib/env";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
// `ollama-ai-provider` was archived at the AI SDK v4 provider spec
// (LanguageModelV1) and can't talk to v5. `ollama-ai-provider-v2` is the
// maintained continuation; the 1.5.x line is the one built against
// `@ai-sdk/provider@2` (LanguageModelV2), which is what `ai@5` speaks. Later
// majors target the v3 spec and pair with `ai@6`/`ai@7` instead — bump both
// together or not at all.
import { createOllama } from "ollama-ai-provider-v2";

export type LlmProvider = "ollama" | "anthropic" | "openai" | "google";

export interface ProviderInfo {
  provider: LlmProvider;
  model: string;
  isLocal: boolean;
}

/** Per-provider model presets shown in the settings selector. */
export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  ollama: ["qwen2.5:14b-instruct-q4_K_M", "llama3.2:3b", "llama3.1:8b", "mistral:7b", "gemma3:12b"],
  anthropic: [
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-5",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  google: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"],
};

export interface AvailableProvider {
  id: LlmProvider;
  label: string;
  isLocal: boolean;
  /** API key is present in env — provider can actually be used. */
  configured: boolean;
  models: string[];
}

/**
 * Which providers have their API keys configured in the environment.
 * Ollama is always listed (no key needed).
 */
export function getAvailableProviders(): AvailableProvider[] {
  const e = env();
  return [
    {
      id: "ollama",
      label: "Ollama (local)",
      isLocal: true,
      configured: true,
      models: PROVIDER_MODELS.ollama,
    },
    {
      id: "anthropic",
      label: "Anthropic Claude",
      isLocal: false,
      configured: !!e.ANTHROPIC_API_KEY,
      models: PROVIDER_MODELS.anthropic,
    },
    {
      id: "openai",
      label: "OpenAI",
      isLocal: false,
      configured: !!e.OPENAI_API_KEY,
      models: PROVIDER_MODELS.openai,
    },
    {
      id: "google",
      label: "Google Gemini",
      isLocal: false,
      configured: !!e.GOOGLE_GENERATIVE_AI_API_KEY,
      models: PROVIDER_MODELS.google,
    },
  ];
}

interface UserPrefs {
  provider?: string | null;
  model?: string | null;
}

/**
 * Resolve the effective provider + model, merging:
 *   1. User DB preference (when set and that provider has a configured API key)
 *   2. `LLM_PROVIDER` env var (the static fallback)
 *
 * This lets users switch providers in-app without touching .env.local, as long
 * as the corresponding API key is already configured there.
 *
 * Hosted-mode caveat: when AUTH_MODE=oauth (the app is running on Vercel /
 * any serverless host), Ollama is unreachable — the daemon would have to
 * live in the function sandbox, which it doesn't. Treat any "ollama"
 * preference as if it were unset and fall through to the env-configured
 * provider (which, in hosted mode, should be a cloud provider like Gemini).
 */
function resolve(prefs?: UserPrefs): { provider: LlmProvider; model: string } {
  const e = env();
  const isHosted = e.AUTH_MODE === "oauth";

  if (prefs?.provider) {
    const p = prefs.provider as LlmProvider;
    const m = prefs.model?.trim() || undefined;
    switch (p) {
      case "anthropic":
        if (e.ANTHROPIC_API_KEY) return { provider: p, model: m ?? e.ANTHROPIC_MODEL };
        break;
      case "openai":
        if (e.OPENAI_API_KEY) return { provider: p, model: m ?? e.OPENAI_MODEL };
        break;
      case "google":
        if (e.GOOGLE_GENERATIVE_AI_API_KEY) return { provider: p, model: m ?? e.GOOGLE_MODEL };
        break;
      case "ollama":
        if (!isHosted) return { provider: p, model: m ?? e.OLLAMA_MODEL };
        // Hosted mode: ignore ollama preference, fall through to env fallback.
        break;
    }
  }

  // Fall back to env-configured provider. In hosted mode the default is
  // Gemini (free tier, HTTP-only — works on serverless); locally it's
  // Ollama unless explicitly overridden.
  const envProvider = e.LLM_PROVIDER === "ollama" && isHosted ? "google" : e.LLM_PROVIDER;
  switch (envProvider) {
    case "anthropic":
      return { provider: "anthropic", model: e.ANTHROPIC_MODEL };
    case "openai":
      return { provider: "openai", model: e.OPENAI_MODEL };
    case "google":
      return { provider: "google", model: e.GOOGLE_MODEL };
    default:
      return { provider: "ollama", model: e.OLLAMA_MODEL };
  }
}

/**
 * Build a Vercel AI SDK `LanguageModel` for the active provider.
 *
 * Pass `prefs` to apply a user's stored provider/model choice; omit for the
 * env-only default.
 */
export function getLanguageModel(prefs?: UserPrefs): { model: LanguageModel; info: ProviderInfo } {
  const e = env();
  const { provider, model } = resolve(prefs);

  if (provider === "anthropic") {
    if (!e.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    const anthropic = createAnthropic({ apiKey: e.ANTHROPIC_API_KEY });
    return { model: anthropic(model), info: { provider, model, isLocal: false } };
  }
  if (provider === "openai") {
    if (!e.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    const openai = createOpenAI({ apiKey: e.OPENAI_API_KEY });
    return { model: openai(model), info: { provider, model, isLocal: false } };
  }
  if (provider === "google") {
    if (!e.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    const google = createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY });
    return { model: google(model), info: { provider, model, isLocal: false } };
  }

  const ollama = createOllama({ baseURL: `${e.OLLAMA_BASE_URL}/api` });
  return { model: ollama(model), info: { provider: "ollama", model, isLocal: true } };
}

export function providerInfo(prefs?: UserPrefs): ProviderInfo {
  const { provider, model } = resolve(prefs);
  return { provider, model, isLocal: provider === "ollama" };
}
