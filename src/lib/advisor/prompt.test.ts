import { describe, expect, it } from "vitest";
import type { AdvisorContext } from "./context";
import { buildSystemPrompt } from "./prompt";

const ctx: AdvisorContext = {
  generatedAt: "2026-04-20T12:00:00.000Z",
  currency: "EUR",
  accounts: { totalBalance: 1234, count: 2 },
  months: [
    {
      month: "2026-04",
      income: 2500,
      expense: -800,
      net: 1700,
      txCount: 12,
      categories: [{ slug: "groceries", nameEn: "Groceries", spent: 200, txCount: 5 }],
    },
  ],
  topMerchants: [{ name: "Mercadona", totalSpent: 200, txCount: 5, categorySlug: "groceries" }],
  budgets: [
    {
      slug: "groceries",
      nameEn: "Groceries",
      monthlyBudget: 300,
      spentThisMonth: 200,
      pctUsed: 67,
    },
  ],
  subscriptions: [
    {
      merchant: "Netflix",
      amountPerCharge: 12,
      amountMonthly: 12,
      frequencyDays: 30,
      isActive: true,
    },
  ],
  goals: [],
  investorProfile: null,
  forecast: null,
};

describe("buildSystemPrompt", () => {
  it("includes the JSON snapshot inline so the model can use it", () => {
    const p = buildSystemPrompt("en", ctx);
    expect(p).toContain("USER_FINANCIAL_SNAPSHOT");
    expect(p).toContain('"totalBalance":1234');
    expect(p).toContain('"groceries"');
    expect(p).toContain("2026-04-20T12:00:00.000Z");
  });

  it("uses the English system prompt when language is 'en'", () => {
    const p = buildSystemPrompt("en", ctx);
    expect(p).toMatch(/personal financial coach/);
    expect(p).toMatch(/ALWAYS reply in English/);
  });

  it("uses the Spanish system prompt when language is 'es'", () => {
    const p = buildSystemPrompt("es", ctx);
    expect(p).toMatch(/coach financiero personal/);
    expect(p).toMatch(/Responde SIEMPRE en español/);
  });

  it("forbids inventing numbers and recommending products in both languages", () => {
    const en = buildSystemPrompt("en", ctx);
    const es = buildSystemPrompt("es", ctx);
    expect(en).toMatch(/Do not invent numbers/);
    expect(en).toMatch(/NEVER recommend specific instruments/);
    expect(es).toMatch(/No inventes números/);
    expect(es).toMatch(/NUNCA recomiendes instrumentos concretos/);
  });
});
