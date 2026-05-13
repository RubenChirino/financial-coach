"use client";

import { useSyncExternalStore } from "react";
import { privacyStore } from "./store";

/**
 * Returns `[isHidden, toggle]` — the current privacy state and a setter.
 * Components that call this will re-render whenever the state changes.
 */
export function usePrivacy(): [boolean, () => void] {
  const isHidden = useSyncExternalStore(
    privacyStore.subscribe,
    privacyStore.getSnapshot,
    privacyStore.getServerSnapshot,
  );
  return [isHidden, privacyStore.toggle];
}
