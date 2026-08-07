"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Chat bubble content.
 *
 * - User messages are rendered as-is with `whitespace-pre-wrap` so newlines
 *   survive (users can paste lists, numbers, etc. without needing Markdown).
 * - Assistant messages are rendered as Markdown with GFM (tables, lists,
 *   strikethrough) since LLMs routinely emit numbered lists, bold, and
 *   occasional tables. Links open in a new tab to avoid leaving the chat.
 *
 * The `prose` utility classes are avoided on purpose — we're inside a small
 * chat bubble and the Tailwind prose defaults are too generous (h1/h2 huge,
 * paragraphs with 1em margins). Instead we style each Markdown element with
 * a `components` override scaled to the chat bubble's 13.5 px base.
 */
export function ChatMessageContent({ content, role }: { content: string; role: string }) {
  if (role === "user") {
    return <div className="whitespace-pre-wrap break-words">{content}</div>;
  }

  return (
    <div className="chat-markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className="block whitespace-pre overflow-x-auto rounded-md bg-black/20 px-2 py-1.5 font-mono text-[12px]">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-md bg-black/20 p-2 last:mb-0">
              {children}
            </pre>
          ),
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-2 text-[15px] font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-2 text-[14px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-[13.5px] font-semibold first:mt-0">{children}</h3>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--brand-primary)] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-[color:var(--border-default)] pl-3 italic last:mb-0">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="min-w-full text-[12.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-[color:var(--border-default)] px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[color:var(--border-default)]/50 px-2 py-1">
              {children}
            </td>
          ),
          hr: () => <hr className="my-2 border-[color:var(--border-default)]" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const chatBubbleClass = (role: string) =>
  cn(
    "max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed",
    role === "user"
      ? "rounded-br-sm bg-[color:var(--brand-primary)] text-white"
      : "rounded-bl-sm bg-[color:var(--surface-app)] text-[color:var(--text-primary)]",
  );
