"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Ticking clock for countdowns/relative-time displays.
 * Returns `null` until the client mounts (hydration-safe — the server
 * snapshot is always null, so the first client render matches it), then the
 * current epoch ms, ticking every `intervalMs` (default 30s).
 */
export function useNow(intervalMs: number = 30000): number | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const id = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );

  const getSnapshot = () => Date.now();
  const getServerSnapshot = () => null;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
