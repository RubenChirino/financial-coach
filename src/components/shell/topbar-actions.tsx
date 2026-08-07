"use client";
import { Eye, EyeOff, Loader2, Lock, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { lockAction } from "@/lib/auth/actions";
import { useCurrencyStore } from "@/lib/currency/store";
import { usePrivacy } from "@/lib/privacy/use-privacy";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "./notifications-bell";

/**
 * Right-side cluster of the topbar: EUR/USD currency toggle, search affordance
 * with ⌘K hint, privacy (blur balances) toggle, notifications, lock.
 *
 * In Phase 7b all of these are client-local state. Persistence (currency,
 * privacy) lands in Phase 7i alongside the preferences column. The search
 * input + ⌘K are visual-only until the command-palette ships later.
 *
 * `hasData` gates the two money-dependent affordances. On an account with no
 * bank and no transactions there is nothing to convert and nothing to search,
 * so they are hidden rather than shown as dead ends. That covers the currency
 * toggle, the search, and the privacy (blur balances) toggle — with no
 * balances rendered there is nothing to blur. Notifications and lock stay:
 * both are meaningful from the first render.
 */
interface TopbarActionsProps {
  /** False when the user has neither an account nor a transaction yet. */
  hasData: boolean;
}

export function TopbarActions({ hasData }: TopbarActionsProps) {
  const t = useTranslations("shell");
  const { displayCurrency, fetching, setDisplayCurrency } = useCurrencyStore();
  const [privacy, togglePrivacy] = usePrivacy();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search input
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = searchValue.trim();
    if (!q) return;
    router.push(`/transactions?q=${encodeURIComponent(q)}`);
    setSearchValue("");
    inputRef.current?.blur();
  }

  return (
    <div className="flex items-center gap-2">
      {/* Currency segmented — switches display currency using live ECB rates.
          Hidden until there are amounts to convert. */}
      {hasData ? (
        <fieldset
          aria-label={t("currency")}
          className="inline-flex rounded-lg bg-[color:var(--surface-app)] p-0.5 gap-0.5 border-0 m-0"
        >
          {(["EUR", "USD"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDisplayCurrency(c)}
              disabled={fetching}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                displayCurrency === c
                  ? "bg-[color:var(--surface-card)] text-[color:var(--brand-primary)] shadow-[0_1px_2px_rgba(15,20,33,0.06)]"
                  : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]",
              )}
            >
              {fetching && displayCurrency !== c ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {c === "EUR" ? "€ EUR" : "$ USD"}
            </button>
          ))}
        </fieldset>
      ) : null}

      {/* Global transaction search — navigates to /transactions?q=…
          Hidden until there are transactions to find. */}
      {hasData ? (
        <form
          onSubmit={handleSearchSubmit}
          className="hidden lg:flex items-center gap-2 rounded-lg border border-transparent bg-[color:var(--surface-app)] px-3 py-1.5 focus-within:border-[color:var(--brand-primary)] min-w-[260px] transition-colors"
        >
          <Search
            className="h-[15px] w-[15px] shrink-0 text-[color:var(--text-tertiary)]"
            strokeWidth={2}
          />
          <input
            ref={inputRef}
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="flex-1 border-none bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-tertiary)]"
            aria-label={t("searchLabel")}
          />
          <kbd className="shrink-0 rounded bg-[color:var(--surface-sidebar)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--text-tertiary)]">
            ⌘K
          </kbd>
        </form>
      ) : null}

      {/* Privacy (blur balances) toggle — global store, persisted to localStorage.
          Hidden alongside the others: with no balances on screen there is
          nothing to blur. The stored preference is untouched, so it applies
          again as soon as data exists. */}
      {hasData ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={togglePrivacy}
          aria-pressed={privacy}
          aria-label={privacy ? t("showBalances") : t("hideBalances")}
          title={privacy ? t("showBalances") : t("hideBalances")}
        >
          {privacy ? (
            <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <Eye className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </Button>
      ) : null}

      {/* Notifications — opens dropdown with active insights, hourly poll */}
      <NotificationsBell />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={isPending}
        onClick={() => startTransition(() => lockAction())}
        aria-label={t("lock")}
        title={t("lock")}
      >
        <Lock className="h-[18px] w-[18px]" strokeWidth={2} />
      </Button>
    </div>
  );
}
