import { isCronAuthorized, recomputeAllUsers } from "@/lib/cron/jobs";
import { env } from "@/lib/env";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Give the batch room to run across all users without hitting the default
// serverless timeout. Adjust per your Vercel plan.
export const maxDuration = 60;

/**
 * Scheduled "keep everything fresh" job. Wired from `vercel.json` crons; gated
 * by `CRON_SECRET`. Refreshes insights, re-detects transfers, and snapshots
 * balances for every (non-guest) user so the app is up to date even when no
 * one has it open. See `recomputeAllUsers`.
 */
export async function GET(req: Request) {
  if (!env().CRON_SECRET) {
    return NextResponse.json({ error: "cron_disabled" }, { status: 503 });
  }
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await recomputeAllUsers();
  return NextResponse.json({ ok: true, ...summary });
}
