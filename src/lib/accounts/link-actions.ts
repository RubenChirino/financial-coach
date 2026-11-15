"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { syncAllAccountsAction } from "@/lib/gocardless/actions";
import { syncAllTrueLayerAccountsAction } from "@/lib/truelayer/actions";
import { type LinkChoiceView, listLinkChoices, resolveLinkChoice } from "./link";

/** Bank accounts from a new consent waiting for "same as X" or "new account". */
export async function listAccountLinkChoicesAction(): Promise<LinkChoiceView[]> {
  const session = await getCurrentSession();
  if (!session || session.isGuest) return [];
  return listLinkChoices(session.userId, session.encryptionKey);
}

const resolveInput = z.object({
  choiceId: z.number().int().positive(),
  targetAccountId: z.number().int().positive().nullable(),
});

export type ResolveAccountLinkResult =
  | { ok: true; inserted: number }
  | {
      ok: false;
      error: "unauthenticated" | "guestReadOnly" | "invalidInput" | "notFound" | "notACandidate";
    };

/**
 * Answer a pending choice: `targetAccountId` continues that account, null
 * makes a new one. Then syncs the provider, so the account gets its rows.
 */
export async function resolveAccountLinkAction(
  choiceId: number,
  targetAccountId: number | null,
): Promise<ResolveAccountLinkResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (session.isGuest) return { ok: false, error: "guestReadOnly" };
  const parsed = resolveInput.safeParse({ choiceId, targetAccountId });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const outcome = await resolveLinkChoice({
    userId: session.userId,
    encryptionKey: session.encryptionKey,
    ...parsed.data,
  });
  if (!outcome.ok) return outcome;

  let inserted = 0;
  if (outcome.applied) {
    const sync =
      outcome.provider === "truelayer"
        ? await syncAllTrueLayerAccountsAction()
        : await syncAllAccountsAction();
    if (sync.ok && sync.data) inserted = sync.data.inserted;
  }
  revalidatePath("/settings/bank");
  revalidatePath("/transactions");
  revalidatePath("/");
  return { ok: true, inserted };
}
