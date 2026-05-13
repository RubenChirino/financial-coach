// Vitest shim — the real `server-only` package throws on import so modules
// that use it can't be unit-tested in the jsdom-ish environment. In tests we
// never actually render server components, so stubbing to empty is safe.
export {};
