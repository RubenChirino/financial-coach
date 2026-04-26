import { createTestDb } from "@/test/db-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, sqlite: fixture.sqlite }));

const { advisorConversations, advisorMessages } = await import("@/db/schema");
const {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  maybeAutoTitle,
} = await import("./conversations");

describe("advisor/conversations", () => {
  beforeEach(() => {
    fixture.sqlite.exec("DELETE FROM advisor_messages");
    fixture.sqlite.exec("DELETE FROM advisor_conversations");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createConversation returns a fresh id with empty title by default", async () => {
    const id = await createConversation();
    const rows = await fixture.db.select().from(advisorConversations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.title).toBe("");
  });

  it("appendMessage persists role, content, tokenCount and providerUsed", async () => {
    const id = await createConversation("hi");
    await appendMessage(id, "user", "hello");
    await appendMessage(id, "assistant", "world", {
      tokenCount: 42,
      providerUsed: "ollama:qwen2.5",
    });
    const msgs = await getConversationMessages(id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[0]?.content).toBe("hello");
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1]?.tokenCount).toBe(42);
    expect(msgs[1]?.providerUsed).toBe("ollama:qwen2.5");
  });

  it("appendMessage bumps the conversation's updatedAt", async () => {
    const id = await createConversation("hi");
    const before = await fixture.db.select().from(advisorConversations);
    const initialUpdatedAt = before[0]!.updatedAt.getTime();
    // Wait at least 5ms so the timestamp has room to move forward.
    await new Promise((r) => setTimeout(r, 10));
    await appendMessage(id, "user", "hello");
    const after = await fixture.db.select().from(advisorConversations);
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt);
  });

  it("listConversations returns conversations newest first", async () => {
    const a = await createConversation("first");
    await new Promise((r) => setTimeout(r, 5));
    const b = await createConversation("second");
    await new Promise((r) => setTimeout(r, 5));
    await appendMessage(a, "user", "bump"); // bumps updatedAt → moves to top

    const list = await listConversations();
    expect(list[0]?.id).toBe(a);
    expect(list[1]?.id).toBe(b);
    expect(list[0]?.messageCount).toBe(1);
    expect(list[1]?.messageCount).toBe(0);
  });

  it("maybeAutoTitle picks the first sentence and is idempotent", async () => {
    const id = await createConversation();
    await maybeAutoTitle(id, "How can I save more on groceries? I spend too much.");
    const rows = await fixture.db.select().from(advisorConversations);
    expect(rows[0]?.title).toBe("How can I save more on groceries?");

    // Calling again must NOT overwrite once a title exists.
    await maybeAutoTitle(id, "Totally different question now.");
    const after = await fixture.db.select().from(advisorConversations);
    expect(after[0]?.title).toBe("How can I save more on groceries?");
  });

  it("maybeAutoTitle truncates very long titles to 60 chars with ellipsis", async () => {
    const id = await createConversation();
    const long = "a".repeat(200);
    await maybeAutoTitle(id, long);
    const rows = await fixture.db.select().from(advisorConversations);
    expect(rows[0]?.title.length).toBeLessThanOrEqual(60);
    expect(rows[0]?.title.endsWith("…")).toBe(true);
  });

  it("deleteConversation cascades to its messages", async () => {
    const id = await createConversation("doomed");
    await appendMessage(id, "user", "hi");
    await appendMessage(id, "assistant", "hello");
    await deleteConversation(id);

    const convos = await fixture.db.select().from(advisorConversations);
    const msgs = await fixture.db.select().from(advisorMessages);
    expect(convos).toHaveLength(0);
    expect(msgs).toHaveLength(0);
  });
});
