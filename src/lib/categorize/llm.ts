import "server-only";

import { z } from "zod";
import type { LlmHandle } from "@/lib/llm/gateway";
import { type Redacted, redact } from "@/lib/redact";
import { cleanMerchant } from "./heuristics";

export interface LlmCategorizeInput {
  merchantName: string | null;
  rawDescription: string;
  amountCents: number;
  currency: string;
}

/** Optional category metadata so the model knows what each slug means. */
export interface CategoryHint {
  slug: string;
  name: string;
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
Pick the single best category slug for the transaction.
Return JSON only. Do not add commentary.

Important rules:
- "Comision 0,00", "Comision", "Tarjeta <number>", "Pago Movil", "Compra" are bank
  boilerplate describing the payment method — they are NOT the merchant and do NOT
  mean the category is bank fees.
- Use "fees" ONLY for an actual bank charge/commission with a non-zero fee amount.
- Software / AI / streaming / app subscriptions (Anthropic, Claude, OpenAI, ChatGPT,
  Netflix, Spotify, iCloud, YouTube Premium, etc.) → "subscriptions".
- Cafés, coffee shops and bars → "coffee". Restaurants and food delivery → "dining".
- If genuinely unsure, return "other" with confidence <= 0.4.`;

/** ISO-4217 code, or "XXX" (ISO's "no currency") for anything else. */
function currencyCode(raw: string): string {
  return /^[A-Z]{3}$/.test(raw) ? raw : "XXX";
}

/**
 * Build the categorization prompt. Bank-derived text arrives only as
 * `Redacted`; everything else is app data (seeded category names, a number,
 * a validated currency code).
 */
export function buildCategorizePrompt(input: {
  merchant: Redacted;
  description: Redacted;
  amountCents: number;
  currency: string;
  categories: readonly CategoryHint[];
}): string {
  const signedAmount = (input.amountCents / 100).toFixed(2);
  return [
    `Categories (slug — name):\n${input.categories.map((c) => `- ${c.slug} — ${c.name}`).join("\n")}`,
    `Merchant: ${input.merchant || "(none)"}`,
    `Full description (boilerplate, lower priority): ${input.description}`,
    `Amount: ${signedAmount} ${currencyCode(input.currency)} (negative = expense, positive = income)`,
    "Reply with the single best slug from the list above.",
  ].join("\n");
}

/**
 * Ask the LLM to categorize a single transaction.
 *
 * The merchant name and raw description are redacted before they reach the
 * prompt, for every provider. The amount is passed as a signed decimal (no
 * account identifiers). The model picks from the allowed `categories`;
 * anything else is coerced to "other".
 */
export async function categorizeWithLlm(
  llm: LlmHandle,
  input: LlmCategorizeInput,
  categories: readonly string[] | readonly CategoryHint[],
): Promise<LlmCategorizeResult> {
  // Normalize the category list to {slug, name} so the prompt can describe each.
  const cats: CategoryHint[] = categories.map((c) =>
    typeof c === "string" ? { slug: c, name: c } : c,
  );
  const slugSet = new Set(cats.map((c) => c.slug));

  // Clean the merchant down to the real name before redaction — strips the
  // "Comision/Tarjeta" boilerplate that otherwise skews the model toward fees.
  const cleaned = cleanMerchant(input.merchantName, input.rawDescription);
  const prompt = buildCategorizePrompt({
    merchant: redact(cleaned || input.merchantName),
    description: redact(input.rawDescription, 200),
    amountCents: input.amountCents,
    currency: input.currency,
    categories: cats,
  });

  const object = await llm.generateObject({
    schema: OutputSchema,
    instructions: SYSTEM,
    prompt,
    temperature: 0.1,
    maxRetries: 1,
  });

  const slug = slugSet.has(object.categorySlug) ? object.categorySlug : "other";
  const confidence =
    slug === object.categorySlug ? object.confidence : Math.min(object.confidence, 0.4);

  return {
    categorySlug: slug,
    confidence,
    provider: llm.info.provider,
    model: llm.info.model,
  };
}
