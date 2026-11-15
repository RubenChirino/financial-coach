import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db-fixture";

const fixture = await createTestDb();
vi.mock("@/db/client", () => ({ db: fixture.db, client: fixture.client }));

const testEnv = vi.hoisted(() => ({
  APP_SECRET: "test-app-secret-0123456789abcdef0123456789abcdef",
  AUTH_MODE: "local" as "local" | "oauth",
  NODE_ENV: "test",
}));
vi.mock("@/lib/env", () => ({ env: () => testEnv }));

// A cookie jar standing in for the browser.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const oauthUser = vi.hoisted(() => ({ id: null as number | null }));
vi.mock("./oauth-config", () => ({
  auth: async () => (oauthUser.id == null ? null : { user: { userId: oauthUser.id } }),
}));

const { eq } = await import("drizzle-orm");
const { sessions, users } = await import("@/db/schema");
const {
  CryptoError,
  decrypt,
  deriveEncryptionKey,
  deriveOAuthEncryptionKey,
  deriveOAuthKek,
  derivePinKek,
  encrypt,
  generateDataKey,
  generateSalt,
  hashPin,
  unwrapDataKey,
  wrapDataKey,
} = await import("@/lib/crypto");
const { oauthKeySource, pinKeySource, resolveDataKey } = await import("./keys");
const { setupPinAction, unlockWithPinAction } = await import("./actions");
const { changePinAction } = await import("./security-actions");
const { createSession, enterGuestMode, getCurrentSession, getSessionByToken, SESSION_COOKIE } =
  await import("./session");
const { _resetAll } = await import("@/lib/security/rate-limit");

const SECRET = testEnv.APP_SECRET;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const unlock = (pin: string) => unlockWithPinAction(form({ pin }));
const changePin = (currentPin: string, newPin: string) =>
  changePinAction(form({ currentPin, newPin, confirmPin: newPin }));

async function sessionKey(): Promise<Buffer> {
  const s = await getCurrentSession();
  if (!s) throw new Error("no session");
  return s.encryptionKey;
}

async function storedWrappedDek(id: number): Promise<string | null> {
  const [row] = await fixture.db
    .select({ wrappedDek: users.wrappedDek })
    .from(users)
    .where(eq(users.id, id));
  return row?.wrappedDek ?? null;
}

/** A PIN user from before envelope encryption: no wrapped key, data under the derived key. */
async function legacyPinUser(id: number, pin: string, encryptionSalt = generateSalt()) {
  const pinSalt = generateSalt();
  await fixture.db
    .insert(users)
    .values({ id, pinHash: hashPin(pin, pinSalt), pinSalt, encryptionSalt });
  const legacyKey = deriveEncryptionKey(pin, SECRET, encryptionSalt);
  return { id, encryptionSalt, legacyKey, ciphertext: encrypt("bank-token", legacyKey) };
}

beforeEach(async () => {
  await fixture.client.execute("DELETE FROM users");
  jar.clear();
  _resetAll();
  testEnv.AUTH_MODE = "local";
  oauthUser.id = null;
});

