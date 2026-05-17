import { CurrencyInitializer } from "@/components/currency-initializer";
import { PwaRegister } from "@/components/pwa-register";
import { RouteProgress } from "@/components/route-progress";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { getLocale } from "@/lib/i18n/locale";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { type ReactNode, Suspense } from "react";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://financial-coach-ai.vercel.app";
const SITE_TITLE = "Financial Coach";
const SITE_DESCRIPTION = "Local-first personal AI financial coach";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_TITLE,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
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
                {/* Top progress bar during route navigation. Wrapped in
                    Suspense because it calls `useSearchParams`, which Next
                    requires be Suspense-bound to avoid bailing the whole
                    tree out of static generation. */}
                <Suspense fallback={null}>
                  <RouteProgress />
                </Suspense>
                {children}
              </ConfirmProvider>
            </Toaster>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
