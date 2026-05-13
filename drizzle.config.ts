import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const rawUrl = process.env.DATABASE_URL ?? "./data/financial-coach.db";

function resolveUrl(url: string): string {
  if (
    url.startsWith("libsql:") ||
    url.startsWith("file:") ||
    url.startsWith("http:") ||
    url.startsWith("https:")
  ) {
    return url;
  }
  return `file:${url}`;
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: resolveUrl(rawUrl),
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  strict: true,
  verbose: true,
});
