"use client";

import * as React from "react";
import { useToast } from "@/components/toaster";

/**
 * Fire a toast once when this component mounts.
 *
 * Useful for triggering a toast from a server-rendered page without making
 * the whole page client. Drop one of these into the page tree, give it
 * stable props, and the toast fires on the first client render and never
 * again — even across React Strict Mode's intentional double-mount in dev.
 *
 * Why a separate component: the toast `useToast` hook is client-only, but
 * server pages can compose this around server-fetched data and pass strings
 * down as props. Keeps the rest of the page free of `"use client"`.
 */
export function ToastOnMount({
  title,
  description,
  variant = "default",
}: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
}) {
  const toast = useToast();
  const fired = React.useRef(false);

  // Intentionally only on mount — the toast itself is fire-and-forget; updating
  // its content later isn't supported.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast.toast({ title, description, variant });
  }, []);

  return null;
}
