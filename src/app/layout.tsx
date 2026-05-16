import { CurrencyInitializer } from "@/components/currency-initializer";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { getLocale } from "@/lib/i18n/locale";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financial Coach",
  description: "Local-first personal AI financial coach",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Per-request nonce produced by `src/middleware.ts`. Forwarded into
  // `next-themes` so its anti-FOUC inline `<script>` is allowed by the
  // strict CSP (`script-src 'self' 'nonce-...' 'strict-dynamic'`). Without
  // this, the script is blocked, hydration warnings appear, and the page
  // can flash the wrong theme.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Toaster>
              <ConfirmProvider>
                <CurrencyInitializer baseCurrency="EUR" />
                <PwaRegister />
                {children}
              </ConfirmProvider>
            </Toaster>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
