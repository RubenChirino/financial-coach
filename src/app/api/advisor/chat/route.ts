import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { buildAdvisorContext } from "@/lib/advisor/context";
import {
  appendMessage,
  getConversationMessages,
  startTurn,
  userOwnsConversation,
} from "@/lib/advisor/conversations";
import { buildSystemPrompt } from "@/lib/advisor/prompt";
import { getCurrentSession } from "@/lib/auth/session";
import {
  CloudConsentRequired,
  type LlmHandle,
  LlmRateLimited,
  resolveModelForUser,
} from "@/lib/llm/gateway";
import { guardCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The v5 client posts `UIMessage`s, whose text lives in a typed `parts` array
 * rather than a `content` string. We only ever need the newest user turn — the
 * rest of the history is re-read from the DB, which is the source of truth.
 */
interface ChatBody {
  conversationId?: number;
  messages: {
    role: "user" | "assistant";
    parts?: { type: string; text?: string }[];
    /** v4 shape. Tolerated so a stale open tab mid-deploy still works. */
    content?: string;
  }[];
}

function textOf(message: ChatBody["messages"][number]): string {
  if (typeof message.content === "string") return message.content;
  return (message.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/**
 * Streaming chat endpoint for the financial coach.
 *
 * Flow per request:
 *   1. Auth check via session cookie. No session → 401.
 *   2. The gateway resolves the user's model: a cloud provider without consent
 *      → 403 `cloudConsentRequired` (the UI shows the consent dialog, then
 *      retries); over the chat quota → 429. Both before any body parsing.
 *   3. Build a *fresh* `AdvisorContext` (redacted aggregates) per request. We don't
 *      cache it — the user's data may have changed since the last turn.
 *   4. Persist the user's new message immediately (so refresh-mid-stream still
 *      keeps it). The assistant's reply is persisted in `onFinish` once streaming
 *      completes.
 *   5. Stream the response via the AI SDK's data-stream protocol so the React
 *      `useChat` hook can render tokens as they arrive.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // CSRF: a cross-site form submission would otherwise rack up paid LLM calls
  // and persist messages under the victim's account.
  const csrf = guardCsrf(req);
  if (csrf) return csrf;

  const session = await getCurrentSession();
  if (!session) return new Response("unauthenticated", { status: 401 });
  // Chat persists conversation rows — not allowed for read-only guests.
  if (session.isGuest) {
    return new Response(JSON.stringify({ error: "guestReadOnly" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const user = await db.query.users.findFirst({
    columns: { language: true },
    where: eq(users.id, session.userId),
  });
  if (!user) return new Response("user not found", { status: 401 });

  // Consent and the per-user chat quota (gateway policy "chat") are checked
  // before the body is read or anything is persisted.
  let llm: LlmHandle;
  try {
    llm = await resolveModelForUser(session.userId, "chat");
  } catch (err) {
    if (err instanceof CloudConsentRequired) {
      return Response.json({ error: err.code }, { status: 403 });
    }
    if (err instanceof LlmRateLimited) {
      return Response.json(
        { error: err.code },
        { status: 429, headers: { "retry-after": String(Math.ceil(err.retryAfterMs / 1000)) } },
      );
    }
    throw err;
  }

  // Bound the request body before parsing. 256 KB is generous for a chat turn
  // (≈100k chars). A missing Content-Length is rejected rather than defaulted
  // to 0: `fetch` always sets it for the string bodies our client sends, so the
  // only callers without one are hand-rolled chunked uploads — exactly the
  // shape that would otherwise stream an unbounded body straight into
  // `req.json()` and past this check.
  const rawLength = req.headers.get("content-length");
  const contentLength = Number(rawLength);
  if (rawLength == null || !Number.isFinite(contentLength) || contentLength > 256 * 1024) {
    return new Response("payload too large", { status: 413 });
  }
  const body = (await req.json()) as ChatBody;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("missing messages", { status: 400 });
  }
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? textOf(lastUser) : "";
  if (!lastUserText.trim()) {
    return new Response("missing user message", { status: 400 });
  }

  // Resolve the target conversation. A client-supplied id must belong to this
  // user — otherwise an attacker could append to (and read) someone else's
  // conversation. Reject mismatches rather than silently forking.
  if (
    body.conversationId != null &&
    !(await userOwnsConversation(session.userId, body.conversationId))
  ) {
    return new Response("not found", { status: 404 });
  }

  // Persist the inbound user message (and the conversation, when new) before
  // any LLM work, in one batch, so a crash or a cancelled stream loses nothing.
  const conversationId = await startTurn(session.userId, body.conversationId ?? null, lastUserText);

  // History from DB is the source of truth (the client may be out of sync after
  // refresh). We pass the full history every turn — at typical sizes this fits
  // easily in the context window.
  const persisted = await getConversationMessages(session.userId, conversationId);
  const language = user.language === "en" ? "en" : "es";
  const ctx = await buildAdvisorContext({ monthsBack: 3, userId: session.userId });
  const instructions = buildSystemPrompt(language, ctx);

  const { info } = llm;
  const result = llm.streamText({
    // v7 renamed `system` to `instructions` and `onFinish` to `onEnd`. The old
    // names still work as deprecated aliases; using the current ones keeps the
    // next major from breaking silently.
    instructions,
    messages: persisted
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.4,
    onEnd: async ({ text, usage }) => {
      try {
        await appendMessage(conversationId, "assistant", text, {
          tokenCount: usage?.totalTokens ?? 0,
          providerUsed: `${info.provider}:${info.model}`,
        });
      } catch (err) {
        console.warn("failed to persist assistant message", err);
      }
    },
  });

  // v5 renamed the data-stream protocol to the UI-message stream; the client
  // hook consumes it the same way.
  const response = result.toUIMessageStreamResponse();
  // Surface the conversation ID so the client can save it for follow-up turns.
  response.headers.set("X-Conversation-Id", String(conversationId));
  return response;
}
