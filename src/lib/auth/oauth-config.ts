import "server-only";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { generateSalt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";

/**
 * Auth.js v5 configuration for OAuth mode.
 *
 * Strategy: JWT-based sessions, no Auth.js DB adapter.
 *
 * Why JWT and not the DB adapter?
 *   - Serverless friendliness: no DB round-trip on every request to read the
 *     session row, just JWT verification with `AUTH_SECRET`.
 *   - Our `users` table is the source of truth for identity. The JWT only
 *     needs to carry `userId` (our internal int PK); everything else (email,
 *     name, image, language, llm prefs) is queried from the DB on demand.
 *
 * First-time sign-in:
 *   - `signIn` callback verifies email is present and (for Google) verified.
 *   - If no `users` row matches the email, we create one with a fresh
 *     `encryptionSalt`. PIN columns stay NULL.
 *
 * Subsequent sign-ins:
 *   - The same `users` row is reused by email lookup.
 *   - `jwt` callback stamps `userId` onto the token on first call after sign-in
 *     so downstream `auth()` / `session()` returns it without a DB hit.
 *
 * Module augmentation at the bottom of this file extends the `Session` and
 * `JWT` types with our `userId` field for typesafe consumption.
 */

// Pull env values into module-scope constants so Auth.js doesn't choke on
// missing values at construction. In local mode, AUTH_SECRET / client IDs are
// expected to be empty — the [...nextauth] route is unreachable so this code
// path is never exercised.
const e = env();

const providers = [];
if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      // Force account selection on every sign-in so multi-account users get a
      // chooser instead of silent reuse of the last selection.
      authorization: { params: { prompt: "select_account" } },
    }),
  );
}
if (e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET) {
  providers.push(
    MicrosoftEntraId({
      clientId: e.MICROSOFT_CLIENT_ID,
      clientSecret: e.MICROSOFT_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${e.MICROSOFT_TENANT_ID}/v2.0`,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: e.AUTH_SECRET ?? "auth-mode-not-enabled",
  // Session lifetime: 24 hours with sliding renewal every 6 hours.
  //
  // Why shorter than the Auth.js default (30d) and our previous 7d:
  //   - This app reads encrypted bank data. A stolen session JWT is enough
  //     to view all transactions until expiry.
  //   - Trade-off: users who don't open the app daily will be asked to
  //     sign in again. That's the right default for financial data — same
  //     posture as banks themselves.
  //   - `updateAge` controls sliding: once a user is active inside a 24h
  //     window, the session is silently refreshed (no re-login) every 6h.
  //     Idle for >24h → next visit requires sign-in.
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24, // 24 hours
    updateAge: 60 * 60 * 6, // sliding refresh every 6h of activity
  },
  pages: {
    signIn: "/lock",
    signOut: "/lock",
    error: "/lock",
  },
  providers,

  callbacks: {
    /**
     * Verify the OAuth profile is acceptable, and find-or-create the matching
     * `users` row. Returning `false` rejects the sign-in.
     */
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      // Google exposes `email_verified` on the profile — reject unverified
      // accounts to avoid account takeover via temporarily-claimed email.
      if (account?.provider === "google") {
        const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
        if (verified === false) return false;
      }

      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing) return true;

      // First sign-in for this email: provision a fresh user row. PIN columns
      // stay NULL — this user authenticates exclusively via OAuth. The
      // encryption salt is what `deriveOAuthEncryptionKey` mixes with
      // APP_SECRET to get the per-user AES key.
      const now = new Date();
      await db.insert(users).values({
        email,
        emailVerifiedAt: now,
        name: user.name ?? null,
        image: user.image ?? null,
        encryptionSalt: generateSalt(),
        // Hosted-mode defaults: Spanish UI, EUR currency, Gemini as the LLM
        // (free tier; Ollama isn't reachable from a Vercel function). The
        // user can change these in settings post-onboarding.
        language: "es",
        currency: "EUR",
        llmProvider: "google",
        llmModel: e.GOOGLE_MODEL,
        // OAuth users are already on a cloud-hosted service — they implicitly
        // consent to cloud LLM calls (same infrastructure, same trust boundary).
        // The consent gate was designed for local-first users who might not
        // expect their data going to third-party APIs; it doesn't apply here.
        cloudLlmConsentAt: now,
      });
      return true;
    },

    /**
     * Stamp `userId` onto the JWT on the first call after sign-in so we don't
     * pay for a DB lookup on every subsequent request that calls `auth()`.
     *
     * Also backfills `cloudLlmConsentAt` for OAuth users who signed up before
     * that field was set automatically — they're on a cloud service already so
     * the consent requirement doesn't apply.
     */
    async jwt({ token, user }) {
      if (user?.email && !token.userId) {
        const row = await db.query.users.findFirst({
          where: eq(users.email, user.email.toLowerCase()),
          columns: { id: true, cloudLlmConsentAt: true },
        });
        if (row) {
          token.userId = row.id;
          // Backfill consent for users created before this field was auto-set.
          if (!row.cloudLlmConsentAt) {
            await db
              .update(users)
              .set({ cloudLlmConsentAt: new Date() })
              .where(eq(users.id, row.id));
          }
        }
      }
      return token;
    },

    /**
     * Expose `userId` on the session object so callers can do
     * `(await auth())?.user.userId` without re-decoding the JWT.
     */
    async session({ session, token }) {
      if (typeof token.userId === "number") {
        session.user.userId = token.userId;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      userId?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: number;
  }
}

// Re-export the JWT type so other files don't need to import from deep paths.
export type { JWT };
