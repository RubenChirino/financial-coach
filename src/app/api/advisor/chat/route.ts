import { streamText } from "ai";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { buildAdvisorContext } from "@/lib/advisor/context";
import {
  appendMessage,
  createConversation,
  getConversationMessages,
  maybeAutoTitle,
  userOwnsConversation,
} from "@/lib/advisor/conversations";
import { buildSystemPrompt } from "@/lib/advisor/prompt";
import { getCurrentSession } from "@/lib/auth/session";
import { getLanguageModel, providerInfo } from "@/lib/llm/provider";
import { guardCsrf } from "@/lib/security/csrf";
import { consumeQuota } from "@/lib/security/rate-limit";

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
 *   2. Cloud-consent gate: if provider != ollama and `cloudLlmConsentAt` is null → 403.
 *      The UI shows a consent dialog and POSTs to a separate consent action; only
 *      then is the chat call retried.
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

  // Rate limit BEFORE any DB read or LLM call. Caps per-user spend and
  // contains worst-case abuse (e.g. session theft) to a known ceiling.
  //
  // Window sizing rationale:
  //   - 20 chat turns / 60s is more than any human will sustain (one turn
  //     per ~3s including read time is already fast), so legitimate use is
  //     unaffected.
  //   - At 20/min the Gemini free tier (15 RPM globally) is still the
  //     binding limit if traffic ever concentrates, but this caps any
  //     SINGLE user from exhausting it for everyone else.
  const quota = consumeQuota(`chat:${session.userId}`, 20, 60_000);
  if (!quota.allowed) {
    return new Response(JSON.stringify({ error: "rateLimited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.ceil(quota.resetInMs / 1000)),
      },
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) return new Response("user not found", { status: 401 });

  const prefs = { provider: user.llmProvider, model: user.llmModel };
  const info = providerInfo(prefs);

  if (!info.isLocal && user.cloudLlmConsentAt == null) {
    return new Response(JSON.stringify({ error: "cloudConsentRequired" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
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
  let conversationId: number;
  if (body.conversationId != null) {
    if (!(await userOwnsConversation(session.userId, body.conversationId))) {
      return new Response("not found", { status: 404 });
    }
    conversationId = body.conversationId;
  } else {
    conversationId = await createConversation(session.userId, "");
  }

  // Persist the inbound user message before doing any LLM work, so we don't lose
  // it on a server crash or stream cancellation.
  await appendMessage(conversationId, "user", lastUserText);
  await maybeAutoTitle(conversationId, lastUserText);

  // History from DB is the source of truth (the client may be out of sync after
  // refresh). We pass the full history every turn — at typical sizes this fits
  // easily in the context window.
  const persisted = await getConversationMessages(session.userId, conversationId);
  const language = user.language === "en" ? "en" : "es";
  const ctx = await buildAdvisorContext({ monthsBack: 3, userId: session.userId });
  const instructions = buildSystemPrompt(language, ctx);

  const { model } = getLanguageModel(prefs);

  const result = streamText({
    model,
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
