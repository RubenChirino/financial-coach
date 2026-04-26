import { createTestDb } from "@/test/db-fixture";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests lock in the fix for the lock-page reload bug. The previous
 * in-memory Map implementation lost all sessions whenever the dev server
 * restarted; the DB-backed version must survive anything short of
 * `DELETE FROM sessions`.
 */

const fixture = createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, sqlite: fixture.sqlite }));
vi.mock("@/lib/env", () => ({
  env: () => ({
    APP_SECRET: "test-app-secret-0123456789abcdef0123456789abcdef",
    NODE_ENV: "test",
  }),
}));

const { sessions } = await import("@/db/schema");
const { createSession, destroyAllSessions, destroySession, getSessionByToken, INACTIVITY_MS } =
  await import("./session");

const USER_ID = 42;
const ENCRYPTION_KEY = Buffer.alloc(32, 7);

beforeAll(() => {
  // Minimal user row so the FK is satisfiable. We bypass Drizzle here because
  // the users table has many required columns and we only need the id to exist.
  fixture.sqlite.exec(
    `INSERT INTO users (id, pin_hash, pin_salt, encryption_salt, language, currency, llm_provider, llm_model) VALUES (${USER_ID}, 'h', 's', 's', 'es', 'EUR', 'ollama', 'test')`,
  );
});

beforeEach(() => {
  fixture.sqlite.exec("DELETE FROM sessions");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session store", () => {
  it("round-trips a session and returns the same encryption key", async () => {
    const token = await createSession(USER_ID, ENCRYPTION_KEY);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThanOrEqual(32);

    const session = await getSessionByToken(token);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(USER_ID);
    expect(session?.encryptionKey.equals(ENCRYPTION_KEY)).toBe(true);
  });

  it("stores the token hashed, not plaintext (theft resistance)", async () => {
    const token = await createSession(USER_ID, ENCRYPTION_KEY);
    const rows = await fixture.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toHaveLength(64); // sha256 hex
  });

  it("stores the encryption key wrapped, not plaintext", async () => {
    await createSession(USER_ID, ENCRYPTION_KEY);
    const rows = await fixture.db.select().from(sessions);
    const wrapped = rows[0]?.wrappedKey ?? "";
    const raw = ENCRYPTION_KEY.toString("base64");
    expect(wrapped).not.toContain(raw);
  });

  it("returns null for unknown tokens", async () => {
    expect(await getSessionByToken("nonsense")).toBeNull();
    expect(await getSessionByToken(undefined)).toBeNull();
    expect(await getSessionByToken("")).toBeNull();
  });

  it("expires sessions past the inactivity window", async () => {
    const token = await createSession(USER_ID, ENCRYPTION_KEY);
    // Backdate last_activity_at so the record looks stale.
    const stale = Date.now() - INACTIVITY_MS - 1000;
    fixture.sqlite.prepare("UPDATE sessions SET last_activity_at = ? WHERE 1=1").run(stale);

    expect(await getSessionByToken(token)).toBeNull();
    // Stale row gets cleaned up on access.
    const rows = await fixture.db.select().from(sessions);
    expect(rows).toHaveLength(0);
  });

  it("bumps last_activity_at on every read (sliding expiry)", async () => {
    const token = await createSession(USER_ID, ENCRYPTION_KEY);
    // Backdate to just inside the window.
    const inWindow = Date.now() - INACTIVITY_MS + 60_000;
    fixture.sqlite.prepare("UPDATE sessions SET last_activity_at = ? WHERE 1=1").run(inWindow);

    await getSessionByToken(token);
    const row = (await fixture.db.select().from(sessions))[0];
    expect(row?.lastActivityAt.getTime()).toBeGreaterThan(inWindow);
  });

  it("destroySession removes the row", async () => {
    const token = await createSession(USER_ID, ENCRYPTION_KEY);
    await destroySession(token);
    expect(await getSessionByToken(token)).toBeNull();
    expect(await fixture.db.select().from(sessions)).toHaveLength(0);
  });

  it("destroySession is a no-op for undefined/empty tokens", async () => {
    await createSession(USER_ID, ENCRYPTION_KEY);
    await destroySession(undefined);
    await destroySession("");
    expect(await fixture.db.select().from(sessions)).toHaveLength(1);
  });

  it("destroyAllSessions clears every row", async () => {
    await createSession(USER_ID, ENCRYPTION_KEY);
    await createSession(USER_ID, ENCRYPTION_KEY);
    await destroyAllSessions();
    expect(await fixture.db.select().from(sessions)).toHaveLength(0);
  });

  it("issues distinct tokens for back-to-back sessions", async () => {
    const a = await createSession(USER_ID, ENCRYPTION_KEY);
    const b = await createSession(USER_ID, ENCRYPTION_KEY);
    expect(a).not.toBe(b);
    expect(await fixture.db.select().from(sessions)).toHaveLength(2);
  });

  it("survives a simulated process restart (the actual bug)", async () => {
    // This is the regression test for the reported symptom: user enters PIN,
    // session is created, dev server restarts (HMR re-evaluating the module),
    // user's next request arrives carrying the same cookie — and should still
    // find their session. Under the old Map implementation this step failed.
    const token = await createSession(USER_ID, ENCRYPTION_KEY);

    vi.resetModules();
    const { getSessionByToken: freshGet } = await import("./session");
    const session = await freshGet(token);

    expect(session).not.toBeNull();
    expect(session?.userId).toBe(USER_ID);
    expect(session?.encryptionKey.equals(ENCRYPTION_KEY)).toBe(true);
  });
});
