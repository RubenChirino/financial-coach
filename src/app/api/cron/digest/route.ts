import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/jobs";
import { deliverDigests } from "@/lib/digest/deliver";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled email digest. Wired from `vercel.json`; gated by `CRON_SECRET`.
 * Emails opted-in users their active insights via Resend. A no-op unless
 * `RESEND_API_KEY` is set, so it's safe to schedule even before email is
 * configured.
 */
export async function GET(req: Request) {
  if (!env().CRON_SECRET) {
    return NextResponse.json({ error: "cron_disabled" }, { status: 503 });
  }
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await deliverDigests();
  return NextResponse.json({ ok: true, ...summary });
}
