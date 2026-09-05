"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { KnownFeatureFlag } from "@repo/shared";
import type { FlagMap, FlagState } from "@/lib/data/feature-flags";

/**
 * The flags this render was produced with (ARC-016 — roadmap Phase 9, task 2).
 *
 * Read once per request by the root layout and frozen for that render, which is
 * what "read at load" means: a flag cannot change under a mounted tree, and a
 * toggle in Studio lands on the next page load. That is the behavior ARC-016
 * asks for — no deploy, no rebuild — and it is also the only one that keeps a
 * flag from becoming a state machine every consumer has to handle.
 *
 * Default `{}` rather than a throwing hook: a component that reads a flag must
 * work in any tree, and an absent provider means the same thing an absent row
 * does — the feature is off.
 */
const FeatureFlagContext = createContext<FlagMap>({});

export function FeatureFlagProvider({
  flags,
  children,
}: {
  flags: FlagMap;
  children: ReactNode;
}) {
  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

/**
 * Is this feature on? The key is `KnownFeatureFlag`, so a typo is a compile
 * error rather than a silent `undefined` — which would read as "off" and look
 * exactly like correct behavior.
 */
export function useFeatureFlag(key: KnownFeatureFlag): boolean {
  return useContext(FeatureFlagContext)[key]?.enabled ?? false;
}

/** The row's `payload`, for a flag that carries config as well as a switch. */
export function useFeatureFlagState(key: KnownFeatureFlag): FlagState | null {
  return useContext(FeatureFlagContext)[key] ?? null;
}
