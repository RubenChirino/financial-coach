"use client";

import { Button } from "@/components/ui/button";
import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

interface Labels {
  downloadLabel: string;
  downloadHint: string;
  restoreLabel: string;
  restoreHint: string;
  restoreStaged: string;
  restoreFailed: string;
  pickFile: string;
}

/**
 * Full-database backup + restore UI. Download hits `/api/backup` which streams
 * a SQLite dump; restore POSTs the file to `/api/backup/restore` which stages
 * it next to the live DB so the user can swap it in on next startup.
 */
export function BackupCard({ labels }: { labels: Labels }) {
  const [busy, setBusy] = useState<"download" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function download() {
    setBusy("download");
    setMessage(null);
    setError(null);
    try {
      // Navigating kicks off the browser download without CORS or blob juggling.
      window.location.href = "/api/backup";
    } finally {
      setTimeout(() => setBusy(null), 1000);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setBusy("restore");
    setMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { error?: string; next?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? labels.restoreFailed);
      } else {
        setMessage(`${labels.restoreStaged} ${body?.next ?? ""}`.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.restoreFailed);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" onClick={download} disabled={busy !== null}>
          {busy === "download" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {labels.downloadLabel}
        </Button>
        <p className="text-xs text-muted-foreground max-w-md">{labels.downloadHint}</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          {busy === "restore" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {labels.restoreLabel}
        </Button>
        <p className="text-xs text-muted-foreground max-w-md">{labels.restoreHint}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3"
          className="hidden"
          onChange={onFile}
          aria-label={labels.pickFile}
        />
      </div>

      {message ? (
        <p
          className="rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: "var(--success-soft)",
            color: "var(--success)",
            border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)",
          }}
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: "var(--error-soft)",
            color: "var(--error)",
            border: "1px solid var(--error-border)",
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
