/**
 * Detect online / card-not-present payments so they are NOT mistaken for travel.
 *
 * Online charges carry the *company's billing city* in the description — e.g.
 * "Compra Anthropic* Claude Sub, San Francisco", "Amazon* …, Luxembourg",
 * "Apple.com/bill, Cork", "Omio *omio, Berlin". Location-based trip detection
 * would otherwise read those as visits to San Francisco / Luxembourg / Cork /
 * Berlin. We exclude any payment that looks like a known online merchant or
 * carries a web-billing marker; genuine in-person spending (a café in Rome) has
 * neither, so real trips are untouched.
 */

// Markers that strongly imply a web/remote charge rather than a card present at
// a physical terminal.
const DOMAIN_MARKER = /\.(com|net|io)\b|\/bill\b|\bitunes\b|\bpaypal\b/i;

// Companies that bill from their HQ regardless of where the user is. Matched as
// whole words so "amazon" doesn't fire on an unrelated substring.
const ONLINE_MERCHANTS = [
  "amazon",
  "anthropic",
  "claude",
  "openai",
  "chatgpt",
  "omio",
  "netflix",
  "spotify",
  "hbo",
  "disney",
  "youtube",
  "google",
  "microsoft",
  "adobe",
  "aliexpress",
  "ebay",
  "steam",
  "playstation",
  "xbox",
  "nintendo",
  "dropbox",
  "notion",
  "github",
  "patreon",
  "audible",
  "midjourney",
  "canva",
  "duolingo",
  "linkedin",
  "booking",
  "airbnb",
  "uber",
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}([^\\p{L}]|$)`, "iu").test(text);
}

/**
 * True when a transaction is an online/remote charge whose embedded city is the
 * merchant's billing location, not a place the user travelled to.
 */
export function isOnlinePayment(merchantName: string | null, rawDescription: string): boolean {
  const text = `${merchantName ?? ""} ${rawDescription ?? ""}`.toLowerCase();
  if (DOMAIN_MARKER.test(text)) return true;
  return ONLINE_MERCHANTS.some((m) => hasWord(text, m));
}
