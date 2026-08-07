"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { AvailableProvider } from "@/lib/llm/provider";
import { updateLlmAction } from "@/lib/settings/actions";

interface LlmSelectorProps {
  /** Current saved values from the users table. */
  currentProvider: string;
  currentModel: string;
  /** Providers detected from env (server-computed). */
  available: AvailableProvider[];
  labels: {
    providerLabel: string;
    modelLabel: string;
    customModelLabel: string;
    customModelPlaceholder: string;
    notConfigured: string;
    localBadge: string;
    cloudBadge: string;
    save: string;
    saved: string;
  };
}

export function LlmSelector({
  currentProvider,
  currentModel,
  available,
  labels,
}: LlmSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [provider, setProvider] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [showSaved, setShowSaved] = useState(false);

  // When provider changes, default to the first preset model for that provider.
  function handleProviderChange(p: string) {
    setProvider(p);
    const found = available.find((a) => a.id === p);
    if (found?.models[0]) setModel(found.models[0]);
  }

  // Auto-clear the "Saved" confirmation after 3 s.
  useEffect(() => {
    if (!showSaved) return;
    const id = setTimeout(() => setShowSaved(false), 3000);
    return () => clearTimeout(id);
  }, [showSaved]);

  function handleSave() {
    startTransition(async () => {
      await updateLlmAction(provider, model);
      setShowSaved(true);
      router.refresh();
    });
  }

  const selectedProviderInfo = available.find((a) => a.id === provider);
  const isDirty = provider !== currentProvider || model !== currentModel;

  return (
    <div className="space-y-4">
      {/* Provider picker */}
      <div className="space-y-1.5">
        <label
          htmlFor="llm-provider-select"
          className="text-sm font-medium text-[color:var(--text-primary)]"
        >
          {labels.providerLabel}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {available.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.configured}
              onClick={() => handleProviderChange(p.id)}
              className={[
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[13px] transition-colors",
                !p.configured && "cursor-not-allowed opacity-40",
                provider === p.id && p.configured
                  ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)]"
                  : "border-[color:var(--border-default)] hover:bg-[color:var(--surface-app)]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="text-[18px]">{providerEmoji(p.id)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.label}</div>
                {!p.configured ? (
                  <div className="text-[11px] text-[color:var(--text-tertiary)]">
                    {labels.notConfigured}
                  </div>
                ) : (
                  <div className="text-[11px] text-[color:var(--text-tertiary)]">
                    {p.isLocal ? labels.localBadge : labels.cloudBadge}
                  </div>
                )}
              </div>
              {provider === p.id && p.configured ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--brand-primary)]" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Model picker */}
      {selectedProviderInfo ? (
        <div className="space-y-1.5">
          <label
            htmlFor="llm-model-select"
            className="text-sm font-medium text-[color:var(--text-primary)]"
          >
            {labels.modelLabel}
          </label>
          <select
            id="llm-model-select"
            value={selectedProviderInfo.models.includes(model) ? model : "__custom__"}
            onChange={(e) => {
              if (e.target.value !== "__custom__") setModel(e.target.value);
            }}
            className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
          >
            {selectedProviderInfo.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {!selectedProviderInfo.models.includes(model) ? (
              <option value="__custom__">{model} (custom)</option>
            ) : null}
          </select>

          {/* Custom model text input — always visible for Ollama, otherwise shown when
              the current model isn't in the preset list */}
          {selectedProviderInfo.id === "ollama" || !selectedProviderInfo.models.includes(model) ? (
            <div className="space-y-1">
              <label
                htmlFor="llm-model-custom"
                className="text-xs text-[color:var(--text-tertiary)]"
              >
                {labels.customModelLabel}
              </label>
              <input
                id="llm-model-custom"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={labels.customModelPlaceholder}
                className="w-full rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)]"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Save button + confirmation */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !isDirty}
          className="rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[color:var(--brand-primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.save}
        </button>
        {showSaved ? (
          <span
            className="inline-flex items-center gap-1 text-[12.5px] font-medium"
            style={{ color: "var(--success)" }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {labels.saved}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function providerEmoji(id: string): string {
  switch (id) {
    case "ollama":
      return "🦙";
    case "anthropic":
      return "🤖";
    case "openai":
      return "✨";
    case "google":
      return "🔷";
    default:
      return "🧠";
  }
}
