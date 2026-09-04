"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { TeamProvider } from "@/lib/team-context";
import { ModalProvider } from "@/lib/modal-context";
import { ModalRoot } from "@/components/modals/modal-root";

/**
 * App-wide client providers, mounted once in the root layout so the Phase-1
 * in-memory team state (created bets, placed wagers, settled balances)
 * survives client navigation between `/` and `/bet/[id]`. ModalRoot lives
 * here too: modals are route-independent (UX-014/016).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TeamProvider>
        <ModalProvider>
          {children}
          <ModalRoot />
        </ModalProvider>
      </TeamProvider>
    </AuthProvider>
  );
}
