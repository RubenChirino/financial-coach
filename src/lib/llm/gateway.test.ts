import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

/**
 * End-to-end checks for the gateway's three guarantees, with every provider
 * SDK replaced by a mock model that records the exact prompt it receives:
 *
 *  - Redaction: for every feature that calls a model (categorize, CSV mapping,
 *    travel city, travel places, chat), bank text seeded with an IBAN, card,
 *    email, phone and DNI/NIE never reaches the model.
 *  - Provider choice: the user's stored provider and model are the ones called.
 *  - Consent: a cloud provider without consent is refused before any call;
 *    categorization still applies rules and keywords and reports why it
 *    skipped the LLM.
 */

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const testEnv = vi.hoisted(() => ({
  AUTH_MODE: "local" as "local" | "oauth",
  LLM_PROVIDER: "ollama",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "llama-test",
  ANTHROPIC_API_KEY: "test-key",
  ANTHROPIC_MODEL: "claude-test",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-test",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  GOOGLE_MODEL: "gemini-test",
}));
vi.mock("@/lib/env", () => ({ env: () => testEnv }));

interface Captured {
  provider: string;
  modelId: string;
  text: string;
  maxOutputTokens?: number;
  providerOptions?: unknown;
}
const captured: Captured[] = [];
/** What the mock model answers, given the prompt text it received. */
let reply: (prompt: string) => string = () => "";

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

type ModelPrompt = Parameters<MockLanguageModelV4["doGenerate"]>[0]["prompt"];

function promptText(prompt: ModelPrompt): string {
  return prompt
    .flatMap((m) =>
      typeof m.content === "string"
        ? [m.content]
        : m.content.flatMap((p) => (p.type === "text" ? [p.text] : [])),
    )
    .join("\n");
}

function mockModel(provider: string, modelId: string) {
  return new MockLanguageModelV4({
    provider,
    modelId,
    doGenerate: async ({ prompt, maxOutputTokens, providerOptions }) => {
      const text = promptText(prompt);
      captured.push({ provider, modelId, text, maxOutputTokens, providerOptions });
      return {
        content: [{ type: "text", text: reply(text) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
    doStream: async ({ prompt, maxOutputTokens, providerOptions }) => {
      captured.push({
        provider,
        modelId,
        text: promptText(prompt),
        maxOutputTokens,
        providerOptions,
      });
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "ok" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
        ]),
      };
    },
  });
}

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (id: string) => mockModel("anthropic", id),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => (id: string) => mockModel("openai", id) }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (id: string) => mockModel("google", id),
}));
vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: () => (id: string) => mockModel("ollama", id),
}));

const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const eqUser = (userId: number) => eq(schema.transactions.userId, userId);
const eqRuleUser = (userId: number) => eq(schema.categoryRules.userId, userId);
const { CloudConsentRequired, LlmRateLimited, resolveModelForUser } = await import("./gateway");
const { categorizePendingBatch } = await import("@/lib/categorize");
const { parseCsvWithAi } = await import("@/lib/import/ai-mapper");
const { generateCity } = await import("@/lib/travels/city");
const { resolveCitiesWithAi } = await import("@/lib/travels/locations");
const { cityKey } = await import("@/lib/travels/parse-location");
const { buildAdvisorContext } = await import("@/lib/advisor/context");
const { buildSystemPrompt } = await import("@/lib/advisor/prompt");

/** One string per identifier type; each feature is fed every one of them. */
const PII = [
  "ES76 0049 1500 0512 3456 7892",
  "ES9121000418450200051332",
  "es76 0049 1500 0512 3456 7892",
  "4111 1111 1111 1111",
  "5500-0000-0000-0004",
  "maria.garcia@example.com",
  "+34 612 345 678",
  "612345678",
  "12345678Z",
  "X1234567L",
];
/** Marker that must survive redaction — proves the data reached the prompt. */
const MARKER = "ZQX";

const squash = (s: string) => s.replace(/[\s-]/g, "").toLowerCase();

function expectNoPii(text: string) {
  expect(text).toContain(MARKER);
  for (const pii of PII) {
    expect(text).not.toContain(pii);
    expect(squash(text)).not.toContain(squash(pii));
  }
}

const USERS = {
  cloudConsented: 1,
  cloudNoConsent: 2,
  local: 3,
  openai: 4,
  quota: 5,
  budget: 6,
  batch: 7,
  down: 8,
};

let accountByUser: Record<number, number> = {};
let txSeq = 0;

