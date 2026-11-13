import "server-only";

import { env } from "@/lib/env";

/**
 * Provider configuration: which providers exist, which are configured, and
 * which one a user's preferences resolve to. Pure data — no SDK imports. The
 * only way to obtain a model is `resolveModelForUser` in `./gateway`, which
 * enforces cloud consent and quotas.
 */

export type LlmProvider = "ollama" | "anthropic" | "openai" | "google";

export interface ProviderInfo {
  provider: LlmProvider;
  model: string;
  isLocal: boolean;
}

/** Per-provider model presets shown in the settings selector. */
export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  ollama: ["qwen2.5:14b-instruct-q4_K_M", "llama3.2:3b", "llama3.1:8b", "mistral:7b", "gemma3:12b"],
  // Current generation, default first. Fable 5.2 is the most capable and
  // costs about twice Opus; Haiku 5.5 is the cheapest.
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
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

export interface UserPrefs {
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
export function resolveProvider(prefs?: UserPrefs): ProviderInfo {
  const e = env();
  const isHosted = e.AUTH_MODE === "oauth";

  if (prefs?.provider) {
    const p = prefs.provider as LlmProvider;
    const m = prefs.model?.trim() || undefined;
    switch (p) {
      case "anthropic":
        if (e.ANTHROPIC_API_KEY) return cloud(p, m ?? e.ANTHROPIC_MODEL);
        break;
      case "openai":
        if (e.OPENAI_API_KEY) return cloud(p, m ?? e.OPENAI_MODEL);
        break;
      case "google":
        if (e.GOOGLE_GENERATIVE_AI_API_KEY) return cloud(p, m ?? e.GOOGLE_MODEL);
        break;
      case "ollama":
        if (!isHosted) return { provider: p, model: m ?? e.OLLAMA_MODEL, isLocal: true };
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
      return cloud("anthropic", e.ANTHROPIC_MODEL);
    case "openai":
      return cloud("openai", e.OPENAI_MODEL);
    case "google":
      return cloud("google", e.GOOGLE_MODEL);
    default:
      return { provider: "ollama", model: e.OLLAMA_MODEL, isLocal: true };
  }
}

function cloud(provider: Exclude<LlmProvider, "ollama">, model: string): ProviderInfo {
  return { provider, model, isLocal: false };
}

/**
 * True when using these preferences would send data to a cloud provider the
 * user has not consented to. The gateway refuses such calls; UI code uses this
 * to decide whether to show the consent prompt.
 */
export function needsCloudConsent(user: {
  llmProvider: string | null;
  llmModel: string | null;
  cloudLlmConsentAt: Date | null;
}): boolean {
  const info = resolveProvider({ provider: user.llmProvider, model: user.llmModel });
  return !info.isLocal && user.cloudLlmConsentAt == null;
}
