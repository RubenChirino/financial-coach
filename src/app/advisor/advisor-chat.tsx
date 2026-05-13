"use client";

import { ChatMessageContent, chatBubbleClass } from "@/components/advisor/chat-message";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  type ProviderState,
  deleteConversationAction,
  grantCloudLlmConsentAction,
} from "@/lib/advisor/actions";
import type { ConversationSummary } from "@/lib/advisor/conversations";
import type { ChatContextSnapshot } from "@/lib/advisor/digest";
import { cn } from "@/lib/utils";
import { useChat } from "ai/react";
import {
  ArrowLeftRight,
  Landmark,
  MessageCirclePlus,
  PieChart,
  Repeat,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

interface Labels {
  empty: string;
  placeholder: string;
  send: string;
  sending: string;
  stop: string;
  newChat: string;
  deleteChat: string;
  confirmDelete: string;
  consentTitle: string;
  consentBody: string;
  consentAccept: string;
  consentCancel: string;
  errorRequest: string;
  /** Chat-redesign only — wrapped from advisor.chat.* keys. */
  contextOn: string;
  tryAsking: string;
  encrypted: string;
  online: string;
  coachName: string;
  conversationsHeading: string;
}

interface Props {
  locale: "es" | "en";
  conversations: ConversationSummary[];
  activeConversationId: number | null;
  initialMessages: { id: string; role: "system" | "user" | "assistant"; content: string }[];
  providerState: ProviderState;
  labels: Labels;
  context: ChatContextSnapshot;
  /** Localized "try asking" suggestion strings. */
  suggestions: string[];
}

export function AdvisorChat(props: Props) {
  const tChat = useTranslations("advisor.chat");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [conversationId, setConversationId] = useState<number | null>(props.activeConversationId);
  const [showConsent, setShowConsent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingDelete, startDelete] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    api: "/api/advisor/chat",
    id: String(conversationId ?? "new"),
    initialMessages: props.initialMessages.filter((m) => m.role !== "system") as never,
    body: { conversationId },
    onResponse(response) {
      if (response.status === 403) {
        setShowConsent(true);
        return;
      }
      const newId = response.headers.get("X-Conversation-Id");
      if (newId && conversationId == null) {
        const n = Number(newId);
        if (Number.isFinite(n)) {
          setConversationId(n);
          const url = new URL(window.location.href);
          url.searchParams.set("c", String(n));
          url.searchParams.set("tab", "chat");
          window.history.replaceState({}, "", url.toString());
        }
      }
    },
    onError() {
      setErrorMsg(props.labels.errorRequest);
    },
    onFinish() {
      router.refresh();
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on new message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (props.providerState.consentNeeded) {
      setShowConsent(true);
      return;
    }
    chat.handleSubmit(e);
  }

  function sendSuggestion(text: string) {
    setErrorMsg(null);
    if (props.providerState.consentNeeded) {
      setShowConsent(true);
      return;
    }
    chat.append({ role: "user", content: text });
  }

  async function handleConsent() {
    const res = await grantCloudLlmConsentAction();
    if (res.ok) {
      setShowConsent(false);
      router.refresh();
    }
  }

  async function handleDelete(id: number) {
    const ok = await confirm({
      title: props.labels.deleteChat,
      description: props.labels.confirmDelete,
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    startDelete(async () => {
      await deleteConversationAction(id);
      if (id === conversationId) {
        setConversationId(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("c");
        window.history.replaceState({}, "", url.toString());
        chat.setMessages([]);
      }
      toast.success({ title: tCommon("success") });
      router.refresh();
    });
  }

  const ctx = props.context;
  const contextRows: { Icon: typeof Landmark; label: string }[] = [
    { Icon: Landmark, label: tChat("contextAccounts", { count: ctx.accountCount }) },
    { Icon: ArrowLeftRight, label: tChat("contextTransactions", { count: ctx.txCount }) },
    { Icon: PieChart, label: tChat("contextBudgets", { count: ctx.budgetCount }) },
    { Icon: Repeat, label: tChat("contextSubs", { count: ctx.subscriptionCount }) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] h-[calc(100dvh-14rem)]">
      {/* Left: context panel + conversations */}
      <aside className="coin-card flex flex-col p-4 overflow-y-auto">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)] mb-2.5">
          {props.labels.contextOn}
        </div>
        <ul className="space-y-1.5">
          {contextRows.map((r) => (
            <li
              key={r.label}
              className="flex items-center gap-2.5 rounded-lg bg-[color:var(--surface-app)] px-2.5 py-2 text-[12.5px] font-medium"
            >
              <r.Icon className="h-3.5 w-3.5 text-[color:var(--text-secondary)]" />
              <span className="truncate">{r.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
          {props.labels.tryAsking}
        </div>
        <ul className="space-y-1.5">
          {props.suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => sendSuggestion(s)}
                disabled={chat.isLoading}
                className="w-full rounded-lg border border-[color:var(--border-default)] px-3 py-2 text-left text-[12.5px] text-[color:var(--text-primary)] transition-colors hover:border-[color:var(--brand-primary-border)] hover:bg-[color:var(--brand-primary-soft)] disabled:opacity-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>

        {props.conversations.length > 0 ? (
          <>
            <div className="mt-5 mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {props.labels.conversationsHeading}
            </div>
            <ul className="space-y-1">
              {props.conversations.map((c) => {
                const active = c.id === conversationId;
                return (
                  <li key={c.id} className="group flex items-center gap-1">
                    <Link
                      href={`/advisor?tab=chat&c=${c.id}`}
                      className={cn(
                        "flex-1 truncate rounded-md px-2.5 py-1.5 text-[12.5px]",
                        active
                          ? "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)] font-medium"
                          : "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-app)]",
                      )}
                      title={c.title}
                    >
                      {c.title || "(new)"}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={pendingDelete}
                      aria-label={props.labels.deleteChat}
                      className="opacity-0 group-hover:opacity-100 text-[color:var(--text-tertiary)] hover:text-rose-500 px-1 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        <Link
          href="/advisor?tab=chat"
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border-default)] px-3 py-2 text-[12.5px] font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--surface-app)]"
        >
          <MessageCirclePlus className="h-3.5 w-3.5" />
          {props.labels.newChat}
        </Link>

        <div className="mt-auto pt-4 flex items-center gap-1.5 text-[11px] text-[color:var(--text-tertiary)]">
          <ShieldCheck className="h-3 w-3" />
          {props.labels.encrypted}
        </div>
      </aside>

      {/* Right: chat surface */}
      <section className="coin-card flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-2.5 border-b border-[color:var(--border-default)] px-5 py-3.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: "linear-gradient(135deg, #5389FF, #FFD1DC)" }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold">{props.labels.coachName}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-tertiary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {props.labels.online}
            </div>
          </div>
        </header>

        {/* Stream */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {chat.messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-sm text-[13px] text-[color:var(--text-secondary)]">
                {props.labels.empty}
              </p>
            </div>
          ) : (
            chat.messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role !== "user" ? (
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: "linear-gradient(135deg, #5389FF, #FFD1DC)" }}
                    aria-hidden
                  >
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </div>
                ) : null}
                <div className={chatBubbleClass(m.role)}>
                  <ChatMessageContent content={m.content} role={m.role} />
                </div>
              </div>
            ))
          )}
          {chat.isLoading && chat.messages[chat.messages.length - 1]?.role === "user" ? (
            <div className="flex gap-2.5">
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: "linear-gradient(135deg, #5389FF, #FFD1DC)" }}
                aria-hidden
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-[color:var(--surface-app)] px-4 py-2.5">
                <div className="flex gap-1" aria-label="typing">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--text-tertiary)] [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--text-tertiary)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--text-tertiary)] [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          ) : null}
          {errorMsg ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300">
              {errorMsg}
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t border-[color:var(--border-default)] p-3"
        >
          <textarea
            value={chat.input}
            onChange={chat.handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (chat.input.trim()) {
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            placeholder={props.labels.placeholder}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]"
            disabled={chat.isLoading}
          />
          {chat.isLoading ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => chat.stop()}
              aria-label={props.labels.stop}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!chat.input.trim()}
              aria-label={props.labels.send}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </section>

      {showConsent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
          <div className="mx-4 w-full max-w-md coin-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{props.labels.consentTitle}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-[color:var(--text-secondary)]">
              {props.labels.consentBody.replace(
                "{provider}",
                `${props.providerState.provider} (${props.providerState.model})`,
              )}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowConsent(false)}>
                {props.labels.consentCancel}
              </Button>
              <Button onClick={handleConsent}>{props.labels.consentAccept}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
