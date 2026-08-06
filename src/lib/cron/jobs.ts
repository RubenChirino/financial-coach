import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { snapshotBalances } from "@/lib/accounts/history";
import { env } from "@/lib/env";
import { runInsightEngine } from "@/lib/insights/engine";
import { detectTransfers } from "@/lib/transfers/detect";

/**
 * Authorize a scheduled request. Vercel Cron sends the project's `CRON_SECRET`
 * as `Authorization: Bearer <secret>`. We accept only an exact match. When no
 * secret is configured the cron surface is considered disabled (the caller
 * returns 503 before reaching here).
 *
 * The comparison is constant-time: `===` on strings bails at the first
 * differing byte, which leaks the secret's prefix to an attacker who can time
 * enough requests against these unauthenticated endpoints. Hashing both sides
 * first keeps the compared buffers the same length regardless of what the
 * caller sent, so `timingSafeEqual` can't throw on a length mismatch either.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const presented = req.headers.get("authorization") ?? "";
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(presented), digest(`Bearer ${secret}`));
}

export interface RecomputeSummary {
  users: number;
  insights: number;
  transfers: number;
  snapshots: number;
  errors: number;
}

/**
 * The per-user "keep everything fresh" pass, run on a schedule so the data the
 * user sees is current even while the app is closed. Operates only on data the
 * app already has (no bank-API calls, so no per-user encryption key needed):
 *   - refresh the rule-based insights,
 *   - re-detect internal transfers,
 *   - snapshot balances for the net-worth-over-time chart.
 *
 * Each user is isolated in its own try/catch so one failure never aborts the
 * batch. Guests are skipped (ephemeral, read-only).
 *
 * NOTE: pulling NEW bank transactions headlessly (deriving each user's OAuth
 * key + calling the provider) is intentionally out of scope here — it's
 * provider-specific and touches the sensitive sync path. Users still get fresh
 * insights/snapshots; a manual or in-app sync pulls new bank data.
 */
export async function recomputeAllUsers(): Promise<RecomputeSummary> {
  const rows = await db
    .select({ id: users.id, language: users.language, isGuest: users.isGuest })
    .from(users);

  const summary: RecomputeSummary = {
    users: 0,
    insights: 0,
    transfers: 0,
    snapshots: 0,
    errors: 0,
  };

  for (const u of rows) {
    if (u.isGuest) continue;
    summary.users += 1;
    try {
      await runInsightEngine(u.id, u.language);
      summary.insights += 1;
      summary.transfers += await detectTransfers({ userId: u.id });
      summary.snapshots += await snapshotBalances(u.id);
    } catch (err) {
      summary.errors += 1;
      console.warn("cron recompute failed for user", u.id, err);
    }
  }
  return summary;
}
