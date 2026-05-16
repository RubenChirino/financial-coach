import "server-only";

/**
 * Tiny in-process rate limiter for PIN-unlock attempts.
 *
 * Why a Map instead of a DB column:
 *  - The app is single-user and runs on `127.0.0.1` (or the user's own
 *    machine), so distributed coordination isn't needed.
 *  - Keeping the counter in memory means a process restart resets it. That's
 *    fine: an attacker capable of restarting the Node process to clear their
 *    own backoff has already won (they're root on the box). The lockout is a
 *    timing barrier against remote brute force, not a forensic trail.
 *
 * Algorithm: exponential-backoff lockout. After N consecutive failures the
 * caller MUST wait `BACKOFF_MS[failures]` milliseconds before the next attempt
 * is even checked. The PBKDF2 hash takes ~100ms by itself; the lockout adds a
 * deliberate wall-clock barrier on top so an attacker can't parallelize.
 *
 * 10000 PIN combos × 30s/attempt at the 5th-fail tier = ~83h of grind, with
 * each failure additionally pushing the next try further out. In practice
 * the lockout becomes minutes-long after a dozen tries, which is the desired
 * UX — humans typoing get one or two retries, anything beyond that is a bot.
 */

interface AttemptState {
  failures: number;
  /** ms epoch — next time an attempt is allowed. */
  nextAllowedAt: number;
}

// Backoff schedule indexed by consecutive failure count.
// Index 0..3 → free retries, 4 → 5s, 5 → 15s, 6 → 30s, 7 → 60s, 8+ → 5min.
const BACKOFF_MS = [0, 0, 0, 0, 5_000, 15_000, 30_000, 60_000, 300_000];

const state = new Map<string, AttemptState>();

export interface RateLimitResult {
  /** True when the attempt may proceed. */
  allowed: true;
}
export interface RateLimitedResult {
  allowed: false;
  /** Milliseconds until the next attempt is allowed. */
  retryAfterMs: number;
}

export type RateLimitDecision = RateLimitResult | RateLimitedResult;

function now(): number {
  return Date.now();
}

function backoffFor(failures: number): number {
  return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 300_000;
}

/**
 * Check whether the named bucket is allowed to make an attempt right now.
 *
 *   const decision = checkAttempt("pin-unlock");
 *   if (!decision.allowed) return { ok: false, error: "lockedOut" };
 *
 * The bucket key is just a string — we use the constant `"pin-unlock"` for
 * the single-user app. If multi-user support is ever added, key by user ID.
 */
export function checkAttempt(bucket: string): RateLimitDecision {
  const s = state.get(bucket);
  if (!s) return { allowed: true };
  const wait = s.nextAllowedAt - now();
  if (wait > 0) return { allowed: false, retryAfterMs: wait };
  return { allowed: true };
}

/**
 * Record a failed attempt. Increments the failure counter and pushes the
 * `nextAllowedAt` timestamp out by the schedule above.
 */
export function recordFailure(bucket: string): void {
  const prev = state.get(bucket) ?? { failures: 0, nextAllowedAt: 0 };
  const failures = prev.failures + 1;
  state.set(bucket, {
    failures,
    nextAllowedAt: now() + backoffFor(failures),
  });
}

/**
 * Clear all state for a bucket on a successful attempt — we don't want a
 * legitimate user who typoed twice to be punished after they finally get in.
 */
export function recordSuccess(bucket: string): void {
  state.delete(bucket);
}

/** Test-only: clear everything. */
export function _resetAll(): void {
  state.clear();
}

// ────────────────────────────────────────────────────────────────────────
//  Token-bucket: fixed-window quota for hot endpoints.
//
//  Different shape from the lockout above — we don't want exponential
//  backoff on chat or import (a user will retry repeatedly and learn the
//  product is broken). We want a flat "you've made N calls in the last
//  T seconds; come back later" gate.
//
//  Per-process Map again — fine for a single Vercel function instance.
//  For multi-instance correctness (when traffic grows) this needs a
//  shared store (Upstash, Turso row, etc.), but at our scale (<= ~20
//  friends/family) one instance covers the load.
// ────────────────────────────────────────────────────────────────────────

interface Window {
  /** Window start (ms epoch). */
  start: number;
  /** Calls counted inside this window. */
  count: number;
}

const windows = new Map<string, Window>();

export interface QuotaResult {
  allowed: boolean;
  /** How many more requests fit in the current window. */
  remaining: number;
  /** ms until the window rolls over. */
  resetInMs: number;
}

/**
 * Fixed-window quota check. Each call counts against the bucket regardless
 * of whether it's allowed — i.e. callers should branch on `allowed` and
 * short-circuit when false. There is no "check without consuming" mode
 * because we want abuse-style hammering to extend the lockout, not get
 * cheap "is it ready yet" peeks.
 *
 * @param bucket  Unique key. Combine endpoint + user id, e.g. `chat:42`.
 * @param limit   Max calls per window.
 * @param windowMs  Window length in ms.
 */
export function consumeQuota(bucket: string, limit: number, windowMs: number): QuotaResult {
  const t = now();
  const w = windows.get(bucket);
  if (!w || t - w.start >= windowMs) {
    windows.set(bucket, { start: t, count: 1 });
    return { allowed: true, remaining: limit - 1, resetInMs: windowMs };
  }
  w.count += 1;
  const remaining = Math.max(0, limit - w.count);
  const resetInMs = Math.max(0, windowMs - (t - w.start));
  return { allowed: w.count <= limit, remaining, resetInMs };
}

/**
 * Periodically prune expired windows. Called opportunistically from
 * `consumeQuota` callers' hot paths via the `if (Math.random() < 0.01)`
 * idiom — keeps the Map from growing unbounded under spam, without paying
 * a cleanup cost on every call.
 *
 * Exposed for tests and for any future cron-driven cleanup.
 */
export function pruneExpiredWindows(maxAgeMs: number): number {
  const cutoff = now() - maxAgeMs;
  let dropped = 0;
  for (const [k, v] of windows) {
    if (v.start < cutoff) {
      windows.delete(k);
      dropped++;
    }
  }
  return dropped;
}
