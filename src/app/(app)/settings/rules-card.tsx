"use client";

import { ArrowRight, Loader2, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { CategoryIcon } from "@/components/category-icon";
import {
  deleteUserRuleAction,
  listUserRulesAction,
  type UserRule,
} from "@/lib/categorize/rules-actions";

/**
 * Lists the user's learned category rules ("always categorise X as Y") with a
 * delete affordance. Rules are created from the transactions list via the
 * category picker's "Always" offer; this card is where they're reviewed/removed.
 */
export function RulesCard() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [rules, setRules] = useState<UserRule[] | null>(null);
  const [, startDelete] = useTransition();

  useEffect(() => {
    void listUserRulesAction().then(setRules);
  }, []);

  function remove(id: number) {
    setRules((prev) => prev?.filter((r) => r.id !== id) ?? null);
    startDelete(async () => {
      await deleteUserRuleAction(id);
    });
  }

  if (rules === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[color:var(--text-tertiary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("rulesLoading")}
      </div>
    );
  }

  if (rules.length === 0) {
    return <p className="text-[13px] text-[color:var(--text-tertiary)]">{t("rulesEmpty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {rules.map((r) => {
        const name = locale === "es" ? r.categoryNameEs : r.categoryNameEn;
        return (
          <li
            key={r.id}
            className="flex items-center gap-2 rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-[13px]"
          >
            <span className="truncate font-medium">{r.matchPattern}</span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-tertiary)]"
              aria-hidden
            />
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium"
              style={{ backgroundColor: `${r.categoryColor}22`, color: r.categoryColor }}
            >
              <CategoryIcon icon={r.categoryIcon} className="h-3 w-3" strokeWidth={2} />
              {name}
            </span>
            <button
              type="button"
              onClick={() => remove(r.id)}
              aria-label={t("rulesDelete")}
              title={t("rulesDelete")}
              className="ml-auto rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)] hover:text-[color:var(--error)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
