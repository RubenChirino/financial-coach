import { describe, expect, it } from "vitest";
import {
  CryptoError,
  decrypt,
  deriveEncryptionKey,
  deriveKey,
  encrypt,
  generateSalt,
  hashPin,
  verifyPin,
} from "./crypto";

describe("salt generation", () => {
  it("produces unique salts", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe("PIN hashing", () => {
  it("verifies the correct PIN", () => {
    const salt = generateSalt();
    const hash = hashPin("123456", salt);
    expect(verifyPin("123456", salt, hash)).toBe(true);
  });

  it("rejects an incorrect PIN", () => {
    const salt = generateSalt();
    const hash = hashPin("123456", salt);
    expect(verifyPin("123457", salt, hash)).toBe(false);
  });

  it("produces different hashes for different salts", () => {
    const h1 = hashPin("123456", generateSalt());
    const h2 = hashPin("123456", generateSalt());
    expect(h1).not.toBe(h2);
  });
});

describe("AES-256-GCM encrypt / decrypt", () => {
  const key = deriveKey("test-secret", generateSalt());

  it("round-trips plaintext", () => {
    const plain = "sensitive: IBAN ES91 2100 0418 4502 0005 1332";
    const ct = encrypt(plain, key);
    expect(decrypt(ct, key)).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("hello", key);
    const b = encrypt("hello", key);
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", () => {
    const ct = encrypt("hello", key);
    const buf = Buffer.from(ct, "base64");
    const lastIdx = buf.length - 1;
    buf[lastIdx] = (buf[lastIdx] ?? 0) ^ 0x01;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  it("rejects decryption with the wrong key", () => {
    const ct = encrypt("hello", key);
    const otherKey = deriveKey("other-secret", generateSalt());
    expect(() => decrypt(ct, otherKey)).toThrow(CryptoError);
  });

  it("throws if key has wrong length", () => {
    const badKey = Buffer.alloc(16);
    expect(() => encrypt("hi", badKey)).toThrow(CryptoError);
  });

  it("handles unicode correctly", () => {
    const plain = "ñ á é í ó ú — 日本語 — 🔐";
    const ct = encrypt(plain, key);
    expect(decrypt(ct, key)).toBe(plain);
  });
});

describe("deriveEncryptionKey", () => {
  it("is deterministic for the same inputs", () => {
    const salt = generateSalt();
    const a = deriveEncryptionKey("123456", "app-secret", salt);
    const b = deriveEncryptionKey("123456", "app-secret", salt);
    expect(a.equals(b)).toBe(true);
  });

  it("differs if any input changes", () => {
    const salt = generateSalt();
    const base = deriveEncryptionKey("123456", "app-secret", salt);
    expect(deriveEncryptionKey("123457", "app-secret", salt).equals(base)).toBe(false);
    expect(deriveEncryptionKey("123456", "app-secret-2", salt).equals(base)).toBe(false);
    expect(deriveEncryptionKey("123456", "app-secret", generateSalt()).equals(base)).toBe(false);
  });
});
