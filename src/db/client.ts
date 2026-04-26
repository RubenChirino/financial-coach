import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_URL ?? path.join(DATA_DIR, "financial-coach.db");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

declare global {
  var __sqlite: Database.Database | undefined;
}

function createConnection(): Database.Database {
  ensureDataDir();
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

const sqlite = globalThis.__sqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") globalThis.__sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export { sqlite };
