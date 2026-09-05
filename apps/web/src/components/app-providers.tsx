"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
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
 * (Phase 4) and is the only prop that crosses the server/client boundary here.
 */
export function AppProviders({
  initialUser,
  children,
}: {
  initialUser: SessionUser | null;
  children: ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <TeamProvider>
        <ModalProvider>
          {children}
          <ModalRoot />
        </ModalProvider>
      </TeamProvider>
    </AuthProvider>
  );
}
