import "server-only";

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import * as s from "@/db/schema";

/**
 * "Delete all my data" for a local (single-user) installation: every row of
 * user data, the user, and every session — in ONE atomic batch, so a failure
 * leaves the installation as it was rather than half-wiped and locked out.
 *
 * Kept: what the app ships with and onboarding does not re-create — the
 * system category taxonomy and the built-in categorization rules (`user_id
 * IS NULL`) — and the shared city → country cache, which holds no user data.
 *
 * Unscoped on purpose: local mode has one user, and rows written before the
 * per-user columns existed belong to them too. Children are deleted before
 * parents.
 */
export async function wipeLocalInstallation(userId: number): Promise<void> {
  await db.batch([
    db.delete(s.advisorMessages),
    db.delete(s.advisorConversations),
    db.delete(s.insightDismissals),
    db.delete(s.insights),
    db.delete(s.goals),
    db.delete(s.budgets),
    db.delete(s.recurringSubscriptions),
    db.delete(s.travelCityLabels),
    db.delete(s.balanceHistory),
    db.delete(s.transactions),
    db.delete(s.importBatches),
    db.delete(s.accountLinkChoices),
    db.delete(s.accounts),
    db.delete(s.requisitions),
    db.delete(s.institutions),
    db.delete(s.providerCredentials),
    db.delete(s.investorProfiles),
    db.delete(s.categoryRules).where(isNotNull(s.categoryRules.userId)),
    db.delete(s.categories).where(eq(s.categories.isSystem, false)),
    db.delete(s.auditLog),
    db.delete(s.sessions),
    db.delete(s.users).where(eq(s.users.id, userId)),
  ]);
}
