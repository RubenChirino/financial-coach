/**
 * Pre-LLM heuristics for transaction categorization.
 *
 * Spanish-bank descriptions are noisy: "Compra Sq *hanso Cafe, Madrid, Tarjeta
 * 5489…, Comision 0,00". Feeding that raw to the model makes it latch onto
 * "Comision"/"Tarjeta" and wrongly pick bank fees. We therefore (1) clean the
 * text down to the real merchant, and (2) match well-known merchants
 * deterministically so they never depend on the model at all.
 */

const PREFIXES = [
  "compra en",
  "compra",
  "pago movil en",
  "pago movil",
  "pago en",
  "pago",
  "recibo de",
  "recibo",
  "adeudo de",
  "adeudo",
  "transferencia a favor de",
  "transferencia de",
  "bizum de",
  "bizum a favor de",
  "bizum",
];

/**
 * Reduce a raw bank description to the merchant text the LLM should reason
 * about: drop the transaction-type prefix, the trailing card/commission
 * boilerplate, the city/country tail, and card numbers.
 */
export function cleanMerchant(merchantName: string | null, rawDescription: string): string {
  let s = (merchantName ?? rawDescription ?? "").replace(/\s+/g, " ").trim();

  // Cut everything from the card/commission boilerplate onward.
  s = s.split(/,?\s*tarjeta\b/i)[0] ?? s;
  s = s.split(/,?\s*tarj\.?\b/i)[0] ?? s;
  s = s.split(/,?\s*comision\b/i)[0] ?? s;

  // Strip a leading transaction-type prefix.
  const lower = s.toLowerCase();
  for (const p of PREFIXES) {
    if (lower.startsWith(`${p} `)) {
      s = s.slice(p.length + 1);
      break;
    }
  }

  // Drop a trailing ", City Cc" / ", City" tail (one or two trailing comma parts
  // that look like a place rather than the merchant).
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) s = parts[0]!;

  // Remove card-scheme noise and long digit runs.
  s = s
    .replace(/\bmne\*\S+/gi, "")
    .replace(/\bsq\s*\*/gi, "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

interface KeywordRule {
  slug: string;
  keywords: string[];
}

// Ordered, high-confidence merchant keyword rules. First match wins. Keywords
// are matched as substrings against the cleaned, lowercased merchant text.
const KEYWORD_RULES: KeywordRule[] = [
  {
    slug: "subscriptions",
    keywords: [
      "anthropic",
      "claude",
      "openai",
      "chatgpt",
      "netflix",
      "spotify",
      "hbo",
      "max.com",
      "disney",
      "prime video",
      "primevideo",
      "amazon prime",
      "youtube premium",
      "icloud",
      "google one",
      "google storage",
      "dropbox",
      "notion",
      "github",
      "midjourney",
      "patreon",
      "tinder",
      "bumble",
      "audible",
      "playstation",
      "xbox",
      "nintendo",
      "adobe",
      "microsoft 365",
      "office 365",
      "linkedin",
      "duolingo",
      "canva",
    ],
  },
  {
    slug: "coffee",
    keywords: ["cafe", "café", "caffe", "coffee", "starbucks", "costa coffee"],
  },
  {
    slug: "groceries",
    keywords: [
      "mercadona",
      "carrefour",
      "lidl",
      "aldi",
      "alcampo",
      "eroski",
      "consum",
      "supercor",
      "dia",
    ],
  },
  {
    slug: "transport",
    keywords: [
      "uber",
      "cabify",
      "bolt.eu",
      "free now",
      "freenow",
      "renfe",
      "metro de",
      "emt",
      "taxi",
    ],
  },
  {
    slug: "fuel",
    keywords: ["repsol", "cepsa", "galp", "gasolinera", "shell", "petronor"],
  },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word(s) match so a keyword like "consum" (the Consum supermarket)
 * doesn't fire on "Caixabank Payments Consumer". Boundaries are non-letters, so
 * "dia" matches "Dia 18210" but not "media".
 */
function matchesKeyword(text: string, keyword: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(keyword)}([^\\p{L}]|$)`, "iu").test(text);
}

/**
 * Deterministic category for a transaction whose cleaned merchant text matches a
 * well-known merchant. Returns null when nothing matches (the caller then falls
 * back to the LLM). `amountCents` lets income-side rows opt out of expense
 * categories if needed (currently unused but kept for future rules).
 */
export function keywordCategory(cleanedMerchant: string, _amountCents: number): string | null {
  const text = cleanedMerchant.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => matchesKeyword(text, k))) return rule.slug;
  }
  return null;
}
