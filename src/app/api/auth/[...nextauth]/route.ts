import { env } from "@/lib/env";
import type { NextRequest } from "next/server";

/**
 * Auth.js v5 route handler — only mounted when AUTH_MODE=oauth.
 *
 * Importing `@/lib/auth/oauth-config` triggers Auth.js initialization, which
 * requires `AUTH_SECRET` + at least one configured provider. In local (PIN)
 * mode none of that is set, so we short-circuit the route to 404 to avoid
 * crashing the whole server on a missing config.
 */
export const runtime = "nodejs";

type Handler = (req: NextRequest) => Promise<Response>;

async function notFound(): Promise<Response> {
  return new Response("not found", { status: 404 });
}

const isOAuthMode = env().AUTH_MODE === "oauth";

let GET: Handler = notFound;
let POST: Handler = notFound;

if (isOAuthMode) {
  const { handlers } = await import("@/lib/auth/oauth-config");
  GET = handlers.GET;
  POST = handlers.POST;
}

export { GET, POST };
