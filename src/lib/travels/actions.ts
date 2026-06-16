"use server";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getLanguageModel, providerInfo } from "@/lib/llm/provider";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateCity, getCityLabels, upsertCity } from "./city";
import { listTravels } from "./detect";

export interface CityActionResult {
  ok: boolean;
  city?: string | null;
  error?: string;
}

const MAX_CITY_LEN = 60;

/** Save a user-typed city for a trip. Empty/blank clears nothing — use a value. */
export async function setCityAction(tripKey: string, city: string): Promise<CityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const trimmed = city.trim();
  if (!trimmed || trimmed.length > MAX_CITY_LEN) {
    return { ok: false, error: "invalidCity" };
  }

  await upsertCity(tripKey, trimmed, "user");
  revalidatePath("/travels");
  return { ok: true, city: trimmed };
}

/**
 * Guess a trip's city with the LLM and cache it. Gated by the same cloud
 * consent rule as the advisor chat: cloud providers require the user to have
 * accepted sending (redacted) data to a cloud LLM. Never overwrites a city the
 * user typed.
 */
export async function guessCityAction(tripKey: string): Promise<CityActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return { ok: false, error: "userNotFound" };

  const prefs = { provider: user.llmProvider, model: user.llmModel };
  const info = providerInfo(prefs);
  if (!info.isLocal && user.cloudLlmConsentAt == null) {
    return { ok: false, error: "cloudConsentRequired" };
  }

  // A city the user set by hand always wins — don't spend an LLM call.
  const existing = await getCityLabels([tripKey]);
  if (existing.get(tripKey)?.source === "user") {
    return { ok: true, city: existing.get(tripKey)?.city ?? null };
  }

  const trip = (await listTravels()).find((t) => t.tripKey === tripKey);
  if (!trip) return { ok: false, error: "tripNotFound" };

  const { model } = getLanguageModel(prefs);
  const city = await generateCity({
    model,
    country: trip.country,
    currency: trip.currency,
    merchantNames: trip.merchantNames,
  });

  if (city) await upsertCity(tripKey, city, "ai");
  revalidatePath("/travels");
  return { ok: true, city };
}
