"use server";

import { db } from "@/db/client";
import { insights } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/locale";
import { eq } from "drizzle-orm";
import { listActiveInsights, runInsightEngine } from "./engine";

export async function refreshInsightsAction(): Promise<void> {
  const session = await getCurrentSession();
  if (!session) return;
  const locale = await getLocale();
  await runInsightEngine(locale);
}

export async function dismissInsightAction(id: number): Promise<void> {
  const session = await getCurrentSession();
  if (!session) return;
  await db.update(insights).set({ dismissedAt: new Date() }).where(eq(insights.id, id));
}

export async function listInsightsAction() {
  const session = await getCurrentSession();
  if (!session) return [];
  return listActiveInsights();
}
