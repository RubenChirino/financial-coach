import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET must be at least 32 chars (use `openssl rand -hex 32`)"),
  /**
   * Which authentication mode the app runs in.
   *  - "local"  (default): single-user PIN flow, local-first. No Auth.js.
   *  - "oauth": multi-user, Google + Microsoft sign-in via Auth.js. PIN
   *    onboarding/unlock pages are bypassed; users are created on first
   *    successful OAuth sign-in.
   */
  AUTH_MODE: z.enum(["local", "oauth"]).default("local"),
  /**
   * Required when AUTH_MODE=oauth. Auth.js uses this to sign the JWT session
   * cookie. Same `openssl rand -hex 32` trick as APP_SECRET — but a different
   * value (rotating APP_SECRET invalidates encrypted-at-rest data; rotating
   * AUTH_SECRET only invalidates active sessions).
   */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Required when AUTH_MODE=oauth. Google Cloud OAuth client. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Required when AUTH_MODE=oauth. Microsoft Entra (Azure AD) OAuth client. */
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** Optional when AUTH_MODE=oauth. GitHub OAuth app. */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  /**
   * Entra tenant: "common" (default) accepts any Microsoft personal/work
   * account; a tenant GUID restricts sign-in to that org only. For
   * friends/family use, "common" is what you want.
   */
  MICROSOFT_TENANT_ID: z.string().default("common"),
  GOCARDLESS_SECRET_ID: z.string().optional(),
  GOCARDLESS_SECRET_KEY: z.string().optional(),
  TRUELAYER_CLIENT_ID: z.string().optional(),
  TRUELAYER_CLIENT_SECRET: z.string().optional(),
  TRUELAYER_ENVIRONMENT: z.enum(["sandbox", "live"]).default("sandbox"),
  LLM_PROVIDER: z.enum(["ollama", "anthropic", "openai", "google"]).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:14b-instruct-q4_K_M"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().default("gemini-2.5-flash"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().default(3000),
  DEFAULT_LOCALE: z.enum(["es", "en"]).default("es"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example`);
  }
  cached = parsed.data;

  // OAuth-mode coherence check: fail fast at boot rather than at first sign-in.
  if (cached.AUTH_MODE === "oauth") {
    const missing: string[] = [];
    if (!cached.AUTH_SECRET) missing.push("AUTH_SECRET");
    if (!cached.GOOGLE_CLIENT_ID && !cached.MICROSOFT_CLIENT_ID && !cached.GITHUB_CLIENT_ID) {
      missing.push("at least one of GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID / GITHUB_CLIENT_ID");
    }
    if (cached.GOOGLE_CLIENT_ID && !cached.GOOGLE_CLIENT_SECRET) {
      missing.push("GOOGLE_CLIENT_SECRET");
    }
    if (cached.MICROSOFT_CLIENT_ID && !cached.MICROSOFT_CLIENT_SECRET) {
      missing.push("MICROSOFT_CLIENT_SECRET");
    }
    if (cached.GITHUB_CLIENT_ID && !cached.GITHUB_CLIENT_SECRET) {
      missing.push("GITHUB_CLIENT_SECRET");
    }
    if (missing.length > 0) {
      throw new Error(`AUTH_MODE=oauth requires:\n${missing.map((m) => `  - ${m}`).join("\n")}\n`);
    }
  }

  if (cached.HOST === "0.0.0.0") {
    console.warn(
      "\n⚠️  WARNING: HOST=0.0.0.0 exposes the app on your local network.\n" +
        "   This app is designed to run on 127.0.0.1 only. Anyone on your\n" +
        "   network can reach your financial data.\n",
    );
  }

  return cached;
}
