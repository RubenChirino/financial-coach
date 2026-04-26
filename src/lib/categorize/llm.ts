import "server-only";

import { getLanguageModel } from "@/lib/llm/provider";
import { redactPII } from "@/lib/redact";
import { generateObject } from "ai";
import { z } from "zod";

export interface LlmCategorizeInput {
  merchantName: string | null;
  rawDescription: string;
  amountCents: number;
  currency: string;
}

export interface LlmCategorizeResult {
  categorySlug: string;
  confidence: number;
  provider: string;
  model: string;
}

const OutputSchema = z.object({
  categorySlug: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are a personal-finance categorization engine for a Spanish user.
Pick the single best category slug for the transaction below.
Return JSON only. Do not add commentary.
If unsure, return slug "other" with confidence <= 0.4.`;

/**
 * Ask the LLM to categorize a single transaction.
 *
 * **Redaction is unconditional** — the merchant name and raw description are
 * run through `redactPII` before being sent to any model, local or cloud. The
 * amount is passed as a signed decimal (no account identifiers).
 *
 * The model picks from the allowed `categorySlugs` (usually the seeded 25);
 * anything else is coerced to "other" by the caller.
 */
export async function categorizeWithLlm(
  input: LlmCategorizeInput,
  categorySlugs: readonly string[],
): Promise<LlmCategorizeResult> {
  const { model, info } = getLanguageModel();

  const safeMerchant = redactPII(input.merchantName ?? "");
  const safeDescription = redactPII(input.rawDescription).slice(0, 200);
  const signedAmount = (input.amountCents / 100).toFixed(2);

  const prompt = [
    `Allowed category slugs: ${categorySlugs.join(", ")}`,
    `Merchant: ${safeMerchant || "(none)"}`,
    `Description: ${safeDescription}`,
    `Amount: ${signedAmount} ${input.currency} (negative = expense, positive = income)`,
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: OutputSchema,
    system: SYSTEM,
    prompt,
    temperature: 0.1,
    maxRetries: 1,
  });

  const slug = categorySlugs.includes(object.categorySlug) ? object.categorySlug : "other";
  const confidence =
    slug === object.categorySlug ? object.confidence : Math.min(object.confidence, 0.4);

  return {
    categorySlug: slug,
    confidence,
    provider: info.provider,
    model: info.model,
  };
}
