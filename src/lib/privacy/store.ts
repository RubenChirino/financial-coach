"use client";

/**
 * Privacy store — toggles balance visibility across the app.
 *
 * Uses a module-level observable so any component can read/set the state
 * without a Provider. Persists to localStorage so the preference survives
 * page navigations and is restored on load.
 *
 * Pattern: minimal hand-rolled pub-sub compatible with React's
 * `useSyncExternalStore`. No Zustand / Jotai dependency needed.
 */

const STORAGE_KEY = "coin_privacy";

type Listener = () => void;

let hidden = false;
const listeners = new Set<Listener>();

// Init from storage (client-side only — avoid SSR crash).
if (typeof window !== "undefined") {
  hidden = localStorage.getItem(STORAGE_KEY) === "1";
}

function notify() {
  for (const l of listeners) l();
}

export const privacyStore = {
  get(): boolean {
    return hidden;
  },
  toggle() {
    hidden = !hidden;
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    }
    notify();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Snapshot for useSyncExternalStore. */
  getSnapshot(): boolean {
    return hidden;
  },
  /** Server snapshot — always false (no balances hidden on the server). */
  getServerSnapshot(): boolean {
    return false;
  },
};
