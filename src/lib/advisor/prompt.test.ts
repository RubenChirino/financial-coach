import { describe, expect, it } from "vitest";
import { redact } from "@/lib/redact";
import type { AdvisorContext } from "./context";
import { buildSystemPrompt, chatHistory } from "./prompt";

const ctx: AdvisorContext = {
  generatedAt: "2026-04-20",
  currency: "EUR",
  dataThrough: "2026-04",
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
  topMerchants: [
    { name: redact("Mercadona"), totalSpent: 200, txCount: 5, categorySlug: "groceries" },
  ],
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
      merchant: redact("Netflix"),
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
    expect(p).toContain("as of 2026-04-20");
  });

  it("is the same for every turn of a day — nothing per-request in it", () => {
    expect(buildSystemPrompt("en", { ...ctx })).toBe(buildSystemPrompt("en", ctx));
    expect(buildSystemPrompt("en", ctx)).not.toMatch(/T\d{2}:\d{2}/);
  });

  it("uses the English system prompt when language is 'en'", () => {
    const p = buildSystemPrompt("en", ctx);
    expect(p).toMatch(/personal financial coach/);
    expect(p).toMatch(/same language as the user's most recent message/i);
  });

  it("uses the Spanish system prompt when language is 'es'", () => {
    const p = buildSystemPrompt("es", ctx);
    expect(p).toMatch(/coach financiero personal/);
    expect(p).toMatch(/mismo idioma que el último mensaje del usuario/i);
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

describe("chatHistory", () => {
  const m = (role: string, content: string) => ({ role, content });

  it("keeps user and assistant turns, the last N, starting on a user turn", () => {
    const msgs = [
      m("user", "q1"),
      m("assistant", "a1"),
      m("system", "note"),
      m("user", "q2"),
      m("assistant", "a2"),
      m("user", "q3"),
    ];
    // The last 4 turns open on "a1"; the window drops it to start at "q2".
    expect(chatHistory(msgs, 4)).toEqual([m("user", "q2"), m("assistant", "a2"), m("user", "q3")]);
    expect(chatHistory(msgs)).toHaveLength(5);
    expect(chatHistory([m("assistant", "hi")])).toEqual([]);
  });
});
