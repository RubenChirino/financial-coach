"use server";

import { getCurrentSession } from "@/lib/auth/session";
import {
  AGE_RANGES,
  DEPENDENTS_OPTIONS,
  EMERGENCY_FUND_OPTIONS,
  HORIZONS,
  type InvestorProfile,
  PRIMARY_GOALS,
  RISK_TOLERANCES,
  saveInvestorProfile,
} from "@/lib/opportunities/profile";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ProfileSchema = z.object({
  ageRange: z.enum(AGE_RANGES),
  horizon: z.enum(HORIZONS),
  riskTolerance: z.enum(RISK_TOLERANCES),
  emergencyFundMonths: z.enum(EMERGENCY_FUND_OPTIONS),
  dependents: z.enum(DEPENDENTS_OPTIONS),
  primaryGoal: z.enum(PRIMARY_GOALS),
  note: z.string().max(500).nullable().optional(),
});

export interface SaveProfileResult {
  ok: boolean;
  error?: string;
}

export async function saveInvestorProfileAction(raw: unknown): Promise<SaveProfileResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const profile: InvestorProfile = {
    ...parsed.data,
    note: parsed.data.note?.trim() || null,
  };
  await saveInvestorProfile(session.userId, profile);
  revalidatePath("/opportunities");
  revalidatePath("/advisor");
  return { ok: true };
}
