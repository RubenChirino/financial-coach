"use client";

import type { Goal } from "@/db/schema";
import { type CreateGoalInput, createGoalAction, updateGoalAction } from "@/lib/goals/actions";
import { cn } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

const EMOJI_PRESETS = ["🎯", "🏠", "✈️", "🚗", "💍", "📚", "🎓", "🏖️", "💰", "🎸", "🐶", "🌱"];

interface GoalFormProps {
  goal?: Goal | null;
  labels: {
    titleLabel: string;
    emojiLabel: string;
    targetLabel: string;
    savedLabel: string;
    deadlineLabel: string;
    notesLabel: string;
    save: string;
    cancel: string;
    newGoal: string;
    editGoal: string;
    titlePlaceholder: string;
    notesPlaceholder: string;
    missingTitle: string;
    invalidTarget: string;
  };
  currency: string;
  onClose: () => void;
}

export function GoalForm({ goal, labels, currency, onClose }: GoalFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(goal?.emoji ?? "🎯");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function toInputCents(val: string): number {
    const n = Number.parseFloat(val.replace(",", "."));
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  }

  function toCurrencyInput(cents: number): string {
    if (cents === 0) return "";
    return (cents / 100).toFixed(2);
  }

  function deadlineToInput(ts: number | null | undefined): string {
    if (!ts) return "";
    return new Date(ts).toISOString().slice(0, 10);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    const targetCents = toInputCents(String(fd.get("target") ?? "0"));
    const savedCents = toInputCents(String(fd.get("saved") ?? "0"));
    const deadlineVal = String(fd.get("deadline") ?? "");
    const deadline = deadlineVal ? new Date(deadlineVal).getTime() : null;
    const notes = String(fd.get("notes") ?? "").trim() || null;

    if (!title) {
      setError(labels.missingTitle);
      return;
    }
    if (targetCents <= 0) {
      setError(labels.invalidTarget);
      return;
    }

    setError(null);
    startTransition(async () => {
      const input: CreateGoalInput = { title, emoji, targetCents, savedCents, deadline, notes };
      const res = goal
        ? await updateGoalAction({ ...input, id: goal.id })
        : await createGoalAction(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const fid = goal ? `goal-edit-${goal.id}` : "goal-new";

  const modal = (
    // Backdrop — rendered via portal at body so fixed positioning is always
    // viewport-relative, regardless of ancestor CSS transforms or grid layout.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        className="coin-card w-full max-w-md p-6"
        aria-labelledby={`${fid}-title`}
      >
        <div className="flex items-center justify-between">
          <h2 id={`${fid}-title`} className="text-[15px] font-semibold">
            {goal ? labels.editGoal : labels.newGoal}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-app)]"
            aria-label={labels.cancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Emoji picker */}
        <div className="mt-4">
          <div
            id={`${fid}-emoji-label`}
            className="mb-1.5 text-[12px] font-medium text-[color:var(--text-secondary)]"
          >
            {labels.emojiLabel}
          </div>
          <fieldset
            className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
            aria-labelledby={`${fid}-emoji-label`}
          >
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors",
                  emoji === e
                    ? "bg-[color:var(--brand-primary)] ring-2 ring-[color:var(--brand-primary)] ring-offset-1"
                    : "bg-[color:var(--surface-app)] hover:bg-[color:var(--brand-primary-soft)]",
                )}
              >
                {e}
              </button>
            ))}
          </fieldset>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          {/* Title */}
          <div>
            <label
              htmlFor={`${fid}-title-input`}
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {labels.titleLabel}
            </label>
            <input
              id={`${fid}-title-input`}
              ref={titleRef}
              name="title"
              defaultValue={goal?.title ?? ""}
              placeholder={labels.titlePlaceholder}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>

          {/* Target + Saved */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${fid}-target`}
                className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
              >
                {labels.targetLabel} ({currency})
              </label>
              <input
                id={`${fid}-target`}
                name="target"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={goal ? toCurrencyInput(goal.targetCents) : ""}
                placeholder="0.00"
                className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
              />
            </div>
            <div>
              <label
                htmlFor={`${fid}-saved`}
                className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
              >
                {labels.savedLabel} ({currency})
              </label>
              <input
                id={`${fid}-saved`}
                name="saved"
                type="number"
                min="0"
                step="0.01"
                defaultValue={goal ? toCurrencyInput(goal.savedCents) : ""}
                placeholder="0.00"
                className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
              />
            </div>
          </div>

          {/* Deadline */}
          <div>
            <label
              htmlFor={`${fid}-deadline`}
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {labels.deadlineLabel}
            </label>
            <input
              id={`${fid}-deadline`}
              name="deadline"
              type="date"
              defaultValue={goal ? deadlineToInput(goal.deadline?.getTime()) : ""}
              className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor={`${fid}-notes`}
              className="mb-1 block text-[12px] font-medium text-[color:var(--text-secondary)]"
            >
              {labels.notesLabel}
            </label>
            <textarea
              id={`${fid}-notes`}
              name="notes"
              rows={2}
              defaultValue={goal?.notes ?? ""}
              placeholder={labels.notesPlaceholder}
              className="w-full resize-none rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-app)] px-3 py-2 text-[13.5px] outline-none focus:border-[color:var(--brand-primary)]"
            />
          </div>

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--surface-app)] disabled:opacity-50"
            >
              {labels.cancel}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : labels.save}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );

  // createPortal requires document — guard for SSR (though this is client-only).
  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
