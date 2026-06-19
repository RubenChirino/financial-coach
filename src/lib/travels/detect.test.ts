import { createTestDb } from "@/test/db-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const { accounts, cityCountries, institutions, requisitions, transactions } = await import(
  "@/db/schema"
);
const { listTravels } = await import("./detect");

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 2, 1, 12); // 2026-03-01
const USER = 1;

let accountId = 0;
let txSeq = 0;

async function seedAccount() {
  const inst = await fixture.db
    .insert(institutions)
    .values({ gocardlessId: "INST", name: "Bank", logoUrl: null, country: "ES" })
    .returning({ id: institutions.id });
  const req = await fixture.db
    .insert(requisitions)
    .values({
      userId: USER,
      institutionId: inst[0]!.id,
      gocardlessRequisitionId: "ENC",
      status: "linked",
      reference: "ref",
      link: null,
    })
    .returning({ id: requisitions.id });
  const acc = await fixture.db
    .insert(accounts)
    .values({
      userId: USER,
      requisitionId: req[0]!.id,
      gocardlessAccountId: "ENC",
      ibanLast4: "1234",
      name: "Checking",
      ownerName: null,
      balanceCents: 100_000,
      currency: "EUR",
    })
    .returning({ id: accounts.id });
  accountId = acc[0]!.id;
}

async function tx(opts: {
  dayOffset: number;
  amountCents: number;
  desc: string;
  currency?: string;
  isRecurring?: boolean;
}) {
  txSeq += 1;
  await fixture.db.insert(transactions).values({
    userId: USER,
    accountId,
    gocardlessTransactionId: `tx-${txSeq}`,
    bookingDate: new Date(BASE + opts.dayOffset * DAY),
    amountCents: opts.amountCents,
    currency: opts.currency ?? "EUR",
    merchantName: opts.desc,
    rawDescription: opts.desc,
    isRecurring: opts.isRecurring ?? false,
    needsReview: false,
  });
}

const home = { userId: USER, homeCountry: "ES", homeCurrency: "EUR" };

