import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `ai` and the provider must be mocked before importing the module under test.
const generateObjectMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@/lib/llm/provider", () => ({
  getLanguageModel: () => ({
    model: { id: "test-model" } as never,
    info: { provider: "ollama" as const, model: "test-model", isLocal: true },
  }),
}));

const { categorizeWithLlm } = await import("./llm");

const SLUGS = ["groceries", "subscriptions", "other"] as const;

describe("categorizeWithLlm", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts PII in merchant and description before calling the model", async () => {
    generateObjectMock.mockResolvedValue({
      object: { categorySlug: "groceries", confidence: 0.9 },
    });

    await categorizeWithLlm(
      {
        merchantName: "Mercadona ES7600491500051234567892",
        rawDescription: "Compra en mercadona, contacto: foo@example.com tel +34 600 123 456",
        amountCents: -2599,
        currency: "EUR",
      },
      SLUGS,
    );

    expect(generateObjectMock).toHaveBeenCalledOnce();
    const call = generateObjectMock.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).not.toMatch(/ES7600491500051234567892/);
    expect(call.prompt).not.toMatch(/foo@example\.com/);
    expect(call.prompt).not.toMatch(/600\s?123\s?456/);
    expect(call.prompt).toMatch(/\[IBAN\]|\[EMAIL\]|\[PHONE\]/);
  });

  it("passes a signed decimal amount in the prompt", async () => {
    generateObjectMock.mockResolvedValue({
      object: { categorySlug: "groceries", confidence: 0.9 },
    });
    await categorizeWithLlm(
      { merchantName: "Lidl", rawDescription: "Lidl", amountCents: -1234, currency: "EUR" },
      SLUGS,
    );
    const call = generateObjectMock.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toMatch(/-12\.34 EUR/);
  });

  it("coerces unknown slug to 'other' and clamps confidence", async () => {
    generateObjectMock.mockResolvedValue({
      object: { categorySlug: "fictional-category", confidence: 0.95 },
    });
    const out = await categorizeWithLlm(
      { merchantName: "X", rawDescription: "Y", amountCents: -100, currency: "EUR" },
      SLUGS,
    );
    expect(out.categorySlug).toBe("other");
    expect(out.confidence).toBeLessThanOrEqual(0.4);
  });

  it("keeps the slug when it is in the allowed list", async () => {
    generateObjectMock.mockResolvedValue({
      object: { categorySlug: "subscriptions", confidence: 0.82 },
    });
    const out = await categorizeWithLlm(
      { merchantName: "Netflix", rawDescription: "Netflix", amountCents: -1199, currency: "EUR" },
      SLUGS,
    );
    expect(out.categorySlug).toBe("subscriptions");
    expect(out.confidence).toBeCloseTo(0.82);
    expect(out.provider).toBe("ollama");
  });

  it("propagates errors from the model so the orchestrator can retry later", async () => {
    generateObjectMock.mockRejectedValue(new Error("ollama offline"));
    await expect(
      categorizeWithLlm(
        { merchantName: "X", rawDescription: "Y", amountCents: -100, currency: "EUR" },
        SLUGS,
      ),
    ).rejects.toThrow(/ollama offline/);
  });
});
