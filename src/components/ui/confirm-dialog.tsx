"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Info } from "lucide-react";
import * as React from "react";

/**
 * Programmatic confirmation dialog with the same look as the rest of the app.
 *
 * Replaces the native `window.confirm()`, which:
 *   - looks like a 1998 system alert,
 *   - blocks the JS thread,
 *   - cannot be styled, internationalized correctly, or themed,
 *   - is sometimes suppressed by browsers when fired in async handlers.
 *
 * Usage:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: t("delete.title"),
 *     description: t("delete.body"),
 *     confirmLabel: t("delete.confirm"),
 *     cancelLabel: t("common.cancel"),
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * Implementation: a single root-level instance held in context. Calling
 * `confirm()` opens the dialog and returns a promise that resolves to
 * `true` (confirmed) or `false` (cancelled / dismissed). The dialog is a
 * Radix `Dialog` so it traps focus, closes on Escape, and pushes the route
 * back on outside-click — same UX as native browser confirms but on-brand.
 */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button in the destructive variant. */
  danger?: boolean;
}

interface InternalState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<InternalState | null>(null);

  // Stable function — useCallback is important here because a fresh identity
  // every render would force every consumer to either ignore the dependency
  // (lint warning) or re-bind. The function captures `setState` only.
  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handleClose = React.useCallback(
    (ok: boolean) => {
      // Snapshot the resolver before clearing — Radix may fire onOpenChange
      // multiple times (Escape + close-button) and we don't want a double
      // resolve. The promise is one-shot so a re-resolve would silently noop,
      // but it's cleaner this way and avoids stale-state surprises.
      setState((prev) => {
        prev?.resolve(ok);
        return null;
      });
    },
    [],
  );

  const open = state !== null;
  const danger = state?.danger ?? false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          // onOpenChange(false) fires when the user dismisses (Escape, overlay
          // click, X button). Treat all of those as cancel.
          if (!o && state) handleClose(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div
                className={
                  danger
                    ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                    : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                }
                aria-hidden
              >
                {danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>{state?.title ?? ""}</DialogTitle>
                {state?.description ? (
                  <DialogDescription>{state.description}</DialogDescription>
                ) : null}
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              {state?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={danger ? "destructive" : "default"}
              onClick={() => handleClose(true)}
              autoFocus
            >
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns the `confirm()` function. Throws if used outside `ConfirmProvider`
 * — that's a programmer error and a silent fallback (e.g. `window.confirm`)
 * would defeat the whole point of having styled dialogs.
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() must be used within <ConfirmProvider>");
  }
  return ctx;
}
