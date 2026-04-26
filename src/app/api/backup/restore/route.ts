import fs from "node:fs";
import path from "node:path";
import { getCurrentSession } from "@/lib/auth/session";
import { guardCsrf } from "@/lib/security/csrf";
import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/backup/restore — accepts a SQLite database file as multipart
 * upload (field: "file") and replaces `data/financial-coach.db` with it.
 *
 * Strategy:
 *   1. Validate auth + file magic header (`SQLite format 3\0`).
 *   2. Write the upload to `data/financial-coach.db.restore` (staging).
 *   3. On success, write a marker file `.restore-pending` and rely on the
 *      server operator restarting the process — we do NOT hot-swap the open
 *      DB handle because the pragma options (WAL, foreign_keys) are bound to
 *      the connection.
 *
 * UI should tell the user to stop the dev server, move the staged file over,
 * and restart. This is the safe boundary for a local-first app.
 */
export async function POST(req: NextRequest) {
  // CRITICAL: this endpoint replaces the entire database. Without an Origin
  // check a malicious site could submit a hostile .db file via a crafted
  // form and the cookie-authenticated browser would dutifully send it.
  const csrf = guardCsrf(req);
  if (csrf) return csrf;

  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0 || file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: "bad_size" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // SQLite format 3 magic header — 16 bytes starting with "SQLite format 3\0".
  const magic = "SQLite format 3\0";
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) {
      return NextResponse.json({ error: "not_sqlite" }, { status: 400 });
    }
  }

  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stagingPath = path.join(dataDir, "financial-coach.db.restore");
  await fs.promises.writeFile(stagingPath, bytes, { mode: 0o600 });
  await fs.promises.writeFile(path.join(dataDir, ".restore-pending"), new Date().toISOString(), {
    mode: 0o600,
  });

  return NextResponse.json({
    ok: true,
    staged: stagingPath,
    next: "Stop the server, run `mv data/financial-coach.db.restore data/financial-coach.db`, then restart.",
  });
}
