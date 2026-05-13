import "server-only";

import { db } from "@/db/client";
import { advisorConversations, advisorMessages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface AdvisorMessageRow {
  id: number;
  conversationId: number;
  role: "system" | "user" | "assistant";
  content: string;
  tokenCount: number;
  providerUsed: string | null;
  createdAt: number;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: advisorConversations.id,
      title: advisorConversations.title,
      updatedAt: advisorConversations.updatedAt,
    })
    .from(advisorConversations)
    .orderBy(desc(advisorConversations.updatedAt));

  const summaries: ConversationSummary[] = [];
  for (const r of rows) {
    const msgCount = await db
      .select({ id: advisorMessages.id })
      .from(advisorMessages)
      .where(eq(advisorMessages.conversationId, r.id));
    summaries.push({
      id: r.id,
      title: r.title || "(new)",
      updatedAt: r.updatedAt.getTime(),
      messageCount: msgCount.length,
    });
  }
  return summaries;
}

export async function getConversationMessages(
  conversationId: number,
): Promise<AdvisorMessageRow[]> {
  const rows = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, conversationId))
    .orderBy(advisorMessages.createdAt, advisorMessages.id);
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    role: r.role,
    content: r.content,
    tokenCount: r.tokenCount,
    providerUsed: r.providerUsed,
    createdAt: r.createdAt.getTime(),
  }));
}

export async function createConversation(title = ""): Promise<number> {
  const inserted = await db
    .insert(advisorConversations)
    .values({ title })
    .returning({ id: advisorConversations.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to create conversation");
  return id;
}

export async function appendMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
  opts?: { tokenCount?: number; providerUsed?: string },
): Promise<number> {
  const inserted = await db
    .insert(advisorMessages)
    .values({
      conversationId,
      role,
      content,
      tokenCount: opts?.tokenCount ?? 0,
      providerUsed: opts?.providerUsed ?? null,
    })
    .returning({ id: advisorMessages.id });
  await db
    .update(advisorConversations)
    .set({ updatedAt: new Date() })
    .where(eq(advisorConversations.id, conversationId));
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to append message");
  return id;
}

/**
 * Auto-derive a short title from the first user message. Stops at the first
 * sentence break or 60 chars — whichever comes first. Idempotent: only sets
 * a title when it's still empty.
 */
export async function maybeAutoTitle(conversationId: number, firstUserMsg: string): Promise<void> {
  const existing = await db
    .select({ title: advisorConversations.title })
    .from(advisorConversations)
    .where(eq(advisorConversations.id, conversationId))
    .limit(1);
  if (existing[0]?.title && existing[0].title.length > 0) return;

  const trimmed = firstUserMsg.trim().replace(/\s+/g, " ");
  const cut = trimmed.split(/(?<=[.?!])\s/)[0] ?? trimmed;
  const title = cut.length > 60 ? `${cut.slice(0, 57)}…` : cut;
  await db
    .update(advisorConversations)
    .set({ title })
    .where(eq(advisorConversations.id, conversationId));
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await db.delete(advisorConversations).where(eq(advisorConversations.id, conversationId));
}
