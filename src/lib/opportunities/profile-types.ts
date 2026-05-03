// Pure types + enum constants for the investor profile. Safe to import from
// client components (no server-only side effects). Database accessors live in
// `./profile.ts` and are server-only.

export const AGE_RANGES = ["under_25", "25_34", "35_44", "45_54", "55_64", "65_plus"] as const;
export const HORIZONS = ["under_1y", "1_3y", "3_7y", "7_15y", "over_15y"] as const;
export const RISK_TOLERANCES = ["sell_all", "sell_some", "hold", "buy_more"] as const;
export const EMERGENCY_FUND_OPTIONS = ["none", "under_3", "3_6", "over_6"] as const;
export const DEPENDENTS_OPTIONS = ["none", "1_2", "3_plus"] as const;
export const PRIMARY_GOALS = [
  "emergency_fund",
  "house",
  "retirement",
  "education",
  "freedom",
  "other",
] as const;

export type AgeRange = (typeof AGE_RANGES)[number];
export type Horizon = (typeof HORIZONS)[number];
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];
export type EmergencyFund = (typeof EMERGENCY_FUND_OPTIONS)[number];
export type Dependents = (typeof DEPENDENTS_OPTIONS)[number];
export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

export interface InvestorProfile {
  ageRange: AgeRange;
  horizon: Horizon;
  riskTolerance: RiskTolerance;
  emergencyFundMonths: EmergencyFund;
  dependents: Dependents;
  primaryGoal: PrimaryGoal;
  note: string | null;
}
