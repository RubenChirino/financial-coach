"use client";

import { Button } from "@/components/ui/button";
import { type AiDetectionInfo, excelToCsvAction, importCsvAction } from "@/lib/import/actions";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";

export interface ImportFormLabels {
  pasteLabel: string;
  pastePlaceholder: string;
  orPickFile: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  duplicatesSuffix: string;
  categorizedSuffix: string;
  errorsTitle: string;
  errorLine: string;
  genericError: string;
  viewTransactions: string;
  emptyError: string;
  fileTooLargeError: string;
  headerErrorPrefix: string;
  /** AI mode picker */
  modeLabel: string;
  modeAuto: string;
  modeAutoHint: string;
  modeAi: string;
  modeAiHint: string;
  modeStrict: string;
  modeStrictHint: string;
  /** AI feedback */
  aiUsedTitle: string;
  aiUsedBody: string;
  aiUnavailableError: string;
  allRowsFailedError: string;
  aiSpecLabel: string;
  cloudConsentRequiredError: string;
  /** Force-reimport toggle */
  forceReimportLabel: string;
  forceReimportHint: string;
  /** Diagnostic surface */
  parsedSampleTitle: string;
  parsedSampleHint: string;
  duplicatesBreakdownIntra: string;
  duplicatesBreakdownExisting: string;
  zeroInsertedHint: string;
}

interface SuccessState {
  inserted: number;
  duplicates: number;
  intraBatchDuplicates: number;
  existingDuplicates: number;
  ruleMatched: number;
  rowErrors: { lineNumber: number; message: string }[];
  ai: AiDetectionInfo;
  sampleRow?: {
    date: string;
    amountCents: number;
    currency: string;
    merchant: string | null;
    description: string;
  };
}

type Mode = "auto" | "ai" | "strict";

/**
 * Read an ArrayBuffer as a base64 string in chunks. The naive
 * `btoa(String.fromCharCode(...new Uint8Array(buf)))` blows the call stack on
 * files over a few hundred KB. 8 KB chunks are well below any browser's
 * argument-count limit and still fast.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

/**
 * Three import modes:
 *  - "auto" (default) — try the strict parser first; fall back to AI when the
 *    header doesn't look canonical. Best for most users — they paste a CSV
 *    and we figure it out.
 *  - "ai"   — skip the strict path. Forces an LLM round-trip, useful when the
 *    user knows their bank's format is unusual.
 *  - "strict" — never touch the LLM. The escape hatch for offline use or when
 *    a user wants the previous (rigid) behavior.
 */
