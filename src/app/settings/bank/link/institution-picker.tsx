"use client";

import { ArrowRight, Check, Eye, Landmark, Loader2, Search, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { startBankLinkAction } from "@/lib/gocardless/actions";
import type { Institution } from "@/lib/gocardless/types";
import { cn } from "@/lib/utils";

const COUNTRIES: { code: string; labelKey: string }[] = [
  { code: "ES", labelKey: "ES" },
  { code: "PT", labelKey: "PT" },
  { code: "FR", labelKey: "FR" },
  { code: "DE", labelKey: "DE" },
  { code: "IT", labelKey: "IT" },
  { code: "NL", labelKey: "NL" },
  { code: "GB", labelKey: "GB" },
  { code: "IE", labelKey: "IE" },
];

type Step = "pick" | "confirm";

export function InstitutionPicker({
  institutions,
  initialCountry,
}: {
  institutions: Institution[];
  initialCountry: string;
}) {
  const t = useTranslations("bank");
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Institution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return institutions;
    return institutions.filter((i) => i.name.toLowerCase().includes(q));
  }, [institutions, query]);

  function changeCountry(code: string) {
    const next = new URLSearchParams(params.toString());
    next.set("country", code);
    router.push(`/settings/bank/link?${next.toString()}`);
  }

  function pickInstitution(inst: Institution) {
    setSelected(inst);
    setError(null);
    setStep("confirm");
  }

  function connect() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await startBankLinkAction(selected.id);
      if (!res.ok || !res.data) {
        setError(res.ok ? "missingLink" : res.error);
        return;
      }
      window.location.href = res.data.link;
    });
  }

  if (step === "confirm" && selected) {
    return (
      <div className="coin-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--surface-app)]">
            {selected.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.logo} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-sm font-semibold text-[color:var(--text-secondary)]">
                {selected.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold">{selected.name}</div>
            <div className="text-[11.5px] text-[color:var(--text-tertiary)]">
              {t("openBankingSecure")}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
          {t.rich("confirmBody", {
            bank: selected.name,
            strong: (chunks) => (
              <strong className="text-[color:var(--text-primary)]">{chunks}</strong>
            ),
          })}
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {[
            { Icon: Eye, label: t("permRead"), deny: false },
            { Icon: Search, label: t("permHistory"), deny: false },
            { Icon: XCircle, label: t("permNoMove"), deny: true },
          ].map((x) => (
            <li
              key={x.label}
              className="flex items-center gap-2.5 rounded-lg bg-[color:var(--surface-app)] px-3 py-2.5 text-[12.5px]"
            >
              <x.Icon
                className="h-3.5 w-3.5"
                style={{ color: x.deny ? "#DC2626" : "#059669" }}
                aria-hidden
              />
              <span className={x.deny ? "text-[color:var(--text-secondary)]" : undefined}>
                {x.label}
              </span>
            </li>
          ))}
        </ul>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setStep("pick");
            }}
            disabled={isPending}
            className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--surface-app)] disabled:opacity-50"
          >
            {t("back")}
          </button>
          <button
            type="button"
            onClick={connect}
            disabled={isPending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {t("continueTo", { bank: selected.name })}
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="coin-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]">
            <Landmark className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[15px] font-semibold">{t("connectNewAccount")}</div>
            <div className="mt-0.5 text-[11.5px] text-[color:var(--text-tertiary)]">
              {t("stepOf", { step: 1, total: 2 })} · {t("openBankingSecure")}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-tertiary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] pl-9 pr-3 py-2.5 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>
          <select
            className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2.5 text-[13px]"
            defaultValue={initialCountry}
            onChange={(e) => changeCountry(e.target.value)}
            aria-label={t("country")}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.labelKey}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bank grid */}
      {filtered.length === 0 ? (
        <div className="coin-card p-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
          {t("noInstitutions")}
        </div>
      ) : (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
            {t("popularInCountry", { country: initialCountry })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => pickInstitution(inst)}
                disabled={isPending}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-3 text-left transition-colors",
                  "hover:border-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-soft)]",
                  "disabled:opacity-50",
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[color:var(--surface-app)]">
                  {inst.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={inst.logo} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs font-semibold text-[color:var(--text-secondary)]">
                      {inst.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{inst.name}</div>
                  <div className="text-[11px] text-[color:var(--text-tertiary)]">
                    {inst.transaction_total_days}{" "}
                    {Number(inst.transaction_total_days) === 1 ? t("day") : t("days")}
                  </div>
                </div>
                <Check
                  className="h-4 w-4 text-[color:var(--brand-primary)] opacity-0 transition-opacity"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
