import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmHandle } from "@/lib/llm/gateway";
import { categorizeWithLlm, type LlmCategorizeInput, MERCHANTS_PER_CALL } from "./llm";

const generateStructuredMock = vi.fn();

const llm: LlmHandle = {
  info: { provider: "ollama", model: "test-model", isLocal: true },
  generateStructured: (call) => generateStructuredMock(call),
  generateText: vi.fn(),
  streamText: vi.fn(),
};

const SLUGS = ["groceries", "subscriptions", "other"] as const;

function promptOf(callIndex = 0): string {
  const call = generateStructuredMock.mock.calls[callIndex];
  if (!call) throw new Error(`no model call #${callIndex}`);
  return (call[0] as { prompt: string }).prompt;
}

const tx = (over: Partial<LlmCategorizeInput> = {}): LlmCategorizeInput => ({
  merchantName: "Lidl",
  rawDescription: "Lidl",
  amountCents: -1234,
  currency: "EUR",
  ...over,
});

/** Answer every item with the same slug and confidence. */
const answerAll = (categorySlug: string, confidence: number, n = 1) =>
  generateStructuredMock.mockResolvedValue({
    results: Array.from({ length: n }, (_, i) => ({ id: i + 1, categorySlug, confidence })),
  });

describe("categorizeWithLlm", () => {
  beforeEach(() => {
    generateStructuredMock.mockReset();
  });

  it("redacts PII in merchant and description before calling the model", async () => {
    answerAll("groceries", 0.9);
    await categorizeWithLlm(
      llm,
      [
        tx({
          merchantName: "Mercadona ES7600491500051234567892",
          rawDescription: "Compra en mercadona, contacto: foo@example.com tel +34 600 123 456",
          amountCents: -2599,
        }),
      ],
      SLUGS,
    );

    expect(generateStructuredMock).toHaveBeenCalledOnce();
    const prompt = promptOf();
    expect(prompt).not.toMatch(/ES7600491500051234567892/);
    expect(prompt).not.toMatch(/foo@example\.com/);
    expect(prompt).not.toMatch(/600\s?123\s?456/);
    expect(prompt).toMatch(/\[IBAN\]|\[EMAIL\]|\[PHONE\]/);
  });

  it("numbers every item in one prompt, with a signed decimal amount", async () => {
    answerAll("groceries", 0.9, 2);
    await categorizeWithLlm(
      llm,
      [tx(), tx({ merchantName: "Aldi", rawDescription: "Aldi", amountCents: 500 })],
      SLUGS,
    );
    expect(generateStructuredMock).toHaveBeenCalledOnce();
    expect(promptOf()).toMatch(/1\. merchant: Lidl .*-12\.34 EUR/);
    expect(promptOf()).toMatch(/2\. merchant: Aldi .*5\.00 EUR/);
  });

  it("replaces a currency that is not an ISO code", async () => {
    answerAll("groceries", 0.9);
    await categorizeWithLlm(llm, [tx({ amountCents: -100, currency: "call me" })], SLUGS);
    expect(promptOf()).not.toMatch(/call me/);
    expect(promptOf()).toMatch(/-1\.00 XXX/);
  });

  it("maps answers back by id: unknown slugs become 'other', ids out of range and repeats are ignored", async () => {
    generateStructuredMock.mockResolvedValue({
      results: [
        { id: 2, categorySlug: "subscriptions", confidence: 0.82 },
        { id: 1, categorySlug: "fictional-category", confidence: 0.95 },
        { id: 2, categorySlug: "groceries", confidence: 0.99 },
        { id: 9, categorySlug: "groceries", confidence: 0.99 },
      ],
    });
    const out = await categorizeWithLlm(llm, [tx(), tx(), tx()], SLUGS);
    expect(out.get(0)).toEqual({ categorySlug: "other", confidence: 0.4 });
    expect(out.get(1)).toEqual({ categorySlug: "subscriptions", confidence: 0.82 });
    expect(out.has(2)).toBe(false); // unanswered: stays pending
    expect(out.size).toBe(2);
  });

  it("refuses more items than one call carries", async () => {
    const many = Array.from({ length: MERCHANTS_PER_CALL + 1 }, () => tx());
    await expect(categorizeWithLlm(llm, many, SLUGS)).rejects.toThrow(/at most/);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("propagates errors from the model so the caller can stop calling", async () => {
    generateStructuredMock.mockRejectedValue(new Error("ollama offline"));
    await expect(categorizeWithLlm(llm, [tx()], SLUGS)).rejects.toThrow(/ollama offline/);
  });
});