export function ImportForm({ labels }: { labels: ImportFormLabels }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("auto");
  const [forceReimport, setForceReimport] = useState(false);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAi, setErrorAi] = useState<AiDetectionInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setError(null);
    const isExcel = /\.(xls|xlsx)$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => {
      console.error("file read failed", reader.error);
      setError(labels.genericError);
    };
    if (isExcel) {
      // Parse Excel server-side — exceljs has Node.js dependencies that fight
      // browser bundling in production. The round-trip is fine; payload is
      // capped at 2MB on the server.
      reader.onload = () => {
        const data = reader.result;
        if (!(data instanceof ArrayBuffer)) {
          setError(labels.genericError);
          return;
        }
        startTransition(async () => {
          try {
            const base64 = arrayBufferToBase64(data);
            const res = await excelToCsvAction(base64);
            if (!res.ok) {
              setError(humanizeError(res.error));
              return;
            }
            setText(res.csv);
          } catch (err) {
            console.error("excel parse failed", err);
            setError(labels.genericError);
          }
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        const content = typeof reader.result === "string" ? reader.result : "";
        if (!content) {
          setError(labels.emptyError);
          return;
        }
        setText(content);
      };
      reader.readAsText(file);
    }
  }

  function humanizeError(raw: string): string {
    if (raw === "emptyFile") return labels.emptyError;
    if (raw === "fileTooLarge") return labels.fileTooLargeError;
    if (raw === "aiUnavailable") return labels.aiUnavailableError;
    if (raw === "cloudConsentRequired") return labels.cloudConsentRequiredError;
    if (raw === "allRowsFailed") return labels.allRowsFailedError;
    if (raw.startsWith("header:")) {
      return `${labels.headerErrorPrefix} ${raw.slice("header:".length)}`;
    }
    return labels.genericError;
  }

  function handleSubmit() {
    setSuccess(null);
    setError(null);
    setErrorAi(null);

    const payload = text.trim();
    if (!payload) {
      setError(labels.emptyError);
      return;
    }

    startTransition(async () => {
      const res = await importCsvAction(payload, mode, filename, forceReimport);
      if (!res.ok) {
        setError(humanizeError(res.error));
        if (res.ai) setErrorAi(res.ai);
        return;
      }
      setSuccess({
        inserted: res.data.inserted,
        duplicates: res.data.duplicates,
        intraBatchDuplicates: res.data.intraBatchDuplicates,
        existingDuplicates: res.data.existingDuplicates,
        ruleMatched: res.data.ruleMatched,
        rowErrors: res.data.rowErrors,
        ai: res.data.ai,
        sampleRow: res.data.sampleRow,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="csv-paste" className="block text-sm font-medium">
          {labels.pasteLabel}
        </label>
        <textarea
          id="csv-paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.pastePlaceholder}
          rows={10}
          spellCheck={false}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          disabled={pending}
        />
      </div>

      <fieldset className="space-y-2 rounded-md border bg-muted/30 p-3">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {labels.modeLabel}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <ModeOption
            id="mode-auto"
            value="auto"
            checked={mode === "auto"}
            onChange={() => setMode("auto")}
            title={labels.modeAuto}
            hint={labels.modeAutoHint}
            disabled={pending}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
          <ModeOption
            id="mode-ai"
            value="ai"
            checked={mode === "ai"}
            onChange={() => setMode("ai")}
            title={labels.modeAi}
            hint={labels.modeAiHint}
            disabled={pending}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
          <ModeOption
            id="mode-strict"
            value="strict"
            checked={mode === "strict"}
            onChange={() => setMode("strict")}
            title={labels.modeStrict}
            hint={labels.modeStrictHint}
            disabled={pending}
          />
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[color:var(--border-default)] bg-muted/20 p-2.5 text-xs">
        <input
          type="checkbox"
          checked={forceReimport}
          onChange={(e) => setForceReimport(e.target.checked)}
          disabled={pending}
          className="mt-0.5 accent-current"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{labels.forceReimportLabel}</span>
          <span className="block text-[11.5px] text-muted-foreground">
            {labels.forceReimportHint}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
        >
          <Upload className="h-4 w-4" />
          {labels.orPickFile}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={handleFile}
        />
        <div className="ml-auto">
          <Button type="button" onClick={handleSubmit} disabled={pending || text.trim() === ""}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {pending ? labels.submitting : labels.submit}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          {errorAi?.error ? <p className="pl-6 text-xs opacity-80">{errorAi.error}</p> : null}
        </div>
      ) : null}

      {success ? (
        <div className="space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <div className="flex items-start gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{labels.successTitle}</span>
          </div>
          <p className="text-muted-foreground">
            {labels.successBody.replace("{count}", String(success.inserted))}
            {success.duplicates > 0
              ? ` ${labels.duplicatesSuffix.replace("{count}", String(success.duplicates))}`
              : ""}
            {success.ruleMatched > 0
              ? ` ${labels.categorizedSuffix.replace("{count}", String(success.ruleMatched))}`
              : ""}
          </p>

          {/* Diagnostic: when 0 inserted with many duplicates, surface the
              breakdown + a parsed sample so the user can see what happened. */}
          {success.inserted === 0 && success.duplicates > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              <div className="mb-2 font-medium text-amber-700 dark:text-amber-400">
                {labels.zeroInsertedHint}
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                <li>
                  {labels.duplicatesBreakdownIntra.replace(
                    "{n}",
                    String(success.intraBatchDuplicates),
                  )}
                </li>
                <li>
                  {labels.duplicatesBreakdownExisting.replace(
                    "{n}",
                    String(success.existingDuplicates),
                  )}
                </li>
              </ul>
              {success.sampleRow ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">
                    {labels.parsedSampleTitle}
                  </summary>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    {labels.parsedSampleHint}
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded border bg-muted/50 p-2 text-[10.5px] leading-snug">
                    {JSON.stringify(success.sampleRow, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          {success.ai.used && success.ai.spec ? (
            <div className="rounded-md border border-emerald-500/30 bg-background/40 p-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {labels.aiUsedTitle.replace(
                    "{provider}",
                    `${success.ai.provider ?? ""}${
                      success.ai.model ? ` · ${success.ai.model}` : ""
                    }`,
                  )}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{labels.aiUsedBody}</p>
              <p className="mt-1 italic text-muted-foreground">{success.ai.spec.notes}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">
                  {labels.aiSpecLabel}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded border bg-muted/50 p-2 text-[10.5px] leading-snug">
                  {JSON.stringify(success.ai.spec, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}

          {success.rowErrors.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {labels.errorsTitle.replace("{count}", String(success.rowErrors.length))}
              </summary>
              <ul className="mt-2 space-y-1 pl-4 list-disc">
                {success.rowErrors.slice(0, 20).map((e) => (
                  <li key={`${e.lineNumber}-${e.message}`}>
                    {labels.errorLine
                      .replace("{line}", String(e.lineNumber))
                      .replace("{message}", e.message)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div>
            <Link
              href="/transactions"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {labels.viewTransactions} →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModeOption({
  id,
  value,
  checked,
  onChange,
  title,
  hint,
  disabled,
  icon,
}: {
  id: string;
  value: Mode;
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
  disabled: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 text-xs transition-colors ${
        checked
          ? "border-primary bg-primary/5"
          : "border-[color:var(--border-default)] hover:bg-muted/40"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="radio"
          name="import-mode"
          value={value}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="h-3 w-3 accent-current"
        />
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <span className="pl-5 text-muted-foreground">{hint}</span>
    </label>
  );
}
