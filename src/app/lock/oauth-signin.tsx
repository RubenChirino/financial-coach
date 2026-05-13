import { env } from "@/lib/env";

/**
 * OAuth sign-in panel rendered on /lock when AUTH_MODE=oauth.
 *
 * Pure server component. Each provider button is a plain HTML <form> that
 * POSTs to a thin server action wrapping Auth.js's `signIn()`. We don't use
 * a client component here because no client-side state is needed — the
 * provider redirect is initiated by the form POST → server action → 302.
 */
export interface OAuthSigninLabels {
  withGoogle: string;
  withMicrosoft: string;
  legal: string;
}

export function OAuthSignin({
  redirectTo,
  labels,
}: {
  redirectTo: string;
  labels: OAuthSigninLabels;
}) {
  const e = env();
  const showGoogle = Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  const showMicrosoft = Boolean(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET);

  return (
    <div className="space-y-3">
      {showGoogle ? (
        <form
          action={async () => {
            "use server";
            const { signIn } = await import("@/lib/auth/oauth-config");
            await signIn("google", { redirectTo });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[color:var(--border-default)] bg-white px-4 py-2.5 text-[14px] font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            <GoogleMark />
            {labels.withGoogle}
          </button>
        </form>
      ) : null}

      {showMicrosoft ? (
        <form
          action={async () => {
            "use server";
            const { signIn } = await import("@/lib/auth/oauth-config");
            await signIn("microsoft-entra-id", { redirectTo });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[color:var(--border-default)] bg-white px-4 py-2.5 text-[14px] font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            <MicrosoftMark />
            {labels.withMicrosoft}
          </button>
        </form>
      ) : null}

      <p className="pt-2 text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
        {labels.legal}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <title>Microsoft</title>
      <path fill="#F25022" d="M0 0h8.55v8.55H0z" />
      <path fill="#00A4EF" d="M0 9.45h8.55V18H0z" />
      <path fill="#7FBA00" d="M9.45 0H18v8.55H9.45z" />
      <path fill="#FFB900" d="M9.45 9.45H18V18H9.45z" />
    </svg>
  );
}