async function addTx(userId: number, merchantName: string, rawDescription = merchantName) {
  txSeq++;
  await fixture.db.insert(schema.transactions).values({
    userId,
    accountId: accountByUser[userId]!,
    gocardlessTransactionId: `tx-${txSeq}`,
    bookingDate: new Date(),
    amountCents: -1_000 - txSeq,
    merchantName,
    rawDescription,
  });
}

beforeAll(async () => {
  const d = fixture.db;
  const consent = new Date();
  await d.insert(schema.users).values([
    {
      id: USERS.cloudConsented,
      encryptionSalt: "1",
      llmProvider: "anthropic",
      cloudLlmConsentAt: consent,
    },
    { id: USERS.cloudNoConsent, encryptionSalt: "2", llmProvider: "anthropic" },
    { id: USERS.local, encryptionSalt: "3", llmProvider: "ollama" },
    {
      id: USERS.openai,
      encryptionSalt: "4",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      cloudLlmConsentAt: consent,
    },
    { id: USERS.quota, encryptionSalt: "5", llmProvider: "ollama" },
    { id: USERS.budget, encryptionSalt: "6", llmProvider: "ollama" },
    { id: USERS.batch, encryptionSalt: "7", llmProvider: "ollama" },
    { id: USERS.down, encryptionSalt: "8", llmProvider: "ollama" },
  ]);
  await d.insert(schema.categories).values([
    { slug: "groceries", nameEs: "Súper", nameEn: "Groceries", icon: "x", color: "#000" },
    { slug: "other", nameEs: "Otros", nameEn: "Other", icon: "x", color: "#111" },
  ]);
  const [inst] = await d
    .insert(schema.institutions)
    .values({ gocardlessId: "DEMO", name: "Demo", country: "ES" })
    .returning();
  accountByUser = {};
  for (const userId of Object.values(USERS)) {
    const [req] = await d
      .insert(schema.requisitions)
      .values({
        userId,
        institutionId: inst!.id,
        provider: "demo",
        gocardlessRequisitionId: `enc-${userId}`,
        status: "linked",
        reference: `r-${userId}`,
      })
      .returning();
    const [acc] = await d
      .insert(schema.accounts)
      .values({ userId, requisitionId: req!.id, gocardlessAccountId: "enc", name: "A" })
      .returning();
    accountByUser[userId] = acc!.id;
  }
});

/** A categorize reply answering every numbered item in the prompt. */
function answerAll(categorySlug: string, confidence: number) {
  return (prompt: string) => {
    const ids = [...prompt.matchAll(/^(\d+)\. merchant:/gm)].map((m) => Number(m[1]));
    return JSON.stringify({ results: ids.map((id) => ({ id, categorySlug, confidence })) });
  };
}

beforeEach(() => {
  captured.length = 0;
  reply = () => "";
  testEnv.AUTH_MODE = "local";
});

