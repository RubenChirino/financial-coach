import fs from "node:fs/promises";
import { type NextRequest, NextResponse } from "next/server";
import { localDbPath } from "@/db/client";
import { getCurrentSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { guardCsrf } from "@/lib/security/csrf";

/**
 * GET /api/backup — downloads a snapshot of the local SQLite database file.
 *
 * Only works when DATABASE_URL points to a local `file:` URL (the default
 * self-hosted setup). For remote Turso/libSQL deployments the file lives on
 * Turso's infrastructure and must be exported via the Turso CLI — this
 * endpoint returns 501 in that case.
 *
 * Auth: requires a valid unlocked session — the backup contains AES-encrypted
 * columns that still need the user's encryption key to decrypt, but we gate
 * the download anyway.
 */
export async function GET(req: NextRequest) {
  // Same-origin gate: prevents a malicious site from triggering a cross-origin
  // download of the user's encrypted DB.
  const csrf = guardCsrf(req);
  if (csrf) return csrf;

  const session = await getCurrentSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });

  // This endpoint downloads the ENTIRE database file — every user's rows, not
  // just the caller's. It is a single-user / self-hosted operator tool. In
  // multi-user (oauth) mode it would be a cross-user data breach, and a guest
  // must never be able to exfiltrate the database. Disable it for both.
  if (env().AUTH_MODE === "oauth" || session.isGuest) {
    return new NextResponse(
      JSON.stringify({
        error: "not_available",
        message: "Whole-database backup is only available in single-user (local) mode.",
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  if (!localDbPath) {
    return NextResponse.json(
      {
        error: "remote_database",
        message:
          "Backups via this endpoint are only available for local file databases. " +
          "For Turso, use `turso db shell <db> .dump` from the Turso CLI.",
      },
      { status: 501 },
    );
  }

  try {
    const buf = await fs.readFile(localDbPath);
    const filename = `financial-coach-${new Date().toISOString().slice(0, 10)}.db`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "backup_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
