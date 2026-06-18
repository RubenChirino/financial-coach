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
  withGitHub: string;
  guest: string;
  guestHint: string;
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
  const showGitHub = Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET);

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

      {showGitHub ? (
        <form
          action={async () => {
            "use server";
            const { signIn } = await import("@/lib/auth/oauth-config");
            await signIn("github", { redirectTo });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[color:var(--border-default)] bg-[#24292F] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm hover:bg-[#2d3338]"
          >
            <GitHubMark />
            {labels.withGitHub}
          </button>
        </form>
      ) : null}

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-[color:var(--border-default)]" />
        <span className="text-[11px] text-[color:var(--text-tertiary)]">·</span>
        <div className="h-px flex-1 bg-[color:var(--border-default)]" />
      </div>

      <form
        action={async () => {
          "use server";
          const { enterGuestModeAction } = await import("@/lib/auth/actions");
          await enterGuestModeAction();
        }}
      >
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[color:var(--border-default)] bg-transparent px-4 py-2.5 text-[14px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-app)]"
        >
          <GuestMark />
          {labels.guest}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-[color:var(--text-tertiary)]">
          {labels.guestHint}
        </p>
      </form>

      <p className="pt-2 text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
        {labels.legal}
      </p>
    </div>
  );
}

function GuestMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <title>Guest</title>
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
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

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 98 96" aria-hidden="true" fill="white">
      <title>GitHub</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}
