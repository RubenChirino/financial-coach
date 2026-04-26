import { type CoachTab, CoachTabs } from "@/components/advisor/coach-tabs";
import { DigestFeed } from "@/components/advisor/digest-feed";
import { AppShell } from "@/components/app-shell";
import { getAdvisorProviderStateAction } from "@/lib/advisor/actions";
import { getConversationMessages, listConversations } from "@/lib/advisor/conversations";
import {
  type ChatContextSnapshot,
  buildDigest,
  getChatContextSnapshot,
} from "@/lib/advisor/digest";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { listActiveInsights } from "@/lib/insights/engine";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AdvisorChat } from "./advisor-chat";

export const dynamic = "force-dynamic";

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams?: Promise<{ c?: string; tab?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");

  const sp = (await searchParams) ?? {};
  const activeTab: CoachTab = sp.tab === "chat" ? "chat" : "digest";

  const [t, tDigest, tChat, locale, providerState, accountsTotal] = await Promise.all([
    getTranslations("advisor"),
    getTranslations("advisor.digest"),
    getTranslations("advisor.chat"),
    getLocale(),
    getAdvisorProviderStateAction(),
    getAccountsTotal(),
  ]);
  const intlLocale = locale === "es" ? "es-ES" : "en-US";
  const currency = accountsTotal.currency;
  const fmt = (cents: number) => formatAmount(cents, currency, intlLocale);

  const tabs = (
    <CoachTabs
      active={activeTab}
      digestLabel={tChat("tabDigest")}
      chatLabel={tChat("tabChat")}
      preserveSearchParams={sp.c ? { c: sp.c } : undefined}
    />
  );

  if (activeTab === "digest") {
    const activeInsights = await listActiveInsights();
    // Severity-sorted: warning first, then info, then positive.
    const severityRank: Record<string, number> = { warning: 0, info: 1, positive: 2 };
    const topInsight = [...activeInsights].sort(
      (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9),
    )[0];

    const digest = await buildDigest(
      {
        headlineSaving: tDigest("headlineSaving"),
        headlineFlat: tDigest("headlineFlat"),
        headlineEmpty: tDigest("headlineEmpty"),
        itemReviewTitle: tDigest("itemReviewTitle"),
        itemReviewBody: tDigest("itemReviewBody"),
        itemReviewAction: tDigest("itemReviewAction"),
        itemSubsTitle: tDigest("itemSubsTitle"),
        itemSubsBody: tDigest("itemSubsBody"),
        itemSubsAction: tDigest("itemSubsAction"),
        itemTopCatTitle: tDigest("itemTopCatTitle"),
        itemTopCatBody: tDigest("itemTopCatBody"),
        itemTopCatAction: tDigest("itemTopCatAction"),
        itemAllGoodTitle: tDigest("itemAllGoodTitle"),
        itemAllGoodBody: tDigest("itemAllGoodBody"),
        itemAllGoodAction: tDigest("itemAllGoodAction"),
        statSavings: tDigest("statSavings"),
        statSubs: tDigest("statSubs"),
        statAlerts: tDigest("statAlerts"),
        statConfidence: tDigest("statConfidence"),
        confidenceLow: tDigest("confidenceLow"),
        confidenceMedium: tDigest("confidenceMedium"),
        confidenceHigh: tDigest("confidenceHigh"),
      },
      fmt,
    );

    const todayLabel = new Intl.DateTimeFormat(intlLocale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());

    return (
      <AppShell>
        <div className="mx-auto max-w-6xl">
          <header className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
              <p className="text-xs text-muted-foreground">
                {providerState.isLocal
                  ? t("providerLocal", { model: providerState.model })
                  : t("providerCloud", {
                      provider: providerState.provider,
                      model: providerState.model,
                    })}
              </p>
            </div>
          </header>
          {tabs}
          <DigestFeed
            digest={digest}
            todayLabel={todayLabel}
            topInsightId={topInsight?.id ?? null}
            strings={{
              eyebrow: tDigest("eyebrow"),
              brief: tDigest("brief"),
              discuss: tDigest("discuss"),
              markResolved: tDigest("markResolved"),
              markResolvedDone: tDigest("markResolvedDone"),
              markResolvedNone: tDigest("markResolvedNone"),
            }}
            emptyTitle={tDigest("emptyTitle")}
            emptyBody={tDigest("emptyBody")}
            emptyAction={tDigest("emptyAction")}
          />
        </div>
      </AppShell>
    );
  }

  // Chat tab
  const requestedId = sp.c ? Number(sp.c) : null;
  const safeRequested = requestedId && Number.isFinite(requestedId) ? requestedId : null;
  const [conversations, contextSnapshot] = await Promise.all([
    listConversations(),
    getChatContextSnapshot(),
  ]);
  const activeId = safeRequested ?? conversations[0]?.id ?? null;
  const activeMessages = activeId ? await getConversationMessages(activeId) : [];

  const context: ChatContextSnapshot = contextSnapshot;
  const suggestions = [tChat("suggestion1"), tChat("suggestion2"), tChat("suggestion3")];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-xs text-muted-foreground">
              {providerState.isLocal
                ? t("providerLocal", { model: providerState.model })
                : t("providerCloud", {
                    provider: providerState.provider,
                    model: providerState.model,
                  })}
            </p>
          </div>
        </header>
        {tabs}
        <AdvisorChat
          locale={locale}
          conversations={conversations}
          activeConversationId={activeId}
          initialMessages={activeMessages.map((m) => ({
            id: String(m.id),
            role: m.role,
            content: m.content,
          }))}
          providerState={providerState}
          context={context}
          suggestions={suggestions}
          labels={{
            empty: t("empty"),
            placeholder: t("placeholder"),
            send: t("send"),
            sending: t("sending"),
            stop: t("stop"),
            newChat: t("newChat"),
            deleteChat: t("deleteChat"),
            confirmDelete: t("confirmDelete"),
            consentTitle: t("consentTitle"),
            consentBody: t("consentBody"),
            consentAccept: t("consentAccept"),
            consentCancel: t("consentCancel"),
            errorRequest: t("errorRequest"),
            contextOn: tChat("contextOn"),
            tryAsking: tChat("tryAsking"),
            encrypted: tChat("encrypted"),
            online: tChat("online"),
            coachName: tChat("coachName"),
            conversationsHeading: tChat("conversationsHeading"),
          }}
        />
      </div>
    </AppShell>
  );
}
