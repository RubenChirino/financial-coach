"use client";
import { Loader2, Plus, RefreshCw, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConvertedAmount } from "@/components/converted-amount";
import type { Goal } from "@/db/schema";
import { recomputeGoalsProgressAction } from "@/lib/goals/actions";
import { GoalCard } from "./goal-card";
import { GoalForm } from "./goal-form";

interface GoalsViewProps {
  goals: Goal[];
  currency: string;
  intlLocale: string;
  labels: {
    empty: string;
    emptyHint: string;
    newGoal: string;
    addFirst: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
    saved: string;
    totalGoals: string;
    of: string;
    completed: string;
    daysLeft: string;
    overdue: string;
    syncProgress: string;
    syncDone: string;
    // form labels
    titleLabel: string;
    emojiLabel: string;
    targetLabel: string;
    savedLabel: string;
    deadlineLabel: string;
    notesLabel: string;
    save: string;
    cancel: string;
    editGoal: string;
    titlePlaceholder: string;
    notesPlaceholder: string;
    missingTitle: string;
    invalidTarget: string;
  };
}

export function GoalsView({ goals, currency, intlLocale, labels }: GoalsViewProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const router = useRouter();

  function onSyncProgress() {
    setSyncMsg(null);
    startSync(async () => {
      const res = await recomputeGoalsProgressAction();
      if (res.ok) {
        setSyncMsg(labels.syncDone.replace("{count}", String(res.data?.updated ?? 0)));
        router.refresh();
      } else {
        setSyncMsg(res.error);
      }
      setTimeout(() => setSyncMsg(null), 3500);
    });
  }

  function deadlineLabel(goal: Goal): string | null {
    if (!goal.deadline) return null;
    const now = Date.now();
    const ms = goal.deadline.getTime() - now;
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
    if (days < 0) return labels.overdue;
    return `${days} ${labels.daysLeft}`;
  }

  const formLabels = {
    titleLabel: labels.titleLabel,
    emojiLabel: labels.emojiLabel,
    targetLabel: labels.targetLabel,
    savedLabel: labels.savedLabel,
    deadlineLabel: labels.deadlineLabel,
    notesLabel: labels.notesLabel,
    save: labels.save,
    cancel: labels.cancel,
    newGoal: labels.newGoal,
    editGoal: labels.editGoal,
    titlePlaceholder: labels.titlePlaceholder,
    notesPlaceholder: labels.notesPlaceholder,
    missingTitle: labels.missingTitle,
    invalidTarget: labels.invalidTarget,
  };

  const cardLabels = {
    edit: labels.edit,
    delete: labels.delete,
    deleteConfirm: labels.deleteConfirm,
    saved: labels.saved,
    of: labels.of,
    completed: labels.completed,
    daysLeft: labels.daysLeft,
    overdue: labels.overdue,
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {goals.some((g) => g.categoryId != null) ? (
            <button
              type="button"
              onClick={onSyncProgress}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-[13px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {labels.syncProgress}
            </button>
          ) : null}
          {syncMsg ? (
            <span className="text-[12px]" style={{ color: "var(--success)" }}>
              {syncMsg}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90"
        >
          <Plus className="h-4 w-4" />
          {labels.newGoal}
        </button>
      </div>

      {/* Summary strip (if goals exist) */}
      {goals.length > 0 ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="coin-card px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {labels.totalGoals}
            </div>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-[color:var(--brand-primary)]">
              {goals.length}
            </div>
          </div>
          <div className="coin-card px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {labels.saved}
            </div>
            <div className="mt-1 text-[18px] font-bold tabular-nums" style={{ color: "#059669" }}>
              <ConvertedAmount
                cents={goals.reduce((s, g) => s + g.savedCents, 0)}
                currency={currency}
                intlLocale={intlLocale}
              />
            </div>
          </div>
          <div className="coin-card px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {labels.targetLabel}
            </div>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-[color:var(--text-secondary)]">
              <ConvertedAmount
                cents={goals.reduce((s, g) => s + g.targetCents, 0)}
                currency={currency}
                intlLocale={intlLocale}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Goals grid */}
      <div className="mt-5">
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-[color:var(--surface-card)]/30 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--surface-app)] text-[color:var(--text-tertiary)]">
              <Target className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-[14.5px] font-semibold">{labels.empty}</h3>
            <p className="mt-2 max-w-sm text-[13px] text-[color:var(--text-secondary)]">
              {labels.emptyHint}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90"
            >
              <Plus className="h-4 w-4" />
              {labels.addFirst}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {goals.map((g) => {
              const pct = g.targetCents > 0 ? (g.savedCents / g.targetCents) * 100 : 0;
              return (
                <GoalCard
                  key={g.id}
                  goal={g}
                  currency={currency}
                  intlLocale={intlLocale}
                  progressPct={pct}
                  deadlineLabel={deadlineLabel(g)}
                  labels={cardLabels}
                  onEdit={(goal) => {
                    setEditing(goal);
                    setOpen(true);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {open ? (
        <GoalForm
          goal={editing}
          labels={formLabels}
          currency={currency}
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
