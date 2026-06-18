"use server";

import { getCurrentSession } from "@/lib/auth/session";
import { getUser, updateUserCurrency, updateUserLlm } from "@/lib/auth/user";
import type { LlmProvider } from "@/lib/llm/provider";
import { revalidatePath } from "next/cache";

export async function updateCurrencyAction(currency: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session) throw new Error("Not authenticated");
  if (session.isGuest) throw new Error("guestReadOnly");

  const upper = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new Error("Invalid currency code");
  }

  const user = await getUser();
  if (!user) throw new Error("User not found");

  await updateUserCurrency(user.id, upper);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function getUserCurrencyAction(): Promise<string> {
  const user = await getUser();
  return user?.currency ?? "EUR";
}

const VALID_PROVIDERS: LlmProvider[] = ["ollama", "anthropic", "openai", "google"];

export async function updateLlmAction(provider: string, model: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session) throw new Error("Not authenticated");
  if (session.isGuest) throw new Error("guestReadOnly");

  if (!VALID_PROVIDERS.includes(provider as LlmProvider)) {
    throw new Error("Invalid provider");
  }
  const trimmedModel = model.trim();
  if (!trimmedModel) throw new Error("Model cannot be empty");

  const user = await getUser();
  if (!user) throw new Error("User not found");

  await updateUserLlm(user.id, provider as LlmProvider, trimmedModel);
  revalidatePath("/settings");
  revalidatePath("/advisor");
}
