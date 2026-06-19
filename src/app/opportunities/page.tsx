import { AppShell } from "@/components/app-shell";
import { TourButton } from "@/components/tour-button";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import {
  type Opportunity,
  type OpportunityKind,
  buildOpportunities,
} from "@/lib/opportunities/opportunities";
import { getInvestorProfile } from "@/lib/opportunities/profile";
import {
  AlertCircle,
  Check,
  Lightbulb,
  PiggyBank,
  Repeat,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm, type ProfileFormLabels } from "./profile-form";

export const dynamic = "force-dynamic";

const ICONS: Record<OpportunityKind, typeof Sparkles> = {
  subscription_overlap: Repeat,
  category_overspend: AlertCircle,
  goal_projection: Target,
  savings_runway: PiggyBank,
  emergency_gap: TrendingUp,
};

export default async function OpportunitiesPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/lock");

  const [t, locale, accountsTotal, profile] = await Promise.all([
    getTranslations("opportunities"),
    getLocale(),
    getAccountsTotal(session.userId),
    getInvestorProfile(session.userId),
  ]);
  const intlLocale = locale === "en" ? "en-US" : "es-ES";
  const fmt = (cents: number) => formatAmount(cents, accountsTotal.currency, intlLocale);
  const fmtMonth = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(d);

  const opportunities = await buildOpportunities({
    userId: session.userId,
    fmt,
    fmtMonth,
    labels: {
      subOverlapTitle: t("subOverlapTitle"),
      subOverlapBody: t("subOverlapBody"),
      overspendTitle: t("overspendTitle"),
      overspendBody: t("overspendBody"),
      goalProjectionTitle: t("goalProjectionTitle"),
      goalProjectionBodyWithDeadline: t("goalProjectionWithDeadline"),
      goalProjectionBodyOpenEnded: t("goalProjectionOpenEnded"),
      goalProjectionStalled: t("goalProjectionStalled"),
      savingsRunwayTitle: t("savingsRunwayTitle"),
      savingsRunwayBody: t("savingsRunwayBody"),
      savingsRunwayDeficit: t("savingsRunwayDeficit"),
      emergencyTitle: t("emergencyTitle"),
      emergencyBody: t("emergencyBody"),
      noOpportunities: t("noOpportunities"),
    },
  });

  const profileLabels: ProfileFormLabels = {
    intro: t("profileIntro"),
    saveButton: t("profileSave"),
    saving: t("profileSaving"),
    saved: t("profileSaved"),
    noteLabel: t("profileNoteLabel"),
    notePlaceholder: t("profileNotePlaceholder"),
    errorGeneric: t("profileError"),
    questions: {
      ageRange: t("qAgeRange"),
      horizon: t("qHorizon"),
      riskTolerance: t("qRiskTolerance"),
      emergencyFundMonths: t("qEmergencyFund"),
      dependents: t("qDependents"),
      primaryGoal: t("qPrimaryGoal"),
    },
    ageRange: {
      under_25: t("ageUnder25"),
      "25_34": t("age25_34"),
      "35_44": t("age35_44"),
      "45_54": t("age45_54"),
      "55_64": t("age55_64"),
      "65_plus": t("age65Plus"),
    },
    horizon: {
      under_1y: t("horizonUnder1y"),
      "1_3y": t("horizon1_3y"),
      "3_7y": t("horizon3_7y"),
      "7_15y": t("horizon7_15y"),
      over_15y: t("horizonOver15y"),
    },
    riskTolerance: {
      sell_all: t("riskSellAll"),
      sell_some: t("riskSellSome"),
      hold: t("riskHold"),
      buy_more: t("riskBuyMore"),
    },
    emergencyFundMonths: {
      none: t("emergencyNone"),
      under_3: t("emergencyUnder3"),
      "3_6": t("emergency3_6"),
      over_6: t("emergencyOver6"),
    },
    dependents: {
      none: t("depNone"),
      "1_2": t("dep1_2"),
      "3_plus": t("dep3Plus"),
    },
    primaryGoal: {
      emergency_fund: t("goalEmergency"),
      house: t("goalHouse"),
      retirement: t("goalRetirement"),
      education: t("goalEducation"),
      freedom: t("goalFreedom"),
      other: t("goalOther"),
    },
  };

  return (
    <AppShell title={t("title")} subtitle={t("subtitle")}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("heading")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("explainer")}
            </p>
          </div>
          <TourButton
            label={locale === "es" ? "¿Cómo funciona?" : "How it works"}
            steps={[
              {
                title: locale === "es" ? "Crecimiento y Oportunidades" : "Growth & Opportunities",
                description:
                  locale === "es"
                    ? "Esta página tiene dos partes: oportunidades de ahorro detectadas automáticamente a partir de tus datos, y un perfil inversor que personaliza las respuestas del Coach IA."
                    : "This page has two parts: savings opportunities detected automatically from your data, and an investor profile that personalises the AI Coach's responses.",
              },
              {
                element: "#opp-list",
                title:
                  locale === "es" ? "Tus oportunidades de ahorro" : "Your savings opportunities",
                description:
                  locale === "es"
                    ? "Cada tarjeta muestra un ahorro concreto calculado con tus números reales: suscripciones solapadas, categorías que superan el presupuesto, proyecciones de objetivos y más. Pulsa 'Abrir' para ir a la sección relevante."
                    : "Each card shows a concrete saving calculated from your real numbers: overlapping subscriptions, over-budget categories, goal projections, and more. Click 'Open' to jump to the relevant section.",
                side: "bottom",
              },
              {
                element: "#opp-profile",
                title: locale === "es" ? "Tu perfil inversor" : "Your investor profile",
                description:
                  locale === "es"
                    ? "Responde 6 preguntas rápidas (rango de edad, horizonte temporal, tolerancia al riesgo…). El Coach IA las usa para adaptar sus consejos a tu situación concreta. Tus respuestas se guardan solo en este dispositivo."
                    : "Answer 6 quick questions (age range, time horizon, risk tolerance…). The AI Coach uses them to tailor advice to your specific situation. Your answers are stored only on this device.",
                side: "top",
              },
              {
                element: "#opp-disclaimer",
                title: locale === "es" ? "Nota importante" : "Important note",
                description:
                  locale === "es"
                    ? "Estas sugerencias son orientación educativa, no asesoramiento financiero regulado. Nunca recomendamos productos específicos (fondos, acciones, planes)."
                    : "These suggestions are educational planning guidance, not regulated financial advice. We never recommend specific products (funds, stocks, pension plans).",
                side: "top",
              },
            ]}
          />
        </header>

        {/* Opportunities */}
        <section id="opp-list" className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-[color:var(--brand-primary)]" />
            <h2 className="text-base font-semibold tracking-tight">{t("opportunitiesTitle")}</h2>
          </div>
          {opportunities.length === 0 ? (
            <div className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-6 text-center">
              <Check className="mx-auto h-6 w-6 text-emerald-500" />
              <p className="mt-2 text-[13px] text-[color:var(--text-secondary)]">
                {t("noOpportunities")}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {opportunities.map((o, i) => (
                <OpportunityCard key={`${o.kind}-${i}`} opp={o} viewLabel={t("viewLabel")} />
              ))}
            </ul>
          )}
        </section>

        {/* Investor profile */}
        <section
          id="opp-profile"
          className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-5"
        >
          <header className="mb-4">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-[color:var(--brand-primary)]" />
              {t("profileTitle")}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("profileSubtitle")}
            </p>
          </header>
          <ProfileForm initial={profile} labels={profileLabels} />
        </section>

        <p
          id="opp-disclaimer"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[11.5px] text-[color:var(--text-secondary)]"
        >
          {t("disclaimer")}
        </p>
      </div>
    </AppShell>
  );
}

function OpportunityCard({ opp, viewLabel }: { opp: Opportunity; viewLabel: string }) {
  const Icon = ICONS[opp.kind] ?? Sparkles;
  return (
    <li className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--bg-elevated)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color:var(--brand-primary-soft)]">
          <Icon className="h-4 w-4 text-[color:var(--brand-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold leading-snug">{opp.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--text-secondary)]">
            {opp.body}
          </p>
          {opp.href ? (
            <Link
              href={opp.href}
              className="mt-2 inline-block text-[12px] font-medium text-[color:var(--brand-primary)] hover:underline"
            >
              {viewLabel} →
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
