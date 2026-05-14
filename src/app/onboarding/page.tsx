import { OnboardingFlow } from "@/app/onboarding/flow";
import { userExists } from "@/lib/auth/user";
import { env } from "@/lib/env";
import { getLocale } from "@/lib/i18n/locale";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  // In oauth mode /onboarding is never shown — users sign in via Google/Microsoft
  // and are provisioned automatically. Guard this route so direct navigation
  // doesn't break the flow.
  if (env().AUTH_MODE === "oauth") redirect("/lock");
  if (await userExists()) redirect("/lock");

  const [tApp, tOnb, tCommon, locale] = await Promise.all([
    getTranslations("app"),
    getTranslations("onboarding"),
    getTranslations("common"),
    getLocale(),
  ]);

  const dict = {
    app: { name: tApp("name"), tagline: tApp("tagline") },
    welcome: {
      title: tOnb("welcome.title"),
      subtitle: tOnb("welcome.subtitle"),
    },
    language: {
      title: tOnb("language.title"),
      subtitle: tOnb("language.subtitle"),
      spanish: tOnb("language.spanish"),
      english: tOnb("language.english"),
    },
    languageCaption: tOnb("languageCaption"),
    pin: {
      setTitle: tOnb("pin.setTitle"),
      setSubtitle: tOnb("pin.setSubtitle"),
      confirmTitle: tOnb("pin.confirmTitle"),
      confirmSubtitle: tOnb("pin.confirmSubtitle"),
      mismatch: tOnb("pin.mismatch"),
    },
    done: {
      title: tOnb("done.title"),
      subtitle: tOnb("done.subtitle"),
      goDashboard: tOnb("done.goDashboard"),
    },
    common: { continue: tCommon("continue"), back: tCommon("back") },
  };

  return <OnboardingFlow dict={dict} initialLocale={locale} />;
}
