"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { FeatureFlagProvider } from "@/lib/feature-flags";
import type { FlagMap } from "@/lib/data/feature-flags";
import type { SessionUser } from "@/lib/session-user";
import { TeamProvider } from "@/lib/team-context";
import { ModalProvider } from "@/lib/modal-context";
import { ModalRoot } from "@/components/modals/modal-root";

/**
 * App-wide client providers, mounted once in the root layout so the Phase-1
 * in-memory team state (created bets, placed wagers, settled balances)
 * survives client navigation between `/` and `/bet/[id]`. ModalRoot lives
 * here too: modals are route-independent (UX-014/016).
 *
 * `initialUser` comes from the root layout's server-side session read
 * (Phase 4); `flags` from the same layout's flags read (Phase 9, ARC-016).
 * Those two are the only props that cross the server/client boundary here, and
 * both are per-request values a client render must not go fetch for itself.
 *
 * FeatureFlagProvider is outermost: a flag may gate anything, including a
 * provider's own children, and it depends on nothing.
 */
export function AppProviders({
  initialUser,
  flags,
  children,
}: {
  initialUser: SessionUser | null;
  flags: FlagMap;
  children: ReactNode;
}) {
  return (
    <FeatureFlagProvider flags={flags}>
      <AuthProvider initialUser={initialUser}>
        <TeamProvider>
          <ModalProvider>
            {children}
            <ModalRoot />
          </ModalProvider>
        </TeamProvider>
      </AuthProvider>
    </FeatureFlagProvider>
  );
}
