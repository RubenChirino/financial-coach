import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PrivacyAmount } from "@/components/privacy-amount";
import { CityEditor } from "@/components/travels/city-editor";
import { TripRow } from "@/components/travels/trip-row";
import { getAdvisorProviderStateAction } from "@/lib/advisor/actions";
import { getCurrentSession } from "@/lib/auth/session";
import { getAccountsTotal } from "@/lib/dashboard/summary";
import { formatAmount } from "@/lib/format";
import { getLocale } from "@/lib/i18n/locale";
import { getCityLabels } from "@/lib/travels/city";
import { type Travel, listTravels } from "@/lib/travels/detect";
import { Plane } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Resolve the selected trip from `?id=`, falling back to the first (newest). */
function resolveSelected(travels: Travel[], id: string | undefined): Travel | null {
  if (id) {
    const match = travels.find((t) => t.tripKey === id);
    if (match) return match;
  }
  return travels[0] ?? null;
}

function formatRange(start: Date, end: Date, intlLocale: string): string {
  const sameDay = start.toDateString() === end.toDateString();
  const dm = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" });
  const dmy = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return sameDay ? dmy.format(start) : `${dm.format(start)} – ${dmy.format(end)}`;
}

export default async function TravelsPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>;
}) {
  if (!(await getCurrentSession())) redirect("/lock");
  const sp = (await searchParams) ?? {};

  const [t, tCommon, locale, travels, accountsTotal, providerState] = await Promise.all([
    getTranslations("travels"),
    getTranslations("common"),
    getLocale(),
    listTravels(),
    getAccountsTotal(),
    getAdvisorProviderStateAction(),
  ]);
  const intlLocale = locale === "en" ? "en-US" : "es-ES";
  const aiAvailable = !providerState.consentNeeded;

  const editorLabels = {
    cityLabel: t("city"),
    placeholder: t("cityPlaceholder"),
    guess: t("guessCity"),
    guessing: t("guessing"),
    save: tCommon("save"),
    saved: t("saved"),
    aiSourceNote: t("aiSourceNote"),
    consentNote: t("consentNote"),
  };

  if (travels.length === 0) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">
              {t("subtitle")}
            </p>
          </header>
          <EmptyState
            Icon={Plane}
            title={t("emptyTitle")}
            description={t("emptyBody", { currency: accountsTotal.currency })}
          />
        </div>
      </AppShell>
    );
  }

  const labels = await getCityLabels(travels.map((tr) => tr.tripKey));
  const selected = resolveSelected(travels, sp.id);
  if (!selected) redirect("/travels");

  const selectedLabel = labels.get(selected.tripKey) ?? null;
  const selectedCity = selectedLabel?.city ?? null;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-0.5 text-[12.5px] text-[color:var(--text-tertiary)]">{t("subtitle")}</p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          {/* Trip list */}
          <div className="coin-card min-w-0 p-2.5">
            <div className="flex items-center justify-between px-2.5 py-2.5">
              <h3 className="text-[14px] font-semibold">{t("allTrips")}</h3>
              <span className="text-[11.5px] text-[color:var(--text-tertiary)]">
                {t("tripCount", { count: travels.length })}
              </span>
            </div>
            <div className="space-y-0.5">
              {travels.map((trip) => {
                const city = labels.get(trip.tripKey)?.city ?? null;
                const range = formatRange(trip.startDate, trip.endDate, intlLocale);
                return (
                  <TripRow
                    key={trip.tripKey}
                    tripKey={trip.tripKey}
                    flag={trip.flag}
                    title={city ?? trip.country}
                    subtitle={city ? `${trip.country} · ${range}` : range}
                    totalFormatted={formatAmount(trip.totalSpentCents, trip.currency, intlLocale)}
                    metaLabel={t("payments", { count: trip.txCount })}
                    selected={trip.tripKey === selected.tripKey}
                  />
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div className="min-w-0 space-y-4">
            <div className="coin-card min-w-0 overflow-hidden p-5">
              <div className="flex items-center gap-3.5">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-app)] text-[24px]"
                  aria-hidden
                >
                  {selected.flag}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[18px] font-semibold tracking-[-0.01em]">
                    {selectedCity ?? selected.country}
                  </div>
                  <div className="text-[11.5px] text-[color:var(--text-tertiary)]">
                    {selectedCity ? `${selected.country} · ` : ""}
                    {formatRange(selected.startDate, selected.endDate, intlLocale)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {t("totalSpent")}
                  </div>
                  <div className="tnum mt-0.5 text-[18px] font-semibold">
                    <PrivacyAmount
                      value={formatAmount(selected.totalSpentCents, selected.currency, intlLocale)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {t("paymentsLabel")}
                  </div>
                  <div className="tnum mt-0.5 text-[18px] font-semibold">{selected.txCount}</div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[color:var(--text-tertiary)]">
                    {t("currency")}
                  </div>
                  <div className="mt-0.5 text-[18px] font-semibold">{selected.currency}</div>
                </div>
              </div>

              <hr className="my-5 border-t border-[color:var(--border-default)]" />

              <CityEditor
                key={selected.tripKey}
                tripKey={selected.tripKey}
                initialCity={selectedCity}
                initialSource={selectedLabel?.source ?? null}
                aiAvailable={aiAvailable}
                labels={editorLabels}
              />

              <hr className="my-5 border-t border-[color:var(--border-default)]" />

              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
                {t("paymentsHeading")}
              </div>
              <ul className="mt-2 divide-y divide-[color:var(--border-default)]">
                {selected.transactions.map((tx) => (
                  <li key={tx.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0 truncate text-[13px] font-medium">
                      {tx.merchantName ?? tx.rawDescription.slice(0, 48)}
                    </div>
                    <div className="text-[11px] text-[color:var(--text-tertiary)]">
                      {new Intl.DateTimeFormat(intlLocale, {
                        day: "2-digit",
                        month: "2-digit",
                      }).format(tx.bookingDate)}
                    </div>
                    <div className="tnum text-[13px] font-semibold whitespace-nowrap">
                      <PrivacyAmount
                        value={formatAmount(tx.amountCents, tx.currency, intlLocale)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <p className="px-1 text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
              {t("limitationNote", { currency: accountsTotal.currency })}
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
