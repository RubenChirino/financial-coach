"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastIcon,
  type ToastProps,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import * as React from "react";

/**
 * Global toast manager.
 *
 * Single root-level instance — no per-page provider — so any component, no
 * matter how deeply nested, can fire a toast via `useToast()` without having
 * to thread props or wrap a subtree.
 *
 * Lifecycle:
 *   - `toast({...})` pushes a record into a list.
 *   - Radix `<Toast>` renders each record; on `onOpenChange(false)` (timeout,
 *     swipe, close button) we drop it from the list so React doesn't keep it
 *     mounted forever.
 *   - Default duration: 4s — long enough to read a sentence, short enough not
 *     to pile up. Override per-call via `duration`.
 *
 * Why this and not `sonner`: avoid a new dependency for what's a thin wrapper
 * around `@radix-ui/react-toast`, which is already a transitive dep we ship.
 */

interface ToastRecord {
  id: number;
  title: string;
  description?: string;
  variant?: ToastProps["variant"];
  durationMs?: number;
}

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastProps["variant"];
  /** Override the default 4000 ms timeout. */
  durationMs?: number;
}

interface ToastApi {
  toast: (opts: ToastOptions) => void;
  /** Convenience helpers — common variants don't need to spell `variant:`. */
  success: (opts: Omit<ToastOptions, "variant">) => void;
  error: (opts: Omit<ToastOptions, "variant">) => void;
  info: (opts: Omit<ToastOptions, "variant">) => void;
}

const ToastApiContext = React.createContext<ToastApi | null>(null);

let counter = 0;

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastRecord[]>([]);

  const push = React.useCallback((opts: ToastOptions) => {
    counter += 1;
    const id = counter;
    setItems((prev) => [...prev, { id, ...opts }]);
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (o) => push({ ...o, variant: "success" }),
      error: (o) => push({ ...o, variant: "error" }),
      info: (o) => push({ ...o, variant: "default" }),
    }),
    [push],
  );

  return (
    <ToastApiContext.Provider value={api}>
      <ToastProvider swipeDirection="right" duration={4000}>
        {children}
        {items.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            duration={t.durationMs}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
          >
            <ToastIcon variant={t.variant} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <ToastTitle>{t.title}</ToastTitle>
              {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastApiContext.Provider>
  );
}

/**
 * Imperative toast API. Throws if used outside `<Toaster>` — silent no-ops
 * tend to mask real bugs (the test passed, but the user saw nothing).
 */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastApiContext);
  if (!ctx) {
    throw new Error("useToast() must be used within <Toaster>");
  }
  return ctx;
}