describe("listTravels (location-based)", () => {
  beforeEach(async () => {
    await fixture.client.execute("DELETE FROM transactions");
    await fixture.client.execute("DELETE FROM city_countries");
    await fixture.client.execute("DELETE FROM accounts");
    await fixture.client.execute("DELETE FROM requisitions");
    await fixture.client.execute("DELETE FROM institutions");
    txSeq = 0;
    await seedAccount();
  });

  it("detects a trip from explicit country codes and ignores home-country spend", async () => {
    await tx({
      dayOffset: 0,
      amountCents: -5000,
      desc: "Pago Movil En Mercadona, Madrid Es, Tarj. :*1",
    });
    await tx({
      dayOffset: 10,
      amountCents: -2000,
      desc: "Pago Movil En Pub, London Gb, Tarj. :*1",
    });
    await tx({
      dayOffset: 11,
      amountCents: -4000,
      desc: "Pago Movil En Tube, London Gb, Tarj. :*1",
    });
    await tx({
      dayOffset: 12,
      amountCents: -1000,
      desc: "Pago Movil En Cafe, London Gb, Tarj. :*1",
    });

    const trips = await listTravels(home);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.countryCode).toBe("GB");
    expect(trips[0]!.txCount).toBe(3);
    expect(trips[0]!.totalSpentCents).toBe(7000);
    expect(trips[0]!.city).toBe("London");
    expect(trips[0]!.tripKey.startsWith("GB:")).toBe(true);
  });

  it("uses the city→country cache for city-only descriptions", async () => {
    await fixture.db
      .insert(cityCountries)
      .values({ cityKey: "roma", cityLabel: "Roma", countryCode: "IT", source: "ai" });
    await tx({
      dayOffset: 5,
      amountCents: -3000,
      desc: "Compra Trattoria, Roma, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 6,
      amountCents: -2500,
      desc: "Compra Museo, Roma, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 7,
      amountCents: -1500,
      desc: "Compra Gelato, Roma, Tarjeta 5489 , Comision 0,00",
    });

    const trips = await listTravels(home);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.countryCode).toBe("IT");
    expect(trips[0]!.city).toBe("Roma");
  });

  it("ignores city-only foreign places not yet resolved in the cache", async () => {
    await tx({
      dayOffset: 5,
      amountCents: -3000,
      desc: "Compra Cafe, Dublin, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 6,
      amountCents: -2500,
      desc: "Compra Pub, Dublin, Tarjeta 5489 , Comision 0,00",
    });
    // Not in cache → unknown country → not a trip (until a sync resolves it).
    expect(await listTravels(home)).toHaveLength(0);
  });

  it("drops a one-off foreign charge that isn't a trip", async () => {
    await tx({
      dayOffset: 5,
      amountCents: -9900,
      desc: "Pago Movil En Shop, Berlin De, Tarj. :*1",
    });
    expect(await listTravels(home)).toHaveLength(0);
  });

  it("falls back to currency for foreign-currency payments with no location", async () => {
    await tx({ dayOffset: 0, amountCents: -1000, desc: "Bizum De Alguien", currency: "GBP" });
    await tx({ dayOffset: 1, amountCents: -2000, desc: "Bizum De Otro", currency: "GBP" });
    await tx({ dayOffset: 2, amountCents: -1500, desc: "Bizum De Mas", currency: "GBP" });
    const trips = await listTravels(home);
    expect(trips.map((t) => t.countryCode)).toEqual(["GB"]);
  });

  it("splits the same country into separate trips across a long gap", async () => {
    for (const d of [0, 1, 2, 40, 41, 42]) {
      await tx({ dayOffset: d, amountCents: -1000, desc: "Pago Movil En X, London Gb, Tarj. :*1" });
    }
    const trips = await listTravels(home);
    expect(trips).toHaveLength(2);
    expect(trips[0]!.startDate.getTime()).toBeGreaterThan(trips[1]!.startDate.getTime());
  });

  it("treats a home-country city as home even in city-only form (self-learned)", async () => {
    // "Madrid Es" appears explicitly → Madrid is known to be ES…
    await tx({
      dayOffset: 0,
      amountCents: -1000,
      desc: "Pago Movil En Tienda, Madrid Es, Tarj. :*1",
    });
    // …so these city-only Madrid payments must NOT become a trip.
    await tx({
      dayOffset: 5,
      amountCents: -2000,
      desc: "Compra Bar, Madrid, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 6,
      amountCents: -3000,
      desc: "Compra Cine, Madrid, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 7,
      amountCents: -1500,
      desc: "Compra Tienda, Madrid, Tarjeta 5489 , Comision 0,00",
    });

    expect(await listTravels(home)).toHaveLength(0);
  });

  it("self-learned home city wins over a stale foreign AI cache entry", async () => {
    // A bad cache says "Cordoba" → Argentina…
    await fixture.db
      .insert(cityCountries)
      .values({ cityKey: "cordoba", cityLabel: "Cordoba", countryCode: "AR", source: "ai" });
    // …but the user's own data tags Cordoba as ES, which must win.
    await tx({ dayOffset: 0, amountCents: -1000, desc: "Pago Movil En X, Cordoba Es, Tarj. :*1" });
    await tx({
      dayOffset: 5,
      amountCents: -2000,
      desc: "Compra Bar, Cordoba, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 6,
      amountCents: -3000,
      desc: "Compra Meson, Cordoba, Tarjeta 5489 , Comision 0,00",
    });

    expect(await listTravels(home)).toHaveLength(0);
  });

  it("excludes online payments whose city is the merchant's billing location", async () => {
    // Anthropic billed from San Francisco — must NOT become a US trip…
    await fixture.db.insert(cityCountries).values({
      cityKey: "san francisco",
      cityLabel: "San Francisco",
      countryCode: "US",
      source: "ai",
    });
    await tx({
      dayOffset: 0,
      amountCents: -1210,
      desc: "Compra Anthropic, San Francisco, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -2178,
      desc: "Compra Anthropic* Claude Sub, San Francisco, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 2,
      amountCents: -1500,
      desc: "Compra Amazon* R8, San Francisco, Tarjeta 5489 , Comision 0,00",
    });
    expect(await listTravels(home)).toHaveLength(0);
  });

  it("still detects a real in-person trip alongside excluded online charges", async () => {
    await fixture.db
      .insert(cityCountries)
      .values({ cityKey: "roma", cityLabel: "Roma", countryCode: "IT", source: "ai" });
    // Real Rome spending…
    await tx({
      dayOffset: 0,
      amountCents: -3000,
      desc: "Compra Trattoria Da Mario, Roma, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -2500,
      desc: "Compra Museo Vaticano, Roma, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 2,
      amountCents: -1500,
      desc: "Compra Gelateria, Roma, Tarjeta 5489 , Comision 0,00",
    });
    // …plus an online OpenAI charge that happens to bill from Dublin.
    await tx({
      dayOffset: 1,
      amountCents: -2300,
      desc: "Compra Openai *chatgpt Subscr, Dublin, Tarjeta 5489 , Comision 0,00",
    });

    const trips = await listTravels(home);
    expect(trips.map((t) => t.countryCode)).toEqual(["IT"]);
    expect(trips[0]!.txCount).toBe(3);
  });

  it("excludes recurring foreign charges", async () => {
    for (const d of [0, 30, 60]) {
      await tx({
        dayOffset: d,
        amountCents: -1500,
        desc: "Compra Service, San Francisco, Tarjeta 5489 , Comision 0,00",
        isRecurring: true,
      });
    }
    expect(await listTravels(home)).toHaveLength(0);
  });

  it("detects a domestic trip outside the home region, ignoring home spending", async () => {
    await fixture.db.insert(cityCountries).values([
      { cityKey: "madrid", cityLabel: "Madrid", countryCode: "ES", region: "Madrid", source: "ai" },
      {
        cityKey: "donostia san",
        cityLabel: "Donostia San",
        countryCode: "ES",
        region: "País Vasco",
        source: "ai",
      },
    ]);
    // Home-region spending — must be ignored.
    await tx({
      dayOffset: 0,
      amountCents: -2000,
      desc: "Compra Bar, Madrid, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -3000,
      desc: "Compra Cine, Madrid, Tarjeta 5489 , Comision 0,00",
    });
    // San Sebastián trip (different community), explicit "City Cc".
    await tx({
      dayOffset: 20,
      amountCents: -4000,
      desc: "Pago Movil En Resto, Donostia San Es, Tarj. :*1",
    });
    await tx({
      dayOffset: 21,
      amountCents: -2500,
      desc: "Pago Movil En Pintxos, Donostia San Es, Tarj. :*1",
    });
    await tx({
      dayOffset: 22,
      amountCents: -1500,
      desc: "Pago Movil En Cafe, Donostia San Es, Tarj. :*1",
    });

    const trips = await listTravels({
      userId: USER,
      homeCountry: "ES",
      homeCity: "Madrid",
      homeCurrency: "EUR",
    });
    expect(trips).toHaveLength(1);
    expect(trips[0]!.region).toBe("País Vasco");
    expect(trips[0]!.countryCode).toBe("ES");
    expect(trips[0]!.txCount).toBe(3);
  });

  it("groups a multi-city domestic trip by region (one trip for the area)", async () => {
    await fixture.db.insert(cityCountries).values([
      {
        cityKey: "alcorcon",
        cityLabel: "Alcorcon",
        countryCode: "ES",
        region: "Madrid",
        source: "ai",
      },
      {
        cityKey: "santiago",
        cityLabel: "Santiago",
        countryCode: "ES",
        region: "Galicia",
        source: "ai",
      },
      { cityKey: "lugo", cityLabel: "Lugo", countryCode: "ES", region: "Galicia", source: "ai" },
      {
        cityKey: "sarria",
        cityLabel: "Sarria",
        countryCode: "ES",
        region: "Galicia",
        source: "ai",
      },
    ]);
    await tx({
      dayOffset: 0,
      amountCents: -2000,
      desc: "Compra Albergue, Sarria, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -1500,
      desc: "Compra Meson, Lugo, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 3,
      amountCents: -3000,
      desc: "Compra Hotel, Santiago, Tarjeta 5489 , Comision 0,00",
    });

    const trips = await listTravels({
      userId: USER,
      homeCountry: "ES",
      homeCity: "Alcorcon",
      homeCurrency: "EUR",
    });
    expect(trips).toHaveLength(1);
    expect(trips[0]!.region).toBe("Galicia");
    expect(trips[0]!.txCount).toBe(3);
  });

  it("detects a domestic trip from the static region map with NO cache or explicit codes", async () => {
    // No cityCountries rows seeded — the static ES map resolves Madrid (home)
    // and Sevilla (Andalucía) deterministically.
    await tx({
      dayOffset: 0,
      amountCents: -2000,
      desc: "Compra Tapas, Sevilla, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -3000,
      desc: "Compra Museo, Sevilla, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 2,
      amountCents: -1000,
      desc: "Compra Bar, Sevilla, Tarjeta 5489 , Comision 0,00",
    });

    const trips = await listTravels({
      userId: USER,
      homeCountry: "ES",
      homeCity: "Madrid",
      homeCurrency: "EUR",
    });
    expect(trips).toHaveLength(1);
    expect(trips[0]!.region).toBe("Andalucía");
    expect(trips[0]!.countryCode).toBe("ES");
  });

  it("skips domestic detection when the home city's region can't be resolved", async () => {
    await tx({
      dayOffset: 0,
      amountCents: -2000,
      desc: "Compra Tapas, Sevilla, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 1,
      amountCents: -3000,
      desc: "Compra Museo, Sevilla, Tarjeta 5489 , Comision 0,00",
    });
    await tx({
      dayOffset: 2,
      amountCents: -1000,
      desc: "Compra Bar, Sevilla, Tarjeta 5489 , Comision 0,00",
    });

    // Home city not in the static map and not cached → no home region → no domestic trips.
    const trips = await listTravels({
      userId: USER,
      homeCountry: "ES",
      homeCity: "Quuxville",
      homeCurrency: "EUR",
    });
    expect(trips).toHaveLength(0);
  });
});
