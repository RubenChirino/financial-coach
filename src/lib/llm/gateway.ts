import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel, type ModelMessage, Output, streamText } from "ai";
import { eq } from "drizzle-orm";
// `ollama-ai-provider` was archived at the AI SDK v4 provider spec
// (LanguageModelV1); `ollama-ai-provider-v2` is the maintained continuation.
// Its major line tracks the provider spec, not the `ai` version, so the two
// must move together: 4.x is built against `@ai-sdk/provider@4`, which is what
// `ai@7` speaks. Downgrading `ai` without downgrading this (or vice versa)
// produces a model object the runtime rejects.
import { createOllama } from "ollama-ai-provider-v2";
import type { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { consumeQuota } from "@/lib/security/rate-limit";
import { needsCloudConsent, type ProviderInfo, resolveProvider } from "./provider";

/**
 * The only door to a language model.
 *
 * This module is the only one allowed to import the AI SDK generation
 * functions or a provider SDK (Biome `noRestrictedImports` plus
 * `boundary.test.ts`). Everything else asks `resolveModelForUser` for a handle,
 * which guarantees, for every call:
 *
 *  - **Provider choice** — the user's stored provider/model is used.
 *  - **Consent** — a cloud provider is refused with `CloudConsentRequired`
 *    until the user has opted in (`users.cloud_llm_consent_at`). Local Ollama
 *    needs no consent.
 *  - **Quota** — each purpose has a per-user window and a per-operation call
 *    budget; going over raises `LlmRateLimited`.
 *
 * Redaction is enforced one level up, by the prompt builders: they take
 * `Redacted` (see `@/lib/redact`) for anything bank-derived.
 */

export type LlmPurpose = "chat" | "categorize" | "csv-mapping" | "travel-city" | "travel-places";

interface PurposePolicy {
  /** Operations allowed per user per window. */
  limit: number;
  windowMs: number;
  /** Model calls one handle may make (one operation). */
  maxCalls: number;
}

const MINUTE = 60_000;

const POLICY: Record<LlmPurpose, PurposePolicy> = {
  // 20 turns a minute is more than a human sustains; it caps one user's spend
  // and keeps a stolen session from draining a shared free-tier key.
  chat: { limit: 20, windowMs: MINUTE, maxCalls: 1 },
  // One call per import; each carries a few KB of redacted bank text.
  "csv-mapping": { limit: 10, windowMs: 5 * MINUTE, maxCalls: 1 },
  // One operation = one batch from the background loop (≤ 100 rows), sent
  // 25 merchants per call — so at most 4 calls.
  categorize: { limit: 30, windowMs: MINUTE, maxCalls: 4 },
  "travel-city": { limit: 30, windowMs: MINUTE, maxCalls: 1 },
  // One operation = one batch of ≤ 100 places, sent 50 at a time.
  "travel-places": { limit: 30, windowMs: MINUTE, maxCalls: 2 },
};

export class CloudConsentRequired extends Error {
  readonly code = "cloudConsentRequired" as const;
  constructor() {
    super("cloud LLM use needs the user's consent");
    this.name = "CloudConsentRequired";
  }
}

export class LlmRateLimited extends Error {
  readonly code = "rateLimited" as const;
  constructor(readonly retryAfterMs: number) {
    super("LLM quota exceeded");
    this.name = "LlmRateLimited";
  }
}

export type LlmRefusalCode = CloudConsentRequired["code"] | LlmRateLimited["code"];

/** The refusal code when `err` is a gateway refusal, else null. */
export function llmRefusalCode(err: unknown): LlmRefusalCode | null {
  if (err instanceof CloudConsentRequired || err instanceof LlmRateLimited) return err.code;
  return null;
}

export interface TextCall {
  instructions?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
}

export interface StructuredCall<T> extends TextCall {
  /** The shape of the answer; the provider is asked for JSON matching it. */
  schema: z.ZodType<T>;
}

export interface StreamCall {
  instructions: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  onEnd?: Parameters<typeof streamText>[0]["onEnd"];
}

/**
 * Settings a provider needs in its own shape. Ollama's `/api/chat` has no
 * top-level output limit: `ollama-ai-provider-v2` forwards `maxOutputTokens`
 * as `max_output_tokens`, which Ollama ignores, so the cap would silently not
 * apply. Ollama reads it as the `num_predict` model option.
 */
function providerSettings(info: ProviderInfo, maxOutputTokens: number | undefined) {
  if (info.provider !== "ollama" || maxOutputTokens === undefined) return {};
  return { providerOptions: { ollama: { options: { num_predict: maxOutputTokens } } } };
}

// A non-generic wrapper so the return type is the concrete default overload
// (`ReturnType<typeof streamText>` would be the union of all three).
function startStream(model: LanguageModel, info: ProviderInfo, call: StreamCall) {
  return streamText({ model, ...call, ...providerSettings(info, call.maxOutputTokens) });
}
export type LlmStream = ReturnType<typeof startStream>;

export interface LlmHandle {
  readonly info: ProviderInfo;
  generateText(call: TextCall): Promise<string>;
  /**
   * One call whose answer is parsed and validated against `call.schema` —
   * `generateText` with an `Output.object` spec (the SDK's replacement for
   * the deprecated `generateObject`). Throws when the answer does not match.
   */
  generateStructured<T>(call: StructuredCall<T>): Promise<T>;
  streamText(call: StreamCall): LlmStream;
}

function languageModelFor(info: ProviderInfo): LanguageModel {
  const e = env();
  switch (info.provider) {
    case "anthropic":
      if (!e.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
      return createAnthropic({ apiKey: e.ANTHROPIC_API_KEY })(info.model);
    case "openai":
      if (!e.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      return createOpenAI({ apiKey: e.OPENAI_API_KEY })(info.model);
    case "google":
      if (!e.GOOGLE_GENERATIVE_AI_API_KEY)
        throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
      return createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY })(info.model);
    case "ollama":
      return createOllama({ baseURL: `${e.OLLAMA_BASE_URL}/api` })(info.model);
  }
}

/**
 * Resolve the model `userId` may use for `purpose`.
 *
 * Order matters: consent is checked before the quota, so a refused call does
 * not use up the window, and both run before any model is built.
 *
 * @throws CloudConsentRequired when the provider is not local and the user has
 *   not consented.
 * @throws LlmRateLimited when the purpose's window is used up.
 */
export async function resolveModelForUser(userId: number, purpose: LlmPurpose): Promise<LlmHandle> {
  const [user] = await db
    .select({
      llmProvider: users.llmProvider,
      llmModel: users.llmModel,
      cloudLlmConsentAt: users.cloudLlmConsentAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error("user not found");

  if (needsCloudConsent(user)) throw new CloudConsentRequired();

  const policy = POLICY[purpose];
  const quota = consumeQuota(`llm:${purpose}:${userId}`, policy.limit, policy.windowMs);
  if (!quota.allowed) throw new LlmRateLimited(quota.resetInMs);

  const info = resolveProvider({ provider: user.llmProvider, model: user.llmModel });
  const model = languageModelFor(info);

  let calls = 0;
  const spend = () => {
    calls += 1;
    if (calls > policy.maxCalls) throw new LlmRateLimited(0);
  };

  return {
    info,
    async generateText(call) {
      spend();
      const { text } = await generateText({
        model,
        ...call,
        ...providerSettings(info, call.maxOutputTokens),
      });
      return text;
    },
    async generateStructured<T>({ schema, ...call }: StructuredCall<T>): Promise<T> {
      spend();
      const { output } = await generateText({
        model,
        ...call,
        ...providerSettings(info, call.maxOutputTokens),
        output: Output.object({ schema }),
      });
      return output as T;
    },
    streamText(call) {
      spend();
      return startStream(model, info, call);
    },
  };
}
