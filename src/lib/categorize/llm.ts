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
}

/** Merchants per model call: big enough to amortize the prompt, small enough to answer reliably. */
export const MERCHANTS_PER_CALL = 25;

const OutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      categorySlug: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM = `You are a personal-finance categorization engine for a Spanish user.
For each numbered transaction, pick the single best category slug.

Important rules:
- "Comision 0,00", "Comision", "Tarjeta <number>", "Pago Movil", "Compra" are bank
  boilerplate describing the payment method — they are NOT the merchant and do NOT
  mean the category is bank fees.
- Use "fees" ONLY for an actual bank charge/commission with a non-zero fee amount.
- Software / AI / streaming / app subscriptions (Anthropic, Claude, OpenAI, ChatGPT,
  Netflix, Spotify, iCloud, YouTube Premium, etc.) → "subscriptions".
- Cafés, coffee shops and bars → "coffee". Restaurants and food delivery → "dining".
- If genuinely unsure, return "other" with confidence <= 0.4.
Answer every id exactly once.`;

/** ISO-4217 code, or "XXX" (ISO's "no currency") for anything else. */
function currencyCode(raw: string): string {
  return /^[A-Z]{3}$/.test(raw) ? raw : "XXX";
}

export interface PromptItem {
  merchant: Redacted;
  description: Redacted;
  amountCents: number;
  currency: string;
}

/**
 * Build the categorization prompt for numbered items (one per merchant).
 * Bank-derived text arrives only as `Redacted`; everything else is app data
 * (seeded category names, numbers, a validated currency code).
 */
export function buildCategorizePrompt(input: {
  items: readonly PromptItem[];
  categories: readonly CategoryHint[];
}): string {
  const lines = input.items.map((it, i) => {
    const amount = (it.amountCents / 100).toFixed(2);
    return `${i + 1}. merchant: ${it.merchant || "(none)"} | description: ${it.description} | amount: ${amount} ${currencyCode(it.currency)}`;
  });
  return [
    `Categories (slug — name):\n${input.categories.map((c) => `- ${c.slug} — ${c.name}`).join("\n")}`,
    "Transactions (negative amount = expense, positive = income; the description is boilerplate, lower priority):",
    ...lines,
    'Reply {"results": [{"id": <number>, "categorySlug": <slug from the list>, "confidence": <0..1>}]}.',
  ].join("\n");
}

/**
 * Categorize up to `MERCHANTS_PER_CALL` transactions — one representative per
 * merchant — in ONE model call. Merchant and description are cleaned of bank
 * boilerplate and redacted before they reach the prompt, for every provider.
 *
 * Returns the answer per input index. A slug outside `categories` becomes
 * "other" with confidence ≤ 0.4; an item the model did not answer is absent
 * (it stays pending). Throws when the call fails or the answer does not match
 * the schema — the caller decides whether to keep calling.
 */
export async function categorizeWithLlm(
  llm: LlmHandle,
  inputs: readonly LlmCategorizeInput[],
  categories: readonly string[] | readonly CategoryHint[],
): Promise<Map<number, LlmCategorizeResult>> {
  if (inputs.length > MERCHANTS_PER_CALL) {
    throw new Error(`at most ${MERCHANTS_PER_CALL} items per call`);
  }
  const cats: CategoryHint[] = categories.map((c) =>
    typeof c === "string" ? { slug: c, name: c } : c,
  );
  const slugSet = new Set(cats.map((c) => c.slug));

  const prompt = buildCategorizePrompt({
    items: inputs.map((input) => {
      // Clean the merchant down to the real name before redaction — strips the
      // "Comision/Tarjeta" boilerplate that otherwise skews the model to fees.
      const cleaned = cleanMerchant(input.merchantName, input.rawDescription);
      return {
        merchant: redact(cleaned || input.merchantName),
        description: redact(input.rawDescription, 200),
        amountCents: input.amountCents,
        currency: input.currency,
      };
    }),
    categories: cats,
  });

  const { results } = await llm.generateStructured({
    schema: OutputSchema,
    instructions: SYSTEM,
    prompt,
    temperature: 0.1,
    maxRetries: 1,
  });

  const out = new Map<number, LlmCategorizeResult>();
  for (const r of results) {
    const index = r.id - 1;
    if (index < 0 || index >= inputs.length || out.has(index)) continue;
    const known = slugSet.has(r.categorySlug);
    out.set(index, {
      categorySlug: known ? r.categorySlug : "other",
      confidence: known ? r.confidence : Math.min(r.confidence, 0.4),
    });
  }
  return out;
}