describe("gateway redaction — every feature that calls a model", () => {
  it("categorize", async () => {
    for (const pii of PII)
      await addTx(USERS.cloudConsented, `${MARKER} STORE ${pii}`, `PAGO ${pii}`);
    reply = answerAll("groceries", 0.9);

    const res = await categorizePendingBatch({ userId: USERS.cloudConsented, limit: 100 });

    // Every row answered, from one call: the rows are grouped by merchant.
    expect(res.llmMatched).toBe(PII.length);
    expect(captured).toHaveLength(1);
    for (const c of captured) expectNoPii(c.text);
  });

  it("CSV mapping", async () => {
    const csv = [
      "Fecha;Concepto;Importe",
      ...PII.map((pii, i) => `0${(i % 9) + 1}/03/2026;${MARKER} ${pii};-${i + 1},50`),
    ].join("\n");
    reply = () =>
      JSON.stringify({
        delimiter: ";",
        headerLineIndex: 0,
        dateColumn: 0,
        dateFormat: "DD/MM/YYYY",
        amountMode: "single",
        amountColumn: 2,
        debitColumn: null,
        creditColumn: null,
        amountSign: "negative-out",
        decimalSeparator: ",",
        thousandsSeparator: "none",
        currencyColumn: -1,
        defaultCurrency: "EUR",
        merchantColumn: -1,
        descriptionColumn: 1,
        notes: "test",
      });

    const llm = await resolveModelForUser(USERS.cloudConsented, "csv-mapping");
    const res = await parseCsvWithAi(llm, csv);

    expect(res.rows).toHaveLength(PII.length);
    expect(captured).toHaveLength(1);
    expectNoPii(captured[0]!.text);
  });

  it("travel city", async () => {
    reply = () => "Lisbon";
    const llm = await resolveModelForUser(USERS.cloudConsented, "travel-city");
    const city = await generateCity({
      llm,
      country: "Portugal",
      currency: "EUR",
      merchantNames: PII.map((pii) => `${MARKER} ${pii}`),
    });

    expect(city).toBe("Lisbon");
    expect(captured).toHaveLength(1);
    expectNoPii(captured[0]!.text);
  });

  it("travel places — and answers keyed by the redacted name map back to the original", async () => {
    const places = ["Lisboa", ...PII.map((pii) => `${MARKER} ${pii}`)];
    // Answer the way a model does: naming exactly the strings it was sent.
    reply = (prompt) => {
      const sent = JSON.parse(prompt.slice(prompt.indexOf("Items:") + 6)) as string[];
      return JSON.stringify({
        places: sent.map((name) => ({ name, country: "PT", region: null })),
      });
    };
    const llm = await resolveModelForUser(USERS.cloudConsented, "travel-places");
    const result = await resolveCitiesWithAi(llm, places, "ES");

    expect(captured).toHaveLength(1);
    expectNoPii(captured[0]!.text);
    for (const place of places) expect(result.get(cityKey(place))?.countryCode).toBe("PT");
  });

  it("chat — the system prompt built from the user's data", async () => {
    await addTx(USERS.local, `${MARKER} ${PII.join(" / ")}`);
    await fixture.db.insert(schema.recurringSubscriptions).values({
      userId: USERS.local,
      merchantName: `${MARKER} SUB ${PII.join(" / ")}`,
      averageAmountCents: 1_299,
      frequencyDays: 30,
      lastSeenAt: new Date(),
      isActive: true,
    });
    const ctx = await buildAdvisorContext({ userId: USERS.local });
    const llm = await resolveModelForUser(USERS.local, "chat");

    const result = llm.streamText({
      instructions: buildSystemPrompt("en", ctx),
      messages: [{ role: "user", content: "How am I doing?" }],
    });
    expect(await result.text).toBe("ok");

    expect(captured).toHaveLength(1);
    expectNoPii(captured[0]!.text);
    expect(captured[0]!.text).toContain(`${MARKER} SUB`);
  });
});

describe("gateway provider choice and consent", () => {
  it("uses the user's stored provider and model", async () => {
    await addTx(USERS.openai, `${MARKER} UNKNOWN SHOP`);
    reply = answerAll("groceries", 0.9);

    await categorizePendingBatch({ userId: USERS.openai });

    expect(captured.map(({ provider, modelId }) => ({ provider, modelId }))).toEqual([
      { provider: "openai", modelId: "gpt-4o-mini" },
    ]);
  });

  it("refuses a cloud provider without consent, before any model call", async () => {
    await expect(resolveModelForUser(USERS.cloudNoConsent, "chat")).rejects.toBeInstanceOf(
      CloudConsentRequired,
    );
    expect(captured).toHaveLength(0);
  });

  it("categorization without consent still applies keywords and reports why it skipped the LLM", async () => {
    await addTx(USERS.cloudNoConsent, "MERCADONA MADRID");
    await addTx(USERS.cloudNoConsent, `${MARKER} UNKNOWN SHOP`);

    const res = await categorizePendingBatch({ userId: USERS.cloudNoConsent });

    expect(res).toMatchObject({
      processed: 2,
      keywordMatched: 1,
      llmMatched: 0,
      errors: 0,
      skipped: 1,
      llmSkipped: "cloudConsentRequired",
    });
    expect(captured).toHaveLength(0);
  });

  it("a local provider needs no consent", async () => {
    const llm = await resolveModelForUser(USERS.local, "travel-city");
    expect(llm.info).toMatchObject({ provider: "ollama", isLocal: true });
  });

  it("hosted mode ignores an Ollama preference, and the cloud fallback needs consent", async () => {
    testEnv.AUTH_MODE = "oauth";
    await expect(resolveModelForUser(USERS.local, "chat")).rejects.toBeInstanceOf(
      CloudConsentRequired,
    );
  });

  it("a refused call does not use up the quota", async () => {
    for (let i = 0; i < 15; i++) {
      await expect(resolveModelForUser(USERS.cloudNoConsent, "csv-mapping")).rejects.toBeInstanceOf(
        CloudConsentRequired,
      );
    }
  });
});

describe("gateway quotas", () => {
  it("enforces the per-purpose window", async () => {
    for (let i = 0; i < 10; i++) await resolveModelForUser(USERS.quota, "csv-mapping");
    await expect(resolveModelForUser(USERS.quota, "csv-mapping")).rejects.toBeInstanceOf(
      LlmRateLimited,
    );
    // Other purposes have their own window.
    await expect(resolveModelForUser(USERS.quota, "travel-city")).resolves.toBeDefined();
  });

  it("enforces the per-operation call budget", async () => {
    reply = () => "Lisbon";
    const llm = await resolveModelForUser(USERS.budget, "travel-city");
    await llm.generateText({ prompt: "one" });
    await expect(llm.generateText({ prompt: "two" })).rejects.toBeInstanceOf(LlmRateLimited);
    expect(captured).toHaveLength(1);
  });
});

