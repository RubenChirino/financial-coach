"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth/session";
import { getSpendingForecast } from "./forecast";

export interface ForecastActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Final step of the background "recalculate predictions" run: rebuild the
 * forecast from the (freshly re-detected) inputs and revalidate the pages that
 * render it. The forecast itself is recomputed on every render, so the value of
 * this step is (a) doing the heavy read/aggregation pass off the click path and
 * (b) busting the router cache so the page shows the new numbers.
 */
export async function rebuildForecastAction(): Promise<ForecastActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  try {
    await getSpendingForecast({ userId: session.userId, horizonMonths: 3 });
    revalidatePath("/predictions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}
