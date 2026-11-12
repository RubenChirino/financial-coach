import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
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
 * LEGACY data-key derivation (PIN mode), kept for users whose `wrapped_dek`
 * is still NULL: for them the data key is defined as this value, and it is
 * wrapped on their next unlock (see `lib/auth/keys.ts`). New users get a
 * random data key instead.
 */
export function deriveEncryptionKey(
  pin: string,
  appSecret: string,
  encryptionSalt: string,
): Buffer {
  return deriveKey(`${pin}::${appSecret}`, encryptionSalt);
}

/**
 * LEGACY data-key derivation (OAuth mode); see {@link deriveEncryptionKey}.
 *
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

// ---------------------------------------------------------------------------
// Envelope encryption.
//
// Each user has a random 32-byte data key (DEK) that encrypts their columns
// with `encrypt`/`decrypt` above (the ciphertext format is unchanged). A
// key-encryption key (KEK) derived from the PIN (or, in OAuth mode, from
// APP_SECRET) only wraps the DEK, so changing the PIN re-wraps 32 bytes and
// leaves every ciphertext readable.
// ---------------------------------------------------------------------------

const DEK_PREFIX = "v1:";
const OAUTH_KEK_INFO = "financial-coach::kek::oauth::v1";

/** A fresh random data key. */
export function generateDataKey(): Buffer {
  return randomBytes(KEY_LEN);
}

/**
 * PIN-mode KEK: scrypt (same parameters as everywhere else) over
 * `kek::v1::<pin>::<APP_SECRET>`, salted with the user's encryption salt.
 * The `kek::v1::` prefix keeps it distinct from the legacy data key, which
 * uses the same PIN, secret and salt.
 */
export function derivePinKek(pin: string, appSecret: string, encryptionSalt: string): Buffer {
  return deriveKey(`kek::v1::${pin}::${appSecret}`, encryptionSalt);
}

/**
 * OAuth-mode KEK: HKDF-SHA256 over APP_SECRET with the user's encryption salt.
 * APP_SECRET is at least 32 characters of entropy, so a slow KDF adds nothing
 * here; HKDF removes the per-request scrypt the legacy derivation cost.
 */
export function deriveOAuthKek(appSecret: string, encryptionSalt: string): Buffer {
  if (!appSecret) throw new CryptoError("secret must be non-empty");
  if (!encryptionSalt) throw new CryptoError("salt must be non-empty");
  return Buffer.from(hkdfSync("sha256", appSecret, encryptionSalt, OAUTH_KEK_INFO, KEY_LEN));
}

/** Associated data: a wrapped key only unwraps for the user it was made for. */
function dataKeyAad(userId: number): Buffer {
  return Buffer.from(`fc:dek:v1:${userId}`, "utf8");
}

/** Wrap a data key: `v1:` + base64(iv || tag || ciphertext), AES-256-GCM, AAD bound to `userId`. */
export function wrapDataKey(dek: Buffer, kek: Buffer, userId: number): string {
  if (dek.length !== KEY_LEN) throw new CryptoError(`data key must be ${KEY_LEN} bytes`);
  if (kek.length !== KEY_LEN) throw new CryptoError(`key must be ${KEY_LEN} bytes`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, kek, iv);
  cipher.setAAD(dataKeyAad(userId));
  const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
  return DEK_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/**
 * Unwrap a data key. Throws `CryptoError` on a wrong KEK, a key wrapped for
 * another user, an unknown version, or any tampering — never returns a guess.
 */
export function unwrapDataKey(wrapped: string, kek: Buffer, userId: number): Buffer {
  if (kek.length !== KEY_LEN) throw new CryptoError(`key must be ${KEY_LEN} bytes`);
  if (!wrapped.startsWith(DEK_PREFIX)) throw new CryptoError("unknown data key version");
  const buf = Buffer.from(wrapped.slice(DEK_PREFIX.length), "base64");
  if (buf.length !== IV_LEN + TAG_LEN + KEY_LEN) throw new CryptoError("malformed data key");
  const decipher = createDecipheriv(ALGO, kek, buf.subarray(0, IV_LEN));
  decipher.setAAD(dataKeyAad(userId));
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  try {
    return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]);
  } catch {
    throw new CryptoError("data key unwrap failed (bad key, wrong user or tampered)");
  }
}
