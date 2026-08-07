import "server-only";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./config";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const defaultLocale = process.env.DEFAULT_LOCALE;
  return isLocale(defaultLocale) ? defaultLocale : "es";
}

export async function setLocale(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
