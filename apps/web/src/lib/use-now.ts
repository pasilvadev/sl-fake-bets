"use client";

import { useEffect, useState } from "react";

/**
 * Ticking clock for countdowns/relative-time displays.
 * Returns `null` until the client mounts (hydration-safe — server render and
 * first client render both see null), then the current epoch ms, ticking
 * every `intervalMs` (default 30s).
 */
export function useNow(intervalMs: number = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
