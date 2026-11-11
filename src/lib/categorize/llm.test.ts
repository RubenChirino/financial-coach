import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmHandle } from "@/lib/llm/gateway";
import { categorizeWithLlm } from "./llm";

const generateObjectMock = vi.fn();

const llm: LlmHandle = {
  info: { provider: "ollama", model: "test-model", isLocal: true },
  generateObject: (call) => generateObjectMock(call),
  generateText: vi.fn(),
  streamText: vi.fn(),
};

const SLUGS = ["groceries", "subscriptions", "other"] as const;

function promptOf(callIndex = 0): string {
  const call = generateObjectMock.mock.calls[callIndex];
  if (!call) throw new Error(`no model call #${callIndex}`);
  return (call[0] as { prompt: string }).prompt;
}

describe("categorizeWithLlm", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it("redacts PII in merchant and description before calling the model", async () => {
    generateObjectMock.mockResolvedValue({ categorySlug: "groceries", confidence: 0.9 });

    await categorizeWithLlm(
      llm,
      {
        merchantName: "Mercadona ES7600491500051234567892",
        rawDescription: "Compra en mercadona, contacto: foo@example.com tel +34 600 123 456",
        amountCents: -2599,
        currency: "EUR",
      },
      SLUGS,
    );

    expect(generateObjectMock).toHaveBeenCalledOnce();
    const prompt = promptOf();
    expect(prompt).not.toMatch(/ES7600491500051234567892/);
    expect(prompt).not.toMatch(/foo@example\.com/);
    expect(prompt).not.toMatch(/600\s?123\s?456/);
    expect(prompt).toMatch(/\[IBAN\]|\[EMAIL\]|\[PHONE\]/);
  });

  it("passes a signed decimal amount in the prompt", async () => {
    generateObjectMock.mockResolvedValue({ categorySlug: "groceries", confidence: 0.9 });
    await categorizeWithLlm(
      llm,
      { merchantName: "Lidl", rawDescription: "Lidl", amountCents: -1234, currency: "EUR" },
      SLUGS,
    );
    expect(promptOf()).toMatch(/-12\.34 EUR/);
  });

  it("replaces a currency that is not an ISO code", async () => {
    generateObjectMock.mockResolvedValue({ categorySlug: "groceries", confidence: 0.9 });
    await categorizeWithLlm(
      llm,
      { merchantName: "Lidl", rawDescription: "Lidl", amountCents: -100, currency: "call me" },
      SLUGS,
    );
    expect(promptOf()).not.toMatch(/call me/);
    expect(promptOf()).toMatch(/-1\.00 XXX/);
  });

  it("coerces unknown slug to 'other' and clamps confidence", async () => {
    generateObjectMock.mockResolvedValue({ categorySlug: "fictional-category", confidence: 0.95 });
    const out = await categorizeWithLlm(
      llm,
      { merchantName: "X", rawDescription: "Y", amountCents: -100, currency: "EUR" },
      SLUGS,
    );
    expect(out.categorySlug).toBe("other");
    expect(out.confidence).toBeLessThanOrEqual(0.4);
  });

  it("keeps the slug when it is in the allowed list", async () => {
    generateObjectMock.mockResolvedValue({ categorySlug: "subscriptions", confidence: 0.82 });
    const out = await categorizeWithLlm(
      llm,
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
        llm,
        { merchantName: "X", rawDescription: "Y", amountCents: -100, currency: "EUR" },
        SLUGS,
      ),
    ).rejects.toThrow(/ollama offline/);
  });
});
