"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { FeatureFlagProvider } from "@/lib/feature-flags";
import type { FlagMap } from "@/lib/data/feature-flags";
import type { SessionUser } from "@/lib/session-user";
import { TeamProvider } from "@/lib/team-context";
import { ModalProvider } from "@/lib/modal-context";
import { ModalRoot } from "@/components/modals/modal-root";
import { ToastProvider } from "@/lib/toast-context";
import { ToastRoot } from "@/components/sl/toast-layer";

/**
 * App-wide client providers, mounted once in the root layout so the Phase-1
 * in-memory team state (created bets, placed wagers, settled balances)
 * survives client navigation between `/` and `/bet/[id]`. ModalRoot lives
 * here too: modals are route-independent (UX-014/016).
 *
 * ToastProvider sits **outside** TeamProvider and ToastRoot **outside**
 * ModalProvider's subtree, both on purpose (Extra Phase 4, D1). Four of the
 * nine call sites succeed by unmounting the surface that fired them — a kick
 * removes the roster row, delete-team and leave-team close the modal and can
 * tear down the whole TeamGate when it was the last team, delete-bet navigates
 * off the page — so the toast's state and its dismiss timer have to live above
 * everything that can disappear. ToastRoot then portals to `document.body` at
 * `z-[60]` (see sl/toast-layer.tsx), which is what lets a toast raised from
 * inside a modal paint over the backdrop instead of under it.
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
        <ToastProvider>
          <TeamProvider>
            <ModalProvider>
              {children}
              <ModalRoot />
            </ModalProvider>
          </TeamProvider>
          <ToastRoot />
        </ToastProvider>
      </AuthProvider>
    </FeatureFlagProvider>
  );
}
