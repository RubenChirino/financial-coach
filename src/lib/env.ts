import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET must be at least 32 chars (use `openssl rand -hex 32`)"),
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

  if (cached.HOST === "0.0.0.0") {
    console.warn(
      "\n⚠️  WARNING: HOST=0.0.0.0 exposes the app on your local network.\n" +
        "   This app is designed to run on 127.0.0.1 only. Anyone on your\n" +
        "   network can reach your financial data.\n",
    );
  }

  return cached;
}
