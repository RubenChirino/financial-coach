"use client";

import { cn } from "@/lib/utils";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { type VariantProps, cva } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import * as React from "react";

/**
 * Themed wrapper around Radix Toast.
 *
 * Surfaces use the same `--surface-card` / `--border-default` tokens as the
 * rest of the app. Variants:
 *  - default — neutral info card
 *  - success — green tinted border + check icon
 *  - error   — destructive tint + alert icon
 *
 * Sizing/positioning is fixed in `ToastViewport` rather than being prop-driven
 * because the app only uses one viewport at a time. If we ever need a second
 * (e.g. anchored to an in-page element) we can take props then — premature
 * abstraction otherwise.
 */

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      // Top-right on desktop, full-width pinned to top on mobile so toasts
      // don't fight with the bottom tab bar / pull-to-refresh affordance.
      "fixed top-4 right-4 z-[100] flex max-h-screen w-full max-w-sm flex-col-reverse gap-2 p-2 outline-none sm:right-4 sm:top-4",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-4 pr-8 shadow-lg backdrop-blur-sm transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=open]:fade-in-0",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--border-default)] bg-[color:var(--surface-card)] text-foreground",
        success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
        error: "border-destructive/40 bg-destructive/10 text-destructive-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = React.forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  ),
);
Toast.displayName = ToastPrimitive.Root.displayName;

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    aria-label="Close"
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/60 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = ToastPrimitive.Close.displayName;

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold leading-tight", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-xs leading-snug opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

/** Icon shown to the left of the toast text, matched to the variant. */
export function ToastIcon({ variant }: { variant: ToastProps["variant"] }) {
  if (variant === "success") {
    return (
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }
  if (variant === "error") {
    return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />;
  }
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />;
}
