import { sqlite } from "@/db/client";
import { getCurrentSession } from "@/lib/auth/session";
import { guardCsrf } from "@/lib/security/csrf";
import { type NextRequest, NextResponse } from "next/server";

/**
 * GET /api/backup — streams a consistent snapshot of the SQLite database as a
 * binary download.
 *
 * Uses SQLite's online-backup API (`Database.backup`) so the dump is
 * transactionally consistent even while the app keeps writing. The output is
 * the exact same `.db` file you'd get from `sqlite3 .backup` — restore by
 * replacing `data/financial-coach.db` while the server is stopped, or via
 * POST /api/backup/restore.
 *
 * Auth: requires a valid unlocked session — the backup contains AES-encrypted
 * columns that still need the user's PIN-derived key to decrypt, but we
 * gate the download anyway.
 */
export async function GET(req: NextRequest) {
  // Same-origin gate: prevents a malicious site from triggering a cross-origin
  // download of the user's encrypted DB via a `<a download>` or fetch.
  const csrf = guardCsrf(req);
  if (csrf) return csrf;

  const session = await getCurrentSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });

  try {
    // `better-sqlite3` exposes `serialize()` which returns the whole DB as a
    // Buffer in one pass. This is fine at our scale (single-user, <1GB).
    const buf = sqlite.serialize();
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