describe("gateway output cap", () => {
  it("reaches Ollama as num_predict, which is the only limit it reads", async () => {
    reply = () => "Lisbon";
    const local = await resolveModelForUser(USERS.local, "travel-city");
    await local.generateText({ prompt: "one", maxOutputTokens: 24 });
    await (await resolveModelForUser(USERS.local, "chat"))
      .streamText({
        instructions: "s",
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 1500,
      })
      .consumeStream();
    const cloud = await resolveModelForUser(USERS.openai, "travel-city");
    await cloud.generateText({ prompt: "two", maxOutputTokens: 24 });

    expect(captured.map((c) => [c.provider, c.maxOutputTokens, c.providerOptions])).toEqual([
      ["ollama", 24, { ollama: { options: { num_predict: 24 } } }],
      ["ollama", 1500, { ollama: { options: { num_predict: 1500 } } }],
      ["openai", 24, undefined],
    ]);
  });
});

describe("categorization by merchant", () => {
  const rowsOf = (userId: number) =>
    fixture.db
      .select({
        merchant: schema.transactions.merchantName,
        categoryId: schema.transactions.categoryId,
        source: schema.transactions.categorySource,
        needsReview: schema.transactions.needsReview,
      })
      .from(schema.transactions)
      .where(eqUser(userId));

  it("asks once per merchant, applies the answer to every row, and learns an ai rule", async () => {
    for (let i = 0; i < 3; i++) await addTx(USERS.batch, "ZQX Bakery Uno");
    await addTx(USERS.batch, "ZQX Hardware Dos");
    reply = (prompt) => {
      const ids = [...prompt.matchAll(/^(\d+)\. merchant: (.*?) \|/gm)];
      return JSON.stringify({
        results: ids.map(([, id, merchant]) => ({
          id: Number(id),
          categorySlug: "groceries",
          // Confident about the bakery only.
          confidence: merchant?.includes("Bakery") ? 0.95 : 0.5,
        })),
      });
    };

    const res = await categorizePendingBatch({ userId: USERS.batch });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.text.match(/^\d+\. merchant:/gm)).toHaveLength(2);
    expect(res).toMatchObject({ processed: 4, llmMatched: 4, llmCalls: 1, errors: 0 });
    const rows = await rowsOf(USERS.batch);
    expect(rows.every((r) => r.source === "llm" && r.categoryId != null)).toBe(true);
    // Below 0.7 the answer is kept but flagged for review.
    expect(rows.filter((r) => r.needsReview).map((r) => r.merchant)).toEqual(["ZQX Hardware Dos"]);
    const rules = await fixture.db
      .select({ pattern: schema.categoryRules.matchPattern, by: schema.categoryRules.createdBy })
      .from(schema.categoryRules)
      .where(eqRuleUser(USERS.batch));
    expect(rules).toEqual([{ pattern: "zqx bakery uno", by: "ai" }]);

    // The next charge from the bakery is matched by that rule: no call.
    captured.length = 0;
    await addTx(USERS.batch, "ZQX Bakery Uno");
    // The low-confidence hardware row stays flagged for the user, not re-asked.
    const next = await categorizePendingBatch({ userId: USERS.batch });
    expect(next).toMatchObject({ processed: 1, ruleMatched: 1, llmCalls: 0 });
    expect(captured).toHaveLength(0);
  });

  it("stops after the first failed call and reports the provider unavailable", async () => {
    // 30 merchants: two calls' worth.
    for (let i = 0; i < 30; i++) await addTx(USERS.down, `ZQX Shop ${i}`);
    reply = () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };

    const res = await categorizePendingBatch({ userId: USERS.down, limit: 100 });

    expect(captured).toHaveLength(1);
    expect(res).toMatchObject({
      processed: 30,
      llmMatched: 0,
      llmCalls: 1,
      skipped: 30,
      llmSkipped: "unavailable",
    });

    // The client then runs with skipLlm: rules and keywords only, no call.
    captured.length = 0;
    const again = await categorizePendingBatch({ userId: USERS.down, skipLlm: true });
    expect(again).toMatchObject({ llmCalls: 0, skipped: 30, llmSkipped: null });
    expect(captured).toHaveLength(0);
  });
});
