"use server";

import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/locale";
import {
  dismissInsights,
  type InsightView,
  listActiveInsights,
  MAX_INSIGHT_KEY_LENGTH,
} from "./engine";

const insightKey = z.string().min(1).max(MAX_INSIGHT_KEY_LENGTH);

/** Hide one insight for 30 days. Only a key the user's rules produce now is accepted. */
export async function dismissInsightAction(key: string): Promise<{ ok: boolean }> {
  const session = await getCurrentSession();
  if (!session) return { ok: false };
  const parsed = insightKey.safeParse(key);
  if (!parsed.success) return { ok: false };
  const done = await dismissInsights(session.userId, [parsed.data], await getLocale());
  return { ok: done.length === 1 };
}

/** Dismiss every insight showing now — "clear all". */
export async function dismissAllInsightsAction(): Promise<void> {
  const session = await getCurrentSession();
  if (!session) return;
  const locale = await getLocale();
  const active = await listActiveInsights(session.userId, locale);
  await dismissInsights(
    session.userId,
    active.map((i) => i.key),
    locale,
  );
}

export async function listInsightsAction(): Promise<InsightView[]> {
  const session = await getCurrentSession();
  if (!session) return [];
  return listActiveInsights(session.userId, await getLocale());
}
