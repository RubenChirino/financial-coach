import "server-only";

import { db } from "@/db/client";
import { investorProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  AgeRange,
  Dependents,
  EmergencyFund,
  Horizon,
  InvestorProfile,
  PrimaryGoal,
  RiskTolerance,
} from "./profile-types";

// Re-export the shared types/constants so existing imports of these from
// `./profile` keep working.
export {
  AGE_RANGES,
  DEPENDENTS_OPTIONS,
  EMERGENCY_FUND_OPTIONS,
  HORIZONS,
  PRIMARY_GOALS,
  RISK_TOLERANCES,
} from "./profile-types";
export type {
  AgeRange,
  Dependents,
  EmergencyFund,
  Horizon,
  InvestorProfile,
  PrimaryGoal,
  RiskTolerance,
} from "./profile-types";

export async function getInvestorProfile(userId: number): Promise<InvestorProfile | null> {
  const rows = await db
    .select({
      ageRange: investorProfiles.ageRange,
      horizon: investorProfiles.horizon,
      riskTolerance: investorProfiles.riskTolerance,
      emergencyFundMonths: investorProfiles.emergencyFundMonths,
      dependents: investorProfiles.dependents,
      primaryGoal: investorProfiles.primaryGoal,
      note: investorProfiles.note,
    })
    .from(investorProfiles)
    .where(eq(investorProfiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert by userId. We don't merge partial updates — the form always submits
 * the full profile, so a missing field is intentional and should clobber.
 */
export async function saveInvestorProfile(
  userId: number,
  data: InvestorProfile,
): Promise<void> {
  await db
    .insert(investorProfiles)
    .values({
      userId,
      ageRange: data.ageRange,
      horizon: data.horizon,
      riskTolerance: data.riskTolerance,
      emergencyFundMonths: data.emergencyFundMonths,
      dependents: data.dependents,
      primaryGoal: data.primaryGoal,
      note: data.note,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: investorProfiles.userId,
      set: {
        ageRange: data.ageRange,
        horizon: data.horizon,
        riskTolerance: data.riskTolerance,
        emergencyFundMonths: data.emergencyFundMonths,
        dependents: data.dependents,
        primaryGoal: data.primaryGoal,
        note: data.note,
        updatedAt: new Date(),
      },
    });
}

/**
 * Compact, non-PII summary for the AI Coach prompt. Note is intentionally
 * excluded — that's a private user-only field.
 */
export function summarizeProfileForLlm(p: InvestorProfile): {
  ageRange: AgeRange;
  horizon: Horizon;
  riskTolerance: RiskTolerance;
  emergencyFundMonths: EmergencyFund;
  dependents: Dependents;
  primaryGoal: PrimaryGoal;
} {
  return {
    ageRange: p.ageRange,
    horizon: p.horizon,
    riskTolerance: p.riskTolerance,
    emergencyFundMonths: p.emergencyFundMonths,
    dependents: p.dependents,
    primaryGoal: p.primaryGoal,
  };
}
