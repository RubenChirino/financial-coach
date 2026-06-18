import { LockForm } from "@/app/lock/form";
import { OAuthSignin } from "@/app/lock/oauth-signin";
import { getCurrentSession } from "@/lib/auth/session";
import { userExists } from "@/lib/auth/user";
import { env } from "@/lib/env";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export default async function LockPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const isOAuth = env().AUTH_MODE === "oauth";

  // In local (PIN) mode, redirect to onboarding when no user exists yet. In
  // OAuth mode users are auto-provisioned on first sign-in, so there's no
  // onboarding step — the /lock page IS the entry point for everyone.
  if (!isOAuth && !(await userExists())) redirect("/onboarding");
  if (await getCurrentSession()) redirect("/");

  const { from } = await searchParams;
  const [tLock, tApp] = await Promise.all([getTranslations("lock"), getTranslations("app")]);

  // Hardened open-redirect guard. Accept only relative paths that:
  //   - start with `/`
  //   - do NOT start with `//` (protocol-relative URL → can target any host)
  //   - do NOT start with `/\` or `/%5C` (some browsers interpret as `//`)
  //   - do NOT contain a backslash anywhere (Edge/IE legacy quirks aside,
  //     it's never legitimate inside our app's routes)
  const safeFrom = isSafeRedirect(from) ? from : "/";

  return (
    <div className="min-h-dvh bg-[color:var(--surface-app)] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md coin-card p-8 space-y-6">
        {/* Brand header */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-[0_2px_6px_rgba(83,137,255,0.3)]"
            style={{
              background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 100%)",
            }}
          >
            <Sparkles className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-tight">{tApp("name")}</div>
            <div className="text-[11px] text-[color:var(--text-tertiary)] truncate">
              {tLock("welcomeBack")}
            </div>
          </div>
        </div>

        <header className="space-y-1">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
            {isOAuth ? tLock("oauthTitle") : tLock("title")}
          </h1>
          <p className="text-[14px] text-[color:var(--text-secondary)]">
            {isOAuth ? tLock("oauthSubtitle") : tLock("subtitle")}
          </p>
        </header>

        {isOAuth ? (
          <OAuthSignin
            redirectTo={safeFrom}
            labels={{
              withGoogle: tLock("withGoogle"),
              withMicrosoft: tLock("withMicrosoft"),
              withGitHub: tLock("withGitHub"),
              guest: tLock("withGuest"),
              guestHint: tLock("guestHint"),
              legal: tLock("oauthLegal"),
            }}
          />
        ) : (
          <LockForm redirectTo={safeFrom} />
        )}
      </div>
    </div>
  );
}

function isSafeRedirect(target: string | undefined): target is string {
  if (!target) return false;
  if (!target.startsWith("/")) return false;
  if (target.startsWith("//")) return false;
  if (target.startsWith("/\\")) return false;
  if (target.toLowerCase().startsWith("/%5c")) return false;
  if (target.includes("\\")) return false;
  // No newlines / control chars (CRLF injection into `Location` headers, etc.)
  if (/[\r\n\t]/.test(target)) return false;
  return true;
}
