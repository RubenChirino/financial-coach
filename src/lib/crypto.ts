import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_N = 1 << 16;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export function generateSalt(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function deriveKey(secret: string, salt: string): Buffer {
  if (!secret) throw new CryptoError("secret must be non-empty");
  if (!salt) throw new CryptoError("salt must be non-empty");
  return scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function hashPin(pin: string, salt: string): string {
  return deriveKey(pin, salt).toString("hex");
}

export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  const actual = deriveKey(pin, salt);
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Encrypts plaintext with AES-256-GCM. Returns base64(iv || tag || ciphertext).
 */
export function encrypt(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LEN) throw new CryptoError(`key must be ${KEY_LEN} bytes`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(ciphertext: string, key: Buffer): string {
  if (key.length !== KEY_LEN) throw new CryptoError(`key must be ${KEY_LEN} bytes`);
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new CryptoError("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("decryption failed (bad key or tampered ciphertext)");
  }
}

/**
 * Derive the at-rest encryption key from a PIN plus the APP_SECRET seed and
 * the user's stored encryption salt. Both the PIN (what the user knows) and
 * the salt (server-side secret) are required — neither alone unlocks the data.
 */
export function deriveEncryptionKey(
  pin: string,
  appSecret: string,
  encryptionSalt: string,
): Buffer {
  return deriveKey(`${pin}::${appSecret}`, encryptionSalt);
}

/**
 * OAuth-mode counterpart of {@link deriveEncryptionKey}. With OAuth there's no
 * user-known secret to mix in, so the key derives from `APP_SECRET` and the
 * per-user `encryptionSalt` alone. The `oauth::` prefix gives domain
 * separation from the PIN-mode derivation — same APP_SECRET + same salt yields
 * a different key in each mode, so swapping modes can't accidentally reuse
 * material.
 *
 * Threat-model: a full server compromise (DB + APP_SECRET) decrypts all
 * OAuth-mode users' data. This is the documented tradeoff in the deployment
 * plan; PIN mode remains strictly stronger.
 */
export function deriveOAuthEncryptionKey(appSecret: string, encryptionSalt: string): Buffer {
  return deriveKey(`oauth::${appSecret}`, encryptionSalt);
}
