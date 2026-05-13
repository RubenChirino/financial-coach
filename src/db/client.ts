import "server-only";

import fs from "node:fs";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const DATA_DIR = path.resolve(process.cwd(), "data");
const RAW_URL = process.env.DATABASE_URL ?? path.join(DATA_DIR, "financial-coach.db");

/**
 * Normalize the configured DATABASE_URL into a libSQL-acceptable URL.
 * - `libsql://...` / `http(s)://...`  → remote Turso, used as-is
 * - `file:...`                        → explicit local file, used as-is
 * - any other value                   → assumed to be a filesystem path
 */
function resolveUrl(url: string): string {
  if (
    url.startsWith("libsql:") ||
    url.startsWith("file:") ||
    url.startsWith("http:") ||
    url.startsWith("https:") ||
    url === ":memory:"
  ) {
    return url;
  }
  return `file:${url}`;
}

const DB_URL = resolveUrl(RAW_URL);
const IS_LOCAL_FILE = DB_URL.startsWith("file:");

function ensureDataDir() {
  if (!IS_LOCAL_FILE) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

declare global {
  var __libsqlClient: Client | undefined;
}

function createConnection(): Client {
  ensureDataDir();
  const client = createClient({
    url: DB_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  if (IS_LOCAL_FILE) {
    void client.executeMultiple(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
    );
  }
  return client;
}

const libsqlClient = globalThis.__libsqlClient ?? createConnection();
if (process.env.NODE_ENV !== "production") globalThis.__libsqlClient = libsqlClient;

export const db = drizzle(libsqlClient, { schema });
export type DB = typeof db;
export { libsqlClient as client };
/** Local-file path when DATABASE_URL points at a file, otherwise null. */
export const localDbPath: string | null = IS_LOCAL_FILE ? DB_URL.replace(/^file:/, "") : null;
