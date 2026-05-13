import { eq } from "drizzle-orm";
import type { DB } from "./client";
import { categories, categoryRules } from "./schema";

/**
 * Default deterministic rules. Matched case-insensitively against the
 * merchant name + raw description. Lower priority = evaluated first.
 *
 * Keep the patterns conservative — false positives here ship bad categories
 * to real transactions. The LLM fallback handles everything not matched.
 */
interface SeedRule {
  pattern: string;
  type: "merchant_exact" | "contains" | "regex";
  slug: string;
  priority: number;
}

export const DEFAULT_RULES: SeedRule[] = [
  // Groceries (Spain)
  { pattern: "mercadona", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "lidl", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "carrefour", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "alcampo", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "dia ", type: "contains", slug: "groceries", priority: 12 },
  { pattern: "consum", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "eroski", type: "contains", slug: "groceries", priority: 10 },
  { pattern: "hipercor", type: "contains", slug: "groceries", priority: 10 },

  // Subscriptions
  { pattern: "netflix", type: "contains", slug: "subscriptions", priority: 10 },
  { pattern: "spotify", type: "contains", slug: "subscriptions", priority: 10 },
  { pattern: "apple.com/bill", type: "contains", slug: "subscriptions", priority: 10 },
  { pattern: "hbo", type: "contains", slug: "subscriptions", priority: 12 },
  { pattern: "disney", type: "contains", slug: "subscriptions", priority: 12 },
  { pattern: "amazon prime", type: "contains", slug: "subscriptions", priority: 10 },
  { pattern: "youtube premium", type: "contains", slug: "subscriptions", priority: 10 },

  // Telecom
  { pattern: "movistar", type: "contains", slug: "telecom", priority: 10 },
  { pattern: "vodafone", type: "contains", slug: "telecom", priority: 10 },
  { pattern: "orange", type: "contains", slug: "telecom", priority: 12 },
  { pattern: "yoigo", type: "contains", slug: "telecom", priority: 10 },
  { pattern: "digi mobil", type: "contains", slug: "telecom", priority: 10 },

  // Utilities
  { pattern: "iberdrola", type: "contains", slug: "utilities", priority: 10 },
  { pattern: "endesa", type: "contains", slug: "utilities", priority: 10 },
  { pattern: "naturgy", type: "contains", slug: "utilities", priority: 10 },
  { pattern: "repsol gas", type: "contains", slug: "utilities", priority: 10 },

  // Fuel
  { pattern: "repsol", type: "contains", slug: "fuel", priority: 15 },
  { pattern: "cepsa", type: "contains", slug: "fuel", priority: 10 },
  { pattern: "galp", type: "contains", slug: "fuel", priority: 10 },
  { pattern: "shell", type: "contains", slug: "fuel", priority: 10 },
  { pattern: "bp ", type: "contains", slug: "fuel", priority: 12 },

  // Transport
  { pattern: "renfe", type: "contains", slug: "transport", priority: 10 },
  { pattern: "alsa", type: "contains", slug: "transport", priority: 10 },
  { pattern: "cabify", type: "contains", slug: "transport", priority: 10 },
  { pattern: "uber", type: "contains", slug: "transport", priority: 10 },
  { pattern: "bolt", type: "contains", slug: "transport", priority: 10 },
  { pattern: "free now", type: "contains", slug: "transport", priority: 10 },
  { pattern: "metro ", type: "contains", slug: "transport", priority: 15 },
  { pattern: "emt ", type: "contains", slug: "transport", priority: 12 },

  // Dining / coffee
  { pattern: "starbucks", type: "contains", slug: "coffee", priority: 10 },
  { pattern: "glovo", type: "contains", slug: "dining", priority: 10 },
  { pattern: "just eat", type: "contains", slug: "dining", priority: 10 },
  { pattern: "uber eats", type: "contains", slug: "dining", priority: 10 },
  { pattern: "deliveroo", type: "contains", slug: "dining", priority: 10 },
  { pattern: "mcdonald", type: "contains", slug: "dining", priority: 10 },
  { pattern: "burger king", type: "contains", slug: "dining", priority: 10 },
  { pattern: "telepizza", type: "contains", slug: "dining", priority: 10 },

  // Pharmacy / health
  { pattern: "farmacia", type: "contains", slug: "pharmacy", priority: 10 },
  { pattern: "sanitas", type: "contains", slug: "health", priority: 10 },
  { pattern: "adeslas", type: "contains", slug: "health", priority: 10 },
  { pattern: "dkv", type: "contains", slug: "health", priority: 10 },

  // Shopping
  { pattern: "amazon", type: "contains", slug: "shopping", priority: 20 },
  { pattern: "el corte ingles", type: "contains", slug: "shopping", priority: 10 },
  { pattern: "zara", type: "contains", slug: "shopping", priority: 10 },
  { pattern: "primark", type: "contains", slug: "shopping", priority: 10 },
  { pattern: "ikea", type: "contains", slug: "shopping", priority: 10 },

  // Taxes, fees, transfers
  { pattern: "hacienda", type: "contains", slug: "taxes", priority: 10 },
  { pattern: "aeat", type: "contains", slug: "taxes", priority: 10 },
  { pattern: "seguridad social", type: "contains", slug: "taxes", priority: 10 },
  { pattern: "comision", type: "contains", slug: "fees", priority: 30 },
  { pattern: "comisión", type: "contains", slug: "fees", priority: 30 },
  { pattern: "transferencia", type: "contains", slug: "transfers", priority: 40 },

  // Income
  { pattern: "nómina", type: "contains", slug: "income", priority: 10 },
  { pattern: "nomina", type: "contains", slug: "income", priority: 10 },
  { pattern: "salario", type: "contains", slug: "income", priority: 10 },
];

export async function seedDefaultRules(db: DB): Promise<void> {
  const existing = await db.select({ count: categoryRules.id }).from(categoryRules).limit(1);
  if (existing.length > 0) return;

  const slugs = [...new Set(DEFAULT_RULES.map((r) => r.slug))];
  const catRows = await Promise.all(
    slugs.map(async (slug) => {
      const row = await db
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1);
      return row[0];
    }),
  );
  const slugToId = new Map<string, number>();
  for (const r of catRows) if (r) slugToId.set(r.slug, r.id);

  const toInsert = DEFAULT_RULES.map((r) => {
    const categoryId = slugToId.get(r.slug);
    if (!categoryId) return null;
    return {
      matchPattern: r.pattern,
      matchType: r.type,
      categoryId,
      priority: r.priority,
    };
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  if (toInsert.length > 0) await db.insert(categoryRules).values(toInsert);
}
