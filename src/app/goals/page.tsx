import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/user";
import { listGoalsAction } from "@/lib/goals/actions";
import { getLocale } from "@/lib/i18n/locale";
import { GoalsView } from "./goals-view";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  if (!(await getCurrentSession())) redirect("/lock");

  const [tNav, t, goals, locale, user] = await Promise.all([
    getTranslations("nav"),
    getTranslations("goals"),
    listGoalsAction(),
    getLocale(),
    getUser(),
  ]);

  const intlLocale = locale === "es" ? "es-ES" : "en-GB";
  const currency = user?.currency ?? "EUR";

  return (
    <AppShell title={tNav("goals")} subtitle={t("subtitle")}>
      <div className="mx-auto max-w-3xl">
        <GoalsView
          goals={goals}
          currency={currency}
          intlLocale={intlLocale}
          labels={{
            empty: t("emptyTitle"),
            emptyHint: t("emptyBody"),
            newGoal: t("newGoal"),
            addFirst: t("addFirst"),
            edit: t("edit"),
            delete: t("delete"),
            deleteConfirm: t("deleteConfirm"),
            saved: t("saved"),
            totalGoals: t("totalGoals"),
            of: t("of"),
            completed: t("completed"),
            daysLeft: t("daysLeft"),
            overdue: t("overdue"),
            syncProgress: t("syncProgress"),
            syncDone: t("syncDone"),
            // form
            titleLabel: t("form.titleLabel"),
            emojiLabel: t("form.emojiLabel"),
            targetLabel: t("form.targetLabel"),
            savedLabel: t("form.savedLabel"),
            deadlineLabel: t("form.deadlineLabel"),
            notesLabel: t("form.notesLabel"),
            save: t("form.save"),
            cancel: t("form.cancel"),
            editGoal: t("editGoal"),
            titlePlaceholder: t("form.titlePlaceholder"),
            notesPlaceholder: t("form.notesPlaceholder"),
            missingTitle: t("form.missingTitle"),
            invalidTarget: t("form.invalidTarget"),
          }}
        />
      </div>
    </AppShell>
  );
}
