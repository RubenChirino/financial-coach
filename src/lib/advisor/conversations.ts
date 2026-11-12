import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { advisorConversations, advisorMessages } from "@/db/schema";

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

/**
 * Whether `conversationId` belongs to `userId`. Used to gate writes to a
 * caller-supplied conversation id (the chat route accepts one from the client).
 */
export async function userOwnsConversation(
  userId: number,
  conversationId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: advisorConversations.id })
    .from(advisorConversations)
    .where(
      and(eq(advisorConversations.id, conversationId), eq(advisorConversations.userId, userId)),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: advisorConversations.id,
      title: advisorConversations.title,
      updatedAt: advisorConversations.updatedAt,
    })
    .from(advisorConversations)
    .where(eq(advisorConversations.userId, userId))
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
  userId: number,
  conversationId: number,
): Promise<AdvisorMessageRow[]> {
  // Ownership gate: only the owner of the conversation can read its messages.
  // `advisorMessages` carries no `userId` of its own — it inherits ownership
  // through its parent conversation, so we join and filter there.
  const rows = await db
    .select({
      id: advisorMessages.id,
      conversationId: advisorMessages.conversationId,
      role: advisorMessages.role,
      content: advisorMessages.content,
      tokenCount: advisorMessages.tokenCount,
      providerUsed: advisorMessages.providerUsed,
      createdAt: advisorMessages.createdAt,
    })
    .from(advisorMessages)
    .innerJoin(advisorConversations, eq(advisorConversations.id, advisorMessages.conversationId))
    .where(
      and(
        eq(advisorMessages.conversationId, conversationId),
        eq(advisorConversations.userId, userId),
      ),
    )
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

export async function createConversation(userId: number, title = ""): Promise<number> {
  const inserted = await db
    .insert(advisorConversations)
    .values({ userId, title })
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
  // The message and the activity bump commit together.
  const [inserted] = await db.batch([
    db
      .insert(advisorMessages)
      .values({
        conversationId,
        role,
        content,
        tokenCount: opts?.tokenCount ?? 0,
        providerUsed: opts?.providerUsed ?? null,
      })
      .returning({ id: advisorMessages.id }),
    db
      .update(advisorConversations)
      .set({ updatedAt: new Date() })
      .where(eq(advisorConversations.id, conversationId)),
  ]);
  const id = inserted[0]?.id;
  if (!id) throw new Error("failed to append message");
  return id;
}

/**
 * A short title from the first user message: the first sentence, capped at
 * 60 chars.
 */
export function autoTitle(firstUserMsg: string): string {
  const trimmed = firstUserMsg.trim().replace(/\s+/g, " ");
  const cut = trimmed.split(/(?<=[.?!])\s/)[0] ?? trimmed;
  return cut.length > 60 ? `${cut.slice(0, 57)}…` : cut;
}

/**
 * Start a chat turn in ONE atomic batch: the conversation (when new), the
 * user's message, the activity bump, and the title when it is still empty.
 * Persisted before any LLM work, so a crash or a cancelled stream never loses
 * the user's message — and never leaves an empty, untitled conversation.
 *
 * `conversationId` must already be known to belong to `userId`; the update is
 * scoped to the user anyway. Returns the conversation id.
 */
export async function startTurn(
  userId: number,
  conversationId: number | null,
  text: string,
): Promise<number> {
  const title = autoTitle(text);
  const now = new Date();
  if (conversationId == null) {
    // A batch runs its statements in order on one connection, so
    // last_insert_rowid() is the conversation inserted just before.
    const [created] = await db.batch([
      db
        .insert(advisorConversations)
        .values({ userId, title, createdAt: now, updatedAt: now })
        .returning({ id: advisorConversations.id }),
      db
        .insert(advisorMessages)
        .values({ conversationId: sql`last_insert_rowid()`, role: "user", content: text }),
    ]);
    const id = created[0]?.id;
    if (!id) throw new Error("failed to create conversation");
    return id;
  }
  await db.batch([
    db.insert(advisorMessages).values({ conversationId, role: "user", content: text }),
    db
      .update(advisorConversations)
      .set({
        updatedAt: now,
        title: sql`case when ${advisorConversations.title} = '' then ${title} else ${advisorConversations.title} end`,
      })
      .where(
        and(eq(advisorConversations.id, conversationId), eq(advisorConversations.userId, userId)),
      ),
  ]);
  return conversationId;
}

export async function deleteConversation(userId: number, conversationId: number): Promise<void> {
  await db
    .delete(advisorConversations)
    .where(
      and(eq(advisorConversations.id, conversationId), eq(advisorConversations.userId, userId)),
    );
}