describe("data key primitives", () => {
  const kek = generateDataKey();
  const dek = generateDataKey();

  it("round-trips a wrapped key in the v1 format", () => {
    const wrapped = wrapDataKey(dek, kek, 1);
    expect(wrapped).toMatch(/^v1:/);
    expect(unwrapDataKey(wrapped, kek, 1).equals(dek)).toBe(true);
  });

  it("binds a wrapped key to its user", () => {
    expect(() => unwrapDataKey(wrapDataKey(dek, kek, 1), kek, 2)).toThrow(CryptoError);
  });

  it("rejects a wrong KEK, tampering and unknown versions", () => {
    const wrapped = wrapDataKey(dek, kek, 1);
    expect(() => unwrapDataKey(wrapped, generateDataKey(), 1)).toThrow(CryptoError);
    const raw = Buffer.from(wrapped.slice(3), "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => unwrapDataKey(`v1:${raw.toString("base64")}`, kek, 1)).toThrow(CryptoError);
    expect(() => unwrapDataKey(`v2:${wrapped.slice(3)}`, kek, 1)).toThrow(CryptoError);
  });

  it("derives KEKs distinct from the legacy data keys", () => {
    const salt = generateSalt();
    expect(
      derivePinKek("1234", SECRET, salt).equals(deriveEncryptionKey("1234", SECRET, salt)),
    ).toBe(false);
    expect(deriveOAuthKek(SECRET, salt).equals(deriveOAuthEncryptionKey(SECRET, salt))).toBe(false);
    expect(deriveOAuthKek(SECRET, salt).equals(deriveOAuthKek(SECRET, salt))).toBe(true);
    expect(deriveOAuthKek(SECRET, salt).equals(deriveOAuthKek(SECRET, generateSalt()))).toBe(false);
  });
});

describe("PIN mode", () => {
  it("gives a new user a random data key, wrapped under the PIN", async () => {
    expect(await setupPinAction(form({ pin: "1234", confirm: "1234", language: "en" }))).toEqual({
      ok: true,
    });
    const [user] = await fixture.db.select().from(users);
    if (!user) throw new Error("no user");
    const key = await sessionKey();
    expect(key.equals(deriveEncryptionKey("1234", SECRET, user.encryptionSalt))).toBe(false);
    const wrapped = user.wrappedDek ?? "";
    expect(
      unwrapDataKey(wrapped, derivePinKek("1234", SECRET, user.encryptionSalt), user.id),
    ).toEqual(key);
  });

  it("upgrades a legacy user on unlock, keeping the same key", async () => {
    const u = await legacyPinUser(1, "1234");
    // A session opened before the deploy keeps working unchanged.
    jar.set(SESSION_COOKIE, await createSession(u.id, u.legacyKey));
    expect((await sessionKey()).equals(u.legacyKey)).toBe(true);

    jar.clear();
    expect(await unlock("1234")).toEqual({ ok: true });
    expect(decrypt(u.ciphertext, await sessionKey())).toBe("bank-token");
    const wrapped = await storedWrappedDek(u.id);
    expect(wrapped).toMatch(/^v1:/);

    jar.clear();
    expect(await unlock("1234")).toEqual({ ok: true });
    expect(decrypt(u.ciphertext, await sessionKey())).toBe("bank-token");
    expect(await storedWrappedDek(u.id)).toBe(wrapped);
  });

  it("rejects a wrong PIN before touching the data key", async () => {
    const u = await legacyPinUser(1, "1234");
    expect(await unlock("9999")).toEqual({ ok: false, error: "wrongPin" });
    expect(await storedWrappedDek(u.id)).toBeNull();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("changes the PIN without losing access to existing ciphertext", async () => {
    const u = await legacyPinUser(1, "1234");
    // Change straight from a pre-deploy session: the key is still unwrapped.
    jar.set(SESSION_COOKIE, await createSession(u.id, u.legacyKey));
    const otherDevice = await createSession(u.id, u.legacyKey);

    expect(await changePin("1234", "5678")).toEqual({ ok: true });
    expect(decrypt(u.ciphertext, await sessionKey())).toBe("bank-token");
    // The user's other sessions are revoked.
    expect(await getSessionByToken(otherDevice)).toBeNull();
    expect(await fixture.db.select().from(sessions)).toHaveLength(1);

    jar.clear();
    expect(await unlock("1234")).toEqual({ ok: false, error: "wrongPin" });
    expect(await unlock("5678")).toEqual({ ok: true });
    expect(decrypt(u.ciphertext, await sessionKey())).toBe("bank-token");

    // And again, now that the key is wrapped.
    expect(await changePin("5678", "2468")).toEqual({ ok: true });
    jar.clear();
    expect(await unlock("2468")).toEqual({ ok: true });
    expect(decrypt(u.ciphertext, await sessionKey())).toBe("bank-token");
  });

  it("applies none of a PIN change whose guard no longer holds", async () => {
    const u = await legacyPinUser(1, "1234");
    const existing = await createSession(u.id, u.legacyKey);
    const { replaceSessionsIfPinHash } = await import("./session");
    const next = replaceSessionsIfPinHash(u.id, u.legacyKey, "new-hash");
    const [changed] = await fixture.db.batch([
      fixture.db
        .update(users)
        .set({ pinHash: "new-hash" })
        .where(eq(users.pinHash, "a-hash-from-a-concurrent-change"))
        .returning({ id: users.id }),
      next.revoke,
      next.insert,
    ]);
    expect(changed).toHaveLength(0);
    expect(await getSessionByToken(existing)).not.toBeNull();
    expect(await getSessionByToken(next.token)).toBeNull();
  });

  it("fails closed when the stored key has been tampered with", async () => {
    const u = await legacyPinUser(1, "1234");
    expect(await unlock("1234")).toEqual({ ok: true });
    const wrapped = (await storedWrappedDek(u.id)) ?? "";
    const raw = Buffer.from(wrapped.slice(3), "base64");
    raw[20] = (raw[20] ?? 0) ^ 1;
    await fixture.db
      .update(users)
      .set({ wrappedDek: `v1:${raw.toString("base64")}` })
      .where(eq(users.id, u.id));
    await fixture.client.execute("DELETE FROM sessions");
    jar.clear();

    expect(await unlock("1234")).toEqual({ ok: false, error: "keyUnavailable" });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await fixture.db.select().from(sessions)).toHaveLength(0);
  });
});

describe("OAuth mode", () => {
  beforeEach(() => {
    testEnv.AUTH_MODE = "oauth";
  });

  it("upgrades a legacy user on the first request, keeping the same key", async () => {
    const encryptionSalt = generateSalt();
    await fixture.db.insert(users).values({ id: 7, encryptionSalt, email: "a@example.com" });
    oauthUser.id = 7;
    const legacyKey = deriveOAuthEncryptionKey(SECRET, encryptionSalt);

    expect((await sessionKey()).equals(legacyKey)).toBe(true);
    const wrapped = await storedWrappedDek(7);
    expect(wrapped).toMatch(/^v1:/);
    expect((await sessionKey()).equals(legacyKey)).toBe(true);
    expect(await storedWrappedDek(7)).toBe(wrapped);
  });

  it("fails closed when the stored key does not unwrap", async () => {
    const encryptionSalt = generateSalt();
    const foreign = wrapDataKey(generateDataKey(), generateDataKey(), 7);
    await fixture.db.insert(users).values({ id: 7, encryptionSalt, wrappedDek: foreign });
    oauthUser.id = 7;
    expect(await getCurrentSession()).toBeNull();
  });

  it("gives a guest a random data key, wrapped under the OAuth KEK", async () => {
    await enterGuestMode();
    const [guest] = await fixture.db.select().from(users).where(eq(users.isGuest, true));
    if (!guest?.wrappedDek) throw new Error("guest has no wrapped key");
    const key = await sessionKey();
    expect(key.equals(deriveOAuthEncryptionKey(SECRET, guest.encryptionSalt))).toBe(false);
    expect(
      unwrapDataKey(guest.wrappedDek, deriveOAuthKek(SECRET, guest.encryptionSalt), guest.id),
    ).toEqual(key);
  });
});

describe("resolveDataKey", () => {
  it("does not unwrap a key copied from another user, even under the same KEK", async () => {
    const salt = generateSalt();
    const a = await legacyPinUser(1, "1234", salt);
    const b = await legacyPinUser(2, "1234", salt);
    const keyA = await resolveDataKey(pinKeySource({ ...a, wrappedDek: null }, "1234"));
    const copied = await storedWrappedDek(a.id);
    await fixture.db.update(users).set({ wrappedDek: copied }).where(eq(users.id, b.id));
    expect(keyA.equals(a.legacyKey)).toBe(true);
    await expect(
      resolveDataKey(pinKeySource({ ...b, wrappedDek: copied }, "1234")),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it("converges when concurrent requests wrap a legacy key first", async () => {
    const u = await legacyPinUser(1, "1234");
    const source = pinKeySource({ ...u, wrappedDek: null }, "1234");
    const keys = await Promise.all(Array.from({ length: 5 }, () => resolveDataKey(source)));
    for (const k of keys) expect(k.equals(u.legacyKey)).toBe(true);
    expect(unwrapDataKey((await storedWrappedDek(u.id)) ?? "", source.kek, u.id)).toEqual(
      u.legacyKey,
    );
  });

  it("converges on one random key when concurrent requests create it", async () => {
    const encryptionSalt = generateSalt();
    await fixture.db.insert(users).values({ id: 9, encryptionSalt });
    const source = {
      ...oauthKeySource({ id: 9, encryptionSalt, wrappedDek: null }),
      initialKey: generateDataKey,
    };
    const keys = await Promise.all(Array.from({ length: 5 }, () => resolveDataKey(source)));
    const stored = unwrapDataKey((await storedWrappedDek(9)) ?? "", source.kek, 9);
    for (const k of keys) expect(k.equals(stored)).toBe(true);
  });
});
