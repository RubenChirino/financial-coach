import "server-only";

import { getLanguageModel } from "@/lib/llm/provider";
import { redactPII } from "@/lib/redact";
import { generateObject } from "ai";
import { z } from "zod";
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
  categories: readonly string[] | readonly CategoryHint[],
): Promise<LlmCategorizeResult> {
  const { model, info } = getLanguageModel();

  // Normalize the category list to {slug, name} so the prompt can describe each.
  const cats: CategoryHint[] = categories.map((c) =>
    typeof c === "string" ? { slug: c, name: c } : c,
  );
  const slugSet = new Set(cats.map((c) => c.slug));

  // Clean the merchant down to the real name before redaction — strips the
  // "Comision/Tarjeta" boilerplate that otherwise skews the model toward fees.
  const cleaned = cleanMerchant(input.merchantName, input.rawDescription);
  const safeMerchant = redactPII(cleaned || input.merchantName || "");
  const safeDescription = redactPII(input.rawDescription).slice(0, 200);
  const signedAmount = (input.amountCents / 100).toFixed(2);

  const prompt = [
    `Categories (slug — name):\n${cats.map((c) => `- ${c.slug} — ${c.name}`).join("\n")}`,
    `Merchant: ${safeMerchant || "(none)"}`,
    `Full description (boilerplate, lower priority): ${safeDescription}`,
    `Amount: ${signedAmount} ${input.currency} (negative = expense, positive = income)`,
    "Reply with the single best slug from the list above.",
  ].join("\n");

  const { object } = await generateObject({
    model,
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
    provider: info.provider,
    model: info.model,
  };
}
