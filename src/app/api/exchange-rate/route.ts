import { NextResponse } from "next/server";

/**
 * GET /api/exchange-rate?from=EUR&to=USD
 *
 * Fetches the current exchange rate from the European Central Bank's free
 * daily reference rates feed. No API key required. Rates are published once
 * per business day around 16:00 CET.
 *
 * Response is cached for 1 hour via Cache-Control so repeated client calls
 * don't hammer the ECB endpoint.
 */
export const revalidate = 3600; // 1 hour ISR cache

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

interface RateMap {
  [currency: string]: number;
}

async function fetchECBRates(): Promise<RateMap> {
  const res = await fetch(ECB_URL, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`ECB fetch failed: ${res.status}`);
  const xml = await res.text();

  // Parse with a simple regex — the ECB XML is well-structured and consistent.
  // Each rate looks like: <Cube currency='USD' rate='1.0823'/>
  const rates: RateMap = { EUR: 1 };
  const pattern = /currency='([A-Z]{3})'\s+rate='([0-9.]+)'/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: intentional regex loop
  while ((m = pattern.exec(xml)) !== null) {
    const [, currency, rate] = m;
    if (currency && rate) rates[currency] = Number.parseFloat(rate);
  }
  return rates;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = (searchParams.get("from") ?? "EUR").toUpperCase();
  const to = (searchParams.get("to") ?? "USD").toUpperCase();

  try {
    const rates = await fetchECBRates();

    // ECB publishes rates as "1 EUR = X foreign". Convert accordingly.
    const fromRate = rates[from] ?? 1; // rate relative to EUR
    const toRate = rates[to] ?? 1;

    // Convert: from→EUR→to
    const rate = toRate / fromRate;

    return NextResponse.json(
      { from, to, rate, source: "ECB", date: new Date().toISOString().slice(0, 10) },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    console.error("Exchange rate fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch exchange rate" }, { status: 502 });
  }
}
