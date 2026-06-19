"use server";

import { db } from "@/db/client";
import { insights } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/locale";
import { and, eq } from "drizzle-orm";
import { listActiveInsights, runInsightEngine } from "./engine";

export async function refreshInsightsAction(): Promise<void> {
  const session = await getCurrentSession();
  if (!session) return;
  const locale = await getLocale();
  await runInsightEngine(session.userId, locale);
}

export async function dismissInsightAction(id: number): Promise<void> {
  const session = await getCurrentSession();
  if (!session) return;
  await db
    .update(insights)
    .set({ dismissedAt: new Date() })
    .where(and(eq(insights.id, id), eq(insights.userId, session.userId)));
}

export async function listInsightsAction() {
  const session = await getCurrentSession();
  if (!session) return [];
  return listActiveInsights(session.userId);
}
