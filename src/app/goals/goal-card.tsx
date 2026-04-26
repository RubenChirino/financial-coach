"use client";

import { PrivacyAmount } from "@/components/privacy-amount";
import { useToast } from "@/components/toaster";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Goal } from "@/db/schema";
import { deleteGoalAction } from "@/lib/goals/actions";
import { cn } from "@/lib/utils";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface GoalCardProps {
  goal: Goal;
  formattedTarget: string;
  formattedSaved: string;
  progressPct: number;
  deadlineLabel: string | null;
  labels: {
    edit: string;
    delete: string;
    deleteConfirm: string;
    saved: string;
    of: string;
    completed: string;
    daysLeft: string;
    overdue: string;
  };
  onEdit: (goal: Goal) => void;
}

export function GoalCard({
  goal,
  formattedTarget,
  formattedSaved,
  progressPct,
  deadlineLabel,
  labels,
  onEdit,
}: GoalCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();
  const tCommon = useTranslations("common");
  const done = progressPct >= 100;

  async function onDelete() {
    const ok = await confirm({
      title: labels.delete,
      description: labels.deleteConfirm,
      confirmLabel: tCommon("delete"),
      cancelLabel: tCommon("cancel"),
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await deleteGoalAction(goal.id);
      toast.success({ title: tCommon("success"), description: goal.title });
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "coin-card p-5 transition-shadow",
        done && "ring-2 ring-[color:var(--brand-primary)]",
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-app)] text-[22px]">
          {goal.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold">{goal.title}</span>
            {done ? (
              <span className="shrink-0 rounded-full bg-[color:var(--brand-primary-soft)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--brand-primary)]">
                {labels.completed} ✓
              </span>
            ) : null}
          </div>
          {deadlineLabel ? (
            <div className="mt-0.5 text-[11.5px] text-[color:var(--text-tertiary)]">
              {deadlineLabel}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(goal)}
            disabled={isPending}
            aria-label={labels.edit}
            className="rounded-md p-1.5 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)] disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            aria-label={labels.delete}
            className="rounded-md p-1.5 text-[color:var(--text-tertiary)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="text-[color:var(--text-secondary)]">
            <span className="font-semibold text-[color:var(--text-primary)]">
              <PrivacyAmount value={formattedSaved} />
            </span>{" "}
            {labels.of} <PrivacyAmount value={formattedTarget} />
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              done ? "text-[color:var(--brand-primary)]" : "text-[color:var(--text-secondary)]",
            )}
          >
            {Math.round(progressPct)}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-app)]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              done
                ? "bg-[color:var(--brand-primary)]"
                : "bg-gradient-to-r from-[color:var(--brand-primary)] to-[#86ADFF]",
            )}
            style={{ width: `${Math.min(progressPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Notes */}
      {goal.notes ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--text-tertiary)] line-clamp-2">
          {goal.notes}
        </p>
      ) : null}
    </div>
  );
}
